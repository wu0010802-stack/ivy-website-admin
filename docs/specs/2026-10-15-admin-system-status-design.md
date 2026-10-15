# 後台系統狀態頁（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可（對話中一次核可六項後台功能的設計摘要；本頁的「測試信」「營運總覽提示」兩項另經使用者逐題選定）；規格待使用者審閱
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案不新增 migration**）
分支（實作）：`feature/system-status-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 1 波，與「參觀提醒信」同波；兩者不共用檔案，可先後做）

## 1. 背景與目標

正式站有一批「功能做好、靠環境變數才會動」的服務（寄信、LINE 推播、Turnstile、Google／LINE 登入、S3、公開資料自動同步、個資自動清理），也有三條背景迴圈（維護排程、轉檔、公開資料同步）。目前沒有任何後台畫面看得到它們的狀態：

- 正式站到底有沒有設 SMTP，要翻 `deploy/README.md`（:948 記 10-04 未設，之後沒有確認紀錄）。
- `/health`（`backend/app/main.py:210-234`）是公開端點，只回維護排程與轉檔迴圈，不回公開資料同步，也不回任何設定。
- 公開資料每一項的最近錯誤存在 `geo_dataset_status.last_error`（`backend/app/admissions/geo/models.py:177-201`），但區域分析畫面只讀版本與日期（`backend/app/admissions/area.py:115-134`），錯誤只有跑 CLI 才看得到。
- 門牌因為 data.kcg.gov.tw 擋 Railway，要每月手動匯入（`deploy/README.md:781`），沒有到期提醒。
- 營運總覽「要處理」（`backend/app/operations/dashboard_service.py`）只有寄送失敗、排程發布失敗等業務項目，沒有「寄信沒設」「維護排程停擺」這類系統項目。

### 1.1 成功標準

1. 總管理者在側欄「系統 → 系統狀態」看到四區：對外服務設定、背景工作、公開資料、通知與發布；每一列有狀態標籤與處理方式。
2. 有「要注意」的項目時，總管理者的營運總覽「要處理」多一行「系統狀態有 N 項要注意」，點了進狀態頁；其他角色看不到。
3. 按「寄一封測試信給我」，當場知道寄信是否真的寄得出去。
4. 頁面與 API 不出現任何金鑰、密碼、token，也不出現可能夾帶個資的錯誤原文；不改資料表；`/health` 不動。

### 1.2 裁定

標 ✔ 的是使用者 10-15 核可的；其餘是預設值，可改。

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| S1 ✔ | 對象 | 只有總管理者。新權限 `system.status`，只給 `super_admin` | 設定與背景工作是全站層級，校區管理者處理不了 |
| S2 ✔ | 內容 | 四區：對外服務設定、背景工作、公開資料、通知與發布（§3.2） | 盤點時「正式站設定到底開了沒」反覆查不到 |
| S3 ✔ | 測試信 | 有「寄一封測試信給我」按鈕（§3.4） | 設了 SMTP 不代表寄得出去（帳密錯、被擋） |
| S4 ✔ | 總覽提示 | 總管理者的「要處理」多一行，只算「要注意」等級 | 不用記得自己點進狀態頁 |
| S5 ✔ | 嚴重度 | 兩級：**要注意**（寄信沒設、維護排程停擺或有失敗步驟、轉檔失敗、公開資料同步失敗或過期）與**資訊**（Turnstile、Google／LINE 登入、LINE 推播、素材儲存方式、各開關的開／關） | 只有會讓家長或同仁「以為有、其實沒有」的才算要注意；其餘是選擇，不是故障 |
| S6 ✔ | 門牌到期 | 門牌 `synced_at` 距今超過 **35 天**＝要注意「門牌超過 35 天沒換版，請手動匯入新版」 | 每月發布一次，加 5 天緩衝 |
| S7 | 其他公開資料過期 | `checked_at`、`synced_at` 取較新者，距今超過「該資料更新週期＋3 天」＝過期（要注意）。更新週期沿用同步程式常數：一般 30 天（`geo/sync.py:89` `REFRESH_AFTER`）、幼兒園與托嬰 7 天（`geo/providers.py:35`）；出生、遷徙也用 30 天 | 自動同步每天檢查一次；過了週期還多 3 天沒動，代表同步停擺或一直失敗。`campuses` 是內部指紋（`geo/models.py:181-182`），不列 |
| S8 | 維護排程停擺 | 背景工作開著（`background_jobs_interval > 0`）時，`last_completed_at` 距今超過 max(5 分鐘, 5×間隔)，或程序啟動超過該時間仍沒有完成過一輪＝要注意 | 預設每 60 秒一輪；5 輪沒跑完一定有問題。背景工作設為關閉（0）時顯示「關閉」（資訊） |
| S9 | 錯誤原文 | 維護排程與轉檔只顯示**哪一步**失敗（中文步驟名），不顯示錯誤原文；公開資料顯示 `last_error`（≤300 字，內容是來源網址與 HTTP 錯誤，不含家長資料） | 維護排程的錯誤可能夾帶收件 Email 或案件內容 |
| S10 | 寄信設定顯示 | 顯示主機、port、加密方式、寄件地址；不顯示帳號與密碼。非 production 用本機資料夾（sink）時顯示「寫入本機資料夾（測試用）」 | 主機與寄件地址不是秘密，看得到才知道設對了沒 |
| S11 | 寄送失敗、排程發布失敗 | 狀態頁列出筆數與連結，但**不計入**系統「要注意」數 | 總覽本來就各有一行（`failed_notifications`、`failed_publish_jobs`），不重複提醒 |
| S12 | 重新整理 | 進頁讀一次，有「重新整理」按鈕；**不自動輪詢** | DESIGN.md 已否決後台固定輪詢 |
| S13 | 多副本 | 背景迴圈狀態讀「回應這次請求的程序」記憶體裡的 loop 物件；畫面不另作說明 | 正式站目前單一副本（`deploy/README.md:1926`；素材存 volume 時只能單一實例 :1349）。日後改多副本要重新設計這一區 |

### 1.3 不做

- 顯示或修改環境變數原值；在後台改任何設定（設定仍在 Railway）。
- 自動輪詢、推播或寄信通知系統異常、保存歷史狀態（只看現在）。
- 多副本彙整。
- LINE 測試推播（「LINE 通知」頁已有，`backend/app/notifications/line_routes.py:347`）、Turnstile／OAuth 實際連線測試。
- 改 `/health` 的內容或權限。

## 2. 現況（`origin/main` `aae0debc`）

- **設定**（`backend/app/config.py`）：SMTP :49-54、LINE 推播 :57-58、Turnstile :115-116、Google 登入 :41-43、LINE 登入 :44-46、S3 :31-37、背景工作 :78（`None` 時 production 60 秒、其他 0，:222-228）、轉檔 :97-98、公開資料同步 :68-75、招生開關 :63、保存政策真跑 :59。已有的布林屬性：`s3_configured` :214、`line_messaging_enabled` :218、`turnstile_enabled` :236、`google_oauth_enabled` :246、`line_oauth_enabled` :250。SMTP 沒有屬性，各處寫 `bool(settings.smtp_host)`（例如 `booking/routes.py:132`）。
- **迴圈狀態**（只在記憶體，重啟歸零；`main.py:179-181` 掛在 `app.state`）：`MaintenanceLoop`（`workers/maintenance.py:276-278`）有 `last_completed_at`、`last_clean_at`、`last_failed_steps`（只存步驟名，錯誤只進 logger）；步驟名 `publish_jobs`、`extend_slots`、`reminders`、`outbox`、`rate_limits`、`purge_media`、`retention`。`MediaJobLoop`（`workers/media_loop.py:45-58`）有 `last_processed_at`、`last_failed_at`。`GeoSyncLoop`（`workers/geo_loop.py:41-42`）有 `last_result`、`last_run_at`，沒有任何 API 讀它。
- **公開資料**：`geo_dataset_status` 欄位 `dataset`、`active_version`、`label`、`synced_at`、`checked_at`、`last_attempt_at`、`last_error`、`baseline_on`；九種 dataset（`geo/models.py:51-61`）。
- **可重用的查詢**：寄送失敗 `notifications/outbox_admin.py:92-95` `count_failed`；排程發布失敗未處理 `content/publish_jobs.py:154-164` `unresolved_condition()`；轉檔佇列沒有計數函式（`media_jobs.status` pending／running／done／failed，`media/models.py:152-184`）。
- **總管理者專用頁**：側欄 `admin/src/router/nav.ts:121-135` 的「系統」群組，項目標 `roles: ['super_admin']`；後端一律 `Depends(get_current_user)`＋函式內 `require_scope(current_user, "<capability>")`（`auth/permissions.py:131-146`），新權限加進 `_CAPABILITY_ROLES`（:23-80）。
- **寄信 adapter**：`notifications/email_adapter.py` 的 `get_email_adapter(sink_dir, settings)`，`send(*, to, subject, body)` 是同步函式；沒有 SMTP 也沒有 sink 時拋 `EmailNotConfigured`。
- **限流**：`common/ratelimit.py` 的 `RateLimiter`（`limiter(request)`）。**操作紀錄**：`operations/audit_service.py:32` `log_action`。

## 3. 設計

### 3.1 後端

- 新模組 `backend/app/operations/system_status.py`：`async def build_status(db, app_state, settings, now) -> SystemStatus`，以及 `attention_count(status) -> int`。純讀，不寫任何東西。
- 新端點（`backend/app/operations/routes.py`）：
  - `GET /admin/system-status` → `SystemStatusOut`；`require_scope(user, "system.status")`。
  - `POST /admin/system-status/test-email` → `TestEmailOut`；同權限；§3.4。
- `/admin/dashboard` 回應加 `system_attention: int | None`：有 `system.status` 才算，其他人一律 `None`。用同一個 `build_status`。
- 新權限 `system.status`：`{Role.SUPER_ADMIN}`；`test_permission_table.py` 跟著更新。
- 回應形狀（每一列一個 `StatusItem`：`key`、`level`（`ok`｜`attention`｜`info`｜`off`）、`detail`（結構化欄位，不含文案；文案在前端）、`action`（前端導向用的 key，可空））：

```
services:      smtp, line_messaging, turnstile, google_login, line_login, media_storage,
               admissions, geo_auto_sync, retention_auto_run
background:    maintenance, media_jobs, geo_sync_loop
datasets:      doorplates, kindergartens, babycare, population, births, migration,
               income, new_homes            （招生開關關閉時整區不回）
notifications: failed_outbox, failed_publish_jobs
generated_at, attention_count
```

### 3.2 各列的判斷

| 列 | ok | attention | info／off |
|---|---|---|---|
| smtp | 有 `smtp_host` | 沒有 `smtp_host`（production）；`detail` 帶 host、port、security、from | 非 production 只有 sink → info「寫入本機資料夾」 |
| line_messaging、turnstile、google_login、line_login | 已設定 | — | 未設定 → info |
| media_storage | — | — | info：`local`（本機 volume）或 `s3` |
| admissions、geo_auto_sync | — | — | 開 → info「開啟」；關 → off |
| retention_auto_run | — | — | 兩個開關（`retention_allow_real_run` 與 DB 政策 `auto_run_enabled`）都開 → info「開啟」；其他 → off，`detail` 說明是哪一個沒開 |
| maintenance | 一輪內完成且無失敗步驟 | 停擺（S8）或 `last_failed_steps` 非空（`detail.failed_steps`） | 間隔 0 → off |
| media_jobs | 無失敗 | `media_jobs` 有 `failed` 列；`detail` 帶 pending／running／failed 筆數與 `last_processed_at` | 轉檔模式 inline → info |
| geo_sync_loop | 迴圈在跑且 `last_run_at` 在 26 小時內 | 開著但超過 26 小時沒有結果 | 未開 → off |
| 各 dataset | 有資料、沒錯誤、沒過期 | `last_error` 非空，或過期（S6、S7） | 從未匯入 → info「尚未匯入」 |
| failed_outbox、failed_publish_jobs | 0 | — | 有筆數時 level 用 `info`（S11），`detail.count` |

`attention_count` ＝ level 為 `attention` 的列數。

### 3.3 畫面（`admin/src/views/SystemStatusView.vue`）

- 路由 `/system-status`，側欄「系統」群組加一項「系統狀態」（`roles: ['super_admin']`，icon `Monitor`，keywords：寄信、SMTP、排程、同步、設定、健康），排在「個資與搜尋設定」前面。
- 頁首：標題、「資料時間 HH:MM」、「重新整理」按鈕。
- 四張卡（手機單欄）：每一列＝名稱、狀態標籤（正常／要注意／資訊／關閉，顏色走 token）、一句說明、處理連結：
  - 寄送失敗 → `/notifications`（寄送失敗清單）；排程發布失敗 → `/releases?tab=schedules`；轉檔失敗 → `/media`；公開資料 → `/admissions?tab=stats&sub=area`。
  - 門牌過期的說明寫「請到電腦上用匯入指令更新門牌（每月一次）」，不寫指令本身。
- 寄信那一列旁有「寄一封測試信給我」按鈕（§3.4）。沒有 SMTP 也沒有 sink 時按鈕停用，旁邊寫「尚未設定寄信」。
- 中文對照（步驟名、dataset 名、level）放 `admin/src/api/labels.ts`，`labelCoverage.test.ts` 比對後端常數。
- 營運總覽（`DashboardView.vue`「要處理」）：`system_attention > 0` 時多一行「系統狀態有 N 項要注意」，連到 `/system-status`；`hasTasks` 條件要納入它。

### 3.4 測試信

- 收件人＝目前登入者的 `users.email`（NOT NULL）。主旨「【常春藤官網後台】測試信」；內文寫寄出時間（台北）與環境名稱。不走 outbox，直接用 `get_email_adapter` 送出（在 thread 裡跑，逾時 20 秒）。
- 回應 `{ok: bool, error: 'not_configured'|'auth_failed'|'connect_failed'|'rejected'|'timeout'|'other'|null}`，由例外類型對應（`smtplib.SMTPAuthenticationError`、`SMTPConnectError`／`OSError`、`SMTPRecipientsRefused`／`SMTPSenderRefused`、逾時），**不回原始錯誤訊息**。沒有 adapter → 409 `EMAIL_NOT_CONFIGURED`。
- 限流：每位使用者 10 分鐘 3 次，超過 429，中文訊息「測試信寄太多次了，請 10 分鐘後再試」。
- 操作紀錄：`system.test_email`，metadata 只有 `{result: 'ok'|<error>}`（不記 Email）。`labels.ts` 補動作與 metadata 中文。
- 畫面：成功顯示「已寄到 a***@example.com，請到信箱確認」（遮罩規則沿用後台既有的 Email 遮罩，沒有就前 1 字＋***）；失敗顯示對應中文原因。

## 4. 測試

- 後端 `backend/tests/test_system_status.py`：
  - 權限：未登入 401；校區管理者、櫃台 403；總管理者 200。
  - 各設定組合下每列的 level（用 `Settings` 覆寫）；回應全文**不含**設定好的密碼、secret、token 值。
  - 維護排程：注入假 loop 狀態，驗 ok／停擺／失敗步驟三種；間隔 0 → off。
  - 公開資料：門牌 34／36 天、一般 dataset 33／34 天、托嬰 10／11 天的邊界；`last_error` 非空；招生開關關閉時沒有 `datasets`。
  - 轉檔：有 failed 列 → attention。
  - `attention_count` 與 `/admin/dashboard` 的 `system_attention`：總管理者有值、校區管理者為 `None`。
  - 測試信：recording adapter 成功並寫操作紀錄；各例外對應 error；無 adapter 409；第 4 次 429；操作紀錄 metadata 不含 Email。
- admin vitest：狀態頁各 level 渲染、測試信成功與失敗提示、側欄只有總管理者看得到（沿用 `sidebarNav20261005.test.ts` 的寫法）、總覽多一行、`labelCoverage`。
- stack e2e（一支）：總管理者打開系統狀態頁、按重新整理；櫃台帳號側欄沒有這一項、直接開網址被導回。
- 契約：重新產生 `contracts/openapi.json` 與型別（依 `docs/website-admin/README.md` 的做法；`npm run contract:check` 內的 `uv run` 會改動所用 venv 的 `.pth`，worktree 借用別人的 `backend/.venv` 時要先建自己的 venv 再跑）。

## 5. 部署與風險

- 不新增 migration、不新增環境變數。
- 上線後請使用者登入正式後台看一次；寄信若已設定，按測試信（會寄一封真信到使用者自己的帳號，由使用者自己按）。
- 風險：日後改多副本時，背景迴圈那一區會只反映其中一個副本（S13）。

## 6. 與其他工作的關係

- 「參觀提醒信」：狀態頁的寄信列可以確認提醒信寄不寄得出去；兩案不共用檔案。
- 不碰招生、預約資料，與第 2、3 波無衝突。
