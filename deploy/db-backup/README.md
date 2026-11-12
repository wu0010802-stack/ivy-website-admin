# 官網 DB 每日異地備份（Cloudflare R2）

2026-11-12 建立。官網正式 Postgres 原本沒有自動備份（PITR 未開），只有部署前手動 `pg_dump` 存在**同一個** Postgres volume 裡，volume 壞了會一起不見。這個服務每天把整個 DB 備份到 Cloudflare R2。

| 項目 | 內容 |
|---|---|
| 執行 | Railway 官網專案裡的 cron 服務 `db-backup`，每天 UTC 19:00（台北 03:00），走內網連 DB |
| 內容 | `pg_dump --format=custom`（postgres 18 client），先 `pg_restore --list` 驗證至少有一張表的資料才上傳 |
| 加密 | age 公鑰加密後才離開 Railway；伺服器只有公鑰，**私鑰由本人保管**，私鑰弄丟備份就救不回來 |
| 存放 | R2 bucket `ivy-website-db-backups`，`daily/ivy-website-<UTC 時間>.dump.age` ＋同名 `.json`（大小、SHA-256，不含個資） |
| 保留 | bucket lifecycle：`daily/` 30 天後自動刪除 |
| 範圍 | 只有 DB。api 的 `/data/media`（上傳的照片與影片）**不在這份備份裡** |

不在 CD 裡：`main` 推送不會重新部署這個服務；改了本目錄的檔案要照「部署」手動上傳一次。

## 設定現況（2026-11-12）

已完成（Claude）：
- age 金鑰產生在本人桌面 `ivy-website-backup.key`（權限 600，沒有印出私鑰），公鑰 `age15lyvlg4hv5s2lwhjhfxzhcpyt6rp6dr7gj5uhatvh44dzy0r45ns8qvcaz` 已設成 `BACKUP_AGE_RECIPIENTS`。
- Railway 服務 `db-backup`（`140dd9df-258f-4d0c-b9ce-d1f491d2700e`）已建立並部署，映像在 Railway build 成功；變數 `DATABASE_URL=${{Postgres.DATABASE_URL}}`（內網）、`BACKUP_AGE_RECIPIENTS`、`R2_BUCKET=ivy-website-db-backups`。
- 正式 Postgres 是 `postgres-ssl:18`，與備份用的 client 同版。
- **cron 是用 API 設的**：`railway up` 時 `railway.json` 有被讀到，但 cronSchedule／restartPolicyType 沒套用（服務仍是 ON_FAILURE 重試 10 次）。改用
  `railway api 'mutation{ serviceInstanceUpdate(serviceId:"<服務>", environmentId:"<環境>", input:{cronSchedule:"0 19 * * *", restartPolicyType:NEVER}) }'`，
  查 `serviceInstance{ cronSchedule restartPolicyType nextCronRunAt }` 確認。重建服務時要再設一次。

本人要做：
1. 把桌面的 `ivy-website-backup.key` 整個存進密碼管理器，然後刪掉桌面檔案。私鑰弄丟備份就解不開。
2. Cloudflare 後台 → R2（第一次要綁付款方式；10 GB 內免費）→ Create bucket `ivy-website-db-backups`，位置 Asia-Pacific。
3. bucket → Settings：Object lifecycle rules 加 prefix `daily/`、30 天刪除；Bucket lock rules 加 prefix `daily/`、保留 7 天（權杖外洩時最近 7 天的備份刪不掉）。
4. R2 → Manage API tokens → Create API token：**Object Read & Write**、只套用 `ivy-website-db-backups`。
5. Railway → `db-backup` → Variables 貼上 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`（直接貼在網頁，不要貼到聊天或指令）。選用：`BACKUP_HEARTBEAT_URL`。
6. 改完變數 Railway 會自動重部署並跑一次；log 要看到 `完成：daily/ivy-website-….dump.age`，bucket 裡要有 `.dump.age` 與 `.json`。之後照「還原」做一次演練。

之後改了本目錄的檔案要手動重新上傳（不在 CD 裡）：

```sh
railway up deploy/db-backup --path-as-root --project d606df61-445a-4e65-9c5f-7e94a0766572 --environment production --service db-backup --detach
```

## 失敗通知

腳本任何一步失敗都以非 0 結束，Railway 會把那次 cron 標成失敗，但不一定會寄信。要確定「沒備份成功會收到通知」，建議設 heartbeat：

1. 在 healthchecks.io（免費）建一個 check，Period 1 day、Grace 2 hours。
2. 把它的 ping 網址設成 `BACKUP_HEARTBEAT_URL`。

腳本只在上傳並核對大小之後才 ping；超過時間沒收到 ping，healthchecks.io 就寄信。

## 還原

需要 `age`、`rclone`（或從 R2 網頁直接下載）與 **PostgreSQL 18 版的 `pg_restore`**（`brew install postgresql@18`）：pg_dump 18 產生的檔案，舊版 pg_restore 讀不了（正式 Postgres 也是 18：`postgres-ssl:18`，2026-11-12 查）。

```sh
# 1. 下載（也可以在 Cloudflare R2 網頁下載）
rclone copyto r2:ivy-website-db-backups/daily/ivy-website-<時間>.dump.age ./backup.dump.age

# 2. 解密（私鑰從密碼管理器取出，用完刪除）
age --decrypt -i ivy-website-backup.key -o backup.dump backup.dump.age

# 3. 核對：SHA-256 要等於同名 .json 的 dump_sha256
shasum -a 256 backup.dump
/opt/homebrew/opt/postgresql@18/bin/pg_restore --list backup.dump | head

# 4. 先還原到一個新的空 DB 檢查，不要直接蓋正式庫
createdb ivy_website_restore_check
/opt/homebrew/opt/postgresql@18/bin/pg_restore --no-owner --no-acl -d ivy_website_restore_check backup.dump
```

要還原到正式庫時：先停 api 服務、先替目前的正式庫另外做一份備份，再用 `pg_restore --clean --if-exists --no-owner --no-acl`。這是不可逆操作，要先跟使用者確認。

明文 `backup.dump` 含家長個資，用完就刪掉。

## 測試

```sh
python3 -m unittest discover -s deploy/tests -v   # test_db_backup.py 用假的 pg_dump／age／rclone 跑腳本
shellcheck deploy/db-backup/backup.sh
```

2026-11-12 本機實跑：真的 `pg_dump`（14.15）備份 `ivy_website_dev` → 真的 age 加密 → 假的 rclone 存成本機資料夾 → 解密後 SHA-256 與 manifest 相同 → `pg_restore` 到新 DB，27 張表、`alembic_version` 一致。映像本身（postgres 18-alpine＋apk 的 age／rclone）與真的 R2 上傳本機沒有 Docker 沒驗，第一次 Run now 時看 log 確認。
