"""Northstar Financial Data Layer.

Provides price fetching, balance checking, policy management, event logging,
memory bank operations, and portfolio snapshot computation for autonomous
AI agent financial operations.

Configuration:
    Set NORTHSTAR_HOME env var to your data directory (default: ~/.northstar).
    All secrets (tokens, keys) come from environment variables.

Directory structure (auto-created under NORTHSTAR_HOME):
    financial/
        memory/    -> decisions.jsonl, research.jsonl, strategy.md, context.md
        state/     -> portfolio.json, performance.json, portfolio_history.jsonl
        events/    -> financial_events.jsonl, alerts.jsonl, telegram_*.jsonl
    wallet/
        keys/      -> solana-keypair.json, evm-key.json (user-provided)
        state/     -> ledger.json, last_tx.json
        config/    -> chain-config.json, policy.yaml
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── Configuration ────────────────────────────────────────────────
NORTHSTAR_HOME = Path(os.environ.get("NORTHSTAR_HOME", os.path.expanduser("~/.northstar")))

FINANCIAL_DIR = NORTHSTAR_HOME / "financial"
MEMORY_DIR = FINANCIAL_DIR / "memory"
STATE_DIR = FINANCIAL_DIR / "state"
EVENTS_DIR = FINANCIAL_DIR / "events"

WALLET_DIR = NORTHSTAR_HOME / "wallet"
KEYS_DIR = WALLET_DIR / "keys"
WALLET_STATE_DIR = WALLET_DIR / "state"
WALLET_CONFIG_DIR = WALLET_DIR / "config"

# File paths
DECISIONS_LOG = MEMORY_DIR / "decisions.jsonl"
RESEARCH_LOG = MEMORY_DIR / "research.jsonl"
STRATEGY_FILE = MEMORY_DIR / "strategy.md"
CONTEXT_FILE = MEMORY_DIR / "context.md"

PORTFOLIO_FILE = STATE_DIR / "portfolio.json"
PORTFOLIO_HISTORY = STATE_DIR / "portfolio_history.jsonl"
PERFORMANCE_FILE = STATE_DIR / "performance.json"

EVENTS_LOG = EVENTS_DIR / "financial_events.jsonl"
ALERTS_LOG = EVENTS_DIR / "alerts.jsonl"

CHAIN_CONFIG = WALLET_CONFIG_DIR / "chain-config.json"
POLICY_YAML = WALLET_CONFIG_DIR / "policy.yaml"
POLICY_LEDGER = WALLET_STATE_DIR / "ledger.json"
POLICY_LAST_TX = WALLET_STATE_DIR / "last_tx.json"
POLICY_CHECK_SCRIPT = WALLET_DIR / "scripts" / "policy_check.py"

TELEGRAM_MESSAGES_IN = EVENTS_DIR / "telegram_messages.jsonl"
TELEGRAM_MESSAGES_OUT = EVENTS_DIR / "telegram_outbox.jsonl"

# Price APIs
COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"
DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex/tokens"

# Known mints
SOL_MINT = "So11111111111111111111111111111111111111112"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# Secrets from env only
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
JUPITER_API_KEY = os.environ.get("JUPITER_API_KEY", "")

# ── Directory init ────────────────────────────────────────────────
for _d in (MEMORY_DIR, STATE_DIR, EVENTS_DIR, KEYS_DIR, WALLET_STATE_DIR, WALLET_CONFIG_DIR):
    _d.mkdir(parents=True, exist_ok=True)


# ── JSONL helpers ─────────────────────────────────────────────────
def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_jsonl(path: Path, entry: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _read_jsonl(path: Path, limit: int = 0) -> list[dict]:
    if not path.exists():
        return []
    entries: list[dict] = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except Exception:
                        continue
    except Exception:
        return []
    if limit > 0:
        entries = entries[-limit:]
    return entries


def _read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True), encoding="utf-8")


# ── Chain config ──────────────────────────────────────────────────
def _load_chain_config() -> dict:
    return _read_json(CHAIN_CONFIG, {})


def get_solana_rpc() -> str:
    return _load_chain_config().get("solana", {}).get("rpc", "https://api.mainnet-beta.solana.com")


def get_base_rpc() -> str:
    return _load_chain_config().get("base", {}).get("rpc", "https://mainnet.base.org")


def _b58encode(data: bytes) -> str:
    """Pure-python base58 encoding (Bitcoin alphabet)."""
    alphabet = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(data, "big")
    result = bytearray()
    while n > 0:
        n, r = divmod(n, 58)
        result.append(alphabet[r])
    for byte in data:
        if byte == 0:
            result.append(alphabet[0])
        else:
            break
    return bytes(reversed(result)).decode("ascii")


def get_solana_address() -> str:
    """Read public address from keypair file."""
    try:
        kp_path = KEYS_DIR / "solana-keypair.json"
        if not kp_path.exists():
            return ""
        kp = json.loads(kp_path.read_text())
        if isinstance(kp, dict):
            return kp.get("public_key", "")
        if isinstance(kp, list) and len(kp) >= 64:
            return _b58encode(bytes(kp[32:64]))
        return ""
    except Exception:
        return ""


def get_base_address() -> str:
    """Read EVM address from key file."""
    try:
        key_path = KEYS_DIR / "evm-key.json"
        if not key_path.exists():
            return ""
        data = json.loads(key_path.read_text())
        return data.get("address", "")
    except Exception:
        return ""


# ── HTTP helpers ──────────────────────────────────────────────────
def _http_get_json(url: str, params: dict | None = None, timeout: int = 10) -> dict | None:
    try:
        import requests
        resp = requests.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def _http_post_json(url: str, payload: dict, timeout: int = 10) -> dict | None:
    try:
        import requests
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


# ── Price fetching ────────────────────────────────────────────────
def _coingecko_price(coin_id: str) -> float | None:
    data = _http_get_json(COINGECKO_PRICE_URL, params={"ids": coin_id, "vs_currencies": "usd"})
    if data:
        try:
            return float(data[coin_id]["usd"])
        except (KeyError, TypeError, ValueError):
            pass
    return None


def _dexscreener_price(token_address: str) -> float | None:
    data = _http_get_json(f"{DEXSCREENER_URL}/{token_address}")
    if data:
        try:
            pairs = data.get("pairs", [])
            if pairs:
                return float(pairs[0]["priceUsd"])
        except (KeyError, TypeError, ValueError, IndexError):
            pass
    return None


def get_sol_price() -> float | None:
    """Fetch SOL/USD price via CoinGecko, DexScreener fallback."""
    price = _coingecko_price("solana")
    if price:
        return price
    return _dexscreener_price(SOL_MINT)


def get_eth_price() -> float | None:
    """Fetch ETH/USD price via CoinGecko, DexScreener fallback."""
    price = _coingecko_price("ethereum")
    if price:
        return price
    weth_base = "0x4200000000000000000000000000000000000006"
    return _dexscreener_price(weth_base)


def get_token_price(mint: str) -> float | None:
    """Fetch price for any token via DexScreener."""
    return _dexscreener_price(mint)


# ── Balance checking ──────────────────────────────────────────────
def get_solana_balance() -> float | None:
    """Get SOL balance in SOL (not lamports)."""
    address = get_solana_address()
    if not address:
        return None
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getBalance",
        "params": [address],
    }
    data = _http_post_json(get_solana_rpc(), payload)
    if data:
        try:
            lamports = data["result"]["value"]
            return lamports / 1_000_000_000
        except (KeyError, TypeError):
            pass
    return None


def get_solana_token_accounts() -> list[dict]:
    """Get SPL token holdings via getTokenAccountsByOwner."""
    address = get_solana_address()
    if not address:
        return []
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getTokenAccountsByOwner",
        "params": [
            address,
            {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
            {"encoding": "jsonParsed"},
        ],
    }
    data = _http_post_json(get_solana_rpc(), payload)
    if not data:
        return []
    accounts = []
    try:
        for item in data["result"]["value"]:
            info = item["account"]["data"]["parsed"]["info"]
            mint = info["mint"]
            amount = float(info["tokenAmount"]["uiAmount"] or 0)
            decimals = info["tokenAmount"]["decimals"]
            if amount > 0:
                accounts.append({"mint": mint, "amount": amount, "decimals": decimals})
    except (KeyError, TypeError):
        pass
    return accounts


def get_base_balance() -> float | None:
    """Get ETH balance on Base in ETH."""
    address = get_base_address()
    if not address:
        return None
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "eth_getBalance",
        "params": [address, "latest"],
    }
    data = _http_post_json(get_base_rpc(), payload)
    if data:
        try:
            wei = int(data["result"], 16)
            return wei / 1e18
        except (KeyError, TypeError, ValueError):
            pass
    return None


# ── Policy ────────────────────────────────────────────────────────
def check_policy(chain: str, value_usd: float, to: str = "", commit: bool = False) -> tuple[bool, str]:
    """Run policy_check.py as subprocess. Returns (allowed, message)."""
    if not POLICY_CHECK_SCRIPT.exists():
        return False, "policy_check.py not found"
    req = json.dumps({"chain": chain, "value_usd": value_usd, "to": to, "commit": commit})
    try:
        venv_python = WALLET_DIR / "venv" / "bin" / "python3"
        python = str(venv_python) if venv_python.exists() else "python3"
        result = subprocess.run(
            [python, str(POLICY_CHECK_SCRIPT)],
            input=req, capture_output=True, text=True, timeout=10,
        )
        output = (result.stdout.strip() or result.stderr.strip())
        return result.returncode == 0, output
    except Exception as e:
        return False, f"policy check error: {e}"


def _parse_simple_yaml(text: str) -> dict:
    """Minimal YAML parser for flat key: value files."""
    result: dict[str, Any] = {}
    for line in text.splitlines():
        line = line.split("#")[0].strip()
        if not line or ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if not val or val in ("[]", "{}"):
            continue
        if val.lower() in ("true", "yes"):
            result[key] = True
        elif val.lower() in ("false", "no"):
            result[key] = False
        else:
            try:
                result[key] = int(val)
            except ValueError:
                try:
                    result[key] = float(val)
                except ValueError:
                    result[key] = val
    return result


def get_policy_status() -> dict:
    """Read policy config + current ledger state."""
    try:
        raw = POLICY_YAML.read_text(encoding="utf-8") if POLICY_YAML.exists() else ""
        try:
            import yaml
            policy = yaml.safe_load(raw) or {}
        except ImportError:
            policy = _parse_simple_yaml(raw)
    except Exception:
        policy = {}

    ledger = _read_json(POLICY_LEDGER, {})
    last_tx = _read_json(POLICY_LAST_TX, {})
    day_key = time.strftime("%Y-%m-%d", time.gmtime())
    day_entry = ledger.get(day_key, {"count": 0, "value_usd": 0.0})

    max_daily = float(policy.get("max_daily_value_usd", 0))
    max_tx = float(policy.get("max_tx_value_usd", 0))
    max_daily_txs = int(policy.get("max_daily_txs", 0))
    cooldown = int(policy.get("cooldown_seconds", 0))
    mode = policy.get("mode", "UNKNOWN")

    cooldown_remaining = 0
    last_ts = int(last_tx.get("ts", 0))
    if cooldown > 0 and last_ts > 0:
        elapsed = int(time.time()) - last_ts
        cooldown_remaining = max(0, cooldown - elapsed)

    return {
        "mode": mode,
        "max_tx_usd": max_tx,
        "max_daily_usd": max_daily,
        "max_daily_txs": max_daily_txs,
        "daily_spent_usd": day_entry.get("value_usd", 0.0),
        "daily_tx_count": day_entry.get("count", 0),
        "daily_remaining_usd": max(0, max_daily - day_entry.get("value_usd", 0.0)),
        "cooldown_seconds": cooldown,
        "cooldown_remaining": cooldown_remaining,
    }


# ── Telegram communication ────────────────────────────────────────
def send_telegram(message: str) -> bool:
    """Send a message to the operator via Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        import requests
        resp = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"},
            timeout=10,
        )
        if resp.ok:
            _append_jsonl(TELEGRAM_MESSAGES_OUT, {
                "ts": _utcnow(), "to": "operator", "message": message,
            })
        return resp.ok
    except Exception:
        return False


def read_telegram_inbox(limit: int = 20) -> list[dict]:
    """Read recent messages FROM the operator."""
    return _read_jsonl(TELEGRAM_MESSAGES_IN, limit=limit)


def read_telegram_conversation(limit: int = 30) -> list[dict]:
    """Read interleaved in/out messages for conversation view."""
    inbox = _read_jsonl(TELEGRAM_MESSAGES_IN, limit=limit)
    outbox = _read_jsonl(TELEGRAM_MESSAGES_OUT, limit=limit)
    for m in inbox:
        m["direction"] = "in"
    for m in outbox:
        m["direction"] = "out"
    combined = sorted(inbox + outbox, key=lambda x: x.get("ts", ""))
    return combined[-limit:]


# ── Event logging ─────────────────────────────────────────────────
def log_financial_event(event_type: str, data: dict | None = None) -> None:
    """Append to financial_events.jsonl and notify via Telegram."""
    entry = {"ts": _utcnow(), "event": event_type}
    if data:
        entry.update(data)
    _append_jsonl(EVENTS_LOG, entry)
    try:
        send_telegram(f"[{event_type}] {json.dumps(data or {})[:200]}")
    except Exception:
        pass


def log_alert(alert_type: str, message: str, data: dict | None = None) -> None:
    entry = {"ts": _utcnow(), "alert": alert_type, "message": message}
    if data:
        entry.update(data)
    _append_jsonl(ALERTS_LOG, entry)


# ── Memory bank ───────────────────────────────────────────────────
def record_decision(decision_type: str, reasoning: str, data: dict | None = None) -> None:
    entry = {"ts": _utcnow(), "type": decision_type, "reasoning": reasoning}
    if data:
        entry.update(data)
    _append_jsonl(DECISIONS_LOG, entry)


def record_research(topic: str, findings: str, data: dict | None = None) -> None:
    entry = {"ts": _utcnow(), "topic": topic, "findings": findings}
    if data:
        entry.update(data)
    _append_jsonl(RESEARCH_LOG, entry)


def read_recent_decisions(limit: int = 10) -> list[dict]:
    return _read_jsonl(DECISIONS_LOG, limit=limit)


def read_recent_research(limit: int = 10) -> list[dict]:
    return _read_jsonl(RESEARCH_LOG, limit=limit)


def read_strategy() -> str:
    if STRATEGY_FILE.exists():
        try:
            return STRATEGY_FILE.read_text(encoding="utf-8")
        except Exception:
            return ""
    return ""


def write_strategy(content: str) -> None:
    STRATEGY_FILE.parent.mkdir(parents=True, exist_ok=True)
    STRATEGY_FILE.write_text(content, encoding="utf-8")


# ── Portfolio ─────────────────────────────────────────────────────
def compute_portfolio_snapshot() -> dict:
    """Aggregate all balances + positions into a portfolio snapshot."""
    sol_bal = get_solana_balance()
    sol_price = get_sol_price()
    base_bal = get_base_balance()
    eth_price = get_eth_price()
    tokens = get_solana_token_accounts()

    holdings = []
    total_value = 0.0

    if sol_bal is not None and sol_price is not None:
        val = sol_bal * sol_price
        total_value += val
        holdings.append({
            "chain": "solana", "symbol": "SOL", "mint": SOL_MINT,
            "amount": sol_bal, "price_usd": sol_price, "value_usd": val,
        })

    if base_bal is not None and eth_price is not None:
        val = base_bal * eth_price
        total_value += val
        holdings.append({
            "chain": "base", "symbol": "ETH", "mint": "native",
            "amount": base_bal, "price_usd": eth_price, "value_usd": val,
        })

    for tok in tokens:
        price = get_token_price(tok["mint"])
        if price is not None:
            val = tok["amount"] * price
            total_value += val
            holdings.append({
                "chain": "solana", "symbol": tok["mint"][:8], "mint": tok["mint"],
                "amount": tok["amount"], "price_usd": price, "value_usd": val,
            })

    snapshot = {
        "ts": _utcnow(),
        "total_value_usd": round(total_value, 2),
        "holdings": holdings,
        "sol_balance": sol_bal,
        "sol_price": sol_price,
        "base_balance": base_bal,
        "eth_price": eth_price,
        "policy": get_policy_status(),
    }
    _write_json(PORTFOLIO_FILE, snapshot)
    _append_jsonl(PORTFOLIO_HISTORY, {
        "ts": snapshot["ts"],
        "total_value_usd": snapshot["total_value_usd"],
        "sol_balance": sol_bal,
        "sol_price": sol_price,
        "base_balance": base_bal,
        "eth_price": eth_price,
        "holdings_count": len(holdings),
    })
    return snapshot


def get_cached_portfolio() -> dict:
    """Read last saved portfolio snapshot."""
    return _read_json(PORTFOLIO_FILE, {})


def get_portfolio_history(limit: int = 168) -> list[dict]:
    """Read portfolio history (default: ~1 week of hourly snapshots)."""
    return _read_jsonl(PORTFOLIO_HISTORY, limit=limit)


def get_portfolio_24h_change() -> dict:
    """Compute 24h portfolio value change from history."""
    history = _read_jsonl(PORTFOLIO_HISTORY, limit=200)
    if not history:
        return {"change_usd": 0, "change_pct": 0, "value_24h_ago": 0, "current": 0}

    current = history[-1].get("total_value_usd", 0)
    now_ts = datetime.now(timezone.utc)
    target = now_ts - __import__("datetime").timedelta(hours=24)
    best = history[0]
    best_delta = abs(_parse_ts(best.get("ts", "")) - target)
    for entry in history:
        entry_ts = _parse_ts(entry.get("ts", ""))
        delta = abs(entry_ts - target)
        if delta < best_delta:
            best = entry
            best_delta = delta

    value_24h_ago = best.get("total_value_usd", 0)
    change = current - value_24h_ago
    pct = (change / value_24h_ago * 100) if value_24h_ago > 0 else 0

    return {
        "change_usd": round(change, 2),
        "change_pct": round(pct, 2),
        "value_24h_ago": value_24h_ago,
        "current": current,
    }


def _parse_ts(ts_str: str) -> datetime:
    try:
        s = ts_str.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


# ── Transaction log ───────────────────────────────────────────────
def get_financial_events(limit: int = 50) -> list[dict]:
    return _read_jsonl(EVENTS_LOG, limit=limit)


def get_transactions(limit: int = 20) -> list[dict]:
    """Filter financial events to trade-related entries."""
    events = _read_jsonl(EVENTS_LOG, limit=200)
    trade_types = {"trade", "swap", "transfer", "bet", "deposit", "withdrawal"}
    trades = [e for e in events if e.get("event", "") in trade_types]
    return trades[-limit:]


# ── Jupiter swap integration ──────────────────────────────────────
JUPITER_SWAP_URL = "https://api.jup.ag/swap/v1"


def _jupiter_headers() -> dict:
    headers: dict[str, str] = {}
    if JUPITER_API_KEY:
        headers["x-api-key"] = JUPITER_API_KEY
    return headers


def jupiter_get_quote(
    input_mint: str,
    output_mint: str,
    amount: int,
    slippage_bps: int = 50,
) -> dict | None:
    """Get a swap quote from Jupiter. Amount is in smallest unit (lamports/etc)."""
    params = {
        "inputMint": input_mint,
        "outputMint": output_mint,
        "amount": str(amount),
        "slippageBps": slippage_bps,
        "dynamicSlippage": "false",
    }
    try:
        import requests
        resp = requests.get(
            f"{JUPITER_SWAP_URL}/quote",
            params=params,
            headers=_jupiter_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def jupiter_get_swap_tx(quote: dict, user_pubkey: str) -> str | None:
    """Build a swap transaction from a Jupiter quote. Returns base64-encoded tx."""
    payload = {"quoteResponse": quote, "userPublicKey": user_pubkey}
    try:
        import requests
        resp = requests.post(
            f"{JUPITER_SWAP_URL}/swap",
            json=payload,
            headers=_jupiter_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        data = None
    if data:
        return data.get("swapTransaction")
    return None


def jupiter_swap(
    input_mint: str,
    output_mint: str,
    amount: int,
    slippage_bps: int = 50,
    dry_run: bool = True,
) -> dict:
    """Full Jupiter swap flow with policy gate.

    Args:
        input_mint: Token mint to sell
        output_mint: Token mint to buy
        amount: Amount in smallest unit (lamports for SOL)
        slippage_bps: Slippage tolerance in basis points
        dry_run: If True, only quote + policy check, don't execute

    Returns dict with quote, policy check result, and optionally tx hash.
    """
    result: dict[str, Any] = {"status": "error", "dry_run": dry_run}

    quote = jupiter_get_quote(input_mint, output_mint, amount, slippage_bps)
    if not quote:
        result["error"] = "Failed to get Jupiter quote"
        return result

    try:
        in_amount = int(quote.get("inAmount", 0))
        sol_price = get_sol_price() or 0
        if input_mint == SOL_MINT:
            value_usd = (in_amount / 1_000_000_000) * sol_price
        else:
            value_usd = 0
    except (ValueError, TypeError):
        value_usd = 0

    result["quote"] = {
        "input_mint": input_mint,
        "output_mint": output_mint,
        "in_amount": str(quote.get("inAmount", "")),
        "out_amount": str(quote.get("outAmount", "")),
        "price_impact_pct": quote.get("priceImpactPct", "?"),
        "estimated_value_usd": round(value_usd, 2),
    }

    allowed, policy_msg = check_policy("solana", value_usd, to="jupiter_swap", commit=False)
    result["policy"] = {"allowed": allowed, "message": policy_msg}
    if not allowed:
        result["status"] = "policy_denied"
        log_financial_event("swap_denied", {"reason": policy_msg, **result["quote"]})
        return result

    if dry_run:
        result["status"] = "quote_ready"
        return result

    address = get_solana_address()
    if not address:
        result["error"] = "No Solana wallet address"
        result["status"] = "error"
        return result

    swap_tx = jupiter_get_swap_tx(quote, address)
    if not swap_tx:
        result["error"] = "Failed to build swap transaction"
        result["status"] = "error"
        return result

    check_policy("solana", value_usd, to="jupiter_swap", commit=True)

    result["swap_transaction_b64"] = swap_tx
    result["status"] = "tx_ready"
    log_financial_event("swap", {
        "chain": "solana",
        "value_usd": value_usd,
        "input_mint": input_mint,
        "output_mint": output_mint,
        "in_amount": str(quote.get("inAmount", "")),
        "out_amount": str(quote.get("outAmount", "")),
    })
    record_decision("swap_executed", f"Jupiter swap {input_mint[:8]}->{output_mint[:8]}, ~${value_usd:.2f}", result["quote"])

    return result


# ── Polymarket integration ────────────────────────────────────────
POLYMARKET_API = "https://gamma-api.polymarket.com"


def polymarket_get_markets(limit: int = 10, active: bool = True) -> list[dict]:
    """Fetch trending/active markets from Polymarket."""
    params = {"limit": limit, "active": str(active).lower(), "order": "volume24hr", "ascending": "false"}
    data = _http_get_json(f"{POLYMARKET_API}/markets", params=params, timeout=15)
    if not data:
        return []
    markets = []
    for m in (data if isinstance(data, list) else []):
        markets.append({
            "id": m.get("id", ""),
            "question": m.get("question", ""),
            "volume_24h": m.get("volume24hr", 0),
            "liquidity": m.get("liquidity", 0),
            "end_date": m.get("endDate", ""),
            "outcomes": m.get("outcomes", []),
            "outcome_prices": m.get("outcomePrices", []),
        })
    return markets


def polymarket_get_market(market_id: str) -> dict | None:
    return _http_get_json(f"{POLYMARKET_API}/markets/{market_id}", timeout=15)


def polymarket_search(query: str, limit: int = 5) -> list[dict]:
    params = {"limit": limit, "query": query, "active": "true"}
    data = _http_get_json(f"{POLYMARKET_API}/markets", params=params, timeout=15)
    if not data or not isinstance(data, list):
        return []
    return [{
        "id": m.get("id", ""),
        "question": m.get("question", ""),
        "volume_24h": m.get("volume24hr", 0),
        "outcome_prices": m.get("outcomePrices", []),
    } for m in data]


# ── Rolling context (for session persistence) ─────────────────────
def update_rolling_context() -> str:
    """Regenerate memory/context.md from latest state."""
    portfolio = get_cached_portfolio()
    strategy = read_strategy()
    decisions = read_recent_decisions(3)
    policy = get_policy_status()

    lines = [
        "# Financial Context (auto-generated)",
        f"_Updated: {_utcnow()}_",
        "",
        "## Portfolio Summary",
    ]

    total = portfolio.get("total_value_usd", 0)
    lines.append(f"- Total Value: ${total:.2f}")
    sol_bal = portfolio.get("sol_balance")
    sol_price = portfolio.get("sol_price")
    if sol_bal is not None:
        lines.append(f"- SOL: {sol_bal:.4f} (${sol_price:.2f}/SOL)" if sol_price else f"- SOL: {sol_bal:.4f}")
    base_bal = portfolio.get("base_balance")
    if base_bal is not None:
        lines.append(f"- Base ETH: {base_bal:.6f}")
    holdings = portfolio.get("holdings", [])
    if len(holdings) > 2:
        lines.append(f"- Additional tokens: {len(holdings) - 2}")

    lines += [
        "",
        "## Active Strategy",
        strategy.strip() if strategy.strip() else "_No strategy defined yet._",
        "",
        "## Recent Decisions",
    ]
    if decisions:
        for d in decisions:
            ts = d.get("ts", "?")[:16]
            dtype = d.get("type", "?")
            reasoning = d.get("reasoning", "")[:100]
            lines.append(f"- [{ts}] **{dtype}**: {reasoning}")
    else:
        lines.append("_No decisions recorded yet._")

    lines += [
        "",
        "## Policy Status",
        f"- Mode: {policy.get('mode', '?')}",
        f"- Daily spent: ${policy.get('daily_spent_usd', 0):.2f} / ${policy.get('max_daily_usd', 0):.2f}",
        f"- Transactions today: {policy.get('daily_tx_count', 0)} / {policy.get('max_daily_txs', 0)}",
        f"- Cooldown remaining: {policy.get('cooldown_remaining', 0)}s",
    ]

    alerts = _read_jsonl(ALERTS_LOG, limit=5)
    if alerts:
        lines += ["", "## Recent Alerts"]
        for a in alerts[-3:]:
            lines.append(f"- [{a.get('ts', '?')[:16]}] {a.get('message', '')[:120]}")

    tg_inbox = read_telegram_inbox(limit=5)
    tg_outbox = _read_jsonl(TELEGRAM_MESSAGES_OUT, limit=5)
    if tg_inbox or tg_outbox:
        lines += ["", "## Operator Comms (Telegram)"]
        lines.append("_Reply via `send_telegram('your message')` from core.finance_")
        combined = []
        for m in tg_inbox:
            combined.append(("operator", m.get("ts", ""), m.get("message", "")))
        for m in tg_outbox:
            combined.append(("agent", m.get("ts", ""), m.get("message", "")))
        combined.sort(key=lambda x: x[1])
        for who, ts, msg in combined[-8:]:
            prefix = "Operator" if who == "operator" else "Agent"
            lines.append(f"- [{ts[:16]}] {prefix}: {msg[:150]}")

    content = "\n".join(lines) + "\n"
    CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONTEXT_FILE.write_text(content, encoding="utf-8")
    return content
