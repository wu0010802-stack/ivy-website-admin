# 後台第 1 波：系統狀態頁＋家長參觀提醒信 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 總管理者在後台「系統 → 系統狀態」一頁看到寄信、推播、背景排程、轉檔、公開資料與寄送／發布失敗的現況（含寄測試信、營運總覽一行提示）；已確認且有 Email 的參觀，在開始前 24 小時寄一封提醒信給家長。

**Architecture:** 後端新模組 `backend/app/operations/system_status.py` 只讀設定、`app.state` 上的背景迴圈物件與幾張表，組成 `SystemStatusOut`；`operations/routes.py` 加兩支端點（讀狀態、寄測試信）並讓 `/admin/dashboard` 多一個 `system_attention`。提醒信沿用既有家長信管線：新 kind `parent_visit_reminder` 進 `PARENT_KINDS`，由 `notifications/service.py::_dispatch_parent_email` 寄，由 `notifications/reminders.py` 的新函式在維護排程的「提醒」步驟排入。**不新增 migration、不新增環境變數、`/health` 不動。**

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、PostgreSQL、pytest（asyncio auto）；Vue 3 + TypeScript + Element Plus、vitest；Playwright stack e2e；openapi-typescript 契約。

**Spec:** `docs/specs/2026-10-15-admin-system-status-design.md`、`docs/specs/2026-10-15-parent-visit-reminder-design.md`（兩份都經使用者 10-15 核可）。基準 `origin/main` `aae0debc`（migration head `c6a9e3f15d27`）。

> **分支說明**：兩份規格的「分支（實作）」欄各寫了自己的分支（`feature/system-status-20261015`、`feature/parent-reminder-20261015`），**本計畫合為一支 `feature/admin-wave1-20261015`**（10-15 決定一波一支）；Task 7 會在兩份規格補「實作紀錄」寫明。

## 共通規則與指令

- 繁體中文（台灣用語），技術名詞與識別符保留原文；commit 訊息繁體中文、Conventional Commit，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；`git add` 一律列出檔名（**禁止** `git add .`、`-A`、`commit -a`）；不要 push。
- 顏色一律走 token（`var(--…)` 或 Element Plus 的 tag type），不寫 rgba／oklch／hex 字面值；畫面不放開發輔助用字（操作說明只寫處理方式）。
- 一次只跑一組測試（機器 8GB RAM）；子代理不跑後端全套 pytest、admin 全套 vitest、stack 全套（超過 10 分鐘會被 watchdog 殺，由控制者在 Task 8 背景分開跑）。
- worktree：`~/Repositories/ivy-website-wt/admin-wave1-20261015`（分支 `feature/admin-wave1-20261015`），以下指令都從它的根目錄出發。
- 後端測試指令（`<DB>`＝控制者備好的 `ivy_website_wave1_1015_test`，已升到 head）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<DB> WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <檔案或 node id>`（`WEBSITE_*` 必須逐一寫在同一行）。以下簡寫為 `PYTEST <檔案>`。
- 前端指令：`cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run <檔案>`、`npm run typecheck`（用分號串接，`source nvm.sh` 會 exit 3，不要用 `&&`）；高負載下遇到 `Test timed out in 5000ms` 加 `--testTimeout=60000` 重跑並在報告寫明。以下簡寫為 `VITEST <檔案>`。
- 契約：**不要用 `npm run contract:check`／`contract:generate`**（它們呼叫 `uv run`，會改到共用 venv 的 `.pth`）。用：
  檢查 `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs`；
  重新產生 `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd ..; source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`。

## Global Constraints

（逐字或近逐字取自兩份規格；每個 task 都隱含這一節。）

**系統狀態頁**
- **S1 對象**：只有總管理者。新權限 `system.status`，只給 `super_admin`。
- **S5 嚴重度**：兩級：**要注意**（寄信沒設、維護排程停擺或有失敗步驟、轉檔失敗、公開資料同步失敗或過期）與**資訊**（Turnstile、Google／LINE 登入、LINE 推播、素材儲存方式、各開關的開／關）。
- **S6 門牌到期**：門牌 `synced_at` 距今超過 **35 天**＝要注意「門牌超過 35 天沒換版，請手動匯入新版」。
- **S7 其他公開資料過期**：`checked_at`、`synced_at` 取較新者，距今超過「該資料更新週期＋3 天」＝過期（要注意）；一般 30 天（`geo/sync.py` `REFRESH_AFTER`）、幼兒園與托嬰 7 天（`geo/providers.py` `PROVIDER_REFRESH_AFTER`）；出生、遷徙也用 30 天；`campuses` 不列。
- **S8 維護排程停擺**：背景工作開著時，`last_completed_at` 距今超過 max(5 分鐘, 5×間隔)，或程序啟動超過該時間仍沒有完成過一輪＝要注意；背景工作關閉（0）顯示「關閉」。
- **S9 錯誤原文**：維護排程與轉檔只顯示哪一步失敗，不顯示錯誤原文；公開資料顯示 `last_error`（≤300 字）。
- **S10 寄信設定顯示**：顯示主機、port、加密方式、寄件地址；不顯示帳號與密碼。非 production 用 sink 時顯示「寫入本機資料夾（測試用）」。
- **S11**：寄送失敗、排程發布失敗列出筆數與連結，但**不計入**系統「要注意」數。
- **S12**：進頁讀一次，有「重新整理」按鈕；**不自動輪詢**。
- **S13**：背景迴圈狀態讀「回應這次請求的程序」記憶體裡的 loop 物件。
- **測試信（§3.4）**：收件人＝目前登入者的 `users.email`；主旨「【常春藤官網後台】測試信」；不走 outbox，直接用 `get_email_adapter` 送出（thread 裡跑，逾時 20 秒）；回應 `{ok, error}`，error ∈ `not_configured|auth_failed|connect_failed|rejected|timeout|other`，**不回原始錯誤訊息**；沒有 adapter → 409 `EMAIL_NOT_CONFIGURED`；每位使用者 10 分鐘 3 次，超過 429「測試信寄太多次了，請 10 分鐘後再試」；操作紀錄 `system.test_email`，不記 Email。
- **總覽**：`/admin/dashboard` 加 `system_attention: int | None`，有 `system.status` 才算，其他人一律 `None`；`system_attention > 0` 時「要處理」多一行「系統狀態有 N 項要注意」連到 `/system-status`。
- **不做（§1.3）**：顯示或修改環境變數原值、在後台改設定；自動輪詢、推播或寄信通知系統異常、保存歷史狀態；多副本彙整；LINE 測試推播、Turnstile／OAuth 實際連線測試；改 `/health`。

**家長參觀提醒信**
- **R1** 開始前 24 小時（`UPCOMING_VISIT_LEAD`，與員工提醒同一個常數）。**R2** 只寄 Email。
- **R3** 狀態已確認、未匿名化、有 Email 的案件；官網預約與後台補登都算。
- **R4** 確認時間或最後一次改期時間晚於「開始前 24 小時」就不寄。
- **R5** 去重鍵 `parent_visit_reminder:{案件 id}:{場次 id}`；改期換場次就是新鍵。
- **R6** 寄出前：狀態仍是已確認、場次沒變（payload 的 `slot_id`）、還沒開始、那天不是停課日、未匿名化；任一不符就 skipped。
- **R7** 寄出當下 `parent_change_open` 為真才附修改連結與截止時間；否則寫「要改期或取消，請來電 〇〇」；連結重算不出來也改寫「請來電」。
- **R8** 依寄出當下的台北日期寫「明天」或「今天」。**R9** 不寫 `visit_request_events`。**R10** 沿用家長信「排進佇列超過 24 小時就作廢」。
- 後台 kind 中文「參觀提醒（家長）」。
- **不做**：簡訊、LINE、站內通知給家長；第二封提醒、自訂提醒時間、各校開關、家長退訂；在信裡放孩子資料或完整電話。

## 計畫裁定（Plan Rulings）

| # | 裁定 | 理由 |
|---|---|---|
| P1 | 兩份規格合一支分支 `feature/admin-wave1-20261015`；順序：系統狀態頁（Task 1–3）→ 提醒信（Task 4–5） | 計畫階段裁定（使用者 10-15 同意「一波一份計畫」，分支跟著計畫走）；兩案不共用檔案（只共用 `notifications/service.py` 的 import 區，不衝突） |
| P2 | `MaintenanceLoop`、`GeoSyncLoop` 各加 `started_at`（`start()` 時記錄） | 規格 S8 的「程序啟動超過該時間仍沒有完成過一輪」需要啟動時間，兩個 loop 原本都沒有 |
| P3 | 「轉檔失敗」看**素材狀態**：`media_assets.status = 'failed'` 且 `deleted_at IS NULL` 的筆數；佇列只算 `media_jobs` 的 pending／running | 規格 §3.2 寫「`media_jobs` 有 `failed` 列」，但失敗列在按「重新處理」後不會消失（另建新工作），會讓這列永遠紅；素材庫的「處理失敗」也是看素材狀態 |
| P4 | 門牌列：`synced_at` 超過 35 天**或** `last_error` 非空都算要注意，畫面兩種情況都寫「請到電腦上用匯入指令更新門牌（每月一次）」 | 正式站自動下載連不到 data.kcg.gov.tw（deploy/README.md:781），每 30 天一次的自動嘗試必定留下 `last_error`；寫成「同步失敗」會誤導，真正要做的是手動匯入 |
| P5 | 測試信的操作紀錄 metadata：成功 `{"result": "sent"}`；失敗 `{"result": "failed", "error_code": <例外類別名>}`；`target_type="user"`、`target_id`＝自己 | 規格寫 `{result: 'ok'|<error>}`；改用既有的 `error_code` 鍵（後台已有「寄送失敗原因」翻譯，同重設密碼連結）；兩個分支各一個字面值 dict，`labelCoverage` 解析得到 |
| P6 | 家長提醒用新函式 `reminders.enqueue_due_parent_reminders(db, now)`，和 `enqueue_due_reminders` 共用私有的到點判斷 `_due_upcoming`；維護排程「提醒」步驟依序呼叫兩者；`CycleResult` 多 `parent_reminders_enqueued` | 規格 §3.1 要「同一次掃描、計數分開記」；保留 `enqueue_due_reminders` 回傳員工則數，現有 9 個斷言不必改 |
| P7 | 新 kind 常數 `PARENT_VISIT_REMINDER` 放 `booking/outbox.py`（和其他家長信一起），**不放** `reminders.py`；`REMINDER_KINDS` 不變 | `labelCoverage.test.ts` 斷言 `reminders.py` 的 `*_KIND` 常數只有 `visit_upcoming`、`test_only_the_upcoming_visit_reminder_remains` 斷言 `REMINDER_KINDS == {visit_upcoming}`；家長信本來就走 `PARENT_KINDS` 分派 |
| P8 | 提醒信 Task 4 先做「寄送」（kind、信件內容、寄送判斷），Task 5 才做「排入」 | 先排入的話，Task 4 之前排進去的列會被 `_dispatch_parent_email` 拿到、`_TITLES` 查不到而 KeyError；反過來每個 commit 都可運作 |
| P9 | `SystemStatusItem.detail` 型別是 `dict[str, Any]`（契約上是任意物件），各列的鍵寫在 Task 1 的表裡；前端文案都在 `admin/src/utils/systemStatusFormat.ts` | 列的種類多、各自欄位不同，逐一開 schema 不划算；後端不送文案（規格 §3.1「文案在前端」） |
| P10 | 營運總覽算 `system_attention` 失敗時（例外）記 log、`rollback`、回 `None`，總覽照常 200 | 總覽每 30 秒背景重讀，系統狀態查詢壞掉不能拖垮整個總覽（見 Review Focus 5） |
| P11 | 公開資料清單在程式裡**動態**取 `DATASETS`（扣掉 `campuses`），未知 dataset 的更新週期用 30 天；前端測試解析後端 `DATASETS` 要求每項都有中文 | 同日 peer-comparison、kindergarten-registry、enrolled-map 在途，可能新增 dataset；新增時測試會紅、提醒補中文與週期 |
| P12 | 公開資料同步迴圈停擺門檻＝`geo_sync_check_seconds`＋2 小時（預設 26 小時） | 規格 §3.2 寫「26 小時」；檢查間隔可設到 7 天，固定 26 小時會誤報 |
| P13 | 寄送與排程發布失敗的筆數：寄送用 `outbox_admin.count_failed(db, None)`；排程發布用總覽同一個條件（`status = 'failed'` 且 `unresolved_condition()`） | 和總覽的數字一致（規格 S11 要求連到原本的處理頁，數字也該對得上） |

## Review Focus

（規格沒有直接說、但最可能咬到使用者的情況；每一條都有 task 內的測試釘住。）

1. **正式站門牌自動下載必定失敗**：`last_error` 會在換版約 30 天後出現；畫面必須叫人「手動匯入」，而不是只寫「同步失敗」或沒反應。→ Task 1 `test_doorplate_error_is_attention_even_before_35_days`；Task 3 `門牌要注意時一律寫手動匯入`。
2. **剛部署或重啟**：loop 已建立但 `last_completed_at`／`last_run_at` 還是 `None`，不能一上線就報停擺；啟動超過門檻仍沒跑完才報。→ Task 1 `test_maintenance_just_started_is_not_stalled`、`test_geo_loop_levels`。
3. **素材按過「重新處理」**：舊的 failed 工作列還在，不能讓轉檔列永遠「要注意」。→ Task 1 `test_old_failed_job_rows_do_not_keep_media_red`（P3）。
4. **提醒信的修改期限**：期限 24（預設）或更長 → 寄出時已過期，寫「請來電」不附連結；期限 12 → 附連結與截止時間；連結重算不出來 → 寫「請來電」。→ Task 4 `test_reminder_past_the_default_deadline_asks_to_call`、`test_reminder_inside_a_shorter_deadline_links_the_manage_page`、`test_reminder_without_admin_origin_asks_to_call`。
5. **總覽不能被系統狀態拖垮**：系統狀態查詢拋例外時，總覽仍 200，`system_attention` 為 `None`。→ Task 2 `test_dashboard_survives_a_failing_system_status`（P10）。

## File Structure

後端
- Create `backend/app/operations/system_status.py`：各列判斷（`service_items`、`maintenance_item`、`media_item`、`geo_loop_item`、`dataset_item`、`dataset_items`、`notification_items`）、`build_status`、測試信（`mail_adapter`、`build_test_email`、`classify_email_error`、常數）、回應模型（Task 1；測試信部分 Task 2）。
- Modify `backend/app/workers/maintenance.py`（`started_at`；Task 5 再加家長提醒計數）、`backend/app/workers/geo_loop.py`（`started_at`）。
- Modify `backend/app/operations/routes.py`（兩支端點、總覽 `system_attention`）、`backend/app/auth/permissions.py`（`system.status`）。
- Modify `backend/app/booking/outbox.py`（`PARENT_VISIT_REMINDER`）、`backend/app/notifications/parent_email.py`（提醒信內容）、`backend/app/notifications/service.py`（寄送判斷、kind 中文）、`backend/app/notifications/reminders.py`（排入）、`backend/app/cli.py`（列印）。
- Create `backend/tests/test_system_status.py`（Task 1、2）、`backend/tests/test_parent_visit_reminder.py`（Task 4、5）；Modify `backend/tests/test_permission_table.py`。
- Modify `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重新產生）。

前端（`admin/src/`）
- Create `utils/systemStatusFormat.ts`（中文、說明句、連結）、`views/SystemStatusView.vue`。
- Modify `router/nav.ts`（側欄項目）、`router/index.ts`（路由）、`components/AdminSidebar.vue`（`Monitor` 圖示）、`api/types.ts`（型別）、`api/labels.ts`（操作紀錄動作與 `result` 鍵、提醒信 kind）、`views/DashboardView.vue`（總覽一行）、`__tests__/fixtures.ts`（`system.status`）。
- Create `__tests__/systemStatus.test.ts`。

e2e／文件
- Create `tests/stack/system-status.spec.ts`。
- Modify `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`、`docs/website-admin/operations.md`、兩份規格（實作紀錄）。

## Task 0：環境（控制者先備，不交給實作者）

- [ ] **Step 1：開 worktree（從規格分支開出，rebase 到最新 main）**

```bash
cd ~/Desktop/ivy-website-admin
git fetch origin
git worktree add --no-checkout -b feature/admin-wave1-20261015 ~/Repositories/ivy-website-wt/admin-wave1-20261015 docs/admin-batch-specs-20261015
cd ~/Repositories/ivy-website-wt/admin-wave1-20261015
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout -q
git rebase origin/main
git log --oneline origin/main..HEAD
```

預期：只有規格分支的 docs commit（規格六份、狀態標記、本計畫）在 main 之上；rebase 無衝突（只動 `docs/`）。

- [ ] **Step 2：依賴**

```bash
source ~/.nvm/nvm.sh; nvm use 22
npm ci; (cd admin && npm ci); (cd web && npm ci)
(cd backend && uv sync --frozen)
ls backend/.venv/bin/python
```

`backend/.venv` 必須是這個 worktree 自己的（不要 symlink 別人的 venv：editable 安裝會載入別的 worktree 的原始碼）。

- [ ] **Step 3：建測試庫並升到 head**

```bash
createdb ivy_website_wave1_1015_test
createdb ivy_website_wave1_1015_e2e_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave1_1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave1_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
uv run --frozen alembic heads
```

預期：單一 head（`c6a9e3f15d27`，或 main 上更新的 head；本案不加 migration，head 是誰都可以）。e2e 用 `E2E_DB_NAME=ivy_website_wave1_1015_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751`。

- [ ] **Step 4：對照當下 main 的公開資料清單（P11）**

```bash
grep -n "^DATASETS = (" -A14 backend/app/admissions/geo/models.py
grep -rn "REFRESH_AFTER = \|_REFRESH_AFTER = " backend/app/admissions/geo/*.py
```

預期（aae0debc）：`doorplates, kindergartens, campuses, population, births, migration, income, new_homes, babycare`。**多出新 dataset 時**：記下名稱與它在同步程式裡的更新週期常數，交給 Task 1（`_DATASET_REFRESH` 補一項；週期是 30 天就不用補）與 Task 3（`DATASET_LABELS` 補中文）。

---

### Task 1：系統狀態的判斷核心（`system_status.py`）

**Files:**
- Create: `backend/app/operations/system_status.py`
- Modify: `backend/app/workers/maintenance.py:276-290`（`__init__`、`start`）、`backend/app/workers/geo_loop.py:28-48`（同）
- Test: `backend/tests/test_system_status.py`（新檔，本 task 寫前半）

**Interfaces:**
- Consumes：`Settings`（`config.py`）的屬性 `background_jobs_interval`、`media_video_processing_mode`、`line_messaging_enabled`、`turnstile_enabled`、`google_oauth_enabled`、`line_oauth_enabled`；`DATASETS`、`GeoDatasetStatus`（`admissions/geo/models.py`）；`REFRESH_AFTER`（`geo/sync.py:89`）、`PROVIDER_REFRESH_AFTER`（`geo/providers.py:35`）；`outbox_admin.count_failed(db, None)`；`publish_jobs.unresolved_condition()`。
- Produces（Task 2、3 依賴）：
  - `SystemStatusItem(key: str, level: Literal["ok","attention","info","off"], detail: dict[str, Any])`
  - `SystemStatusOut(generated_at: datetime, attention_count: int, services: list[SystemStatusItem], background: list[SystemStatusItem], datasets: list[SystemStatusItem] | None, notifications: list[SystemStatusItem])`
  - `async def build_status(db: AsyncSession, state: Any, settings: Settings, now: datetime) -> SystemStatusOut`（`state` 是 `request.app.state`，讀 `maintenance`、`media_jobs`、`geo_sync` 三個屬性，可為 `None`）
  - `MaintenanceLoop.started_at`、`GeoSyncLoop.started_at`：`datetime | None`

各列的 `detail` 鍵（前端 Task 3 依這張表寫文案）：

| 區 | key | detail |
|---|---|---|
| services | `smtp` | ok：`{host, port, security, sender}`；sink：`{sink: true}`；沒設：`{}` |
| services | `line_messaging`、`turnstile`、`google_login`、`line_login` | `{configured: bool}` |
| services | `media_storage` | `{storage: "local"\|"s3"}` |
| services | `admissions`、`geo_auto_sync` | `{enabled: bool}`（`geo_auto_sync` 的 enabled＝招生開關且同步開關） |
| services | `retention_auto_run` | `{env_allowed: bool, policy_enabled: bool}` |
| background | `maintenance` | `{running, interval_seconds, stale_minutes, last_completed_at, last_clean_at, failed_steps: [str], stalled}`；off 時 `{running: false}` |
| background | `media_jobs` | background：`{mode: "background", loop_running, pending, running, failed_assets, last_processed_at}`；inline：`{mode: "inline"}` |
| background | `geo_sync_loop` | `{running, stale_hours, stalled, last_run_at}`；off 時 `{running: false}` |
| datasets | 各 dataset 名 | 匯入過：`{imported: true, label, synced_at, checked_at, error, stale, stale_days}`；沒有：`{imported: false, error, stale: false}` |
| notifications | `failed_outbox`、`failed_publish_jobs` | `{count: int}` |

- [ ] **Step 1：寫失敗的測試**

建立 `backend/tests/test_system_status.py`：

```python
"""總管理者系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）。

前半（Task 1）：各列的判斷，純函式與讀庫。後半（Task 2）：API、權限、測試信、總覽數字。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.admissions.geo.models import DATASETS, GeoDatasetStatus
from app.booking.models import OutboxMessage
from app.media.models import MediaJob, MediaStatus
from app.operations import system_status
from tests.conftest import legacy_request
from tests.test_media_list_paging import _asset

NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)


def _settings(app, **changes):
    # model_copy 不跑驗證：可以直接造出「production 沒設寄信」之類的組合。
    return app.state.settings.model_copy(update=changes)


def _by_key(items):
    return {item.key: item for item in items}


def _maintenance_loop(*, completed=None, clean=None, failed=(), started=None):
    return SimpleNamespace(last_completed_at=completed, last_clean_at=clean, last_failed_steps=list(failed), started_at=started)


def _geo_loop(*, running=True, last_run=None, started=None):
    return SimpleNamespace(running=running, last_run_at=last_run, started_at=started)


def _status(dataset: str, **fields) -> GeoDatasetStatus:
    return GeoDatasetStatus(dataset=dataset, **fields)


# --- 對外服務設定 -------------------------------------------------------------


async def test_smtp_row_shows_host_and_sender_but_never_credentials(app):
    settings = _settings(
        app, smtp_host="smtp.example.com", smtp_port=465, smtp_security="ssl", smtp_from="noreply@ivy.example",
        smtp_username="smtp-user-secret", smtp_password="smtp-pass-secret",
    )
    smtp = _by_key(system_status.service_items(settings, policy_auto_run=False))["smtp"]
    assert smtp.level == "ok"
    assert smtp.detail == {"host": "smtp.example.com", "port": 465, "security": "ssl", "sender": "noreply@ivy.example"}


async def test_missing_smtp_is_attention_only_in_production(app):
    prod = _settings(app, environment="production", smtp_host=None, notification_email_sink_dir=None)
    assert _by_key(system_status.service_items(prod, policy_auto_run=False))["smtp"].level == "attention"
    sink = _settings(app, smtp_host=None, notification_email_sink_dir="/tmp/ivy-website-test-mail")
    row = _by_key(system_status.service_items(sink, policy_auto_run=False))["smtp"]
    assert (row.level, row.detail) == ("info", {"sink": True})
    bare = _settings(app, smtp_host=None, notification_email_sink_dir=None)
    assert _by_key(system_status.service_items(bare, policy_auto_run=False))["smtp"].level == "info"


async def test_optional_services_are_never_attention(app):
    rows = _by_key(system_status.service_items(_settings(app, turnstile_site_key=None, turnstile_secret_key=None), policy_auto_run=False))
    for key in ("line_messaging", "turnstile", "google_login", "line_login", "media_storage", "admissions", "geo_auto_sync", "retention_auto_run"):
        assert rows[key].level != "attention", key
    assert rows["turnstile"].detail == {"configured": False}
    on = _by_key(system_status.service_items(_settings(app, turnstile_site_key="site", turnstile_secret_key="secret"), policy_auto_run=False))
    assert on["turnstile"].level == "ok"
    assert rows["media_storage"].detail == {"storage": "local"}


async def test_switches_report_on_or_off(app):
    off = _by_key(system_status.service_items(
        _settings(app, admissions_enabled=False, geo_auto_sync=True, retention_allow_real_run=True), policy_auto_run=False,
    ))
    assert off["admissions"].level == "off"
    # 招生關閉時同步迴圈不會啟動（main.py:148），所以算關閉。
    assert (off["geo_auto_sync"].level, off["geo_auto_sync"].detail) == ("off", {"enabled": False})
    assert (off["retention_auto_run"].level, off["retention_auto_run"].detail) == ("off", {"env_allowed": True, "policy_enabled": False})
    on = _by_key(system_status.service_items(
        _settings(app, admissions_enabled=True, geo_auto_sync=True, retention_allow_real_run=True), policy_auto_run=True,
    ))
    assert (on["admissions"].level, on["geo_auto_sync"].level, on["retention_auto_run"].level) == ("info", "info", "info")


# --- 背景工作 -------------------------------------------------------------------


async def test_maintenance_off_when_interval_is_zero(app):
    item = system_status.maintenance_item(_settings(app, background_jobs_interval_seconds=0), None, NOW)
    assert (item.level, item.detail) == ("off", {"running": False})


async def test_maintenance_ok_stalled_and_failed(app):
    settings = _settings(app, background_jobs_interval_seconds=60)
    ok = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=1), clean=NOW - timedelta(minutes=1)), NOW)
    assert ok.level == "ok"
    assert ok.detail["stale_minutes"] == 5
    stalled = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=6)), NOW)
    assert stalled.level == "attention" and stalled.detail["stalled"] is True
    failed = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW, failed=["outbox"]), NOW)
    assert failed.level == "attention" and failed.detail["failed_steps"] == ["outbox"] and failed.detail["stalled"] is False
    assert system_status.maintenance_item(settings, None, NOW).level == "attention"


async def test_maintenance_just_started_is_not_stalled(app):
    settings = _settings(app, background_jobs_interval_seconds=60)
    fresh = system_status.maintenance_item(settings, _maintenance_loop(started=NOW - timedelta(minutes=2)), NOW)
    assert fresh.level == "ok"
    never = system_status.maintenance_item(settings, _maintenance_loop(started=NOW - timedelta(minutes=6)), NOW)
    assert never.level == "attention" and never.detail["stalled"] is True


async def test_maintenance_threshold_follows_long_intervals(app):
    settings = _settings(app, background_jobs_interval_seconds=600)
    item = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=40)), NOW)
    assert item.level == "ok" and item.detail["stale_minutes"] == 50


async def test_geo_loop_levels(app):
    assert system_status.geo_loop_item(_settings(app, geo_auto_sync=False), None, NOW).level == "off"
    settings = _settings(app, admissions_enabled=True, geo_auto_sync=True, geo_sync_check_seconds=86400)
    assert system_status.geo_loop_item(settings, None, NOW).level == "attention"
    assert system_status.geo_loop_item(settings, _geo_loop(running=False, started=NOW), NOW).level == "attention"
    ok = system_status.geo_loop_item(settings, _geo_loop(last_run=NOW - timedelta(hours=25), started=NOW - timedelta(days=3)), NOW)
    assert ok.level == "ok" and ok.detail["stale_hours"] == 26
    late = system_status.geo_loop_item(settings, _geo_loop(last_run=NOW - timedelta(hours=27), started=NOW - timedelta(days=3)), NOW)
    assert late.level == "attention" and late.detail["stalled"] is True
    # 剛啟動、第一輪還沒跑完（30 秒後才開始）：不算停擺。
    fresh = system_status.geo_loop_item(settings, _geo_loop(started=NOW - timedelta(minutes=1)), NOW)
    assert fresh.level == "ok"


async def test_media_failed_assets_and_queue(app, db_session):
    settings = _settings(app, media_video_processing="background")
    loop = SimpleNamespace(running=True, last_processed_at=NOW)
    assert (await system_status.media_item(db_session, settings, loop)).level == "ok"
    await _asset(db_session, "broken.mp4", status=MediaStatus.FAILED)
    await _asset(db_session, "gone.mp4", status=MediaStatus.FAILED, deleted=True)
    item = await system_status.media_item(db_session, settings, loop)
    assert item.level == "attention" and item.detail["failed_assets"] == 1
    dead = await system_status.media_item(db_session, settings, SimpleNamespace(running=False, last_processed_at=None))
    assert dead.detail["loop_running"] is False and dead.level == "attention"
    inline = await system_status.media_item(db_session, _settings(app, media_video_processing="inline"), None)
    assert (inline.level, inline.detail) == ("info", {"mode": "inline"})


async def test_old_failed_job_rows_do_not_keep_media_red(app, db_session):
    media_id = await _asset(db_session, "fixed.mp4", status=MediaStatus.READY)
    db_session.add(MediaJob(
        media_id=uuid.UUID(media_id), kind="process", status="failed", next_attempt_at=NOW, created_at=NOW, error="ffmpeg",
    ))
    await db_session.commit()
    item = await system_status.media_item(
        db_session, _settings(app, media_video_processing="background"), SimpleNamespace(running=True, last_processed_at=NOW),
    )
    assert item.level == "ok" and item.detail["failed_assets"] == 0


async def test_loops_record_when_they_started(app):
    from app.workers.geo_loop import GeoSyncLoop
    from app.workers.maintenance import MaintenanceLoop

    for loop in (
        MaintenanceLoop(app.state.session_factory, app.state.settings, interval_seconds=3600),
        GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=86400),
    ):
        assert loop.started_at is None
        loop.start()
        try:
            assert loop.started_at is not None
        finally:
            await loop.stop()


# --- 公開資料 -------------------------------------------------------------------


async def test_doorplates_stale_after_35_days():
    fresh = system_status.dataset_item("doorplates", _status("doorplates", label="115-10", synced_at=NOW - timedelta(days=34)), NOW)
    assert fresh.level == "ok"
    # 門牌只看換版時間：最近確認過來源沒變也不算數（每月要手動匯入新版）。
    old = system_status.dataset_item(
        "doorplates", _status("doorplates", label="115-09", synced_at=NOW - timedelta(days=36), checked_at=NOW), NOW,
    )
    assert old.level == "attention" and old.detail["stale"] is True and old.detail["stale_days"] == 35


async def test_doorplate_error_is_attention_even_before_35_days():
    item = system_status.dataset_item(
        "doorplates", _status("doorplates", label="115-10", synced_at=NOW - timedelta(days=31), last_error="連不上 data.kcg.gov.tw"), NOW,
    )
    assert item.level == "attention"
    assert item.detail["stale"] is False and item.detail["error"] == "連不上 data.kcg.gov.tw"


@pytest.mark.parametrize(
    ("dataset", "ok_days", "stale_days"),
    [("population", 33, 34), ("births", 33, 34), ("income", 33, 34), ("kindergartens", 10, 11), ("babycare", 10, 11)],
)
async def test_other_datasets_use_refresh_plus_three_days(dataset, ok_days, stale_days):
    def row(days):
        return _status(dataset, label="x", synced_at=NOW - timedelta(days=90), checked_at=NOW - timedelta(days=days))

    assert system_status.dataset_item(dataset, row(ok_days), NOW).level == "ok"
    stale = system_status.dataset_item(dataset, row(stale_days), NOW)
    assert stale.level == "attention" and stale.detail["stale"] is True


async def test_dataset_never_imported_is_info_unless_it_failed():
    assert system_status.dataset_item("income", None, NOW).level == "info"
    failed = system_status.dataset_item("income", _status("income", last_error="HTTP 503"), NOW)
    assert failed.level == "attention" and failed.detail == {"imported": False, "error": "HTTP 503", "stale": False}


async def test_dataset_error_is_attention_even_when_fresh():
    item = system_status.dataset_item(
        "kindergartens", _status("kindergartens", label="10/14", synced_at=NOW, checked_at=NOW, last_error="HTTP 500"), NOW,
    )
    assert item.level == "attention"


async def test_dataset_list_follows_backend_datasets(db_session):
    db_session.add(GeoDatasetStatus(dataset="doorplates", label="115-10", synced_at=NOW))
    await db_session.commit()
    items = await system_status.dataset_items(db_session, NOW)
    assert [item.key for item in items] == [name for name in DATASETS if name != "campuses"]
    assert items[0].detail["label"] == "115-10"


# --- 通知與發布、整頁 -------------------------------------------------------------


async def test_failed_outbox_and_publish_jobs_are_counted_but_not_attention(db_session):
    receipt = await legacy_request(db_session, status="confirmed")
    db_session.add(OutboxMessage(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(receipt), kind="visit_request_created", payload={},
        created_at=NOW, next_attempt_at=NOW, status="failed", attempts=5,
    ))
    await db_session.commit()
    items = _by_key(await system_status.notification_items(db_session))
    assert (items["failed_outbox"].level, items["failed_outbox"].detail) == ("info", {"count": 1})
    assert (items["failed_publish_jobs"].level, items["failed_publish_jobs"].detail) == ("ok", {"count": 0})


async def test_build_status_counts_attention_and_hides_datasets_when_admissions_off(app, db_session):
    state = SimpleNamespace(maintenance=None, media_jobs=None, geo_sync=None)
    off = _settings(
        app, environment="production", smtp_host=None, notification_email_sink_dir=None,
        background_jobs_interval_seconds=0, media_video_processing="inline", admissions_enabled=False,
    )
    status = await system_status.build_status(db_session, state, off, NOW)
    assert status.datasets is None
    assert status.attention_count == 1  # 只有寄信沒設
    on = await system_status.build_status(
        db_session, state, _settings(app, admissions_enabled=True, background_jobs_interval_seconds=0, media_video_processing="inline"), NOW,
    )
    assert on.datasets is not None and len(on.datasets) == len(DATASETS) - 1
    assert on.generated_at == NOW
```

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_system_status.py`
Expected: FAIL（`ImportError: cannot import name 'system_status' from 'app.operations'`）。

- [ ] **Step 3：loop 記錄啟動時間（P2）**

`backend/app/workers/maintenance.py`：`MaintenanceLoop.__init__` 在 `self.last_failed_steps: list[str] = []` 之後加：

```python
        # 程序啟動時間：還沒跑完第一輪時，系統狀態頁用它判斷是否停擺（2026-10-15 規格 S8）。
        self.started_at: datetime | None = None
```

`start()` 改成：

```python
    def start(self) -> None:
        self.started_at = datetime.now(timezone.utc)
        self._task = asyncio.create_task(self._run(), name="maintenance-loop")
```

`backend/app/workers/geo_loop.py`：`GeoSyncLoop.__init__` 在 `self.last_run_at: datetime | None = None` 之後加同一行 `self.started_at: datetime | None = None`（註解寫「系統狀態頁判斷第一輪還沒跑完時是否停擺」），`start()` 第一行加 `self.started_at = datetime.now(timezone.utc)`（該檔已 import `datetime, timezone`；沒有就補）。

- [ ] **Step 4：寫 `system_status.py`**

建立 `backend/app/operations/system_status.py`：

```python
"""總管理者的系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）。

只讀、不寫任何資料：
- 設定只看「有沒有設」，不回傳金鑰、密碼、token；寄信例外，主機、port、加密方式與寄件地址不是秘密（S10）。
- 背景迴圈的狀態取自回應這次請求的程序記憶體（app.state 上的 loop 物件）；正式站目前單一副本（S13）。
- 維護排程與轉檔只回傳哪一步失敗，不回傳錯誤原文（可能夾帶 Email 或案件內容，S9）；公開資料的
  last_error 例外，內容是來源與 HTTP 錯誤、不含地址（GeoDatasetStatus 的說明）。
- 每一列只有 key、level 與結構化的 detail；文案在後台 utils/systemStatusFormat.ts。

營運總覽「系統狀態有 N 項要注意」用同一個 attention_count（S4）。"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import providers
from app.admissions.geo.models import DATASETS, GeoDatasetStatus
from app.admissions.geo.sync import REFRESH_AFTER
from app.config import Settings
from app.content.models import ContentItem, PublishJob
from app.content.publish_jobs import unresolved_condition
from app.media.models import MediaAsset, MediaJob, MediaStatus
from app.notifications import outbox_admin
from app.operations.models import RetentionPolicy

Level = Literal["ok", "attention", "info", "off"]

# 維護排程：超過 max(5 分鐘, 5 輪) 沒跑完一輪算停擺（S8）。
MAINTENANCE_STALE_FLOOR = timedelta(minutes=5)
MAINTENANCE_STALE_ROUNDS = 5
# 公開資料同步迴圈：超過「檢查間隔＋2 小時」沒有結果算停擺（預設 26 小時，計畫裁定 P12）。
GEO_LOOP_SLACK = timedelta(hours=2)
# 門牌每月手動匯入一次（正式站連不到來源），35 天沒換版就提醒（S6）。
DOORPLATE_STALE_AFTER = timedelta(days=35)
# 其他公開資料：同步程式的更新週期再 3 天沒動算過期（S7）；沒列的用 REFRESH_AFTER（30 天）。
DATASET_GRACE = timedelta(days=3)
_DATASET_REFRESH = {
    "kindergartens": providers.PROVIDER_REFRESH_AFTER,
    "babycare": providers.PROVIDER_REFRESH_AFTER,
}
# 同步工作內部用的指紋，畫面不讀（GeoDatasetStatus 的說明）。
HIDDEN_DATASETS = frozenset({"campuses"})


class SystemStatusItem(BaseModel):
    key: str
    level: Level
    detail: dict[str, Any] = Field(default_factory=dict)


class SystemStatusOut(BaseModel):
    generated_at: datetime
    attention_count: int
    services: list[SystemStatusItem]
    background: list[SystemStatusItem]
    # None＝招生開關關閉，整區不回（規格 §3.1）。
    datasets: list[SystemStatusItem] | None
    notifications: list[SystemStatusItem]


def service_items(settings: Settings, *, policy_auto_run: bool) -> list[SystemStatusItem]:
    """對外服務設定。寄信沒設只在 production 算要注意；其他都是選擇，不是故障（S5）。"""
    production = settings.environment == "production"
    if settings.smtp_host:
        smtp = SystemStatusItem(
            key="smtp",
            level="ok",
            detail={
                "host": settings.smtp_host,
                "port": settings.smtp_port,
                "security": settings.smtp_security,
                "sender": settings.smtp_from,
            },
        )
    elif settings.notification_email_sink_dir and not production:
        smtp = SystemStatusItem(key="smtp", level="info", detail={"sink": True})
    else:
        smtp = SystemStatusItem(key="smtp", level="attention" if production else "info")

    def configured(key: str, flag: bool) -> SystemStatusItem:
        return SystemStatusItem(key=key, level="ok" if flag else "info", detail={"configured": flag})

    def switch(key: str, enabled: bool) -> SystemStatusItem:
        return SystemStatusItem(key=key, level="info" if enabled else "off", detail={"enabled": enabled})

    retention_on = settings.retention_allow_real_run and policy_auto_run
    return [
        smtp,
        configured("line_messaging", settings.line_messaging_enabled),
        configured("turnstile", settings.turnstile_enabled),
        configured("google_login", settings.google_oauth_enabled),
        configured("line_login", settings.line_oauth_enabled),
        SystemStatusItem(key="media_storage", level="info", detail={"storage": settings.media_storage}),
        switch("admissions", settings.admissions_enabled),
        # 招生關閉時同步迴圈不會啟動（main.py lifespan），所以兩個都開才算開。
        switch("geo_auto_sync", settings.admissions_enabled and settings.geo_auto_sync),
        SystemStatusItem(
            key="retention_auto_run",
            level="info" if retention_on else "off",
            detail={"env_allowed": settings.retention_allow_real_run, "policy_enabled": policy_auto_run},
        ),
    ]


def maintenance_item(settings: Settings, loop: Any | None, now: datetime) -> SystemStatusItem:
    interval = settings.background_jobs_interval
    if not interval:
        return SystemStatusItem(key="maintenance", level="off", detail={"running": False})
    stale_after = max(MAINTENANCE_STALE_FLOOR, timedelta(seconds=interval * MAINTENANCE_STALE_ROUNDS))
    detail: dict[str, Any] = {
        "running": loop is not None,
        "interval_seconds": interval,
        "stale_minutes": int(stale_after.total_seconds() // 60),
    }
    if loop is None:
        # 背景工作開著卻沒有 loop：啟動失敗或程序不是用 lifespan 起來的。
        return SystemStatusItem(
            key="maintenance",
            level="attention",
            detail={**detail, "stalled": True, "failed_steps": [], "last_completed_at": None, "last_clean_at": None},
        )
    reference = loop.last_completed_at or loop.started_at
    stalled = reference is None or now - reference > stale_after
    failed = list(loop.last_failed_steps)
    detail.update(
        last_completed_at=loop.last_completed_at,
        last_clean_at=loop.last_clean_at,
        failed_steps=failed,
        stalled=stalled,
    )
    return SystemStatusItem(key="maintenance", level="attention" if stalled or failed else "ok", detail=detail)


async def media_item(db: AsyncSession, settings: Settings, loop: Any | None) -> SystemStatusItem:
    if settings.media_video_processing_mode != "background":
        return SystemStatusItem(key="media_jobs", level="info", detail={"mode": "inline"})
    queued = dict(
        (
            await db.execute(
                select(MediaJob.status, func.count())
                .where(MediaJob.status.in_(("pending", "running")))
                .group_by(MediaJob.status)
            )
        ).all()
    )
    # 看素材狀態，不看失敗的工作列：按「重新處理」會另建新工作，舊的失敗列不會消失（計畫裁定 P3）。
    failed = (
        await db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(MediaAsset.status == MediaStatus.FAILED, MediaAsset.deleted_at.is_(None))
        )
    ).scalar_one()
    running = loop is not None and loop.running
    detail = {
        "mode": "background",
        "loop_running": running,
        "pending": queued.get("pending", 0),
        "running": queued.get("running", 0),
        "failed_assets": failed,
        "last_processed_at": loop.last_processed_at if loop is not None else None,
    }
    return SystemStatusItem(key="media_jobs", level="attention" if failed or not running else "ok", detail=detail)


def geo_loop_item(settings: Settings, loop: Any | None, now: datetime) -> SystemStatusItem:
    if not (settings.admissions_enabled and settings.geo_auto_sync):
        return SystemStatusItem(key="geo_sync_loop", level="off", detail={"running": False})
    stale_after = timedelta(seconds=settings.geo_sync_check_seconds) + GEO_LOOP_SLACK
    running = loop is not None and loop.running
    detail: dict[str, Any] = {"running": running, "stale_hours": int(stale_after.total_seconds() // 3600)}
    if not running:
        return SystemStatusItem(key="geo_sync_loop", level="attention", detail={**detail, "stalled": True, "last_run_at": None})
    reference = loop.last_run_at or loop.started_at
    stalled = reference is None or now - reference > stale_after
    return SystemStatusItem(
        key="geo_sync_loop",
        level="attention" if stalled else "ok",
        detail={**detail, "stalled": stalled, "last_run_at": loop.last_run_at},
    )


def dataset_item(dataset: str, row: GeoDatasetStatus | None, now: datetime) -> SystemStatusItem:
    error = row.last_error if row is not None else None
    if row is None or row.synced_at is None:
        return SystemStatusItem(
            key=dataset, level="attention" if error else "info", detail={"imported": False, "error": error, "stale": False},
        )
    if dataset == "doorplates":
        # 門牌只看換版時間（S6）；確認過來源沒變不算數。
        threshold = DOORPLATE_STALE_AFTER
        age = now - row.synced_at
    else:
        threshold = _DATASET_REFRESH.get(dataset, REFRESH_AFTER) + DATASET_GRACE
        age = now - max(t for t in (row.synced_at, row.checked_at) if t is not None)
    stale = age > threshold
    return SystemStatusItem(
        key=dataset,
        level="attention" if stale or error else "ok",
        detail={
            "imported": True,
            "label": row.label,
            "synced_at": row.synced_at,
            "checked_at": row.checked_at,
            "error": error,
            "stale": stale,
            "stale_days": threshold.days,
        },
    )


async def dataset_items(db: AsyncSession, now: datetime) -> list[SystemStatusItem]:
    rows = {row.dataset: row for row in (await db.execute(select(GeoDatasetStatus))).scalars()}
    # 動態跟著 DATASETS：新增資料時清單自己長出來，後台測試會要求補中文（計畫裁定 P11）。
    return [dataset_item(name, rows.get(name), now) for name in DATASETS if name not in HIDDEN_DATASETS]


async def notification_items(db: AsyncSession) -> list[SystemStatusItem]:
    """寄送與排程發布失敗：列出筆數，不計入要注意（總覽各有一行，S11）；條件和總覽一致（P13）。"""
    failed_outbox = await outbox_admin.count_failed(db, None)
    failed_jobs = (
        await db.execute(
            select(func.count())
            .select_from(PublishJob)
            .join(ContentItem, ContentItem.id == PublishJob.content_item_id)
            .where(PublishJob.status == "failed", unresolved_condition())
        )
    ).scalar_one()
    return [
        SystemStatusItem(key="failed_outbox", level="info" if failed_outbox else "ok", detail={"count": failed_outbox}),
        SystemStatusItem(key="failed_publish_jobs", level="info" if failed_jobs else "ok", detail={"count": failed_jobs}),
    ]


async def build_status(db: AsyncSession, state: Any, settings: Settings, now: datetime) -> SystemStatusOut:
    # 只讀：不用 retention_service.get_policy（沒有政策列時它會建一列）。
    policy = await db.get(RetentionPolicy, 1)
    services = service_items(settings, policy_auto_run=bool(policy is not None and policy.auto_run_enabled))
    background = [
        maintenance_item(settings, getattr(state, "maintenance", None), now),
        await media_item(db, settings, getattr(state, "media_jobs", None)),
        geo_loop_item(settings, getattr(state, "geo_sync", None), now),
    ]
    datasets = await dataset_items(db, now) if settings.admissions_enabled else None
    notifications = await notification_items(db)
    attention = sum(item.level == "attention" for item in [*services, *background, *(datasets or []), *notifications])
    return SystemStatusOut(
        generated_at=now,
        attention_count=attention,
        services=services,
        background=background,
        datasets=datasets,
        notifications=notifications,
    )
```

若 Task 0 Step 4 發現新的 dataset 且週期不是 30 天，在 `_DATASET_REFRESH` 補一項（用同步程式裡的常數，不要寫死天數），並在 `test_other_datasets_use_refresh_plus_three_days` 補一組參數。

- [ ] **Step 5：跑測試確認通過**

Run: `PYTEST tests/test_system_status.py`
Expected: PASS（全部）。另跑 `PYTEST tests/test_maintenance.py tests/test_geo_loop.py tests/test_health.py` 確認 loop 改動沒弄壞既有測試。

- [ ] **Step 6：Commit**

```bash
git add backend/app/operations/system_status.py backend/app/workers/maintenance.py backend/app/workers/geo_loop.py backend/tests/test_system_status.py
git commit -m "feat(operations): 系統狀態的判斷核心（服務設定、背景工作、公開資料、寄送與發布失敗）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2：API、權限、測試信、總覽數字與契約

**Files:**
- Modify: `backend/app/operations/system_status.py`（測試信）
- Modify: `backend/app/operations/routes.py`（import 區、`get_dashboard` :190-224、檔尾新端點）
- Modify: `backend/app/auth/permissions.py:60-80`、`backend/tests/test_permission_table.py:40-49`
- Test: `backend/tests/test_system_status.py`（後半）
- Modify（重新產生）: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1）：`build_status`、`SystemStatusOut`。`audit_service.log_action(db, *, actor_user_id, action, target_type, target_id, campus_key=None, metadata=None)`（`operations/audit_service.py:32`）；`ratelimit.limiter(request).check(limit, key)`（`common/ratelimit.py:150`，超過丟 `RateLimited`，連線池滿丟 `RateLimiterUnavailable`，兩者都有 `retry_after_seconds`）；`get_email_adapter(sink_dir, settings)`（`notifications/email_adapter.py`，都沒有就丟 `EmailNotConfigured`）。
- Produces（Task 3 依賴）：
  - `GET /api/website/v1/admin/system-status` → `SystemStatusOut`；非總管理者 403、未登入 401。
  - `POST /api/website/v1/admin/system-status/test-email`（無 body）→ `SystemEmailTestOut {ok: bool, error: "not_configured"|"auth_failed"|"connect_failed"|"rejected"|"timeout"|"other"|null}`；409 `{detail: {code: "EMAIL_NOT_CONFIGURED", message}}`；429 `{detail: {code: "TEST_EMAIL_RATE_LIMITED"|"TEST_EMAIL_BUSY", message}}`。
  - `/admin/dashboard` 多 `system_attention: int | null`。
  - 權限字串 `system.status`。
  - 操作紀錄 action `system.test_email`，metadata 鍵 `result`（`sent`｜`failed`）與 `error_code`（失敗時）。

- [ ] **Step 1：寫失敗的測試**

在 `backend/tests/test_system_status.py` 的 import 區補：

```python
import smtplib
import time

from sqlalchemy import select

from app.auth.models import Role
from app.notifications.email_adapter import EmailNotConfigured
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock
```

在檔尾加：

```python
# --- API、權限、測試信、總覽（Task 2） --------------------------------------------

STATUS = "/api/website/v1/admin/system-status"
TEST_EMAIL = f"{STATUS}/test-email"
DASHBOARD = "/api/website/v1/admin/dashboard"


async def test_only_super_admin_can_read_system_status(app, admin_client, minghua_client, public_client, db_session):
    ok = await admin_client.get(STATUS)
    assert ok.status_code == 200, ok.text
    assert {"generated_at", "attention_count", "services", "background", "datasets", "notifications"} <= ok.json().keys()
    assert (await minghua_client.get(STATUS)).status_code == 403
    assert (await minghua_client.post(TEST_EMAIL)).status_code == 403
    await _create_user(db_session, "desk-status@ivy.example", "desk-status-password-1", Role.RECEPTION, ["yihua"])
    desk = await _logged_in_client(app, "desk-status@ivy.example", "desk-status-password-1")
    try:
        assert (await desk.get(STATUS)).status_code == 403
        assert (await desk.post(TEST_EMAIL)).status_code == 403
    finally:
        await desk.aclose()
    assert (await public_client.get(STATUS)).status_code == 401


async def test_status_response_never_contains_secrets(app, admin_client):
    secrets = {
        "smtp_username": "smtp-user-should-not-leak",
        "smtp_password": "smtp-pass-should-not-leak",
        "line_messaging_channel_secret": "line-secret-should-not-leak",
        "line_messaging_access_token": "line-token-should-not-leak",
        "turnstile_secret_key": "turnstile-secret-should-not-leak",
        "google_client_secret": "google-secret-should-not-leak",
        "line_channel_secret": "line-login-secret-should-not-leak",
        "s3_secret_access_key": "s3-secret-should-not-leak",
    }
    app.state.settings = app.state.settings.model_copy(update={
        **secrets,
        "smtp_host": "smtp.example.com",
        "smtp_from": "noreply@ivy.example",
        "turnstile_site_key": "site-key",
        "google_client_id": "google-id",
        "google_redirect_uri": "https://admin.example/api/website/v1/auth/google/callback",
    })
    response = await admin_client.get(STATUS)
    assert response.status_code == 200, response.text
    for value in secrets.values():
        assert value not in response.text
    smtp = next(item for item in response.json()["services"] if item["key"] == "smtp")
    assert smtp == {"key": "smtp", "level": "ok", "detail": {"host": "smtp.example.com", "port": 587, "security": "starttls", "sender": "noreply@ivy.example"}}


async def test_dashboard_has_system_attention_only_for_super_admin(admin_client, minghua_client):
    mine = await admin_client.get(DASHBOARD)
    assert mine.status_code == 200, mine.text
    assert isinstance(mine.json()["system_attention"], int)
    theirs = await minghua_client.get(DASHBOARD)
    assert theirs.json()["system_attention"] is None


async def test_dashboard_survives_a_failing_system_status(admin_client, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("模擬系統狀態查詢失敗")

    monkeypatch.setattr(system_status, "build_status", broken)
    response = await admin_client.get(DASHBOARD)
    assert response.status_code == 200, response.text
    assert response.json()["system_attention"] is None
    assert "today_visits" in response.json()


@pytest.fixture
def mailer(monkeypatch, recording_mail_adapter):
    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


async def _test_email_audits(db_session) -> list[AuditLogEntry]:
    rows = await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "system.test_email"))
    return list(rows.scalars())


async def test_test_email_goes_to_my_own_address_and_is_audited(admin_client, db_session, mailer):
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "error": None}
    [mail] = mailer.sent
    assert mail["to"] == "admin@ivy.example"
    assert mail["subject"] == "【常春藤官網後台】測試信"
    assert "寄出時間" in mail["body"]
    [entry] = await _test_email_audits(db_session)
    assert entry.metadata_json == {"result": "sent"}
    assert entry.target_type == "user"


@pytest.mark.parametrize(
    ("make_error", "kind"),
    [
        (lambda: smtplib.SMTPAuthenticationError(535, b"bad credentials"), "auth_failed"),
        (lambda: smtplib.SMTPRecipientsRefused({"admin@ivy.example": (550, b"no such user")}), "rejected"),
        (lambda: smtplib.SMTPSenderRefused(553, b"sender", "noreply@ivy.example"), "rejected"),
        (lambda: smtplib.SMTPConnectError(421, b"busy"), "connect_failed"),
        (lambda: ConnectionRefusedError(), "connect_failed"),
        (lambda: TimeoutError(), "timeout"),
        (lambda: RuntimeError("?"), "other"),
    ],
)
async def test_test_email_failure_reports_a_kind_not_the_raw_error(admin_client, db_session, monkeypatch, make_error, kind):
    error = make_error()

    class _Failing:
        def send(self, *, to: str, subject: str, body: str) -> None:
            raise error

    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: _Failing())
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": False, "error": kind}
    [entry] = await _test_email_audits(db_session)
    assert entry.metadata_json == {"result": "failed", "error_code": type(error).__name__}
    assert "admin@ivy.example" not in str(entry.metadata_json)


async def test_test_email_times_out(admin_client, monkeypatch):
    class _Slow:
        def send(self, *, to: str, subject: str, body: str) -> None:
            time.sleep(0.5)

    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: _Slow())
    monkeypatch.setattr(system_status, "TEST_EMAIL_TIMEOUT_SECONDS", 0.05)
    response = await admin_client.post(TEST_EMAIL)
    assert response.json() == {"ok": False, "error": "timeout"}


async def test_test_email_without_any_mail_channel_is_409(admin_client, monkeypatch):
    def _none(settings):
        raise EmailNotConfigured("沒有寄信管道")

    monkeypatch.setattr(system_status, "mail_adapter", _none)
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EMAIL_NOT_CONFIGURED"


async def test_test_email_is_limited_to_three_per_ten_minutes(app, admin_client, mailer):
    freeze_rate_limit_clock(app)
    for _ in range(3):
        assert (await admin_client.post(TEST_EMAIL)).status_code == 200
    blocked = await admin_client.post(TEST_EMAIL)
    assert blocked.status_code == 429
    # 錯誤本文的 detail 另帶 request_id（main.py _error_body），只比對 code 與 message。
    detail = blocked.json()["detail"]
    assert (detail["code"], detail["message"]) == ("TEST_EMAIL_RATE_LIMITED", "測試信寄太多次了，請 10 分鐘後再試")
    assert len(mailer.sent) == 3
```

`backend/tests/test_permission_table.py` 的 `test_super_admin_only_capabilities` 清單加 `"system.status",`。

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_system_status.py tests/test_permission_table.py`
Expected: FAIL（`/admin/system-status` 404、`roles_with("system.status")` 丟 `ValueError`、`system_status.mail_adapter` 不存在）。

- [ ] **Step 3：權限**

`backend/app/auth/permissions.py` 的 `_CAPABILITY_ROLES`，在 `"contact_phrases.manage"` 那項之後加：

```python
    # 系統狀態頁（2026-10-15）：寄信、推播、背景排程與公開資料的設定現況與測試信，限總管理者。
    "system.status": {Role.SUPER_ADMIN},
```

- [ ] **Step 4：測試信的部分寫進 `system_status.py`**

在 `system_status.py` 的 import 區加 `import smtplib`（放 `from __future__` 之後的標準庫區）、`from app.common import ratelimit`、`from app.common.timezones import OPERATING_TZ`、`from app.notifications.email_adapter import EmailAdapter, get_email_adapter`；檔尾加：

```python
# --- 測試信（規格 §3.4） -------------------------------------------------------------

# 每位使用者 10 分鐘 3 封。
TEST_EMAIL_LIMIT = ratelimit.Limit("system_test_email", 600, 3)
TEST_EMAIL_TIMEOUT_SECONDS = 20.0
TEST_EMAIL_SUBJECT = "【常春藤官網後台】測試信"
SystemEmailTestError = Literal["not_configured", "auth_failed", "connect_failed", "rejected", "timeout", "other"]


class SystemEmailTestOut(BaseModel):
    ok: bool
    error: SystemEmailTestError | None = None


def mail_adapter(settings: Settings) -> EmailAdapter:
    """寄測試信用的 adapter；沒有任何寄信管道時丟 EmailNotConfigured。測試以 monkeypatch 換掉
    （比照 auth/password_reset.mail_adapter）。"""
    return get_email_adapter(settings.notification_email_sink_dir, settings)


def build_test_email(settings: Settings, now: datetime) -> tuple[str, str]:
    local = now.astimezone(OPERATING_TZ)
    body = "\n".join(
        [
            "這是從官網後台「系統狀態」寄出的測試信。",
            f"寄出時間：{local:%Y-%m-%d %H:%M}（台北）",
            f"環境：{settings.environment}",
            "",
            "收到這封信，代表後台的寄信設定可以把信寄出去。",
            "這封信由系統自動寄出，請勿直接回覆。",
        ]
    )
    return TEST_EMAIL_SUBJECT, body


def classify_email_error(exc: BaseException) -> SystemEmailTestError:
    """例外類型 → 給畫面看的原因；不回傳原始錯誤訊息（可能含伺服器回應與地址）。
    smtplib 的例外都是 OSError 的子類別，所以先判斷 SMTP 專屬的，再判斷一般連線錯誤。"""
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "auth_failed"
    if isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError)):
        return "rejected"
    if isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        return "connect_failed"
    if isinstance(exc, smtplib.SMTPException):
        return "other"
    if isinstance(exc, OSError):
        return "connect_failed"
    return "other"
```

- [ ] **Step 5：端點與總覽數字**

`backend/app/operations/routes.py`：

(a) import 區：檔頭加 `import asyncio`、`import logging`；`from app.operations import (...)` 的清單加 `system_status`（照字母順序放在 `retention_service` 之後）；加 `from app.notifications.email_adapter import EmailNotConfigured`；`router = APIRouter(...)` 之前加 `logger = logging.getLogger("app.operations")`。

(b) `get_dashboard`（:190-224）在 `return summary` 之前加：

```python
    # 系統狀態（2026-10-15）：只有總管理者有這個數字，其他人一律 None。查詢失敗不能拖垮總覽
    # （每 30 秒背景重讀，計畫裁定 P10）：記下錯誤、回 None。放在最後，前面的數字都已經算好。
    summary["system_attention"] = None
    if has_capability(current_user, "system.status"):
        try:
            status_now = await system_status.build_status(db, request.app.state, request.app.state.settings, now_utc())
        except Exception:  # noqa: BLE001
            logger.exception("營運總覽：系統狀態查詢失敗")
            await db.rollback()
        else:
            summary["system_attention"] = status_now.attention_count
```

(c) 檔尾加兩支端點：

```python
@router.get("/admin/system-status", response_model=system_status.SystemStatusOut)
async def get_system_status(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> system_status.SystemStatusOut:
    """總管理者的系統狀態（2026-10-15 規格）：設定有沒有設、背景工作、公開資料、寄送與發布失敗。唯讀。"""
    require_scope(current_user, "system.status")
    return await system_status.build_status(db, request.app.state, request.app.state.settings, now_utc())


@router.post("/admin/system-status/test-email", response_model=system_status.SystemEmailTestOut)
async def send_system_test_email(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> system_status.SystemEmailTestOut:
    """寄一封測試信到自己帳號的 Email（規格 §3.4）：不走 outbox，結果當場回傳；不回原始錯誤訊息。"""
    require_scope(current_user, "system.status")
    settings = request.app.state.settings
    try:
        adapter = system_status.mail_adapter(settings)
    except EmailNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_NOT_CONFIGURED", "message": "尚未設定寄信，無法寄出測試信"},
        ) from exc
    try:
        await ratelimit.limiter(request).check(system_status.TEST_EMAIL_LIMIT, str(current_user.id))
    except ratelimit.RateLimiterUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "TEST_EMAIL_BUSY", "message": "系統忙碌，請稍候再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "TEST_EMAIL_RATE_LIMITED", "message": "測試信寄太多次了，請 10 分鐘後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    subject, body = system_status.build_test_email(settings, now_utc())
    try:
        await asyncio.wait_for(
            asyncio.to_thread(adapter.send, to=current_user.email, subject=subject, body=body),
            timeout=system_status.TEST_EMAIL_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 —— 任何寄送失敗都如實回報
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="system.test_email",
            target_type="user",
            target_id=str(current_user.id),
            metadata={"result": "failed", "error_code": type(exc).__name__},
        )
        await db.commit()
        return system_status.SystemEmailTestOut(ok=False, error=system_status.classify_email_error(exc))
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="system.test_email",
        target_type="user",
        target_id=str(current_user.id),
        metadata={"result": "sent"},
    )
    await db.commit()
    return system_status.SystemEmailTestOut(ok=True)
```

- [ ] **Step 6：跑測試確認通過**

Run: `PYTEST tests/test_system_status.py tests/test_permission_table.py tests/test_dashboard_today_board.py tests/test_operations.py`
Expected: PASS。

- [ ] **Step 7：契約重新產生並檢查**

依「共通規則」重新產生 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`，再跑檢查。預期：新增 `SystemStatusOut`、`SystemStatusItem`、`SystemEmailTestOut` 三個 schema 與兩條路徑，其他不變（`git diff --stat contracts/` 只有這兩個檔）。

- [ ] **Step 8：Commit**

```bash
git add backend/app/operations/system_status.py backend/app/operations/routes.py backend/app/auth/permissions.py backend/tests/test_system_status.py backend/tests/test_permission_table.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(operations): 系統狀態 API、寄測試信與總覽的系統狀態數字（限總管理者）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3：後台「系統狀態」頁、側欄與總覽一行

**Files:**
- Create: `admin/src/utils/systemStatusFormat.ts`、`admin/src/views/SystemStatusView.vue`、`admin/src/__tests__/systemStatus.test.ts`
- Modify: `admin/src/router/nav.ts:121-135`、`admin/src/router/index.ts:85`、`admin/src/components/AdminSidebar.vue:4-8,80-84`、`admin/src/api/types.ts`、`admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS`、`AUDIT_METADATA_FORMATTERS`）、`admin/src/views/DashboardView.vue:65-85,383-399,506-509`、`admin/src/__tests__/fixtures.ts:7-12`

**Interfaces:**
- Consumes（Task 2）：`GET /admin/system-status`、`POST /admin/system-status/test-email`、`/admin/dashboard` 的 `system_attention`；Task 1 的 detail 鍵表。
- Produces：路由名 `system-status`（路徑 `/system-status`，標題「系統狀態」，`roles: ['super_admin']`）；`systemStatusFormat.ts` 匯出 `LEVEL_LABELS`、`LEVEL_TAG_TYPES`、`ITEM_LABELS`、`DATASET_LABELS`、`STEP_LABELS`、`TEST_EMAIL_ERROR_TEXT`、`itemLabel(item, section)`、`describeItem(item, section)`、`itemLink(item, section)`；Task 6 e2e 用到的 DOM：每一列 `li.status-row[data-key="<key>"]`、按鈕「寄一封測試信給我」、`role="status"` 的結果、「重新整理」按鈕、`資料時間` 文字、四個 h2（對外服務設定、背景工作、公開資料、通知與發布）。

- [ ] **Step 1：寫失敗的測試**

建立 `admin/src/__tests__/systemStatus.test.ts`：

```ts
// 系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）：
// 文案與連結、頁面、側欄與權限、總覽一行；後端步驟名與公開資料清單都要有中文。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import SystemStatusView from '../views/SystemStatusView.vue'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import type { SystemStatusItem, SystemStatusOut, UserOut } from '../api/types'
import { authGuard, routes } from '../router'
import { canListNavItem, navItem, NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { campusAdmin, cleanup, mountWith, reception } from './admissionsTestKit'
import { testUser } from './fixtures'
import { DATASET_LABELS, ITEM_LABELS, STEP_LABELS, describeItem, itemLink } from '../utils/systemStatusFormat'

const backendSources = import.meta.glob('../../../backend/app/**/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
function source(path: string): string {
  const key = Object.keys(backendSources).find((k) => k.endsWith(path))
  if (!key) throw new Error(`找不到後端檔案 ${path}`)
  return backendSources[key]!
}

const item = (key: string, level: SystemStatusItem['level'], detail: Record<string, unknown> = {}): SystemStatusItem => ({ key, level, detail })

function status(overrides: Partial<SystemStatusOut> = {}): SystemStatusOut {
  return {
    generated_at: '2026-10-15T04:00:00Z',
    attention_count: 1,
    services: [item('smtp', 'attention'), item('turnstile', 'info', { configured: false }), item('media_storage', 'info', { storage: 'local' })],
    background: [item('maintenance', 'ok', { running: true, interval_seconds: 60, stale_minutes: 5, last_completed_at: '2026-10-15T03:59:00Z', last_clean_at: '2026-10-15T03:59:00Z', failed_steps: [], stalled: false })],
    datasets: [item('doorplates', 'ok', { imported: true, label: '115-10', synced_at: '2026-10-10T00:00:00Z', checked_at: null, error: null, stale: false, stale_days: 35 })],
    notifications: [item('failed_outbox', 'ok', { count: 0 }), item('failed_publish_jobs', 'info', { count: 2 })],
    ...overrides,
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('後端清單都有中文', () => {
  it('維護排程的每個步驟、每種公開資料、每個列 key 都有中文', () => {
    const steps = new Set([...source('workers/maintenance.py').matchAll(/failed_steps\.append\("([a-z_]+)"\)/g)].map((m) => m[1]!))
    expect(steps.size).toBeGreaterThan(5)
    expect([...steps].filter((step) => !STEP_LABELS[step])).toEqual([])

    const block = source('admissions/geo/models.py').match(/^DATASETS = \(([\s\S]*?)\)/m)![1]!
    const datasets = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).filter((name) => name !== 'campuses')
    expect(datasets.length).toBeGreaterThan(5)
    expect(datasets.filter((name) => !DATASET_LABELS[name])).toEqual([])

    const statusSource = source('operations/system_status.py')
    const keys = new Set([...statusSource.matchAll(/(?:key=|configured\(|switch\()"([a-z_]+)"/g)].map((m) => m[1]!))
    expect(keys.size).toBeGreaterThan(10)
    expect([...keys].filter((key) => !ITEM_LABELS[key])).toEqual([])
  })
})

describe('文案與連結', () => {
  it('寄信：有設時寫寄件地址與主機，沒設時說清楚影響', () => {
    expect(describeItem(item('smtp', 'ok', { host: 'smtp.example.com', port: 587, security: 'starttls', sender: 'noreply@ivy.example' }), 'services'))
      .toBe('寄件地址 noreply@ivy.example，主機 smtp.example.com:587（STARTTLS）')
    expect(describeItem(item('smtp', 'info', { sink: true }), 'services')).toContain('本機資料夾')
    expect(describeItem(item('smtp', 'attention'), 'services')).toContain('家長確認信、參觀提醒、停課通知與重設密碼連結都寄不出去')
  })

  it('門牌要注意時一律寫手動匯入（過期或自動下載失敗都一樣）', () => {
    const stale = item('doorplates', 'attention', { imported: true, label: '115-09', stale: true, error: null, stale_days: 35 })
    const failed = item('doorplates', 'attention', { imported: true, label: '115-10', stale: false, error: '連不上', stale_days: 35 })
    for (const row of [stale, failed]) expect(describeItem(row, 'datasets')).toContain('匯入指令更新門牌')
  })

  it('其他公開資料：失敗寫原因、過期寫天數、沒匯入寫尚未匯入', () => {
    expect(describeItem(item('income', 'attention', { imported: true, label: '112', error: 'HTTP 503', stale: false, stale_days: 33 }), 'datasets')).toBe('最近一次同步失敗：HTTP 503')
    expect(describeItem(item('births', 'attention', { imported: true, label: '115-09', error: null, stale: true, stale_days: 33 }), 'datasets')).toBe('超過 33 天沒有更新')
    expect(describeItem(item('income', 'info', { imported: false, error: null, stale: false }), 'datasets')).toBe('尚未匯入')
  })

  it('維護排程：停擺、失敗步驟用中文、剛啟動', () => {
    const base = { running: true, interval_seconds: 60, stale_minutes: 5, last_clean_at: null }
    expect(describeItem(item('maintenance', 'attention', { ...base, last_completed_at: '2026-10-15T03:50:00Z', failed_steps: ['outbox', 'publish_jobs'], stalled: false }), 'background'))
      .toBe('最近一輪失敗的步驟：寄送通知、排程發布')
    expect(describeItem(item('maintenance', 'attention', { ...base, last_completed_at: null, failed_steps: [], stalled: true }), 'background')).toBe('啟動超過 5 分鐘還沒有跑完一輪')
    expect(describeItem(item('maintenance', 'ok', { ...base, last_completed_at: null, failed_steps: [], stalled: false }), 'background')).toBe('剛啟動，還沒有跑完第一輪')
    expect(describeItem(item('maintenance', 'off', { running: false }), 'background')).toBe('這個環境不跑背景排程')
  })

  it('有事要處理的列才給連結', () => {
    expect(itemLink(item('failed_outbox', 'info', { count: 3 }), 'notifications')).toEqual({ to: '/notifications', label: '重新寄送' })
    expect(itemLink(item('failed_outbox', 'ok', { count: 0 }), 'notifications')).toBeNull()
    expect(itemLink(item('failed_publish_jobs', 'info', { count: 1 }), 'notifications')).toEqual({ to: '/releases?tab=schedules', label: '查看排程' })
    expect(itemLink(item('media_jobs', 'attention', { mode: 'background', loop_running: true, failed_assets: 2, pending: 0, running: 0 }), 'background')).toEqual({ to: '/media', label: '前往素材庫' })
    expect(itemLink(item('income', 'attention', { imported: true, error: 'x', stale: false }), 'datasets')).toEqual({ to: '/admissions?tab=stats&sub=area', label: '看區域分析' })
    expect(itemLink(item('income', 'ok', { imported: true, error: null, stale: false }), 'datasets')).toBeNull()
  })
})

async function mountPage(data: SystemStatusOut = status()) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const mounted = await mountWith(SystemStatusView, { path: '/system-status' })
  return { ...mounted, get }
}

describe('頁面', () => {
  it('讀一次狀態，四區標題、每列名稱與狀態標籤；招生關閉時沒有公開資料區', async () => {
    const { wrapper, get } = await mountPage()
    expect(get).toHaveBeenCalledWith('/admin/system-status')
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['對外服務設定', '背景工作', '公開資料', '通知與發布'])
    const smtp = wrapper.get('li.status-row[data-key="smtp"]')
    expect(smtp.text()).toContain('寄信（SMTP）')
    expect(smtp.text()).toContain('要注意')
    expect(wrapper.text()).toContain('資料時間')
    cleanup()
    const off = await mountPage(status({ datasets: null }))
    expect(off.wrapper.findAll('h2').map((h) => h.text())).not.toContain('公開資料')
  })

  it('重新整理再讀一次；不自動輪詢', async () => {
    // 只假 setInterval：flushPromises 靠真的 setTimeout，全部假掉會卡住。
    vi.useFakeTimers({ toFake: ['setInterval'] })
    try {
      const { wrapper, get } = await mountPage()
      vi.advanceTimersByTime(120_000)
      await flushPromises()
      expect(get).toHaveBeenCalledTimes(1)
      await wrapper.findAll('button').find((b) => b.text() === '重新整理')!.trigger('click')
      await flushPromises()
      expect(get).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('寄信沒設時測試信按鈕停用；有設時寄出並顯示遮罩後的收件地址', async () => {
    const off = await mountPage()
    const disabled = off.wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!
    expect(disabled.attributes('disabled')).toBeDefined()
    cleanup()

    const ready = status({ services: [item('smtp', 'ok', { host: 'smtp.example.com', port: 587, security: 'starttls', sender: 'noreply@ivy.example' })] })
    const { wrapper } = await mountPage(ready)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, error: null } as never)
    await wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/system-status/test-email')
    expect(wrapper.get('[role="status"]').text()).toBe('已寄到 a***@example.invalid，請到信箱確認')
  })

  it('測試信沒寄出時寫原因', async () => {
    const { wrapper } = await mountPage(status({ services: [item('smtp', 'info', { sink: true })] }))
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'auth_failed' } as never)
    await wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('測試信沒有寄出：寄信伺服器帳號或密碼錯誤')
  })
})

describe('側欄與權限', () => {
  it('「系統」分組有「系統狀態」，排在「個資與搜尋設定」前面，只有總管理者看得到', () => {
    const system = NAV_GROUPS.find((group) => group.key === 'system')!
    const names = system.items.map((i) => i.name)
    expect(names.indexOf('system-status')).toBe(names.indexOf('policies') - 1)
    const entry = navItem('system-status')!
    expect(entry.path).toBe('/system-status')
    expect(entry.keywords).toEqual(expect.arrayContaining(['寄信', 'SMTP', '排程']))
    const listed = (role: Parameters<typeof testUser>[0]) => canListNavItem(entry, testUser(role), null)
    expect(listed('super_admin')).toBe(true)
    for (const role of ['campus_admin', 'reception', 'editor', 'readonly'] as const) expect(listed(role)).toBe(false)
  })

  it('直接開網址：非總管理者被導回並帶 denied', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const target = router.resolve('/system-status')
    expect(target.meta.title).toBe('系統狀態')
    setActivePinia(createPinia())
    useAuthStore().user = campusAdmin()
    expect(await authGuard(target as never)).toMatchObject({ query: { denied: 'system-status' } })
    useAuthStore().user = reception()
    expect(await authGuard(target as never)).toMatchObject({ query: { denied: 'system-status' } })
    useAuthStore().user = testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
    expect(await authGuard(target as never)).toBe(true)
  })
})

describe('營運總覽', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers.length = 0 })
  const base = () => ({ today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0 })

  async function mountDashboard(data: object, user: UserOut = testUser('super_admin')) {
    vi.spyOn(api, 'get').mockImplementation(async (path) => (path === '/admin/dashboard' ? data : []) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = user
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  it('有要注意的系統狀態時多一行，連到系統狀態頁；0 或 null 不顯示', async () => {
    const shown = await mountDashboard({ ...base(), system_attention: 2 })
    const link = shown.findAll('a.task').find((a) => a.text().includes('系統狀態'))!
    expect(link.text()).toContain('系統狀態有 2 項要注意')
    expect(link.attributes('href')).toBe('/system-status')
    for (const value of [0, null]) {
      const hidden = await mountDashboard({ ...base(), system_attention: value }, value === null ? campusAdmin() : testUser('super_admin'))
      expect(hidden.findAll('a.task').some((a) => a.text().includes('系統狀態'))).toBe(false)
    }
  })
})
```

`admin/src/__tests__/fixtures.ts` 的 `ROLE_CAPABILITIES.super_admin` 在 `'retention.manage',` 之後加 `'system.status',`。

- [ ] **Step 2：跑測試確認失敗**

Run: `VITEST src/__tests__/systemStatus.test.ts`
Expected: FAIL（找不到 `../views/SystemStatusView.vue`、`../utils/systemStatusFormat`）。

- [ ] **Step 3：型別**

`admin/src/api/types.ts` 在 `ContactPhrasesOut` 那行附近加：

```ts
// 系統狀態頁（2026-10-15）：detail 是各列自己的結構化欄位，文案在 utils/systemStatusFormat.ts。
export type SystemStatusOut = components['schemas']['SystemStatusOut']
export type SystemStatusItem = components['schemas']['SystemStatusItem']
export type SystemEmailTestOut = components['schemas']['SystemEmailTestOut']
```

- [ ] **Step 4：文案與連結 `systemStatusFormat.ts`**

建立 `admin/src/utils/systemStatusFormat.ts`：

```ts
// 系統狀態頁的文字（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md §3.3）。
// 後端只回 key、level 與結構化的 detail（鍵見 backend/app/operations/system_status.py），文案都在這裡；
// systemStatus.test.ts 會比對後端的步驟名、公開資料清單與列 key，新增了沒補中文會失敗。
import { formatDateTime } from '../api/labels'
import type { SystemStatusItem } from '../api/types'

export type StatusLevel = SystemStatusItem['level']
export type StatusSection = 'services' | 'background' | 'datasets' | 'notifications'
type Detail = Record<string, unknown>

export const LEVEL_LABELS: Record<StatusLevel, string> = { ok: '正常', attention: '要注意', info: '資訊', off: '關閉' }
export const LEVEL_TAG_TYPES: Record<StatusLevel, 'success' | 'danger' | 'info'> = { ok: 'success', attention: 'danger', info: 'info', off: 'info' }

export const ITEM_LABELS: Record<string, string> = {
  smtp: '寄信（SMTP）',
  line_messaging: 'LINE 群組推播',
  turnstile: '機器人驗證（Turnstile）',
  google_login: 'Google 登入',
  line_login: 'LINE 登入',
  media_storage: '素材儲存',
  admissions: '招生入學',
  geo_auto_sync: '公開資料自動同步',
  retention_auto_run: '個資自動清理',
  maintenance: '維護排程',
  media_jobs: '影片轉檔',
  geo_sync_loop: '公開資料同步程式',
  failed_outbox: '通知寄送失敗',
  failed_publish_jobs: '排程發布失敗',
}

// 與 backend/app/admissions/geo/models.py 的 DATASETS 同一組（campuses 是內部指紋，不列）。
export const DATASET_LABELS: Record<string, string> = {
  doorplates: '門牌',
  kindergartens: '幼兒園名單',
  babycare: '托嬰名單',
  population: '各里人口',
  births: '各里出生數',
  migration: '各里遷入遷出',
  income: '村里所得',
  new_homes: '新成屋交屋',
}

// 與 backend/app/workers/maintenance.py 的 failed_steps 同一組。
export const STEP_LABELS: Record<string, string> = {
  publish_jobs: '排程發布',
  extend_slots: '依規則補場次',
  reminders: '參觀提醒',
  outbox: '寄送通知',
  rate_limits: '清除限流計數',
  purge_media: '清除待刪素材',
  retention: '個資保存清理',
}

export const TEST_EMAIL_ERROR_TEXT: Record<string, string> = {
  not_configured: '還沒設定寄信',
  auth_failed: '寄信伺服器帳號或密碼錯誤',
  connect_failed: '連不上寄信伺服器，請檢查主機與 port',
  rejected: '寄信伺服器拒收（寄件或收件地址被擋）',
  timeout: '寄信伺服器太久沒有回應',
  other: '寄信伺服器回了其他錯誤',
}

const SECURITY_LABELS: Record<string, string> = { starttls: 'STARTTLS', ssl: 'SSL', none: '不加密' }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const count = (value: unknown): number => (typeof value === 'number' ? value : 0)
const when = (value: unknown): string => formatDateTime(typeof value === 'string' ? value : null)

export function itemLabel(item: SystemStatusItem, section: StatusSection): string {
  return (section === 'datasets' ? DATASET_LABELS[item.key] : ITEM_LABELS[item.key]) ?? item.key
}

function describeDataset(item: SystemStatusItem, d: Detail): string {
  // 正式站自動下載連不到門牌來源（計畫裁定 P4）：過期或失敗都請人手動匯入。
  if (item.key === 'doorplates' && item.level === 'attention') return '門牌超過 35 天沒換版，或自動下載失敗：請到電腦上用匯入指令更新門牌（每月一次）'
  if (!d.imported) return d.error ? `還沒匯入成功：${text(d.error)}` : '尚未匯入'
  if (d.error) return `最近一次同步失敗：${text(d.error)}`
  if (d.stale) return `超過 ${count(d.stale_days)} 天沒有更新`
  const version = text(d.label) ? `版本 ${text(d.label)}・` : ''
  const checked = d.checked_at ? `・最後確認 ${when(d.checked_at)}` : ''
  return `${version}更新於 ${when(d.synced_at)}${checked}`
}

function describeMaintenance(item: SystemStatusItem, d: Detail): string {
  if (item.level === 'off') return '這個環境不跑背景排程'
  if (!d.running) return '背景排程沒有在跑'
  const steps = Array.isArray(d.failed_steps) ? (d.failed_steps as string[]).map((step) => STEP_LABELS[step] ?? step) : []
  const parts: string[] = []
  if (d.stalled) {
    parts.push(d.last_completed_at
      ? `超過 ${count(d.stale_minutes)} 分鐘沒有跑完一輪（上次 ${when(d.last_completed_at)}）`
      : `啟動超過 ${count(d.stale_minutes)} 分鐘還沒有跑完一輪`)
  }
  if (steps.length) parts.push(`最近一輪失敗的步驟：${steps.join('、')}`)
  if (parts.length) return parts.join('；')
  return d.last_completed_at ? `上次跑完 ${when(d.last_completed_at)}` : '剛啟動，還沒有跑完第一輪'
}

function describeMedia(d: Detail): string {
  if (d.mode === 'inline') return '影片在上傳時直接處理，沒有背景佇列'
  if (!d.loop_running) return '轉檔背景程式沒有在跑，新上傳的影片會一直停在處理中'
  const queue = `待處理 ${count(d.pending)}・處理中 ${count(d.running)}`
  return count(d.failed_assets) ? `${count(d.failed_assets)} 個素材處理失敗（${queue}）` : queue
}

function describeGeoLoop(item: SystemStatusItem, d: Detail): string {
  if (item.level === 'off') return '沒有開啟自動同步'
  if (!d.running) return '公開資料同步程式沒有在跑'
  if (d.stalled) {
    return d.last_run_at
      ? `超過 ${count(d.stale_hours)} 小時沒有同步（上次 ${when(d.last_run_at)}）`
      : `啟動超過 ${count(d.stale_hours)} 小時還沒有同步`
  }
  return d.last_run_at ? `上次同步 ${when(d.last_run_at)}` : '剛啟動，還沒有跑完第一輪'
}

export function describeItem(item: SystemStatusItem, section: StatusSection): string {
  const d = (item.detail ?? {}) as Detail
  if (section === 'datasets') return describeDataset(item, d)
  switch (item.key) {
    case 'smtp':
      if (item.level === 'ok') return `寄件地址 ${text(d.sender) || '（未設定）'}，主機 ${text(d.host)}:${count(d.port)}（${SECURITY_LABELS[text(d.security)] ?? text(d.security)}）`
      if (d.sink) return '測試環境：信件寫進本機資料夾，不會真的寄出'
      return '還沒設定寄信：家長確認信、參觀提醒、停課通知與重設密碼連結都寄不出去'
    case 'line_messaging':
      return d.configured ? '已設定，參觀通知會推到各校的 LINE 群組' : '未設定，參觀通知不會推到 LINE 群組'
    case 'turnstile':
      return d.configured ? '已設定，官網預約表單會做機器人驗證' : '未設定，官網預約表單沒有機器人驗證（送單次數上限照常）'
    case 'google_login':
    case 'line_login':
      return d.configured ? '已設定，同仁可以在「我的帳號」綁定後用它登入' : '未設定，登入頁不會出現這個選項'
    case 'media_storage':
      return d.storage === 's3' ? '素材存在 S3 相容的物件儲存' : '素材存在主機的磁碟（只能跑一個 API 副本）'
    case 'admissions':
      return d.enabled ? '開啟' : '關閉：後台沒有招生入學，標記到場也不會建立招生訪視'
    case 'geo_auto_sync':
      return d.enabled ? '開啟：每天檢查一次公開資料有沒有新版' : '關閉：公開資料只能手動匯入'
    case 'retention_auto_run':
      if (item.level === 'info') return '開啟：每天依個資保存政策清理一次'
      return d.env_allowed ? '關閉：「個資與搜尋設定」沒有開啟每日自動清理' : '關閉：部署設定不允許真的清理'
    case 'maintenance':
      return describeMaintenance(item, d)
    case 'media_jobs':
      return describeMedia(d)
    case 'geo_sync_loop':
      return describeGeoLoop(item, d)
    case 'failed_outbox':
      return count(d.count) ? `${count(d.count)} 則通知自動重試後仍沒有送出` : '沒有寄送失敗的通知'
    case 'failed_publish_jobs':
      return count(d.count) ? `${count(d.count)} 項排程發布時間到了沒有執行` : '沒有沒執行的排程發布'
    default:
      return ''
  }
}

export function itemLink(item: SystemStatusItem, section: StatusSection): { to: string; label: string } | null {
  const d = (item.detail ?? {}) as Detail
  if (section === 'datasets') return item.level === 'attention' ? { to: '/admissions?tab=stats&sub=area', label: '看區域分析' } : null
  switch (item.key) {
    case 'line_messaging':
      return { to: '/line-notifications', label: '前往 LINE 通知' }
    case 'retention_auto_run':
      return { to: '/policies', label: '前往個資與搜尋設定' }
    case 'media_jobs':
      return count(d.failed_assets) ? { to: '/media', label: '前往素材庫' } : null
    case 'failed_outbox':
      return count(d.count) ? { to: '/notifications', label: '重新寄送' } : null
    case 'failed_publish_jobs':
      return count(d.count) ? { to: '/releases?tab=schedules', label: '查看排程' } : null
    default:
      return null
  }
}
```

- [ ] **Step 5：頁面 `SystemStatusView.vue`**

建立 `admin/src/views/SystemStatusView.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatDateTime, maskEmail } from '../api/labels'
import type { SystemEmailTestOut, SystemStatusItem, SystemStatusOut } from '../api/types'
import PageHeader from '../components/PageHeader.vue'
import { notifyError } from '../composables/notify'
import { useAuthStore } from '../stores/auth'
import {
  LEVEL_LABELS,
  LEVEL_TAG_TYPES,
  TEST_EMAIL_ERROR_TEXT,
  describeItem,
  itemLabel,
  itemLink,
  type StatusSection,
} from '../utils/systemStatusFormat'

interface Section { key: StatusSection; title: string; items: SystemStatusItem[] }

const authStore = useAuthStore()
const data = ref<SystemStatusOut | null>(null)
// loading＝第一次載入（骨架）；refreshing＝按「重新整理」時舊資料留在畫面上。不自動輪詢（規格 S12）。
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref<string | null>(null)
const sending = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)

const sections = computed<Section[]>(() => {
  const s = data.value
  if (!s) return []
  return [
    { key: 'services', title: '對外服務設定', items: s.services },
    { key: 'background', title: '背景工作', items: s.background },
    ...(s.datasets ? [{ key: 'datasets' as const, title: '公開資料', items: s.datasets }] : []),
    { key: 'notifications', title: '通知與發布', items: s.notifications },
  ]
})

const smtp = computed(() => data.value?.services.find((item) => item.key === 'smtp') ?? null)
const canSendTest = computed(() => {
  const row = smtp.value
  return row !== null && (row.level === 'ok' || Boolean((row.detail as Record<string, unknown>).sink))
})
const generatedAt = computed(() => (data.value ? formatDateTime(data.value.generated_at) : ''))

async function load(options: { quiet?: boolean } = {}) {
  const quiet = Boolean(options.quiet) && data.value !== null
  if (quiet) refreshing.value = true
  else {
    loading.value = true
    loadError.value = null
  }
  try {
    data.value = await api.get<SystemStatusOut>('/admin/system-status')
    loadError.value = null
  } catch (err) {
    const message = apiErrorMessage(err, '讀不到系統狀態，請重新載入')
    if (quiet) notifyError(message)
    else loadError.value = message
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function sendTest() {
  if (sending.value) return
  sending.value = true
  testResult.value = null
  try {
    const result = await api.post<SystemEmailTestOut>('/admin/system-status/test-email')
    const email = authStore.user?.email
    testResult.value = result.ok
      ? { ok: true, text: `已寄到 ${email ? maskEmail(email) : '你的帳號 Email'}，請到信箱確認` }
      : { ok: false, text: `測試信沒有寄出：${TEST_EMAIL_ERROR_TEXT[result.error ?? 'other'] ?? TEST_EMAIL_ERROR_TEXT.other}` }
  } catch (err) {
    notifyError(apiErrorMessage(err, '測試信沒有寄出，請稍後再試'))
  } finally {
    sending.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="寄信、推播、背景排程與公開資料現在是否正常。設定要改，請技術人員在部署平台調整。">
      <template #actions>
        <span v-if="data" class="hint">資料時間 {{ generatedAt }}</span>
        <el-button :loading="refreshing" :disabled="loading" @click="load({ quiet: true })">重新整理</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="8" />

    <template v-else-if="data">
      <section v-for="section in sections" :key="section.key" class="panel status-panel" :aria-labelledby="`status-${section.key}`">
        <div class="panel__head"><h2 :id="`status-${section.key}`">{{ section.title }}</h2></div>
        <ul class="status-list">
          <li v-for="row in section.items" :key="row.key" class="status-row" :class="`is-${row.level}`" :data-key="row.key">
            <div class="status-row__head">
              <span class="status-row__name">{{ itemLabel(row, section.key) }}</span>
              <el-tag :type="LEVEL_TAG_TYPES[row.level]" size="small" disable-transitions>{{ LEVEL_LABELS[row.level] }}</el-tag>
            </div>
            <p class="status-row__text">{{ describeItem(row, section.key) }}</p>
            <div v-if="itemLink(row, section.key) || row.key === 'smtp'" class="status-row__actions">
              <router-link v-if="itemLink(row, section.key)" :to="itemLink(row, section.key)!.to">{{ itemLink(row, section.key)!.label }}</router-link>
              <template v-if="row.key === 'smtp'">
                <el-button size="small" :loading="sending" :disabled="!canSendTest" @click="sendTest">寄一封測試信給我</el-button>
                <span v-if="!canSendTest" class="hint">尚未設定寄信</span>
                <p v-if="testResult" role="status" class="status-row__result" :class="{ 'is-failed': !testResult.ok }">{{ testResult.text }}</p>
              </template>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.status-panel + .status-panel {
  margin-top: 16px;
}

.status-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.status-row {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.status-row:first-child {
  border-top: 0;
}

.status-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-row__name {
  font-weight: 600;
  color: var(--ink);
}

.status-row__text {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.status-row__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: var(--text-sm);
}

.status-row__result {
  flex-basis: 100%;
  margin: 0;
  color: var(--ink-2);
}

.status-row__result.is-failed {
  color: var(--el-color-danger);
}
</style>
```

- [ ] **Step 6：側欄、路由、圖示**

`admin/src/router/nav.ts` 的 `system` 群組，在 `policies` 那項（含它上面的兩行註解）之前插入：

```ts
      // 系統狀態（2026-10-15）：寄信、推播、背景排程、公開資料的設定現況與測試信，限總管理者（system.status）。
      { name: 'system-status', path: '/system-status', title: '系統狀態', icon: 'Monitor', roles: ['super_admin'], keywords: ['寄信', 'SMTP', '排程', '同步', '設定', '健康', '測試信'] },
```

`admin/src/router/index.ts` 在 `page('policies', ...)` 那行之前加：

```ts
      page('system-status', 'system-status', () => import('../views/SystemStatusView.vue')),
```

`admin/src/components/AdminSidebar.vue`：`@element-plus/icons-vue` 的 import 清單加 `Monitor`（照字母順序放在 `Memo` 之後）；`const icons` 物件也加 `Monitor`（放在 `Memo` 之後）。

- [ ] **Step 7：操作紀錄的中文**

`admin/src/api/labels.ts`：
- `AUDIT_ACTION_LABELS` 加 `'system.test_email': '寄測試信',`（放在其他 `s` 開頭的動作附近）。
- `AUDIT_METADATA_FORMATTERS` 在 `error_code` 那項之後加：

```ts
  // 系統狀態頁的測試信（system.test_email）：寄出或沒寄出；沒寄出時另有 error_code 寫原因。
  result: (v, action) => (action === 'system.test_email' ? (v === 'sent' ? '測試信已寄出' : '測試信沒有寄出') : `結果：${String(v)}`),
```

（`AuditFormatter` 的第二個參數是 action，`expires_at` 已經這樣用。）

- [ ] **Step 8：營運總覽一行**

`admin/src/views/DashboardView.vue`：
- `interface DashboardSummary` 的 `failed_notifications: number` 之前加：

```ts
  // 系統狀態「要注意」的項數（2026-10-15）：只有總管理者有，其他人是 null。
  system_attention?: number | null
```

- `hasTodo` 之前加 `const systemAttention = computed(() => summary.value?.system_attention ?? 0)`；`hasTodo` 的條件清單在 `s.failed_notifications > 0 ||` 之後加 `systemAttention.value > 0 ||`。
- 模板裡「通知寄送失敗」那個 `router-link`（`v-if="summary.failed_notifications > 0"`）之後加：

```vue
              <router-link v-if="systemAttention > 0" class="task task--urgent" to="/system-status" v-bind="taskAria('system')">
                <span id="task-system-n" class="task__number">{{ systemAttention }}</span>
                <div><h3 id="task-system-t">系統狀態有 {{ systemAttention }} 項要注意</h3><span id="task-system-d" class="visually-hidden">寄信設定、背景排程、轉檔或公開資料同步需要處理</span><span id="task-system-a" class="task__action">查看</span></div>
              </router-link>
```

- [ ] **Step 9：跑測試確認通過**

Run: `VITEST src/__tests__/systemStatus.test.ts src/__tests__/labelCoverage.test.ts src/__tests__/labels.test.ts src/__tests__/dashboardBoard20261006.test.ts src/__tests__/contactPhrasesView.test.ts`，再 `npm run typecheck`。
Expected: PASS；typecheck 無錯誤。再 `grep -rln "sidebar\|navItem\|NAV_GROUPS" src/__tests__ | head -20` 列出其他側欄測試，逐一跑一次（新項目可能改到側欄項目數或順序的斷言；若有寫死「系統」群組項目清單的斷言，把 `system-status` 補在 `policies` 前面）。

- [ ] **Step 10：Commit**

```bash
git add admin/src/utils/systemStatusFormat.ts admin/src/views/SystemStatusView.vue admin/src/__tests__/systemStatus.test.ts admin/src/router/nav.ts admin/src/router/index.ts admin/src/components/AdminSidebar.vue admin/src/api/types.ts admin/src/api/labels.ts admin/src/views/DashboardView.vue admin/src/__tests__/fixtures.ts
git commit -m "feat(admin): 系統狀態頁（四區、測試信）、側欄入口與營運總覽提示

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（Step 9 若改了其他側欄測試檔，一併列在 `git add`。）

---

### Task 4：家長參觀提醒信——寄送（kind、內容、寄送判斷）

**Files:**
- Modify: `backend/app/booking/outbox.py:27-48`
- Modify: `backend/app/notifications/parent_email.py:9-23,40-100`
- Modify: `backend/app/notifications/service.py:7,18-21,31-55,288-330`
- Modify: `admin/src/api/labels.ts:352-370`（`NOTIFICATION_KIND_LABELS`）
- Test: `backend/tests/test_parent_visit_reminder.py`（新檔，本 task 寫前半）

**Interfaces:**
- Consumes：`_dispatch_parent_email`（`service.py:255-334`）、`parent_policy.parent_change_deadline(visit, hours, *, day_closed)`、`change_deadline_hours(db, campus_key)`、`day_closed(db, visit)`（`booking/parent_policy.py`）、`today_local()`（`common/timezones.py`）。
- Produces（Task 5 依賴）：
  - `booking.outbox.PARENT_VISIT_REMINDER = "parent_visit_reminder"`，已在 `PARENT_KINDS`；`enqueue_parent_email` 對它丟 `ValueError`。
  - outbox payload 形狀：`{"campus_key": str, "receipt_id": str(案件 id), "slot_id": str(場次 id)}`。
  - `ParentEmail.day_word: str | None = None`（「明天」「今天」）。
  - kind 中文「參觀提醒（家長）」（後端 `_KIND_LABELS`、後台 `NOTIFICATION_KIND_LABELS`）。

- [ ] **Step 1：寫失敗的測試**

建立 `backend/tests/test_parent_visit_reminder.py`：

```python
"""參觀前 24 小時的家長提醒信（2026-10-15 規格 docs/specs/2026-10-15-parent-visit-reminder-design.md）。

前半（Task 4）：信件內容與寄送判斷，outbox 列直接寫入；後半（Task 5）：維護排程的排入。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.booking.models import BookingConfig, OutboxMessage, VisitException, VisitRequest, VisitSlot
from app.booking.outbox import PARENT_KINDS, PARENT_VISIT_REMINDER, enqueue_parent_email
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications.parent_email import ParentEmail, build_parent_email
from app.notifications.service import notification_label
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot
from tests.test_notification_retry_reminders import _fail_until_given_up

pytestmark = pytest.mark.usefixtures("booking_consent")
ORIGIN = "https://www.ivy.example"


def _mail(**changes) -> ParentEmail:
    base = dict(
        kind=PARENT_VISIT_REMINDER,
        campus_name="義華校",
        salutation="陳小姐",
        slot_date=date(2026, 10, 16),
        start_time=time(9, 30),
        end_time=time(10, 30),
        party_size=None,
        campus_address="高雄市三民區範例路 1 號",
        campus_phone="07-3000000",
        manage_url=None,
        change_deadline=datetime(2026, 10, 15, 1, 30, tzinfo=timezone.utc),
        cancel_reason=None,
        rebook_url=None,
        day_word="明天",
    )
    base.update(changes)
    return ParentEmail(**base)


def test_reminder_kind_is_a_parent_mail_queued_only_by_the_scan():
    assert PARENT_VISIT_REMINDER in PARENT_KINDS
    assert notification_label(PARENT_VISIT_REMINDER) == "參觀提醒（家長）"


async def test_enqueue_parent_email_refuses_the_reminder_kind(db_session):
    with pytest.raises(ValueError):
        await enqueue_parent_email(db_session, object(), PARENT_VISIT_REMINDER)


def test_reminder_subject_intro_and_call_us():
    subject, body = build_parent_email(_mail())
    assert subject == "【常春藤義華】參觀提醒：明天 10/16（五）上午場 09:30"
    assert body.startswith("陳小姐您好：")
    assert "提醒您，明天 10/16（五）上午場 09:30 在常春藤義華校參觀。" in body
    assert "地址：高雄市三民區範例路 1 號" in body
    assert "要改期或取消，請來電 07-3000000。" in body
    assert "#token=" not in body


def test_reminder_inside_the_deadline_has_the_link_and_deadline():
    _, body = build_parent_email(_mail(
        manage_url=f"{ORIGIN}/visit/manage#token=abc", change_deadline=datetime(2026, 10, 15, 13, 30, tzinfo=timezone.utc),
    ))
    assert "要改期或取消，請在 10/15（四）21:30 前使用這個連結：" in body
    assert f"{ORIGIN}/visit/manage#token=abc" in body
    assert "請來電" not in body


def test_reminder_today_and_without_a_phone():
    subject, body = build_parent_email(_mail(day_word="今天", campus_phone=None))
    assert subject == "【常春藤義華】參觀提醒：今天 10/16（五）上午場 09:30"
    assert "要改期或取消，請來電洽詢。" in body


# --- 寄送判斷（真資料庫） -----------------------------------------------------------


async def _visit_starting_in(admin_client, public_client, db_session, hours: float) -> tuple[str, str, datetime]:
    """官網預約一筆（Email parent@example.com），把場次挪到 hours 小時後開始；確認時間改成 5 天前
    （確認時還沒進提醒範圍）。回傳（案件 id、場次 id、場次開始的台北時間）。"""
    booked = await book_slot(admin_client, public_client)
    starts = (datetime.now(timezone.utc) + timedelta(hours=hours)).astimezone(OPERATING_TZ)
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(booked["slot_id"]))
        .values(slot_date=starts.date(), start_time=time(starts.hour, starts.minute), end_time=time(23, 59))
    )
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(booked["receipt_id"]))
        .values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=5))
    )
    await db_session.commit()
    return booked["receipt_id"], booked["slot_id"], starts


async def _queue_reminder(db_session, receipt_id: str, slot_id: str) -> uuid.UUID:
    """Task 5 之前沒有排入函式：直接寫一列，形狀與 enqueue_due_parent_reminders 相同。"""
    now = datetime.now(timezone.utc)
    message_id = uuid.uuid4()
    db_session.add(OutboxMessage(
        id=message_id,
        visit_request_id=uuid.UUID(receipt_id),
        kind=PARENT_VISIT_REMINDER,
        payload={"campus_key": "yihua", "receipt_id": receipt_id, "slot_id": slot_id},
        created_at=now,
        next_attempt_at=now,
        status="pending",
        attempts=0,
        dedupe_key=f"{PARENT_VISIT_REMINDER}:{receipt_id}:{slot_id}",
    ))
    await db_session.commit()
    return message_id


async def _run(app, db_session, adapter, *, origin: str | None = ORIGIN):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=origin, access_secret=app.state.settings.session_secret,
    )


def _reminder_mails(adapter) -> list[dict]:
    return [mail for mail in adapter.sent if "參觀提醒" in mail["subject"]]


async def _reminder_status(db_session) -> str:
    return (
        await db_session.execute(select(OutboxMessage.status).where(OutboxMessage.kind == PARENT_VISIT_REMINDER))
    ).scalar_one()


async def test_reminder_past_the_default_deadline_asks_to_call(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, starts = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, recording_mail_adapter)
    [mail] = _reminder_mails(recording_mail_adapter)
    assert mail["to"] == "parent@example.com"
    word = "明天" if starts.date() == today_local() + timedelta(days=1) else "今天"
    assert mail["subject"].startswith(f"【常春藤義華】參觀提醒：{word} ")
    # 預設期限是參觀前 24 小時：寄出時已過，不附連結。
    assert "#token=" not in mail["body"]
    assert "要改期或取消，請來電" in mail["body"]
    for secret in ("0912345678",):
        assert secret not in mail["body"]
    assert await _reminder_status(db_session) == "sent"


async def test_reminder_inside_a_shorter_deadline_links_the_manage_page(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await db_session.execute(update(BookingConfig).where(BookingConfig.campus_key == "yihua").values(parent_change_deadline_hours=12))
    await db_session.commit()
    await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, recording_mail_adapter)
    [mail] = _reminder_mails(recording_mail_adapter)
    assert f"{ORIGIN}/visit/manage#token=" in mail["body"]
    assert "前使用這個連結" in mail["body"]


async def test_reminder_without_admin_origin_asks_to_call(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await db_session.execute(update(BookingConfig).where(BookingConfig.campus_key == "yihua").values(parent_change_deadline_hours=12))
    await db_session.commit()
    await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, recording_mail_adapter, origin=None)
    [mail] = _reminder_mails(recording_mail_adapter)
    assert "#token=" not in mail["body"]
    assert "要改期或取消，請來電" in mail["body"]


async def test_reminder_for_another_slot_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await _queue_reminder(db_session, receipt, str(uuid.uuid4()))
    await _run(app, db_session, recording_mail_adapter)
    assert _reminder_mails(recording_mail_adapter) == []
    assert await _reminder_status(db_session) == "skipped"


async def test_reminder_after_cancel_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await _queue_reminder(db_session, receipt, slot)
    cancelled = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    await _run(app, db_session, recording_mail_adapter)
    assert _reminder_mails(recording_mail_adapter) == []
    assert await _reminder_status(db_session) == "skipped"


async def test_reminder_on_a_closed_day_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, starts = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await db_session.execute(update(VisitSlot).where(VisitSlot.id == uuid.UUID(slot)).values(closed=True))
    db_session.add(VisitException(
        id=uuid.uuid4(), campus_key="yihua", exception_date=starts.date(), reason="颱風停班停課", created_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()
    await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, recording_mail_adapter)
    assert _reminder_mails(recording_mail_adapter) == []
    assert await _reminder_status(db_session) == "skipped"


async def test_reminder_without_mail_settings_or_after_anonymizing_is_skipped(app, admin_client, public_client, db_session):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, None)
    assert await _reminder_status(db_session) == "skipped"

    other, other_slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=22)
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(other)).values(anonymized_at=datetime.now(timezone.utc)))
    await db_session.commit()
    message_id = await _queue_reminder(db_session, other, other_slot)

    class _Recorder:
        sent: list = []

        def send(self, *, to, subject, body):
            self.sent.append(subject)

    recorder = _Recorder()
    await _run(app, db_session, recorder)
    row = await db_session.get(OutboxMessage, message_id)
    await db_session.refresh(row)
    assert row.status == "skipped"
    assert not [subject for subject in recorder.sent if "參觀提醒" in subject]


async def test_failed_reminder_lands_in_the_failed_list(app, admin_client, public_client, db_session, failing_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    message_id = await _queue_reminder(db_session, receipt, slot)
    message = await _fail_until_given_up(db_session, message_id, failing_mail_adapter, None)
    assert message.status == "failed"
    listed = await admin_client.get("/api/website/v1/admin/notification-outbox")
    assert listed.status_code == 200, listed.text
    assert PARENT_VISIT_REMINDER in {item["kind"] for item in listed.json()["items"]}
```

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_parent_visit_reminder.py`
Expected: FAIL（`ImportError: cannot import name 'PARENT_VISIT_REMINDER'`）。

- [ ] **Step 3：kind 常數（P7）**

`backend/app/booking/outbox.py`：在 `PARENT_VISIT_DAY_CLOSED = ...` 之後加：

```python
# 參觀前 24 小時提醒家長（2026-10-15 規格 docs/specs/2026-10-15-parent-visit-reminder-design.md）。
# 只由 notifications/reminders.enqueue_due_parent_reminders 排（帶去重鍵與場次），不走 enqueue_parent_email。
PARENT_VISIT_REMINDER = "parent_visit_reminder"
```

`PARENT_KINDS` 加上 `PARENT_VISIT_REMINDER`；`enqueue_parent_email` 的第一個判斷改成：

```python
    if kind not in PARENT_KINDS or kind in (PARENT_VISIT_DAY_CLOSED, PARENT_VISIT_REMINDER):
        raise ValueError(kind)
```

- [ ] **Step 4：信件內容**

`backend/app/notifications/parent_email.py`：
- import 清單加 `PARENT_VISIT_REMINDER`。
- `_TITLES` 加 `PARENT_VISIT_REMINDER: "參觀提醒",`。
- `ParentEmail` 在 `closure_reason` 之後加：

```python
    # 參觀提醒寫「明天」或「今天」（寄出當下的台北日期，規格 R8）；其他種類為 None。
    day_word: str | None = None
```

- `build_parent_email` 的主旨那兩行改成：

```python
    when = visit_when(mail.slot_date, mail.start_time) if mail.slot_date and mail.start_time else None
    day = f"{mail.day_word} " if mail.kind == PARENT_VISIT_REMINDER and mail.day_word else ""
    subject = f"【常春藤{short_name}】{_TITLES[mail.kind]}" + (f"：{day}{when}" if when else "")
```

- intro 的 `if mail.kind == PARENT_VISIT_BOOKED:` 之後加一個分支：

```python
    elif mail.kind == PARENT_VISIT_REMINDER:
        intro = f"提醒您，{day}{when} 在常春藤{mail.campus_name}參觀。" if when else f"提醒您，記得到常春藤{mail.campus_name}參觀。"
```

- 結尾段落的 `elif mail.kind == PARENT_VISIT_DAY_CLOSED:` 那個分支之後、`elif mail.manage_url:` 之前加：

```python
    elif mail.kind == PARENT_VISIT_REMINDER:
        # 提醒時多半已過線上修改期限（預設參觀前 24 小時）：期限內才附連結，否則請家長來電（規格 R7）。
        if mail.manage_url and mail.change_deadline:
            lines += [
                f"要改期或取消，請在 {_deadline_text(mail.change_deadline)} 前使用這個連結：",
                mail.manage_url,
                "請勿把這個連結轉給他人。",
            ]
        elif mail.campus_phone:
            lines.append(f"要改期或取消，請來電 {mail.campus_phone}。")
        else:
            lines.append("要改期或取消，請來電洽詢。")
```

- [ ] **Step 5：寄送判斷**

`backend/app/notifications/service.py`：
- `from datetime import datetime, timedelta, timezone` 改成 `from datetime import date, datetime, timedelta, timezone`。
- `from app.booking.outbox import ...` 加 `PARENT_VISIT_REMINDER`；`from app.common.timezones import slot_start_utc` 改成 `from app.common.timezones import slot_start_utc, today_local`。
- `_KIND_LABELS` 在 `"parent_visit_day_closed": ...` 之後加：

```python
    # 參觀前 24 小時提醒家長（2026-10-15）。
    "parent_visit_reminder": "參觀提醒（家長）",
```

- 在 `_dispatch_parent_email` 定義之前加：

```python
def _day_word(slot_date: date) -> str | None:
    """參觀提醒的「明天／今天」依寄出當下的台北日期（規格 R8）；其他天數不寫。"""
    return {0: "今天", 1: "明天"}.get((slot_date - today_local()).days)
```

- `_dispatch_parent_email` 中，從 `# 停課通知寄出前：` 那段 `return False` 之後、到 `ParentEmail(...)` 組好為止，換成下面這段（停課通知的判斷保留在最前面）：

```python
    # 參觀提醒（2026-10-15 規格 R6）：場次換了（改期）或那天停課（另有停課信）就不寄。
    if kind == PARENT_VISIT_REMINDER and (
        slot is None or str(slot.id) != str(payload.get("slot_id")) or await day_closed(db, visit_request)
    ):
        return False
    recipient_key = f"parent:{visit_request.id}"
    if await _already_delivered(db, outbox_message_id, "email", recipient_key):
        return True
    origin = admin_origin.rstrip("/") if admin_origin else None
    deadline = parent_change_deadline(
        visit_request,
        await change_deadline_hours(db, visit_request.campus_key),
        day_closed=kind == PARENT_VISIT_DAY_CLOSED,
    )
    # 參觀提醒只在線上修改期限還沒過時附連結（R7）；其他家長信照舊（取消信不附）。
    link_allowed = kind != PARENT_VISIT_CANCELLED and (
        kind != PARENT_VISIT_REMINDER or (deadline is not None and datetime.now(timezone.utc) < deadline)
    )
    manage_url = None
    if link_allowed and origin and access_secret:
        path = await access_service.current_manage_path(db, visit_request.id, secret=access_secret)
        manage_url = f"{origin}{path}" if path else None
    profile = await content_service.published_payload(db, "campus_profile", visit_request.campus_key) or {}
    subject, body = build_parent_email(
        ParentEmail(
            kind=kind,
            campus_name=await _campus_name(db, visit_request.campus_key),
            salutation=parent_salutation(visit_request.parent_name),
            slot_date=slot.slot_date if slot else None,
            start_time=slot.start_time if slot else None,
            end_time=slot.end_time if slot else None,
            party_size=visit_request.party_size,
            campus_address=str(profile.get("address") or "").strip() or None,
            campus_phone=str(profile.get("phone") or "").strip() or None,
            manage_url=manage_url,
            change_deadline=deadline,
            cancel_reason=visit_request.cancel_reason,
            rebook_url=f"{origin}/visit/{visit_request.campus_key}" if origin else None,
            closure_reason=str(payload.get("reason") or "").strip() or None if kind == PARENT_VISIT_DAY_CLOSED else None,
            day_word=_day_word(slot.slot_date) if kind == PARENT_VISIT_REMINDER and slot else None,
        )
    )
```

（之後的 `recipient = _header_safe(...)`、`await db.commit()`、寄信與記錄維持原樣。）

- [ ] **Step 6：後台的 kind 中文**

`admin/src/api/labels.ts` 的 `NOTIFICATION_KIND_LABELS`，在 `parent_visit_day_closed` 之後加：

```ts
  // 參觀前 24 小時提醒家長（2026-10-15）。
  parent_visit_reminder: '參觀提醒（家長）',
```

- [ ] **Step 7：跑測試確認通過**

Run: `PYTEST tests/test_parent_visit_reminder.py tests/test_parent_email.py tests/test_visit_closure.py tests/test_notification_retry_reminders.py tests/test_parent_manage_link.py`
再 `VITEST src/__tests__/labelCoverage.test.ts src/__tests__/labels.test.ts`。
Expected: PASS（既有家長信、停課信、提醒、管理連結的測試不變）。

- [ ] **Step 8：Commit**

```bash
git add backend/app/booking/outbox.py backend/app/notifications/parent_email.py backend/app/notifications/service.py backend/tests/test_parent_visit_reminder.py admin/src/api/labels.ts
git commit -m "feat(notifications): 家長參觀提醒信的內容與寄送判斷（期限內附連結、改期停課取消不寄）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5：家長參觀提醒信——排入（掃描、維護排程、CLI）

**Files:**
- Modify: `backend/app/notifications/reminders.py:1-127`
- Modify: `backend/app/workers/maintenance.py:45-82,158-166`
- Modify: `backend/app/cli.py:165-166`
- Test: `backend/tests/test_parent_visit_reminder.py`（後半）

**Interfaces:**
- Consumes（Task 4）：`PARENT_VISIT_REMINDER`、payload 形狀、去重鍵格式。
- Produces：
  - `async def enqueue_due_parent_reminders(db: AsyncSession, now: datetime | None = None) -> int`（回傳新寫入則數，呼叫端 commit）
  - `def parent_reminder_key(visit_request_id: uuid.UUID, slot_id: uuid.UUID) -> str`
  - `CycleResult.parent_reminders_enqueued: int`
  - `enqueue_due_reminders` 的行為與回傳值不變（只算員工提醒，P6）。

- [ ] **Step 1：寫失敗的測試**

在 `backend/tests/test_parent_visit_reminder.py` import 區補 `from app.notifications import reminders`、`from app.workers.maintenance import run_cycle`、`from tests.conftest import create_slot, legacy_request`（和既有的 `book_slot` 合成一行），檔尾加：

```python
# --- 排入（Task 5） ------------------------------------------------------------------


async def _slot_start(db_session, slot_id: str) -> datetime:
    from app.common.timezones import slot_start_utc

    slot = (await db_session.execute(
        select(VisitSlot).where(VisitSlot.id == uuid.UUID(slot_id)).execution_options(populate_existing=True)
    )).scalar_one()
    return slot_start_utc(slot.slot_date, slot.start_time)


async def _queued(db_session) -> list[OutboxMessage]:
    rows = await db_session.execute(
        select(OutboxMessage).where(OutboxMessage.kind == PARENT_VISIT_REMINDER).order_by(OutboxMessage.created_at)
    )
    return list(rows.scalars())


async def test_parent_reminder_queued_once_at_24_hours(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    starts = await _slot_start(db_session, booked["slot_id"])
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=24, minutes=1)) == 0
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=24)) == 1
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=23)) == 0
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts) == 0
    await db_session.commit()
    [row] = await _queued(db_session)
    assert row.payload == {"campus_key": "yihua", "receipt_id": booked["receipt_id"], "slot_id": booked["slot_id"]}
    assert row.dedupe_key == f"parent_visit_reminder:{booked['receipt_id']}:{booked['slot_id']}"
    # 員工提醒不受影響：同一個時間點照樣一則（P6）。
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=23)) == 1


async def test_no_parent_reminder_without_email_or_after_anonymizing(admin_client, public_client, db_session):
    no_email = await legacy_request(db_session, status="confirmed", email=None)
    slot_id = (await db_session.get(VisitRequest, uuid.UUID(no_email))).slot_id
    starts = await _slot_start(db_session, str(slot_id))
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=23)) == 0

    booked = await book_slot(admin_client, public_client)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    starts = await _slot_start(db_session, booked["slot_id"])
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=23)) == 0


async def test_confirmed_or_rescheduled_inside_the_window_gets_no_parent_reminder(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    starts = await _slot_start(db_session, booked["slot_id"])
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])).values(confirmed_at=starts - timedelta(hours=2))
    )
    await db_session.commit()
    # 參觀前 2 小時才確認（後台補登臨時約）：確認信就是提醒（R4）。
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=1)) == 0


async def test_reschedule_gives_the_new_slot_its_own_reminder(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    first = await _slot_start(db_session, booked["slot_id"])
    assert await reminders.enqueue_due_parent_reminders(db_session, now=first - timedelta(hours=23)) == 1
    await db_session.commit()
    second_slot = await create_slot(admin_client, capacity=2, days_ahead=5)
    moved = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{booked['receipt_id']}/reschedule", json={"new_slot_id": second_slot}
    )
    assert moved.status_code == 200, moved.text
    # 改期在新場次開始前 48 小時以上完成，到點照常提醒（新的去重鍵）。
    await db_session.execute(
        update(VisitRequestEvent)
        .where(VisitRequestEvent.visit_request_id == uuid.UUID(booked["receipt_id"]), VisitRequestEvent.event_type == "rescheduled")
        .values(created_at=datetime.now(timezone.utc) - timedelta(days=1))
    )
    await db_session.commit()
    second = await _slot_start(db_session, second_slot)
    assert await reminders.enqueue_due_parent_reminders(db_session, now=second - timedelta(hours=23)) == 1
    await db_session.commit()
    assert [row.payload["slot_id"] for row in await _queued(db_session)] == [booked["slot_id"], second_slot]


async def test_maintenance_cycle_queues_the_parent_reminder(app, admin_client, db_session):
    slot_id = await create_slot(admin_client, capacity=2)
    receipt = await legacy_request(db_session, status="confirmed", slot_id=slot_id, email="parent@example.com")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)).values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=5))
    )
    starts = (datetime.now(timezone.utc) + timedelta(hours=23)).astimezone(OPERATING_TZ)
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(slot_id))
        .values(slot_date=starts.date(), start_time=time(starts.hour, starts.minute), end_time=time(23, 59))
    )
    await db_session.commit()

    settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})
    result = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert result.failed_steps == []
    assert (result.reminders_enqueued, result.parent_reminders_enqueued) == (1, 1)
    # 沒有寄信管道：家長提醒照排、寄送時 skipped（不報錯、不重試）。
    [row] = await _queued(db_session)
    await db_session.refresh(row)
    assert row.status == "skipped"
    again = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert again.parent_reminders_enqueued == 0
```

（`VisitRequestEvent` 補進 `from app.booking.models import ...`。）

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_parent_visit_reminder.py`
Expected: FAIL（`AttributeError: module 'app.notifications.reminders' has no attribute 'enqueue_due_parent_reminders'`）。

- [ ] **Step 3：排入**

`backend/app/notifications/reminders.py`：

(a) 模組說明在「即將參觀」那條之後加一條：

```
- 家長參觀提醒（2026-10-15，kind 在 booking/outbox.py 的 PARENT_VISIT_REMINDER，走家長信管線）：
  與即將參觀同一個到點判斷，只排有 Email 的案件；去重鍵含場次 id，寄送當下由
  notifications/service.py 的家長信分派再判斷一次（改期、停課、取消都不寄）。
```

(b) import 區加 `from app.booking.outbox import PARENT_VISIT_REMINDER`。

(c) `upcoming_key` 之後加：

```python
def parent_reminder_key(visit_request_id: uuid.UUID, slot_id: uuid.UUID) -> str:
    return f"{PARENT_VISIT_REMINDER}:{visit_request_id}:{slot_id}"
```

(d) 把 `enqueue_due_reminders` 換成下面三個函式（`_due_upcoming` 是原本迴圈裡的判斷，多選一個 `email` 欄）：

```python
async def _due_upcoming(db: AsyncSession, now: datetime) -> list[tuple[uuid.UUID, str, str | None, VisitSlot]]:
    """到點的即將參觀：已確認、未匿名化、`remind_at <= now < 開始`，且確認或改期到這個時段時
    還沒進提醒範圍。員工與家長提醒共用這個判斷（2026-10-15 規格 R4）。回傳（案件 id、校區、Email、場次）。"""
    today = today_local(now)
    upcoming = await db.execute(
        select(
            VisitRequest.id,
            VisitRequest.campus_key,
            VisitRequest.email,
            VisitRequest.confirmed_at,
            _last_rescheduled_at(),
            VisitSlot,
        )
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            VisitRequest.anonymized_at.is_(None),
            VisitSlot.slot_date >= today,
            VisitSlot.slot_date <= today + timedelta(days=2),
        )
    )
    due = []
    for visit_id, campus_key, email, confirmed_at, rescheduled_at, slot in upcoming.all():
        starts = slot_start_utc(slot.slot_date, slot.start_time)
        remind_at = starts - UPCOMING_VISIT_LEAD
        if not remind_at <= now < starts:
            continue
        # 確認或改期到這個時段時已經在提醒範圍內：那則通知就是提醒。
        on_this_slot_since = max((t for t in (confirmed_at, rescheduled_at) if t is not None), default=None)
        if on_this_slot_since is not None and on_this_slot_since > remind_at:
            continue
        due.append((visit_id, campus_key, email, slot))
    return due


async def enqueue_due_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """掃描到點的員工提醒寫進 outbox，回傳新寫入的則數。呼叫端負責 commit。
    `now` 是判斷「到點了沒」的時間點，預設現在（測試可以指定）。"""
    now = now or now_utc()
    created = 0
    for visit_id, campus_key, _email, slot in await _due_upcoming(db, now):
        payload = {"campus_key": campus_key, "receipt_id": str(visit_id), "slot_id": str(slot.id)}
        created += await _enqueue(db, visit_id, UPCOMING_VISIT_KIND, payload, upcoming_key(visit_id, slot.id))
    return created


async def enqueue_due_parent_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """家長參觀提醒（2026-10-15 規格）：同一個到點判斷，只排有 Email 的案件；回傳新寫入的則數。
    呼叫端負責 commit。"""
    now = now or now_utc()
    created = 0
    for visit_id, campus_key, email, slot in await _due_upcoming(db, now):
        if not email:
            continue
        payload = {"campus_key": campus_key, "receipt_id": str(visit_id), "slot_id": str(slot.id)}
        created += await _enqueue(db, visit_id, PARENT_VISIT_REMINDER, payload, parent_reminder_key(visit_id, slot.id))
    return created
```

- [ ] **Step 4：維護排程與 CLI**

`backend/app/workers/maintenance.py`：
- `CycleResult` 在 `reminders_enqueued: int = 0` 之後加 `parent_reminders_enqueued: int = 0`；`did_anything` 的 tuple 在 `self.reminders_enqueued,` 之後加 `self.parent_reminders_enqueued,`。
- 「到點的提醒」那一步改成（同一個 session、同一次 commit，失敗一樣記 `reminders`）：

```python
    # 到點的提醒（員工的即將參觀、家長的參觀提醒）寫進 outbox，這一輪就會一起送出。
    # 以 dedupe_key 去重，重跑不會重複寫。
    try:
        async with session_factory() as db:
            result.reminders_enqueued = await reminders.enqueue_due_reminders(db)
            result.parent_reminders_enqueued = await reminders.enqueue_due_parent_reminders(db)
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("定期工作：產生提醒失敗")
        result.failed_steps.append("reminders")
```

`backend/app/cli.py` 在 `if result.reminders_enqueued:` 那兩行之後加：

```python
    if result.parent_reminders_enqueued:
        print(f"已排 {result.parent_reminders_enqueued} 封家長參觀提醒信。")
```

- [ ] **Step 5：跑測試確認通過**

Run: `PYTEST tests/test_parent_visit_reminder.py tests/test_notification_retry_reminders.py tests/test_maintenance.py tests/test_parent_email.py tests/test_visit_closure.py`
再 `VITEST src/__tests__/labelCoverage.test.ts`（`reminders.py` 的 `*_KIND` 常數仍只有 `visit_upcoming`）。
Expected: PASS。

- [ ] **Step 6：Commit**

```bash
git add backend/app/notifications/reminders.py backend/app/workers/maintenance.py backend/app/cli.py backend/tests/test_parent_visit_reminder.py
git commit -m "feat(notifications): 維護排程在參觀前 24 小時排入家長提醒信（同一個到點判斷、計數分開）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6：stack e2e（系統狀態頁）

**Files:**
- Create: `tests/stack/system-status.spec.ts`

**Interfaces:**
- Consumes（Task 3）：`/admin/system-status` 的 DOM（四個 h2、`li.status-row[data-key="smtp"]`、按鈕「寄一封測試信給我」、`role="status"`、「重新整理」、`資料時間`）；`tests/stack/pages.ts` 的 `openAs`、`gotoAdmin`、`expectNoHorizontalOverflow`；`tests/stack/mail.ts` 的 `readMail`；`tests/stack/stack-env.ts` 的 `USERS`。
- Produces：截圖 `output/playwright/system-status-1440.png`、`system-status-390.png`。

stack 環境（`tests/stack/start-api.sh`）：`WEBSITE_ENVIRONMENT=test`、寄信用本機 sink、背景工作每 10 秒一輪、招生開啟、自動同步關閉。所以寄信列是「資訊：本機資料夾」、測試信寫進 sink、公開資料區存在。**不要斷言「要注意」的總數**（隨環境變化）。家長提醒信不在 stack 測（規格 §4：stack 沒有寄件出口以外的方式驗證，後端測試已涵蓋）。

- [ ] **Step 1：寫 spec**

```ts
import { expect, test } from '@playwright/test'
import { readMail } from './mail'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { USERS } from './stack-env'

// 系統狀態頁（2026-10-15）：總管理者看四區、寄測試信（stack 寫進本機 sink）；手機不溢出；櫃台看不到。
const SUBJECT = '【常春藤官網後台】測試信'
const mine = () => readMail((mail) => mail.to === USERS.super_admin.email && mail.subject === SUBJECT)

test('總管理者看系統狀態、寄測試信；櫃台看不到這一頁', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/system-status', '系統狀態')
  for (const title of ['對外服務設定', '背景工作', '公開資料', '通知與發布']) {
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
  }
  const smtp = page.locator('li.status-row[data-key="smtp"]')
  await expect(smtp).toContainText('本機資料夾')

  const before = (await mine()).length
  await smtp.getByRole('button', { name: '寄一封測試信給我' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已寄到' })).toBeVisible()
  await expect.poll(async () => (await mine()).length).toBe(before + 1)

  await page.getByRole('button', { name: '重新整理' }).click()
  await expect(page.getByText(/資料時間/)).toBeVisible()
  await page.screenshot({ path: 'output/playwright/system-status-1440.png', fullPage: true })
  await context.close()

  const mobile = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await gotoAdmin(mobile.page, '/system-status', '系統狀態')
  await expectNoHorizontalOverflow(mobile.page)
  await mobile.page.screenshot({ path: 'output/playwright/system-status-390.png', fullPage: true })
  await mobile.context.close()

  const desk = await openAs(browser, 'reception')
  await desk.page.goto('/admin/system-status')
  await expect(desk.page).toHaveURL(/\/admin\/$/)
  await expect(desk.page.getByRole('navigation', { name: '主選單' }).getByRole('link', { name: '系統狀態' })).toHaveCount(0)
  await desk.context.close()
})
```

- [ ] **Step 2：build 並只跑這支**

```bash
export E2E_DB_NAME=ivy_website_wave1_1015_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751
source ~/.nvm/nvm.sh; nvm use 22
npm run e2e:build
npx playwright test -c playwright.stack.config.ts tests/stack/system-status.spec.ts
```

Expected: 1 passed。人工看兩張截圖：四區依序、標籤顏色清楚、手機寬度內容不撐出畫面。若櫃台被導回的網址帶 `?denied=system-status` 沒被清掉，改成 `toHaveURL(/\/admin\/(\?denied=system-status)?$/)` 並在報告寫明（`roles.spec.ts` 目前的斷言是 `/\/admin\/$/`）。

- [ ] **Step 3：Commit**

```bash
git add tests/stack/system-status.spec.ts
git commit -m "test(e2e): 系統狀態頁（四區、測試信寫進 sink、手機不溢出、櫃台看不到）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7：文件與規格對齊

**Files:**
- Modify: `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`、`docs/website-admin/operations.md`、`docs/specs/2026-10-15-admin-system-status-design.md`、`docs/specs/2026-10-15-parent-visit-reminder-design.md`

**Interfaces:** 無（只改文件）。

- [ ] **Step 1：DESIGN.md 新增兩節**

在 `DESIGN.md` 最上方（第一個 `## ` 之前）插入：

```markdown
## 後台：系統狀態頁（2026-10-15，`feature/admin-wave1-20261015`）

正式站「功能做好、靠環境變數才會動」的服務（寄信、LINE 推播、Turnstile、Google／LINE 登入、S3、公開資料自動同步、個資自動清理）與三條背景迴圈（維護排程、轉檔、公開資料同步），以前沒有任何後台畫面看得到；連「正式站設好寄信了沒」都要翻部署紀錄。規格 `docs/specs/2026-10-15-admin-system-status-design.md`。

- **對象**：只有總管理者（`system.status`）。側欄「系統 → 系統狀態」；總管理者的營運總覽「要處理」在有「要注意」時多一行「系統狀態有 N 項要注意」。
- **四區**：對外服務設定、背景工作、公開資料（招生開關關閉時不顯示）、通知與發布。每列＝名稱、狀態標籤（正常／要注意／資訊／關閉）、一句說明、處理連結。後端只回 key、level 與結構化 detail，文案在 `admin/src/utils/systemStatusFormat.ts`。
- **要注意只有會讓人「以為有、其實沒有」的**：正式站沒設寄信、維護排程超過 max(5 分鐘, 5 輪) 沒跑完或有失敗步驟、轉檔背景程式沒在跑或有素材處理失敗（看素材狀態，不看失敗的工作列）、公開資料同步失敗或超過「更新週期＋3 天」沒動、門牌超過 35 天沒換版。Turnstile、登入方式、LINE 推播、S3 是選擇，只列「資訊」。寄送失敗與排程發布失敗列筆數與連結，但不算進要注意（總覽各有一行）。
- **門牌**：正式站連不到 data.kcg.gov.tw，自動下載必定失敗；門牌列過期或失敗都寫「請到電腦上用匯入指令更新門牌（每月一次）」。
- **不顯示秘密**：設定只回「有沒有設」；寄信例外顯示主機、port、加密方式、寄件地址；維護排程與轉檔只顯示哪一步失敗、不顯示錯誤原文；公開資料的 `last_error` 照顯示（來源與 HTTP 錯誤，不含地址）。
- **測試信**：寄到自己帳號的 Email、不走佇列、結果當場顯示（寄出或沒寄出的原因，不顯示原始錯誤）；每人 10 分鐘 3 封；寫操作紀錄（只記成功或失敗與例外類別）。
- **限制**：背景迴圈的狀態是回應這次請求的程序記憶體裡的；正式站目前單一副本，改多副本要重新設計這一區。進頁讀一次、按「重新整理」才更新，不自動輪詢。
- **不做**：在後台改設定或顯示原值、異常推播或寄信、歷史紀錄、多副本彙整、LINE 測試推播（「LINE 通知」頁已有）、改 `/health`。

## 預約：參觀前 24 小時家長提醒信（2026-10-15，`feature/admin-wave1-20261015`）

以前只提醒員工（「即將參觀」），家長除了確認信，參觀前不會再收到信。規格 `docs/specs/2026-10-15-parent-visit-reminder-design.md`。

- **時機與對象**：開始前 24 小時（與員工提醒同一個常數、同一個到點判斷），已確認、有 Email、未匿名化的案件，官網預約與後台補登都算；確認或改期到這個場次時已經在 24 小時內的不寄（那封確認信或變更信就是提醒）。同一個場次只寄一次，改期換場次重新計算。
- **寄出前再判斷**：狀態仍是已確認、場次沒變、還沒開始、那天不是停課日（停課有自己的信）、未匿名化；不符就 skipped。
- **內容**：主旨「【常春藤〇〇】參觀提醒：明天 10/16（五）上午場 09:30」（寄出當下是當天就寫「今天」），內文有日期場次、地址、電話。線上修改期限還沒過才附修改連結與截止時間；預設期限是參觀前 24 小時，多數情況寫「要改期或取消，請來電 〇〇」。
- **只走 Email**，沒設寄信時 skipped；失敗照家長信的重試，進寄送失敗清單（「參觀提醒（家長）」）可重寄。
- **限制**：改期後又改回原本那一場，原本那則提醒的去重鍵已用過，不會再寄第二次。
- **不做**：簡訊、LINE、第二封、各校開關、退訂、在信裡放孩子資料或完整電話。
```

- [ ] **Step 2：README.md 頂部加日期段落**

在 `README.md` 最上方（第一個 `## ` 之前）插入（驗證條由 Task 8 回填）：

```markdown
## 2026-10-15 後台第 1 波：系統狀態頁＋家長參觀提醒信（`feature/admin-wave1-20261015`）

10-15 後台功能盤點選出的六項之第 1 波。規則見 DESIGN.md「後台：系統狀態頁」「預約：參觀前 24 小時家長提醒信」；規格 `docs/specs/2026-10-15-admin-system-status-design.md`、`docs/specs/2026-10-15-parent-visit-reminder-design.md`；計畫 `docs/superpowers/plans/2026-10-15-admin-wave1-status-reminder.md`。

- **系統狀態頁**（只有總管理者）：寄信、LINE 推播、Turnstile、Google／LINE 登入、素材儲存、招生與同步開關、個資自動清理有沒有設；維護排程、轉檔、公開資料同步是否在跑；各項公開資料的版本與是否過期（門牌 35 天）；寄送與排程發布失敗筆數。可寄測試信給自己；營運總覽在有「要注意」時多一行。
- **家長參觀提醒信**：參觀前 24 小時寄 Email；期限內附修改連結，過了請家長來電；改期、停課、取消、匿名化後不寄。正式站設好寄信之前一律 skipped。
- **資料**：不新增 migration、不新增環境變數；`/health` 不變。
```

- [ ] **Step 3：acceptance.md 與 operations.md**

`docs/website-admin/acceptance.md` 檔尾加一節（Task 8 回填數字）：

```markdown
## 後台第 1 波：系統狀態頁＋家長參觀提醒信（2026-10-15，`feature/admin-wave1-20261015`）

### 已驗證
- 後端：`test_system_status.py`（各列判斷、權限、不含秘密、測試信、總覽數字、總覽不被拖垮）、`test_parent_visit_reminder.py`（信件內容、寄送判斷、排入、維護排程）。
- admin：`systemStatus.test.ts`（後端清單都有中文、文案與連結、頁面、側欄與權限、總覽一行）。
- stack：`system-status.spec.ts`（四區、測試信寫進 sink、手機 390 不溢出、櫃台看不到）。
- 全套閘門：見 Task 8 回填。

### 未驗證
- 正式站：沒有登入正式後台看系統狀態頁；寄信若已設定，測試信要由使用者自己按（會寄真信到自己的帳號）。
- 提醒信只在後端測試驗過寄出內容；正式站要等設好 SMTP 才會真的寄。
```

`docs/website-admin/operations.md`：在第 12–15 行附近（說明部署後打 `/api/website/v1/health` 那段）之後加一段：

```markdown
總管理者也可以登入後台「系統 → 系統狀態」看同一批背景工作狀態，另外還有寄信與推播等設定是否已設、公開資料是否過期、寄送與排程發布失敗筆數，以及寄測試信給自己（2026-10-15）。`/health` 的內容不變，外部監控照舊看它。
```

- [ ] **Step 4：兩份規格補實作紀錄**

兩份規格檔尾各加一節：

`docs/specs/2026-10-15-admin-system-status-design.md`：

```markdown
## 7. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-admin-wave1-status-reminder.md`；與「參觀提醒信」合為一支分支 `feature/admin-wave1-20261015`（上方「分支」欄寫的是原本的分開命名）。
- 與規格的差異（計畫裁定）：P2 兩個背景迴圈加 `started_at`；P3「轉檔失敗」看素材狀態（`media_assets.status = 'failed'` 且未刪除），不看 `media_jobs` 的失敗列；P4 門牌 `last_error` 也算要注意，畫面兩種情況都寫手動匯入；P5 測試信的操作紀錄 metadata 是 `{"result": "sent"}` 或 `{"result": "failed", "error_code": 例外類別}`；P10 總覽算系統狀態失敗時回 `None`、總覽照常；P11 公開資料清單動態跟著 `DATASETS`；P12 同步迴圈停擺門檻＝檢查間隔＋2 小時。
```

`docs/specs/2026-10-15-parent-visit-reminder-design.md`：

```markdown
## 7. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-admin-wave1-status-reminder.md`；與「系統狀態頁」合為一支分支 `feature/admin-wave1-20261015`（上方「分支」欄寫的是原本的分開命名）。
- 與規格的差異（計畫裁定）：P6 排入是新函式 `enqueue_due_parent_reminders`，與員工提醒共用到點判斷 `_due_upcoming`，在維護排程同一步驟依序呼叫（`enqueue_due_reminders` 的回傳不變）；P7 kind 常數放 `booking/outbox.py`，`REMINDER_KINDS` 不變。
- 已知限制：改期後又改回原本那一場，該場的去重鍵已用過，不會再寄第二次提醒。
```

- [ ] **Step 5：檢查並 Commit**

```bash
grep -n "TBD\|TODO\|待補" DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-10-15-admin-system-status-design.md docs/specs/2026-10-15-parent-visit-reminder-design.md | head
git add DESIGN.md README.md docs/website-admin/acceptance.md docs/website-admin/operations.md docs/specs/2026-10-15-admin-system-status-design.md docs/specs/2026-10-15-parent-visit-reminder-design.md
git commit -m "docs: 後台第 1 波系統狀態頁與家長參觀提醒信（規則、限制、與規格的差異）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

預期：grep 在本案新增的段落沒有占位字（舊段落的「待補」不算）。

---

### Task 8：全套驗證（控制者在背景分開跑，不交給子代理）

- [ ] **Step 1：後端全套**（約 20 分鐘；背景；一次只跑這一組）

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave1_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```

預期：0 failed；ruff 無錯誤。若失敗多是 `FileNotFoundError`（缺 `web/server/data`、`deploy`、`web/public`），是 sparse 目錄不全，補目錄後重跑，不是程式問題。

- [ ] **Step 2：admin 全套、typecheck、契約**

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run
npm run typecheck; (cd ../web && npm run typecheck)
cd ../backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
```

預期：全部通過（高負載下 5000ms 逾時的檔改 `--testTimeout=60000` 重跑並寫明）。

- [ ] **Step 3：stack 全套**（背景）

```bash
export E2E_DB_NAME=ivy_website_wave1_1015_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751
npm run e2e:build && npx playwright test -c playwright.stack.config.ts
```

預期：0 failed（`visual.spec.ts` 若因側欄多一項而差異超過門檻，用 `--update-snapshots=all` 只更新受影響的基準並在紀錄寫明；高負載逾時的案例單獨重跑確認，並如實寫在紀錄）。

- [ ] **Step 4：回填 README 與 acceptance，再對一次 `origin/main`**

在 `README.md` 本案段落補「驗證」條（各數字註明跑在哪個 commit；沒做的事：沒有登入正式後台看畫面、正式站寄信是否已設未確認、提醒信沒有真的寄出過）；`acceptance.md` 本案一節的「全套閘門」寫上實際數字。`git fetch origin`：若 main 有新 commit（特別是動 `admin/src/router/nav.ts`、`DashboardView.vue`、`api/labels.ts`、`notifications/service.py`、`workers/maintenance.py`、`admissions/geo/models.py` 的 `DATASETS`、契約檔的；同日在途的 enrolled-map、kindergarten-registry、peer-comparison 都可能動到），merge 進來、處理衝突、重跑契約與受影響的測試（`DATASETS` 有新項目時 `systemStatus.test.ts` 會要求補中文）；commit。

- [ ] **Step 5：交付**

回報：完成摘要、驗證結果（含 commit）、計畫裁定與實作中的新裁定、需要使用者決定或執行的事：
- `feature/admin-wave1-20261015` 要不要 push main（＝正式部署；auto 模式擋 push，給使用者用 `!` 執行的指令）。
- 部署後：使用者登入正式後台看「系統 → 系統狀態」，確認寄信、Turnstile 等列的實況；寄信已設定的話自己按一次測試信。
- 部署後在 `deploy/README.md` 補部署紀錄（commit、run、`release.json` base、`/health`），並清 worktree（先 `find ~/Repositories/ivy-website-wt/admin-wave1-20261015 -maxdepth 3 -type l -delete`，再 `git worktree remove --force`）、本地分支與兩個測試庫（`dropdb ivy_website_wave1_1015_test`、`dropdb ivy_website_wave1_1015_e2e_test`）。

**不自己 push。**

---

## 規格疑點（不改規格，實作照計畫裁定）

1. **門牌自動下載在正式站必定失敗**：規格 S6 只寫「35 天沒換版」，但自動同步每 30 天嘗試一次、必留 `last_error`，門牌列會在第 30 天左右先因「同步失敗」變紅。計畫 P4 把兩種原因合成同一個「請手動匯入」提示。是否要讓門牌在正式站乾脆不跑自動下載（避免無意義的錯誤），屬同步程式的改動，不在本案。
2. **「轉檔失敗」的定義**：規格 §3.2 寫看 `media_jobs` 的 failed 列；失敗列重試後不會消失，計畫 P3 改看素材狀態。
3. **S8「程序啟動超過該時間」**：兩個 loop 沒有啟動時間，計畫 P2 補 `started_at`。
4. **測試信的操作紀錄格式**：規格寫 `{result: 'ok'|<error>}`；計畫 P5 用 `result`＋既有的 `error_code` 鍵。
5. **提醒信改期回原場次**：規格 R5 的去重鍵含場次 id，改期後又改回原場次時不會再提醒；規格沒寫，計畫列為已知限制（寫進 DESIGN 與規格實作紀錄），不另做。
6. **同日在途工作**：enrolled-map（`f2a7c1e9d4b3` migration）、kindergarten-registry、peer-comparison 若先進 main 並新增 `DATASETS`，系統狀態頁會自動多一列；中文與更新週期要在 Task 0 Step 4／Task 8 Step 4 補上。
