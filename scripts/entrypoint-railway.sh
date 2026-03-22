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

# Always write/overwrite config so the gateway picks up the current
# Railway domain. Previous deploys may have left a stale config on
# the persistent volume that lacks allowedOrigins, which makes the
# gateway refuse to start with --bind lan.
DOMAIN="${RAILWAY_PUBLIC_DOMAIN:-localhost:$PORT}"
cat > "$CONFIG" <<EOF
{
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "trusted-proxy"
    },
    "trustedProxies": ["100.64.0.0/10"],
    "controlUi": {
      "allowedOrigins": ["https://$DOMAIN"]
    }
  }
}
EOF
chown node:node "$CONFIG"
echo "Wrote gateway config at $CONFIG (origin: https://$DOMAIN)"

# Drop to the node user, forwarding only the env vars the gateway needs.
exec su -s /bin/sh node -c "
  OPENCLAW_STATE_DIR='$STATE_DIR' \
  OPENCLAW_GATEWAY_TOKEN='${OPENCLAW_GATEWAY_TOKEN:-}' \
  ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY:-}' \
  ANTHROPIC_OAUTH_TOKEN='${ANTHROPIC_OAUTH_TOKEN:-}' \
  NODE_ENV='${NODE_ENV:-production}' \
  exec node /app/openclaw.mjs gateway run --bind lan --port $PORT
"
