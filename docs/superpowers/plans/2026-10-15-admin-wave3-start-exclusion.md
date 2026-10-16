# 第 3 波：預計入學時間 → 預約案件排除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 官網預約表單多一題選填的「預計入學時間」（到場建招生訪視時帶進入學學期），以及預約案件的「排除」標記（測試／重複的案件不再算進總覽、參觀預約統計、預約全程、場次使用情況與提醒）。

**Architecture:** 兩案都在 `visit_requests` 加欄位，各一支 migration（後者接前者）。預計入學時間的規則集中在新模組 `backend/app/booking/expected_start.py`，官網與後台的同名函式讀同一份案例 `contracts/expected-start-cases.json`；排除的「哪裡套、哪裡不套」集中在新模組 `backend/app/booking/exclusion.py`（`not_excluded()`），每一個套用點各一條測試。前端：官網 `VisitForm.vue`、家長管理頁；後台案件明細、列表、補登、修改家長資料與三處統計說明。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、Alembic、PostgreSQL、pytest；Nuxt 4（web）、Vue 3 + TypeScript + Element Plus（admin）、vitest；Playwright stack e2e；openapi-typescript 契約。

**Spec:**
- `docs/specs/2026-10-15-visit-expected-start-design.md`（已核可）
- `docs/specs/2026-10-15-visit-exclusion-design.md`（**§3.3「本週五校」不套用排除，使用者 10-16 確認**：本計畫照規格現況「不套用」，決定集中在 Task 8 Step 6，使用者改主意只要翻那一步。）

基準 `origin/main` `aae0debc`（migration head `c6a9e3f15d27`）。兩份規格的「分支」欄各寫自己的分支（`feature/visit-expected-start-20261015`、`feature/visit-exclusion-20261015`），**本計畫合為一支 `feature/admin-wave3-20261015`**。

## 共通規則與指令

- 繁體中文（台灣用語），技術名詞與識別符保留原文；commit 訊息繁體中文、Conventional Commit，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；`git add` 一律列檔名（禁止 `git add .`、`-A`、`commit -a`）；不要 push。
- 顏色一律走 token（`var(--…)`），不寫 rgba／oklch／hex 字面值；畫面不放開發輔助用字（操作說明、製作過程、狀態字）。
- 一次只跑一組測試（機器 8GB RAM）；子代理不跑後端全套 pytest、admin 全套 vitest、stack 全套（超過 10 分鐘會被 watchdog 殺，由控制者在 Task 13 背景分開跑）。
- worktree：`~/Repositories/ivy-website-wt/admin-wave3-20261015`（分支 `feature/admin-wave3-20261015`），以下指令都從它的根目錄出發。
- 後端測試指令（`<DB>` 用 Task 0 備好的 `ivy_website_wave3_1015_test`，已升到 head）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <檔案或 node id>`（`WEBSITE_*` 必須逐一寫在同一行）。下文簡寫成 `PYTEST <檔案>`。
- 升級測試庫（每支 migration 寫完都要跑）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head`。下文簡寫成 `MIGRATE`。
- 前端指令：`cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run <檔案>`、`npm run typecheck`；web 同樣在 `web/` 下。用分號串接（`source nvm.sh` 會 exit 3，不要用 `&&`）。高負載下遇到 `Test timed out in 5000ms` 加 `--testTimeout=60000` 重跑並在報告寫明。
- 契約：**不要用 `npm run contract:check`／`contract:generate`**（它們呼叫 `uv run`，會改到共用 venv 的 `.pth`）。用：
  檢查 `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs`；
  重新產生 `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`。下文簡寫成 `CONTRACT_REGEN`／`CONTRACT_CHECK`。

## Global Constraints

（逐字或幾乎逐字取自兩份規格；每個 task 都隱含這一節。）

**預計入學時間**
- **X1**：只加「預計入學時間」，**選填**；不加「目前就托狀況」。
- **X2**：選項「盡快（這學期）」＋接下來四個學期的開學月份＋「還不確定」，依台北今天動態算（例：2026-10-15 → 盡快（這學期）／2027 年 2 月／2027 年 9 月／2028 年 2 月／2028 年 9 月／還不確定）；學期規則沿用 `academic.current_term`（8/1 起上學期、2/1 起下學期，1 月仍屬上學期）。
- **X3**：「孩子資料」區塊、生日下面，單選膠囊（和「如何知道常春藤」同款，但只能選一個；再點一次取消選取）；手機一樣換行排列。
- **X4**：到場建立訪視時：選了月份 → 對應學期；選「盡快」→ 參觀日所在學期；沒填或「還不確定」→ 今天所在學期。選的學期比參觀日所在學期還早 → 用參觀日所在學期。之後預約資料再改，**不會**同步改招生的入學學期。
- **X5**：後台「修改家長資料」、後台補登、家長管理頁都可以改。
- **X6**：`visit_requests.expected_start String(8) NULL`：`asap`、`unsure`，或 `<民國學年>-<學期>`（例 `115-2`）。
- **X7**：公開端學期必須介於「今天所在學期」到「之後第 5 個學期」（含），超出 → 422 `expected_start`。
- **X8**：後台：格式正確、學年 100–199 即可。
- **X9**：`_canonical_payload` 在值為空時不放這個鍵（舊頁面送的單與重送的雜湊不變）。
- **X10**：匿名化不清。
- **X11**：後台內建的隱私說明與政策草稿的「蒐集項目」加「預計入學時間」。
- **不做**：就托狀況、分布統計、必填、寫進確認信或通知、改年級換算（`grade` 仍依現行規則）、園務契約與 `expected_start_label` 的改動。

**預約案件排除**
- **E1**：只標預約案件；招生端不加。
- **E2**：`booking.manage`（總管理者、校區管理者）＋校區範圍；櫃台不能。
- **E3**：必選 `test`（測試）、`duplicate`（重複）、`other`（其他）；選「其他」要寫說明（≤200 字），前兩者說明選填。
- **E4**：「取消排除」把四個欄位清空，回到原本的統計。
- **E5**：案件時間線寫 `excluded`／`exclusion_removed` 事件（`after` 帶原因類別，說明放事件的 `reason`）；操作紀錄 `visit_request.exclude`／`visit_request.include`，metadata 只記原因類別。
- **E6**：排除不改狀態、不釋出名額；已確認且還沒到的案件，對話框提示「排除不會釋出名額；如果是測試預約，請一併取消」。
- **E7**：列表照常顯示並加灰色「已排除・測試」標籤；篩選多「隱藏已排除」（網址參數 `excluded=hide`），預設不隱藏；CSV 加「已排除」欄。
- **E8**：被排除的案件不排、不寄員工「即將參觀」與家長參觀提醒。
- **E9**：`backend/app/booking/exclusion.py` 提供 `not_excluded()`（SQL 條件）與 `is_excluded(visit)`；§3.3 每一處都用它。
- **E10**：關聯的招生訪視不動；明細頁對已排除且有招生訪視的案件顯示「這筆預約已排除，但招生訪視仍會算進招生統計；如果是測試資料，請到招生入學刪除訪視」。
- **E11**：原因類別保留；說明（`exclude_note`）隨保存政策清掉。
- **欄位（§3.1）**：`excluded_at TIMESTAMPTZ NULL`、`excluded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`、`exclude_reason VARCHAR(16) NULL`、`exclude_note VARCHAR(200) NULL`；CHECK 原因值；CHECK `(excluded_at IS NULL) = (exclude_reason IS NULL)`；不加索引。
- **API（§3.2）**：`POST /admin/visit-requests/{id}/exclude`（已排除 → 409 `ALREADY_EXCLUDED`；`other` 沒說明 → 422）；`POST /admin/visit-requests/{id}/include`（未排除 → 409 `NOT_EXCLUDED`）；列表與 CSV 篩選 `excluded`（`hide`｜`only`｜不帶＝全部）；列表不回說明。
- **§3.3 套用表**：總覽（今天參觀、待標記到場、追蹤到期、要處理）＝是；**總覽本週五校「已約／可約」＝否（待確認）**；參觀預約統計（結果、班別）＝是，回 `excluded_count`（本計畫命名 `excluded_cases`，見 P9）；預約全程＝是；場次使用情況＝是；員工與家長提醒＝是（排入與寄出前都檢查）；案件列表、頁籤數字、CSV＝否（用篩選）；名額占用＝**否**；停用分校的未結案件、切換預約方式前的確認數＝否。
- **不做**：招生訪視的排除、依電話或姓名自動判定重複、刪除預約案件、批次排除、排除時自動取消、公開官網改動。

## 計畫裁定（Plan Rulings）

| # | 裁定 | 理由 |
|---|---|---|
| P1 | 一波一支分支 `feature/admin-wave3-20261015`，從 `docs/admin-batch-specs-20261015` 開出後 rebase 到當時最新的 `origin/main` | 使用者指定；兩案同動 `visit_requests`，同一支分支依序做，migration 不會撞號 |
| P2 | 預計入學時間的選項、公開範圍與顯示文字共用一份案例 `contracts/expected-start-cases.json`，後端 pytest、web vitest、admin vitest 都讀（比照 `contracts/ivy-recruitment/grade-cases.json`） | 規格 §3.2 要「前後端各有一組相同的日期邊界測試案例」；一份檔案比兩份手抄可靠 |
| P3 | 後台與 CSV 的顯示文字：`115-2`→「2027 年 2 月（115 學年下學期）」、`asap`→「盡快（送單時是 115 學年上學期）」、`unsure`→「還不確定」；後端 `expected_start.display_label`、admin `expectedStartLabel` 同規則，案例在共用檔 `labels` 區塊 | 規格 §3.3 的文字；CSV 也要看得懂 |
| P4 | 家長管理頁改這一題也套公開範圍（X7） | 規格只寫「公開端驗證」；管理頁是公開端，選項同樣依今天重算 |
| P5 | `resolve_term` 遇到認不得的值不丟例外，退回今天所在學期 | `booking_link` 模組說明：建立訪視的路徑不丟資料檢查例外，否則「標記已到場」整筆回滾；DB CHECK 已擋掉不合法值，這只是保險 |
| P6 | 排除欄位名 `exclude_reason`（`test`／`duplicate`／`other`）、`exclude_note`；操作紀錄 metadata 鍵用 `exclude_reason`，不用既有的 `reason`（那個鍵的中文對照 `auditReasonLabel` 是另一組原因） | 避免同名鍵被翻成錯的中文 |
| P7 | 規格 §3.4「處理區的『更多』選單」在明細頁不存在（`VisitCaseSettings.vue` 只在預約正常時出現，沒有更多選單）：入口做成右欄最下方獨立一列 `VisitExclusionAction.vue`（所有狀態都有，只給 `booking.manage`）；已排除的橫幅 `VisitExclusionBanner.vue` 放在頁首（`VisitCaseHero`）下方 | 已到場、已取消的測試案件也要能排除 |
| P8 | 總覽連到案件列表的三個連結（到期待追蹤、尚未確認到場、待人工處理）加 `excluded=hide` | 總覽數字已排除；既有原則是「總覽數字點進去是同一批」（`pending_kinds` 模組說明） |
| P9 | 參觀預約統計每校與合計都回 `excluded_cases`（期間內送出、已排除的案件數）；班別分布、場次使用情況、預約全程 coverage 也叫 `excluded_cases`；0 筆畫面不顯示 | 規格寫 `excluded_count`；四處用同一個名字，且預約全程已有 `excluded`（不納入天數）不能撞名 |
| P10 | **本週五校「已約／可約」不套用**（排除規格 §3.3，使用者 10-16 確認）；集中在 Task 8 Step 6，含一條測試釘住現況 | 這兩個數字講名額；排除不釋出名額，只扣已約會和可約對不起來 |
| P11 | 預約全程的新欄位是 `coverage.excluded_cases`，和各段天數裡的 `excluded`（不納入天數的筆數）是兩回事，程式註解寫明 | 同一個回應裡兩種「排除」 |
| P12 | 列表回應把 `exclude_note` 設為 `None`（`model_copy`），明細才有 | 規格 §3.2「列表不回說明」 |
| P13 | migration revision：預計入學 `b7e3c1a9d5f2`（down＝Task 0 Step 4 查到的 head，基準時是 `c6a9e3f15d27`）、排除 `d4a8f2c6e913`（down＝`b7e3c1a9d5f2`） | 兩支依序接；合併前的改接見 Task 13 Step 5 |
| P14 | 停用分校的未結案件、切換預約方式前的確認數不改程式，Task 8 用一條測試同時釘住兩處「排除案件仍算」 | 規格 §3.3「否」，用測試釘住不被誤改 |
| P15 | 已匿名化的案件可以排除，但不存說明（`exclude_note` 一律寫 `None`） | 規格沒寫；保存政策已清過自由文字，之後不會再清，不能讓新的自由文字留在匿名化案件上 |
| P16 | 選了「其他」卻沒寫說明的 422 指到 `["body","note"]`（`note` 設 `validate_default=True`，在欄位驗證器讀 `info.data["reason"]`） | 後台才能把錯誤寫在說明欄下面 |

## 規格疑點（不改規格，列給使用者）

1. **排除規格 §3.3「本週五校」**：規格寫「否」，使用者 10-16 確認。本計畫照「否」做（P10），集中在 Task 8 Step 6。
2. **排除規格 §3.4「更多選單」不存在**：改成獨立一列與橫幅（P7）。
3. **總覽點進列表的筆數**：規格只說總覽要排除、列表預設不隱藏，兩者會差幾筆；本計畫讓總覽的三個連結帶 `excluded=hide`（P8）。
4. **預計入學 X7「公開端」是否含家長管理頁**：本計畫含（P4）。
5. **已匿名化案件能否排除**：規格沒寫；本計畫可以，但不存說明（P15）。
6. **測試預約仍佔名額、仍會收到確認信**：規格 E6 只要求提示「請一併取消」；本計畫不自動取消（規格「不做」）。
7. **後台隱私政策草稿的得知管道寫四項、表單是六項**：既有落差（`admin/src/composables/privacyPolicyDraft.ts:37`），不在本案範圍，只在 Task 5 補「預計入學時間」一項。

## Review Focus

（規格沒有直接說、但最可能咬到使用者的情況；每一條都有 task 內的測試釘住。）

1. **跨學期邊界與台北午夜**：1/31→2/1、7/31→8/1，官網選項、後端公開範圍、後台顯示要一致。→ Task 1 `test_public_choices_follow_the_shared_cases`／`test_public_range`；Task 4 `visit-expected-start.spec.ts`（同一份案例）；Task 5 `expectedStart.test.ts`。
2. **舊頁面與重送**：不帶 `expected_start` 的送單雜湊和改版前相同；同 key 重送相同值回原案、不同值 409。→ Task 2 `test_visit_details.py::test_new_optional_defaults_preserve_legacy_payload_hash`（改）、`test_replay_with_the_same_choice_returns_the_same_case`。
3. **家長改資料時原值已不在新選項**（送單後跨學期）：沒動這一題就不送、不擋其他欄位；顯示原值。→ Task 3 `test_parent_can_edit_other_fields_when_the_old_term_is_out_of_range`；Task 4 `visit-edit.spec.ts` 新案例。
4. **排除後數字一致**：總覽數字＝點進列表（`excluded=hide`）的筆數；取消排除後恢復。→ Task 8 `test_dashboard_counts_skip_excluded_cases`、`test_include_restores_the_counts`；Task 9 `test_hide_filter_matches_dashboard_counts`。
5. **排除不釋出名額**：排除一筆已確認案件，同場次公開剩餘名額與後台接待月曆都不變。→ Task 8 `test_excluding_does_not_release_the_seat`。

## File Structure

後端
- Create `backend/app/booking/expected_start.py`：選項、解析、公開範圍、顯示文字、入學學期換算（Task 1）。
- Create `contracts/expected-start-cases.json`（Task 1）。
- Create `backend/migrations/versions/b7e3c1a9d5f2_visit_expected_start.py`（Task 2）、`d4a8f2c6e913_visit_exclusion.py`（Task 7）。
- Modify `backend/app/booking/models.py`（兩案的欄位與 CHECK）、`schemas.py`、`service.py`、`workflow_service.py`、`routes.py`、`export_labels.py`、`slot_usage.py`、`presenters.py`（不改，見 Task 7 說明）。
- Create `backend/app/booking/exclusion.py`（Task 7）。
- Modify `backend/app/admissions/booking_link.py`（Task 3）、`journey.py`、`schemas.py`（Task 8）。
- Modify `backend/app/operations/dashboard_service.py`、`booking_outcomes_service.py`、`routes.py`（`OutcomeCountsOut`、`ClassDistributionOut`）、`retention_service.py`（Task 7、8）。
- Modify `backend/app/notifications/reminders.py`（Task 8）。
- Tests：Create `test_expected_start.py`、`test_visit_expected_start.py`、`test_visit_expected_start_edit.py`、`test_visit_exclusion.py`、`test_visit_exclusion_scope.py`；Modify `test_visit_details.py`、`test_visit_attention_export.py`、`test_admissions_booking_link.py`。
- `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重新產生）。

官網（`web/`）
- Modify `app/utils/visit-form.ts`、`app/utils/visit-edit.ts`、`app/components/VisitForm.vue`、`app/pages/visit/manage.vue`、`app/composables/useParentVisit.ts`、`app/assets/css/visit-booking.css`。
- Create `tests/visit-expected-start.spec.ts`；Modify `tests/visit-edit.spec.ts`。

後台（`admin/src/`）
- Modify `api/labels.ts`、`api/visitHistory.ts`、`api/visitListQuery.ts`、`components/visit/VisitCaseFacts.vue`、`components/visit/VisitDetailsDialog.vue`、`components/ManualVisitDialog.vue`、`components/visit/VisitListRow.vue`、`views/VisitRequestsView.vue`、`views/VisitDetailView.vue`、`views/DashboardView.vue`、`components/analytics/BookingOutcomesSection.vue`、`components/analytics/ClassDistributionPanel.vue`、`components/admissions/JourneyTab.vue`、`components/sessions/SlotUsagePane.vue`、`composables/privacyNotice.ts`、`composables/privacyPolicyDraft.ts`。
- Create `components/visit/VisitExclusionBanner.vue`、`components/visit/VisitExclusionAction.vue`、`api/visitExclusion.ts`。
- Tests：Create `__tests__/expectedStart.test.ts`、`__tests__/visitExclusion.test.ts`；Modify `__tests__/visitListQuery.test.ts`。

e2e／文件
- Create `tests/stack/visit-expected-start.spec.ts`、`tests/stack/visit-exclusion.spec.ts`；可能更新 `tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png`。
- Modify `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`、兩份規格（實作紀錄）、部署後 `deploy/README.md`。

---

## Task 0：環境（控制者先備，不交給實作者）

- [ ] **Step 1：開 worktree（sparse）並 rebase 到最新 main**

```bash
git -C ~/Desktop/ivy-website-admin fetch origin
git -C ~/Desktop/ivy-website-admin worktree add --no-checkout -b feature/admin-wave3-20261015 ~/Repositories/ivy-website-wt/admin-wave3-20261015 docs/admin-batch-specs-20261015
cd ~/Repositories/ivy-website-wt/admin-wave3-20261015
git sparse-checkout set --cone docs backend admin web contracts tests deploy scripts content .github
git checkout -q
git rebase origin/main
git log --oneline -3
```

預期：rebase 只帶規格分支的 docs commit，沒有衝突（規格分支只動 `docs/specs/`、`docs/superpowers/plans/`）。sparse 要含 `web`（全部）、`deploy`、`content`：後端與 admin 全套會讀 `web/server/data`、`web/public`、`web/app/generated`、`deploy/check_schema.py`、`content/site-fixture.json`，缺了會有一批 `FileNotFoundError`／`ENOENT` 假紅燈。

- [ ] **Step 2：依賴（自己的 venv 與 node_modules，不 symlink 別人的）**

```bash
source ~/.nvm/nvm.sh; nvm use 22
npm ci; (cd admin && npm ci); (cd web && npm ci)
(cd backend && uv sync --frozen)
```

- [ ] **Step 3：檢查第 1 波的家長提醒信有沒有在 main**

```bash
grep -rn "parent_visit_reminder" backend/app | head -3
```

記下結果：有輸出＝已在 main，Task 8 Step 8 要做；沒有輸出＝跳過 Task 8 Step 8（由提醒信那案補排除條件，見其規格 §6）。

- [ ] **Step 4：建測試庫、升到 head、記下 head**

```bash
createdb ivy_website_wave3_1015_test
createdb ivy_website_wave3_1015_e2e_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic heads
```

預期：`alembic heads` **只有一個** head。基準時是 `c6a9e3f15d27`；若 main 已合併在途分支（在籍學生分布 `f2a7c1e9d4b3`、幼兒園名單修正、附近同業比較、第 2 波退出原因分類），head 會是別的值——把它寫進交接給 Task 2 的實作者（Task 2 Step 3 的 `down_revision`）。e2e 用 `E2E_DB_NAME=ivy_website_wave3_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746`。

---

## Part A：預計入學時間

### Task 1：規則模組 `expected_start.py` 與共用案例

**Files:**
- Create: `backend/app/booking/expected_start.py`
- Create: `contracts/expected-start-cases.json`
- Test: `backend/tests/test_expected_start.py`

**Interfaces:**
- Consumes：`app.admissions.academic.current_term(today: date) -> tuple[int, int]`（`backend/app/admissions/academic.py:32`）。
- Produces（後面的 task 都用這些名字）：
  - 常數 `ASAP = "asap"`、`UNSURE = "unsure"`、`PUBLIC_CHOICE_TERMS = 4`、`PUBLIC_TERMS_AHEAD = 5`。
  - `parse(value: str) -> str | tuple[int, int]`：`asap`／`unsure` 原樣回傳，學期回 `(學年, 學期)`；格式不對 `ValueError`。
  - `public_choices(today: date) -> list[dict[str, str]]`：`[{"value", "label"}]`，順序即顯示順序。
  - `validate_public(value: str, today: date) -> None`：超出範圍 `ValueError("這個入學時間已過期，請重新選擇")`。
  - `display_label(value: str, submitted_on: date) -> str`。
  - `resolve_term(value: str | None, *, visit_date: date, today: date) -> tuple[int, int]`。
  - `term_start_month(term: tuple[int, int]) -> tuple[int, int]`、`format_term(term) -> str`。
  - 案例檔 `contracts/expected-start-cases.json` 的三個區塊 `choices`、`public_range`、`labels`（Task 4、5 的前端測試讀同一份）。

- [ ] **Step 1：寫共用案例檔**

`contracts/expected-start-cases.json`：

```json
{
  "description": "預約表單「預計入學時間」的共用案例（2026-10-15 規格 docs/specs/2026-10-15-visit-expected-start-design.md 的 X2、X7 與 §3.3 顯示文字）。後端 pytest（backend/tests/test_expected_start.py）、web vitest（web/tests/visit-expected-start.spec.ts）、admin vitest（admin/src/__tests__/expectedStart.test.ts）都讀這份。today、submitted_on 是台北日期。",
  "choices": [
    {"name": "上學期中（10 月）", "today": "2026-10-15", "values": ["asap", "115-2", "116-1", "116-2", "117-1", "unsure"], "labels": ["盡快（這學期）", "2027 年 2 月", "2027 年 9 月", "2028 年 2 月", "2028 年 9 月", "還不確定"]},
    {"name": "1/31 仍屬上學期", "today": "2027-01-31", "values": ["asap", "115-2", "116-1", "116-2", "117-1", "unsure"], "labels": ["盡快（這學期）", "2027 年 2 月", "2027 年 9 月", "2028 年 2 月", "2028 年 9 月", "還不確定"]},
    {"name": "2/1 起下學期", "today": "2027-02-01", "values": ["asap", "116-1", "116-2", "117-1", "117-2", "unsure"], "labels": ["盡快（這學期）", "2027 年 9 月", "2028 年 2 月", "2028 年 9 月", "2029 年 2 月", "還不確定"]},
    {"name": "7/31 仍屬下學期", "today": "2027-07-31", "values": ["asap", "116-1", "116-2", "117-1", "117-2", "unsure"], "labels": ["盡快（這學期）", "2027 年 9 月", "2028 年 2 月", "2028 年 9 月", "2029 年 2 月", "還不確定"]},
    {"name": "8/1 起上學期", "today": "2027-08-01", "values": ["asap", "116-2", "117-1", "117-2", "118-1", "unsure"], "labels": ["盡快（這學期）", "2028 年 2 月", "2028 年 9 月", "2029 年 2 月", "2029 年 9 月", "還不確定"]}
  ],
  "public_range": [
    {"today": "2026-10-15", "value": "asap", "ok": true},
    {"today": "2026-10-15", "value": "unsure", "ok": true},
    {"today": "2026-10-15", "value": "115-1", "ok": true},
    {"today": "2026-10-15", "value": "114-2", "ok": false},
    {"today": "2026-10-15", "value": "117-2", "ok": true},
    {"today": "2026-10-15", "value": "118-1", "ok": false},
    {"today": "2027-02-01", "value": "115-2", "ok": true},
    {"today": "2027-02-01", "value": "115-1", "ok": false}
  ],
  "labels": [
    {"value": "115-2", "submitted_on": "2026-10-15", "label": "2027 年 2 月（115 學年下學期）"},
    {"value": "116-1", "submitted_on": "2026-10-15", "label": "2027 年 9 月（116 學年上學期）"},
    {"value": "asap", "submitted_on": "2026-10-15", "label": "盡快（送單時是 115 學年上學期）"},
    {"value": "asap", "submitted_on": "2027-02-01", "label": "盡快（送單時是 115 學年下學期）"},
    {"value": "unsure", "submitted_on": "2026-10-15", "label": "還不確定"}
  ]
}
```

- [ ] **Step 2：寫失敗的測試**

`backend/tests/test_expected_start.py`：

```python
"""預約表單「預計入學時間」的規則（2026-10-15 規格 X2、X4、X7、§3.3）。選項、公開範圍與顯示文字
讀 contracts/expected-start-cases.json，web 與 admin 的 vitest 讀同一份（計畫裁定 P2）。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app.booking import expected_start

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "expected-start-cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["choices"], ids=lambda case: case["name"])
def test_public_choices_follow_the_shared_cases(case):
    choices = expected_start.public_choices(date.fromisoformat(case["today"]))
    assert [choice["value"] for choice in choices] == case["values"]
    assert [choice["label"] for choice in choices] == case["labels"]


@pytest.mark.parametrize("case", CASES["public_range"], ids=lambda case: f"{case['today']}:{case['value']}")
def test_public_range(case):
    today = date.fromisoformat(case["today"])
    if case["ok"]:
        expected_start.validate_public(case["value"], today)
    else:
        with pytest.raises(ValueError, match="已過期"):
            expected_start.validate_public(case["value"], today)


@pytest.mark.parametrize("case", CASES["labels"], ids=lambda case: f"{case['value']}@{case['submitted_on']}")
def test_display_label(case):
    assert expected_start.display_label(case["value"], date.fromisoformat(case["submitted_on"])) == case["label"]


@pytest.mark.parametrize("value", ["", "115", "115-3", "99-1", "200-1", "115-1 ", "ASAP", "1150-1"])
def test_parse_rejects_malformed_values(value):
    with pytest.raises(ValueError):
        expected_start.parse(value)


def test_parse_accepts_the_three_shapes():
    assert expected_start.parse("asap") == "asap"
    assert expected_start.parse("unsure") == "unsure"
    assert expected_start.parse("115-2") == (115, 2)


@pytest.mark.parametrize(
    ("value", "visit_date", "today", "expected"),
    [
        (None, date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
        ("unsure", date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
        # 盡快＝參觀日所在學期：十二月送單、二月才來參觀，就是下學期。
        ("asap", date(2027, 2, 3), date(2027, 2, 3), (115, 2)),
        ("116-1", date(2026, 10, 20), date(2026, 10, 20), (116, 1)),
        # 選的學期比參觀日所在學期還早（家長很晚才來）→ 參觀日所在學期。
        ("115-1", date(2027, 2, 3), date(2027, 2, 3), (115, 2)),
        # 認不得的值不丟例外，退回今天所在學期（計畫裁定 P5）。
        ("not-a-term", date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
    ],
)
def test_resolve_term(value, visit_date, today, expected):
    assert expected_start.resolve_term(value, visit_date=visit_date, today=today) == expected
```

- [ ] **Step 3：跑測試確認失敗**

Run: `PYTEST tests/test_expected_start.py`
Expected: FAIL（`ImportError: cannot import name 'expected_start'`）。

- [ ] **Step 4：實作 `backend/app/booking/expected_start.py`**

```python
"""預約表單「預計入學時間」（2026-10-15 規格 docs/specs/2026-10-15-visit-expected-start-design.md）。

值是 asap（盡快）、unsure（還不確定），或「民國學年-學期」（例 115-2）；資料庫 CHECK
ck_visit_requests_expected_start 用同一個格式。學期規則沿用 admissions.academic.current_term
（8/1 起上學期、2/1 起下學期，1 月仍屬上學期）。官網選項由 web/app/utils/visit-form.ts 的
expectedStartOptions、後台顯示由 admin/src/api/labels.ts 的 expectedStartLabel 照同一規則產生，
三邊讀同一份案例 contracts/expected-start-cases.json。"""

from __future__ import annotations

import re
from datetime import date

from app.admissions import academic

ASAP = "asap"
UNSURE = "unsure"
TERM_RE = re.compile(r"^(1\d{2})-([12])$")
# 官網列出「盡快」之後的幾個學期（規格 X2）。
PUBLIC_CHOICE_TERMS = 4
# 公開端接受今天所在學期到之後第 5 個學期（含）：比官網列的多一學期，跨學期還開著的舊頁面送得出去（規格 X7）。
PUBLIC_TERMS_AHEAD = 5

Term = tuple[int, int]


def parse(value: str) -> str | Term:
    """asap／unsure 原樣回傳，學期回 (學年, 學期)；格式不對丟 ValueError（Pydantic 轉成 422）。
    學年只收 100–199（規格 X8）。"""
    if value in (ASAP, UNSURE):
        return value
    match = TERM_RE.match(value)
    if match is None:
        raise ValueError("預計入學時間的格式不對")
    return int(match.group(1)), int(match.group(2))


def _index(term: Term) -> int:
    return term[0] * 2 + term[1] - 1


def _term(index: int) -> Term:
    return index // 2, index % 2 + 1


def format_term(term: Term) -> str:
    return f"{term[0]}-{term[1]}"


def term_start_month(term: Term) -> tuple[int, int]:
    """學期開學的西元年與月：上學期 9 月、下學期隔年 2 月。"""
    school_year, semester = term
    return (school_year + 1911, 9) if semester == 1 else (school_year + 1912, 2)


def _term_text(term: Term) -> str:
    return f"{term[0]} 學年{'上' if term[1] == 1 else '下'}學期"


def public_choices(today: date) -> list[dict[str, str]]:
    """官網表單的選項（順序即顯示順序）。today 是台北日期。"""
    current = _index(academic.current_term(today))
    choices = [{"value": ASAP, "label": "盡快（這學期）"}]
    for offset in range(1, PUBLIC_CHOICE_TERMS + 1):
        term = _term(current + offset)
        year, month = term_start_month(term)
        choices.append({"value": format_term(term), "label": f"{year} 年 {month} 月"})
    choices.append({"value": UNSURE, "label": "還不確定"})
    return choices


def validate_public(value: str, today: date) -> None:
    """官網送單與家長管理頁（計畫裁定 P4）：學期要在今天所在學期到之後第 PUBLIC_TERMS_AHEAD 個學期之間。"""
    parsed = parse(value)
    if isinstance(parsed, str):
        return
    current = _index(academic.current_term(today))
    if not current <= _index(parsed) <= current + PUBLIC_TERMS_AHEAD:
        raise ValueError("這個入學時間已過期，請重新選擇")


def display_label(value: str, submitted_on: date) -> str:
    """後台明細與 CSV 的文字（計畫裁定 P3）；submitted_on 是送單的台北日期，「盡快」換算當時的學期。"""
    if value == UNSURE:
        return "還不確定"
    if value == ASAP:
        return f"盡快（送單時是 {_term_text(academic.current_term(submitted_on))}）"
    parsed = parse(value)
    assert not isinstance(parsed, str)
    year, month = term_start_month(parsed)
    return f"{year} 年 {month} 月（{_term_text(parsed)}）"


def resolve_term(value: str | None, *, visit_date: date, today: date) -> Term:
    """到場建立招生訪視時的入學學期（規格 X4）：

    - 選了學期 → 那個學期；比參觀日所在學期還早（家長很晚才來）→ 參觀日所在學期。
    - 盡快 → 參觀日所在學期。
    - 沒填、還不確定、或認不得的值 → today 所在學期（改版前的做法）。認不得的值不丟例外
      （計畫裁定 P5）：建立訪視要在「標記已到場」同一個交易完成，資料庫 CHECK 已擋掉不合法的值。"""
    if value is None or value == UNSURE:
        return academic.current_term(today)
    try:
        parsed = parse(value)
    except ValueError:
        return academic.current_term(today)
    visit_term = academic.current_term(visit_date)
    if isinstance(parsed, str):  # asap
        return visit_term
    return parsed if _index(parsed) >= _index(visit_term) else visit_term
```

- [ ] **Step 5：跑測試確認通過**

Run: `PYTEST tests/test_expected_start.py`
Expected: PASS（全部）。

- [ ] **Step 6：Commit**

```bash
git add backend/app/booking/expected_start.py contracts/expected-start-cases.json backend/tests/test_expected_start.py
git commit -m "feat(booking): 預計入學時間的選項、範圍與入學學期換算規則

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2：migration、送單與補登、明細、CSV

**Files:**
- Create: `backend/migrations/versions/b7e3c1a9d5f2_visit_expected_start.py`
- Modify: `backend/app/booking/models.py:98-118`（`__table_args__`）、`:153`（`party_size` 之後加欄位）
- Modify: `backend/app/booking/schemas.py:232-299`（`_VisitRequestFields`）、`:301-316`（`VisitRequestCreate`）、`:445-472`（`VisitRequestDetailOut`）
- Modify: `backend/app/booking/service.py:154-160`（`_canonical_payload`）、`:378`、`:487`（兩處建案）
- Modify: `backend/app/booking/export_labels.py:14-18`（欄名）、`backend/app/booking/routes.py:1098-1115`（`_export_row`）
- Test: Create `backend/tests/test_visit_expected_start.py`；Modify `backend/tests/test_visit_details.py:73-96`、`backend/tests/test_visit_attention_export.py:115-119`
- Modify（重新產生）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1）：`expected_start.parse`、`validate_public`、`display_label`、`public_choices`。
- Produces：`VisitRequest.expected_start: str | None`；`_VisitRequestFields.expected_start`（官網送單與後台補登 body 都收）；`VisitRequestDetailOut.expected_start`；CSV 欄「預計入學」（緊接「人數」之後）。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_visit_expected_start.py`：

```python
"""預計入學時間：官網送單、後台補登、明細、防重複與 CSV（2026-10-15 規格 X1、X6–X9）。"""

from __future__ import annotations

import csv
import io
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.admissions import academic
from app.booking import expected_start
from app.common.timezones import today_local
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, legacy_request, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


def _first_month_choice() -> str:
    """官網選項裡「盡快」後面的第一個學期。"""
    return expected_start.public_choices(today_local())[1]["value"]


def _past_term() -> str:
    year, semester = academic.current_term(today_local())
    return expected_start.format_term((year - 1, semester))


async def _detail(admin_client, receipt_id: str) -> dict:
    response = await admin_client.get(f"{API}/admin/visit-requests/{receipt_id}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["asap", "unsure", "month"])
async def test_submission_stores_the_choice(admin_client, public_client, choice):
    value = _first_month_choice() if choice == "month" else choice
    booked = await book_slot(admin_client, public_client, expected_start=value)
    assert booked["response"].status_code == 201
    assert (await _detail(admin_client, booked["receipt_id"]))["expected_start"] == value


@pytest.mark.asyncio
async def test_submission_without_the_question_still_works(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    assert (await _detail(admin_client, booked["receipt_id"]))["expected_start"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["past", "200-1", "115-3", "soon"])
async def test_out_of_range_or_malformed_choice_points_at_the_field(admin_client, public_client, value):
    slot_id = await create_slot(admin_client)
    mode = await set_booking_mode(admin_client, "yihua", mode="slots")
    body = {
        "campus_key": "yihua", "config_version": mode.json()["version"], "parent_name": "陳媽媽", "phone": "0912345678",
        "slot_id": slot_id, "expected_start": _past_term() if value == "past" else value,
    }
    response = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": f"start-{uuid.uuid4()}"})
    assert response.status_code == 422, response.text
    assert ["body", "expected_start"] in [error["loc"] for error in response.json()["detail"]]


@pytest.mark.asyncio
async def test_replay_with_the_same_choice_returns_the_same_case(admin_client, public_client):
    slot_id = await create_slot(admin_client)
    mode = await set_booking_mode(admin_client, "yihua", mode="slots")
    body = {
        "campus_key": "yihua", "config_version": mode.json()["version"], "parent_name": "陳媽媽", "phone": "0912345678",
        "slot_id": slot_id, "expected_start": "asap",
    }
    headers = {"Idempotency-Key": "start-replay-01"}
    first = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    again = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    changed = await public_client.post(VISIT_SUBMIT_PATH, json={**body, "expected_start": "unsure"}, headers=headers)
    assert first.status_code == 201, first.text
    assert again.status_code == 200 and again.json()["receipt_id"] == first.json()["receipt_id"]
    assert changed.status_code == 409, changed.text


@pytest.mark.asyncio
async def test_manual_entry_accepts_a_past_term(admin_client):
    slot_id = await create_slot(admin_client, days_ahead=1)
    response = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王先生", "phone": "0933111222",
              "slot_id": slot_id, "expected_start": "110-1"},
        headers={"Idempotency-Key": "manual-start-01"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["expected_start"] == "110-1"


@pytest.mark.asyncio
async def test_database_rejects_malformed_values(db_session):
    receipt_id = await legacy_request(db_session, status="cancelled")
    with pytest.raises(IntegrityError, match="ck_visit_requests_expected_start"):
        await db_session.execute(
            text("UPDATE visit_requests SET expected_start = '115-3' WHERE id = :id"), {"id": receipt_id}
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_export_writes_the_label(admin_client, public_client):
    value = _first_month_choice()
    await book_slot(admin_client, public_client, expected_start=value)
    response = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert response.status_code == 200, response.text
    [row] = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert row["預計入學"] == expected_start.display_label(value, today_local())
```

修改 `backend/tests/test_visit_details.py` 的 `test_new_optional_defaults_preserve_legacy_payload_hash`（:73-96）：把

```python
    optional_when_empty = (_DETAIL_FIELDS - {"email"}) | {"party_size"}
```

改成

```python
    # 預計入學時間（2026-10-15）也是之後才加的選填欄位：沒選時不進 hash，舊頁面與重送的 hash 不變。
    optional_when_empty = (_DETAIL_FIELDS - {"email"}) | {"party_size", "expected_start"}
```

並在同一個測試最後加：

```python
    # 選了就是家長填的內容：同一把 key 改了選擇就是不同的送單。
    assert _legacy_payload_hash({**body, "expected_start": "asap"}) != legacy_hash
```

修改 `backend/tests/test_visit_attention_export.py:115-119` 的欄名清單：`"人數",` 後面加 `"預計入學",`。

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_visit_expected_start.py tests/test_visit_details.py::test_new_optional_defaults_preserve_legacy_payload_hash tests/test_visit_attention_export.py::test_export_header_has_each_column_once`
Expected: FAIL（欄位不存在、422 沒有指到 `expected_start`、欄名少一欄）。

- [ ] **Step 3：migration**

`backend/migrations/versions/b7e3c1a9d5f2_visit_expected_start.py`（`down_revision` 用 Task 0 Step 4 查到的 head；基準是 `c6a9e3f15d27`）：

```python
"""預約案件新增「預計入學時間」（2026-10-15 規格 docs/specs/2026-10-15-visit-expected-start-design.md）

visit_requests 加 expected_start（可空），CHECK 只收 asap、unsure 或「民國學年-學期」（例 115-2）。
不改既有資料，不需要先備份正式庫；上一版程式不讀這個欄位，先跑 migration 再換程式也相容。
約束字串與 app/booking/models.py 相同。

Revision ID: b7e3c1a9d5f2
Revises: c6a9e3f15d27
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b7e3c1a9d5f2"
down_revision = "c6a9e3f15d27"
branch_labels = None
depends_on = None

EXPECTED_START_CHECK = (
    "expected_start IS NULL OR expected_start IN ('asap', 'unsure') OR expected_start ~ '^1[0-9]{2}-[12]$'"
)


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("expected_start", sa.String(8), nullable=True))
    op.create_check_constraint("ck_visit_requests_expected_start", "visit_requests", EXPECTED_START_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_expected_start", "visit_requests", type_="check")
    op.drop_column("visit_requests", "expected_start")
```

Run: `MIGRATE`，再 `uv run --frozen alembic heads`（同一組環境變數）。Expected：單一 head `b7e3c1a9d5f2`。

- [ ] **Step 4：model**

`backend/app/booking/models.py` 的 `VisitRequest.__table_args__`（:98-118），在 `ck_visit_requests_confirmed_slot` 那一行之後加：

```python
        # 2026-10-15 預計入學時間：asap、unsure，或「民國學年-學期」（app/booking/expected_start.py）。
        CheckConstraint(
            "expected_start IS NULL OR expected_start IN ('asap', 'unsure') OR expected_start ~ '^1[0-9]{2}-[12]$'",
            name="ck_visit_requests_expected_start",
        ),
```

`party_size` 欄位（:153）之後加：

```python
    # 2026-10-15 預計入學時間（選填）：asap（盡快）、unsure（還不確定），或「民國學年-學期」如 115-2。
    # 到場建招生訪視時換成入學學期（expected_start.resolve_term）；匿名化不清（規格 X10）。
    expected_start: Mapped[str | None] = mapped_column(String(8), nullable=True)
```

- [ ] **Step 5：schema**

`backend/app/booking/schemas.py` 頂部 import 加 `from app.booking import expected_start as start_rules`（放在 `from app.booking import status_groups` 旁）。

`_VisitRequestFields` 的 `party_size` 之後加欄位：

```python
    # 2026-10-15 預計入學時間（選填）：asap、unsure 或「民國學年-學期」（app/booking/expected_start.py）。
    # 這裡只驗格式；官網送單另驗範圍（VisitRequestCreate），後台補登可以填過去的學期（規格 X8）。
    expected_start: str | None = Field(default=None, max_length=8)
```

同一個 class 加驗證器（放在 `_validate_phone` 之後）：

```python
    @field_validator("expected_start")
    @classmethod
    def _expected_start_format(cls, value: str | None) -> str | None:
        if value is not None:
            start_rules.parse(value)
        return value
```

`VisitRequestCreate` 加：

```python
    @field_validator("expected_start")
    @classmethod
    def _expected_start_public_range(cls, value: str | None) -> str | None:
        # 官網只列今天之後的學期（規格 X7）；格式由父類別先驗。
        if value is not None:
            start_rules.validate_public(value, today_local())
        return value
```

`VisitRequestDetailOut` 的 `party_size` 之後加：

```python
    # 預計入學時間（2026-10-15）；舊案件與沒選的為 None。
    expected_start: str | None = None
```

- [ ] **Step 6：建案寫入與雜湊**

`backend/app/booking/service.py` `_canonical_payload`（:159）的 tuple 改成：

```python
    for field in ("child_name", "child_birthdate", "email", "referral_sources", "party_size", "expected_start"):
```

並把上面的註解補一句：「預計入學時間（2026-10-15）同理：沒選不進 hash。」

`submit_visit_request` 的 `VisitRequest(...)`（`party_size=payload.get("party_size"),` 之後，:378）與 `create_manual_visit_request`（:487）各加一行：

```python
        expected_start=payload.get("expected_start"),
```

- [ ] **Step 7：CSV**

`backend/app/booking/export_labels.py` 的 `EXPORT_HEADERS`：

```python
EXPORT_HEADERS = (
    "校區", "狀態", "來源", "家長", "手機", "送出時間",
    "孩子姓名", "孩子生日", "Email", "得知管道", "人數", "預計入學",
    "參觀日期", "開始", "結束",
)
```

`backend/app/booking/routes.py` 頂部加 `from app.booking import expected_start as start_rules`；`_export_row`（:1098）在人數那一行之後加：

```python
        # 預計入學時間（2026-10-15）：沒選留空；「盡快」換算送單當時的學期。
        start_rules.display_label(r.expected_start, r.created_at.astimezone(OPERATING_TZ).date()) if r.expected_start else "",
```

- [ ] **Step 8：跑測試確認通過**

Run: `PYTEST tests/test_visit_expected_start.py tests/test_visit_details.py tests/test_visit_attention_export.py tests/test_self_booking_submit.py tests/test_secfix_booking.py`
Expected: PASS。

- [ ] **Step 9：契約**

Run: `CONTRACT_REGEN`，再 `CONTRACT_CHECK`。Expected：檢查通過；`git diff --stat contracts/` 只有 `expected_start` 相關的增加。

- [ ] **Step 10：Commit**

```bash
git add backend/migrations/versions/b7e3c1a9d5f2_visit_expected_start.py backend/app/booking/models.py backend/app/booking/schemas.py backend/app/booking/service.py backend/app/booking/export_labels.py backend/app/booking/routes.py backend/tests/test_visit_expected_start.py backend/tests/test_visit_details.py backend/tests/test_visit_attention_export.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(booking): 預約案件加預計入學時間（送單、補登、明細與匯出）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3：後台與家長修改、帶進招生入學學期

**Files:**
- Modify: `backend/app/booking/schemas.py:522-552`（`ParentDetailsUpdate`）、`:580-632`（`AdminDetailsUpdate`）、`:638-720`（`ParentVisitRequestOut`、`from_visit_request`）
- Modify: `backend/app/booking/workflow_service.py:332`（`EDITABLE_BY_PARENT`）、`:432-436`（`EDITABLE_BY_STAFF`、`_ADMISSIONS_CREATE_FIELDS`）
- Modify: `backend/app/admissions/booking_link.py:77-102`（`fields_from_visit_request`）
- Test: Create `backend/tests/test_visit_expected_start_edit.py`；Modify `backend/tests/test_admissions_booking_link.py:51-61`（`_request` 預設值）
- Modify（重新產生）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1、2）：`start_rules.parse`、`validate_public`、`resolve_term`；`VisitRequest.expected_start`。
- Produces：`PATCH /admin/visit-requests/{id}/details` 與 `PATCH /public/visit-manage/me` 都收 `expected_start`（`null` 或空字串＝清空）；`ParentVisitRequestOut.expected_start`；歷程 `details_updated` 的 `fields` 可能含 `"expected_start"`（Task 5 的中文）。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_visit_expected_start_edit.py`：

```python
"""預計入學時間的修改與帶進招生（2026-10-15 規格 X4、X5、X7；計畫裁定 P4）。"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.admissions import academic
from app.admissions.models import RecruitmentVisit
from app.booking import expected_start
from app.booking.models import VisitRequest
from app.common.timezones import today_local
from tests.admissions_helpers import API, complete, started_booking
from tests.conftest import book_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
CASES = f"{API}/admin/visit-requests"


def _month_choice(index: int = 1) -> str:
    return expected_start.public_choices(today_local())[index]["value"]


async def _detail(client, case_id: str) -> dict:
    response = await client.get(f"{CASES}/{case_id}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_staff_can_set_change_and_clear_it(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    case_id = booked["receipt_id"]
    version = (await _detail(admin_client, case_id))["details_version"]
    set_ = await admin_client.patch(f"{CASES}/{case_id}/details", json={"expected_version": version, "expected_start": "110-1"})
    assert set_.status_code == 200, set_.text
    assert set_.json()["changed_fields"] == ["expected_start"]
    cleared = await admin_client.patch(
        f"{CASES}/{case_id}/details", json={"expected_version": set_.json()["details_version"], "expected_start": ""}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["expected_start"] is None
    # 歷程只記欄位名，不記內容。
    event = next(e for e in cleared.json()["history"] if e["event_type"] == "details_updated")
    assert event["after"] == {"fields": ["expected_start"]}


@pytest.mark.asyncio
async def test_staff_rejects_malformed_values(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    version = (await _detail(admin_client, booked["receipt_id"]))["details_version"]
    response = await admin_client.patch(
        f"{CASES}/{booked['receipt_id']}/details", json={"expected_version": version, "expected_start": "115-3"}
    )
    assert response.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in response.json()["detail"]]


@pytest.mark.asyncio
async def test_parent_can_change_it_within_the_public_range(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, days_ahead=5, expected_start="asap")
    me = await open_manage(public_client, booked["manage_path"])
    assert me["expected_start"] == "asap"
    ok = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": me["id"], "expected_version": me["version"], "expected_start": _month_choice(2)},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["expected_start"] == _month_choice(2)
    year, semester = academic.current_term(today_local())
    past = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": me["id"], "expected_version": ok.json()["version"],
              "expected_start": expected_start.format_term((year - 1, semester))},
    )
    assert past.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in past.json()["detail"]]


@pytest.mark.asyncio
async def test_parent_can_edit_other_fields_when_the_old_term_is_out_of_range(admin_client, public_client, db_session):
    """送單後跨了學期，原值已不在範圍內：沒動這一題就不送、不擋其他欄位（Review Focus 3）。"""
    booked = await book_slot(admin_client, public_client, days_ahead=5)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])).values(expected_start="110-1")
    )
    await db_session.commit()
    me = await open_manage(public_client, booked["manage_path"])
    response = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": me["id"], "expected_version": me["version"], "child_name": "小樹"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["expected_start"] == "110-1"


async def _visit_for(db_session, case_id: str) -> RecruitmentVisit:
    return (
        await db_session.execute(
            select(RecruitmentVisit)
            .where(RecruitmentVisit.visit_request_id == uuid.UUID(case_id))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["month", "asap", "unsure", None])
async def test_arrival_carries_the_choice_into_the_target_term(admin_client, public_client, db_session, choice):
    value = {"month": _month_choice(3), "asap": "asap", "unsure": "unsure", None: None}[choice]
    fields = {} if value is None else {"expected_start": value}
    booking = await started_booking(admin_client, public_client, db_session, **fields)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    visit = await _visit_for(db_session, booking["id"])
    slot_day = today_local() - timedelta(days=1)  # started_booking 把場次移到昨天
    if choice == "month":
        assert (visit.target_school_year, visit.target_semester) == expected_start.parse(value)
    elif choice == "asap":
        assert (visit.target_school_year, visit.target_semester) == academic.current_term(slot_day)
    else:
        assert (visit.target_school_year, visit.target_semester) == academic.current_term(today_local())


@pytest.mark.asyncio
async def test_later_booking_edits_do_not_move_the_admissions_term(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session, expected_start=_month_choice(3))
    assert (await complete(admin_client, booking["id"])).status_code == 200
    before = await _visit_for(db_session, booking["id"])
    term = (before.target_school_year, before.target_semester)
    version = (await _detail(admin_client, booking["id"]))["details_version"]
    response = await admin_client.patch(
        f"{CASES}/{booking['id']}/details", json={"expected_version": version, "expected_start": "unsure"}
    )
    assert response.status_code == 200, response.text
    after = await _visit_for(db_session, booking["id"])
    assert (after.target_school_year, after.target_semester) == term
```

`backend/tests/test_admissions_booking_link.py:51-61` 的 `_request` 預設值加 `"expected_start": None,`（`fields_from_visit_request` 會讀這個屬性）。

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_visit_expected_start_edit.py`
Expected: FAIL（422 `extra_forbidden`、家長頁沒有 `expected_start`、入學學期仍是今天）。

- [ ] **Step 3：schema**

`AdminDetailsUpdate`：欄位（`child_birthdate` 之後）：

```python
    # 預計入學時間（2026-10-15 規格 X5、X8）：格式正確即可（可以填過去的學期）；空字串或 null 是清空。
    expected_start: str | None = Field(default=None, max_length=8)
```

`_blank_means_cleared` 的欄位清單加 `"expected_start"`：

```python
    @field_validator("email", "child_name", "child_birthdate", "expected_start", mode="before")
```

並加：

```python
    @field_validator("expected_start")
    @classmethod
    def _expected_start_format(cls, value: str | None) -> str | None:
        if value is not None:
            start_rules.parse(value)
        return value
```

docstring 的「只收這五欄」改成「只收這六欄（2026-10-15 加預計入學時間）」。

`ParentDetailsUpdate`：欄位（`questions` 之後）：

```python
    # 預計入學時間（2026-10-15）：家長可以改或清空；範圍同官網送單（計畫裁定 P4）。
    expected_start: str | None = Field(default=None, max_length=8)
```

並加：

```python
    @field_validator("expected_start", mode="before")
    @classmethod
    def _expected_start_blank(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("expected_start")
    @classmethod
    def _expected_start_public(cls, value: str | None) -> str | None:
        if value is not None:
            start_rules.validate_public(value, today_local())
        return value
```

`ParentVisitRequestOut`：欄位（`questions` 之後）加 `expected_start: str | None = None`；`from_visit_request` 的 `questions=visit_request.questions,` 之後加 `expected_start=visit_request.expected_start,`。

- [ ] **Step 4：可改欄位**

`backend/app/booking/workflow_service.py`：

```python
EDITABLE_BY_PARENT = (
    "parent_name", "phone", "email", "child_name", "child_birthdate", "party_size", "questions", "expected_start",
)
```

```python
# 後台人員可以改的家長資料（2026-10-12 規格 3.1）：不含參觀人數與想了解的事；2026-10-15 加預計入學時間。
EDITABLE_BY_STAFF = ("parent_name", "phone", "email", "child_name", "child_birthdate", "expected_start")
```

```python
_ADMISSIONS_CREATE_FIELDS = (*_ADMISSIONS_SOURCE_FIELDS, "referral_sources", "questions", "follow_up_at", "expected_start")
```

（`_ADMISSIONS_SOURCE_FIELDS` 不加：預約之後再改不同步到招生，規格 X4。）

- [ ] **Step 5：帶進招生入學學期**

`backend/app/admissions/booking_link.py`：import 加 `from app.booking import expected_start as start_rules`（和 `from app.booking import history` 放一起）。`fields_from_visit_request`：

```python
def fields_from_visit_request(visit_request, *, today: date, slot_date: date | None = None) -> dict:
    """規格 6.1 第 1 點的欄位對應（today 是確認到場當天的台北日期）：

    - visit_date：場次日期；沒有場次（舊案）用 today。
    - child_name、birthday、grade、phone、contact_name：見 contact_fields。
    - source：勾選的「從哪裡知道我們」照後台文案以「、」串接，截到 50 字。
    - notes：「家長想了解：」＋想了解的事；沒填為 None。
    - target_school_year／target_semester：家長在預約表單選的預計入學時間（2026-10-15 規格 X4，
      expected_start.resolve_term）；沒選或「還不確定」是 today 所在學期（同園務建立時補當前學期）。
    家長 Email 不複製（園務招生沒有 Email 欄位）。"""
    visit_date = slot_date or today
    school_year, semester = start_rules.resolve_term(
        visit_request.expected_start, visit_date=visit_date, today=today
    )
    sources = "、".join(REFERRAL_SOURCE_TEXT.get(str(code), str(code)) for code in (visit_request.referral_sources or []))
    questions = (visit_request.questions or "").strip()
    return {
        "visit_date": visit_date,
        **contact_fields(
            visit_request.parent_name,
            visit_request.phone,
            visit_request.child_name,
            visit_request.child_birthdate,
            today=today,
        ),
        "source": _cut(sources, constants.LEN_SOURCE),
        "notes": f"{NOTES_PREFIX}{questions}" if questions else None,
        "target_school_year": school_year,
        "target_semester": semester,
    }
```

- [ ] **Step 6：跑測試確認通過**

Run: `PYTEST tests/test_visit_expected_start_edit.py tests/test_admissions_booking_link.py tests/test_admin_visit_details.py tests/test_parent_access.py tests/test_parent_manage_link.py`
Expected: PASS。

- [ ] **Step 7：契約與 Commit**

Run: `CONTRACT_REGEN`，再 `CONTRACT_CHECK`。

```bash
git add backend/app/booking/schemas.py backend/app/booking/workflow_service.py backend/app/admissions/booking_link.py backend/tests/test_visit_expected_start_edit.py backend/tests/test_admissions_booking_link.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(booking): 後台與家長可改預計入學時間，到場時帶進招生的入學學期

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4：官網表單與家長管理頁

**Files:**
- Modify: `web/app/utils/visit-form.ts`（型別、選項、422 對應）
- Modify: `web/app/utils/visit-edit.ts`（編輯表單多一欄）
- Modify: `web/app/components/VisitForm.vue:6`（import）、`:22-30`（`form`）、`:385-399`（payload）、`:598-604`（孩子資料區塊）、`:662`（成功頁清單）
- Modify: `web/app/pages/visit/manage.vue:135`（`editForm`）、`:200-209`（顯示）、`:262-272`（編輯表單）
- Modify: `web/app/composables/useParentVisit.ts:7`（`ParentDetailChanges`）
- Modify: `web/app/assets/css/visit-booking.css`（`.visit-referrals` 規則之後，約 :164）
- Test: Create `web/tests/visit-expected-start.spec.ts`；Modify `web/tests/visit-edit.spec.ts`

**Interfaces:**
- Consumes（Task 1–3）：案例檔 `contracts/expected-start-cases.json`；API 欄位 `expected_start`（送單 body、`ParentVisitRequestOut.expected_start`、`PATCH /public/visit-manage/me` body）；422 的 `loc` `["body","expected_start"]`。
- Produces：`expectedStartOptions(today: string): { value: string; label: string }[]`、`expectedStartText(value: string): string`（家長看的短文字）、`VisitField` 多了 `'expectedStart'`；`EditForm.expectedStart: string`。

- [ ] **Step 1：寫失敗的測試**

`web/tests/visit-expected-start.spec.ts`：

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apiFieldErrors, expectedStartOptions, expectedStartText } from '../app/utils/visit-form'

// 2026-10-15 預計入學時間：選項與後端 app/booking/expected_start.py 讀同一份案例（計畫裁定 P2）。
interface ChoiceCase { name: string; today: string; values: string[]; labels: string[] }
const casesPath = fileURLToPath(new URL('../../contracts/expected-start-cases.json', import.meta.url))
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as { choices: ChoiceCase[] }
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('預計入學時間的選項', () => {
  it.each(cases.choices.map(c => [c.name, c] as const))('%s', (_name, item) => {
    const options = expectedStartOptions(item.today)
    expect(options.map(o => o.value)).toEqual(item.values)
    expect(options.map(o => o.label)).toEqual(item.labels)
  })

  it('家長看的短文字：盡快、還不確定、學期換成月份；認不得的值原樣顯示', () => {
    expect(expectedStartText('asap')).toBe('盡快')
    expect(expectedStartText('unsure')).toBe('還不確定')
    expect(expectedStartText('115-2')).toBe('2027 年 2 月')
    expect(expectedStartText('116-1')).toBe('2027 年 9 月')
    expect(expectedStartText('x')).toBe('x')
  })

  it('後端 422 指到 expected_start 時寫在這一題下面', () => {
    expect(apiFieldErrors([{ loc: ['body', 'expected_start'], msg: 'x' }])).toEqual({ expectedStart: '這個入學時間已過期，請重新選擇。' })
  })
})

describe('預約表單放這一題的方式（規格 X3）', () => {
  const form = read('../app/components/VisitForm.vue')

  it('放在孩子資料區塊、生日之後，是單選膠囊、標選填', () => {
    const child = form.slice(form.indexOf('id="visit-child-title"'), form.indexOf('id="visit-parent-title"'))
    expect(child.indexOf('child-birthdate')).toBeLessThan(child.indexOf('visit-expected-start'))
    expect(child).toMatch(/<legend>預計入學時間<small>選填<\/small><\/legend>/)
    expect(child).toContain('type="radio" name="expectedStart"')
  })

  it('沒選就不帶 expected_start，選了才帶', () => {
    expect(form).toContain("...(form.expectedStart ? { expected_start: form.expectedStart } : {})")
  })

  it('再點一次已選的那一個就取消選取', () => {
    expect(form).toMatch(/form\.expectedStart = form\.expectedStart === value \? '' : value/)
  })
})
```

`web/tests/visit-edit.spec.ts` 在第一個 `describe` 最後加兩個案例（並把檔頭的 `record` 加上 `expected_start: 'asap'`）：

```ts
  it('預計入學時間：沒動不送，清空送 null，改了送新值（2026-10-15）', () => {
    const base = editBaseFrom(record)
    expect(base.expectedStart).toBe('asap')
    expect(editedChanges(record, { ...base, phone: '0922333444' }, base)).toEqual({ phone: '0922333444' })
    expect(editedChanges(record, { ...base, expectedStart: '' }, base)).toEqual({ expected_start: null })
    expect(editedChanges(record, { ...base, expectedStart: '116-1' }, base)).toEqual({ expected_start: '116-1' })
  })

  it('原值已不在新選項（跨學期）：只改別的欄位時不送、也不擋（Review Focus 3）', () => {
    const old = { ...record, expected_start: '110-1' }
    const base = editBaseFrom(old)
    const form = { ...base, childName: '小樹' }
    expect(editedChanges(old, form, base)).toEqual({ child_name: '小樹' })
    expect(validateEdit(old, form, base, '2026-10-15')).toEqual({})
  })
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd web; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run tests/visit-expected-start.spec.ts tests/visit-edit.spec.ts`
Expected: FAIL（`expectedStartOptions` 未匯出、表單沒有這一題）。

- [ ] **Step 3：`visit-form.ts`**

`VisitField` 改成：

```ts
export type VisitField = keyof VisitContact | 'visitDate' | 'slotId' | 'expectedStart'
```

在 `REFERRAL_OPTIONS` 之後加：

```ts
// 2026-10-15 預計入學時間（選填）：盡快、接下來四個學期的開學月份、還不確定。學期規則同後端
// app/admissions/academic.py 的 current_term（8/1 起上學期、2/1 起下學期、1 月仍屬上學期）；值是「民國學年-學期」，
// 和後端 app/booking/expected_start.py 讀同一份案例 contracts/expected-start-cases.json。
export interface ExpectedStartOption { value: string; label: string }

function currentTerm(today: string): [number, number] {
  const [year, month] = today.split('-').map(Number) as [number, number]
  if (month >= 8) return [year - 1911, 1]
  if (month >= 2) return [year - 1912, 2]
  return [year - 1912, 1]
}

function termMonthText(schoolYear: number, semester: number): string {
  return semester === 1 ? `${schoolYear + 1911} 年 9 月` : `${schoolYear + 1912} 年 2 月`
}

/** today 是台北日期（YYYY-MM-DD，taipeiDate()）。 */
export function expectedStartOptions(today: string): ExpectedStartOption[] {
  const [schoolYear, semester] = currentTerm(today)
  const current = schoolYear * 2 + semester - 1
  const options: ExpectedStartOption[] = [{ value: 'asap', label: '盡快（這學期）' }]
  for (let offset = 1; offset <= 4; offset++) {
    const index = current + offset
    const termYear = Math.floor(index / 2)
    const termSemester = (index % 2) + 1
    options.push({ value: `${termYear}-${termSemester}`, label: termMonthText(termYear, termSemester) })
  }
  options.push({ value: 'unsure', label: '還不確定' })
  return options
}

/** 家長管理頁顯示已選的值（原值可能已不在今天的選項裡）。 */
export function expectedStartText(value: string): string {
  if (value === 'asap') return '盡快'
  if (value === 'unsure') return '還不確定'
  const match = /^(1\d{2})-([12])$/.exec(value)
  return match ? termMonthText(Number(match[1]), Number(match[2])) : value
}
```

`API_FIELDS` 加 `expected_start: 'expectedStart'`；`API_FIELD_MESSAGES` 加 `expectedStart: '這個入學時間已過期，請重新選擇。'`。

- [ ] **Step 4：`VisitForm.vue`**

import（:6）多帶 `expectedStartOptions`。`form`（:22-30）加 `expectedStart: ''`（放在 `referralSources` 前）。在 `const today = ref(taipeiDate())`（:128）之後加：

```ts
const expectedStartChoices = computed(() => expectedStartOptions(today.value))
// 預計入學時間是單選、選填：再點一次已選的那一個就取消（規格 X3）。
function toggleExpectedStart(value: string) {
  form.expectedStart = form.expectedStart === value ? '' : value
  clearFieldError('expectedStart')
}
```

（`clearFieldError` 定義在 :306，是函式宣告，提升後可用。）

payload（:385-399）在 `referral_sources: form.referralSources,` 之後加：

```ts
        ...(form.expectedStart ? { expected_start: form.expectedStart } : {}),
```

孩子資料區塊（:598-604）在 `</div>`（`.visit-field-grid` 結束）之後、`</section>` 之前加：

```html
                    <fieldset class="visit-referrals visit-expected-start" aria-describedby="visit-expected-start-error"><legend>預計入學時間<small>選填</small></legend><div><label v-for="option in expectedStartChoices" :key="option.value"><input type="radio" name="expectedStart" :value="option.value" :checked="form.expectedStart === option.value" @click="toggleExpectedStart(option.value)"><span>{{ option.label }}</span></label></div><p id="visit-expected-start-error" class="visit-field-error">{{ fieldErrors.expectedStart }}</p></fieldset>
```

成功頁清單（:662）在得知管道那個 `<div>` 之前加：

```html
<div v-if="form.expectedStart"><dt>預計入學</dt><dd>{{ expectedStartChoices.find(option => option.value === form.expectedStart)?.label }}</dd></div>
```

- [ ] **Step 5：樣式**

`web/app/assets/css/visit-booking.css`，在 `.visit-referrals label:has(input:checked) {…}`（:163）之後加：

```css
/* 2026-10-15 預計入學時間：沿用得知管道的膠囊，放在孩子資料區塊裡，上下間距收小。 */
.visit-expected-start {margin:24px 0 0}
```

- [ ] **Step 6：家長管理頁**

`web/app/utils/visit-edit.ts`：

```ts
import { normalizeVisitPhone, validateVisitContact, type VisitErrors, type VisitField } from './visit-form'

export interface EditForm { parentName: string; phone: string; email: string; childName: string; childBirthdate: string; expectedStart: string }
interface EditRecord { parent_name: string; phone: string; email?: string | null; child_name?: string | null; child_birthdate?: string | null; expected_start?: string | null }
export type EditChanges = Partial<{ parent_name: string; phone: string; email: string; child_name: string; child_birthdate: string; expected_start: string | null }>

const KEYS = ['parentName', 'phone', 'email', 'childName', 'childBirthdate', 'expectedStart'] as const

export function editBaseFrom(record: EditRecord): EditForm {
  return {
    parentName: record.parent_name, phone: record.phone, email: record.email ?? '',
    childName: record.child_name ?? '', childBirthdate: record.child_birthdate ?? '',
    expectedStart: record.expected_start ?? ''
  }
}

// 後端送出前的正規化：前後空白、手機分隔符；預計入學時間清空送 null（2026-10-15）。
function normalize(form: EditForm): Required<EditChanges> {
  return {
    parent_name: form.parentName.trim(), phone: normalizeVisitPhone(form.phone), email: form.email.trim(),
    child_name: form.childName.trim(), child_birthdate: form.childBirthdate, expected_start: form.expectedStart || null
  }
}
```

（`editedChanges`、`rebaseEdit` 不用改：前者逐鍵比對 `normalize` 的結果，後者用 `KEYS`。）`CHANGE_FIELD` 加 `expected_start: 'expectedStart'`。

`web/app/composables/useParentVisit.ts:7`：

```ts
export type ParentDetailChanges = Partial<Pick<ParentVisit, 'parent_name' | 'phone' | 'email' | 'child_name' | 'child_birthdate' | 'expected_start'>>
```

`web/app/pages/visit/manage.vue`：import 加 `expectedStartOptions, expectedStartText`（從 `~/utils/visit-form`）。`editForm`（:135）加 `expectedStart: ''`。在 `editPanel` 宣告之後加：

```ts
// 預計入學時間的選項依今天重算；原值不在選項裡（送單後跨了學期）時保留顯示原值（規格 §3.2）。
const editStartChoices = computed(() => {
  const options = expectedStartOptions(taipeiDate())
  const current = editBase.expectedStart
  return current && !options.some(option => option.value === current) ? [{ value: current, label: expectedStartText(current) }, ...options] : options
})
function toggleEditStart(value: string) {
  editForm.expectedStart = editForm.expectedStart === value ? '' : value
}
```

（`editBase` 是 `let`，不是 ref；`openEdit` 會先改 `editBase` 再開表單，computed 在表單打開時才第一次求值。若型別檢查或 lint 要求響應式，改成 `const editBaseStart = ref('')` 並在 `openEdit`／版本衝突重設時一起寫。）

顯示（:200-209）在出生年月日那一行之後加：

```html
<div v-if="visit.expected_start"><dt>預計入學</dt><dd>{{ expectedStartText(visit.expected_start) }}</dd></div>
```

編輯表單（:262-272）在出生年月日的 `<p class="parent-visit-error">…` 之後加：

```html
                <fieldset class="parent-visit-start"><legend>預計入學時間（選填）</legend><div><label v-for="option in editStartChoices" :key="option.value"><input type="radio" name="editExpectedStart" :value="option.value" :checked="editForm.expectedStart === option.value" @click="toggleEditStart(option.value)"><span>{{ option.label }}</span></label></div></fieldset>
                <p class="parent-visit-error">{{ editErrors.expectedStart }}</p>
```

並在 `manage.vue` 的 `<style>`（或它引用的家長頁樣式檔；用 `grep -n "parent-visit-fields" web/app` 找到規則所在檔）加：

```css
.parent-visit-start {border:0;padding:0;margin:4px 0 0;min-width:0}
.parent-visit-start legend {font-weight:600;margin-bottom:8px}
.parent-visit-start>div {display:flex;flex-wrap:wrap;gap:8px}
.parent-visit-start label {display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 16px 6px 12px;border:1px solid var(--visit-line);border-radius:999px;cursor:pointer}
```

（如果家長頁沒有 `--visit-line`，改用該檔既有的邊框 token；不寫色碼字面值。）

- [ ] **Step 7：跑測試確認通過**

Run: `cd web; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run tests/visit-expected-start.spec.ts tests/visit-edit.spec.ts tests/visit-form.spec.ts tests/visit-ux-20261002.spec.ts tests/mobile-ux-20261012.spec.ts tests/parent-visit.spec.ts; npm run typecheck`
Expected: PASS；typecheck 無錯誤（`ParentVisit['expected_start']` 來自 Task 3 重新產生的契約）。

- [ ] **Step 8：Commit**

```bash
git add web/app/utils/visit-form.ts web/app/utils/visit-edit.ts web/app/components/VisitForm.vue web/app/pages/visit/manage.vue web/app/composables/useParentVisit.ts web/app/assets/css/visit-booking.css web/tests/visit-expected-start.spec.ts web/tests/visit-edit.spec.ts
git commit -m "feat(web): 預約表單與家長管理頁加預計入學時間（選填、單選）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（若 Step 6 的樣式寫進了別的檔，`git add` 一併列出。）

---

### Task 5：後台顯示、補登與修改家長資料、隱私說明草稿

**Files:**
- Modify: `admin/src/api/labels.ts`（`VISIT_DETAIL_FIELD_LABELS` :611-614；新增 `expectedStartLabel`、`expectedStartStaffOptions`）
- Modify: `admin/src/components/visit/VisitCaseFacts.vue:15-34`
- Modify: `admin/src/components/visit/VisitDetailsDialog.vue`（`FieldName`、`snapshot`、`form`、`changes`、範本）
- Modify: `admin/src/components/ManualVisitDialog.vue`（`blank`、重新預約帶入、body、範本）
- Modify: `admin/src/composables/privacyNotice.ts:15`、`admin/src/composables/privacyPolicyDraft.ts:30-37`
- Test: Create `admin/src/__tests__/expectedStart.test.ts`

**Interfaces:**
- Consumes：契約型別 `VisitRequestFullOut.expected_start`、`AdminDetailsUpdate.expected_start`、`VisitRequestManualCreate.expected_start`（Task 2、3 重新產生）；案例檔 `labels` 區塊；`taipeiDay(time: number): string`（`admin/src/utils/visitSchedule.ts:7`）。
- Produces：`expectedStartLabel(value: string | null | undefined, submittedOn: string): string`、`expectedStartStaffOptions(today: string, current?: string | null): { value: string; label: string }[]`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/expectedStart.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { expectedStartLabel, expectedStartStaffOptions, VISIT_DETAIL_FIELD_LABELS } from '../api/labels'
import VisitDetailsDialog from '../components/visit/VisitDetailsDialog.vue'
import { bodyOf, cleanup, mockPatch } from './admissionsTestKit'
import { visitCase, VISIT_ID } from './visitCaseKit'

// 2026-10-15 預計入學時間：顯示文字與後端 app/booking/expected_start.py 讀同一份案例（計畫裁定 P2、P3）。
interface LabelCase { value: string; submitted_on: string; label: string }
const cases = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/expected-start-cases.json'), 'utf8')) as { labels: LabelCase[] }

const dialogs: VueWrapper[] = []
afterEach(() => {
  dialogs.forEach((wrapper) => wrapper.unmount())
  dialogs.length = 0
  cleanup()
})

describe('預計入學時間的文字', () => {
  it.each(cases.labels.map((c) => [`${c.value}@${c.submitted_on}`, c] as const))('%s', (_name, item) => {
    expect(expectedStartLabel(item.value, item.submitted_on)).toBe(item.label)
  })

  it('沒選是空字串；歷程的欄位名有中文', () => {
    expect(expectedStartLabel(null, '2026-10-15')).toBe('')
    expect(VISIT_DETAIL_FIELD_LABELS.expected_start).toBe('預計入學時間')
  })

  it('後台選項：盡快、前兩個學期到之後六個學期、還不確定；目前的值不在範圍內也列出來', () => {
    const options = expectedStartStaffOptions('2026-10-15')
    expect(options.map((o) => o.value)).toEqual(['asap', '114-1', '114-2', '115-1', '115-2', '116-1', '116-2', '117-1', '117-2', '118-1', 'unsure'])
    expect(options[4]!.label).toBe('2027 年 2 月（115 學年下學期）')
    expect(expectedStartStaffOptions('2026-10-15', '110-1')[1]).toEqual({ value: '110-1', label: '2021 年 9 月（110 學年上學期）' })
  })
})

describe('修改家長資料：預計入學時間', () => {
  const PATH = `/admin/visit-requests/${VISIT_ID}/details`
  const body = () => new DOMWrapper(document.body)

  it('清空送 null（其他欄位沒動就不送）', async () => {
    const patch = mockPatch({ [PATH]: { ...visitCase({ details_version: 4 }), changed_fields: ['expected_start'], admissions_synced_fields: [], admissions_skipped_fields: [], email_notified: false, access_link_reset: false } })
    const wrapper = mount(VisitDetailsDialog, {
      props: { modelValue: true, detail: visitCase({ details_version: 3, expected_start: 'asap' }) } as never,
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    })
    dialogs.push(wrapper)
    await flushPromises()
    const field = body().findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '預計入學時間')
    expect(field).toBeTruthy()
    // 對話框裡只有這一個 el-select（生日是 el-date-picker）；清除鈕只在 hover 時出現，直接發出清空的值。
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '')
    await flushPromises()
    await body().findAll('button').find((b) => b.text() === '儲存')!.trigger('click')
    await flushPromises()
    expect(bodyOf(patch, PATH)).toEqual({ expected_version: 3, expected_start: null })
  })
})
```

（`VisitCaseFacts` 的列由 Task 6 e2e 在真畫面驗；這裡只驗純函式與送出內容。）

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/expectedStart.test.ts`
Expected: FAIL（函式未匯出、對話框沒有這一欄）。

- [ ] **Step 3：`labels.ts`**

`VISIT_DETAIL_FIELD_LABELS`（:611-614）加 `expected_start: '預計入學時間',`。在它之後加：

```ts
// 預計入學時間（2026-10-15）：和後端 app/booking/expected_start.py 的 display_label 同一套規則與案例
// （contracts/expected-start-cases.json 的 labels）。值是 asap、unsure 或「民國學年-學期」。
type Term = [number, number]
function termOfDay(day: string): Term {
  const [year, month] = day.split('-').map(Number) as [number, number]
  if (month >= 8) return [year - 1911, 1]
  if (month >= 2) return [year - 1912, 2]
  return [year - 1912, 1]
}
const termIndex = ([year, semester]: Term): number => year * 2 + semester - 1
const termAt = (index: number): Term => [Math.floor(index / 2), (index % 2) + 1]
const termText = ([year, semester]: Term): string => `${year} 學年${semester === 1 ? '上' : '下'}學期`
const termMonthText = ([year, semester]: Term): string => (semester === 1 ? `${year + 1911} 年 9 月` : `${year + 1912} 年 2 月`)
function parseTerm(value: string): Term | null {
  const match = /^(1\d{2})-([12])$/.exec(value)
  return match ? [Number(match[1]), Number(match[2])] : null
}

/** 明細的文字；submittedOn 是送單的台北日期（YYYY-MM-DD），「盡快」換算當時的學期。 */
export function expectedStartLabel(value: string | null | undefined, submittedOn: string): string {
  if (!value) return ''
  if (value === 'unsure') return '還不確定'
  if (value === 'asap') return `盡快（送單時是 ${termText(termOfDay(submittedOn))}）`
  const term = parseTerm(value)
  return term ? `${termMonthText(term)}（${termText(term)}）` : value
}

/** 後台補登與修改家長資料的下拉：盡快、前兩個學期到之後六個學期、還不確定（規格 X8：後台可填過去的學期）；
 * 目前的值不在範圍內時也列出來，打開表單不會把它弄丟。 */
export function expectedStartStaffOptions(today: string, current?: string | null): { value: string; label: string }[] {
  const now = termIndex(termOfDay(today))
  const terms = Array.from({ length: 9 }, (_, i) => termAt(now - 2 + i))
  const options = [
    { value: 'asap', label: '盡快' },
    ...terms.map((term) => ({ value: `${term[0]}-${term[1]}`, label: `${termMonthText(term)}（${termText(term)}）` })),
    { value: 'unsure', label: '還不確定' },
  ]
  const kept = current ? parseTerm(current) : null
  if (current && kept && !options.some((option) => option.value === current)) {
    options.splice(1, 0, { value: current, label: `${termMonthText(kept)}（${termText(kept)}）` })
  }
  return options
}
```

- [ ] **Step 4：明細的資料表**

`VisitCaseFacts.vue`：import 加 `expectedStartLabel`（從 `../../api/labels`）與 `import { taipeiDay } from '../../utils/visitSchedule'`。在 `if (d.party_size) …` 之後加：

```ts
  if (d.expected_start) rows.push({ label: '預計入學', text: expectedStartLabel(d.expected_start, taipeiDay(Date.parse(d.created_at))) })
```

（只有有值才列，`visitCaseLayout.test.ts` 的四列不變。）

- [ ] **Step 5：修改家長資料對話框**

`VisitDetailsDialog.vue`：
- import 加 `expectedStartStaffOptions`（`../../api/labels`）與 `taipeiDay`（`../../utils/visitSchedule`）。
- `type FieldName = 'parent_name' | 'phone' | 'child_name' | 'child_birthdate' | 'email' | 'expected_start'`；`FIELDS` 最後加 `'expected_start'`。
- `snapshot()` 回傳加 `expected_start: d.expected_start ?? '',`。
- `form` 加 `expected_start: ''`；`watch(open, …)` 的解構與 `Object.assign` 加 `expected_start`。
- `trimmed` 加 `expected_start: form.expected_start,`。
- `changes` 加 `if (t.expected_start !== b.expected_start) out.expected_start = t.expected_start || null`。
- `errors` 加 `expected_start: '',`。
- 加 `const startOptions = computed(() => expectedStartStaffOptions(taipeiDay(Date.now()), base.value.expected_start))`。
- 範本：Email 那個 `el-form-item`（目前有 `class="details__last"`）拿掉 `details__last`，在它之後加：

```html
      <el-form-item label="預計入學時間" class="details__last" :error="fieldError('expected_start')">
        <el-select v-model="form.expected_start" clearable placeholder="選填" style="width: 100%">
          <el-option v-for="option in startOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
```

（`el-select` 清除後的值是 `''`；`changes` 把 `''` 送成 `null`。）

- [ ] **Step 6：補登對話框**

`ManualVisitDialog.vue`：
- `blank()` 加 `expected_start: '',`（`party_size` 之後）。
- 重新預約帶入（:64-72）加 `form.expected_start = from.expected_start ?? ''`。
- body（:215-239）在 `party_size: form.party_size,` 之後加 `expected_start: form.expected_start || null,`。
- import `expectedStartStaffOptions`、`taipeiDay`；加 `const startOptions = computed(() => expectedStartStaffOptions(taipeiDay(Date.now()), form.expected_start))`。
- 範本：「家長想了解的事」那個 `el-form-item` 之前加：

```html
      <el-form-item label="預計入學時間">
        <el-select v-model="form.expected_start" clearable placeholder="選填，家長預計什麼時候入學" style="width: 100%">
          <el-option v-for="option in startOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
```

- [ ] **Step 7：隱私說明草稿（規格 X11）**

`admin/src/composables/privacyNotice.ts:15`：

```ts
    { heading: `${m}蒐集的資料`, body: `${m}家長稱呼、聯絡電話、Email，孩子姓名與出生年月日，以及預計入學時間（選填）。` },
```

`admin/src/composables/privacyPolicyDraft.ts` 第 2 段，在 `'- 如何得知常春藤（選填…）',` 之後加 `'- 預計入學時間（選填）',`；把 `'您之後可以用確認信裡的修改連結，更新稱呼、手機、Email、孩子的姓名與生日，也可以取消或改期。'` 改成 `'您之後可以用確認信裡的修改連結，更新稱呼、手機、Email、孩子的姓名與生日、預計入學時間，也可以取消或改期。'`。

- [ ] **Step 8：跑測試確認通過**

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/expectedStart.test.ts src/__tests__/visitDetailsDialog.test.ts src/__tests__/visitCaseLayout.test.ts src/__tests__/privacyPolicy.test.ts src/__tests__/labelCoverage.test.ts; npm run typecheck`
Expected: PASS；typecheck 無錯誤。

- [ ] **Step 9：Commit**

```bash
git add admin/src/api/labels.ts admin/src/components/visit/VisitCaseFacts.vue admin/src/components/visit/VisitDetailsDialog.vue admin/src/components/ManualVisitDialog.vue admin/src/composables/privacyNotice.ts admin/src/composables/privacyPolicyDraft.ts admin/src/__tests__/expectedStart.test.ts
git commit -m "feat(admin): 案件明細、補登與修改家長資料加預計入學時間；隱私說明草稿補這一項

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6：stack e2e（預計入學時間）與表單桌機／手機截圖

**Files:**
- Create: `tests/stack/visit-expected-start.spec.ts`

**Interfaces:**
- Consumes：`openAs`、`gotoAdmin`、`pickVisitDay`、`expectNoHorizontalOverflow`（`tests/stack/pages.ts`）；`adminApi`、`findVisit`、`taipeiDate`（`tests/stack/api.ts`）；`startVisitSlot`（`tests/stack/db.ts:22`）；Task 4 的 DOM（`fieldset.visit-expected-start` 的 radio、成功頁 `dt` 「預計入學」）；Task 5 的 `.case-facts`「預計入學」。

公開送單給自己的來源 `X-Forwarded-For: 198.51.100.61`（每來源每校每小時 5 筆，不吃別支 spec 的額度）。先用後台 API 在 21 天後開一個專用場次（16:40–17:10、容量 1），家長選那一天那一場；`startVisitSlot` 只在那一場只有這一筆預約時才移得動，所以不能用月曆的第一個場次。

- [ ] **Step 1：寫 spec**

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { adminApi, findVisit, taipeiDate } from './api'
import { startVisitSlot } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs, pickVisitDay } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 2026-10-15 預計入學時間：家長在官網選一個月份送出 → 成功頁與後台明細看得到 → 標到場後招生訪視的入學學期就是那一學期；
// 表單在 1440 與 390 都不橫向溢出（截圖存 output/playwright）。
const SHOTS = path.join(ROOT, 'output/playwright')
const PARENT = '預計入學家長'
const CHILD = '預計入學寶貝'

test('家長選預計入學時間 → 後台明細看得到 → 到場後帶進招生的入學學期', async ({ browser }) => {
  const api = await adminApi('super_admin')
  const slotDate = taipeiDate(21)
  await api.send('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, { slot_date: slotDate, start_time: '16:40:00', end_time: '17:10:00', capacity: 1 })
  const parent = await openAs(browser, null, { extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.61' } })
  const { page } = parent
  let chosen = ''

  await test.step('家長選日期、場次、預計入學時間後送出', async () => {
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    await pickVisitDay(page, slotDate)
    await page.locator('.visit-slot-options label', { hasText: '16:40' }).locator('input').check()
    await page.getByLabel('孩子姓名').fill(CHILD)
    await page.getByLabel('孩子出生年月日').fill('2023-03-15')
    const start = page.getByRole('group', { name: /預計入學時間/ })
    const option = start.getByRole('radio').nth(2)
    chosen = await option.inputValue()
    await option.check()
    // 再點一次就取消，再點回來。
    await option.click()
    await expect(option).not.toBeChecked()
    await option.check()
    await page.getByLabel('家長稱呼').fill(PARENT)
    await page.getByLabel('聯絡電話').fill('0955000616')
    await page.getByLabel('聯絡 Email').fill('expected-start@example.com')
    await page.getByRole('button', { name: '確認預約' }).click()
    await expect(page.locator('#booking-result')).toContainText('預約成功')
    await expect(page.locator('.visit-result-list')).toContainText('預計入學')
  })

  const visit = await findVisit(api, PARENT)
  const detail = await api.get<{ expected_start: string | null }>(`/admin/visit-requests/${visit.id}`)
  expect(detail.expected_start).toBe(chosen)

  await test.step('後台明細看得到', async () => {
    const staff = await openAs(browser, 'super_admin')
    await gotoAdmin(staff.page, `/visit-requests/${visit.id}`, '案件明細')
    await expect(staff.page.locator('.case-facts')).toContainText('預計入學')
    await staff.context.close()
  })

  await test.step('標到場後，招生訪視的入學學期就是家長選的學期', async () => {
    startVisitSlot(visit.id)
    await api.send('POST', `/admin/visit-requests/${visit.id}/complete`)
    const records = await api.get<{ child_name: string; target_school_year: number; target_semester: number }[]>(
      `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&q=${encodeURIComponent(CHILD)}`,
    )
    const [year, semester] = chosen.split('-').map(Number)
    expect(records.map((r) => [r.child_name, r.target_school_year, r.target_semester])).toEqual([[CHILD, year, semester]])
  })
  await Promise.all([parent.context.close(), api.dispose()])
})

for (const { name, device } of [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const) {
  test(`${name}px：預約表單的預計入學時間不撐出畫面`, async ({ browser }) => {
    const { context, page } = await openAs(browser, null, { ...device, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.62' } })
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    const start = page.getByRole('group', { name: /預計入學時間/ })
    await expect(start.getByRole('radio')).toHaveCount(6)
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await start.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(SHOTS, `visit-expected-start-${name}.png`) })
    await context.close()
  })
}
```

（`/admin/admissions/records` 的搜尋參數名先用 `grep -n "q:" backend/app/admissions/records.py` 確認；若不是 `q`，照實際名稱改。）

- [ ] **Step 2：跑這一支（控制者或實作者，單獨跑）**

```bash
export E2E_DB_NAME=ivy_website_wave3_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746
npm run e2e:build && npx playwright test -c playwright.stack.config.ts tests/stack/visit-expected-start.spec.ts
```

Expected: 3 passed。人工看 `output/playwright/visit-expected-start-1440.png`、`-390.png`：膠囊換行整齊、和得知管道同款、沒有被裁掉。

- [ ] **Step 3：Commit**

```bash
git add tests/stack/visit-expected-start.spec.ts
git commit -m "test(e2e): 預計入學時間從官網送單到招生入學學期

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Part B：預約案件排除

### Task 7：migration、`exclusion.py`、標記與取消的 API

**Files:**
- Create: `backend/migrations/versions/d4a8f2c6e913_visit_exclusion.py`
- Modify: `backend/app/booking/models.py`（`__table_args__` 加兩條 CHECK；`anonymized_at` 之前加四欄）
- Create: `backend/app/booking/exclusion.py`
- Modify: `backend/app/booking/schemas.py`（`VisitExcludeReason`、`VisitRequestExcludeRequest`；`VisitRequestDetailOut` 加三欄）
- Modify: `backend/app/booking/routes.py`（兩支端點；列表 `model_copy` 清掉說明，:1029）
- Modify: `backend/app/operations/retention_service.py:168-200`（`anonymize`）、`:270-285`（補清）
- Test: Create `backend/tests/test_visit_exclusion.py`
- Modify（重新產生）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes：`history.record_event(db, visit_request_id, event_type, *, actor, before, after, reason)`（`backend/app/booking/history.py:64`）、`Actor.staff(user_id)`、`audit_service.log_action(db, *, actor_user_id, action, target_type, target_id, campus_key, metadata)`、`_get_owned_visit_request(db, user, id)`（`routes.py:877`）、`require_scope`。
- Produces（Task 8–10 用）：
  - `exclusion.REASONS = ("test", "duplicate", "other")`、`exclusion.NOTE_MAX = 200`
  - `exclusion.not_excluded()`（SQL 條件 `VisitRequest.excluded_at IS NULL`）、`exclusion.is_excluded(visit) -> bool`
  - `exclusion.exclude(db, visit, *, reason, note, actor) -> None`（`AlreadyExcluded`）、`exclusion.include(db, visit, *, actor) -> str`（回傳原本的原因；`NotExcluded`）
  - `POST /admin/visit-requests/{id}/exclude`（body `VisitRequestExcludeRequest {reason, note?}`）、`POST /admin/visit-requests/{id}/include`，都回 `VisitRequestDetailOut`
  - `VisitRequestDetailOut.excluded_at: datetime | None`、`exclude_reason: str | None`、`exclude_note: str | None`
  - 歷程事件 `excluded`（`after={"reason": …}`，`reason`＝說明）、`exclusion_removed`（`before={"reason": …}`）；操作紀錄 `visit_request.exclude`／`visit_request.include`，metadata `{"exclude_reason": …}`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_visit_exclusion.py`：

```python
"""預約案件「排除」標記：權限、時間線、操作紀錄、匿名化（2026-10-15 規格 E2–E6、E11；計畫裁定 P6、P12、P15、P16）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError

from app.booking.models import VisitRequest
from app.operations import retention_service
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import API, campus_admin_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import legacy_request

CASES = f"{API}/admin/visit-requests"


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


@pytest.mark.asyncio
async def test_campus_admin_excludes_and_includes(campus_admin_yihua_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    excluded = await campus_admin_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert excluded.status_code == 200, excluded.text
    body = excluded.json()
    assert body["exclude_reason"] == "test" and body["excluded_at"] is not None
    assert body["status"] == "confirmed"  # 不改狀態（E6）
    detail = (await campus_admin_yihua_client.get(f"{CASES}/{case_id}")).json()
    event = next(e for e in detail["history"] if e["event_type"] == "excluded")
    assert event["after"] == {"reason": "test"} and event["source"] == "staff"
    assert await _audit(db_session, "visit_request.exclude") == [{"exclude_reason": "test"}]

    included = await campus_admin_yihua_client.post(f"{CASES}/{case_id}/include")
    assert included.status_code == 200, included.text
    assert (included.json()["excluded_at"], included.json()["exclude_reason"], included.json()["exclude_note"]) == (None, None, None)
    detail = (await campus_admin_yihua_client.get(f"{CASES}/{case_id}")).json()
    removed = next(e for e in detail["history"] if e["event_type"] == "exclusion_removed")
    assert removed["before"] == {"reason": "test"}
    assert await _audit(db_session, "visit_request.include") == [{"exclude_reason": "test"}]


@pytest.mark.asyncio
async def test_reception_cannot_exclude(reception_yihua_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    response = await reception_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_other_campus_admin_does_not_see_the_case(minghua_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    response = await minghua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_other_needs_a_note_that_never_reaches_the_audit_log(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    missing = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other"})
    assert missing.status_code == 422
    assert ["body", "note"] in [error["loc"] for error in missing.json()["detail"]]
    ok = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "王小明家長打錯校區重送"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["exclude_note"] == "王小明家長打錯校區重送"
    assert await _audit(db_session, "visit_request.exclude") == [{"exclude_reason": "other"}]


@pytest.mark.asyncio
async def test_double_exclude_and_include_when_not_excluded_conflict(admin_client, db_session):
    case_id = await legacy_request(db_session, status="completed")
    not_yet = await admin_client.post(f"{CASES}/{case_id}/include")
    assert not_yet.status_code == 409 and not_yet.json()["detail"]["code"] == "NOT_EXCLUDED"
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate"})).status_code == 200
    again = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_EXCLUDED"


@pytest.mark.asyncio
async def test_list_hides_the_note_but_detail_shows_it(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled", parent_name="排除說明家長")
    await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate", "note": "同一位家長送了兩次"})
    rows = (await admin_client.get(f"{CASES}?q=排除說明家長")).json()
    assert [(r["exclude_reason"], r["exclude_note"]) for r in rows] == [("duplicate", None)]
    assert (await admin_client.get(f"{CASES}/{case_id}")).json()["exclude_note"] == "同一位家長送了兩次"


@pytest.mark.asyncio
async def test_anonymized_case_can_be_excluded_but_keeps_no_note(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    response = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "測試"})
    assert response.status_code == 200, response.text
    assert response.json()["exclude_reason"] == "other" and response.json()["exclude_note"] is None


@pytest.mark.asyncio
async def test_anonymize_clears_the_note_and_keeps_the_reason(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test", "note": "櫃台測試"})
    visit = await db_session.get(VisitRequest, uuid.UUID(case_id))
    assert await retention_service.anonymize(db_session, visit)
    await db_session.commit()
    await db_session.refresh(visit)
    assert (visit.exclude_reason, visit.exclude_note) == ("test", None)


@pytest.mark.asyncio
async def test_database_checks(db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    with pytest.raises(IntegrityError, match="ck_visit_requests_exclude_reason"):
        await db_session.execute(
            text("UPDATE visit_requests SET excluded_at = now(), exclude_reason = 'spam' WHERE id = :id"), {"id": case_id}
        )
    await db_session.rollback()
    with pytest.raises(IntegrityError, match="ck_visit_requests_excluded_pair"):
        await db_session.execute(text("UPDATE visit_requests SET excluded_at = now() WHERE id = :id"), {"id": case_id})
    await db_session.rollback()
```

（`campus_admin_yihua_client`、`reception_yihua_client` 是 `tests/admissions_helpers.py:60-72` 的 fixture，要照其他測試的寫法 import 進來；`minghua_client`、`admin_client` 在 conftest。）

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_visit_exclusion.py`
Expected: FAIL（404／欄位不存在）。

- [ ] **Step 3：migration**

`backend/migrations/versions/d4a8f2c6e913_visit_exclusion.py`：

```python
"""預約案件的「排除」標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md §3.1）

visit_requests 加 excluded_at、excluded_by（→ users，SET NULL）、exclude_reason（test／duplicate／other）、
exclude_note（≤200 字），兩條 CHECK：原因值、excluded_at 與原因同有同無。不加索引（排除筆數極少）。
不改既有資料，不需要先備份正式庫；上一版程式不讀這些欄位，先跑 migration 再換程式也相容。

Revision ID: d4a8f2c6e913
Revises: b7e3c1a9d5f2
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4a8f2c6e913"
down_revision = "b7e3c1a9d5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("excluded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "visit_requests",
        sa.Column(
            "excluded_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_requests_excluded_by_users"),
            nullable=True,
        ),
    )
    op.add_column("visit_requests", sa.Column("exclude_reason", sa.String(16), nullable=True))
    op.add_column("visit_requests", sa.Column("exclude_note", sa.String(200), nullable=True))
    op.create_check_constraint(
        "ck_visit_requests_exclude_reason",
        "visit_requests",
        "exclude_reason IS NULL OR exclude_reason IN ('test', 'duplicate', 'other')",
    )
    op.create_check_constraint(
        "ck_visit_requests_excluded_pair", "visit_requests", "(excluded_at IS NULL) = (exclude_reason IS NULL)"
    )


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_excluded_pair", "visit_requests", type_="check")
    op.drop_constraint("ck_visit_requests_exclude_reason", "visit_requests", type_="check")
    op.drop_column("visit_requests", "exclude_note")
    op.drop_column("visit_requests", "exclude_reason")
    op.drop_column("visit_requests", "excluded_by")
    op.drop_column("visit_requests", "excluded_at")
```

（`sa.Uuid()` 若和既有 migration 的 UUID 寫法不同，照 `grep -n "postgresql.UUID\|sa.Uuid" backend/migrations/versions/*.py | head -3` 的既有寫法改。）

Run: `MIGRATE`，再查 `alembic heads`。Expected：單一 head `d4a8f2c6e913`。

- [ ] **Step 4：model**

`__table_args__` 在 Task 2 加的 `ck_visit_requests_expected_start` 之後加：

```python
        # 2026-10-15 排除標記（app/booking/exclusion.py）：原因三選一，excluded_at 與原因同有同無。
        CheckConstraint(
            "exclude_reason IS NULL OR exclude_reason IN ('test', 'duplicate', 'other')",
            name="ck_visit_requests_exclude_reason",
        ),
        CheckConstraint("(excluded_at IS NULL) = (exclude_reason IS NULL)", name="ck_visit_requests_excluded_pair"),
```

`anonymized_at` 欄位之前加：

```python
    # 2026-10-15 排除標記（規格 docs/specs/2026-10-15-visit-exclusion-design.md）：測試或重複的案件標記後，
    # 不算進統計與待辦（套用位置見 app/booking/exclusion.py）；不改狀態、不釋出名額。
    excluded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    excluded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_requests_excluded_by_users"), nullable=True
    )
    exclude_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 說明（「其他」必填）；自由文字，保存政策匿名化時清掉（E11）。
    exclude_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
```

- [ ] **Step 5：`backend/app/booking/exclusion.py`**

```python
"""預約案件的「排除」標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md）。

測試或重複的案件由總管理者或校區管理者標記後，不算進下面這些數字（規格 §3.3 表「是」）：
- 營運總覽：今天參觀、待標記到場、追蹤到期、要處理（operations/dashboard_service.py）
- 參觀預約統計：預約結果、班別（operations/booking_outcomes_service.py）
- 預約全程（admissions/journey.py 的 load_cases）
- 場次使用情況（booking/slot_usage.py）
- 員工「即將參觀」與家長參觀提醒（notifications/reminders.py；寄出前再判斷）

刻意「不」套用（§3.3 表「否」）：
- 名額占用（slot_service.occupying_condition：送單容量、接待月曆、場次產生）——排除不釋出名額。
- 營運總覽「本週五校」的已約／可約——講的是名額；扣掉已約會和可約對不起來（使用者 10-16 確認，計畫 P10）。
- 案件列表、頁籤數字、CSV——改用 excluded 篩選（hide／only）。
- 停用分校的未結案件、切換預約方式前的確認數——營運安全檢查，看實際狀態。

之後新增讀 visit_requests 的統計，規格要寫明套不套 not_excluded()。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import history
from app.booking.history import Actor
from app.booking.models import VisitRequest

REASONS = ("test", "duplicate", "other")
NOTE_MAX = 200
_FIELDS = ["excluded_at", "excluded_by", "exclude_reason", "exclude_note", "anonymized_at"]


class AlreadyExcluded(Exception):
    """這筆案件已經排除了。"""


class NotExcluded(Exception):
    """這筆案件沒有排除。"""


def not_excluded():
    return VisitRequest.excluded_at.is_(None)


def is_excluded(visit_request) -> bool:
    return visit_request.excluded_at is not None


async def exclude(db: AsyncSession, visit_request: VisitRequest, *, reason: str, note: str | None, actor: Actor) -> None:
    """鎖住案件列再標記。已匿名化的案件可以排除，但不存說明（計畫裁定 P15）：保存政策已清過自由文字，
    之後不會再清，不能讓新的自由文字留在匿名化案件上。"""
    await db.refresh(visit_request, attribute_names=_FIELDS, with_for_update=True)
    if visit_request.excluded_at is not None:
        raise AlreadyExcluded()
    cleaned = None if visit_request.anonymized_at is not None else ((note or "").strip() or None)
    visit_request.excluded_at = datetime.now(timezone.utc)
    visit_request.excluded_by = actor.user_id
    visit_request.exclude_reason = reason
    visit_request.exclude_note = cleaned
    history.record_event(db, visit_request.id, "excluded", actor=actor, after={"reason": reason}, reason=cleaned)
    await db.flush()


async def include(db: AsyncSession, visit_request: VisitRequest, *, actor: Actor) -> str:
    """取消排除：四個欄位清空（E4），回傳原本的原因（操作紀錄用）。"""
    await db.refresh(visit_request, attribute_names=_FIELDS, with_for_update=True)
    if visit_request.excluded_at is None:
        raise NotExcluded()
    previous = visit_request.exclude_reason or ""
    visit_request.excluded_at = None
    visit_request.excluded_by = None
    visit_request.exclude_reason = None
    visit_request.exclude_note = None
    history.record_event(db, visit_request.id, "exclusion_removed", actor=actor, before={"reason": previous})
    await db.flush()
    return previous
```

- [ ] **Step 6：schema**

`backend/app/booking/schemas.py`（`VisitRequestCancelRequest` 附近）：

```python
VisitExcludeReason = Literal["test", "duplicate", "other"]


class VisitRequestExcludeRequest(BaseModel):
    """標記為排除（2026-10-15 規格 E3）：原因三選一；「其他」要寫說明（≤200 字）。"""

    model_config = {"extra": "forbid"}

    reason: VisitExcludeReason
    # validate_default：沒帶說明時也要跑下面的檢查，「其他」才擋得到；422 指到 note（計畫裁定 P16）。
    note: str | None = Field(default=None, max_length=200, validate_default=True)

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None, info: ValidationInfo) -> str | None:
        value = _reject_control_chars(value)
        cleaned = value.strip() if isinstance(value, str) else None
        if info.data.get("reason") == "other" and not cleaned:
            raise ValueError("選「其他」要寫說明")
        return cleaned or None
```

`VisitRequestDetailOut` 在 `expected_start` 之後加：

```python
    # 排除標記（2026-10-15）：測試或重複的案件；列表不回說明（計畫裁定 P12）。
    excluded_at: datetime | None = None
    exclude_reason: str | None = None
    exclude_note: str | None = None
```

- [ ] **Step 7：路由**

`backend/app/booking/routes.py`：`from app.booking import (…)` 清單加 `exclusion`；schemas import 加 `VisitRequestExcludeRequest`。在 `mark_no_show`（:1539）之前加：

```python
@router.post("/admin/visit-requests/{visit_request_id}/exclude", response_model=VisitRequestDetailOut)
async def exclude_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestExcludeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """標記為排除（2026-10-15 規格 §3.2）：booking.manage＋校區範圍。不改狀態、不釋出名額；
    操作紀錄只記原因類別（說明可能有人名）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        await exclusion.exclude(
            db, visit_request, reason=payload.reason, note=payload.note, actor=Actor.staff(current_user.id)
        )
    except exclusion.AlreadyExcluded as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "ALREADY_EXCLUDED", "message": "這筆案件已經排除了"}
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.exclude",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"exclude_reason": payload.reason},
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/include", response_model=VisitRequestDetailOut)
async def include_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """取消排除，回到原本的統計（規格 E4）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        previous = await exclusion.include(db, visit_request, actor=Actor.staff(current_user.id))
    except exclusion.NotExcluded as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "NOT_EXCLUDED", "message": "這筆案件沒有排除"}
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.include",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"exclude_reason": previous},
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)
```

列表（:1029）改成：

```python
    # 排除的說明只在明細回（計畫裁定 P12）。
    return [
        VisitRequestDetailOut.model_validate(r).model_copy(update={"visited_on": day, "exclude_note": None})
        for r, day in result.all()
    ]
```

- [ ] **Step 8：保存政策**

`backend/app/operations/retention_service.py` 的 `anonymize`：`visit_request.questions = None` 之後加：

```python
    # 排除的說明（2026-10-15）是人員寫的自由文字；原因類別保留（規格 E11）。
    visit_request.exclude_note = None
```

同檔的補清（:270-285）在 `or_(...)` 裡加 `VisitRequest.exclude_note.is_not(None),`，`.values(...)` 加 `exclude_note=None`。

- [ ] **Step 9：跑測試確認通過**

Run: `PYTEST tests/test_visit_exclusion.py tests/test_retention_policy.py tests/test_retention_races.py tests/test_visit_status_constraints.py`
Expected: PASS。（admin 的 `labelCoverage.test.ts` 掃得到這裡新加的 `log_action`，在 Task 9 補中文之前會紅；本 task 不跑 admin 測試，交接時寫明。）

- [ ] **Step 10：契約與 Commit**

Run: `CONTRACT_REGEN`，再 `CONTRACT_CHECK`。

```bash
git add backend/migrations/versions/d4a8f2c6e913_visit_exclusion.py backend/app/booking/models.py backend/app/booking/exclusion.py backend/app/booking/schemas.py backend/app/booking/routes.py backend/app/operations/retention_service.py backend/tests/test_visit_exclusion.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(booking): 預約案件可標記排除（測試／重複）與取消排除

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8：把排除套進統計、待辦與提醒（§3.3 每一處）

**Files:**
- Modify: `backend/app/operations/dashboard_service.py:6-16`（import）、`:53-109`（四個數字）
- Modify: `backend/app/operations/booking_outcomes_service.py`（`_empty_counts`、`_add_into`、`booking_outcomes`、`class_distribution`）
- Modify: `backend/app/operations/routes.py:300-322`（`OutcomeCountsOut`）、`:409-423`（`ClassDistributionOut`）
- Modify: `backend/app/admissions/journey.py:101-103`（`compute_journey` 簽名）、`:192-196`（coverage）、`:231-270`（`load_cases`）、`:321-330`（`query_journey`）
- Modify: `backend/app/admissions/schemas.py:1391-1394`（`JourneyCoverageOut`）
- Modify: `backend/app/booking/slot_usage.py:34-90`、`backend/app/booking/schemas.py:983-988`（`SlotUsageSlotsOut`）
- Modify: `backend/app/notifications/reminders.py:101-116`（掃描）、`:139-162`（`still_applies`）
- 條件：`backend/app/notifications/service.py`（家長提醒的寄出前判斷，只在 Task 0 Step 3 有找到 `parent_visit_reminder` 時）
- Test: Create `backend/tests/test_visit_exclusion_scope.py`
- Modify（重新產生）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 7）：`exclusion.not_excluded()`；`VisitRequest.excluded_at`。
- Produces：`OutcomeCountsOut.excluded_cases: int`（每校與合計）、`ClassDistributionOut.excluded_cases: int`、`JourneyCoverageOut.excluded_cases: int`、`SlotUsageSlotsOut.excluded_cases: int`（Task 10 的畫面讀這四個）；`journey.load_cases` 改回傳三個值 `(cases, undated, excluded_cases)`；`compute_journey(..., excluded_cases: int = 0)`。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_visit_exclusion_scope.py`：

```python
"""排除標記套用的每一處（2026-10-15 規格 §3.3；計畫裁定 P8–P11、P14）：「是」的地方只算一筆，「否」的地方兩筆都在。
每個測試建一筆一般案件與一筆排除案件。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import journey
from app.booking import readiness, slot_usage
from app.booking.models import BookingConfig, OutboxMessage, VisitRequest, VisitSlot
from app.common.timezones import slot_start_utc, today_local
from app.notifications import reminders
from tests.analytics_fixtures import add_case, add_slot
from tests.conftest import create_slot, legacy_request, set_booking_mode

API = "/api/website/v1"


async def _exclude(db, case_id) -> None:
    await db.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(str(case_id)))
        .values(excluded_at=datetime.now(timezone.utc), exclude_reason="test")
    )
    await db.commit()


async def _slot(db, *, day: date, start: time = time(10, 0), capacity: int = 5, closed: bool = False,
                closed_source: str | None = None) -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key="yihua", slot_date=day, start_time=start, end_time=time(start.hour + 1, 0),
        capacity=capacity, closed=closed, closed_source=closed_source, created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.commit()
    return slot.id


async def _dashboard(client) -> dict:
    response = await client.get(f"{API}/admin/dashboard")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_dashboard_counts_skip_excluded_cases(admin_client, db_session):
    today_slot = await create_slot(admin_client, days_ahead=0, start_time="23:00:00", end_time="23:30:00", capacity=3)
    keep = await legacy_request(db_session, status="confirmed", slot_id=today_slot, parent_name="今天留著", phone="0912000101")
    drop = await legacy_request(db_session, status="confirmed", slot_id=today_slot, parent_name="今天排除", phone="0912000102")
    past = await _slot(db_session, day=today_local() - timedelta(days=1))
    await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000103")
    past_drop = await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000104")
    closed = await _slot(db_session, day=today_local() + timedelta(days=3), closed=True, closed_source="exception")
    await legacy_request(db_session, status="confirmed", slot_id=closed, phone="0912000105")
    closed_drop = await legacy_request(db_session, status="confirmed", slot_id=closed, phone="0912000106")
    due = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.execute(update(VisitRequest).where(VisitRequest.id.in_([uuid.UUID(keep), uuid.UUID(drop)])).values(follow_up_at=due))
    await db_session.commit()
    for case_id in (drop, past_drop, closed_drop):
        await _exclude(db_session, case_id)

    summary = await _dashboard(admin_client)
    assert [row["parent_name"] for row in summary["today_visit_list"]] == ["今天留著"]
    assert summary["awaiting_attendance"] == 1
    assert summary["pending_follow_up"] == 1
    assert summary["needs_attention"] == 1


@pytest.mark.asyncio
async def test_include_restores_the_counts(admin_client, db_session):
    past = await _slot(db_session, day=today_local() - timedelta(days=1))
    case_id = await legacy_request(db_session, status="confirmed", slot_id=past)
    await _exclude(db_session, case_id)
    assert (await _dashboard(admin_client))["awaiting_attendance"] == 0
    assert (await admin_client.post(f"{API}/admin/visit-requests/{case_id}/include")).status_code == 200
    assert (await _dashboard(admin_client))["awaiting_attendance"] == 1


@pytest.mark.asyncio
async def test_week_campuses_still_count_excluded_cases(admin_client, db_session):
    """計畫裁定 P10（排除規格 §3.3「本週五校」，使用者 10-16 確認）：已約／可約講的是名額，排除不扣。"""
    slot_id = await create_slot(admin_client, days_ahead=1, capacity=3)
    assert (await set_booking_mode(admin_client, "yihua", mode="slots")).status_code == 200
    await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000111")
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000112"))
    row = next(r for r in (await _dashboard(admin_client))["week_campuses"] if r["campus_key"] == "yihua")
    assert (row["booked"], row["open"]) == (2, 1)


@pytest.mark.asyncio
async def test_booking_outcomes_and_class_distribution_skip_excluded(admin_client, db_session):
    await add_case(db_session, status="cancelled", child_birthdate=date(2023, 3, 2))
    await _exclude(db_session, await add_case(db_session, status="cancelled", child_birthdate=date(2023, 3, 2)))
    await db_session.commit()
    outcomes = (await admin_client.get(f"{API}/admin/analytics/booking-outcomes")).json()
    yihua = next(r for r in outcomes["campuses"] if r["campus_key"] == "yihua")
    assert (yihua["cases"], yihua["excluded_cases"]) == (1, 1)
    assert (outcomes["totals"]["cases"], outcomes["totals"]["excluded_cases"]) == (1, 1)
    classes = (await admin_client.get(f"{API}/admin/analytics/class-distribution?campus_key=yihua&school_year=115")).json()
    assert (classes["total"], classes["excluded_cases"]) == (1, 1)


@pytest.mark.asyncio
async def test_open_now_in_booking_outcomes_skips_excluded(admin_client, db_session):
    past = await add_slot(db_session, days_from_today=-1)
    await add_case(db_session, status="confirmed", slot_id=past)
    await _exclude(db_session, await add_case(db_session, status="confirmed", slot_id=past))
    await db_session.commit()
    outcomes = (await admin_client.get(f"{API}/admin/analytics/booking-outcomes")).json()
    assert outcomes["open_now_totals"]["awaiting_attendance"] == 1


@pytest.mark.asyncio
async def test_journey_skips_excluded_and_reports_the_count(db_session):
    past = await _slot(db_session, day=today_local() - timedelta(days=3))
    await legacy_request(db_session, status="completed", slot_id=past, phone="0912000121")
    await _exclude(db_session, await legacy_request(db_session, status="completed", slot_id=past, phone="0912000122"))
    result = await journey.query_journey(db_session, "yihua", today_local() - timedelta(days=30), today_local(), "all")
    assert result["cases"]["total"] == 1
    assert result["coverage"]["excluded_cases"] == 1


@pytest.mark.asyncio
async def test_slot_usage_skips_excluded_and_reports_the_count(db_session):
    day = today_local() - timedelta(weeks=2)
    slot_id = await _slot(db_session, day=day, capacity=5)
    await legacy_request(db_session, status="completed", slot_id=slot_id, phone="0912000131")
    await _exclude(db_session, await legacy_request(db_session, status="completed", slot_id=slot_id, phone="0912000132"))
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today_local())
    [row] = out["rows"]
    assert row["booked"] == 1
    assert out["excluded_cases"] == 1


@pytest.mark.asyncio
async def test_excluding_does_not_release_the_seat(admin_client, public_client, db_session):
    """Review Focus 5：排除不釋出名額（E6），公開剩餘名額不變。"""
    slot_id = await create_slot(admin_client, days_ahead=3, capacity=1)
    assert (await set_booking_mode(admin_client, "yihua", mode="slots")).status_code == 200
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id))
    day = (today_local() + timedelta(days=3)).isoformat()
    slots = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={day}&date_to={day}")).json()
    # 公開場次不列額滿的場次（routes.py list_public_slots：remaining <= 0 就略過）：排除後仍額滿，所以還是不列。
    assert slot_id not in [s["id"] for s in slots]


@pytest.mark.asyncio
async def test_staff_reminder_skips_excluded_cases(db_session):
    tomorrow = today_local() + timedelta(days=1)
    slot_id = await _slot(db_session, day=tomorrow, start=time(10, 0))
    keep = await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000141")
    drop = await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000142")
    # legacy_request 的確認時間是現在；提醒時間點要晚於確認時間才會排（reminders.py:123-125）。
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id.in_([uuid.UUID(keep), uuid.UUID(drop)]))
        .values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=3))
    )
    await db_session.commit()
    await _exclude(db_session, drop)
    now = slot_start_utc(tomorrow, time(10, 0)) - timedelta(hours=23)
    await reminders.enqueue_due_reminders(db_session, now=now)
    await db_session.commit()
    rows = (await db_session.execute(select(OutboxMessage.visit_request_id).where(OutboxMessage.kind == reminders.UPCOMING_VISIT_KIND))).scalars().all()
    assert [str(r) for r in rows] == [keep]
    # 排入之後才排除的：寄出前 skipped。
    await _exclude(db_session, keep)
    payload = {"campus_key": "yihua", "receipt_id": keep, "slot_id": str(slot_id)}
    assert await reminders.still_applies(db_session, reminders.UPCOMING_VISIT_KIND, payload, now) is False


@pytest.mark.asyncio
async def test_operational_checks_still_count_excluded_cases(admin_client, db_session):
    """計畫裁定 P14：切換預約方式前的確認數、停用分校的未結案件看實際狀態，不扣排除。"""
    slot_id = await create_slot(admin_client, days_ahead=2, capacity=3)
    await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000151")
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000152"))
    config = await db_session.get(BookingConfig, "yihua")
    impact = await readiness.impact(db_session, "yihua", config)
    assert impact["open_requests"] == 2
    deactivated = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False, "reason": "測試"})
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["open_requests"] == 2
```

（`test_excluding_does_not_release_the_seat` 釘的是「排除不碰 `occupying_condition`」：哪天有人把 `not_excluded()` 加進名額占用，這一場會重新出現在公開清單，這條就會紅。）

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_visit_exclusion_scope.py`
Expected: FAIL（`excluded_cases` 不存在、數字多算一筆）；`test_week_campuses_still_count_excluded_cases`、`test_excluding_does_not_release_the_seat`、`test_operational_checks_still_count_excluded_cases` 這三條現在就會過（釘住「否」）。

- [ ] **Step 3：營運總覽**

`dashboard_service.py` 的 import 改成 `from app.booking import exclusion, pending_kinds, slot_service`。四個查詢各加條件：

```python
        .where(
            VisitRequest.status.in_(_TODAY_STATUSES),
            # slot_date 是 naive 的日期欄位，直接跟營運時區的今天比對。
            VisitSlot.slot_date == today,
            # 排除的測試／重複案件不列（2026-10-15 規格 §3.3）。
            exclusion.not_excluded(),
        )
```

```python
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("awaiting_attendance", now), exclusion.not_excluded()),
```

```python
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("follow_up_due", now), exclusion.not_excluded()),
```

```python
        select(func.count()).select_from(VisitRequest).where(needs_attention_condition(now), exclusion.not_excluded()),
```

- [ ] **Step 4：參觀預約統計**

`booking_outcomes_service.py`：import 加 `from app.booking import exclusion`（和 `pending_kinds` 同一行）。

```python
def _empty_counts() -> dict:
    return {
        "cases": 0,
        "web_cases": 0,
        # 期間內送出、已排除的測試／重複案件（2026-10-15），不在 cases 裡。
        "excluded_cases": 0,
        **{outcome: 0 for outcome in OUTCOMES},
        "cancelled_by_reason": {reason: 0 for reason in CANCEL_REASON_KEYS},
    }
```

`_add_into` 的 tuple 改成 `("cases", "web_cases", "excluded_cases", *OUTCOMES)`。

`booking_outcomes`：`per_case` 的 `.where(...)` 加 `exclusion.not_excluded()`；`open_rows` 的 `.where(VisitRequest.campus_key.in_(campus_keys))` 改成 `.where(VisitRequest.campus_key.in_(campus_keys), exclusion.not_excluded())`。在 `counts` 迴圈之後加：

```python
    excluded_rows = (
        await db.execute(
            select(VisitRequest.campus_key, func.count())
            .where(
                VisitRequest.campus_key.in_(campus_keys),
                *period.on(VisitRequest.created_at),
                VisitRequest.excluded_at.is_not(None),
            )
            .group_by(VisitRequest.campus_key)
        )
    ).all()
    for campus_key, count in excluded_rows:
        counts[campus_key]["excluded_cases"] = count
```

`class_distribution`：查詢的 `.where(...)` 加 `exclusion.not_excluded()`；回傳前加：

```python
    excluded_cases = await db.scalar(
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.campus_key == campus_key, *period.on(VisitRequest.created_at), VisitRequest.excluded_at.is_not(None))
    )
```

並在回傳的 dict 加 `"excluded_cases": int(excluded_cases or 0),`。

`operations/routes.py`：`OutcomeCountsOut` 的 `web_cases` 之後加：

```python
    # 期間內送出、已標記排除的測試／重複案件（2026-10-15）；不在 cases 與各結果裡。
    excluded_cases: int = 0
```

`ClassDistributionOut` 的 `unrecorded` 之後加同樣的 `excluded_cases: int = 0`（註解「已排除的測試／重複案件，不在 total 裡」）。

- [ ] **Step 5：預約全程與場次使用情況**

`journey.py` `load_cases`：`select(...)` 多帶一欄 `VisitRequest.excluded_at.is_not(None).label("excluded"),`；回傳型別改 `tuple[list[CaseInfo], int, int]`；`rows = …all()` 之後：

```python
    # 排除的測試／重複案件（2026-10-15）不進批次，另回筆數給涵蓋說明（計畫裁定 P11：和各段天數的 excluded 不同）。
    excluded_cases = sum(1 for row in rows if row.excluded and row.visited_on is not None and row.outcome != "upcoming")
    rows = [row for row in rows if not row.excluded]
```

最後 `return cases, undated, excluded_cases`。先 `grep -rn "load_cases(" backend` 確認只有 `query_journey` 呼叫；有別處就一起改。

`compute_journey` 簽名加 `excluded_cases: int = 0`（關鍵字），coverage 加：

```python
            # 標記排除的測試／重複案件（不是各段天數裡「不納入」的 excluded）。
            "excluded_cases": excluded_cases,
```

`query_journey`：`cases, undated, excluded_cases = await load_cases(...)`，呼叫 `compute_journey(..., excluded_cases=excluded_cases)`。

`admissions/schemas.py` 的 `JourneyCoverageOut` 加 `excluded_cases: int = 0`。

`slot_usage.py`：import 加 `exclusion`；`booked` 子查詢 `.where(slot_service.occupying_condition(), exclusion.not_excluded())`；在 `result = await db.execute(...)` 之前加：

```python
    # 排除的測試／重複案件不算家長需求（2026-10-15）；另回筆數給說明。名額占用本身不變（送單容量照算）。
    excluded_cases = await db.scalar(
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            slot_service.occupying_condition(),
            VisitRequest.excluded_at.is_not(None),
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= date_from,
            VisitSlot.slot_date <= date_to,
            VisitSlot.closed.is_(False),
        )
    )
```

回傳 dict 加 `"excluded_cases": int(excluded_cases or 0),`；`booking/schemas.py` 的 `SlotUsageSlotsOut` 加 `excluded_cases: int = 0`。模組 docstring 的「已約＝…」補「排除的測試／重複案件不算」。

- [ ] **Step 6：本週五校（P10，集中在這一步）**

**不改** `dashboard_service._week_campuses`。在它的 docstring（沒有就加一行註解在函式開頭）寫：

```python
    # 已約／可約講的是名額：排除不釋出名額，所以不扣排除的案件（2026-10-15 排除規格 §3.3，計畫裁定 P10）。
```

使用者若決定「本週五校也要扣」：在 `booked_sub` 的 `.where(...)` 加 `exclusion.not_excluded()`，並把 `test_week_campuses_still_count_excluded_cases` 的期望改成 `(1, 1)`（已約 1、可約仍以實際占用算 1——此時兩數相加不等於容量，要在總覽的說明補一句）。

- [ ] **Step 7：員工提醒**

`reminders.py` 掃描的 `.where(...)` 加 `VisitRequest.excluded_at.is_(None),`（註解「排除的測試／重複案件不提醒（2026-10-15 規格 E8）」）。`still_applies` 在 `if visit is None or visit.anonymized_at is not None: return False` 之後加：

```python
    # 排入之後才被標記排除的：不寄（2026-10-15 規格 E8）。
    if visit.excluded_at is not None:
        return False
```

- [ ] **Step 8：家長參觀提醒（只在 Task 0 Step 3 有找到 `parent_visit_reminder` 時做）**

若第 1 波已在 main：掃描已由 Step 7 的條件涵蓋（兩種提醒同一次掃描）；寄出前的判斷在 `notifications/service.py` 處理家長信的函式（`grep -n "PARENT_VISIT_REMINDER" backend/app/notifications/service.py` 找到判斷場次是否已變、是否停課的那段），在那段加：

```python
        # 排除的測試／重複案件不寄參觀提醒（2026-10-15 排除規格 E8）。
        if kind == PARENT_VISIT_REMINDER and visit_request.excluded_at is not None:
            return False
```

並在 `test_visit_exclusion_scope.py` 加一條：排除案件不排 `parent_visit_reminder`、排入後才排除的寄出時 skipped（寫法照第 1 波的 `backend/tests/test_parent_visit_reminder.py`）。若沒找到：跳過這一步，在交付報告寫「家長提醒的排除條件交給提醒信那案補（其規格 §6）」。

- [ ] **Step 9：跑測試確認通過**

Run: `PYTEST tests/test_visit_exclusion_scope.py tests/test_dashboard_today_board.py tests/test_analytics_booking_outcomes.py tests/test_admissions_journey.py tests/test_admissions_journey_calc.py tests/test_slot_usage.py tests/test_notification_retry_reminders.py tests/test_booking_consent_readiness.py`
Expected: PASS。

- [ ] **Step 10：契約與 Commit**

Run: `CONTRACT_REGEN`，再 `CONTRACT_CHECK`。

```bash
git add backend/app/operations/dashboard_service.py backend/app/operations/booking_outcomes_service.py backend/app/operations/routes.py backend/app/admissions/journey.py backend/app/admissions/schemas.py backend/app/booking/slot_usage.py backend/app/booking/schemas.py backend/app/notifications/reminders.py backend/tests/test_visit_exclusion_scope.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(booking): 排除的案件不算進總覽、參觀預約統計、預約全程、場次使用情況與提醒

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（Step 8 有做時，`git add` 加上 `backend/app/notifications/service.py`。）

---

### Task 9：列表篩選、CSV、列表標籤與總覽連結

**Files:**
- Modify: `backend/app/booking/routes.py:908-1003`（`VisitRequestFilters`：參數、`apply`、`audit_metadata`）、`_export_row`
- Modify: `backend/app/booking/export_labels.py`（欄名、原因中文）
- Modify: `admin/src/api/visitListQuery.ts`、`admin/src/views/VisitRequestsView.vue`、`admin/src/components/visit/VisitListRow.vue`、`admin/src/views/DashboardView.vue:315,481,485`、`admin/src/api/analytics.ts:70-79`、`admin/src/api/labels.ts`（原因中文）
- Test: Modify `backend/tests/test_visit_exclusion.py`（加列表與 CSV）、`backend/tests/test_visit_attention_export.py`（欄名）；Modify `admin/src/__tests__/visitListQuery.test.ts`、`shellDashboard20261002.test.ts:127`、`followUpUx.test.ts:55`、`analyticsHelpers.test.ts:25`

**Interfaces:**
- Consumes（Task 7、8）：`VisitRequestDetailOut.exclude_reason`；總覽數字已排除；Task 7 的操作紀錄動作 `visit_request.exclude`／`include` 與 metadata 鍵 `exclude_reason`。
- Produces：列表與匯出參數 `excluded=hide|only`；CSV 最後一欄「已排除」；`ListState.hideExcluded`（網址 `excluded=hide`）；`VISIT_EXCLUDE_REASON_LABELS`、操作紀錄兩個動作與 `exclude_reason`／`excluded` 的中文（Task 10 也用）。

- [ ] **Step 1：寫失敗的測試（後端）**

`backend/tests/test_visit_exclusion.py` 加：

```python
@pytest.mark.asyncio
async def test_list_and_export_filters(admin_client, db_session):
    keep = await legacy_request(db_session, status="cancelled", parent_name="篩選留著", phone="0912000201")
    drop = await legacy_request(db_session, status="cancelled", parent_name="篩選排除", phone="0912000202")
    await admin_client.post(f"{CASES}/{drop}/exclude", json={"reason": "duplicate"})
    names = lambda rows: sorted(r["parent_name"] for r in rows)  # noqa: E731
    assert names((await admin_client.get(f"{CASES}?q=篩選")).json()) == ["篩選排除", "篩選留著"]
    assert names((await admin_client.get(f"{CASES}?q=篩選&excluded=hide")).json()) == ["篩選留著"]
    assert names((await admin_client.get(f"{CASES}?q=篩選&excluded=only")).json()) == ["篩選排除"]
    assert (await admin_client.get(f"{CASES}?excluded=nope")).status_code == 422
    export = await admin_client.get(f"{CASES}/export?campus_key=yihua&q=篩選")
    rows = list(csv.DictReader(io.StringIO(export.content.decode("utf-8-sig"))))
    assert sorted((r["家長"], r["已排除"]) for r in rows) == [("篩選排除", "重複"), ("篩選留著", "")]
    assert keep


@pytest.mark.asyncio
async def test_hide_filter_matches_dashboard_counts(admin_client, db_session):
    """總覽數字已排除；總覽連結帶 excluded=hide，點進去是同一批（計畫裁定 P8）。"""
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key="yihua", slot_date=today_local() - timedelta(days=1), start_time=time(10, 0),
        end_time=time(11, 0), capacity=5, closed=False, created_at=datetime.now(timezone.utc),
    )
    db_session.add(slot)
    await db_session.commit()
    past = slot.id
    await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000211")
    drop = await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000212")
    await admin_client.post(f"{CASES}/{drop}/exclude", json={"reason": "test"})
    count = (await admin_client.get(f"{API}/admin/dashboard")).json()["awaiting_attendance"]
    listed = (await admin_client.get(f"{CASES}?view=past&status=confirmed&excluded=hide")).json()
    assert count == len(listed) == 1
```

檔頭 import 加 `import csv`、`import io`，`from datetime import …` 改成 `from datetime import datetime, time, timedelta, timezone`，`from app.booking.models import VisitRequest` 改成 `from app.booking.models import VisitRequest, VisitSlot`，並加 `from app.common.timezones import today_local`。`backend/tests/test_visit_attention_export.py` 的欄名清單最後（`"結束",` 之後）加 `"已排除",`。

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_visit_exclusion.py tests/test_visit_attention_export.py`
Expected: FAIL（`excluded` 參數被忽略、CSV 沒有「已排除」）。

- [ ] **Step 3：後端篩選與 CSV**

`VisitRequestFilters.__init__` 參數最後加：

```python
        excluded: str | None = Query(
            default=None,
            pattern="^(hide|only)$",
            description="排除標記：hide 隱藏已排除的測試／重複案件、only 只看已排除；不帶＝全部（2026-10-15）",
        ),
```

並存 `self.excluded = excluded`。`apply` 在 `if self.view:` 之後加：

```python
        if self.excluded == "hide":
            stmt = stmt.where(exclusion.not_excluded())
        elif self.excluded == "only":
            stmt = stmt.where(VisitRequest.excluded_at.is_not(None))
```

`audit_metadata` 的 `applied` 加 `"excluded": self.excluded,`。

`export_labels.py`：`EXPORT_HEADERS` 最後加 `"已排除",`；加：

```python
# 排除標記的原因（2026-10-15）；後台 admin/src/api/labels.ts 的 VISIT_EXCLUDE_REASON_LABELS 同一組字。
EXCLUDE_REASON_LABELS = {"test": "測試", "duplicate": "重複", "other": "其他"}


def exclude_label(reason: str | None) -> str:
    return EXCLUDE_REASON_LABELS.get(reason, reason) if reason else ""
```

`routes.py` `_export_row` 最後（`r.slot.end_time…` 之後）加：

```python
        export_labels.exclude_label(r.exclude_reason),
```

Run: `PYTEST tests/test_visit_exclusion.py tests/test_visit_attention_export.py tests/test_booking_consent_readiness.py`
Expected: PASS。

- [ ] **Step 4：寫失敗的測試（後台）**

`admin/src/__tests__/visitListQuery.test.ts` 加：

```ts
describe('隱藏已排除（2026-10-15）', () => {
  const scope = { campusKeys: ['yihua'], multiCampus: false }
  it('網址 excluded=hide 讀回、寫回，清單與件數都帶 excluded=hide', () => {
    const state = parseListQuery({ group: 'past', status: 'confirmed', excluded: 'hide' }, scope)
    expect(state.hideExcluded).toBe(true)
    expect(listStateQuery(state)).toMatchObject({ excluded: 'hide', group: 'past', status: 'confirmed' })
    expect(listApiParams(state).get('excluded')).toBe('hide')
    expect(listApiParams(state, { counts: true }).get('excluded')).toBe('hide')
  })
  it('預設不隱藏、網址不寫', () => {
    const state = parseListQuery({}, scope)
    expect(state.hideExcluded).toBe(false)
    expect(listStateQuery(state).excluded).toBeUndefined()
  })
})
```

（檔頭已 import `parseListQuery`、`listStateQuery`、`listApiParams` 的話沿用；沒有就補。）

`shellDashboard20261002.test.ts:127` 期望改成 `'/visit-requests?group=past&status=confirmed&excluded=hide'`；`followUpUx.test.ts:55` 改成 `'/visit-requests?due=1&excluded=hide'`；`analyticsHelpers.test.ts:25` 改成 `'/visit-requests?campus=yihua&group=past&status=confirmed&excluded=hide'`（同檔其他 `pendingLink` 期望也補 `&excluded=hide`）。

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/visitListQuery.test.ts src/__tests__/shellDashboard20261002.test.ts src/__tests__/followUpUx.test.ts src/__tests__/analyticsHelpers.test.ts`
Expected: FAIL。

- [ ] **Step 5：後台實作**

`admin/src/api/visitListQuery.ts`：`ListState` 加：

```ts
  /** 隱藏已排除的測試／重複案件（網址 excluded=hide；總覽與統計的連結會帶，2026-10-15） */
  hideExcluded: boolean
```

`parseListQuery` 回傳加 `hideExcluded: query.excluded === 'hide',`；`listStateQuery` 在 `if (s.attention) …` 之後加 `if (s.hideExcluded) query.excluded = 'hide'`；`listApiParams` 在 `needs_attention` 之後加 `if (s.hideExcluded) params.set('excluded', 'hide')`。

`admin/src/api/labels.ts`（`VISIT_DETAIL_FIELD_LABELS` 附近）：

```ts
// 預約案件的排除原因（2026-10-15）；後端 booking/export_labels.py 的 EXCLUDE_REASON_LABELS 同一組字。
export const VISIT_EXCLUDE_REASON_LABELS: Record<string, string> = { test: '測試', duplicate: '重複', other: '其他' }
```

同檔 `AUDIT_ACTION_LABELS`（:414 起，`'visit_request.update_details'` 附近）加 Task 7 新增的兩個動作，`AUDIT_METADATA_FORMATTERS` 加 Task 7 的 `exclude_reason` 與這裡的匯出篩選 `excluded`（`labelCoverage.test.ts` 掃得到 Task 7 的 `log_action`，不補會紅）：

```ts
  'visit_request.exclude': '標記為排除',
  'visit_request.include': '取消排除',
```

```ts
  // 預約案件排除（2026-10-15）：只記原因類別，說明不進操作紀錄（計畫裁定 P6）。
  exclude_reason: (v) => (v ? `排除原因：${VISIT_EXCLUDE_REASON_LABELS[String(v)] ?? String(v)}` : null),
  // 案件匯出的「排除」篩選（2026-10-15）。
  excluded: (v) => (v === 'hide' ? '隱藏已排除' : v === 'only' ? '只看已排除' : null),
```

（`VISIT_EXCLUDE_REASON_LABELS` 要宣告在 `AUDIT_METADATA_FORMATTERS`（:1268）之前。）

`VisitRequestsView.vue`：
- 加 `const hideExcluded = ref(false)`（`attentionOnly` 附近，註解「隱藏已排除的測試／重複案件（2026-10-15）」）。
- `listState` 加 `hideExcluded: hideExcluded.value,`；`applyQuery` 加 `hideExcluded.value = next.hideExcluded`。
- `hasFilters` 加 `|| hideExcluded.value`；`clearFilters` 加 `hideExcluded.value = false`；`hiddenFilters` 加 `if (hideExcluded.value) list.push({ key: 'excluded', label: '隱藏已排除', clear: () => { hideExcluded.value = false } })`。
- 重讀的 `watch([...])`（:295）陣列加 `hideExcluded`。
- 篩選列在「只看未結案」那個 checkbox（:605）之後加 `<el-checkbox v-model="hideExcluded" class="filter-due">隱藏已排除</el-checkbox>`。

`VisitListRow.vue`：import `VISIT_EXCLUDE_REASON_LABELS`；在 `visit-row__who` 裡、`row.follow_up_at` 那一行之前加：

```html
          <span v-if="row.excluded_at" class="visit-row__excluded">已排除・{{ VISIT_EXCLUDE_REASON_LABELS[row.exclude_reason ?? ''] ?? '其他' }}</span>
```

並在 `<style scoped>` 加：

```css
.visit-row__excluded { align-self: flex-start; padding: 0 6px; border-radius: 4px; font-size: var(--fs-xs); color: var(--muted); background: var(--surface-muted); }
```

（token 名稱照 `VisitListRow.vue` 既有規則用的；`grep -n "var(--" admin/src/components/visit/VisitListRow.vue | head` 找灰底與次要文字的 token，不寫色碼。）

`DashboardView.vue`：:315 改 `'/visit-requests?due=1&excluded=hide'`；:481 的 `to="/visit-requests?due=1"` 改 `to="/visit-requests?due=1&excluded=hide"`；:485 的 `to="/visit-requests?group=past&status=confirmed"` 改 `to="/visit-requests?group=past&status=confirmed&excluded=hide"`；:314 與 :477 的 `attentionListPath()` 改成 `` `${attentionListPath()}&excluded=hide` ``（`attentionListPath` 本身不改：分校停用卡片也用它，那裡看實際狀態）。

`admin/src/api/analytics.ts` `pendingLink`：`return` 之前加 `query.set('excluded', 'hide')`（統計的「現在待處理」數字也已排除，計畫裁定 P8）。

- [ ] **Step 6：跑測試確認通過**

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/visitListQuery.test.ts src/__tests__/shellDashboard20261002.test.ts src/__tests__/followUpUx.test.ts src/__tests__/analyticsHelpers.test.ts src/__tests__/visitScheduleList.test.ts src/__tests__/ux20261005.test.ts src/__tests__/labelCoverage.test.ts; npm run typecheck`
Expected: PASS（`labelCoverage.test.ts` 會掃 `audit_metadata` 的 `applied = {…}`，新鍵 `excluded` 要有 Step 5 加的中文寫法）。

- [ ] **Step 7：Commit**

```bash
git add backend/app/booking/routes.py backend/app/booking/export_labels.py backend/tests/test_visit_exclusion.py backend/tests/test_visit_attention_export.py admin/src/api/visitListQuery.ts admin/src/api/labels.ts admin/src/api/analytics.ts admin/src/views/VisitRequestsView.vue admin/src/components/visit/VisitListRow.vue admin/src/views/DashboardView.vue admin/src/__tests__/visitListQuery.test.ts admin/src/__tests__/shellDashboard20261002.test.ts admin/src/__tests__/followUpUx.test.ts admin/src/__tests__/analyticsHelpers.test.ts
git commit -m "feat(admin): 案件列表可隱藏已排除、CSV 加已排除欄，總覽與統計連結帶同一個篩選

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10：明細頁的排除入口與橫幅、時間線與操作紀錄中文、統計說明

**Files:**
- Create: `admin/src/api/visitExclusion.ts`、`admin/src/components/visit/VisitExclusionBanner.vue`、`admin/src/components/visit/VisitExclusionAction.vue`
- Modify: `admin/src/views/VisitDetailView.vue:217-255`（掛元件）
- Modify: `admin/src/api/labels.ts`（`VISIT_EVENT_LABELS`、`AUDIT_ACTION_LABELS`、`AUDIT_METADATA_FORMATTERS`）、`admin/src/api/visitHistory.ts:36-53`（`visitEventTitle`）
- Modify: `admin/src/components/analytics/BookingOutcomesSection.vue:85-94,295`、`admin/src/components/analytics/ClassDistributionPanel.vue:84`、`admin/src/components/admissions/JourneyTab.vue:90-100`、`admin/src/components/sessions/SlotUsagePane.vue`（各時段表說明）
- Test: Create `admin/src/__tests__/visitExclusion.test.ts`

**Interfaces:**
- Consumes：`injectVisitCase()`（`vc.detail`、`vc.canManage`、`vc.familyVisit`、`vc.refreshDetail()`）；`api.post`；Task 7 的端點與欄位；Task 8 的 `excluded_cases`；Task 9 的 `VISIT_EXCLUDE_REASON_LABELS`。
- Produces：`excludeVisit(id: string, body: { reason: 'test' | 'duplicate' | 'other'; note?: string | null })`、`includeVisit(id: string)`（`api/visitExclusion.ts`）。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/visitExclusion.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { auditMetadataDetails, AUDIT_ACTION_LABELS } from '../api/labels'
import { visitEventTitle } from '../api/visitHistory'
import VisitDetailView from '../views/VisitDetailView.vue'
import { bodyOf, cleanup, mockGet, mockPost, reception } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

// 2026-10-15 預約案件排除：入口在右欄最下方（計畫裁定 P7）、已排除時頁首下方有橫幅。
afterEach(() => cleanup())
const body = () => new DOMWrapper(document.body)

describe('排除的入口與橫幅', () => {
  it('總管理者看得到入口；選「其他」沒寫說明不能送；送出帶原因與說明', async () => {
    mockGet(caseRoutes(visitCase()))
    const post = mockPost({ [`/admin/visit-requests/${VISIT_ID}/exclude`]: visitCase({ excluded_at: '2026-10-15T02:00:00Z', exclude_reason: 'other', exclude_note: '櫃台測試' }) })
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('標記為排除'))!.trigger('click')
    await flushPromises()
    const dialog = body().find('.exclusion-dialog')
    expect(dialog.text()).toContain('排除不會釋出名額')  // 預約正常、還沒到（E6）
    await dialog.findAll('input[type="radio"]').find((r) => (r.element as HTMLInputElement).value === 'other')!.setValue(true)
    const submit = dialog.findAll('button').find((b) => b.text() === '標記為排除')!
    expect(submit.attributes('disabled')).toBeDefined()
    await dialog.find('textarea').setValue('櫃台測試')
    await submit.trigger('click')
    await flushPromises()
    expect(bodyOf(post, `/admin/visit-requests/${VISIT_ID}/exclude`)).toEqual({ reason: 'other', note: '櫃台測試' })
  })

  it('已排除：橫幅寫原因與誰標的，有「取消排除」；櫃台看得到橫幅但沒有按鈕', async () => {
    const excluded = visitCase({
      status: 'cancelled', excluded_at: '2026-10-15T02:00:00Z', exclude_reason: 'test', exclude_note: null,
      history: [{ id: 'e1', event_type: 'excluded', source: 'staff', actor_user_id: 'u1', actor_email: 'chen@example.invalid', actor_display_name: '陳老師', before: null, after: { reason: 'test' }, reason: null, created_at: '2026-10-15T02:00:00Z' }],
    })
    mockGet(caseRoutes(excluded))
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user: reception() })
    await flushPromises()
    const banner = wrapper.find('.exclusion-banner')
    expect(banner.text()).toContain('已排除：測試')
    expect(banner.text()).toContain('陳老師')
    expect(banner.findAll('button').some((b) => b.text() === '取消排除')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().includes('標記為排除'))).toBe(false)
  })
})

describe('時間線與操作紀錄的中文', () => {
  it('excluded／exclusion_removed 有標題；操作紀錄動作與原因有中文', () => {
    const base = { id: 'e', source: 'staff', actor_user_id: null, actor_email: null, before: null, reason: null, created_at: '2026-10-15T02:00:00Z' }
    expect(visitEventTitle({ ...base, event_type: 'excluded', after: { reason: 'duplicate' } } as never)).toBe('標記為排除：重複')
    expect(visitEventTitle({ ...base, event_type: 'exclusion_removed', after: null } as never)).toBe('取消排除')
    expect(AUDIT_ACTION_LABELS['visit_request.exclude']).toBe('標記為排除')
    expect(AUDIT_ACTION_LABELS['visit_request.include']).toBe('取消排除')
    // auditMetadataDetails(metadata, action) 回 { lines, others }（labels.ts:1493-1503）。
    expect(auditMetadataDetails({ exclude_reason: 'test' }, 'visit_request.exclude').lines).toContain('排除原因：測試')
  })
})
```

（`reception()` 的校區是 yihua，`visitCase()` 是 yihua 的案件。）

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/visitExclusion.test.ts`
Expected: FAIL。

- [ ] **Step 3：API 與中文**

`admin/src/api/visitExclusion.ts`：

```ts
// 預約案件的排除標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md §3.2）。
import { api } from './client'
import type { VisitRequestDetailOut } from './types'

export type ExcludeReason = 'test' | 'duplicate' | 'other'
export const EXCLUDE_REASONS: readonly ExcludeReason[] = ['test', 'duplicate', 'other']

export function excludeVisit(id: string, body: { reason: ExcludeReason; note?: string | null }): Promise<VisitRequestDetailOut> {
  return api.post<VisitRequestDetailOut>(`/admin/visit-requests/${id}/exclude`, body)
}

export function includeVisit(id: string): Promise<VisitRequestDetailOut> {
  return api.post<VisitRequestDetailOut>(`/admin/visit-requests/${id}/include`)
}
```

`labels.ts`：`VISIT_EVENT_LABELS` 最後加 `excluded: '標記為排除', exclusion_removed: '取消排除',`（操作紀錄的動作與 `exclude_reason` 中文 Task 9 已加）。

`visitHistory.ts` `visitEventTitle`：在 `details_updated` 那一行之後加：

```ts
  // 排除標記（2026-10-15）：標題帶原因；說明在 reason（照一般歷程顯示）。
  if (event.event_type === 'excluded') {
    const reason = text(event.after, 'reason')
    return reason ? `標記為排除：${VISIT_EXCLUDE_REASON_LABELS[reason] ?? reason}` : visitEventLabel('excluded')
  }
```

（import `VISIT_EXCLUDE_REASON_LABELS`。）

- [ ] **Step 4：入口與橫幅**

`admin/src/components/visit/VisitExclusionAction.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '../../api/errors'
import { VISIT_EXCLUDE_REASON_LABELS } from '../../api/labels'
import { EXCLUDE_REASONS, excludeVisit, type ExcludeReason } from '../../api/visitExclusion'
import { injectVisitCase } from '../../composables/useVisitCase'

// 排除入口（2026-10-15 規格 §3.4；計畫裁定 P7）：右欄最下方一列，所有狀態都有，只給 booking.manage。
const vc = injectVisitCase()
const open = ref(false)
const reason = ref<ExcludeReason>('test')
const note = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const show = computed(() => Boolean(vc.detail) && vc.canManage && !vc.detail?.excluded_at)
// 預約正常、還沒到參觀時間：排除不釋出名額，提醒一併取消（E6）。
const holdsSeat = computed(() => vc.detail?.status === 'confirmed' && !vc.visitStarted)
const canSubmit = computed(() => reason.value !== 'other' || note.value.trim() !== '')

function start() {
  reason.value = 'test'
  note.value = ''
  error.value = null
  open.value = true
}

async function submit() {
  if (!vc.detail || !canSubmit.value || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await excludeVisit(vc.detail.id, { reason: reason.value, note: note.value.trim() || null })
    open.value = false
    ElMessage.success('已排除，這筆不再算進統計與待辦')
    await vc.refreshDetail()
  } catch (err) {
    error.value = apiErrorMessage(err, '排除失敗，請稍後再試')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section v-if="show" class="panel exclusion-action">
    <el-button link type="primary" @click="start">標記為排除（測試或重複）…</el-button>
    <el-dialog v-model="open" class="exclusion-dialog" title="標記為排除" width="min(480px, calc(100vw - 32px))" append-to-body :close-on-click-modal="false">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
      <p class="hint">排除之後，這筆不算進總覽、參觀預約統計、預約全程與場次使用情況，也不寄參觀提醒；可以隨時取消排除。</p>
      <p v-if="holdsSeat" class="hint exclusion-dialog__seat">排除不會釋出名額；如果是測試預約，請一併取消。</p>
      <el-radio-group v-model="reason" aria-label="排除原因">
        <el-radio v-for="key in EXCLUDE_REASONS" :key="key" :value="key">{{ VISIT_EXCLUDE_REASON_LABELS[key] }}</el-radio>
      </el-radio-group>
      <el-input v-model="note" type="textarea" maxlength="200" show-word-limit :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="reason === 'other' ? '請寫說明（必填）' : '說明（選填）'" aria-label="排除說明" />
      <template #footer>
        <el-button :disabled="submitting" @click="open = false">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">標記為排除</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.exclusion-action { padding: 12px 16px; }
.exclusion-dialog__seat { color: var(--warning-text); }
</style>
```

（`vc.visitStarted` 是 `useVisitCase` 已回傳的值（:633）；`--warning-text` 換成 `admin/src/styles` 裡實際存在的警示文字 token，`grep -rn "warning" admin/src/styles/*.css | head` 找。）

`admin/src/components/visit/VisitExclusionBanner.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '../../api/errors'
import { formatDate, VISIT_EXCLUDE_REASON_LABELS } from '../../api/labels'
import { includeVisit } from '../../api/visitExclusion'
import { visitEventActor } from '../../api/visitHistory'
import { injectVisitCase } from '../../composables/useVisitCase'
import { notifyError } from '../../composables/notify'

// 已排除的橫幅（2026-10-15 規格 §3.4）：頁首下方一條灰色橫幅；有關聯的招生訪視時加一句（E10）。
const vc = injectVisitCase()
const busy = ref(false)
const detail = computed(() => vc.detail)
const marker = computed(() => [...(detail.value?.history ?? [])].reverse().find((event) => event.event_type === 'excluded'))
const reasonText = computed(() => VISIT_EXCLUDE_REASON_LABELS[detail.value?.exclude_reason ?? ''] ?? '其他')
const byText = computed(() => {
  const parts = [marker.value ? visitEventActor(marker.value) : '', detail.value?.excluded_at ? `${formatDate(detail.value.excluded_at)} 標記` : '']
  return parts.filter(Boolean).join(' ')
})

async function include() {
  if (!detail.value || busy.value) return
  busy.value = true
  try {
    await includeVisit(detail.value.id)
    ElMessage.success('已取消排除')
    await vc.refreshDetail()
  } catch (err) {
    notifyError(apiErrorMessage(err, '取消排除失敗，請稍後再試'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="detail?.excluded_at" class="exclusion-banner" role="status">
    <p>
      <strong>已排除：{{ reasonText }}</strong><span v-if="byText">（{{ byText }}）</span>
      <span v-if="detail.exclude_note">・{{ detail.exclude_note }}</span>
      <el-button v-if="vc.canManage" link type="primary" :loading="busy" @click="include">取消排除</el-button>
    </p>
    <p v-if="vc.familyVisit" class="hint">這筆預約已排除，但招生訪視仍會算進招生統計；如果是測試資料，請到招生入學刪除訪視。</p>
  </div>
</template>

<style scoped>
.exclusion-banner { margin: 12px 0 0; padding: 10px 14px; border-radius: 8px; background: var(--surface-muted); color: var(--ink); }
.exclusion-banner p { margin: 0; }
.exclusion-banner p + p { margin-top: 4px; }
</style>
```

（`formatDate`、`notifyError`、`visitEventActor` 都是既有匯出；token 名稱照後台既有的灰底 token 改。）

`VisitDetailView.vue`：import 兩個元件；`<VisitCaseHero />` 之後加 `<VisitExclusionBanner />`；右欄 `<VisitCaseSettings />` 之後加 `<VisitExclusionAction />`。

- [ ] **Step 5：三處統計說明**

`BookingOutcomesSection.vue`：在 `pendingNote` 之後加：

```ts
// 排除的測試／重複案件（2026-10-15）不在上面的數字裡；0 筆不寫。
const excludedNote = computed(() => (row.value?.excluded_cases ? `另有 ${row.value.excluded_cases} 筆測試或重複的預約已排除，不在上面的數字裡。` : ''))
```

範本 `<p v-if="pendingNote" class="hint">{{ pendingNote }}</p>` 之後加 `<p v-if="excludedNote" class="hint">{{ excludedNote }}</p>`。

`ClassDistributionPanel.vue`：在 `<p v-if="data.total === 0" …>` 之後加 `<p v-if="data.excluded_cases" class="hint">另有 {{ data.excluded_cases }} 筆測試或重複的預約已排除，不在這張表裡。</p>`。

`JourneyTab.vue` 的 `coverage` 陣列在 `undated_cases` 那一項之後加：

```ts
    cover.excluded_cases ? `已排除的測試或重複預約 ${cover.excluded_cases} 筆，不在這個漏斗裡。` : '',
```

`SlotUsagePane.vue`：「各時段坐了幾成」區塊的說明段落（`grep -n "各時段坐了幾成" admin/src/components/sessions/SlotUsagePane.vue` 找到該 `section`，加在表格之後）加 `<p v-if="usage.slots.excluded_cases" class="hint">已排除的測試或重複預約 {{ usage.slots.excluded_cases }} 筆，不算進已約。</p>`。

- [ ] **Step 6：跑測試確認通過**

Run: `cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/visitExclusion.test.ts src/__tests__/visitCaseLayout.test.ts src/__tests__/visitCaseTimeline.test.ts src/__tests__/journeyTab.test.ts src/__tests__/slotUsage.test.ts src/__tests__/labelCoverage.test.ts; npm run typecheck`
Expected: PASS。

- [ ] **Step 7：Commit**

```bash
git add admin/src/api/visitExclusion.ts admin/src/components/visit/VisitExclusionBanner.vue admin/src/components/visit/VisitExclusionAction.vue admin/src/views/VisitDetailView.vue admin/src/api/labels.ts admin/src/api/visitHistory.ts admin/src/components/analytics/BookingOutcomesSection.vue admin/src/components/analytics/ClassDistributionPanel.vue admin/src/components/admissions/JourneyTab.vue admin/src/components/sessions/SlotUsagePane.vue admin/src/__tests__/visitExclusion.test.ts
git commit -m "feat(admin): 案件明細可標記與取消排除，統計說明寫出已排除筆數

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11：stack e2e（排除）

**Files:**
- Create: `tests/stack/visit-exclusion.spec.ts`

**Interfaces:**
- Consumes：`adminApi`、`findVisit`、`submitPublicRequest`（`forwardedFor`）；`openAs`、`gotoAdmin`、`searchVisitList`；Task 9、10 的 DOM（`.visit-row__excluded`、「隱藏已排除」checkbox、`.exclusion-banner`、「標記為排除（測試或重複）…」、`.exclusion-dialog`）。

用 `campus_admin` 角色操作（E2）。送單用自己的來源 `198.51.100.63`。

- [ ] **Step 1：寫 spec**

```ts
import { expect, test } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest } from './api'
import { gotoAdmin, openAs, searchVisitList } from './pages'
import { SLOTS_CAMPUS } from './stack-env'

// 2026-10-15 預約案件排除：校區管理者把一筆案件標為測試 → 參觀預約統計少一筆、列表有標籤、隱藏後不見 → 取消排除後恢復。
const PARENT = '排除測試家長'

test('校區管理者標記排除與取消排除', async ({ browser }) => {
  await submitPublicRequest(SLOTS_CAMPUS, PARENT, '0912000633', { forwardedFor: '198.51.100.63' })
  const api = await adminApi('super_admin')
  const visit = await findVisit(api, PARENT)
  const cases = async () => {
    const body = await api.get<{ campuses: { campus_key: string; cases: number; excluded_cases: number }[] }>('/admin/analytics/booking-outcomes')
    const row = body.campuses.find((c) => c.campus_key === SLOTS_CAMPUS)!
    return [row.cases, row.excluded_cases]
  }
  const [before] = await cases()
  const { context, page } = await openAs(browser, 'campus_admin')

  await test.step('明細標記為排除（測試）', async () => {
    await gotoAdmin(page, `/visit-requests/${visit.id}`, '案件明細')
    await page.getByRole('button', { name: /標記為排除/ }).click()
    const dialog = page.locator('.exclusion-dialog')
    await expect(dialog).toContainText('排除不會釋出名額')
    await dialog.getByRole('button', { name: '標記為排除' }).click()
    await expect(page.locator('.exclusion-banner')).toContainText('已排除：測試')
  })
  expect(await cases()).toEqual([before - 1, 1])

  await test.step('列表有標籤；勾「隱藏已排除」後不見', async () => {
    await gotoAdmin(page, '/visit-requests?group=all', '參觀案件')
    await searchVisitList(page, PARENT)
    await expect(page.locator('.visit-row', { hasText: PARENT }).locator('.visit-row__excluded')).toHaveText('已排除・測試')
    await page.getByRole('checkbox', { name: '隱藏已排除' }).check()
    await expect(page).toHaveURL(/excluded=hide/)
    await expect(page.locator('.visit-row', { hasText: PARENT })).toHaveCount(0)
  })

  await test.step('取消排除後恢復', async () => {
    await gotoAdmin(page, `/visit-requests/${visit.id}`, '案件明細')
    await page.locator('.exclusion-banner').getByRole('button', { name: '取消排除' }).click()
    await expect(page.locator('.exclusion-banner')).toHaveCount(0)
  })
  expect(await cases()).toEqual([before, 0])
  await Promise.all([context.close(), api.dispose()])
})
```

（「隱藏已排除」若收在「更多篩選」裡，先 `grep -n "moreFiltersOpen" admin/src/views/VisitRequestsView.vue` 看展開按鈕的名字，在勾選前點開。）

- [ ] **Step 2：跑這一支**

```bash
export E2E_DB_NAME=ivy_website_wave3_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746
npm run e2e:build && npx playwright test -c playwright.stack.config.ts tests/stack/visit-exclusion.spec.ts
```

Expected: 1 passed。

- [ ] **Step 3：Commit**

```bash
git add tests/stack/visit-exclusion.spec.ts
git commit -m "test(e2e): 預約案件排除與取消排除

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12：文件與規格對齊

**Files:**
- Modify: `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`、`docs/specs/2026-10-15-visit-expected-start-design.md`、`docs/specs/2026-10-15-visit-exclusion-design.md`

**Interfaces:** 無（只改文件）。

- [ ] **Step 1：DESIGN.md**

在 `DESIGN.md` 最前面（第一個 `## ` 之前）插入：

```markdown
## 預約表單：預計入學時間（2026-10-15，`feature/admin-wave3-20261015`）

規格 `docs/specs/2026-10-15-visit-expected-start-design.md`。

- **一題、選填**：孩子資料區塊、生日下面，單選膠囊（同得知管道），再點一次取消。選項依台北今天算：盡快（這學期）、接下來四個學期的開學月份（9 月、2 月）、還不確定。不做就托狀況。
- **值**：`visit_requests.expected_start`＝`asap`、`unsure` 或「民國學年-學期」（`115-2`）；學期規則同 `academic.current_term`。規則在 `backend/app/booking/expected_start.py`；官網 `expectedStartOptions`、後台 `expectedStartLabel` 同規則，三邊讀 `contracts/expected-start-cases.json`。
- **範圍**：官網送單與家長管理頁只收今天所在學期到之後第 5 個學期（多一學期給跨學期還開著的舊頁面）；後台補登與修改家長資料可以填過去的學期。
- **帶進招生**：到場建訪視時，選了學期用那個學期、盡快用參觀日所在學期、沒選或還不確定用今天所在學期；選的比參觀日的學期早，用參觀日的學期。之後預約再改，不同步改招生的入學學期。
- **防重複**：沒選時不進送單雜湊，舊頁面與重送的雜湊不變。
- **不做**：就托狀況、分布統計、必填、寫進確認信、園務 `expected_start_label`。

## 預約案件：排除標記（測試／重複）（2026-10-15，`feature/admin-wave3-20261015`）

規格 `docs/specs/2026-10-15-visit-exclusion-design.md`。

- **誰、怎麼標**：總管理者與校區管理者（`booking.manage`）在案件明細右欄最下方「標記為排除（測試或重複）…」，原因三選一（其他要寫說明）；已排除時頁首下方有橫幅與「取消排除」。時間線記 `excluded`／`exclusion_removed`，操作紀錄只記原因類別。
- **套用位置**（`backend/app/booking/exclusion.py` 的 `not_excluded()`，模組說明列出全部）：總覽今天參觀、待標記到場、追蹤到期、要處理；參觀預約統計（結果、班別、現在待處理）；預約全程；場次使用情況；員工與家長提醒。各統計說明寫「已排除 N 筆」。
- **不套用**：名額占用（排除不釋出名額，要釋出請取消）；總覽本週五校已約／可約（講名額；使用者 10-16 確認）；案件列表、頁籤數字、CSV（用 `excluded=hide|only` 篩選，總覽與統計的連結帶 `excluded=hide`）；停用分校與切換預約方式前的計數。
- **匿名化**：原因保留、說明清掉；已匿名化的案件可以排除但不存說明。
- **不做**：招生訪視的排除、依電話自動判定重複、刪除預約、批次排除、排除時自動取消。
```

- [ ] **Step 2：README.md 頂部日期段落**

在 `README.md` 最上方（第一個 `## ` 之前）插入（驗證條由 Task 13 回填）：

```markdown
## 2026-10-15 預約表單預計入學時間、預約案件排除標記（`feature/admin-wave3-20261015`）

後台功能第 3 波（規格 `docs/specs/2026-10-15-visit-expected-start-design.md`、`docs/specs/2026-10-15-visit-exclusion-design.md`，計畫 `docs/superpowers/plans/2026-10-15-admin-wave3-start-exclusion.md`）。

- **預計入學時間**：官網預約表單多一題選填單選（盡快、接下來四個學期的開學月份、還不確定），家長管理頁與後台都能改，到場建招生訪視時帶進入學學期。migration `b7e3c1a9d5f2`（加可空欄位，不改既有資料）。
- **排除標記**：總管理者與校區管理者可以把測試或重複的預約案件標為排除，不再算進總覽、參觀預約統計、預約全程、場次使用情況與提醒；不釋出名額；列表可隱藏。migration `d4a8f2c6e913`。
- **使用者 10-16 確認**：總覽「本週五校」的已約／可約不扣排除的案件（排除規格 §3.3）。
- **正式站要做的事**：已發布的隱私權政策要請園方在後台補「預計入學時間」一項（後台草稿已補）。
```

- [ ] **Step 3：acceptance.md**

在 `docs/website-admin/acceptance.md` 最後加一節：

```markdown
## 預約表單預計入學時間、預約案件排除標記（2026-10-15，`feature/admin-wave3-20261015`）

- 預計入學時間：官網送單（選填、範圍）、補登、後台與家長修改、明細、CSV、到場帶進入學學期——後端 `test_expected_start.py`、`test_visit_expected_start.py`、`test_visit_expected_start_edit.py`；web `visit-expected-start.spec.ts`、`visit-edit.spec.ts`；admin `expectedStart.test.ts`；stack `visit-expected-start.spec.ts`（含 1440／390 截圖）。
- 排除標記：權限、時間線、操作紀錄、匿名化——`test_visit_exclusion.py`；§3.3 每一處——`test_visit_exclusion_scope.py`；列表篩選與總覽連結——`visitListQuery.test.ts` 等；明細入口與橫幅——`visitExclusion.test.ts`；stack `visit-exclusion.spec.ts`。
- 未驗證：正式站登入後的畫面；正式資料上的排除操作。
```

- [ ] **Step 4：兩份規格補實作紀錄**

兩份規格檔尾各加 `## 7. 實作紀錄`，列：計畫路徑、分支 `feature/admin-wave3-20261015`（兩案合一支，計畫裁定 P1）、與規格的差異——預計入學：P2 共用案例檔、P3 顯示文字、P4 家長管理頁也套公開範圍、P5 認不得的值不丟例外；排除：P6 metadata 鍵、P7 入口改成獨立一列與橫幅、P8 總覽與統計連結帶 `excluded=hide`、P9 `excluded_cases` 命名、P10 本週五校待確認、P12 列表不回說明、P14 兩條「否」的測試、P15 匿名化案件不存說明、P16 422 指到 note。**不改**排除規格的狀態行與 §3.3「本週五校」那一列（等使用者明確確認）。

- [ ] **Step 5：檢查並 Commit**

```bash
grep -n "TBD\|TODO" DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-10-15-visit-expected-start-design.md docs/specs/2026-10-15-visit-exclusion-design.md | head
git add DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-10-15-visit-expected-start-design.md docs/specs/2026-10-15-visit-exclusion-design.md
git commit -m "docs: 預計入學時間與預約案件排除（規則、限制、與規格的差異）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13：全套驗證、對 main、交付（控制者在背景分開跑，不交給子代理）

- [ ] **Step 1：後端全套**（約 20 分鐘；背景；一次只跑這一組）

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave3_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider
```

Expected: 0 failed。若有 `FileNotFoundError`／`ENOENT`，先確認 Task 0 Step 1 的 sparse 目錄完整，不要當成程式錯。已知日期相依的既有紅燈（台北週五 `test_booking_consent_readiness` 場次同步、週末 `test_booking_concurrency`）在報告裡標明不是本案造成。

- [ ] **Step 2：admin、web 全套與 typecheck、契約**

```bash
cd admin && source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run; npm run typecheck
cd ../web; VITEST_MAX_FORKS=2 npx vitest run; npm run typecheck
cd ..; cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
```

Expected: 全部通過。

- [ ] **Step 3：stack 全套**（背景）

```bash
export E2E_DB_NAME=ivy_website_wave3_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746
npm run e2e:build && npx playwright test -c playwright.stack.config.ts
```

Expected: 0 failed。`visual.spec.ts` 的「案件明細」若因右欄多了「標記為排除」一列而超過 1% 門檻：看 diff 圖確認只差那一列，再 `npx playwright test -c playwright.stack.config.ts tests/stack/visual.spec.ts --update-snapshots=all` 更新，並 `git add tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png`。台北 00–01 點 `admissions-follow-up` 的既有時間相依紅燈照實寫。

- [ ] **Step 4：公開表單人工看圖**

看 `output/playwright/visit-expected-start-1440.png`、`-390.png`：膠囊和得知管道同款、手機換行整齊、沒有橫向捲動、「選填」小字對齊。

- [ ] **Step 5：對 main、改接 migration**

```bash
git fetch origin
git log --oneline HEAD..origin/main | head -20
```

若 main 有新 commit：`git merge origin/main`（衝突照實解，特別是 `booking/routes.py`、`booking/schemas.py`、`booking/models.py`、`dashboard_service.py`、`StatsTab.vue`、契約檔）。合併後若 `alembic heads` 不只一個（在途的在籍學生分布 `f2a7c1e9d4b3`、幼兒園名單修正、附近同業比較、第 2 波退出原因分類先進了 main）：把 `b7e3c1a9d5f2_visit_expected_start.py` 的 `down_revision`（與檔頭 `Revises:`）改成 main 的 head，`d4a8f2c6e913` 不動；砍掉重建測試庫 `dropdb ivy_website_wave3_1015_test; createdb ivy_website_wave3_1015_test` 再 `MIGRATE`，`alembic heads` 只剩 `d4a8f2c6e913`；重跑契約檢查與受影響的測試；commit（訊息寫出實際接上的 revision，例如 `fix(migrations): 預計入學時間改接 f2a7c1e9d4b3`）。

- [ ] **Step 6：回填 README 驗證條、交付**

README 本案段落補「驗證」條（各數字註明跑在哪個 commit；沒做的事：正式站沒有登入看畫面、正式資料沒有實際排除過、家長提醒的排除條件是否由本案補上（Task 8 Step 8 有沒有做））；commit。回報：完成摘要、驗證結果、計畫裁定與實作中的新裁定、需要使用者決定的事（**本週五校要不要扣排除**；`feature/admin-wave3-20261015` 要不要 push main＝部署；部署後在 `deploy/README.md` 補紀錄、清 worktree／分支／兩個測試庫）。**不自己 push、不部署。**
