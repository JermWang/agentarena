"""Northstar Agent Dashboard — Financial Command Center.

A glassmorphic Streamlit dashboard for autonomous AI agent financial operations.
Features: command center, smart alerts, position cards, terminal log, performance
charts, prediction markets, memory bank, and Telegram comms.

Run: streamlit run dashboard/app.py --server.port 8787
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import html as _html

import streamlit as st

# Add parent directory to path so we can import core.finance
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import finance as fin

PST = ZoneInfo("America/Los_Angeles")

st.set_page_config(
    page_title="Northstar Dashboard",
    layout="wide",
    page_icon=":star:",
    initial_sidebar_state="auto",
)


def _set_flash(kind: str, msg: str) -> None:
    st.session_state["_flash"] = {"kind": kind, "msg": msg}


def _render_flash() -> None:
    flash = st.session_state.pop("_flash", None)
    if not flash:
        return
    kind = flash.get("kind", "info")
    msg = flash.get("msg", "")
    {"success": st.success, "warning": st.warning, "error": st.error}.get(kind, st.info)(msg)


# ── Global CSS ───────────────────────────────────────────────────
st.markdown(
    """
    <style>
    :root {
        --bg: #050705;
        --bg-gradient-a: #0a140a;
        --bg-gradient-b: #050705;
        --bg-gradient-c: #030403;
        --panel: rgba(7, 12, 7, 0.75);
        --panel-hover: rgba(12, 22, 12, 0.88);
        --panel-solid: #0a150a;
        --accent: #39ff14;
        --accent-bright: #5cff3e;
        --accent-soft: rgba(57, 255, 20, 0.14);
        --accent-border: rgba(57, 255, 20, 0.22);
        --accent-glow: rgba(57, 255, 20, 0.30);
        --text: #eaffea;
        --text-heading: #f0fff0;
        --muted: #9ddc9d;
        --danger: #ff5c5c;
        --danger-soft: rgba(255, 92, 92, 0.12);
        --warn: #ffb347;
        --warn-soft: rgba(255, 179, 71, 0.12);
        --success: #39ff14;
        --success-soft: rgba(57, 255, 20, 0.12);
        --radius: 10px;
        --radius-lg: 14px;
        --shadow-sm: 0 2px 8px rgba(0,0,0,0.22);
        --shadow-md: 0 4px 20px rgba(0,0,0,0.32);
        --shadow-lg: 0 8px 32px rgba(0,0,0,0.42);
        --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
    .stApp {
        background: linear-gradient(145deg, var(--bg-gradient-a) 0%, var(--bg-gradient-b) 50%, var(--bg-gradient-c) 100%);
        color: var(--text); font-family: var(--font);
    }
    h1, h2, h3, h4 { color: var(--text-heading); }
    .stMarkdown, .stCaption, .stText, .stTextArea textarea { color: var(--text); }
    .block-container { padding-top: 3.5rem; }
    header[data-testid="stHeader"] { background: var(--bg) !important; }
    .stDeployButton, [data-testid="stToolbar"] { display: none !important; }

    .stButton>button {
        background: var(--accent-soft); border: 1px solid var(--accent-border);
        color: var(--accent-bright); border-radius: var(--radius);
        font-weight: 600; font-size: 0.82rem; box-shadow: var(--shadow-sm);
        transition: background 180ms ease, border-color 180ms ease;
    }
    .stButton>button:hover {
        background: rgba(57, 255, 20, 0.22); border-color: var(--accent);
    }
    div[data-baseweb="select"] > div {
        background: var(--panel) !important; border-color: var(--accent-border) !important;
    }

    .glass-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin:12px 0 20px;}
    .glass-card {
        padding:18px 20px; border-radius:var(--radius-lg);
        background:var(--panel); border:1px solid rgba(57,255,20,0.15);
        backdrop-filter: blur(12px);
    }
    .glass-title{font-weight:600;font-size:0.95rem;margin-bottom:6px;color:var(--accent-bright);}
    .glass-meta{opacity:0.8;font-size:0.8rem;color:var(--muted);line-height:1.5;}

    .section-header{font-size:1.1rem;font-weight:700;color:var(--accent-bright);margin:24px 0 10px;padding:0 0 8px;border-bottom:1px solid var(--accent-border);letter-spacing:0.02em;}

    [data-testid="stMetricValue"]{color:var(--accent-bright)!important;font-weight:700;font-size:1.4rem!important;}
    [data-testid="stMetricLabel"]{color:var(--muted)!important;font-size:0.78rem!important;text-transform:uppercase;letter-spacing:0.06em;}

    details[data-testid="stExpander"]{border:1px solid var(--accent-border)!important;border-radius:var(--radius)!important;background:var(--panel)!important;}
    details[data-testid="stExpander"] summary{color:var(--text)!important;font-weight:500;}
    hr{border:none!important;border-top:1px solid var(--accent-border)!important;margin:20px 0!important;}

    section[data-testid="stSidebar"]{background:rgba(5,8,5,0.95)!important;border-right:1px solid var(--accent-border);}
    section[data-testid="stSidebar"]>div:first-child{padding-top:1rem;}

    .stTextArea textarea,.stTextInput input{background:rgba(7,12,7,0.65)!important;border-color:var(--accent-border)!important;color:var(--text)!important;border-radius:8px!important;}
    .stTextArea textarea:focus,.stTextInput input:focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(57,255,20,0.12)!important;}

    .empty-state{text-align:center;padding:48px 24px;color:var(--muted);opacity:0.65;}
    .empty-state .empty-icon{font-size:2.5rem;margin-bottom:10px;}
    .empty-state .empty-text{font-size:0.9rem;}
    .dashboard-footer{text-align:center;padding:20px 0 8px;font-size:0.7rem;color:var(--muted);opacity:0.4;border-top:1px solid var(--accent-border);margin-top:40px;}

    .kv-grid{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:0.82rem;margin:6px 0 10px;}
    .kv-grid .kv-key{color:var(--muted);white-space:nowrap;}
    .kv-grid .kv-val{color:var(--text);font-weight:600;}
    .kv-grid .kv-val.ok{color:var(--success);}
    .kv-grid .kv-val.warn{color:var(--warn);}
    .kv-grid .kv-val.error{color:var(--danger);}

    /* ── Command Center ───────────────────────────── */
    .cmd-center{
        padding:16px 20px;margin:0 0 20px;border-radius:var(--radius-lg);
        background:linear-gradient(135deg,rgba(7,12,7,0.8) 0%,rgba(10,20,10,0.65) 100%);
        border:1px solid var(--accent-border);backdrop-filter:blur(14px);
        box-shadow:0 0 20px rgba(57,255,20,0.06);
    }
    .cmd-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
    .cmd-status{display:flex;align-items:center;gap:10px;min-width:200px;}
    .cmd-status .pulse-dot{
        width:12px;height:12px;border-radius:50%;flex-shrink:0;
        animation:pulse 1.8s ease-in-out infinite;
    }
    .cmd-status .pulse-dot.live{background:var(--success);box-shadow:0 0 14px rgba(57,255,20,0.5);}
    .cmd-status .pulse-dot.idle{background:var(--warn);box-shadow:0 0 10px rgba(255,179,71,0.35);}
    .cmd-status .pulse-dot.error{background:var(--danger);box-shadow:0 0 10px rgba(255,92,92,0.35);}
    .cmd-status .status-label{font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;}
    .cmd-status .status-label.live{color:var(--success);}
    .cmd-status .status-label.idle{color:var(--warn);}
    .cmd-status .status-label.error{color:var(--danger);}
    .cmd-metrics{display:flex;gap:20px;flex:1;flex-wrap:wrap;justify-content:flex-end;}
    .cmd-metric{text-align:center;min-width:90px;}
    .cmd-metric .val{font-size:1.15rem;font-weight:800;color:var(--accent-bright);line-height:1.2;font-family:'SF Mono',Monaco,Consolas,monospace;}
    .cmd-metric .val.up{color:var(--success);}
    .cmd-metric .val.down{color:var(--danger);}
    .cmd-metric .lbl{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;opacity:0.7;}
    .cmd-divider{width:1px;height:32px;background:var(--accent-border);flex-shrink:0;}
    @keyframes pulse {
        0%{transform:scale(0.85);opacity:0.5;}
        50%{transform:scale(1.15);opacity:1;}
        100%{transform:scale(0.85);opacity:0.5;}
    }

    /* ── Alert Cards ──────────────────────────────── */
    .alert-card{
        display:flex;align-items:flex-start;gap:12px;padding:12px 16px;
        border-radius:var(--radius);margin:6px 0;
        transition:opacity 0.2s ease;
    }
    .alert-card.critical{background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.25);}
    .alert-card.warning{background:rgba(255,179,71,0.08);border:1px solid rgba(255,179,71,0.25);}
    .alert-card.info{background:rgba(57,255,20,0.05);border:1px solid rgba(57,255,20,0.15);}
    .alert-icon{font-size:1.1rem;flex-shrink:0;margin-top:1px;}
    .alert-body{flex:1;min-width:0;}
    .alert-title{font-size:0.82rem;font-weight:700;line-height:1.3;}
    .alert-card.critical .alert-title{color:var(--danger);}
    .alert-card.warning .alert-title{color:var(--warn);}
    .alert-card.info .alert-title{color:var(--success);}
    .alert-detail{font-size:0.75rem;color:var(--muted);margin-top:2px;line-height:1.4;}
    .alert-ts{font-size:0.65rem;color:var(--muted);opacity:0.5;margin-top:4px;}

    /* ── Terminal Log ─────────────────────────────── */
    .term-log{
        font-family:'SF Mono',Monaco,Consolas,'Courier New',monospace;
        font-size:0.75rem;line-height:1.65;
        background:rgba(2,4,2,0.9);border:1px solid var(--accent-border);
        border-radius:var(--radius);padding:12px 14px;
        max-height:400px;overflow-y:auto;
        scrollbar-width:thin;scrollbar-color:var(--accent-border) transparent;
    }
    .term-log::-webkit-scrollbar{width:6px;}
    .term-log::-webkit-scrollbar-thumb{background:var(--accent-border);border-radius:3px;}
    .term-line{display:flex;gap:8px;padding:2px 0;border-bottom:1px solid rgba(57,255,20,0.04);}
    .term-line:hover{background:rgba(57,255,20,0.04);}
    .term-ln{color:var(--muted);opacity:0.35;min-width:28px;text-align:right;user-select:none;}
    .term-ts{color:var(--muted);opacity:0.5;min-width:120px;}
    .term-lvl{min-width:48px;font-weight:700;text-transform:uppercase;}
    .term-lvl.trade{color:var(--success);}
    .term-lvl.swap{color:#0af;}
    .term-lvl.bet{color:#c084fc;}
    .term-lvl.alert{color:var(--warn);}
    .term-lvl.error{color:var(--danger);}
    .term-lvl.info{color:var(--muted);}
    .term-lvl.decision{color:#f0abfc;}
    .term-lvl.research{color:#67e8f9;}
    .term-msg{color:var(--text);flex:1;word-break:break-word;}

    /* ── Position Card ─────────────────────────────── */
    .pos-card{
        padding:16px 18px;border-radius:var(--radius-lg);
        background:var(--panel);border:1px solid rgba(57,255,20,0.15);
        backdrop-filter:blur(12px);transition:border-color 0.2s ease;
    }
    .pos-card:hover{border-color:var(--accent);}
    .pos-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;}
    .pos-sym{font-weight:800;font-size:1.05rem;color:var(--accent-bright);font-family:'SF Mono',Monaco,Consolas,monospace;}
    .pos-chain{font-size:0.68rem;color:var(--muted);opacity:0.6;text-transform:uppercase;letter-spacing:0.06em;}
    .pos-metrics{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:0.78rem;margin-top:6px;}
    .pos-metrics .pm-label{color:var(--muted);}
    .pos-metrics .pm-val{font-weight:700;color:var(--text);text-align:right;font-family:'SF Mono',Monaco,Consolas,monospace;}
    .pos-metrics .pm-val.up{color:var(--success);}
    .pos-metrics .pm-val.down{color:var(--danger);}
    .pos-pnl{margin-top:8px;padding-top:8px;border-top:1px solid rgba(57,255,20,0.1);text-align:center;}
    .pos-pnl .pnl-val{font-size:1.1rem;font-weight:800;font-family:'SF Mono',Monaco,Consolas,monospace;}
    .pos-pnl .pnl-val.up{color:var(--success);}
    .pos-pnl .pnl-val.down{color:var(--danger);}
    .pos-pnl .pnl-label{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;}
    </style>
    """,
    unsafe_allow_html=True,
)
_render_flash()

# ── Sidebar ──────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### Northstar")
    st.caption("Agent Financial Infrastructure")

    # Quick wallet summary
    try:
        _sb_pf = fin.get_cached_portfolio()
        _sb_total = _sb_pf.get("total_value_usd", 0)
        _sb_sol = _sb_pf.get("sol_balance")
        _sb_mode = _sb_pf.get("policy", {}).get("mode", "?")
        st.markdown(f"**Portfolio:** ${_sb_total:.2f}")
        if _sb_sol is not None:
            st.markdown(f"**SOL:** {_sb_sol:.4f}")
        st.markdown(f"**Mode:** {_sb_mode}")
    except Exception:
        st.caption("No portfolio data yet.")

    st.markdown("---")
    if st.button("Refresh Data", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    _auto_refresh = st.checkbox("Auto-refresh (30s)", key="auto_refresh")

# ── Header ───────────────────────────────────────────────────────
st.markdown(
    f'<div style="font-size:0.78rem;color:var(--muted);text-align:right;opacity:0.6;">'
    f'Updated {datetime.now(PST).strftime("%H:%M PST")}</div>',
    unsafe_allow_html=True,
)

# ── Fetch data (cached) ─────────────────────────────────────────
@st.cache_data(ttl=30)
def _fetch_portfolio():
    try:
        return fin.compute_portfolio_snapshot()
    except Exception:
        return fin.get_cached_portfolio() or {}

_pf = _fetch_portfolio()
_pf_total = _pf.get("total_value_usd", 0)
_pf_holdings = _pf.get("holdings", [])
_pf_policy = _pf.get("policy", {})
try:
    _pf_change = fin.get_portfolio_24h_change()
except Exception:
    _pf_change = {"change_usd": 0, "change_pct": 0}

# ── 1. COMMAND CENTER ────────────────────────────────────────────
_agent_status = "live"
_agent_label = "OPERATIONAL"
_pol_mode = _pf_policy.get("mode", "?")
if _pol_mode not in ("LIVE", "DRY_RUN"):
    _agent_status = "error"
    _agent_label = "OFFLINE"
elif _pf_policy.get("daily_remaining_usd", 999) <= 0:
    _agent_status = "idle"
    _agent_label = "LIMIT REACHED"

_pf_pct = _pf_change.get("change_pct", 0)
_pf_delta = _pf_change.get("change_usd", 0)
_pf_delta_cls = "up" if _pf_delta >= 0 else "down"
_daily_spent = _pf_policy.get("daily_spent_usd", 0)
_daily_max = _pf_policy.get("max_daily_usd", 25)
_daily_pct = (_daily_spent / _daily_max * 100) if _daily_max > 0 else 0
_tx_count = _pf_policy.get("daily_tx_count", 0)
_tx_max = _pf_policy.get("max_daily_txs", 5)

try:
    _all_events = fin.get_financial_events(limit=200)
except Exception:
    _all_events = []
_trade_count = sum(1 for e in _all_events if e.get("event") in ("trade", "swap", "bet"))

st.markdown(f'''<div class="cmd-center">
    <div class="cmd-row">
        <div class="cmd-status">
            <div class="pulse-dot {_agent_status}"></div>
            <span class="status-label {_agent_status}">{_agent_label}</span>
        </div>
        <div class="cmd-divider"></div>
        <div class="cmd-metrics">
            <div class="cmd-metric">
                <div class="val">${_pf_total:.2f}</div>
                <div class="lbl">Portfolio</div>
            </div>
            <div class="cmd-metric">
                <div class="val {_pf_delta_cls}">{_pf_pct:+.1f}%</div>
                <div class="lbl">24h Change</div>
            </div>
            <div class="cmd-metric">
                <div class="val">{len(_pf_holdings)}</div>
                <div class="lbl">Assets</div>
            </div>
            <div class="cmd-metric">
                <div class="val">{_tx_count}/{_tx_max}</div>
                <div class="lbl">Tx Today</div>
            </div>
            <div class="cmd-metric">
                <div class="val">{_daily_pct:.0f}%</div>
                <div class="lbl">Budget Used</div>
            </div>
            <div class="cmd-metric">
                <div class="val">{_trade_count}</div>
                <div class="lbl">All Trades</div>
            </div>
        </div>
    </div>
</div>''', unsafe_allow_html=True)

# ── 2. ALERTS & NOTIFICATIONS ────────────────────────────────────
_alerts: list[dict] = []
_sol_bal = _pf.get("sol_balance")
if _sol_bal is not None and _sol_bal < 0.01:
    _alerts.append({"level": "critical", "icon": "\U0001f6a8", "title": "SOL balance critically low", "detail": f"Only {_sol_bal:.4f} SOL remaining. Fund wallet to continue operations.", "ts": ""})
elif _sol_bal is not None and _sol_bal < 0.05:
    _alerts.append({"level": "warning", "icon": "\u26a0\ufe0f", "title": "SOL balance running low", "detail": f"{_sol_bal:.4f} SOL remaining. Consider adding funds soon.", "ts": ""})
if _daily_pct >= 100:
    _alerts.append({"level": "critical", "icon": "\U0001f6d1", "title": "Daily budget exhausted", "detail": f"${_daily_spent:.2f} / ${_daily_max:.2f} spent. No more transactions until reset.", "ts": ""})
elif _daily_pct >= 80:
    _alerts.append({"level": "warning", "icon": "\U0001f4b8", "title": "Approaching daily limit", "detail": f"${_daily_spent:.2f} / ${_daily_max:.2f} ({_daily_pct:.0f}%) of daily budget used.", "ts": ""})
if _pol_mode not in ("LIVE", "DRY_RUN"):
    _alerts.append({"level": "critical", "icon": "\u2699\ufe0f", "title": "Policy mode unknown", "detail": f"Mode is '{_pol_mode}'. Check policy.yaml configuration.", "ts": ""})
try:
    _recent_alerts = fin._read_jsonl(fin.ALERTS_LOG, limit=5)
    for _ra in _recent_alerts[-3:]:
        _alerts.append({"level": "info", "icon": "\U0001f4e1", "title": _ra.get("alert", "Alert"), "detail": _ra.get("message", "")[:200], "ts": _ra.get("ts", "")[:16]})
except Exception:
    pass
try:
    _tg_inbox = fin.read_telegram_inbox(limit=5)
    _tg_outbox_count = len(fin._read_jsonl(fin.TELEGRAM_MESSAGES_OUT, limit=100))
    _tg_inbox_count = len(fin._read_jsonl(fin.TELEGRAM_MESSAGES_IN, limit=100))
    _unread = _tg_inbox_count - _tg_outbox_count
    if _unread > 0:
        _alerts.append({"level": "info", "icon": "\U0001f4ac", "title": f"{_unread} new Telegram message{'s' if _unread > 1 else ''}", "detail": f"Latest: {_tg_inbox[-1].get('message', '')[:80]}..." if _tg_inbox else "", "ts": _tg_inbox[-1].get("ts", "")[:16] if _tg_inbox else ""})
except Exception:
    pass

if _alerts:
    st.markdown(f'<div class="section-header">Alerts ({len(_alerts)})</div>', unsafe_allow_html=True)
    for _al in _alerts:
        _al_ts_html = f'<div class="alert-ts">{_html.escape(_al["ts"])}</div>' if _al.get("ts") else ""
        st.markdown(f'<div class="alert-card {_al["level"]}"><div class="alert-icon">{_al["icon"]}</div><div class="alert-body"><div class="alert-title">{_html.escape(_al["title"])}</div><div class="alert-detail">{_html.escape(_al["detail"])}</div>{_al_ts_html}</div></div>', unsafe_allow_html=True)

# ── 3. WALLET BALANCES ───────────────────────────────────────────
st.markdown('<div class="section-header">Wallet Balances</div>', unsafe_allow_html=True)
w1, w2 = st.columns(2)
with w1:
    _sol_addr = fin.get_solana_address()
    _sol_price = _pf.get("sol_price")
    _sol_val = (_sol_bal or 0) * (_sol_price or 0)
    _addr_display = (_sol_addr[:12] + '...' + _sol_addr[-6:]) if len(_sol_addr or "") > 18 else (_sol_addr or "\u2014")
    st.markdown(f"""<div class="pos-card">
        <div class="pos-header">
            <span class="pos-sym">\u25ce SOL</span>
            <span class="pos-chain">SOLANA</span>
        </div>
        <div class="pos-metrics">
            <span class="pm-label">Address</span><span class="pm-val" style="font-size:0.68rem;word-break:break-all;">{_html.escape(_addr_display)}</span>
            <span class="pm-label">Balance</span><span class="pm-val up">{f'{_sol_bal:.4f}' if _sol_bal is not None else '\u2014'}</span>
            <span class="pm-label">Price</span><span class="pm-val">{f'${_sol_price:.2f}' if _sol_price else '\u2014'}</span>
        </div>
        <div class="pos-pnl">
            <div class="pnl-val up">${_sol_val:.2f}</div>
            <div class="pnl-label">Value</div>
        </div>
    </div>""", unsafe_allow_html=True)
with w2:
    _base_addr = fin.get_base_address()
    _base_bal = _pf.get("base_balance")
    _eth_price = _pf.get("eth_price")
    _base_val = (_base_bal or 0) * (_eth_price or 0)
    _base_addr_display = (_base_addr[:12] + '...' + _base_addr[-6:]) if len(_base_addr or "") > 18 else (_base_addr or "\u2014")
    st.markdown(f"""<div class="pos-card">
        <div class="pos-header">
            <span class="pos-sym">\u2b21 ETH</span>
            <span class="pos-chain">BASE</span>
        </div>
        <div class="pos-metrics">
            <span class="pm-label">Address</span><span class="pm-val" style="font-size:0.68rem;word-break:break-all;">{_html.escape(_base_addr_display)}</span>
            <span class="pm-label">Balance</span><span class="pm-val{' up' if _base_bal else ''}">{f'{_base_bal:.6f}' if _base_bal is not None else '\u2014'}</span>
            <span class="pm-label">Price</span><span class="pm-val">{f'${_eth_price:.2f}' if _eth_price else '\u2014'}</span>
        </div>
        <div class="pos-pnl">
            <div class="pnl-val{' up' if _base_val > 0 else ''}">${_base_val:.2f}</div>
            <div class="pnl-label">Value</div>
        </div>
    </div>""", unsafe_allow_html=True)

# ── 4. POSITION CARDS ────────────────────────────────────────────
if _pf_holdings:
    st.markdown(f'<div class="section-header">Holdings ({len(_pf_holdings)})</div>', unsafe_allow_html=True)
    _pos_cols = st.columns(min(len(_pf_holdings), 3))
    for _idx, _h in enumerate(_pf_holdings):
        with _pos_cols[_idx % min(len(_pf_holdings), 3)]:
            _h_sym = _html.escape(str(_h.get("symbol", "?")))
            _h_chain = _html.escape(str(_h.get("chain", "?")))
            _h_amt = _h.get("amount", 0)
            _h_price = _h.get("price_usd", 0)
            _h_val = _h.get("value_usd", 0)
            _h_pct = (_h_val / _pf_total * 100) if _pf_total > 0 else 0
            _h_pct_cls = "up" if _h_pct > 0 else ""
            st.markdown(f"""<div class="pos-card">
                <div class="pos-header">
                    <span class="pos-sym">{_h_sym}</span>
                    <span class="pos-chain">{_h_chain}</span>
                </div>
                <div class="pos-metrics">
                    <span class="pm-label">Amount</span><span class="pm-val">{_h_amt:.4f}</span>
                    <span class="pm-label">Price</span><span class="pm-val">${_h_price:.4f}</span>
                    <span class="pm-label">Weight</span><span class="pm-val {_h_pct_cls}">{_h_pct:.1f}%</span>
                </div>
                <div class="pos-pnl">
                    <div class="pnl-val up">${_h_val:.2f}</div>
                    <div class="pnl-label">Value</div>
                </div>
            </div>""", unsafe_allow_html=True)
            try:
                _hist = fin.get_portfolio_history(limit=24)
                if len(_hist) >= 2:
                    import plotly.graph_objects as go
                    _prices = [h.get("total_value_usd", 0) for h in _hist]
                    _spark_color = "#39ff14" if _prices[-1] >= _prices[0] else "#ff5c5c"
                    fig = go.Figure(go.Scatter(
                        y=_prices, mode='lines',
                        line=dict(color=_spark_color, width=2),
                        fill='tozeroy',
                        fillcolor=f"rgba({','.join(str(int(_spark_color.lstrip('#')[i:i+2], 16)) for i in (0, 2, 4))},0.08)",
                    ))
                    fig.update_layout(
                        height=60, margin=dict(l=0, r=0, t=0, b=0),
                        paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                        xaxis=dict(visible=False), yaxis=dict(visible=False),
                        showlegend=False,
                    )
                    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
            except Exception:
                pass

# ── 5. POLICY COMPLIANCE ─────────────────────────────────────────
st.markdown('<div class="section-header">Policy Compliance</div>', unsafe_allow_html=True)
_pol_mode_cls = "ok" if _pol_mode == "LIVE" else ("warn" if _pol_mode == "DRY_RUN" else "neutral")
_budget_bar_color = "var(--success)" if _daily_pct < 60 else ("var(--warn)" if _daily_pct < 90 else "var(--danger)")
st.markdown(f"""<div class="glass-card">
    <div class="kv-grid">
        <span class="kv-key">Mode</span><span class="kv-val {_pol_mode_cls}">{_html.escape(_pol_mode)}</span>
        <span class="kv-key">Max per tx</span><span class="kv-val">${_pf_policy.get('max_tx_usd', 0):.2f}</span>
        <span class="kv-key">Tx today</span><span class="kv-val">{_tx_count} / {_tx_max}</span>
        <span class="kv-key">Cooldown</span><span class="kv-val">{_pf_policy.get('cooldown_seconds', 0)}s</span>
    </div>
    <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--muted);margin-bottom:4px;">
            <span>Daily Budget</span>
            <span>${_daily_spent:.2f} / ${_daily_max:.2f}</span>
        </div>
        <div style="height:8px;border-radius:4px;background:rgba(57,255,20,0.08);border:1px solid rgba(57,255,20,0.12);overflow:hidden;">
            <div style="height:100%;width:{min(_daily_pct, 100):.0f}%;background:{_budget_bar_color};border-radius:3px;transition:width 0.3s ease;"></div>
        </div>
    </div>
</div>""", unsafe_allow_html=True)

# ── 6. TERMINAL LOG VIEWER ───────────────────────────────────────
st.markdown('<div class="section-header">Event Log</div>', unsafe_allow_html=True)
_log_filter = st.selectbox("Filter", ["ALL", "trade", "swap", "bet", "alert", "deposit", "research", "decision"], key="log_filter_sel")
try:
    _log_events = fin.get_financial_events(limit=100)
    _log_decisions = fin.read_recent_decisions(limit=30)
    for _ld in _log_decisions:
        _ld["event"] = "decision"
        if "reasoning" in _ld:
            _ld["_msg"] = _ld["reasoning"]
    _all_log = _log_events + _log_decisions
    _all_log.sort(key=lambda x: x.get("ts", ""))
    if _log_filter != "ALL":
        _all_log = [e for e in _all_log if e.get("event") == _log_filter]
except Exception:
    _all_log = []

_log_display = _all_log[-50:]
if _log_display:
    _log_lines = []
    for _li, _le in enumerate(_log_display, 1):
        _le_ts = _html.escape(str(_le.get("ts", ""))[:19])
        _le_evt = str(_le.get("event", "info"))
        _le_cls = _le_evt if _le_evt in ("trade", "swap", "bet", "alert", "error", "decision", "research") else "info"
        _le_parts = []
        for _fk in ("note", "_msg", "chain", "symbol", "value_usd", "reasoning"):
            _fv = _le.get(_fk)
            if _fv is not None and _fk not in ("event", "ts"):
                _le_parts.append(f"{_fk}={_fv}" if _fk != "_msg" else str(_fv)[:120])
        _le_msg = _html.escape(" ".join(_le_parts)[:200]) if _le_parts else _html.escape(str({k: v for k, v in _le.items() if k not in ("ts", "event")})[:200])
        _log_lines.append(
            f'<div class="term-line">'
            f'<span class="term-ln">{_li}</span>'
            f'<span class="term-ts">{_le_ts}</span>'
            f'<span class="term-lvl {_le_cls}">{_html.escape(_le_evt)}</span>'
            f'<span class="term-msg">{_le_msg}</span>'
            f'</div>'
        )
    st.markdown(f'<div class="term-log">{"".join(_log_lines)}</div>', unsafe_allow_html=True)
else:
    st.markdown('<div class="empty-state"><div class="empty-icon">\u2588\u2588\u2588</div><div class="empty-text">No events logged yet</div></div>', unsafe_allow_html=True)

# ── 7. PERFORMANCE ───────────────────────────────────────────────
st.markdown('<div class="section-header">Performance</div>', unsafe_allow_html=True)
try:
    _pf_history = fin.get_portfolio_history(limit=168)
    if len(_pf_history) >= 2:
        import plotly.graph_objects as go
        _hist_ts = [h.get("ts", "")[:16] for h in _pf_history]
        _hist_vals = [h.get("total_value_usd", 0) for h in _pf_history]
        _perf_color = "#39ff14" if _hist_vals[-1] >= _hist_vals[0] else "#ff5c5c"
        fig = go.Figure(go.Scatter(
            x=_hist_ts, y=_hist_vals, mode='lines',
            line=dict(color=_perf_color, width=2),
            fill='tozeroy',
            fillcolor=f"rgba({','.join(str(int(_perf_color.lstrip('#')[i:i+2], 16)) for i in (0, 2, 4))},0.06)",
        ))
        fig.update_layout(
            height=220,
            margin=dict(l=0, r=0, t=10, b=20),
            paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
            xaxis=dict(showgrid=False, color='#9ddc9d', tickfont=dict(size=9)),
            yaxis=dict(showgrid=True, gridcolor='rgba(57,255,20,0.06)', color='#9ddc9d', tickfont=dict(size=10), tickprefix='$'),
            showlegend=False, hovermode='x unified',
        )
        st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
    else:
        st.markdown('<div class="empty-state"><div class="empty-icon">\U0001f4c8</div><div class="empty-text">Need 2+ snapshots for chart</div></div>', unsafe_allow_html=True)
except Exception:
    st.markdown('<div class="empty-state"><div class="empty-icon">\U0001f4c8</div><div class="empty-text">Performance data unavailable</div></div>', unsafe_allow_html=True)

try:
    _trade_events = [e for e in _all_events if e.get("event") in ("trade", "swap", "bet")]
    if _trade_events:
        import plotly.graph_objects as go
        _daily_pnl: dict[str, float] = {}
        for e in _trade_events:
            day = str(e.get("ts", ""))[:10]
            pnl = float(e.get("pnl_usd", 0))
            _daily_pnl[day] = _daily_pnl.get(day, 0) + pnl
        if _daily_pnl:
            _days = list(_daily_pnl.keys())
            _pnls = list(_daily_pnl.values())
            _bar_colors = ["#39ff14" if v >= 0 else "#ff5c5c" for v in _pnls]
            fig = go.Figure(go.Bar(x=_days, y=_pnls, marker_color=_bar_colors))
            fig.update_layout(
                height=180, margin=dict(l=0, r=0, t=10, b=20),
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                xaxis=dict(showgrid=False, color='#9ddc9d', tickfont=dict(size=9)),
                yaxis=dict(showgrid=True, gridcolor='rgba(57,255,20,0.06)', color='#9ddc9d', tickfont=dict(size=10), tickprefix='$'),
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
except Exception:
    pass

# ── 8. PREDICTION MARKETS ────────────────────────────────────────
st.markdown('<div class="section-header">Prediction Markets</div>', unsafe_allow_html=True)
try:
    _bets = [e for e in _all_events if e.get("event") == "bet"]
    if _bets:
        st.markdown('<div class="glass-grid">', unsafe_allow_html=True)
        for _bet in _bets[-6:]:
            _b_market = _html.escape(str(_bet.get("market", "?"))[:60])
            _b_side = _html.escape(str(_bet.get("side", "?")))
            _b_amount = _bet.get("amount_usd", 0)
            _b_ts = _html.escape(str(_bet.get("ts", "?"))[:16])
            st.markdown(f"""<div class="glass-card">
                <div class="glass-title">{_b_market}</div>
                <div class="glass-meta">Side: {_b_side} \u00b7 ${_b_amount:.2f} \u00b7 {_b_ts}</div>
            </div>""", unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)
except Exception:
    pass
with st.expander("Trending Markets (Polymarket)", expanded=False):
    try:
        @st.cache_data(ttl=300)
        def _fetch_polymarket():
            return fin.polymarket_get_markets(limit=8)
        _pm_markets = _fetch_polymarket()
        if _pm_markets:
            st.markdown('<div class="glass-grid">', unsafe_allow_html=True)
            for _pm in _pm_markets:
                _pm_q = _html.escape(str(_pm.get("question", "?"))[:80])
                _pm_vol = _pm.get("volume_24h", 0)
                _pm_prices = _pm.get("outcome_prices", [])
                _pm_outcomes = _pm.get("outcomes", [])
                _pm_odds = ""
                if _pm_prices and _pm_outcomes:
                    try:
                        prices = json.loads(_pm_prices) if isinstance(_pm_prices, str) else _pm_prices
                        outcomes = json.loads(_pm_outcomes) if isinstance(_pm_outcomes, str) else _pm_outcomes
                        parts = [f"{o}: {float(p)*100:.0f}%" for o, p in zip(outcomes[:2], prices[:2])]
                        _pm_odds = " \u00b7 ".join(parts)
                    except Exception:
                        _pm_odds = ""
                _pm_vol_str = f"${float(_pm_vol):,.0f}" if _pm_vol else "\u2014"
                st.markdown(f"""<div class="glass-card">
                    <div class="glass-title" style="font-size:0.85rem;">{_pm_q}</div>
                    <div class="glass-meta">{_pm_odds}</div>
                    <div class="glass-meta">24h vol: {_pm_vol_str}</div>
                </div>""", unsafe_allow_html=True)
            st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.caption("Could not fetch Polymarket data.")
    except Exception:
        st.caption("Polymarket data unavailable.")

# ── 9. MEMORY BANK ───────────────────────────────────────────────
st.markdown('<div class="section-header">Memory Bank</div>', unsafe_allow_html=True)
with st.expander("Current Strategy", expanded=False):
    _strategy = fin.read_strategy()
    if _strategy.strip():
        st.markdown(_strategy)
    else:
        st.caption("No strategy defined yet.")
with st.expander("Recent Decisions", expanded=False):
    _decisions = fin.read_recent_decisions(limit=10)
    if _decisions:
        for _d in reversed(_decisions):
            _d_ts = _html.escape(str(_d.get("ts", "?"))[:16])
            _d_type = _html.escape(str(_d.get("type", "?")))
            _d_reason = _html.escape(str(_d.get("reasoning", ""))[:200])
            st.markdown(f"**[{_d_ts}] {_d_type}** \u2014 {_d_reason}")
    else:
        st.caption("No decisions recorded yet.")
with st.expander("Rolling Context", expanded=False):
    _ctx = ""
    try:
        if fin.CONTEXT_FILE.exists():
            _ctx = fin.CONTEXT_FILE.read_text(encoding="utf-8")
    except Exception:
        pass
    if _ctx.strip():
        st.markdown(_ctx)
    else:
        st.caption("No rolling context generated yet.")
    if st.button("Regenerate Context", key="regen_ctx"):
        try:
            fin.update_rolling_context()
            _set_flash("success", "Rolling context regenerated.")
            st.rerun()
        except Exception as e:
            st.error(f"Failed: {e}")

# ── 10. TELEGRAM COMMS ───────────────────────────────────────────
st.markdown('<div class="section-header">Telegram Comms</div>', unsafe_allow_html=True)
try:
    _tg_convo = fin.read_telegram_conversation(limit=25)
except Exception:
    _tg_convo = []
if _tg_convo:
    st.markdown('<div class="glass-card" style="max-height:400px;overflow-y:auto;padding:1rem;">', unsafe_allow_html=True)
    for _tg in _tg_convo:
        _tg_ts = _html.escape(str(_tg.get("ts", ""))[:16])
        _tg_msg = _html.escape(str(_tg.get("message", "")))
        _tg_dir = _tg.get("direction", "in")
        if _tg_dir == "in":
            st.markdown(
                f'<div style="margin:0.5rem 0;padding:0.5rem 0.8rem;border-left:3px solid var(--accent);border-radius:0 6px 6px 0;background:rgba(57,255,20,0.04);">'
                f'<span style="font-size:0.65rem;opacity:0.5;font-family:monospace;">{_tg_ts} \u00b7 operator</span><br/>'
                f'<span style="font-size:0.85rem;">{_tg_msg}</span></div>',
                unsafe_allow_html=True
            )
        else:
            st.markdown(
                f'<div style="margin:0.5rem 0;padding:0.5rem 0.8rem;border-right:3px solid #0af;border-radius:6px 0 0 6px;background:rgba(0,170,255,0.04);text-align:right;">'
                f'<span style="font-size:0.65rem;opacity:0.5;font-family:monospace;">{_tg_ts} \u00b7 agent</span><br/>'
                f'<span style="font-size:0.85rem;">{_tg_msg}</span></div>',
                unsafe_allow_html=True
            )
    st.markdown('</div>', unsafe_allow_html=True)
else:
    st.markdown('<div class="empty-state"><div class="empty-icon">\U0001f4ac</div><div class="empty-text">No Telegram messages yet \u00b7 Send /msg in Telegram to start</div></div>', unsafe_allow_html=True)
_tg_reply_cols = st.columns([4, 1])
with _tg_reply_cols[0]:
    _tg_reply_text = st.text_input("Reply via Telegram", key="tg_reply", placeholder="Type a message to send to Telegram...")
with _tg_reply_cols[1]:
    st.markdown("<br/>", unsafe_allow_html=True)
    _tg_send = st.button("Send", key="tg_send_btn", use_container_width=True)
if _tg_send and _tg_reply_text.strip():
    try:
        ok = fin.send_telegram(_tg_reply_text.strip())
        if ok:
            _set_flash("success", "Message sent to Telegram.")
        else:
            _set_flash("error", "Failed to send \u2014 check bot token config.")
        st.rerun()
    except Exception as e:
        st.error(f"Failed: {e}")

# ── Debug tools ──────────────────────────────────────────────────
with st.expander("Log Test Event (debug)", expanded=False):
    st.caption("Log a test financial event for verification.")
    _test_type = st.selectbox("Event type", ["trade", "swap", "bet", "deposit", "research"], key="test_evt_type")
    _test_note = st.text_input("Note", key="test_evt_note", value="test event")
    if st.button("Log Event", key="log_test_evt"):
        try:
            fin.log_financial_event(_test_type, {"note": _test_note, "chain": "solana", "value_usd": 0})
            _set_flash("success", f"Logged {_test_type} event.")
            st.rerun()
        except Exception as e:
            st.error(f"Failed: {e}")

# ── Footer ───────────────────────────────────────────────────────
st.markdown(
    f'<div class="dashboard-footer">Northstar \u00b7 {datetime.now(PST).strftime("%Y-%m-%d %H:%M PST")}</div>',
    unsafe_allow_html=True,
)

if st.session_state.get("auto_refresh"):
    import time; time.sleep(0.1)
    st.markdown('<meta http-equiv="refresh" content="30">', unsafe_allow_html=True)
