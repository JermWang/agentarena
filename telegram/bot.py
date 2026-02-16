#!/usr/bin/env python3
"""Northstar Telegram Bot — long-polling with command handlers.

Run as: python bot.py &
Commands: /balance, /status, /strategy, /approve, /markets, /msg, /note, /convo, /help

Configuration:
    TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
    TELEGRAM_CHAT_ID    — Your chat ID
    NORTHSTAR_HOME      — Data directory (default: ~/.northstar)

Reads portfolio.json + financial_events.jsonl for responses.
Writes incoming commands to telegram_commands.jsonl.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

NORTHSTAR_HOME = Path(os.environ.get("NORTHSTAR_HOME", os.path.expanduser("~/.northstar")))
FINANCIAL = NORTHSTAR_HOME / "financial"
PORTFOLIO_FILE = FINANCIAL / "state" / "portfolio.json"
EVENTS_LOG = FINANCIAL / "events" / "financial_events.jsonl"
STRATEGY_FILE = FINANCIAL / "memory" / "strategy.md"
COMMANDS_LOG = FINANCIAL / "events" / "telegram_commands.jsonl"
MESSAGES_LOG = FINANCIAL / "events" / "telegram_messages.jsonl"
INBOX_FILE = NORTHSTAR_HOME / "directives" / "priorities" / "00_inbox.md"

FINANCIAL.mkdir(parents=True, exist_ok=True)
(FINANCIAL / "events").mkdir(parents=True, exist_ok=True)


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_jsonl_tail(path: Path, n: int = 10) -> list[dict]:
    if not path.exists():
        return []
    entries: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return []
    return entries[-n:]


def _log_command(user: str, command: str, text: str) -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "user": user,
        "command": command,
        "text": text,
    }
    with COMMANDS_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _send(text: str, chat_id: str | int) -> bool:
    try:
        resp = requests.post(
            f"{API_BASE}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        return resp.ok
    except Exception:
        return False


def handle_balance(chat_id: str | int) -> None:
    # Try to get a fresh snapshot via finance module
    try:
        from core.finance import compute_portfolio_snapshot, get_portfolio_24h_change
        p = compute_portfolio_snapshot()
        change = get_portfolio_24h_change()
    except Exception:
        p = _read_json(PORTFOLIO_FILE)
        change = {}

    if not p:
        _send("No portfolio data yet. Run a snapshot first.", chat_id)
        return

    total = p.get("total_value_usd", 0)
    sol = p.get("sol_balance")
    sol_price = p.get("sol_price")
    sol_val = (sol or 0) * (sol_price or 0)
    eth = p.get("base_balance")
    eth_price = p.get("eth_price")
    eth_val = (eth or 0) * (eth_price or 0)
    policy = p.get("policy", {})

    # 24h change
    delta_usd = change.get("change_usd", 0)
    delta_pct = change.get("change_pct", 0)
    delta_arrow = "\u25b2" if delta_usd >= 0 else "\u25bc"
    delta_str = f"{delta_arrow} {delta_pct:+.1f}% (${delta_usd:+.2f})" if delta_usd else "\u2014"

    # Budget usage
    daily_spent = policy.get("daily_spent_usd", 0)
    daily_max = policy.get("max_daily_usd", 25)
    tx_count = policy.get("daily_tx_count", 0)
    tx_max = policy.get("max_daily_txs", 5)
    budget_pct = (daily_spent / daily_max * 100) if daily_max > 0 else 0
    filled = int(budget_pct / 12.5)
    bar = "\u2588" * filled + "\u2591" * (8 - filled)

    msg = (
        f"\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n"
        f"\u2502  *PORTFOLIO*  ${total:.2f}     \u2502\n"
        f"\u2502  24h: {delta_str}     \u2502\n"
        f"\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n"
        f"\u2502 \u25ce *SOL*              \u2502\n"
        f"\u2502   {sol:.4f} \u00b7 ${sol_price:.2f}   \u2502\n"
        f"\u2502   Value: ${sol_val:.2f}       \u2502\n"
    )
    if eth is not None:
        msg += (
            f"\u2502 \u2b21 *ETH* (Base)       \u2502\n"
            f"\u2502   {eth:.6f} \u00b7 ${eth_price:.2f}\u2502\n"
            f"\u2502   Value: ${eth_val:.2f}       \u2502\n"
        )
    # Extra holdings
    for h in p.get("holdings", []):
        if h.get("symbol") not in ("SOL", "ETH"):
            h_sym = h.get("symbol", "?")
            h_amt = h.get("amount", 0)
            h_val = h.get("value_usd", 0)
            msg += f"\u2502 \u25cf *{h_sym}*: {h_amt:.4f} (${h_val:.2f})\u2502\n"

    msg += (
        f"\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n"
        f"\u2502 Mode: {policy.get('mode', '?')}  Tx: {tx_count}/{tx_max}    \u2502\n"
        f"\u2502 Budget [{bar}] {budget_pct:.0f}%\u2502\n"
        f"\u2502 ${daily_spent:.2f} / ${daily_max:.2f}       \u2502\n"
        f"\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n"
        f"_{p.get('ts', '')[:16]}_"
    )

    _send(msg, chat_id)


def handle_status(chat_id: str | int) -> None:
    p = _read_json(PORTFOLIO_FILE)
    policy = p.get("policy", {})
    lines = [
        "*Agent Status*",
        f"Portfolio: ${p.get('total_value_usd', 0):.2f}",
        f"Policy mode: {policy.get('mode', '?')}",
        f"Daily spent: ${policy.get('daily_spent_usd', 0):.2f} / ${policy.get('max_daily_usd', 0):.2f}",
        f"Tx today: {policy.get('daily_tx_count', 0)} / {policy.get('max_daily_txs', 0)}",
    ]
    events = _read_jsonl_tail(EVENTS_LOG, 3)
    if events:
        lines.append("\n*Recent events:*")
        for e in events:
            lines.append(f"- [{e.get('ts', '?')[:16]}] {e.get('event', '?')}")
    _send("\n".join(lines), chat_id)


def handle_strategy(chat_id: str | int) -> None:
    if STRATEGY_FILE.exists():
        text = STRATEGY_FILE.read_text(encoding="utf-8")[:3000]
    else:
        text = "No strategy file found."
    _send(text, chat_id)


def handle_convo(chat_id: str | int) -> None:
    """Show recent conversation thread (both directions)."""
    outbox_file = FINANCIAL / "events" / "telegram_outbox.jsonl"
    inbox = _read_jsonl_tail(MESSAGES_LOG, 15)
    outbox = _read_jsonl_tail(outbox_file, 15)
    for m in inbox:
        m["_dir"] = "you"
    for m in outbox:
        m["_dir"] = "agent"
    combined = sorted(inbox + outbox, key=lambda x: x.get("ts", ""))
    recent = combined[-15:]
    if not recent:
        _send("No conversation history yet. Send a message to start!", chat_id)
        return
    lines = ["*Recent Conversation*\n"]
    for m in recent:
        ts = m.get("ts", "")[:16]
        who = m["_dir"]
        msg = m.get("message", "")[:150]
        prefix = "You" if who == "you" else "Agent"
        lines.append(f"{prefix} [{ts}]\n{msg}\n")
    _send("\n".join(lines), chat_id)


def handle_help(chat_id: str | int) -> None:
    _send(
        "*Northstar Agent Bot*\n\n"
        "*Finance*\n"
        "/balance \u2014 Wallet balances\n"
        "/status \u2014 Agent status + policy\n"
        "/strategy \u2014 Trading strategy\n"
        "/markets \u2014 Trending Polymarket\n\n"
        "*Communicate*\n"
        "/msg <text> \u2014 Send to agent inbox\n"
        "/note <text> \u2014 Save to memory bank\n"
        "/convo \u2014 View conversation thread\n\n"
        "*System*\n"
        "/approve \u2014 Approve pending actions\n"
        "/help \u2014 This message",
        chat_id,
    )


def handle_approve(chat_id: str | int) -> None:
    _send("Approval via Telegram not yet implemented. Use the dashboard.", chat_id)


def handle_msg(chat_id: str | int, text: str) -> None:
    """Send a message to the agent's inbox."""
    msg = text.split(None, 1)[1] if len(text.split(None, 1)) > 1 else ""
    if not msg:
        _send("Usage: /msg <your message>\n\nThis drops a message into the agent inbox.", chat_id)
        return

    ts = datetime.now(timezone.utc).isoformat()

    entry = {"ts": ts, "from": "telegram", "message": msg}
    with MESSAGES_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")

    INBOX_FILE.parent.mkdir(parents=True, exist_ok=True)
    with INBOX_FILE.open("a", encoding="utf-8") as f:
        f.write(f"\n[telegram {ts[:16]}] {msg}\n")

    _send(f'Message delivered to agent inbox:\n"{msg}"', chat_id)


def handle_note(chat_id: str | int, text: str) -> None:
    """Save a quick note to financial memory decisions log."""
    msg = text.split(None, 1)[1] if len(text.split(None, 1)) > 1 else ""
    if not msg:
        _send("Usage: /note <your note>\n\nSaves to the financial decisions log.", chat_id)
        return

    ts = datetime.now(timezone.utc).isoformat()
    decisions_log = FINANCIAL / "memory" / "decisions.jsonl"
    decisions_log.parent.mkdir(parents=True, exist_ok=True)
    entry = {"ts": ts, "type": "human_note", "reasoning": msg, "source": "telegram"}
    with decisions_log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")

    _send(f'Note saved to memory bank:\n"{msg}"', chat_id)


def handle_markets(chat_id: str | int) -> None:
    """Show trending Polymarket markets."""
    try:
        resp = requests.get(
            "https://gamma-api.polymarket.com/markets",
            params={"limit": "5", "active": "true", "order": "volume24hr", "ascending": "false"},
            timeout=15,
        )
        markets = resp.json() if resp.ok else []
        if not markets:
            _send("No markets data available.", chat_id)
            return
        lines = ["*Trending Markets (Polymarket)*"]
        for m in markets[:5]:
            q = m.get("question", "?")[:70]
            vol = float(m.get("volume24hr", 0))
            prices = m.get("outcomePrices", "[]")
            outcomes = m.get("outcomes", "[]")
            try:
                p_list = json.loads(prices) if isinstance(prices, str) else prices
                o_list = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
                odds = " / ".join(f"{o}: {float(p)*100:.0f}%" for o, p in zip(o_list[:2], p_list[:2]))
            except Exception:
                odds = ""
            lines.append(f"\n{q}")
            if odds:
                lines.append(f"  {odds}")
            lines.append(f"  Vol: ${vol:,.0f}")
        _send("\n".join(lines), chat_id)
    except Exception as e:
        _send(f"Failed to fetch markets: {e}", chat_id)


# Commands that need the full message text
TEXT_HANDLERS = {
    "/msg": handle_msg,
    "/note": handle_note,
}

HANDLERS = {
    "/balance": handle_balance,
    "/status": handle_status,
    "/strategy": handle_strategy,
    "/approve": handle_approve,
    "/help": handle_help,
    "/start": handle_help,
    "/markets": handle_markets,
    "/convo": handle_convo,
}


def poll() -> None:
    if not BOT_TOKEN:
        print("TELEGRAM_BOT_TOKEN not set. Exiting.", file=sys.stderr)
        sys.exit(1)

    offset = 0
    print(f"Northstar Bot started. Polling {API_BASE}/getUpdates ...")

    while True:
        try:
            resp = requests.get(
                f"{API_BASE}/getUpdates",
                params={"offset": offset, "timeout": 30},
                timeout=35,
            )
            data = resp.json()
            for update in data.get("result", []):
                offset = update["update_id"] + 1
                msg = update.get("message", {})
                text = (msg.get("text") or "").strip()
                chat_id = msg.get("chat", {}).get("id")
                user = msg.get("from", {}).get("username", "unknown")

                if not text or not chat_id:
                    continue

                cmd = text.split()[0].lower().split("@")[0]
                _log_command(user, cmd, text)

                text_handler = TEXT_HANDLERS.get(cmd)
                if text_handler:
                    text_handler(chat_id, text)
                else:
                    handler = HANDLERS.get(cmd)
                    if handler:
                        handler(chat_id)
                    elif not text.startswith("/"):
                        handle_msg(chat_id, f"/msg {text}")
                    else:
                        _send(f"Unknown command: `{cmd}`\nTry /help", chat_id)

        except requests.exceptions.Timeout:
            continue
        except KeyboardInterrupt:
            print("Bot stopped.")
            break
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            time.sleep(5)


if __name__ == "__main__":
    poll()
