# 官網後台維運手冊

## 資料庫

- 開發：`ivy_website_dev`；測試：`ivy_website_test`（本機 PostgreSQL 14.15）。
- Migration：`cd backend && uv run alembic upgrade head`（需先設定 `WEBSITE_DATABASE_URL`/`WEBSITE_TEST_DATABASE_URL`/`WEBSITE_SESSION_SECRET`/`WEBSITE_ENVIRONMENT`）。

## 通知 worker

```bash
export WEBSITE_NOTIFICATION_EMAIL_SINK_DIR=./var/mail-sink   # 本機/測試用；沒設定時 CLI 會如實印「尚未設定」
uv run python -m app.cli process-notifications
```

單次批次處理，非常駐 daemon。正式環境排程交給部署平台的 cron（例如每分鐘跑一次），本專案不內建常駐 worker process（本機 8GB RAM 限制下也不建議常駐）。

失敗的通知會在 `outbox_messages` 表留下 `status=failed`、`error_code`，可在 admin「站內通知」頁面看到對應的站內通知已產生（通知本身跟寄信是分開的：站內通知一定會建立，寄信才會重試/失敗）。

## 備份與還原

```bash
# 備份（對隔離開發/測試庫皆可；會拒絕連 ivymanagement）
cd backend
uv run python scripts/backup_website.py ./var/backups

# 還原（只能在 WEBSITE_ENVIRONMENT=test 執行，且目標 DSN 必須通過
# Settings 的隔離檢查）
WEBSITE_ENVIRONMENT=test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test \
  uv run python scripts/restore_website.py ./var/backups/website-db-<timestamp>.sql
```

已對隔離測試 DB + 測試媒體目錄實際演練過（見 `docs/website-admin/acceptance.md` Task 10 小結），備份產出一份 `pg_dump` SQL 與媒體 tarball，還原後 schema 與資料皆正確。**還原前務必確認目標是隔離測試環境，指令本身會拒絕在非 test 環境執行，但仍建議操作前再次手動確認 DSN。**

## 保存政策 / 資料清理

- `POST /admin/retention/dry-run?older_than_days=365`：只回報符合條件（已取消/未到場、超過天數）的案件數，不改資料。
- `POST /admin/retention/run`：預設回 403（`RETENTION_REAL_RUN_DISABLED`），需設定 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true` 才會真的執行匿名化。
- 清理只會把 `parent_name`/`phone`/`questions` 改成匿名化文字，不動狀態、時段、預約設定，也不影響已經產生的 analytics 統計數字。

## 稽核紀錄

`GET /admin/audit-log?campus_key=` 目前涵蓋：`booking_config.update`、`user.set_active`、`content.publish`、`site_settings.update`。`metadata` 欄位過濾掉 `phone`/`parent_name`/`password`/`email`/`questions` 等欄位，不會把個資寫進稽核紀錄。**尚未涵蓋所有管理操作**（例如素材刪除、使用者新增本身、時段建立/調整目前沒有寫入稽核），這是已知的部分覆蓋範圍，非完整稽核。

## 共用型別契約

```bash
npm run contract:generate   # 匯出 backend OpenAPI → contracts/openapi.json，產生 contracts/generated/website-api.d.ts
npm run contract:check      # CI 用；非零 exit code 代表契約與型別有 drift
```

## 完整測試

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 106 passed
cd web && npm run typecheck && npm run test:unit && npm run build
cd admin && npm run typecheck && npm run build
npm run contract:check
npm run test:e2e   # Playwright，四視口設定見 playwright.config.ts
```

`env -i PATH="$PATH" HOME="$HOME"` 是為了避免本機殼層已 `source` 過 `.env.example` 之類的環境變數污染測試（曾經因為 `WEBSITE_ENABLE_FIXTURE=true` 殘留在環境裡，導致 3 個無關測試假失敗）。

## 已知限制（誠實列出）

- 完整 LINE Seed TW 字型檔仍未取得（外部阻擋，需使用者提供原始檔）。
- 其餘 8 種內容欄位（五校介紹、一天照片卡、探索熱點、FAQ、消息/活動、siteMeta）尚無 admin editor。
- Nuxt 端真實預約表單／CTA 接線／`/visit/manage` 頁面尚未實作（屬 Task 8）。
- 週期性時段規則產生器、占位到期自動釋放、排程 daemon 尚未實作（屬 Task 9 剩餘範圍）。
- 稽核紀錄只涵蓋 4 種操作，非全面覆蓋。
- 內容審核流程（送審/核准/退回）與排程發布尚未實作（屬階段 D 擴充範圍）。
