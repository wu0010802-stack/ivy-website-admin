#!/bin/sh
# 官網正式 DB 每日異地備份（2026-11-12）：pg_dump → pg_restore --list 驗證 → age 公鑰加密 → 上傳 Cloudflare R2。
# 由 Railway cron 服務 db-backup 執行（deploy/db-backup/railway.json），設定與還原步驟見同目錄 README.md。
#
# 必要環境變數：
#   DATABASE_URL           官網 Postgres 內網連線字串（Railway 用 ${{Postgres.DATABASE_URL}} 參照）
#   BACKUP_AGE_RECIPIENTS  age 公鑰，可多把、以空白分隔（任一把私鑰都能解）；伺服器上只放公鑰
#   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
# 選用：
#   BACKUP_PREFIX          物件路徑前綴，預設 daily（R2 的 lifecycle／bucket lock 規則綁這個前綴）
#   BACKUP_HEARTBEAT_URL   成功後 GET 一次（例如 healthchecks.io）；沒按時收到就由對方發警報
#
# 明文 dump 只存在容器暫存目錄，加密後立即刪除；上傳的只有 .age 與不含個資的 manifest。
# 不印出任何連線字串或金鑰。任何一步失敗都以非 0 結束，Railway 會把這次 cron 標成失敗。
set -eu
umask 077

missing=""
for name in DATABASE_URL BACKUP_AGE_RECIPIENTS R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "備份中止：缺少環境變數$missing" >&2
  exit 2
fi

prefix="${BACKUP_PREFIX:-daily}"
prefix="${prefix%/}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="ivy-website-$stamp"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

log() { echo "[db-backup $(date -u +%H:%M:%SZ)] $*"; }

# 指令放在 $(…|…) 管線裡失敗時 set -e 不會中止，所以雜湊先寫檔（失敗就中止）再讀，並檢查長度。
sha256_of() {
  sha256sum "$1" >"$work/sha256.out"
  digest="$(cut -d' ' -f1 "$work/sha256.out")"
  if [ "${#digest}" -ne 64 ]; then
    echo "備份中止：無法計算 $(basename "$1") 的 SHA-256" >&2
    exit 5
  fi
}

log "pg_dump 開始"
pg_dump --format=custom --compress=6 --no-password --dbname="$DATABASE_URL" --file="$work/$name.dump"

# 能列出目錄才算 dump 完整；一張表的資料都沒有代表連錯庫或權限不足，不要拿空備份蓋過好備份。
pg_restore --list "$work/$name.dump" >"$work/toc.txt"
tables="$(grep -c ' TABLE DATA ' "$work/toc.txt" || true)"
if [ "${tables:-0}" -lt 1 ]; then
  echo "備份中止：dump 裡沒有任何 TABLE DATA" >&2
  exit 3
fi
plain_bytes="$(wc -c <"$work/$name.dump" | tr -d ' ')"
sha256_of "$work/$name.dump"
plain_sha="$digest"
log "dump 驗證通過：$tables 張表的資料、$plain_bytes bytes"

set --
for recipient in $BACKUP_AGE_RECIPIENTS; do
  set -- "$@" --recipient "$recipient"
done
age --encrypt "$@" --output "$work/$name.dump.age" "$work/$name.dump"
rm -f "$work/$name.dump"
enc_bytes="$(wc -c <"$work/$name.dump.age" | tr -d ' ')"
sha256_of "$work/$name.dump.age"
enc_sha="$digest"

pg_version="$(pg_dump --version)"
cat >"$work/$name.json" <<EOF
{
  "name": "$name",
  "created_at": "$stamp",
  "pg_dump": "$pg_version",
  "table_data_entries": $tables,
  "dump_bytes": $plain_bytes,
  "dump_sha256": "$plain_sha",
  "encrypted_bytes": $enc_bytes,
  "encrypted_sha256": "$enc_sha"
}
EOF

# rclone 全部用環境變數設定，不寫設定檔。權杖只授權單一 bucket，所以不檢查／建立 bucket。
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ACL=private

remote="r2:$R2_BUCKET/$prefix"
log "上傳 $prefix/$name.dump.age（$enc_bytes bytes）"
rclone copyto --retries 3 "$work/$name.dump.age" "$remote/$name.dump.age"
rclone copyto --retries 3 "$work/$name.json" "$remote/$name.json"

# 上傳後再讀一次遠端大小，對不上就算失敗。
remote_bytes="$(rclone size --json "$remote/$name.dump.age" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
if [ "$remote_bytes" != "$enc_bytes" ]; then
  echo "備份失敗：R2 上的大小 ${remote_bytes:-?} 和本機 $enc_bytes 不符" >&2
  exit 4
fi
log "完成：$prefix/$name.dump.age"

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  wget -q -T 10 -O /dev/null "$BACKUP_HEARTBEAT_URL" || log "heartbeat 回報失敗（備份本身已完成）"
fi
