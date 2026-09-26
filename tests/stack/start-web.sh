#!/usr/bin/env bash
# 端到端測試的官網：跑 npm run e2e:build 產生的 Nuxt production 輸出（後台 build 已照
# deploy/web.Dockerfile 併進 /admin/），同源 /api/website/v1 轉給 start-api.sh 起的 API。
set -euo pipefail

: "${E2E_WEB_PORT:?需要 E2E_WEB_PORT}"
: "${E2E_API_ORIGIN:?需要 E2E_API_ORIGIN}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output="$root/web/.output"

export HOST=127.0.0.1
export PORT="$E2E_WEB_PORT"
export NUXT_WEBSITE_API_INTERNAL_BASE="$E2E_API_ORIGIN"
# build 時是 production（和正式站同一份輸出）；執行時標成 test，不送 HSTS 給本機 http。
export NUXT_WEBSITE_ENV=test
export NUXT_PUBLIC_TELEMETRY_ENABLED=false

# E2E_WEB_MODE=dev：改跑 nuxt dev，只用來檢查開發模式的 hydration 警告（hydration.spec.ts）。
if [[ "${E2E_WEB_MODE:-build}" == "dev" ]]; then
  export NUXT_PUBLIC_CONTENT_MODE=live
  export NUXT_ADMIN_DIST_DIR="$root/web/public/admin"
  cd "$root/web"
  exec npx nuxt dev --host 127.0.0.1 --port "$E2E_WEB_PORT"
fi

if [[ ! -f "$output/server/index.mjs" || ! -f "$output/public/admin/index.html" ]]; then
  echo "找不到官網與後台的 build，先在 repo 根目錄跑 npm run e2e:build" >&2
  exit 1
fi
export NUXT_ADMIN_DIST_DIR="$output/public/admin"
exec node "$output/server/index.mjs"
