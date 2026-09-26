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

每一輪依序做五件事，一步失敗不擋後面的步驟：到期的**排程發布**（每筆自己一個交易，失敗或「官網已經是更新版本」寫在排程上、後台看得到原因）→ 產生**提醒**（即將參觀、逾期未處理，見下）→ 釋放逾期占位 → 處理 outbox（站內通知＋LINE＋寄信）→ 刪除過期的限流計數。

寄信未設定（沒有 SMTP 也沒有 sink）時，outbox 照常處理、只寫站內通知，email 管道略過；不會把訊息留著等日後設好 SMTP 再一次寄出一堆舊通知；超過 24 小時才輪到的訊息也只寫站內通知、不寄信。SMTP 在背景 thread 執行，不會卡住 API 的請求。

LINE 群組推播：設定 `WEBSITE_LINE_MESSAGING_CHANNEL_SECRET`／`WEBSITE_LINE_MESSAGING_ACCESS_TOKEN` 後，每則通知會先推到該校在後台「LINE 通知」頁指定的群組，再寄 email。沒指定群組、或官方帳號已被移出群組的校區直接略過。啟用步驟見 `deploy/README.md`「LINE 群組推播」。

失敗的通知會在 `outbox_messages` 表留下 `status=failed`、`error_code`，可在 admin「站內通知」頁面看到對應的站內通知已產生（一般的案件狀態通知跟寄信是分開的：站內通知一定會建立，寄信才會重試/失敗）。**例外是提醒類通知**（`visit_upcoming`／`visit_request_overdue`）：寄送當下會重新判斷是否仍然成立（改期、取消、已處理、占位已換過或過期），不成立就整筆標成 `status=skipped`，連站內通知都不會建立——這是刻意設計，避免園方在後台看到「參觀已改期／已取消」但通知還說「即將參觀」的過期訊息。

### 通知重新寄送（2026-09-25）

寄送失敗的通知（`status=failed`）可以在後台「站內通知 → 寄送失敗」區塊逐則或全部重新寄送（需 `booking.handle`），只補沒送到的管道與收件人，不會重複站內通知或重推 LINE；也可以用 CLI：

```bash
python -m app.cli requeue-notifications [--campus <key>] [--dry-run]
```

人工重新排入的通知不受「超過 24 小時不推播寄信」限制。

### 提醒（2026-09-25）

定期工作每一輪會依下列閾值產生提醒（以 `outbox_messages.dedupe_key` 去重，同一情境只送一次）：

- **即將參觀**（`visit_upcoming`）：已確認的參觀開始前 24 小時內提醒一次；改期後依新時段重新判斷；確認時就已在 24 小時內的不再另外提醒。
- **逾期未處理**（`visit_request_overdue`）：新需求送出超過 24 小時仍是待處理（只補最近 72 小時內到點的，避免上線第一輪把所有舊案一次推出去）；或待確認占位在 6 小時內到期。

這兩種提醒只送給園方（站內通知、LINE 群組、有 `booking.handle` 的人員 Email），不會通知家長。

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

## 保存政策 / 資料清理（2026-09-26 改為後台可設定並持久化）

政策存在單列表 `retention_policies`，後台「全站設定 → 個資保存政策」可調整，三個天數各自 30–3650 天、預設都是 365：

- `cancelled_days`：用於已取消與未到場案件。
- `completed_days`：用於已完成案件。
- `open_overdue_days`：未結案（新需求／聯絡中／待確認／已確認）案件超過這個天數只會**提醒**（`open_overdue_count`），不會被清理——未結案的案件一律不清。

結案時間＝`COALESCE(取消時間, 歷程裡完成/未到場的最新時間, 建立時間)`，不是加新欄位，靠歷程與既有欄位算出來。

- `GET`／`PUT /admin/site-policies/retention`：讀取／更新三個天數與 `auto_run_enabled`（是否讓定期工作每天自動清理一次），回傳試算筆數與 `real_run_allowed`。
- `POST /admin/retention/dry-run`、`POST /admin/retention/run`：依目前政策天數試算／執行（不再收 `older_than_days` 參數）；`run` 一樣預設回 403（`RETENTION_REAL_RUN_DISABLED`），需設定 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`。
- 定期工作要**兩個開關都打開**才會自動清理：部署變數 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`，以及後台政策頁的「自動清理」；任一沒開就什麼都不做。每個台北日期最多執行一次。
- `GET /admin/retention-runs`：清理紀錄（人工／排程觸發、天數、各類別筆數、`open_overdue_count`，不存案件 id）。只有真正執行才會留紀錄，dry-run 不留。
- 清理只會把 `parent_name`/`phone`/`questions` 改成匿名化文字，不動狀態、時段、預約設定，也不影響已經產生的 analytics 統計數字；同時會清掉案件歷程與退回改期申請裡的自由文字原因。

**上線後要做**（需使用者處理）：到後台確認三個天數是否要維持 365；要開自動清理，除了後台開關，還要在 Railway api 服務設定 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`。

## 權限（2026-09-25 起：處理案件與設定分開、個資匯出逐人授權）

角色的能力表在 `backend/app/auth/permissions.py`，後台按鈕一律讀 `usePermissions()`／`effective_capabilities`（見下），不要在頁面裡另外寫角色判斷。

- **`booking.handle`**（總管理者、分校管理者、**接待人員**）：處理參觀案件——聯絡紀錄、轉聯絡中、確認排入既有時段、人工補登、取消、未到場、完成、後台改期、核准／退回家長改期申請、產生／撤銷家長管理連結、把站內通知標為已讀。可承辦、可被指派為承辦人的資格也看這個。
- **`booking.manage`**（總管理者、分校管理者）：預約設定、時段新增／容量調整／關閉、每週規則、休假日、指派承辦人——接待人員看得到時段但不能新增或關閉。
- **`booking.export`**（個資匯出，逐人授權）：不是角色自動有，而是總管理者到「使用者 → 角色與校區」逐人勾選「可以匯出負責校區的家長個資（CSV）」，可授予分校管理者或櫃台；總管理者永遠可以匯出。`GRANTABLE_CAPABILITIES`（`backend/app/auth/models.py`）定義哪個角色可以被授予哪個 capability；改角色時系統會自動清掉新角色不適用的授權。
- **`content.shared`**（全站共用內容，逐人授權）：總管理者可以授予分校管理者或內容編輯編輯首頁／頁尾／網站設定等共用內容；內容編輯有授權也只能送審，發布仍要分校管理者或總管理者。
- **`content.release_restore`**（全站一鍵還原）：限總管理者。

後台每個按鈕、輸入框是否顯示／可用，一律依 `UserOut.effective_capabilities`（角色＋逐人授權算出的實際權限）判斷，不會出現「按了才 403」的情況；接待人員看不到時段新增／關閉、預約設定與每週規則，改成唯讀說明。

## 稽核紀錄（2026-09-25／26 大幅擴大範圍）

`GET /admin/audit-log?campus_key=` 現在涵蓋所有後台與登入相關的寫入端點，包含：預約設定（`booking_config.update`）、內容發布／還原／送審／核准／退回／排程（`content.publish`、`content.publish_scheduled`、`content.submit_review`、`content.approve`、`content.reject`、`content.schedule`、`content.schedule_cancel`、`content.restore`、`release.restore`）、使用者（建立、停權、角色與校區、重設/變更密碼）、時段（`visit_slot.create`／`update`）、案件狀態轉換（`confirm`／`contacting`／`cancel`／`no_show`／`complete`／`reschedule`／`add_contact_note`／`approve_reschedule`／`reject_reschedule`）、家長管理連結（產生／撤銷）、素材（上傳、更新、替換、封存、還原、清理、批次替換引用、匯入既有素材）、通知重新寄送、Google 登入成功／失敗與解除綁定、個資保存政策更新等，總共約 30 種動作。

`metadata` 欄位過濾掉 `phone`/`parent_name`/`password`/`email`/`questions` 等欄位，不會把個資寫進稽核紀錄；家長姓名、搜尋字、Google sub 等一律不記或只記代碼。`backend/tests/test_audit_coverage.py` 會靜態掃描所有 `/admin`、`/auth` 寫入端點往下追三層呼叫，沒有寫稽核就讓測試失敗（例外需求要明列理由，例如登入登出、存草稿、標記已讀、dry-run）——新增任何寫入端點請先確認這個測試會不會擋下。中文標籤（`admin/src/api/labels.ts`）也有 `labelCoverage.test.ts` 靜態比對後端的稽核動作／通知 kind／原因代碼，缺中文會讓 admin 測試失敗。

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

## 素材儲存

`WEBSITE_MEDIA_STORAGE=local`（預設）存 `WEBSITE_MEDIA_ROOT`；`s3` 存 S3 相容物件儲存（Cloudflare R2、AWS S3…），設定與從 volume 搬遷的步驟見 `deploy/README.md`「素材改存 S3」。兩種儲存的讀檔都經 API 串流並支援 Range。本機可用 `uv run python -m app.cli media-copy-to-s3 --dry-run` 預覽搬遷。

上傳只接受 JPG、PNG、WebP、MP4（2026-09-25 起不再收 GIF；既有 GIF 素材照常可用），大小上限 `WEBSITE_MEDIA_MAX_IMAGE_MB`（預設 15）／`WEBSITE_MEDIA_MAX_VIDEO_MB`（預設 150），可一次選多個檔案（同時最多傳兩個）。

### 素材封存與清理（2026-09-25 起：刪除不再立即硬刪檔）

- 素材庫分「素材 / 已封存 / 待清理」三個分頁。**刪除只是標記待清理**（`deleted_at`），檔案不會立刻消失，`WEBSITE_MEDIA_PURGE_DELAY_DAYS`（預設 7）天後才由定期工作真的刪檔（`purge_media` 步驟，鎖列、commit 後才動磁碟，刪前重查有沒有又被引用）；期間可以在「待清理」分頁復原。
- 任何一版內容（草稿、官網現在的版本、已排程、**還可以還原的舊版本**）在用的素材不能刪除，只能「封存」（`archive`／`unarchive`，隱藏在選圖器但不刪檔）；「用在哪裡」（`GET /admin/media/{id}/usages`）列出引用它的內容、版本與欄位位置。
- 替換素材（上傳新檔取代舊檔）會依「用在哪裡」的清單，為每個受影響的內容項各存一份新草稿，**不會自動發布**；校園探索場景換照片後熱點座標可能對不上新照片，要人工重新複核。
- 影片會記錄時長、寬高與上傳者；圖片除縮圖外，原圖長邊超過 1600 會多存一份大圖，官網與後台都改讀衍生檔（縮圖／大圖／poster），不再載原檔。

## 已知限制（誠實列出，2026-09-25／26 更新）

- `web/` 已改用完整 LINE Seed TW（見 `web/public/assets/fonts/README.md`），CMS 開放編輯標題不再受子集缺字限制。**品牌名稱與 Logo 仍在後台鎖定不可改**，但理由已不是字型子集，而是 2026-09-19 的業主品牌核可（「網站標題與電話」頁有說明）。
- 時段規則現在會自動往後延展：定期工作每天依每週規則把時段補到「最遠開放天數」，跳過休假日與已開始的場次，冪等、不動已存在或手動調整過的時段；改規則或最遠開放天數後約一分鐘內就會補；要整天停開請設休假日。園方仍可在「時段與容量」手動「依規則產生時段」補特定範圍。
- 稽核紀錄已涵蓋幾乎所有管理操作（見上「稽核紀錄」），並有靜態測試擋漏寫。
- 規格 190 的 `age`／`preferred_time` 已改存固定代碼（2026-09-24，migration `a9c4e2f7d316` 轉換既有資料）。API 仍接受舊版官網送的中文標籤並換成代碼；冪等 hash 用中文標籤計算，跨版本重送不會誤判成 409。
- 公開端點限流的來源桶依賴 web 代理帶上的 `x-website-client-ip`（`web/server/routes/api/website/v1/[...].ts` 已設定並顯式覆寫）。若日後把 api 直接暴露到公網，必須先拿掉 `WEBSITE_TRUSTED_CLIENT_IP_HEADER`，否則這個 header 可被偽造。
- 共用內容（首頁、頁尾、網站設定、共用素材）預設只有總管理者能改；總管理者可以對分校管理者或內容編輯授予「全站共用內容」（`content.shared`）。內容編輯有授權也只能送審；有授權的分校管理者可以發布與審核共用內容。**個資匯出已改為逐人授權**（見上「權限」一節），不再是依角色自動給。
- 分校停用現在是**官網整校下架**（2026-09-25 起）：分校頁與預約頁回 404、首頁五校區塊／頁尾／選單／sitemap 不列、公開時段查詢回空清單、只適用該校的全站消息與共用常見問題不輸出；重新啟用後恢復，草稿預覽照常可看。
- 重設密碼不寄信：總管理者設新密碼後自行告知對方。
- LINE 登入的成功／失敗還沒寫稽核（裁定只要求 Google）；帳密登入本來就沒有登入稽核。
- 核准／退回家長改期申請、產生家長管理連結目前沒有稽核紀錄之外的通知；家長不會收到改期核准／退回、園方改期的通知（沒有對家長的通知管道）。
- 背景轉檔佇列未做：上傳仍在同一個請求內從 processing 變成 ready，大檔上傳期間會佔用一個請求連線。
