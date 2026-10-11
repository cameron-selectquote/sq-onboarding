#!/usr/bin/env bash
# Ship a standalone Next.js build to the Akamai Linode and switch traffic to it.
# Run after `npm run build` (next.config.js sets output: "standalone").
#
#   DEPLOY_HOST=172.236.114.197 RELEASE=<git sha> PROD_URL=https://... scripts/deploy.sh
#
# Expects ssh to authenticate as `deploy` (CI loads the key into ssh-agent).
# Layout and service are created by scripts/server-setup.sh.
set -euo pipefail

: "${DEPLOY_HOST:?}" "${RELEASE:?}" "${PROD_URL:?}"
# Auth fails closed in production without these (nobody can log in), so refuse
# to ship a release that would be unusable.
: "${AUTH_SECRET:?Set AUTH_SECRET in the Production environment}"
: "${DEMO_PASSWORD:?Set DEMO_PASSWORD in the Production environment}"
REMOTE="deploy@${DEPLOY_HOST}"
ROOT=/srv/sq-onboarding
DEST="$ROOT/releases/$RELEASE"
KEEP=3

# Standalone output omits static assets; they must sit beside server.js.
rm -rf .next/standalone/.next/static
cp -R .next/static .next/standalone/.next/static
[[ -d public ]] && cp -R public .next/standalone/public

rsync -az --delete .next/standalone/ "$REMOTE:$DEST/"

# Runtime env for node.service (loaded via EnvironmentFile=, see
# server-setup.sh). CI is the source of truth: the file is rebuilt from these
# vars on every deploy, so manual edits on the box are overwritten. Unset/empty
# vars are omitted. Piped over stdin (not argv) so secrets never show in `ps`.
RUNTIME_ENV_VARS=(AUTH_SECRET DEMO_PASSWORD AWS_BEARER_TOKEN_BEDROCK AWS_REGION GENIE_MODEL_ID GENIE_DEBUG)
render_env() {
  local name
  for name in "${RUNTIME_ENV_VARS[@]}"; do
    if [[ -n "${!name:-}" ]]; then printf '%s=%s\n' "$name" "${!name}"; fi
  done
}
render_env | ssh "$REMOTE" "umask 077 && cat > $ROOT/env.tmp && mv -f $ROOT/env.tmp $ROOT/env"
# Log names only, never values.
echo "Wrote runtime env: $(render_env | cut -d= -f1 | tr '\n' ' ')"

# Switch `current`, remembering the previous release for rollback.
PREV=$(ssh "$REMOTE" "set -e
  prev=\$(readlink -f $ROOT/current || true)
  ln -sfn $DEST $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current
  sudo -n systemctl restart node.service
  echo \"\$prev\"")
echo "Deployed $RELEASE (previous: ${PREV:-none})"

# Smoke test: the app is up (public health check) and the auth gate is live
# (a protected API rejects an anonymous request with 401).
smoke() {
  curl -fsS --retry 10 --retry-delay 3 --retry-all-errors "$PROD_URL/api/health" >/dev/null || return 1
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$PROD_URL/api/hires") || return 1
  [[ "$code" == 401 ]] || { echo "::error::Expected 401 from /api/hires without a session, got $code"; return 1; }
  # Redirects must stay on the public origin (not the proxy's upstream, e.g. localhost:3000).
  local location
  location=$(curl -sS -o /dev/null -w '%{redirect_url}' "$PROD_URL/home") || return 1
  [[ "$location" == "$PROD_URL/"* ]] || { echo "::error::/home redirected to '$location', expected $PROD_URL/..."; return 1; }
}

if smoke; then
  echo "Smoke test passed"
  # Prune old releases (never the live one).
  ssh "$REMOTE" "cd $ROOT/releases && ls -1t | grep -vxF '$RELEASE' | tail -n +$KEEP | xargs -r rm -rf"
  exit 0
fi

echo "::error::Smoke test failed for $RELEASE; rolling back to ${PREV:-<none>}"
if [[ -n "$PREV" ]]; then
  ssh "$REMOTE" "ln -sfn $PREV $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current && sudo -n systemctl restart node.service"
fi
exit 1
