"""Northstar Telegram Alert Sender.

Stateless notification module for sending alerts to an operator
via Telegram Bot API.

Config via environment variables:
    TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
    TELEGRAM_CHAT_ID    — Chat/group ID to send messages to
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def _configured() -> bool:
    return bool(BOT_TOKEN and CHAT_ID)


def send_alert(message: str) -> bool:
    """Send a plain text message. Returns True on success."""
    if not _configured():
        return False
    try:
        resp = requests.post(
            f"{API_BASE}/sendMessage",
            json={"chat_id": CHAT_ID, "text": message, "parse_mode": "Markdown"},
            timeout=10,
        )
        return resp.ok
    except Exception:
        return False


def notify_trade(event: dict) -> bool:
    """Format and send a trade notification."""
    if not _configured():
        return False
    evt = event.get("event", "trade")
    chain = event.get("chain", "?")
    amount = event.get("amount", "?")
    symbol = event.get("symbol", "?")
    value = event.get("value_usd", "?")
    msg = (
        f"*{evt.upper()}*\n"
        f"Chain: `{chain}`\n"
        f"Amount: {amount} {symbol}\n"
        f"Value: ${value}\n"
        f"Time: {event.get('ts', datetime.now(timezone.utc).isoformat()[:16])}"
    )
    return send_alert(msg)


def notify_policy_warning(usage: dict) -> bool:
    """Alert when approaching daily limits."""
    if not _configured():
        return False
    spent = usage.get("daily_spent_usd", 0)
    limit = usage.get("max_daily_usd", 25)
    pct = (spent / limit * 100) if limit > 0 else 0
    txs = usage.get("daily_tx_count", 0)
    max_txs = usage.get("max_daily_txs", 5)
    msg = (
        f"*POLICY WARNING*\n"
        f"Daily spend: ${spent:.2f} / ${limit:.2f} ({pct:.0f}%)\n"
        f"Transactions: {txs} / {max_txs}\n"
        f"Remaining: ${usage.get('daily_remaining_usd', 0):.2f}"
    )
    return send_alert(msg)


def send_daily_summary(portfolio: dict) -> bool:
    """End-of-day portfolio summary."""
    if not _configured():
        return False
    total = portfolio.get("total_value_usd", 0)
    holdings = portfolio.get("holdings", [])
    lines = [
        f"*DAILY SUMMARY*",
        f"Total Value: ${total:.2f}",
        f"Holdings: {len(holdings)}",
    ]
    for h in holdings[:5]:
        sym = h.get("symbol", "?")
        val = h.get("value_usd", 0)
        lines.append(f"  {sym}: ${val:.2f}")

    policy = portfolio.get("policy", {})
    if policy:
        lines.append(f"Daily spent: ${policy.get('daily_spent_usd', 0):.2f}")
    return send_alert("\n".join(lines))
