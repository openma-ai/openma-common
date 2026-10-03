#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
export ARTIFACT_DIR="/opt/cursor/artifacts/process-row-evidence"
mkdir -p "$ARTIFACT_DIR"

ROOT="/workspace"
BACKCHAT="/tmp/backchat"

cd "$ROOT"
pnpm exec playwright install chromium >/dev/null 2>&1 || true

node "$ROOT/scripts/capture-process-row-screenshots.mjs" \
  --fixture clash-current \
  --prefix clash-current-style-combo \
  --common-css /tmp/openma-common-v0.7.5-chat-ui-styles.css

node "$ROOT/scripts/capture-process-row-screenshots.mjs" \
  --fixture common-fixed \
  --prefix common-v0.7.6-standalone \
  --common-css "$ROOT/src/chat-ui/styles.css"

node "$ROOT/scripts/capture-process-row-screenshots.mjs" \
  --fixture common-fixed-clash-combo \
  --prefix common-v0.7.6-clash-style-combo \
  --common-css "$ROOT/src/chat-ui/styles.css"

node "$ROOT/scripts/verify-chat-reasoning-trigger-styles.mjs"

for spec in v0.0.8 main; do
  if [[ "$spec" == "v0.0.8" ]]; then
    prefix="backchat-broken-v0.0.8"
  else
    prefix="backchat-fixed-main"
  fi
  cd "$BACKCHAT"
  git fetch origin --tags >/dev/null 2>&1 || true
  git checkout --force "$spec"
  pnpm install
  pnpm exec electron-vite build
  cp "$ROOT/scripts/backchat-hidpi-evidence.spec.ts" "$BACKCHAT/e2e/hidpi-process-row.spec.ts"
  export BACKCHAT_E2E_APP_ROOT="$BACKCHAT"
  export SNAPSHOT_PREFIX="$prefix"
  pnpm exec playwright test e2e/hidpi-process-row.spec.ts --config playwright.config.ts
done

cd "$ROOT"
ls -la "$ARTIFACT_DIR"
