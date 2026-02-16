# Northstar

**Agent financial infrastructure, built by an agent.**

Northstar gives autonomous AI agents the financial brain they need — live portfolio tracking, policy-gated trading, memory persistence across sessions, and real-time operator communication via Telegram.

## What's Inside

| Component | Description |
|-----------|-------------|
| `core/finance.py` | Financial data layer — prices, balances, policy, memory bank, event logging, Jupiter swaps, Polymarket |
| `dashboard/` | Streamlit dashboard with command center, smart alerts, position cards, terminal log, performance charts |
| `telegram/bot.py` | Telegram bot with `/balance`, `/status`, `/strategy`, `/markets`, `/msg`, `/note`, `/convo` commands |
| `telegram/notifier.py` | Stateless alert sender for trade notifications, policy warnings, daily summaries |
| `templates/` | Strategy, policy, and chain config templates |
| `scripts/setup.sh` | One-command setup that initializes everything |

## Quick Start

```bash
# 1. Clone and enter the project
git clone <your-repo-url> northstar
cd northstar

# 2. Run setup
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Configure (edit .env with your credentials)
$EDITOR .env

# 4. Launch the dashboard
streamlit run dashboard/app.py --server.port 8787

# 5. Start the Telegram bot (background)
python telegram/bot.py &
```

## Configuration

All configuration lives in environment variables (`.env` file):

| Variable | Required | Description |
|----------|----------|-------------|
| `NORTHSTAR_HOME` | No | Data directory (default: `~/.northstar`) |
| `TELEGRAM_BOT_TOKEN` | Yes* | From @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Yes* | Your Telegram chat ID |
| `JUPITER_API_KEY` | No | Jupiter aggregator API key |

*Required for Telegram features. Dashboard works without them.

## Directory Structure

```
~/.northstar/                  (NORTHSTAR_HOME)
├── financial/
│   ├── memory/                Strategy, decisions, research, rolling context
│   ├── state/                 Portfolio snapshots, performance tracking
│   └── events/                Financial events, alerts, Telegram messages
├── wallet/
│   ├── keys/                  Wallet keypair files (user-provided)
│   ├── state/                 Policy ledger, last transaction
│   ├── config/                Chain config, policy.yaml
│   └── scripts/               Policy check script
└── directives/
    └── priorities/            Agent inbox for Telegram messages
```

## Architecture

- **No hardcoded secrets** — everything comes from environment variables
- **No hardcoded paths** — `NORTHSTAR_HOME` controls all data locations
- **Graceful degradation** — every API call wrapped in try/except, dashboard renders even when everything is offline
- **Append-only logging** — JSONL format for all events, decisions, and messages
- **Policy gates** — every fund-moving operation goes through `check_policy()` first
- **Session persistence** — rolling context file bridges agent sessions

## Supported Integrations

- **Solana** — SOL balance, SPL tokens, Jupiter swaps
- **Base (EVM)** — ETH balance
- **CoinGecko** — SOL/ETH price feeds
- **DexScreener** — Exotic token prices
- **Jupiter** — DEX aggregator swaps with policy gates
- **Polymarket** — Prediction market data + trending markets
- **Telegram** — Bidirectional operator communication

## License

MIT
