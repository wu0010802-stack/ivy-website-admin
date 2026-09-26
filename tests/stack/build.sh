#!/usr/bin/env bash
# 端到端測試用的 build：和 deploy/web.Dockerfile 同一個做法——後台 build 複製進
# web/public/admin 再 build 官網，產生和正式站同一份 production 輸出。
# web/public/admin 已列入 .gitignore。
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(cd "$root/admin" && VITE_WEBSITE_ASSET_BASE= npm run build)
rm -rf "$root/web/public/admin"
cp -R "$root/admin/dist" "$root/web/public/admin"
(cd "$root/web" && NUXT_WEBSITE_ENV=production NUXT_PUBLIC_CONTENT_MODE=live NUXT_PUBLIC_INDEXING_ENABLED=false npm run build)
