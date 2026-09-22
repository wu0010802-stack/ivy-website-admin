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

## 不可違反的規則（2026-09-22 缺陷修復後確立）

改這些地方之前先讀這一節；每一條都對應一個實際重現過、已寫成迴歸測試的缺陷（`backend/tests/test_bugfix_regressions.py`、`admin/src/__tests__/bugfixRegressions.test.ts`）。

- **email 一律小寫存、小寫比對**。新增任何寫入 `users.email` 的路徑時要沿用 `UserCreateRequest` 的正規化；DB 端有 `uq_users_email_lower` 兜底。登入查詢不可用 `scalar_one_or_none()`。
- **共用資源（`campus_key IS NULL`）的寫入一律限 `super_admin`**。`require_scope(..., campus_keys=None)` 對非 super_admin 是「不檢查」而不是「拒絕」——這是 media 那個跨校破壞缺陷的根因。media 用 `_require_media_manage`、content 用 `_require_shared_or_scope`，新模組要照做。
- **素材是否「使用中」要看目前生效的 release，不能只看 `media_usages`**。後者每次存草稿都整批重建，只反映最新草稿。
- **刪除順序一律「先 DB、commit 之後才動磁碟」**。反過來會在交易回滾時留下「DB 有記錄、磁碟沒檔案」的破圖。
- **家長安全連結不是一次性，但必須可撤銷**（規格 6.4）。案件進終態（取消／完成／未到場／占位逾期）時一律呼叫 `access_service.revoke_access_for_visit_request`。家長端回應只能用 `ParentVisitRequestOut`（遮罩手機），不可回後台的 `VisitRequestDetailOut`。
- **`slots` 模式預設人工確認**（規格 197）。送出是 `pending_confirmation`（占名額、24 小時占位），只有 `slots_auto_confirm` 打開才直接 `confirmed`。任何回給家長的文案都要依實際 status，不可從 mode 推斷成「預約成立」。
- **公開查詢與公開送單共用同一份時段可訂判斷**（`slot_service.is_publicly_bookable`，規格 404：server 是唯一判斷來源）。
- **限流不可只綁來源 IP**。公開 API 全部經 web 代理進來，`request.client.host` 恆為代理位址；主要限流鍵要用業務值（手機、email），來源桶只當次要防線。詳見 `deploy/README.md`。
- **冪等重播不計入限流**。重播不建立新案件，算進去會讓正常的逾時重送被擋成 429。
- **會被綁進 `href` 的欄位用允許清單，不是黑名單**。瀏覽器會忽略 scheme 裡的 TAB／換行／控制字元，`java<TAB>script:` 可以繞過前綴比對。純文字欄位才用 `_reject_unsafe_scheme`。
- **「今天」「已過期」一律用 `app.common.timezones` 的營運時區（Asia/Taipei）**，不可直接拿 UTC 的日界線比對 `slot_date`。
- **樂觀鎖要配列鎖**。只比 Python 物件上的版本號，兩個人同時存檔會各自通過檢查。
- **逾期占位要靠排程**：`python -m app.cli process-notifications` 會先跑 `expire_holds` 再處理 outbox，沒有排程的話名額不會自動釋放。

## 已知限制（誠實列出）

- 完整 LINE Seed TW 字型檔仍未取得（外部阻擋，需使用者提供原始檔）。
- 其餘 8 種內容欄位（五校介紹、一天照片卡、探索熱點、FAQ、消息/活動、siteMeta）尚無 admin editor。
- Nuxt 端真實預約表單／CTA 接線／`/visit/manage` 頁面尚未實作（屬 Task 8）。
- 週期性時段規則產生器尚未實作（屬 Task 9 剩餘範圍）。占位到期釋放已實作（`workflow_service.expire_holds`，由 `process-notifications` 帶跑），但仍需外部排程定期呼叫，沒有常駐 daemon。
- 稽核紀錄涵蓋預約設定、內容發布、停權、帳號建立、校區範圍變更、案件匯出、撤銷家長連結，仍非全面覆蓋。
- 規格 190 的 `age`／`contact_time` 固定 enum 尚未強制：公開表單目前送 CMS 的中文標籤，收緊成 Literal 會讓現行表單全部送不出去，需要 `web/` 與 CMS 選項一起改。目前只有長度上限（避免 500）。
- 公開端點限流的來源桶依賴 web 代理帶上的 `x-website-client-ip`（`web/server/routes/api/website/v1/[...].ts` 已設定並顯式覆寫）。若日後把 api 直接暴露到公網，必須先拿掉 `WEBSITE_TRUSTED_CLIENT_IP_HEADER`，否則這個 header 可被偽造。
- 內容審核流程（送審/核准/退回）與排程發布尚未實作（屬階段 D 擴充範圍）。
