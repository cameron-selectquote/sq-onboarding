#!/usr/bin/env bash
# One-time (re-runnable) setup for the Akamai Linode created from the Node.js
# Quick Deploy app (StackScript 970561). That app already provides Node 22,
# NGINX proxying :443 -> 127.0.0.1:3000 with a Certbot cert, UFW, and a
# `node.service` systemd unit. This script repoints node.service at our
# release layout and authorizes the CI deploy key.
#
# Usage (from repo root; DEPLOY_PUBKEY is optional):
#   ssh hackmidwest "sudo DEPLOY_PUBKEY='$(cat ~/.ssh/sq-onboarding-deploy.pub)' bash -s" < scripts/server-setup.sh
set -euo pipefail

APP_USER=deploy
APP_ROOT=/srv/sq-onboarding
UNIT=/etc/systemd/system/node.service

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }

# Layout: releases/<sha>/ (one per deploy), current -> releases/<sha>,
# data/ holds the SQLite file and survives deploys.
install -d -o "$APP_USER" -g "$APP_USER" "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/data"

# Placeholder release so the service can start before the first deploy.
if [[ ! -e "$APP_ROOT/current" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_ROOT/releases/bootstrap"
  cat > "$APP_ROOT/releases/bootstrap/server.js" <<'EOF'
require("http").createServer((_, res) => res.end("awaiting first deploy\n"))
  .listen(Number(process.env.PORT), process.env.HOSTNAME);
EOF
  chown "$APP_USER:$APP_USER" "$APP_ROOT/releases/bootstrap/server.js"
  ln -sfn "$APP_ROOT/releases/bootstrap" "$APP_ROOT/current"
  chown -h "$APP_USER:$APP_USER" "$APP_ROOT/current"
fi

# Keep the unit name the Quick Deploy app created; NGINX already targets :3000.
cat > "$UNIT" <<EOF
[Unit]
Description=Provision (sq-onboarding)
After=network.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_ROOT/current
ExecStart=/usr/bin/node $APP_ROOT/current/server.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
Environment=PROVISION_DB_PATH=$APP_ROOT/data/provision.sqlite
# Runtime config/secrets (Bedrock key, GENIE_DEBUG, ...), rewritten by
# scripts/deploy.sh on every deploy. "-" = optional, so the service still
# starts before the first deploy writes it.
EnvironmentFile=-$APP_ROOT/env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable node.service >/dev/null
systemctl restart node.service

# Authorize the CI deploy key, if provided. Idempotent.
if [[ -n "${DEPLOY_PUBKEY:-}" ]]; then
  ak=/home/$APP_USER/.ssh/authorized_keys
  grep -qxF "$DEPLOY_PUBKEY" "$ak" || echo "$DEPLOY_PUBKEY" >> "$ak"
  chown "$APP_USER:$APP_USER" "$ak"; chmod 600 "$ak"
fi

sleep 2
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo "node.service OK on 127.0.0.1:3000"
