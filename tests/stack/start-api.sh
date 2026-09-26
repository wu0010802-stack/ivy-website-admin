#!/usr/bin/env bash
# 端到端測試的 API：重建隔離測試庫 → migration → 五校與內容初始化 → 總管理者 → 啟動 uvicorn。
# 由 playwright.stack.config.ts 的 webServer 呼叫，測試結束時 Playwright 會把整個程序群組關掉。
# 只接受名稱含 test 的資料庫；每次都會 DROP 重建，不要指到任何有資料的庫。
set -euo pipefail

: "${E2E_DB_NAME:?需要 E2E_DB_NAME}"
: "${E2E_API_PORT:?需要 E2E_API_PORT}"
: "${E2E_ADMIN_EMAIL:?需要 E2E_ADMIN_EMAIL}"
: "${E2E_ADMIN_PASSWORD:?需要 E2E_ADMIN_PASSWORD}"
: "${E2E_STATE_DIR:?需要 E2E_STATE_DIR}"

case "$E2E_DB_NAME" in
  *test*) ;;
  *) echo "E2E_DB_NAME 必須是名稱含 test 的拋棄式資料庫：$E2E_DB_NAME" >&2; exit 1 ;;
esac
if [[ ! "$E2E_DB_NAME" =~ ^[a-z0-9_]+$ ]]; then
  echo "E2E_DB_NAME 只能有小寫英數與底線：$E2E_DB_NAME" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 連本機 PostgreSQL；帳號密碼沿用 libpq／asyncpg 都認得的 PGUSER／PGPASSWORD（CI 由 service 提供）。
dropdb --if-exists "$E2E_DB_NAME"
createdb "$E2E_DB_NAME"

db_url="postgresql+asyncpg://localhost/$E2E_DB_NAME"
export WEBSITE_ENVIRONMENT=test
export WEBSITE_DATABASE_URL="$db_url"
export WEBSITE_TEST_DATABASE_URL="$db_url"
export WEBSITE_SESSION_SECRET="e2e-only-session-secret-not-for-any-real-environment"
export WEBSITE_MEDIA_ROOT="$E2E_STATE_DIR/media"
# 通知只寫進本機資料夾，不設定 SMTP／LINE，不會寄出任何東西。
export WEBSITE_NOTIFICATION_EMAIL_SINK_DIR="$E2E_STATE_DIR/mail"
export WEBSITE_ADMIN_ORIGIN="${E2E_WEB_ORIGIN:-http://127.0.0.1:3710}"
export WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS=0
unset WEBSITE_SMTP_HOST WEBSITE_LINE_MESSAGING_CHANNEL_SECRET WEBSITE_LINE_MESSAGING_ACCESS_TOKEN \
  WEBSITE_GOOGLE_CLIENT_ID WEBSITE_GOOGLE_CLIENT_SECRET WEBSITE_GOOGLE_REDIRECT_URI \
  WEBSITE_LINE_CHANNEL_ID WEBSITE_LINE_CHANNEL_SECRET WEBSITE_LINE_REDIRECT_URI \
  WEBSITE_MEDIA_STORAGE WEBSITE_S3_BUCKET WEBSITE_S3_ACCESS_KEY_ID WEBSITE_S3_SECRET_ACCESS_KEY

rm -rf "$E2E_STATE_DIR/media" "$E2E_STATE_DIR/mail"
mkdir -p "$E2E_STATE_DIR/media" "$E2E_STATE_DIR/mail"

# 準備步驟的輸出寫進 log，失敗時才印出來，不洗掉 Playwright 的測試結果。
prepare_log="$E2E_STATE_DIR/api-prepare.log"
trap 'status=$?; if [[ $status -ne 0 ]]; then echo "E2E API 準備失敗，log 在 $prepare_log：" >&2; tail -n 40 "$prepare_log" >&2; fi' EXIT
cd "$root/backend"
{
  uv run --frozen alembic upgrade head
  uv run --frozen python -m app.cli seed
  uv run --frozen python -m app.cli initialize-content ../content/site-fixture.json
  # bootstrap-admin 刻意只從 stdin 讀密碼（不接受命令列參數、不寫 log）。
  printf '%s\n%s\n%s\n' "$E2E_ADMIN_EMAIL" "$E2E_ADMIN_PASSWORD" "$E2E_ADMIN_PASSWORD" \
    | uv run --frozen python -m app.cli bootstrap-admin
} >"$prepare_log" 2>&1
trap - EXIT

exec uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port "$E2E_API_PORT" --log-level warning --no-access-log
