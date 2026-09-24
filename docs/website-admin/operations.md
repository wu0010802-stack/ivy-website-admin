# 官網後台維運手冊

## 資料庫

- 開發：`ivy_website_dev`；測試：`ivy_website_test`（本機 PostgreSQL 14.15）。
- Migration：`cd backend && uv run alembic upgrade head`（需先設定 `WEBSITE_DATABASE_URL`/`WEBSITE_TEST_DATABASE_URL`/`WEBSITE_SESSION_SECRET`/`WEBSITE_ENVIRONMENT`）。

## 定期工作（排程發布、逾期占位、通知、清限流計數）

2026-09-24 起由 **API 程序自己定期執行**（`app/workers/maintenance.py`）：production
預設每 60 秒一輪，本機與測試預設關閉。`WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS`
可覆寫（0＝關閉，否則 10–3600 秒）。部署後打 `/api/website/v1/health`，
`background_jobs.enabled` 為 true、`last_completed_at` 持續更新就代表有在跑。

同一時間全域只會跑一輪（PostgreSQL advisory lock），多個 worker／副本或同時手動
執行 CLI 都不會重複處理。手動補跑或本機測試：

```bash
export WEBSITE_NOTIFICATION_EMAIL_SINK_DIR=./var/mail-sink   # 本機/測試用；沒設定時 email 管道略過、站內通知照寫
uv run python -m app.cli process-notifications
```

真實寄信（2026-09-24 起）：設定 SMTP 就會改用 SMTP，不再寫 sink 檔。

```bash
export WEBSITE_SMTP_HOST=smtp.example.org
export WEBSITE_SMTP_PORT=587                 # ssl 通常是 465
export WEBSITE_SMTP_SECURITY=starttls        # starttls｜ssl｜none（production 不允許 none）
export WEBSITE_SMTP_USERNAME=...             # 需要登入才設
export WEBSITE_SMTP_PASSWORD=...             # 放部署平台的 secret，不要寫進 repo
export WEBSITE_SMTP_FROM='常春藤官網 <noreply@example.org>'   # 設了 HOST 就必填
```

每一輪依序做四件事，一步失敗不擋後面的步驟：到期的**排程發布**（每筆自己一個交易，失敗寫在排程上、後台看得到原因）→ 釋放逾期占位 → 處理 outbox（站內通知＋寄信）→ 刪除過期的限流計數。

寄信未設定（沒有 SMTP 也沒有 sink）時，outbox 照常處理、只寫站內通知，email 管道略過；不會把訊息留著等日後設好 SMTP 再一次寄出一堆舊通知；超過 24 小時才輪到的訊息也只寫站內通知、不寄信。SMTP 在背景 thread 執行，不會卡住 API 的請求。

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
- **逾期占位、排程發布、通知都靠定期工作**：API 內建（見「定期工作」）；如果把 `WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS` 設成 0，就要另外排程呼叫 `python -m app.cli process-notifications`。容量計算本身已排除到期占位，所以名額不會卡住，但案件狀態、排程發布與通知都不會動。

## 已知限制（誠實列出）

- 完整 LINE Seed TW 字型檔仍未取得（外部阻擋，需使用者提供原始檔）。因此品牌名稱與 Logo 在後台鎖定不可改（「網站標題與電話」頁有說明）。
- 時段規則不會自己產生時段：園方在「時段與容量」按「依規則產生時段」才建立（一次最多 92 天，可重複按）。
- 稽核紀錄涵蓋預約設定、內容發布／還原／送審／核准／退回／排程、停權、帳號建立、角色與校區變更、重設密碼、案件匯出、指派、人工補登、時段規則、休假日、分校停用、撤銷家長連結，仍非全面覆蓋。
- 規格 190 的 `age`／`preferred_time` 已改存固定代碼（2026-09-24，migration `a9c4e2f7d316` 轉換既有資料）。API 仍接受舊版官網送的中文標籤並換成代碼；冪等 hash 用中文標籤計算，跨版本重送不會誤判成 409。
- 公開端點限流的來源桶依賴 web 代理帶上的 `x-website-client-ip`（`web/server/routes/api/website/v1/[...].ts` 已設定並顯式覆寫）。若日後把 api 直接暴露到公網，必須先拿掉 `WEBSITE_TRUSTED_CLIENT_IP_HEADER`，否則這個 header 可被偽造。
- 共用內容（首頁、頁尾、網站設定、共用素材）預設只有總管理者能改；總管理者可以對分校管理者或內容編輯授予「全站共用內容」（`users.capabilities` 的 `content.shared`）。內容編輯有授權也只能送審；有授權的分校管理者可以發布與審核共用內容。個資匯出仍是依角色，不是逐人授權。
- 分校停用只停止公開預約（官網顯示暫停、送單回 `BOOKING_UNAVAILABLE`）與該校內容發布；官網首頁五校區塊仍會列出這一校。
- 重設密碼不寄信：總管理者設新密碼後自行告知對方。
