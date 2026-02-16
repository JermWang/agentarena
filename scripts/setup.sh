#!/usr/bin/env bash
# Northstar Setup Script
# Initializes the data directory, copies templates, and installs dependencies.

set -euo pipefail

NORTHSTAR_HOME="${NORTHSTAR_HOME:-$HOME/.northstar}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Northstar Agent Setup ==="
echo "Data directory: $NORTHSTAR_HOME"
echo ""

# Create directory structure
echo "[1/5] Creating directory structure..."
mkdir -p "$NORTHSTAR_HOME/financial/memory"
mkdir -p "$NORTHSTAR_HOME/financial/state"
mkdir -p "$NORTHSTAR_HOME/financial/events"
mkdir -p "$NORTHSTAR_HOME/wallet/keys"
mkdir -p "$NORTHSTAR_HOME/wallet/state"
mkdir -p "$NORTHSTAR_HOME/wallet/config"
mkdir -p "$NORTHSTAR_HOME/wallet/scripts"
mkdir -p "$NORTHSTAR_HOME/directives/priorities"
echo "  Done."

# Copy templates (don't overwrite existing)
echo "[2/5] Copying templates..."
for tmpl in "$PROJECT_DIR/templates/"*; do
    fname="$(basename "$tmpl")"
    case "$fname" in
        strategy.md)
            dest="$NORTHSTAR_HOME/financial/memory/strategy.md"
            ;;
        policy.yaml)
            dest="$NORTHSTAR_HOME/wallet/config/policy.yaml"
            ;;
        chain-config.json)
            dest="$NORTHSTAR_HOME/wallet/config/chain-config.json"
            ;;
        *)
            continue
            ;;
    esac
    if [ ! -f "$dest" ]; then
        cp "$tmpl" "$dest"
        echo "  Copied $fname -> $dest"
    else
        echo "  Skipped $fname (already exists)"
    fi
done
echo "  Done."

# Copy .env.example if no .env exists
echo "[3/5] Checking .env..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "  Created .env from .env.example — fill in your values!"
else
    echo "  .env already exists."
fi

# Install Python dependencies
echo "[4/5] Installing Python dependencies..."
pip install --quiet requests streamlit plotly 2>/dev/null || {
    echo "  pip install failed — install manually: pip install requests streamlit plotly"
}
echo "  Done."

# Verify
echo "[5/5] Verifying setup..."
if [ -d "$NORTHSTAR_HOME/financial" ] && [ -d "$NORTHSTAR_HOME/wallet" ]; then
    echo "  Directory structure OK."
else
    echo "  WARNING: Directory structure incomplete."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Telegram bot token and chat ID"
echo "  2. Place your wallet keys in $NORTHSTAR_HOME/wallet/keys/"
echo "     - solana-keypair.json (Solana wallet)"
echo "     - evm-key.json (Base/EVM wallet)"
echo "  3. Edit $NORTHSTAR_HOME/financial/memory/strategy.md"
echo "  4. Run the dashboard: streamlit run dashboard/app.py --server.port 8787"
echo "  5. Run the Telegram bot: python telegram/bot.py &"
echo ""
