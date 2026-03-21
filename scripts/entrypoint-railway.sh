#!/bin/sh
set -e

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
CONFIG="$STATE_DIR/openclaw.json"
PORT="${OPENCLAW_GATEWAY_PORT:-${PORT:-8080}}"

mkdir -p "$STATE_DIR"
chown node:node "$STATE_DIR"

# Always write/overwrite config so the gateway picks up the current
# Railway domain. Previous deploys may have left a stale config on
# the persistent volume that lacks allowedOrigins, which makes the
# gateway refuse to start with --bind lan.
DOMAIN="${RAILWAY_PUBLIC_DOMAIN:-localhost:$PORT}"
cat > "$CONFIG" <<EOF
{
  "gateway": {
    "mode": "local",
    "controlUi": {
      "allowedOrigins": ["https://$DOMAIN"]
    }
  }
}
EOF
chown node:node "$CONFIG"
echo "Wrote gateway config at $CONFIG (origin: https://$DOMAIN)"

# Use -m to preserve environment (OPENCLAW_STATE_DIR, OPENCLAW_GATEWAY_TOKEN,
# RAILWAY_*, NODE_ENV, etc.) when switching to the node user.
exec su -m -s /bin/sh node -c "exec node /app/openclaw.mjs gateway run --bind lan --port $PORT"
