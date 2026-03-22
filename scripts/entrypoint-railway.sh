#!/bin/sh
set -e

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
CONFIG="$STATE_DIR/openclaw.json"
PORT="${OPENCLAW_GATEWAY_PORT:-${PORT:-8080}}"

mkdir -p "$STATE_DIR"
# Recursively fix ownership on the state dir so the node user can write to
# all subdirectories (devices/, agents/, sessions/, etc.) that may have been
# created by a previous deploy running as root.
chown -R node:node "$STATE_DIR"

DOMAIN="${RAILWAY_PUBLIC_DOMAIN:-localhost:$PORT}"

# Seed config only if none exists yet. Once the gateway or web UI writes
# channels/plugins/agents into the config, we must not overwrite it on
# every container restart — that wipes user-added channels like WhatsApp.
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
{
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "token"
    },
    "trustedProxies": ["100.64.0.0/10"],
    "controlUi": {
      "allowedOrigins": ["https://$DOMAIN"]
    }
  }
}
EOF
  chown node:node "$CONFIG"
  echo "Seeded gateway config at $CONFIG (origin: https://$DOMAIN)"
else
  echo "Using existing config at $CONFIG"
fi

# Drop to the node user, forwarding only the env vars the gateway needs.
exec su -s /bin/sh node -c "
  OPENCLAW_STATE_DIR='$STATE_DIR' \
  OPENCLAW_GATEWAY_TOKEN='${OPENCLAW_GATEWAY_TOKEN:-}' \
  ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY:-}' \
  ANTHROPIC_OAUTH_TOKEN='${ANTHROPIC_OAUTH_TOKEN:-}' \
  NODE_ENV='${NODE_ENV:-production}' \
  exec node /app/openclaw.mjs gateway run --bind lan --port $PORT
"
