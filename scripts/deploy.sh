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
REMOTE="deploy@${DEPLOY_HOST}"
ROOT=/srv/sq-onboarding
DEST="$ROOT/releases/$RELEASE"
KEEP=3

# Standalone output omits static assets; they must sit beside server.js.
rm -rf .next/standalone/.next/static
cp -R .next/static .next/standalone/.next/static
[[ -d public ]] && cp -R public .next/standalone/public

rsync -az --delete .next/standalone/ "$REMOTE:$DEST/"

# Switch `current`, remembering the previous release for rollback.
PREV=$(ssh "$REMOTE" "set -e
  prev=\$(readlink -f $ROOT/current || true)
  ln -sfn $DEST $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current
  sudo -n systemctl restart node.service
  echo \"\$prev\"")
echo "Deployed $RELEASE (previous: ${PREV:-none})"

if curl -fsS --retry 10 --retry-delay 3 --retry-all-errors "$PROD_URL/api/hires" >/dev/null; then
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
