# 官網招生入學模組 Implementation Plan — 階段 A：後端與轉移契約

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官網後端建立招生入學模組：三張沿用園務名稱的資料表、年級與學期換算、訪視 CRUD、狀態轉換、保留座位與名額、預約「已到場」自動建立招生訪視與待確認清單、保存政策新類別、園務轉移契約與匯出程式，以及更新後的 OpenAPI 契約。後台畫面（B）與統計（C）不在本階段。

**Architecture:** 新模組 `backend/app/admissions/`，分層同 booking：`models.py` → 各 service（只 `flush`、丟自訂例外）→ `routes.py`（`require_scope`、轉 HTTPException、`audit_service.log_action`、路由層 `commit`）。預約的 `workflow_service.mark_completed` 在同一個交易內呼叫 `booking_link.ensure_from_visit_request`。轉移契約放 `contracts/ivy-recruitment/`。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async＋asyncpg、Alembic、PostgreSQL、pydantic 2、pytest（`asyncio_mode = "auto"`）；後台只動 `admin/src/api/labels.ts`、`admin/src/api/types.ts`、`admin/src/__tests__/fixtures.ts`；web 只加一支 vitest。

**Spec:** `docs/specs/2026-09-30-website-admissions-design.md` 第 5、6、7、8、11、12、13 節（下稱「規格」）。

**先讀：** 總覽 `docs/superpowers/plans/2026-10-01-admissions.md` 的「工作環境」「Global Constraints」「技術調整」「介面」「Review Focus」，以及本檔「對總覽的調整」。

**本階段閘門（A9 最後一步，全部通過才進階段 B）：**
- `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q` 全綠（主 session 背景跑，subagent 不跑全套）
- `npm run contract:check`
- `npm --prefix admin run test:unit -- labelCoverage`
- `npm run test:website`

## 對總覽的調整

實作以本節為準；Task C6 回寫規格時一併回寫總覽。

1. **`stage_of` 不放在 `records.py`**。原本：`records.stage_of`，「定義在 funnel.py，records 從 funnel 匯入」。改成：階段一律用 `funnel.derive_stage(visit)`（Python）與 `funnel.stage_condition(stage)`（SQL）。`funnel.py` 由 **A3 先建立**（只有 `Stage`、`derive_stage`、`stage_condition`），A4 再加轉換、權限對照與看板。理由：A3 的回應欄位 `stage` 與列表篩選就要用到；而 `funnel.transition` 要用 `records.write_event`，records 在模組層匯入 funnel 會形成循環匯入。`records.RecruitmentVisitFilters.apply` 在函式內匯入 `stage_condition`。
2. **`RecruitmentVisit.events` 加 `passive_deletes=True`**。理由：async session 刪除訪視時不能 lazy load 歷程；交給資料庫的 `ON DELETE CASCADE`。
3. **`write_event` 多一個選填參數 `created_at: datetime | None = None`**。理由：「取消註冊並取消預繳」一次寫兩筆事件，第二筆要保證排在後面。
4. **`booking_link.fields_from_visit_request(visit_request, *, today, slot_date=None)`** 多一個 `slot_date`。理由：純函式不能碰 `visit_request.slot`（async 下 lazy load 會丟 `MissingGreenlet`，正好違反「標記已到場不得失敗」）；`ensure_from_visit_request` 先用 `history.load_slot` 取場次再傳入。
5. **`booking_link.arrivals(db, campus_key, *, now=None)`、`retention.eligible_count(db, days, *, now=None)`、`retention.anonymize_due(db, days, *, now=None)`** 多一個 `now`。理由：R01a 的「場次剛好開始」邊界與保存天數要能固定時間測；`retention_service.preview／run_sweep` 本來就帶 `now`。
6. **保存政策的 schema 在 `backend/app/operations/routes.py`**（`RetentionDaysOut` 等，約 408–456 行），沒有 `operations/schemas.py`。A7 改 `models.py`（A2 已加欄位）、`retention_service.py`、`routes.py`。
7. **A2 新增測試檔 `backend/tests/test_admissions_schema.py`**（總覽的測試清單沒有）：migration 接在 `c7d2e9f4a1b8` 後且只有一個 head、欄位與約束實際建在 DB、CheckConstraint 條件字串 model 與 migration 逐字相同、三個 capability 的 `roles_with`。repo 沒有自動跑 upgrade／downgrade 的 pytest 慣例（`test_display_names.py` 只檢查 revision 圖與 `information_schema`），可逆性用 A2 的手動指令驗證。
8. **新增 schema `FunnelColumnsOut`**（`visited`／`deposited`／`enrolled`／`withdrawn` 四個 `list[FunnelCardOut]`），`FunnelBoardOut.columns` 用它。理由：用 `dict[str, list]` 產生的 TS 型別是索引簽章，B3 取欄位會變成可能 `undefined`。
9. **`records.TourGuideNotFound`** 與 422 `TOUR_GUIDE_INVALID`：`tour_guide_user_id` 指到不存在的帳號時擋下（否則外鍵錯誤變 500）；有帶帳號、沒帶 `tour_guide_name` 時，用該帳號的 `display_name` 當姓名快照。
10. **`funnel.not_allowed_reason(from_stage, to_stage) -> str`**：不允許的轉換回 422 時的中文說明（visited→withdrawn 用園務原文）。路由先比對 `expected_version`、再判斷權限：別人剛改過的卡片一律 409，不會因為卡片已換欄而誤回 403。
11. **建立／編輯／狀態轉換／座位／名額的 request schema 一律 `extra="forbid"`**：送 `has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`、`provisional_grade`、`month`、`seq_no` 會得到 FastAPI 標準 422（`loc` 指到該欄位）。
12. **`SeatOut` = `{visit: RecruitmentVisitOut, capacity_warning: bool, warning_code: "SEAT_CAPACITY_WARNING" | null}`**（規格 6.5 的警示代碼放在回應，不是錯誤）。
13. **補建（`POST /from-visit-request/{id}`）只接受 `completed` 且未匿名化的預約**：其他狀態 409 `VISIT_REQUEST_NOT_COMPLETED`；已匿名化 409 `VISIT_REQUEST_ANONYMIZED`。待確認清單的 `missing` 也排除已匿名化的預約。
14. **`labels.ts` 既有的 metadata 鍵 `created`、`fields` 改成依 action 分開翻**：`created` 原本是「新增 N 場」（時段產生），`fields` 原本只對素材欄位；招生稽核沿用總覽的鍵名，所以要加 `action.startsWith('recruitment_visit.')` 的分支。
15. **保存政策**：`retention_policies` 另加 DB CHECK `ck_retention_policies_admissions_days`（`admissions_days IS NULL OR admissions_days BETWEEN 30 AND 3650`，與 API 同一組常數）；`RetentionPolicyUpdate.admissions_days` 只有請求有帶這個鍵才寫入（`model_fields_set`），B6 改畫面之前，現行保存政策頁存檔不會把它清成 NULL。`RETENTION_CATEGORY_LABELS` 加 `admissions`，操作紀錄的 `counts` 格式化只在 metadata 有這一類時才列（舊紀錄的文字不變）。
16. **匯出格式**：每列是 `{"website_id": ..., "columns": {園務欄位}, "mapping": {匯入時要對應的官網值}}`；`columns` 的外鍵與年級 id（`recruitment_visit_id`、`grade_id`、`provisional_grade_id`、`tour_guide_employee_id`）留 `null`，由匯入端依 `mapping` 填入。`created` 事件不匯出。細節見 A8 的 README。
17. **`AdmissionsOptionsOut.source_categories` 用 `dict[str, str]`**（代碼 → 園務文案，順序同園務），不另設 schema。
18. **`AdmissionsOptionsOut` 另有 `grades`、`no_deposit_reasons: list[NoDepositReasonOption]`**（`{value, priority}`，priority 是 `high`／`medium`／`low`，「未註明／待追蹤」為 null），不另回優先度表。新 schema `NoDepositReasonOption`。
19. **`RecruitmentEventOut` 多 `actor_user_id`、`actor_name`**（讀取時 join users，顯示名稱沒有就用 Email；帳號刪除或自動建立時為 null），歷程舊到新排序（同園務 timeline）。
20. **總覽沒列的錯誤碼**：422 `TRANSITION_FIELDS_REQUIRED`（帶 `fields`，值是 `reason`、`grade`、`target_school_year`）、422 `SEAT_NOT_ALLOWED`（message 用園務原文）。同階段轉換（X→X）也回 422 `TRANSITION_NOT_ALLOWED`（園務是 409 `STAGE_ALREADY`）；版本先比對，所以只有同版本送同階段才會走到這裡。
21. **標記註冊的欄位**：`grade`、`target_school_year` 沒給時用保留座位與訪視上的值，都沒有才回 `TRANSITION_FIELDS_REQUIRED`；給了就覆寫 `provisional_grade` 與 `target_*`（註冊的年級為準，同園務以班級年級為準）；學期沒給用訪視上的、再沒有用 1；`enrolled_on` 沒給用台北今天。`converted` 事件 metadata 是 `{"website_manual": true, "grade", "school_year", "semester"}`。取消註冊與退註冊不清 `provisional_grade`，取消退出回已預繳時保留座位仍在（Review Focus 4）。
22. **建立與編輯的欄位**：`RecruitmentVisitCreate`／`Update` 不收 `district`、`geocoding_consent_at`（規格 5.1 本次不填）；`Update` 不能把 `child_name`、`visit_date`、`target_school_year`、`target_semester` 清成 null（422）；生日不能晚於今天。編輯把參觀日期改到別的月份時，`month` 跟著換，並在新月份鎖內重新配 `seq_no`（舊序號在新月份可能已被用掉）。
23. **保留座位細節**：釋放沒有保留的訪視回 422 `SEAT_NOT_ALLOWED`「這筆訪視目前沒有保留座位」；`seat_reserved`／`seat_released` 的 from／to stage 用當下階段（園務固定寫 deposited），metadata `{"grade", "school_year", "semester"}`（年級存名稱，不是 id）。
24. **名額規劃回應多 `totals`**（新 schema `IntakePlanTotalsOut`）：計畫名額與剩餘只加總有設定的年級，一個都沒設定是 null；已保留、已註冊加總全部年級。`transfer_term` 不影響名額（同園務 `compute_intake_plan`）。`GET /intake-plan` 的 `semester` 預設 1；`GET /board` 的 `school_year` 預設台北今天所在學年、`semester` 不帶是整學年。
25. **校區層級端點的 404**：`campus_key` 不在 `CAMPUS_KEYS` 時，總管理者也回 404（不是空清單或外鍵 500）。
26. **`labels.ts` 新增匯出 `RECRUITMENT_STAGE_LABELS`、`RECRUITMENT_ORIGIN_LABELS`、`RECRUITMENT_FIELD_LABELS`**，`AUDIT_PAIRED_KEYS` 加 `from_stage`／`to_stage`（操作紀錄寫成「招生階段：已預繳 → 已註冊」）。B 的 `admissions/constants.ts` 需要階段文案時從 `labels.ts` 匯入，不另抄一份。
27. **`ArrivalRowOut.slot_date`、`start_time` 可為 null**：「已到場但沒有招生訪視」裡的舊預約可能沒有場次。補建時沒有場次的訪視日期用建立當天。
28. **匯出程式的介面**：`export_campus(db, campus_key, *, tenant_id=None)`、`ivy_event_row(event, *, actor_name=None)` 多了選填參數，另有 `write_jsonl(result, out_dir)`；歷程的 `metadata_json.website_actor` 是 `{"user_id", "name"}`。匯出程式用 `default_transaction_read_only=on` 的連線保證只讀（每條連線一建立就是唯讀，不必靠交易裡第一句的順序）。
29. **測試共用 fixture** `campus_admin_yihua_client`、`reception_yihua_client`、`readonly_yihua_client` 與 `transition`、`record_at_stage`、`started_booking`、`move_slot`、`complete` 都在 `tests/admissions_helpers.py`；C1 的測試檔自己定義的 `reception_client`、`readonly_client` 名稱不同，不衝突。
30. **R14「統計結果不變」的驗證範圍**：A7 檢查匿名化後所有統計欄位（月份、日期、年級、來源、介紹者、預繳、註冊、轉學期、未預繳原因、保留座位、入學學期、退出）原封不動。C1 的 `unique_visit`／`unique_deposit` 用「姓名｜生日」去重，匿名化後姓名變成固定文字、生日清空，多筆會被算成同一個孩子；這一點留給 C 決定（見待決定問題）。

## Global Constraints

見總覽「Global Constraints」。本階段另外：

- 本階段只動 `backend/`、`contracts/`、`web/tests/admission-grade-cases.spec.ts`、`admin/src/api/labels.ts`、`admin/src/api/types.ts`、`admin/src/__tests__/fixtures.ts`、`docs/website-admin/acceptance.md`。後台畫面（`.vue`、`router/`）一律留給 B。
- `mark_completed` 內的招生建立路徑**沒有任何會丟例外的資料檢查**：截斷與預設值都在 `fields_from_visit_request` 做完，`create_visit` 收到的欄位一定符合 DB 約束。不准用 `try/except` 吞掉例外（會留下「已到場卻沒有招生訪視」的半套狀態，違反規格 6.1）；真的是 DB 層錯誤就讓整個「標記已到場」回滾。
- 匯出程式與漂移檢查只讀，不寫任何資料庫；漂移檢查只用 `ast` 讀園務原始碼，不 import 園務程式。

## Review Focus（本階段負責）

| 總覽條目 | 本階段測試 | Task |
|---|---|---|
| 1「標記已到場」被招生資料拖垮 | `test_admissions_booking_link.py::test_completion_never_fails_on_long_or_missing_fields` | A6 |
| 2 台北日期與學期邊界 | `test_admissions_academic.py::test_current_term_boundaries`、`test_admissions_booking_link.py::test_month_follows_slot_date_not_created_at` | A1、A6 |
| 3 兩人同時拖同一張卡 | `test_admissions_funnel.py::test_concurrent_transition_conflict`（後端；B3 另測前端重載） | A4 |
| 4 退出後取消退出 | `test_admissions_intake.py::test_cancel_withdraw_restores_reserved_seat` | A5 |

條目 5（空資料統計）屬 C1／C2／C3。

## 檔案結構

| 檔案 | 動作 | Task |
|---|---|---|
| `backend/app/admissions/__init__.py` | 新增（空） | A1 |
| `backend/app/admissions/constants.py`、`academic.py` | 新增 | A1 |
| `contracts/ivy-recruitment/grade-cases.json` | 新增 | A1 |
| `backend/tests/test_admissions_academic.py`、`web/tests/admission-grade-cases.spec.ts` | 新增 | A1 |
| `backend/app/admissions/models.py`、`backend/migrations/versions/4a7e2c9d1b63_admissions.py` | 新增 | A2 |
| `backend/app/operations/models.py`（`RetentionPolicy`）、`backend/migrations/env.py`、`backend/tests/conftest.py`、`backend/app/auth/permissions.py`、`admin/src/__tests__/fixtures.ts` | 修改 | A2 |
| `backend/tests/test_admissions_schema.py` | 新增 | A2 |
| `backend/app/admissions/schemas.py`、`records.py`、`funnel.py`（階段推導）、`routes.py` | 新增 | A3 |
| `backend/app/main.py`、`admin/src/api/labels.ts` | 修改 | A3 起 |
| `backend/tests/admissions_helpers.py`、`test_admissions_records.py` | 新增 | A3 |
| `backend/app/admissions/funnel.py`（轉換、看板） | 修改 | A4 |
| `backend/tests/test_admissions_funnel.py` | 新增 | A4 |
| `backend/app/admissions/intake.py`、`backend/tests/test_admissions_intake.py` | 新增 | A5 |
| `backend/app/admissions/booking_link.py`、`backend/tests/test_admissions_booking_link.py` | 新增 | A6 |
| `backend/app/booking/workflow_service.py`（`mark_completed`） | 修改 | A6 |
| `backend/app/admissions/retention.py`、`backend/tests/test_admissions_retention.py` | 新增 | A7 |
| `backend/app/operations/retention_service.py`、`backend/app/operations/routes.py`、`backend/tests/test_retention_policy.py` | 修改 | A7 |
| `contracts/ivy-recruitment/README.md`、`ivy-schema.json`、`backend/app/admissions/export.py` | 新增 | A8 |
| `backend/scripts/export_ivy_recruitment.py`、`backend/scripts/check_ivy_recruitment_contract.py`、`backend/tests/test_admissions_contract.py` | 新增 | A8 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | A9 |
| `admin/src/api/types.ts`、`docs/website-admin/acceptance.md` | 修改 | A9 |

## 執行注意

- 工作目錄 `/Users/yilunwu/Desktop/ivy-website-admissions`，後端指令都在 `backend/` 下跑。開工前照總覽「工作環境」建好 `ivy_website_test_admissions` 並 `alembic upgrade head`。
- 本檔的單檔測試指令一律寫成：
  ```bash
  cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/<檔名>.py -q
  ```
- migration 指令（A2 起每加一支 migration 都要重跑）：
  ```bash
  cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
  WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic upgrade head
  ```
- 新測試檔凡是會建預約（`book_slot`），檔頭都要 `pytestmark = pytest.mark.usefixtures("booking_consent")`。
- 同校同手機 10 分鐘內最多送 5 筆預約（`SUBMIT_LIMIT_BY_PHONE`），A3 的 helper 每次自動換手機號碼。
- A3 起每個 task 都會在 `labels.ts` 補標籤；每個 task 結尾都要跑 `npm --prefix admin run test:unit -- labelCoverage`，不要等到 A9。
- **commit 需使用者授權。** 各 task 的 commit 步驟只在使用者已授權「在 feature 分支逐 task commit」時才做；只 `git add` 列出的檔案。

---

### Task A1：列舉常數、民國月份／學期／年級換算與共用案例

**Files:**
- Create: `backend/app/admissions/__init__.py`（空檔；後面 task 的模組都放這個 package，所以 A1 就要建）
- Create: `backend/app/admissions/constants.py`
- Create: `backend/app/admissions/academic.py`
- Create: `contracts/ivy-recruitment/grade-cases.json`
- Test: `backend/tests/test_admissions_academic.py`
- Test: `web/tests/admission-grade-cases.spec.ts`（讀 `web/app/utils/admission-classes.ts` 的 `academicYear`、`cohortOf`、`parseBirthday`、`CLASS_BY_OFFSET`，第 24、38–46、49–56 行）

**Interfaces:**
- Consumes：`app.common.timezones.today_local`（只在測試用來示範台北日期）。
- Produces：
  - `constants.GRADES`、`NO_DEPOSIT_REASONS`、`NO_DEPOSIT_PRIORITY`、`SOURCE_CATEGORIES`、`STAGES`、`STAGE_LABELS`、`EVENT_TYPES`、`WEBSITE_ONLY_EVENT_TYPES`、`WITHDRAWN_FROM`、`ORIGINS`、`ANONYMIZED_TEXT`、`MISSING_CHILD_NAME`、`LEN_*`、`TEXT_MAX`、`SCHOOL_YEAR_MIN`、`SCHOOL_YEAR_MAX`
  - `academic.roc_month(day: date) -> str`、`roc_date(day: date) -> str`、`current_term(today: date) -> tuple[int, int]`、`term_bounds(school_year: int, semester: int) -> tuple[date, date]`、`grade_for_birthday(birthday: date, school_year: int) -> str | None`、`shift_roc_month(month: str, delta: int) -> str`、`ROC_MONTH_RE`
  - `contracts/ivy-recruitment/grade-cases.json`：`{"cases": [{"name", "birthday", "today", "expected_term": [學年, 學期], "expected_grade": 年級或 null}]}`；年級一律用 `expected_term` 的學年換算（就是「確認到場當下的學期」）。B1 的 admin vitest 也讀這份。

- [ ] **Step 1：寫共用案例檔**

`contracts/ivy-recruitment/grade-cases.json`（每一筆都已用園務規則與官網 `admission-classes.ts` 規則各算一次，兩邊相同）：

```json
{
  "description": "招生年級與學期的共用案例（規格 6.4、R12）。後端 pytest（tests/test_admissions_academic.py）、web vitest（web/tests/admission-grade-cases.spec.ts）、admin vitest（B1）都讀這份。年級用 expected_term 的學年換算；today 是台北日期。",
  "cases": [
    {"name": "9/1 生日當天算足歲：115 學年小班", "birthday": "2023-09-01", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "小班"},
    {"name": "9/2 生日晚一天：115 學年幼幼班", "birthday": "2023-09-02", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "幼幼班"},
    {"name": "滿 2 歲（9/1 生日）：115 學年幼幼班", "birthday": "2024-09-01", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "幼幼班"},
    {"name": "未滿 2 歲：範圍外", "birthday": "2024-09-02", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": null},
    {"name": "大班最大（2020/9/2）", "birthday": "2020-09-02", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "大班"},
    {"name": "大班最小（2021/9/1）", "birthday": "2021-09-01", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "大班"},
    {"name": "滿 6 歲：小一年齡，範圍外", "birthday": "2020-09-01", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": null},
    {"name": "中班", "birthday": "2022-03-15", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "中班"},
    {"name": "7/31 還是 114 學年下學期", "birthday": "2023-09-01", "today": "2026-07-31", "expected_term": [114, 2], "expected_grade": "幼幼班"},
    {"name": "8/1 起是 115 學年上學期", "birthday": "2023-09-01", "today": "2026-08-01", "expected_term": [115, 1], "expected_grade": "小班"},
    {"name": "12/31 仍是上學期", "birthday": "2023-09-01", "today": "2026-12-31", "expected_term": [115, 1], "expected_grade": "小班"},
    {"name": "跨年 1/1 仍是 115 學年上學期", "birthday": "2023-09-01", "today": "2027-01-01", "expected_term": [115, 1], "expected_grade": "小班"},
    {"name": "1/31 上學期最後一天", "birthday": "2023-09-01", "today": "2027-01-31", "expected_term": [115, 1], "expected_grade": "小班"},
    {"name": "2/1 起是 115 學年下學期", "birthday": "2023-09-01", "today": "2027-02-01", "expected_term": [115, 2], "expected_grade": "小班"},
    {"name": "年底出生（12/31）與隔年 1/1 同一屆", "birthday": "2023-12-31", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "幼幼班"},
    {"name": "隔年 1/1 出生", "birthday": "2024-01-01", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "幼幼班"},
    {"name": "閏日出生", "birthday": "2024-02-29", "today": "2026-09-08", "expected_term": [115, 1], "expected_grade": "幼幼班"}
  ]
}
```

- [ ] **Step 2：寫失敗的後端測試**

`backend/tests/test_admissions_academic.py`：

```python
"""招生入學的民國月份、學期與年級換算（規格 6.4；園務 utils/academic.py、
ivy-frontend constants/recruitment.ts gradeForBirthday）。共用案例在
contracts/ivy-recruitment/grade-cases.json，web 與 admin 的 vitest 讀同一份。"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from app.admissions import academic, constants
from app.common.timezones import today_local

CASES_FILE = Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "grade-cases.json"


def _cases() -> list[dict]:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))["cases"]


def test_shared_cases_cover_every_boundary():
    cases = _cases()
    todays = {case["today"] for case in cases}
    births = {case["birthday"] for case in cases}
    assert {"2026-07-31", "2026-08-01", "2027-01-31", "2027-02-01"} <= todays
    assert {"2023-09-01", "2023-09-02"} <= births
    assert any(case["expected_grade"] is None for case in cases)
    assert {case["expected_grade"] for case in cases} - {None} == set(constants.GRADES)


@pytest.mark.parametrize("case", _cases(), ids=lambda case: case["name"])
def test_shared_grade_cases(case):
    school_year, semester = academic.current_term(date.fromisoformat(case["today"]))
    assert [school_year, semester] == case["expected_term"]
    assert academic.grade_for_birthday(date.fromisoformat(case["birthday"]), school_year) == case["expected_grade"]


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 7, 31), (114, 2)),
        (date(2026, 8, 1), (115, 1)),
        (date(2026, 12, 31), (115, 1)),
        (date(2027, 1, 1), (115, 1)),
        (date(2027, 1, 31), (115, 1)),
        (date(2027, 2, 1), (115, 2)),
    ],
)
def test_current_term_boundaries(today, expected):
    """Review Focus 2：7/31 → 114 下、8/1 → 115 上、1/31 → 115 上、2/1 → 115 下。"""
    assert academic.current_term(today) == expected
    start, end = academic.term_bounds(*expected)
    assert start <= today <= end


def test_current_term_must_be_given_the_taipei_date():
    # UTC 7/31 16:00 已經是台北 8/1 00:00。呼叫端一律先 today_local()，不能拿 UTC 日期。
    late_utc = datetime(2026, 7, 31, 16, 0, tzinfo=timezone.utc)
    assert academic.current_term(today_local(late_utc)) == (115, 1)
    assert academic.current_term(late_utc.date()) == (114, 2)


def test_term_bounds_match_ivy():
    assert academic.term_bounds(115, 1) == (date(2026, 8, 1), date(2027, 1, 31))
    assert academic.term_bounds(115, 2) == (date(2027, 2, 1), date(2027, 7, 31))
    with pytest.raises(ValueError):
        academic.term_bounds(115, 3)


def test_roc_month_and_date():
    assert academic.roc_month(date(2026, 9, 8)) == "115.09"
    assert academic.roc_date(date(2026, 9, 8)) == "115.09.08"
    assert academic.roc_month(date(2027, 1, 31)) == "116.01"
    assert academic.ROC_MONTH_RE.match("115.09")
    assert not academic.ROC_MONTH_RE.match("115.9")
    assert not academic.ROC_MONTH_RE.match("115.13")


def test_shift_roc_month_crosses_years():
    assert academic.shift_roc_month("115.01", -1) == "114.12"
    assert academic.shift_roc_month("114.12", 1) == "115.01"
    assert academic.shift_roc_month("115.09", -12) == "114.09"
    with pytest.raises(ValueError):
        academic.shift_roc_month("115.9", 1)


def test_constants_follow_ivy_wording():
    assert constants.GRADES == ("幼幼班", "小班", "中班", "大班")
    assert len(constants.NO_DEPOSIT_REASONS) == 8
    grouped = [reason for reasons in constants.NO_DEPOSIT_PRIORITY.values() for reason in reasons]
    assert len(grouped) == len(set(grouped)) and set(grouped) < set(constants.NO_DEPOSIT_REASONS)
    # 「未註明／待追蹤」不屬於任何優先度（園務 shared.py 同）。
    assert set(constants.NO_DEPOSIT_REASONS) - set(grouped) == {"未註明／待追蹤"}
    assert list(constants.SOURCE_CATEGORIES) == [
        "sibling_current", "sibling_split", "sibling_graduate", "self_report", "referral",
        "invite_success", "invite_origin", "home_deposit", "returning",
    ]
    assert constants.STAGES == ("visited", "deposited", "enrolled", "withdrawn")
    assert set(constants.STAGE_LABELS) == set(constants.STAGES)
    assert constants.WITHDRAWN_FROM == ("deposited", "enrolled")
    assert set(constants.WEBSITE_ONLY_EVENT_TYPES) < set(constants.EVENT_TYPES)
    # 年級、未預繳原因都要塞得進欄位長度。
    assert max(len(g) for g in constants.GRADES) <= constants.LEN_GRADE
    assert max(len(r) for r in constants.NO_DEPOSIT_REASONS) <= constants.LEN_REASON_CODE
    assert len(constants.ANONYMIZED_TEXT) <= constants.LEN_CHILD_NAME
    assert len(constants.MISSING_CHILD_NAME) <= constants.LEN_CHILD_NAME
```

- [ ] **Step 3：寫失敗的 web 測試**

`web/tests/admission-grade-cases.spec.ts`（用 `readFileSync` 讀 repo 根目錄的 JSON，不依賴 vite 能不能 import `web/` 以外的檔案）：

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLASS_BY_OFFSET, academicYear, cohortOf, parseBirthday } from '../app/utils/admission-classes'

interface GradeCase {
  name: string
  birthday: string
  today: string
  expected_term: [number, number]
  expected_grade: string | null
}

const casesPath = fileURLToPath(new URL('../../contracts/ivy-recruitment/grade-cases.json', import.meta.url))
const cases = (JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: GradeCase[] }).cases

function ymd(value: string) {
  const parsed = parseBirthday(value)
  if (!parsed) throw new Error(`案例日期格式錯誤：${value}`)
  return parsed
}

// 官網分班表的規則：學年度減屆別 3＝幼幼班、6＝大班；7 是小一，招生年級不含。
function gradeOf(birthday: string, schoolYear: number): string | null {
  const offset = schoolYear - cohortOf(ymd(birthday))
  return offset >= 3 && offset <= 6 ? CLASS_BY_OFFSET[offset]! : null
}

describe('招生年級共用案例（contracts/ivy-recruitment/grade-cases.json）', () => {
  it('讀得到案例，沒有空轉', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15)
  })

  for (const c of cases) {
    it(c.name, () => {
      const schoolYear = academicYear(ymd(c.today))
      expect(schoolYear).toBe(c.expected_term[0])
      expect(gradeOf(c.birthday, schoolYear)).toBe(c.expected_grade)
    })
  }
})
```

- [ ] **Step 4：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_academic.py -q
```
Expected: FAIL（`ModuleNotFoundError: No module named 'app.admissions'`）。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/web && npx vitest run tests/admission-grade-cases.spec.ts
```
Expected: PASS（web 規則本來就存在；這支是等價性防線，案例檔在 Step 1 已建好）。若 FAIL，表示案例或官網分班規則有誤，停下來回報，不要改案例去遷就。

- [ ] **Step 5：建 package 與常數**

`backend/app/admissions/__init__.py`：空檔。

`backend/app/admissions/constants.py`：

```python
"""招生入學的固定列舉與欄位長度（規格 5.4）。文字照園務原文，A8 的契約測試
拿 contracts/ivy-recruitment/ivy-schema.json 鎖定；其他檔案一律從這裡匯入，
不另寫一份。"""

from __future__ import annotations

# 園務 ivy-frontend constants/recruitment.ts GRADES_ORDER；官網分班對照的「小一」不列入。
GRADES: tuple[str, ...] = ("幼幼班", "小班", "中班", "大班")

# 園務 api/recruitment/shared.py:43-52，順序照園務。
NO_DEPOSIT_REASONS: tuple[str, ...] = (
    "時程未到／仍在觀望",
    "已有其他就學選項／比較他校",
    "未註明／待追蹤",
    "距離／地點因素",
    "家庭照顧安排考量",
    "特殊需求／名額限制",
    "課程／環境仍在評估",
    "費用考量",
)
# 園務 shared.py:59-75 的轉換潛力分組；「未註明／待追蹤」不屬於任何一組。
NO_DEPOSIT_PRIORITY: dict[str, tuple[str, ...]] = {
    "high": ("時程未到／仍在觀望", "課程／環境仍在評估"),
    "medium": ("距離／地點因素", "費用考量", "家庭照顧安排考量"),
    "low": ("已有其他就學選項／比較他校", "特殊需求／名額限制"),
}

# 來源分類代碼 → 園務文案（models/recruitment_bonus.py:51-61 DEFAULT_POINT_CATALOG）。
# NULL＝待歸類。官網不算獎金，只保留代碼讓資料能轉回園務。
SOURCE_CATEGORIES: dict[str, str] = {
    "sibling_current": "在校生弟妹（兄姊老師）",
    "sibling_split": "在校兄姊二人均分",
    "sibling_graduate": "畢業生弟妹",
    "self_report": "自報生（廣告／鄰居／網路／假日活動）",
    "referral": "有緣名單（家長介紹／社區招生）",
    "invite_success": "邀約來園——邀約成功者",
    "invite_origin": "邀約來園——原本招生人",
    "home_deposit": "到家中收預繳",
    "returning": "舊生復學（獎金不計，考核 +1 另行人工）",
}

# 漏斗階段（園務 services/recruitment_funnel.py STAGES）。階段是推導出來的，不存欄位。
STAGES: tuple[str, ...] = ("visited", "deposited", "enrolled", "withdrawn")
STAGE_LABELS: dict[str, str] = {
    "visited": "已訪視",
    "deposited": "已預繳",
    "enrolled": "已註冊",
    "withdrawn": "退預繳／退註冊",
}

# recruitment_event_log.event_type。created 是官網延伸（園務不寫），匯出時不轉。
EVENT_TYPES: tuple[str, ...] = (
    "created",
    "deposit_added",
    "deposit_removed",
    "converted",
    "revert_converted",
    "withdrawn",
    "withdraw_cancelled",
    "seat_reserved",
    "seat_released",
)
WEBSITE_ONLY_EVENT_TYPES: tuple[str, ...] = ("created",)

# withdrawn_from：從哪一欄退出（退預繳／退註冊）。
WITHDRAWN_FROM: tuple[str, ...] = ("deposited", "enrolled")

# created 事件的 metadata_json.origin：手動新增，或由官網預約（已到場／補建）建立。
ORIGINS: tuple[str, ...] = ("manual", "visit_request")

ANONYMIZED_TEXT = "（已依保存政策匿名化）"
# 預約沒填孩子姓名時的招生訪視姓名（child_name NOT NULL），明細標示待補。
MISSING_CHILD_NAME = "（未填姓名）"

# 欄位長度（對齊園務 models/recruitment.py）
LEN_CHILD_NAME = 50
LEN_CONTACT = 50
LEN_PHONE = 100
LEN_ADDRESS = 200
LEN_DISTRICT = 30
LEN_SOURCE = 50
LEN_REFERRER = 50
LEN_COLLECTOR = 50
LEN_TOUR_GUIDE = 50
LEN_SOURCE_CATEGORY = 30
LEN_REASON_CODE = 60
LEN_GRADE = 20
LEN_MONTH = 10
LEN_SEQ_NO = 10
LEN_STAGE = 20
LEN_EVENT_TYPE = 40
# notes／parent_response／no_deposit_reason_detail／withdraw_reason／reason 的 API 上限（DB 是 Text）。
TEXT_MAX = 2000

# 民國學年的合理範圍（API 驗證用）：100＝西元 2011，200＝西元 2111。
SCHOOL_YEAR_MIN = 100
SCHOOL_YEAR_MAX = 200
```

- [ ] **Step 6：寫換算工具**

`backend/app/admissions/academic.py`：

```python
"""民國月份與日期、學年學期、年級換算（規格 6.4）。

- 學期同園務 utils/academic.py：上學期 8/1～隔年 1/31，下學期 2/1～7/31。
- 年級同園務 ivy-frontend gradeForBirthday：學年 N 以西元 (N+1911)/9/1（含）為
  足歲基準，2 歲幼幼班、3 歲小班、4 歲中班、5 歲大班，其餘回 None。與官網
  web/app/utils/admission-classes.ts 的屆別規則等價（共用案例
  contracts/ivy-recruitment/grade-cases.json）。

這裡只收 date，不碰時區：呼叫端一律先用 app.common.timezones.today_local()
取台北日期，不能用 date.today() 或 UTC 日期。"""

from __future__ import annotations

import re
from datetime import date

ROC_MONTH_RE = re.compile(r"^(\d{3})\.(0[1-9]|1[0-2])$")

_GRADE_BY_AGE = {2: "幼幼班", 3: "小班", 4: "中班", 5: "大班"}


def roc_month(day: date) -> str:
    """date(2026, 9, 8) → "115.09"（recruitment_visits.month）。"""
    return f"{day.year - 1911}.{day.month:02d}"


def roc_date(day: date) -> str:
    """date(2026, 9, 8) → "115.09.08"（匯出給園務的 visit_date 字串）。"""
    return f"{day.year - 1911}.{day.month:02d}.{day.day:02d}"


def current_term(today: date) -> tuple[int, int]:
    """台北日期所在的（民國學年, 學期）。8/1–12/31 → (Y-1911, 1)；
    1/1–1/31 → (Y-1912, 1)；2/1–7/31 → (Y-1912, 2)。"""
    if today.month >= 8:
        return today.year - 1911, 1
    if today.month >= 2:
        return today.year - 1912, 2
    return today.year - 1912, 1


def term_bounds(school_year: int, semester: int) -> tuple[date, date]:
    """學期的第一天與最後一天（含）。"""
    base = school_year + 1911
    if semester == 1:
        return date(base, 8, 1), date(base + 1, 1, 31)
    if semester == 2:
        return date(base + 1, 2, 1), date(base + 1, 7, 31)
    raise ValueError(f"學期只能是 1 或 2：{semester}")


def grade_for_birthday(birthday: date, school_year: int) -> str | None:
    """依生日與入學學年換算適讀班級；不在幼幼班～大班範圍回 None（不強帶）。"""
    age = school_year + 1911 - birthday.year
    if birthday.month > 9 or (birthday.month == 9 and birthday.day > 1):
        age -= 1
    return _GRADE_BY_AGE.get(age)


def shift_roc_month(month: str, delta: int) -> str:
    """"115.01", -1 → "114.12"。格式不是「民國年.兩位數月」丟 ValueError。"""
    match = ROC_MONTH_RE.match(month)
    if match is None:
        raise ValueError(f"月份格式應為 民國年.月，如 115.03：{month}")
    total = int(match.group(1)) * 12 + int(match.group(2)) - 1 + delta
    return f"{total // 12}.{total % 12 + 1:02d}"
```

- [ ] **Step 7：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_academic.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions/web && npx vitest run tests/admission-grade-cases.spec.ts
```
Expected: 後端 `29 passed`（共用案例 17＋邊界 6＋其餘 6 支）；web `18 passed`。

- [ ] **Step 8：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/__init__.py backend/app/admissions/constants.py backend/app/admissions/academic.py \
  contracts/ivy-recruitment/grade-cases.json backend/tests/test_admissions_academic.py web/tests/admission-grade-cases.spec.ts
git commit -m "feat(admissions): 招生列舉、民國月份學期與年級換算，後端與官網共用案例

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2：資料表、migration、權限與測試清表

**Files:**
- Create: `backend/app/admissions/models.py`
- Create: `backend/migrations/versions/4a7e2c9d1b63_admissions.py`
- Modify: `backend/app/operations/models.py`（`RetentionPolicy`，約 180–215 行：`__table_args__` 加一個 CheckConstraint、`open_overdue_days` 下面加 `admissions_days`）
- Modify: `backend/migrations/env.py`（第 14–22 行的 model 匯入區）
- Modify: `backend/tests/conftest.py`（`_clean_tables` 的 TRUNCATE 字串，約 117–133 行）
- Modify: `backend/app/auth/permissions.py`（`_CAPABILITY_ROLES`，`"booking.manage"` 那一項之後，約第 51 行）
- Modify: `admin/src/__tests__/fixtures.ts`（`ROLE_CAPABILITIES`，第 6–20 行）
- Test: `backend/tests/test_admissions_schema.py`

**Interfaces:**
- Consumes：A1 的 `constants.GRADES`、`NO_DEPOSIT_REASONS`、`SOURCE_CATEGORIES`、`WITHDRAWN_FROM`；`app.db.Base`；`app.operations.models.RETENTION_MIN_DAYS`、`RETENTION_MAX_DAYS`。
- Produces：
  - `app.admissions.models.RecruitmentVisit`、`RecruitmentEventLog`、`GradeIntakeTarget`（欄位見 Step 4；`RecruitmentVisit.events` 依 `created_at` 排序、`passive_deletes=True`）
  - `RetentionPolicy.admissions_days: int | None`
  - capability `admissions.read`／`admissions.write`（super_admin、campus_admin、reception）、`admissions.convert`（super_admin、campus_admin）
  - migration `4a7e2c9d1b63`（`down_revision = "c7d2e9f4a1b8"`）

- [ ] **Step 1：確認 alembic 只有一個 head**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic heads
ls migrations/versions | grep -c '^4a7e2c9d1b63' || true
```
Expected：`c7d2e9f4a1b8 (head)`；第二行輸出 `0`（ID 沒撞號）。head 不是 `c7d2e9f4a1b8` 就停下來回報，不要自己改 `down_revision`。

- [ ] **Step 2：寫失敗的測試**

`backend/tests/test_admissions_schema.py`：

```python
"""招生入學三張表的 migration、約束與權限（規格 5、7）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.auth.models import Role, User
from app.auth.permissions import effective_capabilities, has_capability, roles_with
from app.operations.models import RetentionPolicy

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "4a7e2c9d1b63_admissions.py"
TABLES = ("recruitment_visits", "recruitment_event_log", "grade_intake_targets")
CHECKS = {
    "ck_recruitment_visits_grade",
    "ck_recruitment_visits_provisional_grade",
    "ck_recruitment_visits_source_category",
    "ck_recruitment_visits_no_deposit_reason",
    "ck_recruitment_visits_withdrawn_from",
    "ck_recruitment_visits_target_semester",
    "ck_recruitment_visits_enrolled_on",
    "ck_grade_intake_targets_grade",
    "ck_grade_intake_targets_semester",
    "ck_grade_intake_targets_seats",
    "ck_retention_policies_admissions_days",
}
UNIQUES = {"uq_recruitment_visits_visit_request", "uq_recruitment_visits_seq", "uq_grade_intake_target"}


def _checks(model) -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in model.__table__.constraints if isinstance(c, CheckConstraint)}


def test_migration_follows_parent_self_booking_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("4a7e2c9d1b63").down_revision == "c7d2e9f4a1b8"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只建表、加可空欄位，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


def test_check_conditions_are_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    conditions = {
        **_checks(RecruitmentVisit),
        **_checks(GradeIntakeTarget),
        "ck_retention_policies_admissions_days": _checks(RetentionPolicy)["ck_retention_policies_admissions_days"],
    }
    assert set(conditions) == CHECKS
    for name, condition in conditions.items():
        assert f'"{name}"' in source, name
        assert f'"{condition}"' in source, f"{name} 的條件與 migration 不一致：{condition}"


@pytest.mark.asyncio
async def test_tables_columns_and_constraints_exist(app):
    async with app.state.engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable "
                    "FROM information_schema.columns WHERE table_name IN "
                    "('recruitment_visits', 'recruitment_event_log', 'grade_intake_targets', 'retention_policies')"
                )
            )
        ).all()
        names = set(
            (
                await conn.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid IN ("
                        "'recruitment_visits'::regclass, 'recruitment_event_log'::regclass, "
                        "'grade_intake_targets'::regclass, 'retention_policies'::regclass)"
                    )
                )
            ).scalars()
        )
    columns = {(table, column): (kind, length, nullable) for table, column, kind, length, nullable in rows}
    for model in (RecruitmentVisit, RecruitmentEventLog, GradeIntakeTarget):
        for column in model.__table__.columns:
            assert (model.__tablename__, column.name) in columns, f"{model.__tablename__}.{column.name}"
    assert columns[("recruitment_visits", "child_name")] == ("character varying", 50, "NO")
    assert columns[("recruitment_visits", "visit_date")] == ("date", None, "NO")
    assert columns[("recruitment_visits", "phone")] == ("character varying", 100, "YES")
    assert columns[("recruitment_visits", "address")] == ("character varying", 200, "YES")
    assert columns[("recruitment_visits", "no_deposit_reason")] == ("character varying", 60, "YES")
    assert columns[("recruitment_visits", "notes")] == ("text", None, "YES")
    assert columns[("recruitment_visits", "has_deposit")] == ("boolean", None, "NO")
    assert columns[("recruitment_visits", "created_at")] == ("timestamp with time zone", None, "NO")
    assert columns[("recruitment_event_log", "metadata_json")] == ("json", None, "YES")
    assert columns[("recruitment_event_log", "to_stage")] == ("character varying", 20, "NO")
    assert columns[("grade_intake_targets", "target_seats")] == ("integer", None, "NO")
    assert columns[("retention_policies", "admissions_days")] == ("integer", None, "YES")
    assert CHECKS | UNIQUES <= names


def _visit(**overrides) -> RecruitmentVisit:
    now = datetime.now(timezone.utc)
    values = {
        "id": uuid.uuid4(),
        "campus_key": "yihua",
        "month": "115.09",
        "visit_date": date(2026, 9, 8),
        "child_name": "王小明",
        "created_at": now,
        "updated_at": now,
        **overrides,
    }
    return RecruitmentVisit(**values)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"grade": "小一"},
        {"provisional_grade": "K1"},
        {"source_category": "tiktok"},
        {"no_deposit_reason": "其他"},
        {"withdrawn_from": "visited"},
        {"target_semester": 3},
        {"enrolled": True},  # 已註冊一定要有註冊日期
    ],
    ids=["grade", "provisional_grade", "source_category", "no_deposit_reason", "withdrawn_from", "semester", "enrolled_on"],
)
async def test_database_rejects_values_outside_ivy_enums(db_session, overrides):
    db_session.add(_visit(**overrides))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_seq_no_is_unique_per_campus_and_month(db_session):
    db_session.add(_visit(seq_no="1"))
    db_session.add(_visit(seq_no="1", campus_key="minghua"))
    db_session.add(_visit(seq_no="1", month="115.10"))
    await db_session.flush()
    db_session.add(_visit(seq_no="1"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


def test_admissions_capabilities():
    staff = {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION}
    assert roles_with("admissions.read") == staff
    assert roles_with("admissions.write") == staff
    assert roles_with("admissions.convert") == {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN}
    desk = User(role=Role.RECEPTION, capabilities=[])
    assert {"admissions.read", "admissions.write"} <= set(effective_capabilities(desk))
    assert not has_capability(desk, "admissions.convert")
    for role in (Role.EDITOR, Role.READONLY):
        caps = set(effective_capabilities(User(role=role, capabilities=[])))
        assert not caps & {"admissions.read", "admissions.write", "admissions.convert"}
```

- [ ] **Step 3：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_schema.py -q
```
Expected: FAIL（`ModuleNotFoundError: No module named 'app.admissions.models'`）。

- [ ] **Step 4：寫 model**

`backend/app/admissions/models.py`：

```python
"""招生入學三張表（規格 5.1–5.3）。表名與欄位名沿用園務 models/recruitment.py，
型別依官網慣例：uuid 主鍵、timestamptz、用 campus_key 取代 tenant_id。

列舉用 String＋CheckConstraint，條件字串由 constants 組出來，與 migration
4a7e2c9d1b63 的字面值逐字相同（tests/test_admissions_schema.py 檢查）。
created_at／updated_at 由程式填 datetime.now(timezone.utc)，沒有 server_default。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date as date_, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.admissions.constants import GRADES, NO_DEPOSIT_REASONS, SOURCE_CATEGORIES, WITHDRAWN_FROM
from app.db import Base


def _sql_in(column: str, values: Iterable[str], *, nullable: bool = True) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    condition = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {condition}" if nullable else condition


class RecruitmentVisit(Base):
    """招生訪視：一筆＝一個孩子的一次參觀（規格 5.1）。階段由 withdrawn_at、
    enrolled、has_deposit 推導（funnel.derive_stage），不另存欄位；這三個欄位
    與 enrolled_on、withdrawn_* 只能由狀態轉換改變。"""

    __tablename__ = "recruitment_visits"
    __table_args__ = (
        UniqueConstraint("visit_request_id", name="uq_recruitment_visits_visit_request"),
        UniqueConstraint("campus_key", "month", "seq_no", name="uq_recruitment_visits_seq"),
        CheckConstraint(_sql_in("grade", GRADES), name="ck_recruitment_visits_grade"),
        CheckConstraint(_sql_in("provisional_grade", GRADES), name="ck_recruitment_visits_provisional_grade"),
        CheckConstraint(_sql_in("source_category", SOURCE_CATEGORIES), name="ck_recruitment_visits_source_category"),
        CheckConstraint(_sql_in("no_deposit_reason", NO_DEPOSIT_REASONS), name="ck_recruitment_visits_no_deposit_reason"),
        CheckConstraint(_sql_in("withdrawn_from", WITHDRAWN_FROM), name="ck_recruitment_visits_withdrawn_from"),
        CheckConstraint("target_semester IS NULL OR target_semester IN (1, 2)", name="ck_recruitment_visits_target_semester"),
        CheckConstraint("enrolled = false OR enrolled_on IS NOT NULL", name="ck_recruitment_visits_enrolled_on"),
        Index("ix_recruitment_visits_campus_month", "campus_key", "month"),
        Index(
            "ix_recruitment_visits_campus_target",
            "campus_key",
            "target_school_year",
            "target_semester",
            "provisional_grade",
        ),
        Index("ix_recruitment_visits_campus_deposit", "campus_key", "has_deposit"),
        Index("ix_recruitment_visits_campus_grade", "campus_key", "grade"),
        Index("ix_recruitment_visits_withdrawn_at", "withdrawn_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    # 由官網預約建立（已到場或補建）時填入；一筆預約最多一筆招生訪視。
    visit_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True
    )
    # 民國月份「115.09」，後端依 visit_date 算，不接受前端直送。
    month: Mapped[str] = mapped_column(String(10), nullable=False)
    # 同校同月份內的序號（同月份現有最大開頭數字＋1），後端配號。
    seq_no: Mapped[str | None] = mapped_column(String(10), nullable=True)
    visit_date: Mapped[date_] = mapped_column(Date, nullable=False)
    child_name: Mapped[str] = mapped_column(String(50), nullable=False)
    birthday: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    # 適讀班級（四個年級名稱之一）。
    grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 主要聯絡人（不一定是家長，園務 rvcontact01）。
    contact_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 本次不填、不顯示，保留給之後的區域分析。
    district: Mapped[str | None] = mapped_column(String(30), nullable=True)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 園務表單稱「介紹者」、統計稱「接待人員」。
    referrer: Mapped[str | None] = mapped_column(String(50), nullable=True)
    deposit_collector: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 帶參觀老師：官網後台帳號＋姓名快照（轉移時依姓名對應園務員工）。
    tour_guide_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    tour_guide_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 園務九類來源代碼（constants.SOURCE_CATEGORIES）；NULL＝待歸類。
    source_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    has_deposit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    rides_bus: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 電訪後家長回應。
    parent_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 本次不提供勾選，保留給之後的熱點分析。
    geocoding_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    no_deposit_reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
    no_deposit_reason_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    enrolled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 註冊日期（官網延伸；園務以學生檔為準）。enrolled=true 時必填（CHECK）。
    enrolled_on: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    # 轉到其他學期（統計的「有效預繳」排除它）。
    transfer_term: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 保留座位的年級（園務 provisional_grade_id；官網沒有 class_grades，存名稱）。
    provisional_grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_school_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 非空即落在「退預繳／退註冊」。
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_from: Mapped[str | None] = mapped_column(String(20), nullable=True)
    withdraw_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 樂觀鎖：每次編輯、狀態轉換、保留座位、匿名化都加一。
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # 刪除訪視時歷程交給資料庫 ON DELETE CASCADE（async 不能 lazy load 再逐筆刪）。
    events: Mapped[list[RecruitmentEventLog]] = relationship(
        back_populates="visit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RecruitmentEventLog.created_at",
    )


class RecruitmentEventLog(Base):
    """招生歷程（規格 5.2）：階段變化、保留座位與建立。reason 是人員填的自由
    文字，保存政策匿名化時清掉；metadata_json 不放個資。"""

    __tablename__ = "recruitment_event_log"
    __table_args__ = (
        Index("ix_recruitment_event_log_visit_time", "recruitment_visit_id", "created_at"),
        Index("ix_recruitment_event_log_event_type", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recruitment_visit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recruitment_visits.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_stage: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit: Mapped[RecruitmentVisit] = relationship(back_populates="events")


class GradeIntakeTarget(Base):
    """各校各學年學期、各年級的計畫名額（規格 5.3）。沒有列＝「未設定」，
    與「計畫名額 0」分開顯示。"""

    __tablename__ = "grade_intake_targets"
    __table_args__ = (
        UniqueConstraint("campus_key", "grade", "school_year", "semester", name="uq_grade_intake_target"),
        CheckConstraint(_sql_in("grade", GRADES, nullable=False), name="ck_grade_intake_targets_grade"),
        CheckConstraint("semester IN (1, 2)", name="ck_grade_intake_targets_semester"),
        CheckConstraint("target_seats >= 0", name="ck_grade_intake_targets_seats"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    grade: Mapped[str] = mapped_column(String(20), nullable=False)
    school_year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    target_seats: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
```

`backend/app/operations/models.py` 的 `RetentionPolicy`：`__table_args__` 改成兩個約束，`open_overdue_days` 下面加欄位：

```python
    __table_args__ = (
        CheckConstraint(
            f"cancelled_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS} "
            f"AND completed_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS} "
            f"AND open_overdue_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS}",
            name="ck_retention_policies_days",
        ),
        CheckConstraint(
            f"admissions_days IS NULL OR admissions_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS}",
            name="ck_retention_policies_admissions_days",
        ),
    )
```

```python
    # 招生訪視（2026-10 招生入學規格 11）：最後更新後幾天匿名化。NULL＝不自動清理
    # （預設；天數待業主裁定）。
    admissions_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

- [ ] **Step 5：寫 migration**

`backend/migrations/versions/4a7e2c9d1b63_admissions.py`（條件字串寫字面值，不 import app；與 model 由 Step 2 的測試比對）：

```python
"""招生入學：recruitment_visits、recruitment_event_log、grade_intake_targets 三張表
（表名沿用園務），以及保存政策的招生訪視天數 retention_policies.admissions_days。

只新增表與可空欄位，不改既有資料，與上一版程式相容。CheckConstraint 的條件字串
與 app/admissions/models.py 逐字相同（tests/test_admissions_schema.py 檢查）。

Revision ID: 4a7e2c9d1b63
Revises: c7d2e9f4a1b8
Create Date: 2026-10-01
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "4a7e2c9d1b63"
down_revision = "c7d2e9f4a1b8"
branch_labels = None
depends_on = None

GRADE_CHECK = "grade IS NULL OR grade IN ('幼幼班', '小班', '中班', '大班')"
PROVISIONAL_GRADE_CHECK = "provisional_grade IS NULL OR provisional_grade IN ('幼幼班', '小班', '中班', '大班')"
SOURCE_CATEGORY_CHECK = "source_category IS NULL OR source_category IN ('sibling_current', 'sibling_split', 'sibling_graduate', 'self_report', 'referral', 'invite_success', 'invite_origin', 'home_deposit', 'returning')"
NO_DEPOSIT_REASON_CHECK = "no_deposit_reason IS NULL OR no_deposit_reason IN ('時程未到／仍在觀望', '已有其他就學選項／比較他校', '未註明／待追蹤', '距離／地點因素', '家庭照顧安排考量', '特殊需求／名額限制', '課程／環境仍在評估', '費用考量')"
WITHDRAWN_FROM_CHECK = "withdrawn_from IS NULL OR withdrawn_from IN ('deposited', 'enrolled')"
TARGET_SEMESTER_CHECK = "target_semester IS NULL OR target_semester IN (1, 2)"
ENROLLED_ON_CHECK = "enrolled = false OR enrolled_on IS NOT NULL"
TARGET_GRADE_CHECK = "grade IN ('幼幼班', '小班', '中班', '大班')"
TARGET_SEMESTER_ONLY_CHECK = "semester IN (1, 2)"
TARGET_SEATS_CHECK = "target_seats >= 0"
ADMISSIONS_DAYS_CHECK = "admissions_days IS NULL OR admissions_days BETWEEN 30 AND 3650"


def upgrade() -> None:
    op.create_table(
        "recruitment_visits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("visit_request_id", sa.Uuid(), sa.ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True),
        sa.Column("month", sa.String(10), nullable=False),
        sa.Column("seq_no", sa.String(10), nullable=True),
        sa.Column("visit_date", sa.Date(), nullable=False),
        sa.Column("child_name", sa.String(50), nullable=False),
        sa.Column("birthday", sa.Date(), nullable=True),
        sa.Column("grade", sa.String(20), nullable=True),
        sa.Column("phone", sa.String(100), nullable=True),
        sa.Column("contact_name", sa.String(50), nullable=True),
        sa.Column("address", sa.String(200), nullable=True),
        sa.Column("district", sa.String(30), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("referrer", sa.String(50), nullable=True),
        sa.Column("deposit_collector", sa.String(50), nullable=True),
        sa.Column("tour_guide_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tour_guide_name", sa.String(50), nullable=True),
        sa.Column("source_category", sa.String(30), nullable=True),
        sa.Column("has_deposit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("rides_bus", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("parent_response", sa.Text(), nullable=True),
        sa.Column("geocoding_consent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("no_deposit_reason", sa.String(60), nullable=True),
        sa.Column("no_deposit_reason_detail", sa.Text(), nullable=True),
        sa.Column("enrolled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("enrolled_on", sa.Date(), nullable=True),
        sa.Column("transfer_term", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("provisional_grade", sa.String(20), nullable=True),
        sa.Column("target_school_year", sa.Integer(), nullable=True),
        sa.Column("target_semester", sa.Integer(), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_from", sa.String(20), nullable=True),
        sa.Column("withdraw_reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("visit_request_id", name="uq_recruitment_visits_visit_request"),
        sa.UniqueConstraint("campus_key", "month", "seq_no", name="uq_recruitment_visits_seq"),
        sa.CheckConstraint(GRADE_CHECK, name="ck_recruitment_visits_grade"),
        sa.CheckConstraint(PROVISIONAL_GRADE_CHECK, name="ck_recruitment_visits_provisional_grade"),
        sa.CheckConstraint(SOURCE_CATEGORY_CHECK, name="ck_recruitment_visits_source_category"),
        sa.CheckConstraint(NO_DEPOSIT_REASON_CHECK, name="ck_recruitment_visits_no_deposit_reason"),
        sa.CheckConstraint(WITHDRAWN_FROM_CHECK, name="ck_recruitment_visits_withdrawn_from"),
        sa.CheckConstraint(TARGET_SEMESTER_CHECK, name="ck_recruitment_visits_target_semester"),
        sa.CheckConstraint(ENROLLED_ON_CHECK, name="ck_recruitment_visits_enrolled_on"),
    )
    op.create_index("ix_recruitment_visits_campus_month", "recruitment_visits", ["campus_key", "month"])
    op.create_index(
        "ix_recruitment_visits_campus_target",
        "recruitment_visits",
        ["campus_key", "target_school_year", "target_semester", "provisional_grade"],
    )
    op.create_index("ix_recruitment_visits_campus_deposit", "recruitment_visits", ["campus_key", "has_deposit"])
    op.create_index("ix_recruitment_visits_campus_grade", "recruitment_visits", ["campus_key", "grade"])
    op.create_index("ix_recruitment_visits_withdrawn_at", "recruitment_visits", ["withdrawn_at"])

    op.create_table(
        "recruitment_event_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "recruitment_visit_id",
            sa.Uuid(),
            sa.ForeignKey("recruitment_visits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("from_stage", sa.String(20), nullable=True),
        sa.Column("to_stage", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_recruitment_event_log_visit_time", "recruitment_event_log", ["recruitment_visit_id", "created_at"]
    )
    op.create_index("ix_recruitment_event_log_event_type", "recruitment_event_log", ["event_type"])

    op.create_table(
        "grade_intake_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("grade", sa.String(20), nullable=False),
        sa.Column("school_year", sa.Integer(), nullable=False),
        sa.Column("semester", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("target_seats", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("campus_key", "grade", "school_year", "semester", name="uq_grade_intake_target"),
        sa.CheckConstraint(TARGET_GRADE_CHECK, name="ck_grade_intake_targets_grade"),
        sa.CheckConstraint(TARGET_SEMESTER_ONLY_CHECK, name="ck_grade_intake_targets_semester"),
        sa.CheckConstraint(TARGET_SEATS_CHECK, name="ck_grade_intake_targets_seats"),
    )

    op.add_column("retention_policies", sa.Column("admissions_days", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_retention_policies_admissions_days", "retention_policies", ADMISSIONS_DAYS_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_retention_policies_admissions_days", "retention_policies", type_="check")
    op.drop_column("retention_policies", "admissions_days")
    op.drop_table("grade_intake_targets")
    op.drop_table("recruitment_event_log")
    op.drop_table("recruitment_visits")
```

- [ ] **Step 6：匯入 model、清表、權限、前端測試權限表**

`backend/migrations/env.py`：在 `from app.booking import access_models as booking_access_models  # noqa: F401` 下面加一行：

```python
from app.admissions import models as admissions_models  # noqa: F401
```

`backend/tests/conftest.py` 的 `_clean_tables`：把 `"retention_policies, retention_runs "` 這一行換成兩行：

```python
                "retention_policies, retention_runs, "
                "recruitment_event_log, recruitment_visits, grade_intake_targets "
```

`backend/app/auth/permissions.py`：在 `"booking.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},` 之後加：

```python
    # 招生入學（2026-10 規格 7；對應園務 RECRUITMENT_READ／WRITE／CONVERT）。訪視含
    # 孩子姓名、生日與家長手機，跟預約案件一樣只給總管理、分校管理與接待。
    "admissions.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION},
    # 新增／編輯／刪除訪視、標記與取消預繳、退預繳、取消退出、保留座位、設定計畫名額。
    "admissions.write": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION},
    # 標記註冊、取消註冊、退註冊（園務另要 STUDENTS_WRITE；官網沒有學生檔）。
    "admissions.convert": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
```

`admin/src/__tests__/fixtures.ts` 的 `ROLE_CAPABILITIES` 整段換成（照後端角色表，新增的三個鍵依字母排在 `CAMPUS_READ` 之後）：

```ts
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  super_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'audit.read_all', 'booking.cross_campus',
    'booking.export', 'booking.handle', 'booking.manage', 'booking.read', 'campuses.activate', 'campuses.manage',
    'content.manage', 'content.publish', 'content.release_restore', 'content.shared', 'media.manage',
    'notifications.manage', 'retention.manage', 'site_settings.manage', 'users.manage',
  ],
  campus_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'booking.handle', 'booking.manage',
    'booking.read', 'campuses.manage', 'content.manage', 'content.publish', 'media.manage',
  ],
  editor: [...CAMPUS_READ, 'content.manage', 'media.manage'],
  reception: [...CAMPUS_READ, 'admissions.read', 'admissions.write', 'booking.handle', 'booking.read'],
  readonly: [...CAMPUS_READ],
}
```

- [ ] **Step 7：升級測試庫並跑測試**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic upgrade head
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_schema.py -q
```
Expected: `12 passed`。

再驗證可逆（同一組環境變數）：

```bash
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic downgrade -1
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic upgrade head
```
Expected: 兩個指令都無錯誤；之後再跑一次 `tests/test_admissions_schema.py` 仍 `12 passed`。

既有測試不能被新約束或清表影響：

```bash
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_permission_table.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_retention_policy.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions && npm --prefix admin run test:unit -- --maxWorkers=2
```
Expected: 全部 PASS（`ROLE_CAPABILITIES` 只多了權限，既有畫面測試不受影響）。

- [ ] **Step 8：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/models.py backend/migrations/versions/4a7e2c9d1b63_admissions.py \
  backend/app/operations/models.py backend/migrations/env.py backend/tests/conftest.py \
  backend/app/auth/permissions.py admin/src/__tests__/fixtures.ts backend/tests/test_admissions_schema.py
git commit -m "feat(admissions): 招生三張表、保存政策招生天數欄位與招生權限

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3：訪視 CRUD、篩選選項、歷程與階段推導

**Files:**
- Create: `backend/app/admissions/funnel.py`（本 task 只有 `Stage`、`derive_stage`、`stage_condition`；調整第 1 條）
- Create: `backend/app/admissions/schemas.py`（訪視、歷程、選項；A4 起逐步加）
- Create: `backend/app/admissions/records.py`
- Create: `backend/app/admissions/routes.py`
- Modify: `backend/app/main.py`（第 24 行 `from app.booking.routes import router as booking_router` 之前加 import；第 213 行 `app.include_router(operations_router)` 之後加 include）
- Modify: `admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS` 第 373–452 行、`AUDIT_TARGET_LABELS` 第 524–541 行、`RETENTION_CATEGORY_LABELS` 之前、`AUDIT_METADATA_FORMATTERS` 第 1107–1218 行；調整第 14 條）
- Create: `backend/tests/admissions_helpers.py`
- Test: `backend/tests/test_admissions_records.py`

**Interfaces:**
- Consumes：A1 `constants.*`、`academic.roc_month`、`academic.current_term`；A2 `RecruitmentVisit`、`RecruitmentEventLog`、capability `admissions.read`／`admissions.write`；`app.booking.schemas.has_control_chars`；`app.campuses.models.CAMPUS_KEYS`；`app.auth.permissions.require_scope`、`ScopeDenied`；`app.operations.audit_service.log_action`；`app.common.timezones.today_local`。
- Produces：
  - `funnel.Stage`、`funnel.derive_stage(visit) -> Stage`、`funnel.stage_condition(stage: str)`（SQL 條件；未知階段丟 `ValueError`）
  - `schemas.Grade`、`NoDepositReason`、`SourceCategory`（由 constants 組成的 `Literal`）、`clean_text`、`RecruitmentVisitCreate`、`RecruitmentVisitUpdate`、`RecruitmentVisitOut`（`stage`、`has_visit_request` 是 `computed_field`）、`RecruitmentEventOut`（多 `actor_user_id`、`actor_name`）、`NoDepositReasonOption`、`AdmissionsOptionsOut`
  - `records.RecordNotFound`、`VersionConflict(current_version)`、`TourGuideNotFound`、`create_visit(...)`、`get_visit_for_update(db, visit_id)`、`update_visit(...) -> list[str]`、`delete_visit(...)`、`write_event(..., created_at=None)`、`RecruitmentVisitFilters`、`options(db, campus_key) -> dict`
  - API：`GET /admin/admissions/options`、`GET|POST /admin/admissions/records`、`GET|PATCH|DELETE /admin/admissions/records/{visit_id}`、`GET /admin/admissions/records/{visit_id}/events`
  - 錯誤碼：409 `RECRUITMENT_VISIT_VERSION_CONFLICT`（帶 `current_version`）、422 `TOUR_GUIDE_INVALID`
  - 稽核：`recruitment_visit.create`（`origin`）、`recruitment_visit.update`（`fields`）、`recruitment_visit.delete`（`stage`）
  - 測試共用：`tests/admissions_helpers.py` 的 `API`、`ADMISSIONS`、`unique_phone()`、`manual_fields(**overrides)`、`create_record(client, campus_key="yihua", **overrides)`，fixture `campus_admin_yihua_client`、`reception_yihua_client`、`readonly_yihua_client`

- [ ] **Step 1：寫測試共用 helper**

`backend/tests/admissions_helpers.py`：

```python
"""招生入學測試共用的資料與帳號（A3 建立；A4 加 transition，A6 加已開始場次的預約）。

- 手動新增訪視的最小欄位、用 API 建一筆訪視。
- 各角色的義華帳號 client。測試檔用
  `from tests.admissions_helpers import reception_yihua_client  # noqa: F401`
  匯入 fixture（pytest 認得模組裡匯入的 fixture）。
- 同校同手機 10 分鐘內最多送 5 筆預約（SUBMIT_LIMIT_BY_PHONE），建預約一律用
  unique_phone() 換號碼。"""

from __future__ import annotations

import itertools

import pytest_asyncio

from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
ADMISSIONS = f"{API}/admin/admissions"

_PHONES = itertools.count(30_000_001)


def unique_phone() -> str:
    """09 開頭 10 碼，每次呼叫都不同。"""
    return f"09{next(_PHONES):08d}"


def manual_fields(**overrides) -> dict:
    """手動新增訪視的必填欄位（規格 6.1 第 3 點）：參觀日期、幼生姓名、生日、入學學年學期。"""
    body = {
        "visit_date": "2026-09-08",
        "child_name": "王小明",
        "birthday": "2023-03-02",
        "target_school_year": 115,
        "target_semester": 1,
    }
    body.update(overrides)
    return body


async def create_record(client, campus_key: str = "yihua", **overrides) -> dict:
    response = await client.post(f"{ADMISSIONS}/records?campus_key={campus_key}", json=manual_fields(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


async def _staff_client(app, db_session, email: str, role: Role):
    password = f"{email.split('@')[0]}-password-123"
    await _create_user(db_session, email, password, role, ["yihua"])
    return await _logged_in_client(app, email, password)


@pytest_asyncio.fixture
async def campus_admin_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-admin-yihua@ivy.example", Role.CAMPUS_ADMIN)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def reception_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-reception-yihua@ivy.example", Role.RECEPTION)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def readonly_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-readonly-yihua@ivy.example", Role.READONLY)
    yield client
    await client.aclose()
```

- [ ] **Step 2：寫失敗的測試（第一段：建立、序號、必填與列舉）**

`backend/tests/test_admissions_records.py`：

```python
"""招生訪視的新增、查詢、編輯、刪除、歷程與篩選選項（規格 5、6.1 第 3 點、6.2、6.6、
7、13；R02、R03、R05 編輯部分、R06 讀取部分、R07）。"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select, update

from app.admissions import constants, funnel
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.auth.models import Role
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    create_record,
    manual_fields,
    readonly_yihua_client,
    reception_yihua_client,
)
from tests.conftest import _create_user, legacy_request

RECORDS = f"{ADMISSIONS}/records"


async def _audit(db_session, action: str) -> list[AuditLogEntry]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


def _locations(response) -> list[list]:
    return [error["loc"] for error in response.json()["detail"]]


@pytest.mark.asyncio
async def test_create_computes_month_seq_and_writes_created_event(admin_client, db_session):
    first = await create_record(
        admin_client, child_name="王小明", visit_date="2026-09-08", grade="小班",
        phone="0912-345-678", contact_name="王媽媽", source="親友介紹", notes="  想了解午睡  ",
    )
    second = await create_record(admin_client, child_name="陳小華", visit_date="2026-09-30")
    october = await create_record(admin_client, child_name="林小安", visit_date="2026-10-01")
    minghua = await create_record(admin_client, "minghua", child_name="李小美", visit_date="2026-09-08")

    assert (first["month"], first["seq_no"]) == ("115.09", "1")
    assert (second["month"], second["seq_no"]) == ("115.09", "2")
    assert (october["month"], october["seq_no"]) == ("115.10", "1")
    assert (minghua["month"], minghua["seq_no"]) == ("115.09", "1")
    assert first["stage"] == "visited" and first["has_visit_request"] is False
    assert (first["has_deposit"], first["enrolled"], first["version"]) == (False, False, 1)
    assert first["notes"] == "想了解午睡"
    assert first["phone"] == "0912-345-678"
    assert (first["target_school_year"], first["target_semester"]) == (115, 1)

    events = (await admin_client.get(f"{RECORDS}/{first['id']}/events")).json()
    assert [(e["event_type"], e["from_stage"], e["to_stage"]) for e in events] == [("created", None, "visited")]
    assert events[0]["metadata_json"] == {"origin": "manual"}
    assert events[0]["actor_name"] == "admin@ivy.example"

    entries = await _audit(db_session, "recruitment_visit.create")
    assert len(entries) == 4
    assert {(e.target_type, e.campus_key) for e in entries} == {("recruitment_visit", "yihua"), ("recruitment_visit", "minghua")}
    assert all(e.metadata_json == {"origin": "manual"} for e in entries)
    dumped = json.dumps([e.metadata_json for e in entries], ensure_ascii=False)
    assert "王小明" not in dumped and "0912" not in dumped


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["visit_date", "child_name", "birthday", "target_school_year", "target_semester"])
async def test_create_requires_the_four_ivy_fields(admin_client, field):
    """R02：園務表單的必填（參觀日期、幼生姓名、生日、入學學年學期），缺任何一個 422 指到該欄位。"""
    body = manual_fields()
    body.pop(field)
    response = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=body)
    assert response.status_code == 422, response.text
    assert any(loc[-1] == field for loc in _locations(response))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"child_name": "   "}, "child_name"),
        ({"child_name": "王" * 51}, "child_name"),
        ({"visit_date": None}, "visit_date"),
        ({"target_semester": 3}, "target_semester"),
        ({"target_school_year": 99}, "target_school_year"),
        ({"grade": "小一"}, "grade"),
        ({"no_deposit_reason": "其他"}, "no_deposit_reason"),
        ({"source_category": "tiktok"}, "source_category"),
        ({"address": "路" * 201}, "address"),
        ({"notes": "字" * (constants.TEXT_MAX + 1)}, "notes"),
        ({"notes": "含控制字元\x00"}, "notes"),
        ({"has_deposit": True}, "has_deposit"),
        ({"enrolled": True}, "enrolled"),
        ({"enrolled_on": "2026-09-08"}, "enrolled_on"),
        ({"withdrawn_at": "2026-09-08T00:00:00Z"}, "withdrawn_at"),
        ({"provisional_grade": "小班"}, "provisional_grade"),
        ({"month": "115.09"}, "month"),
        ({"seq_no": "7"}, "seq_no"),
        ({"district": "苓雅區"}, "district"),
    ],
)
async def test_create_rejects_invalid_and_state_fields(admin_client, change, field):
    """R02＋調整第 11 條：列舉外的值、超長、狀態欄位與後端算的欄位一律 422，loc 指到該欄位。"""
    response = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields(**change))
    assert response.status_code == 422, response.text
    assert any(field in loc for loc in _locations(response)), response.text


@pytest.mark.asyncio
async def test_tour_guide_must_exist_and_name_is_snapshotted(admin_client, db_session):
    missing = await admin_client.post(
        f"{RECORDS}?campus_key=yihua", json=manual_fields(tour_guide_user_id=str(uuid.uuid4()))
    )
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TOUR_GUIDE_INVALID"

    guide = await _create_user(db_session, "guide-yihua@ivy.example", "guide-yihua-password-123", Role.RECEPTION, ["yihua"])
    guide.display_name = "林老師"
    await db_session.commit()
    snapshot = await create_record(admin_client, tour_guide_user_id=str(guide.id))
    assert (snapshot["tour_guide_user_id"], snapshot["tour_guide_name"]) == (str(guide.id), "林老師")
    typed = await create_record(admin_client, tour_guide_user_id=str(guide.id), tour_guide_name="林老師（代班）")
    assert typed["tour_guide_name"] == "林老師（代班）"


@pytest.mark.asyncio
async def test_concurrent_creates_get_distinct_seq_numbers(admin_client):
    """R03：同校同月份並行新增，序號不重複（pg_advisory_xact_lock 排隊後再取最大值）。"""
    responses = await asyncio.gather(
        *(
            admin_client.post(
                f"{RECORDS}?campus_key=yihua", json=manual_fields(child_name=f"並行{n}", visit_date="2026-09-15")
            )
            for n in range(6)
        )
    )
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert sorted(int(r.json()["seq_no"]) for r in responses) == [1, 2, 3, 4, 5, 6]
```

同一檔接著寫（第二段：列表、選項、編輯、刪除、權限）：

```python
@pytest.mark.asyncio
async def test_list_filters_and_paging(admin_client, db_session):
    a = await create_record(
        admin_client, child_name="甲", visit_date="2026-09-03", grade="小班", source="Facebook",
        referrer="林老師", no_deposit_reason="時程未到／仍在觀望",
    )
    b = await create_record(
        admin_client, child_name="乙", visit_date="2026-10-05", grade="中班", source="親友介紹",
        target_school_year=115, target_semester=2,
    )
    c = await create_record(admin_client, child_name="丙", visit_date="2026-09-20", notes="打折要 100% 確認")
    await create_record(admin_client, "minghua", child_name="丁", visit_date="2026-09-20")
    # 乙已預繳（狀態只能走轉換；這裡直接改資料庫，只測篩選）。甲連到一筆官網預約。
    request_id = await legacy_request(db_session, status="completed")
    await db_session.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(b["id"])).values(has_deposit=True))
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(a["id"])).values(visit_request_id=uuid.UUID(request_id))
    )
    await db_session.commit()

    async def names(query: str) -> list[str]:
        response = await admin_client.get(f"{RECORDS}?campus_key=yihua&{query}")
        assert response.status_code == 200, response.text
        return [row["child_name"] for row in response.json()]

    assert await names("") == ["乙", "丙", "甲"]  # 參觀日期新到舊
    assert await names("month=115.09") == ["丙", "甲"]
    assert await names("grade=小班") == ["甲"]
    assert await names("target_school_year=115&target_semester=2") == ["乙"]
    assert await names("source=Facebook") == ["甲"]
    assert await names("referrer=林老師") == ["甲"]
    assert await names("has_deposit=true") == ["乙"]
    assert await names("has_deposit=false") == ["丙", "甲"]
    assert await names("stage=deposited") == ["乙"]
    assert await names("stage=visited") == ["丙", "甲"]
    assert await names(f"no_deposit_reason={constants.NO_DEPOSIT_REASONS[0]}") == ["甲"]
    assert await names(f"visit_request_id={request_id}") == ["甲"]
    # 使用者打的 % 是字面值，不是萬用字元。
    assert await names("q=100%25") == ["丙"]
    assert await names("q=%25") == ["丙"]
    assert await names("page_size=2") == ["乙", "丙"]
    assert await names("page_size=2&page=2") == ["甲"]
    linked = (await admin_client.get(f"{RECORDS}/{a['id']}")).json()
    assert linked["has_visit_request"] is True and linked["visit_request_id"] == request_id
    assert c["has_visit_request"] is False
    for bad in ("month=115.9", "stage=lost", "grade=小一", "page_size=101", "target_semester=3"):
        assert (await admin_client.get(f"{RECORDS}?campus_key=yihua&{bad}")).status_code == 422, bad


@pytest.mark.asyncio
async def test_options_lists_months_sources_and_ivy_enums(admin_client):
    await create_record(admin_client, visit_date="2026-09-08", source="Facebook", referrer="林老師")
    await create_record(admin_client, visit_date="2026-10-02", source="Facebook", referrer="張老師")
    await create_record(admin_client, visit_date="2026-08-20", source="親友介紹")
    await create_record(admin_client, "minghua", visit_date="2026-07-01", source="明華限定", referrer="明華老師")

    response = await admin_client.get(f"{ADMISSIONS}/options?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["months"] == ["115.10", "115.09", "115.08"]
    assert body["sources"] == ["Facebook", "親友介紹"]  # 次數多的在前
    assert sorted(body["referrers"]) == ["張老師", "林老師"]
    assert body["grades"] == list(constants.GRADES)
    assert [r["value"] for r in body["no_deposit_reasons"]] == list(constants.NO_DEPOSIT_REASONS)
    priority = {r["value"]: r["priority"] for r in body["no_deposit_reasons"]}
    assert priority["時程未到／仍在觀望"] == "high"
    assert priority["費用考量"] == "medium"
    assert priority["特殊需求／名額限制"] == "low"
    assert priority["未註明／待追蹤"] is None
    assert list(body["source_categories"].items()) == list(constants.SOURCE_CATEGORIES.items())


@pytest.mark.asyncio
async def test_patch_uses_fields_set_and_optimistic_lock(admin_client, db_session):
    """R05 編輯部分：沒送的欄位不動、送 null 清空；後送的舊版本 409，資料不被覆蓋。"""
    record = await create_record(admin_client, notes="第一次", phone="0912345678")
    url = f"{RECORDS}/{record['id']}"
    updated = await admin_client.patch(url, json={"expected_version": 1, "notes": None, "referrer": "林老師"})
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert (body["notes"], body["referrer"], body["phone"], body["version"]) == (None, "林老師", "0912345678", 2)

    stale = await admin_client.patch(url, json={"expected_version": 1, "notes": "蓋掉別人的修改"})
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == 2
    assert (await admin_client.get(url)).json()["notes"] is None

    # 送了但值沒變：不加版本、不寫稽核。
    same = await admin_client.patch(url, json={"expected_version": 2, "referrer": "林老師"})
    assert same.status_code == 200 and same.json()["version"] == 2
    [entry] = await _audit(db_session, "recruitment_visit.update")
    assert sorted(entry.metadata_json["fields"]) == ["notes", "referrer"]
    assert set(entry.metadata_json) == {"fields"}


@pytest.mark.asyncio
async def test_patch_rejects_state_fields_and_clearing_required(admin_client):
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    for change, field in (
        ({"has_deposit": True}, "has_deposit"),
        ({"enrolled": True}, "enrolled"),
        ({"enrolled_on": "2026-09-30"}, "enrolled_on"),
        ({"withdrawn_from": "deposited"}, "withdrawn_from"),
        ({"withdraw_reason": "改送他校"}, "withdraw_reason"),
        ({"provisional_grade": "小班"}, "provisional_grade"),
        ({"month": "115.01"}, "month"),
        ({"seq_no": "9"}, "seq_no"),
        ({"version": 5}, "version"),
        ({"child_name": None}, "child_name"),
        ({"visit_date": None}, "visit_date"),
        ({"target_school_year": None}, "target_school_year"),
        ({"target_semester": None}, "target_semester"),
    ):
        response = await admin_client.patch(url, json={"expected_version": 1, **change})
        assert response.status_code == 422, (change, response.text)
        assert any(field in loc for loc in _locations(response)), response.text
    assert (await admin_client.patch(url, json={"notes": "沒帶版本"})).status_code == 422
    assert (await admin_client.get(url)).json()["version"] == 1


@pytest.mark.asyncio
async def test_patch_visit_date_moves_month_and_reassigns_seq(admin_client):
    september = await create_record(admin_client, visit_date="2026-09-08")
    october = await create_record(admin_client, visit_date="2026-10-02")
    moved = await admin_client.patch(f"{RECORDS}/{september['id']}", json={"expected_version": 1, "visit_date": "2026-10-20"})
    assert moved.status_code == 200, moved.text
    assert (moved.json()["month"], moved.json()["seq_no"]) == ("115.10", "2")
    assert october["seq_no"] == "1"
```

同一檔接著寫（第三段：刪除、權限、校區、階段推導）：

```python
@pytest.mark.asyncio
async def test_delete_requires_version_and_cascades_events(admin_client, db_session):
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    stale = await admin_client.delete(f"{url}?expected_version=9")
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["current_version"] == 1
    gone = await admin_client.delete(f"{url}?expected_version=1")
    assert gone.status_code == 204, gone.text
    assert (await admin_client.get(url)).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(RecruitmentEventLog)) == 0
    [entry] = await _audit(db_session, "recruitment_visit.delete")
    assert (entry.target_id, entry.campus_key, entry.metadata_json) == (record["id"], "yihua", {"stage": "visited"})


@pytest.mark.asyncio
async def test_reception_writes_but_editor_and_readonly_get_403(
    admin_client, reception_yihua_client, editor_client, readonly_yihua_client
):
    """R06 讀取部分：editor、readonly 沒有招生權限，讀也是 403；接待可以新增與編輯。"""
    record = await create_record(admin_client)
    by_desk = await create_record(reception_yihua_client, child_name="櫃台建的")
    assert by_desk["seq_no"] == "2"
    edited = await reception_yihua_client.patch(f"{RECORDS}/{record['id']}", json={"expected_version": 1, "notes": "櫃台補記"})
    assert edited.status_code == 200, edited.text
    for client in (editor_client, readonly_yihua_client):
        for path in (
            f"{RECORDS}?campus_key=yihua",
            f"{RECORDS}/{record['id']}",
            f"{RECORDS}/{record['id']}/events",
            f"{ADMISSIONS}/options?campus_key=yihua",
        ):
            assert (await client.get(path)).status_code == 403, path
        assert (await client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields())).status_code == 403


@pytest.mark.asyncio
async def test_other_campus_and_unknown_ids_get_404(admin_client, minghua_client):
    """R07：分校帳號改 campus_key、用訪視 id 存取他校，一律 404。"""
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    assert (await minghua_client.get(url)).status_code == 404
    assert (await minghua_client.get(f"{url}/events")).status_code == 404
    assert (await minghua_client.patch(url, json={"expected_version": 1, "notes": "越權"})).status_code == 404
    assert (await minghua_client.delete(f"{url}?expected_version=1")).status_code == 404
    assert (await minghua_client.get(f"{RECORDS}?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get(f"{ADMISSIONS}/options?campus_key=yihua")).status_code == 404
    assert (await minghua_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields())).status_code == 404
    assert (await admin_client.get(f"{RECORDS}/{uuid.uuid4()}")).status_code == 404
    assert (await admin_client.get(f"{RECORDS}?campus_key=nowhere")).status_code == 404
    assert (await admin_client.post(f"{RECORDS}?campus_key=nowhere", json=manual_fields())).status_code == 404
    assert (await create_record(minghua_client, "minghua"))["campus_key"] == "minghua"
    assert (await admin_client.get(url)).json()["notes"] is None


@pytest.mark.asyncio
async def test_stage_condition_matches_derive_stage(db_session):
    """規格 6.2：SQL 的 stage_condition 與 Python 的 derive_stage 規則相同（退出最優先）。"""
    now = datetime.now(timezone.utc)

    def visit(name: str, **state) -> RecruitmentVisit:
        return RecruitmentVisit(
            id=uuid.uuid4(), campus_key="yihua", month="115.09", visit_date=date(2026, 9, 8), child_name=name,
            created_at=now, updated_at=now, **state,
        )

    rows = [
        visit("訪"),
        visit("預", has_deposit=True),
        visit("註", has_deposit=True, enrolled=True, enrolled_on=date(2026, 9, 30)),
        visit("退預", withdrawn_at=now, withdrawn_from="deposited"),
        visit("退註", withdrawn_at=now, withdrawn_from="enrolled", enrolled=True, enrolled_on=date(2026, 9, 30)),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    assert [funnel.derive_stage(row) for row in rows] == ["visited", "deposited", "enrolled", "withdrawn", "withdrawn"]
    for stage in constants.STAGES:
        found = set(
            (await db_session.execute(select(RecruitmentVisit.child_name).where(funnel.stage_condition(stage)))).scalars()
        )
        assert found == {row.child_name for row in rows if funnel.derive_stage(row) == stage}, stage
    with pytest.raises(ValueError):
        funnel.stage_condition("lost")
    assert funnel.STAGE_VALUES == constants.STAGES
```

- [ ] **Step 3：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_records.py -q
```
Expected: FAIL（collection error：`ImportError: cannot import name 'funnel' from 'app.admissions'`）。

- [ ] **Step 4：階段推導 `funnel.py`（A4 再加轉換與看板）**

`backend/app/admissions/funnel.py`：

```python
"""招生漏斗：階段推導（規格 6.2）。A4 在這個檔加狀態轉換、權限對照與看板。

階段不存欄位，一律由 withdrawn_at、enrolled、has_deposit 推導（園務
services/recruitment_funnel.py derive_stage，「有學生檔」換成 enrolled 旗標）：
Python 端用 derive_stage，SQL 端用 stage_condition，兩者規則相同。

records.py 在函式內匯入 stage_condition：本檔 A4 起在模組層匯入 records.write_event，
records 若也在模組層匯入本檔會循環匯入。"""

from __future__ import annotations

from typing import Literal, get_args

from sqlalchemy import and_

from app.admissions.models import RecruitmentVisit

Stage = Literal["visited", "deposited", "enrolled", "withdrawn"]
# 與 constants.STAGES 相同（tests/test_admissions_records.py 檢查）。
STAGE_VALUES: tuple[str, ...] = get_args(Stage)


def derive_stage(visit) -> Stage:
    """visit 可以是 RecruitmentVisit，也可以是任何有 withdrawn_at、enrolled、
    has_deposit 三個屬性的物件（RecruitmentVisitOut 的 stage 欄位也用這支）。"""
    if visit.withdrawn_at is not None:
        return "withdrawn"
    if visit.enrolled:
        return "enrolled"
    if visit.has_deposit:
        return "deposited"
    return "visited"


def stage_condition(stage: str):
    """與 derive_stage 相同規則的 SQL 條件；未知階段丟 ValueError。"""
    active = RecruitmentVisit.withdrawn_at.is_(None)
    if stage == "withdrawn":
        return RecruitmentVisit.withdrawn_at.is_not(None)
    if stage == "enrolled":
        return and_(active, RecruitmentVisit.enrolled.is_(True))
    if stage == "deposited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(True))
    if stage == "visited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(False))
    raise ValueError(f"未知的招生階段：{stage}")
```

- [ ] **Step 5：訪視、歷程與選項的 schema**

`backend/app/admissions/schemas.py`（A4 起在檔尾加轉換、看板、座位、名額、預約的 schema）：

```python
"""招生入學 API 的 request／response schema（規格 5、13）。

- 建立、編輯、狀態轉換、座位、名額的 request 一律 extra="forbid"（A 計畫調整第 11 條）：
  送狀態欄位（has_deposit、enrolled、enrolled_on、withdrawn_*、provisional_grade）或
  後端算的欄位（month、seq_no、version）會得到 FastAPI 標準 422，loc 指到該欄位。
- 文字欄位去掉頭尾空白，空字串當沒填（None）；不收控制字元（同預約）。
- 列舉一律由 constants 組成 Literal，不在這裡重寫一份。
- RecruitmentVisitUpdate 用 model_fields_set 區分「沒送」與「送 null 清空」。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, computed_field, field_validator

from app.admissions import constants
from app.admissions.funnel import Stage, derive_stage
from app.booking.schemas import has_control_chars
from app.common.timezones import today_local

Grade = Literal[constants.GRADES]
NoDepositReason = Literal[constants.NO_DEPOSIT_REASONS]
SourceCategory = Literal[tuple(constants.SOURCE_CATEGORIES)]
WithdrawnFrom = Literal[constants.WITHDRAWN_FROM]
EventType = Literal[constants.EVENT_TYPES]
Priority = Literal[tuple(constants.NO_DEPOSIT_PRIORITY)]
SchoolYear = Annotated[int, Field(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX)]
Semester = Annotated[int, Field(ge=1, le=2)]


def clean_text(value):
    """去頭尾空白；空字串回 None；含控制字元丟 ValueError（換行、TAB 可以）。"""
    if not isinstance(value, str):
        return value
    if has_control_chars(value):
        raise ValueError("內容含有不允許的控制字元")
    return value.strip() or None


OptionalText = Annotated[str | None, AfterValidator(clean_text)]


def _required_text(value: str | None, message: str) -> str:
    cleaned = clean_text(value)
    if cleaned is None:
        raise ValueError(message)
    return cleaned


def _not_future(value: date | None) -> date | None:
    if value is not None and value > today_local():
        raise ValueError("生日不能晚於今天")
    return value


class _VisitEditable(BaseModel):
    """新增與編輯共用、表單可以直接填的欄位。預繳、註冊、退出、保留座位只能
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district、
    geocoding_consent_at 本次不填（規格 5.1），也不收。"""

    model_config = ConfigDict(extra="forbid")

    grade: Grade | None = None
    phone: OptionalText = Field(default=None, max_length=constants.LEN_PHONE)
    contact_name: OptionalText = Field(default=None, max_length=constants.LEN_CONTACT)
    address: OptionalText = Field(default=None, max_length=constants.LEN_ADDRESS)
    source: OptionalText = Field(default=None, max_length=constants.LEN_SOURCE)
    referrer: OptionalText = Field(default=None, max_length=constants.LEN_REFERRER)
    deposit_collector: OptionalText = Field(default=None, max_length=constants.LEN_COLLECTOR)
    # 帶參觀老師：後台帳號；沒給 tour_guide_name 時用該帳號的顯示名稱當姓名快照。
    tour_guide_user_id: uuid.UUID | None = None
    tour_guide_name: OptionalText = Field(default=None, max_length=constants.LEN_TOUR_GUIDE)
    source_category: SourceCategory | None = None
    rides_bus: bool = False
    transfer_term: bool = False
    notes: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    parent_response: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    no_deposit_reason: NoDepositReason | None = None
    no_deposit_reason_detail: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)


class RecruitmentVisitCreate(_VisitEditable):
    """手動新增（規格 6.1 第 3 點）。必填同園務表單：參觀日期、幼生姓名、生日、
    入學學年學期。campus_key 放 query（同 POST /admin/slots）。"""

    visit_date: date
    child_name: str = Field(min_length=1, max_length=constants.LEN_CHILD_NAME)
    birthday: date
    target_school_year: SchoolYear
    target_semester: Semester

    @field_validator("child_name")
    @classmethod
    def _child_name(cls, value: str) -> str:
        return _required_text(value, "請填寫幼生姓名")

    @field_validator("birthday")
    @classmethod
    def _birthday(cls, value: date) -> date:
        return _not_future(value)


class RecruitmentVisitUpdate(_VisitEditable):
    """編輯（規格 6.6）。只改有送的欄位；送 null 代表清空，但姓名、參觀日期、
    入學學年學期不能清空。"""

    # 畫面載入時的 version；不符回 409 RECRUITMENT_VISIT_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)
    visit_date: date | None = None
    child_name: str | None = Field(default=None, min_length=1, max_length=constants.LEN_CHILD_NAME)
    birthday: date | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None

    @field_validator("child_name")
    @classmethod
    def _child_name(cls, value: str | None) -> str:
        return _required_text(value, "幼生姓名不能清空")

    @field_validator("visit_date", "target_school_year", "target_semester")
    @classmethod
    def _not_cleared(cls, value):
        if value is None:
            raise ValueError("這個欄位不能清空")
        return value

    @field_validator("birthday")
    @classmethod
    def _birthday(cls, value: date | None) -> date | None:
        return _not_future(value)


class RecruitmentVisitOut(BaseModel):
    """規格 5.1 全部欄位（不含 anonymized_at），另加推導的 stage 與 has_visit_request。"""

    id: uuid.UUID
    campus_key: str
    visit_request_id: uuid.UUID | None
    month: str
    seq_no: str | None
    visit_date: date
    child_name: str
    birthday: date | None
    grade: Grade | None
    phone: str | None
    contact_name: str | None
    address: str | None
    district: str | None
    source: str | None
    referrer: str | None
    deposit_collector: str | None
    tour_guide_user_id: uuid.UUID | None
    tour_guide_name: str | None
    source_category: SourceCategory | None
    has_deposit: bool
    rides_bus: bool
    notes: str | None
    parent_response: str | None
    geocoding_consent_at: datetime | None
    no_deposit_reason: NoDepositReason | None
    no_deposit_reason_detail: str | None
    enrolled: bool
    enrolled_on: date | None
    transfer_term: bool
    provisional_grade: Grade | None
    target_school_year: int | None
    target_semester: int | None
    withdrawn_at: datetime | None
    withdrawn_from: WithdrawnFrom | None
    withdraw_reason: str | None
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def stage(self) -> Stage:
        return derive_stage(self)

    @computed_field
    @property
    def has_visit_request(self) -> bool:
        return self.visit_request_id is not None


class RecruitmentEventOut(BaseModel):
    """招生歷程一筆（規格 5.2），舊到新排序。"""

    id: uuid.UUID
    event_type: EventType
    from_stage: Stage | None
    to_stage: Stage
    reason: str | None
    metadata_json: dict | None
    actor_user_id: uuid.UUID | None
    # 操作者的顯示名稱，沒設定時是 Email；自動建立、帳號已刪除時為 None。
    actor_name: str | None = None
    created_at: datetime


class NoDepositReasonOption(BaseModel):
    value: NoDepositReason
    # 轉換潛力（園務 shared.py:59-75）；「未註明／待追蹤」不屬於任何一組，為 None。
    priority: Priority | None


class AdmissionsOptionsOut(BaseModel):
    """篩選與表單選項（規格 13 GET /options）：該校已用過的月份、來源、介紹者，
    以及園務的固定列舉與文案。"""

    # 民國月份，新到舊。
    months: list[str]
    # 次數多的在前，各最多 50 個。
    sources: list[str]
    referrers: list[str]
    grades: list[Grade]
    no_deposit_reasons: list[NoDepositReasonOption]
    # 來源分類代碼 → 園務文案，順序同園務（A 計畫調整第 17 條）。
    source_categories: dict[str, str]
```

- [ ] **Step 6：訪視 service `records.py`**

`backend/app/admissions/records.py`：

```python
"""招生訪視的建立、編輯、刪除、查詢、序號與歷程寫入（規格 5.1、5.2、6.1、6.6）。

只 flush、丟自訂例外；權限、稽核與 commit 在 routes.py。create_visit 也會在
「標記已到場」的交易內被 booking_link 呼叫：那條路徑的欄位已在
fields_from_visit_request 截斷並補好預設，也不帶帳號，這裡不做任何會丟例外的
資料檢查（帳號檢查只有帶了 tour_guide_user_id 才會發生）。

本檔不在模組層匯入 funnel 與 schemas：funnel 從 A4 起在模組層匯入本檔
（write_event、VersionConflict），反過來匯入會循環。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.auth.models import User
from app.common.timezones import today_local

# 篩選選項（來源、介紹者）各列幾個。
OPTION_LIMIT = 50

_Grade = Literal[constants.GRADES]
_Stage = Literal[constants.STAGES]
_NoDepositReason = Literal[constants.NO_DEPOSIT_REASONS]
_PRIORITY_OF = {reason: level for level, reasons in constants.NO_DEPOSIT_PRIORITY.items() for reason in reasons}


class RecordNotFound(Exception):
    """找不到這筆招生訪視。"""


class VersionConflict(Exception):
    """訪視剛被別人改過（編輯、狀態轉換、保留座位、刪除都比對 version）。"""

    def __init__(self, current_version: int) -> None:
        self.current_version = current_version
        super().__init__(current_version)


class TourGuideNotFound(Exception):
    """tour_guide_user_id 指到不存在的帳號（不擋的話外鍵錯誤會變成 500）。"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _lock_month(db: AsyncSession, campus_key: str, month: str) -> None:
    """同校同月份配號排隊（交易結束自動釋放）。"""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"recruitment_visits.seq:{campus_key}:{month}"},
    )


async def _next_seq_no(db: AsyncSession, campus_key: str, month: str) -> str:
    """同校同月份現有序號「開頭數字」的最大值＋1（園務 shared.next_seq_no；
    「60補」這類舊序號只認開頭數字）。呼叫前先 _lock_month。"""
    current = await db.scalar(
        text(
            "SELECT COALESCE(MAX(CAST(substring(seq_no FROM '^[0-9]+') AS BIGINT)), 0) "
            "FROM recruitment_visits WHERE campus_key = :campus_key AND month = :month"
        ),
        {"campus_key": campus_key, "month": month},
    )
    return str(int(current or 0) + 1)


async def _resolve_tour_guide(db: AsyncSession, values: dict) -> None:
    """有帶帳號就確認帳號存在；沒給姓名時用帳號的顯示名稱（沒設定就用 Email）當快照。"""
    user_id = values.get("tour_guide_user_id")
    if user_id is None:
        return
    user = await db.get(User, user_id)
    if user is None:
        raise TourGuideNotFound()
    if not values.get("tour_guide_name"):
        # 只用顯示名稱；沒有就留空，不拿同事的 Email 當姓名快照（稽核也不寫 Email）。
        values["tour_guide_name"] = user.display_name[: constants.LEN_TOUR_GUIDE] if user.display_name else None


def write_event(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    event_type: str,
    from_stage: str | None,
    to_stage: str,
    actor_user_id: uuid.UUID | None,
    reason: str | None = None,
    metadata: dict | None = None,
    created_at: datetime | None = None,
) -> RecruitmentEventLog:
    """寫一筆招生歷程。created_at 只在同一個動作要寫兩筆、需要保證先後時傳入
    （取消註冊並取消預繳）。metadata 不放個資。"""
    event = RecruitmentEventLog(
        id=uuid.uuid4(),
        recruitment_visit_id=visit.id,
        event_type=event_type,
        from_stage=from_stage,
        to_stage=to_stage,
        reason=reason,
        actor_user_id=actor_user_id,
        metadata_json=metadata,
        created_at=created_at or _now(),
    )
    db.add(event)
    return event


async def create_visit(
    db: AsyncSession,
    *,
    campus_key: str,
    fields: dict,
    actor_user_id: uuid.UUID | None,
    origin: str,
    visit_request_id: uuid.UUID | None = None,
    today: date | None = None,
) -> RecruitmentVisit:
    """建立一筆招生訪視並寫 created 事件（metadata {"origin": origin}，origin 是
    constants.ORIGINS 之一）。fields 的鍵是 RecruitmentVisitCreate 的欄位名；month
    由 visit_date 算、seq_no 在同校同月份鎖內配號；入學學年或學期缺值時補
    today（台北日期，預設今天）所在學期，同園務 records.py:232-237。"""
    values = dict(fields)
    await _resolve_tour_guide(db, values)
    if values.get("target_school_year") is None or values.get("target_semester") is None:
        school_year, semester = academic.current_term(today or today_local())
        if values.get("target_school_year") is None:
            values["target_school_year"] = school_year
        if values.get("target_semester") is None:
            values["target_semester"] = semester
    rides_bus = bool(values.pop("rides_bus", False))
    transfer_term = bool(values.pop("transfer_term", False))
    month = academic.roc_month(values["visit_date"])
    await _lock_month(db, campus_key, month)
    seq_no = await _next_seq_no(db, campus_key, month)
    now = _now()
    visit = RecruitmentVisit(
        id=uuid.uuid4(),
        campus_key=campus_key,
        visit_request_id=visit_request_id,
        month=month,
        seq_no=seq_no,
        has_deposit=False,
        enrolled=False,
        rides_bus=rides_bus,
        transfer_term=transfer_term,
        version=1,
        created_at=now,
        updated_at=now,
        **values,
    )
    db.add(visit)
    await db.flush()
    write_event(
        db, visit, event_type="created", from_stage=None, to_stage="visited",
        actor_user_id=actor_user_id, metadata={"origin": origin},
    )
    await db.flush()
    return visit


async def get_visit_for_update(db: AsyncSession, visit_id: uuid.UUID) -> RecruitmentVisit | None:
    """鎖住訪視列並讀資料庫的最新值（同一個 session 先前讀過也覆蓋）。"""
    stmt = (
        select(RecruitmentVisit)
        .where(RecruitmentVisit.id == visit_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def update_visit(
    db: AsyncSession, visit: RecruitmentVisit, *, changes: dict, expected_version: int
) -> list[str]:
    """改表單欄位（呼叫前已 get_visit_for_update）。changes 只含請求有送的欄位；
    回傳值真的有變的欄位名（沒變就不加版本）。參觀日期換到別的月份時，月份
    跟著換，並在新月份重新配號（舊序號在新月份可能已被用掉）。"""
    if visit.version != expected_version:
        raise VersionConflict(visit.version)
    values = dict(changes)
    if values.get("tour_guide_user_id") is not None and values["tour_guide_user_id"] != visit.tour_guide_user_id:
        await _resolve_tour_guide(db, values)
    changed = [key for key, value in values.items() if getattr(visit, key) != value]
    if not changed:
        return []
    for key in changed:
        setattr(visit, key, values[key])
    if "visit_date" in changed:
        month = academic.roc_month(visit.visit_date)
        if month != visit.month:
            await _lock_month(db, visit.campus_key, month)
            # 先算新序號再一起改：先改 month 的話，查詢前的 autoflush 會把舊序號寫進新月份。
            seq_no = await _next_seq_no(db, visit.campus_key, month)
            visit.month, visit.seq_no = month, seq_no
    visit.version += 1
    visit.updated_at = _now()
    await db.flush()
    return changed


async def delete_visit(db: AsyncSession, visit: RecruitmentVisit, *, expected_version: int) -> None:
    """刪除訪視；歷程由資料庫 ON DELETE CASCADE 一併刪除（同園務）。"""
    if visit.version != expected_version:
        raise VersionConflict(visit.version)
    await db.delete(visit)
    await db.flush()


class RecruitmentVisitFilters:
    """訪視明細的篩選（規格 10「訪視明細」；園務 records.py GET /records）。路由用
    Depends() 帶入；權限在路由檢查。"""

    def __init__(
        self,
        campus_key: str,
        month: str | None = Query(default=None, pattern=academic.ROC_MONTH_RE.pattern, description="民國月份，例：115.09"),
        grade: _Grade | None = Query(default=None, description="適讀班級"),
        target_school_year: int | None = Query(
            default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年（民國）"
        ),
        target_semester: int | None = Query(default=None, ge=1, le=2, description="入學學期：1 上、2 下"),
        source: str | None = Query(default=None, max_length=constants.LEN_SOURCE),
        referrer: str | None = Query(default=None, max_length=constants.LEN_REFERRER),
        has_deposit: bool | None = Query(default=None),
        no_deposit_reason: _NoDepositReason | None = Query(default=None),
        stage: _Stage | None = Query(default=None, description="漏斗階段（由狀態欄位推導）"),
        visit_request_id: uuid.UUID | None = Query(default=None, description="連結的官網預約"),
        q: str | None = Query(default=None, max_length=100, description="幼生姓名、聯絡人、電話、地址、備註、電訪回應"),
    ) -> None:
        self.campus_key = campus_key
        self.month = month
        self.grade = grade
        self.target_school_year = target_school_year
        self.target_semester = target_semester
        self.source = source
        self.referrer = referrer
        self.has_deposit = has_deposit
        self.no_deposit_reason = no_deposit_reason
        self.stage = stage
        self.visit_request_id = visit_request_id
        self.q = q.strip() if q and q.strip() else None

    def apply(self, stmt):
        from app.admissions.funnel import stage_condition

        stmt = stmt.where(RecruitmentVisit.campus_key == self.campus_key)
        if self.month:
            stmt = stmt.where(RecruitmentVisit.month == self.month)
        if self.grade:
            stmt = stmt.where(RecruitmentVisit.grade == self.grade)
        if self.target_school_year is not None:
            stmt = stmt.where(RecruitmentVisit.target_school_year == self.target_school_year)
        if self.target_semester is not None:
            stmt = stmt.where(RecruitmentVisit.target_semester == self.target_semester)
        if self.source:
            stmt = stmt.where(RecruitmentVisit.source == self.source)
        if self.referrer:
            stmt = stmt.where(RecruitmentVisit.referrer == self.referrer)
        if self.has_deposit is not None:
            stmt = stmt.where(RecruitmentVisit.has_deposit.is_(self.has_deposit))
        if self.no_deposit_reason:
            stmt = stmt.where(RecruitmentVisit.no_deposit_reason == self.no_deposit_reason)
        if self.stage:
            stmt = stmt.where(stage_condition(self.stage))
        if self.visit_request_id is not None:
            stmt = stmt.where(RecruitmentVisit.visit_request_id == self.visit_request_id)
        if self.q:
            # 使用者打的 % 與 _ 是字面值（同 booking 的 VisitRequestFilters）。
            needle = self.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{needle}%"
            stmt = stmt.where(
                or_(
                    RecruitmentVisit.child_name.ilike(pattern, escape="\\"),
                    RecruitmentVisit.contact_name.ilike(pattern, escape="\\"),
                    RecruitmentVisit.phone.like(pattern, escape="\\"),
                    RecruitmentVisit.address.ilike(pattern, escape="\\"),
                    RecruitmentVisit.notes.ilike(pattern, escape="\\"),
                    RecruitmentVisit.parent_response.ilike(pattern, escape="\\"),
                )
            )
        return stmt


async def _top_values(db: AsyncSession, campus_key: str, column) -> list[str]:
    """該校用過的值，次數多的在前，同次數依字排。"""
    result = await db.execute(
        select(column)
        .where(RecruitmentVisit.campus_key == campus_key, column.is_not(None))
        .group_by(column)
        .order_by(func.count().desc(), column)
        .limit(OPTION_LIMIT)
    )
    return list(result.scalars())


async def options(db: AsyncSession, campus_key: str) -> dict:
    """GET /admin/admissions/options 的內容（AdmissionsOptionsOut）。"""
    months = await db.execute(
        select(RecruitmentVisit.month)
        .where(RecruitmentVisit.campus_key == campus_key)
        .distinct()
        .order_by(RecruitmentVisit.month.desc())
    )
    return {
        "months": list(months.scalars()),
        "sources": await _top_values(db, campus_key, RecruitmentVisit.source),
        "referrers": await _top_values(db, campus_key, RecruitmentVisit.referrer),
        "grades": list(constants.GRADES),
        "no_deposit_reasons": [
            {"value": reason, "priority": _PRIORITY_OF.get(reason)} for reason in constants.NO_DEPOSIT_REASONS
        ],
        "source_categories": dict(constants.SOURCE_CATEGORIES),
    }
```

- [ ] **Step 7：路由 `routes.py` 並掛上 app**

`backend/app/admissions/routes.py`：

```python
"""招生入學 API（規格 13；/api/website/v1/admin/admissions/*）。

service（records、funnel、intake、booking_link）只 flush、丟自訂例外；這裡檢查
權限、把例外轉成 HTTP 錯誤、寫稽核並 commit，失敗時先 rollback。稽核的
action、target_type 與 metadata 一律寫字面值（admin labelCoverage 測試會掃），
metadata 不放個資。

單筆端點先載入訪視、再用訪視上的 campus_key 檢查權限：查無與越權一律 404
（ScopeDenied），沒有 capability 是 403。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import funnel, records
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.admissions.schemas import (
    AdmissionsOptionsOut,
    RecruitmentEventOut,
    RecruitmentVisitCreate,
    RecruitmentVisitOut,
    RecruitmentVisitUpdate,
)
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.campuses.models import CAMPUS_KEYS
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["admissions"])


def _require_campus(user: User, capability: str, campus_key: str) -> None:
    """校區層級的端點：先檢查權限（沒有 capability 403、越權 404），總管理者帶
    不存在的校區也回 404，不要變成空清單或外鍵錯誤。"""
    require_scope(user, capability, campus_keys=[campus_key])
    if campus_key not in CAMPUS_KEYS:
        raise ScopeDenied()


async def _visit_for(db: AsyncSession, user: User, visit_id: uuid.UUID, capability: str) -> RecruitmentVisit:
    visit = await db.get(RecruitmentVisit, visit_id)
    if visit is None:
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[visit.campus_key])
    return visit


async def _locked_visit_for(db: AsyncSession, user: User, visit_id: uuid.UUID, capability: str) -> RecruitmentVisit:
    """寫入用：鎖住訪視列、讀最新值後再檢查權限（同 PATCH /admin/slots）。"""
    visit = await records.get_visit_for_update(db, visit_id)
    if visit is None:
        await db.rollback()
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[visit.campus_key])
    return visit


def _version_conflict(exc: records.VersionConflict) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "RECRUITMENT_VISIT_VERSION_CONFLICT",
            "message": "這筆招生訪視剛被其他人修改，請重新載入後再操作",
            "current_version": exc.current_version,
        },
    )


def _tour_guide_invalid() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "TOUR_GUIDE_INVALID", "message": "找不到這位帶參觀老師的帳號"},
    )
```

同一檔接著寫端點：

```python
@router.get("/admin/admissions/options", response_model=AdmissionsOptionsOut)
async def get_admissions_options(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsOptionsOut:
    _require_campus(current_user, "admissions.read", campus_key)
    return AdmissionsOptionsOut.model_validate(await records.options(db, campus_key))


@router.get("/admin/admissions/records", response_model=list[RecruitmentVisitOut])
async def list_recruitment_visits(
    filters: records.RecruitmentVisitFilters = Depends(),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RecruitmentVisitOut]:
    """訪視明細：參觀日期新到舊；回裸 list，筆數等於 page_size 代表可能還有下一頁。"""
    _require_campus(current_user, "admissions.read", filters.campus_key)
    stmt = filters.apply(select(RecruitmentVisit))
    stmt = stmt.order_by(RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc())
    result = await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
    return [RecruitmentVisitOut.model_validate(visit) for visit in result.scalars()]


@router.post("/admin/admissions/records", response_model=RecruitmentVisitOut, status_code=status.HTTP_201_CREATED)
async def create_recruitment_visit(
    campus_key: str,
    payload: RecruitmentVisitCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """手動新增（規格 6.1 第 3 點）：沒有預約的現場參觀。"""
    _require_campus(current_user, "admissions.write", campus_key)
    try:
        visit = await records.create_visit(
            db, campus_key=campus_key, fields=payload.model_dump(), actor_user_id=current_user.id, origin="manual"
        )
    except records.TourGuideNotFound as exc:
        await db.rollback()
        raise _tour_guide_invalid() from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.create",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=campus_key,
        metadata={"origin": "manual"},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.get("/admin/admissions/records/{visit_id}", response_model=RecruitmentVisitOut)
async def get_recruitment_visit(
    visit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    return RecruitmentVisitOut.model_validate(await _visit_for(db, current_user, visit_id, "admissions.read"))


@router.patch("/admin/admissions/records/{visit_id}", response_model=RecruitmentVisitOut)
async def update_recruitment_visit(
    visit_id: uuid.UUID,
    payload: RecruitmentVisitUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """編輯表單欄位（規格 6.6）：狀態欄位不在 schema 裡，送了就 422。"""
    visit = await _locked_visit_for(db, current_user, visit_id, "admissions.write")
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    try:
        changed = await records.update_visit(db, visit, changes=changes, expected_version=payload.expected_version)
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except records.TourGuideNotFound as exc:
        await db.rollback()
        raise _tour_guide_invalid() from exc
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="recruitment_visit.update",
            target_type="recruitment_visit",
            target_id=str(visit.id),
            campus_key=visit.campus_key,
            metadata={"fields": changed},
        )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.delete("/admin/admissions/records/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recruitment_visit(
    visit_id: uuid.UUID,
    expected_version: int = Query(ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """刪除訪視與歷程（規格 6.6）。稽核只記階段，不記姓名電話。由預約建立的
    訪視被刪掉後，可以從預約或「官網預約」分頁再補建（A6）。"""
    visit = await _locked_visit_for(db, current_user, visit_id, "admissions.write")
    stage = funnel.derive_stage(visit)
    campus_key = visit.campus_key
    try:
        await records.delete_visit(db, visit, expected_version=expected_version)
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.delete",
        target_type="recruitment_visit",
        target_id=str(visit_id),
        campus_key=campus_key,
        metadata={"stage": stage},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/admissions/records/{visit_id}/events", response_model=list[RecruitmentEventOut])
async def list_recruitment_events(
    visit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RecruitmentEventOut]:
    """招生歷程，舊到新（園務 timeline 同順序）。操作者名稱讀取時才 join，帳號改名
    後跟著更新，歷程裡不存姓名。"""
    await _visit_for(db, current_user, visit_id, "admissions.read")
    result = await db.execute(
        select(RecruitmentEventLog, User.display_name, User.email)
        .outerjoin(User, User.id == RecruitmentEventLog.actor_user_id)
        .where(RecruitmentEventLog.recruitment_visit_id == visit_id)
        .order_by(RecruitmentEventLog.created_at, RecruitmentEventLog.id)
    )
    return [
        RecruitmentEventOut(
            id=event.id,
            event_type=event.event_type,
            from_stage=event.from_stage,
            to_stage=event.to_stage,
            reason=event.reason,
            metadata_json=event.metadata_json,
            actor_user_id=event.actor_user_id,
            actor_name=display_name or email,
            created_at=event.created_at,
        )
        for event, display_name, email in result.all()
    ]
```

`backend/app/main.py`：第 24 行 `from app.booking.routes import router as booking_router` 之前加一行（照字母排在 auth 之後、booking 之前）：

```python
from app.admissions.routes import router as admissions_router
```

第 213 行 `app.include_router(operations_router)` 之後加：

```python
    app.include_router(admissions_router)
```

- [ ] **Step 8：稽核標籤 `admin/src/api/labels.ts`（調整第 14 條）**

1. `AUDIT_ACTION_LABELS`：在 `'media.strip_metadata': '去除素材原檔的拍攝資訊',` 之後加：

```ts
  // 招生入學（2026-10）
  'recruitment_visit.create': '新增招生訪視',
  'recruitment_visit.update': '修改招生訪視',
  'recruitment_visit.delete': '刪除招生訪視',
```

2. `AUDIT_TARGET_LABELS`：在 `line_verification_code: 'LINE 群組驗證碼',` 之後加：

```ts
  recruitment_visit: '招生訪視',
```

3. 在 `// 個資保存政策會清理的案件類別（後端 retention_service.CATEGORIES）。` 這行之前加三個表（招生頁 B 階段也從這裡匯入，不另抄）：

```ts
// 招生漏斗階段（後端 app/admissions/constants.py STAGE_LABELS，園務原文）。
export const RECRUITMENT_STAGE_LABELS: Record<string, string> = {
  visited: '已訪視',
  deposited: '已預繳',
  enrolled: '已註冊',
  withdrawn: '退預繳／退註冊',
}

// 招生訪視怎麼建立的（後端 constants.ORIGINS，created 事件與稽核的 origin）。
export const RECRUITMENT_ORIGIN_LABELS: Record<string, string> = {
  manual: '手動新增',
  visit_request: '官網預約到場',
}

// 招生訪視編輯了哪些欄位（recruitment_visit.update 的 fields；只記欄位名，不記內容）。
export const RECRUITMENT_FIELD_LABELS: Record<string, string> = {
  visit_date: '參觀日期',
  child_name: '幼生姓名',
  birthday: '生日',
  grade: '適讀班級',
  phone: '電話',
  contact_name: '聯絡人',
  address: '地址',
  source: '幼生來源',
  referrer: '介紹者',
  deposit_collector: '收預繳人員',
  tour_guide_user_id: '帶參觀老師',
  tour_guide_name: '帶參觀老師',
  source_category: '來源分類',
  rides_bus: '娃娃車',
  transfer_term: '轉其他學期',
  notes: '備註',
  parent_response: '電訪回應',
  no_deposit_reason: '未預繳原因',
  no_deposit_reason_detail: '未預繳原因說明',
  target_school_year: '入學學年',
  target_semester: '入學學期',
}

```

4. `AUDIT_METADATA_FORMATTERS`：把 `fields:` 這一行（素材）換成依 action 分開翻：

```ts
  // 素材說明（media.update）或招生訪視（recruitment_visit.update）被改了哪些欄位。
  fields: (v, action) => {
    if (!Array.isArray(v)) return null
    const names = action.startsWith('recruitment_visit.') ? RECRUITMENT_FIELD_LABELS : MEDIA_FIELD_LABELS
    return `修改：${Array.from(new Set(v.map((field) => names[String(field)] ?? String(field)))).join('、')}`
  },
```

並在 `open_overdue_count: …` 那一行之後（物件結尾 `}` 之前）加：

```ts
  // 招生入學
  origin: (v) => `建立方式：${RECRUITMENT_ORIGIN_LABELS[String(v)] ?? String(v)}`,
  stage: (v) => `刪除時的階段：${RECRUITMENT_STAGE_LABELS[String(v)] ?? String(v)}`,
```

- [ ] **Step 9：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_records.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_audit_coverage.py tests/test_permission_table.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions && npm --prefix admin run test:unit -- labelCoverage
```
Expected: `test_admissions_records.py` `36 passed`（必填 5＋列舉與狀態欄位 19＋其餘 12 支）；稽核涵蓋與權限表全過（新的四個寫入端點都有 `log_action(`、`app/admissions` 沒有硬編角色）；`labelCoverage` 全過。

- [ ] **Step 10：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/funnel.py backend/app/admissions/schemas.py backend/app/admissions/records.py \
  backend/app/admissions/routes.py backend/app/main.py admin/src/api/labels.ts \
  backend/tests/admissions_helpers.py backend/tests/test_admissions_records.py
git commit -m "feat(admissions): 招生訪視新增、明細篩選、編輯刪除、歷程與篩選選項 API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4：狀態轉換、權限對照與漏斗看板

**Files:**
- Modify: `backend/app/admissions/funnel.py`（整檔換成 Step 4 的版本：保留 A3 的階段推導，加轉換、權限對照、看板）
- Modify: `backend/app/admissions/schemas.py`（檔尾加 `TransitionRequest`、`FunnelCardOut`、`FunnelColumnsOut`、`FunnelBoardOut`）
- Modify: `backend/app/admissions/routes.py`（import 區、檔尾加兩個端點）
- Modify: `admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS`、`AUDIT_PAIRED_KEYS` 與 `pairedLines`）
- Modify: `backend/tests/admissions_helpers.py`（檔尾加 `transition`、`record_at_stage`）
- Test: `backend/tests/test_admissions_funnel.py`

**Interfaces:**
- Consumes：A3 `records.write_event`、`records.VersionConflict`、`records.get_visit_for_update`、routes 的 `_locked_visit_for`、`_require_campus`、`_version_conflict`；`schemas.OptionalText`、`Grade`、`SchoolYear`、`Semester`、`WithdrawnFrom`；`constants.STAGE_LABELS`；`academic.current_term`。
- Produces：
  - `funnel.transition_capability(from_stage, to_stage) -> str | None`、`funnel.not_allowed_reason(from_stage, to_stage) -> str`、`funnel.TransitionNotAllowed(message)`、`funnel.TransitionFieldsMissing(fields)`、`funnel.transition(...) -> Stage`（回傳轉換前的階段）、`funnel.board(db, campus_key, school_year, semester) -> dict`
  - `schemas.TransitionRequest`（`to_stage, expected_version, reason, deposit_collector, enrolled_on, grade, target_school_year, target_semester`，後六個可為 null）、`FunnelCardOut`、`FunnelColumnsOut`、`FunnelBoardOut`
  - API：`POST /admin/admissions/records/{visit_id}/transition`（依轉換 `admissions.write` 或 `admissions.convert`）、`GET /admin/admissions/board`
  - 錯誤碼：422 `TRANSITION_NOT_ALLOWED`、422 `TRANSITION_FIELDS_REQUIRED`（帶 `fields`）；409 先於 403（調整第 10 條）
  - 稽核：`recruitment_visit.transition`（`from_stage`、`to_stage`、`has_reason`）
  - 測試共用：`admissions_helpers.transition(client, record, to_stage, **fields) -> dict`、`record_at_stage(client, stage, *, withdrawn_from="deposited", campus_key="yihua", **overrides) -> dict`

- [ ] **Step 1：測試 helper 加轉換與「推到某階段」**

`backend/tests/admissions_helpers.py` 檔尾加：

```python
async def transition(client, record: dict, to_stage: str, **fields) -> dict:
    """帶目前版本送一次狀態轉換，回傳轉換後的訪視。"""
    response = await client.post(
        f"{ADMISSIONS}/records/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": record["version"], **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def record_at_stage(
    client, stage: str, *, withdrawn_from: str = "deposited", campus_key: str = "yihua", **overrides
) -> dict:
    """用 API 建一筆訪視並推到指定階段。已註冊一律是 115 學年上學期小班；
    withdrawn 依 withdrawn_from 從已預繳或已註冊退出，原因「家長改送他校」。"""
    record = await create_record(client, campus_key, **overrides)
    if stage == "visited":
        return record
    record = await transition(client, record, "deposited")
    if stage == "deposited":
        return record
    if stage == "enrolled" or withdrawn_from == "enrolled":
        record = await transition(
            client, record, "enrolled", grade="小班", target_school_year=115, target_semester=1, enrolled_on="2026-09-30"
        )
        if stage == "enrolled":
            return record
    return await transition(client, record, "withdrawn", reason="家長改送他校")
```

- [ ] **Step 2：寫失敗的測試**

`backend/tests/test_admissions_funnel.py`：

```python
"""招生狀態轉換與漏斗看板（規格 6.2、6.3、10；R04、R05、R06 轉換部分；Review Focus 3）。"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import select, update

from app.admissions import academic, constants, funnel
from app.admissions.models import RecruitmentVisit
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    campus_admin_yihua_client,
    create_record,
    record_at_stage,
    reception_yihua_client,
    transition,
)

RECORDS = f"{ADMISSIONS}/records"
ENROLL = {"grade": "小班", "target_school_year": 115, "target_semester": 1}


async def _events(client, record: dict) -> list[tuple]:
    """created 以外的歷程：(類型, 起, 迄, 原因)，舊到新。"""
    body = (await client.get(f"{RECORDS}/{record['id']}/events")).json()
    return [(e["event_type"], e["from_stage"], e["to_stage"], e["reason"]) for e in body if e["event_type"] != "created"]


async def _post(client, record: dict, to_stage: str, *, version: int | None = None, **fields):
    return await client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": version or record["version"], **fields},
    )


def test_capability_table_matches_spec():
    """規格 6.3：九種允許的轉換與各自的 capability；其餘（含同階段）不允許。"""
    allowed = {
        ("visited", "deposited"): "admissions.write",
        ("deposited", "visited"): "admissions.write",
        ("deposited", "enrolled"): "admissions.convert",
        ("enrolled", "deposited"): "admissions.convert",
        ("enrolled", "visited"): "admissions.convert",
        ("deposited", "withdrawn"): "admissions.write",
        ("enrolled", "withdrawn"): "admissions.convert",
        ("withdrawn", "visited"): "admissions.write",
        ("withdrawn", "deposited"): "admissions.write",
    }
    for start in constants.STAGES:
        for to_stage in constants.STAGES:
            assert funnel.transition_capability(start, to_stage) == allowed.get((start, to_stage)), (start, to_stage)
    assert "沒有可退的款項" in funnel.not_allowed_reason("visited", "withdrawn")


CASES = [
    # (起始階段, 從哪裡退出, 目標, 請求欄位, 轉換後欄位, 新增的歷程)
    ("visited", None, "deposited", {"deposit_collector": "林老師"},
     {"has_deposit": True, "deposit_collector": "林老師", "enrolled": False},
     [("deposit_added", "visited", "deposited", None)]),
    ("deposited", None, "visited", {},
     {"has_deposit": False},
     [("deposit_removed", "deposited", "visited", None)]),
    ("deposited", None, "enrolled",
     {"grade": "中班", "target_school_year": 116, "target_semester": 1, "enrolled_on": "2026-10-01"},
     {"enrolled": True, "enrolled_on": "2026-10-01", "provisional_grade": "中班", "target_school_year": 116,
      "target_semester": 1, "has_deposit": True},
     [("converted", "deposited", "enrolled", None)]),
    ("enrolled", None, "deposited", {"reason": "家長延後入學"},
     {"enrolled": False, "enrolled_on": None, "has_deposit": True, "provisional_grade": "小班"},
     [("revert_converted", "enrolled", "deposited", "家長延後入學")]),
    ("enrolled", None, "visited", {"reason": "家長延後入學"},
     {"enrolled": False, "enrolled_on": None, "has_deposit": False},
     [("revert_converted", "enrolled", "deposited", "家長延後入學"),
      ("deposit_removed", "deposited", "visited", "家長延後入學")]),
    ("deposited", None, "withdrawn", {"reason": "改送他校"},
     {"withdrawn_from": "deposited", "withdraw_reason": "改送他校", "has_deposit": False},
     [("withdrawn", "deposited", "withdrawn", "改送他校")]),
    ("enrolled", None, "withdrawn", {"reason": "搬家"},
     {"withdrawn_from": "enrolled", "withdraw_reason": "搬家", "has_deposit": False, "enrolled": False, "enrolled_on": None},
     [("withdrawn", "enrolled", "withdrawn", "搬家")]),
    ("withdrawn", "deposited", "visited", {},
     {"withdrawn_at": None, "withdrawn_from": None, "withdraw_reason": None, "has_deposit": False},
     [("withdraw_cancelled", "withdrawn", "visited", None)]),
    ("withdrawn", "enrolled", "deposited", {},
     {"withdrawn_at": None, "withdrawn_from": None, "withdraw_reason": None, "has_deposit": True,
      "enrolled": False, "enrolled_on": None},
     [("withdraw_cancelled", "withdrawn", "deposited", None)]),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "withdrawn_from", "to_stage", "body", "expected", "events"),
    CASES,
    ids=[f"{c[0]}{'(' + c[1] + ')' if c[1] else ''}->{c[2]}" for c in CASES],
)
async def test_each_allowed_transition(admin_client, start, withdrawn_from, to_stage, body, expected, events):
    """R04：規格 6.3 每一種允許的轉換：欄位變化、歷程、版本。"""
    record = await record_at_stage(admin_client, start, withdrawn_from=withdrawn_from or "deposited")
    before = await _events(admin_client, record)
    response = await _post(admin_client, record, to_stage, **body)
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["stage"] == to_stage
    assert after["version"] == record["version"] + 1
    for key, value in expected.items():
        assert after[key] == value, key
    assert (after["withdrawn_at"] is not None) == (to_stage == "withdrawn")
    assert (await _events(admin_client, record))[len(before):] == events


@pytest.mark.asyncio
async def test_enroll_uses_reserved_seat_or_requires_grade_and_year(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited")
    missing = await _post(admin_client, record, "enrolled")
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
    assert missing.json()["detail"]["fields"] == ["grade"]

    # 已保留座位（大班）：不帶年級也能註冊，註冊日期預設台北今天。
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).values(provisional_grade="大班")
    )
    await db_session.commit()
    enrolled = await transition(admin_client, record, "enrolled")
    assert (enrolled["provisional_grade"], enrolled["enrolled_on"]) == ("大班", today_local().isoformat())
    converted = [e for e in (await admin_client.get(f"{RECORDS}/{record['id']}/events")).json() if e["event_type"] == "converted"]
    assert converted[0]["metadata_json"] == {"website_manual": True, "grade": "大班", "school_year": 115, "semester": 1}

    no_year = await record_at_stage(admin_client, "deposited", child_name="沒學年")
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(no_year["id"])).values(target_school_year=None)
    )
    await db_session.commit()
    response = await _post(admin_client, no_year, "enrolled", grade="小班")
    assert response.status_code == 422
    assert response.json()["detail"]["fields"] == ["target_school_year"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "to_stage", "message"),
    [
        ("visited", "enrolled", "要先標記預繳"),
        ("visited", "withdrawn", "已訪視階段沒有可退的款項"),
        ("withdrawn", "enrolled", "取消退出"),
        ("deposited", "deposited", "已經在「已預繳」階段"),
    ],
)
async def test_disallowed_transitions_return_422(admin_client, start, to_stage, message):
    """R04 不允許的組合：422 TRANSITION_NOT_ALLOWED（調整 3），資料與版本不動。"""
    record = await record_at_stage(admin_client, start)
    response = await _post(admin_client, record, to_stage, reason="試試看", **ENROLL)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "TRANSITION_NOT_ALLOWED"
    assert message in response.json()["detail"]["message"]
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (current["stage"], current["version"]) == (start, record["version"])


@pytest.mark.asyncio
@pytest.mark.parametrize(("start", "to_stage"), [("enrolled", "deposited"), ("enrolled", "visited"), ("deposited", "withdrawn"), ("enrolled", "withdrawn")])
async def test_withdraw_and_revert_require_reason(admin_client, start, to_stage):
    record = await record_at_stage(admin_client, start)
    for reason in (None, "   "):
        response = await _post(admin_client, record, to_stage, reason=reason)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
        assert response.json()["detail"]["fields"] == ["reason"]
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]
```


@pytest.mark.asyncio
async def test_reception_writes_but_cannot_convert(admin_client, reception_yihua_client, campus_admin_yihua_client, editor_client):
    """R06：接待可以預繳、退預繳、取消退出；標記註冊、取消註冊、退註冊要 convert（403）。"""
    record = await create_record(admin_client)
    deposited = await transition(reception_yihua_client, record, "deposited")
    assert (await _post(reception_yihua_client, deposited, "enrolled", **ENROLL)).status_code == 403
    enrolled = await transition(campus_admin_yihua_client, deposited, "enrolled", **ENROLL)
    for to_stage in ("deposited", "visited", "withdrawn"):
        assert (await _post(reception_yihua_client, enrolled, to_stage, reason="家長延後")).status_code == 403, to_stage
    other = await record_at_stage(admin_client, "deposited", child_name="另一位")
    withdrawn = await transition(reception_yihua_client, other, "withdrawn", reason="改送他校")
    assert (await transition(reception_yihua_client, withdrawn, "deposited"))["stage"] == "deposited"
    assert (await _post(editor_client, enrolled, "withdrawn", reason="x")).status_code == 403


@pytest.mark.asyncio
async def test_stale_version_is_409_before_capability_check(admin_client, reception_yihua_client):
    """調整第 10 條：接待拿著舊畫面（卡片還在已預繳）要退預繳，但卡片其實已被
    註冊：回 409 重新載入，不是 403。版本對了才判斷權限。"""
    record = await record_at_stage(admin_client, "deposited")
    enrolled = await transition(admin_client, record, "enrolled", **ENROLL)
    stale = await _post(reception_yihua_client, record, "withdrawn", reason="改送他校")
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == enrolled["version"]
    fresh = await _post(reception_yihua_client, enrolled, "withdrawn", reason="改送他校")
    assert fresh.status_code == 403


@pytest.mark.asyncio
async def test_concurrent_transition_conflict(admin_client, campus_admin_yihua_client):
    """Review Focus 3／R05：兩人同時拖同一張卡（同一個版本），後送者 409，資料是先送者的結果。"""
    record = await record_at_stage(admin_client, "deposited")
    first, second = await asyncio.gather(
        _post(admin_client, record, "enrolled", **ENROLL),
        _post(campus_admin_yihua_client, record, "withdrawn", reason="改送他校"),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    winner, loser = (first, second) if first.status_code == 200 else (second, first)
    assert loser.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert loser.json()["detail"]["current_version"] == winner.json()["version"]
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (current["stage"], current["version"]) == (winner.json()["stage"], winner.json()["version"])
    moves = [e for e in await _events(admin_client, record) if e[0] in ("converted", "withdrawn")]
    assert len(moves) == 1


@pytest.mark.asyncio
async def test_board_groups_cards_by_stage_and_term(admin_client, minghua_client, editor_client, db_session):
    await create_record(admin_client, child_name="訪", visit_date="2026-09-01")
    await record_at_stage(admin_client, "deposited", child_name="預", visit_date="2026-09-02")
    await record_at_stage(admin_client, "enrolled", child_name="註", visit_date="2026-09-03")
    withdrawn = await record_at_stage(admin_client, "withdrawn", child_name="退", visit_date="2026-09-04")
    await create_record(admin_client, child_name="下學期", target_semester=2)
    await create_record(admin_client, child_name="明年", target_school_year=116)
    unscoped = await create_record(admin_client, child_name="沒學期")
    await create_record(admin_client, "minghua", child_name="明華")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(unscoped["id"]))
        .values(target_school_year=None, target_semester=None)
    )
    await db_session.commit()

    response = await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115&semester=1")
    assert response.status_code == 200, response.text
    body = response.json()
    names = {stage: [card["child_name"] for card in cards] for stage, cards in body["columns"].items()}
    assert names == {"visited": ["訪"], "deposited": ["預"], "enrolled": ["註"], "withdrawn": ["退"]}
    assert (body["unscoped_count"], body["school_year"], body["semester"]) == (1, 115, 1)
    card = body["columns"]["withdrawn"][0]
    assert set(card) == {
        "id", "child_name", "grade", "provisional_grade", "target_school_year", "target_semester",
        "visit_date", "has_visit_request", "withdrawn_from", "version",
    }
    assert (card["withdrawn_from"], card["has_visit_request"], card["version"]) == ("deposited", False, withdrawn["version"])

    whole_year = (await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).json()
    assert [card["child_name"] for card in whole_year["columns"]["visited"]] == ["下學期", "訪"]
    assert whole_year["semester"] is None
    default = (await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua")).json()
    assert default["school_year"] == academic.current_term(today_local())[0]
    assert (await minghua_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).status_code == 404
    assert (await editor_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).status_code == 403


@pytest.mark.asyncio
async def test_transition_audit_has_no_free_text(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited")
    await transition(admin_client, record, "withdrawn", reason="家長說孩子叫小明，住中正路")
    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.transition")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [e.metadata_json for e in entries] == [
        {"from_stage": "visited", "to_stage": "deposited", "has_reason": False},
        {"from_stage": "deposited", "to_stage": "withdrawn", "has_reason": True},
    ]
    assert entries[-1].target_type == "recruitment_visit" and entries[-1].target_id == record["id"]
    assert "小明" not in json.dumps([e.metadata_json for e in entries], ensure_ascii=False)
```

- [ ] **Step 3：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_funnel.py -q
```
Expected: FAIL（`AttributeError: module 'app.admissions.funnel' has no attribute 'transition_capability'`，其餘測試 404／405：轉換與看板端點還不存在）。

- [ ] **Step 4：狀態轉換與看板（`funnel.py` 整檔換成以下內容）**

`backend/app/admissions/funnel.py`：

```python
"""招生漏斗（規格 6.2、6.3、10）：階段推導、狀態轉換、權限對照與看板。

- 階段不存欄位，一律由 withdrawn_at、enrolled、has_deposit 推導（園務
  services/recruitment_funnel.py derive_stage，「有學生檔」換成 enrolled 旗標）：
  Python 端用 derive_stage，SQL 端用 stage_condition，兩者規則相同。
- 轉換對照規格 6.3 的表（園務 api/recruitment/funnel.py:151-165、
  services/recruitment_funnel.py:235-580）。園務退註冊另要 STUDENTS_WRITE 並刪學生
  檔；官網沒有學生檔，只要 admissions.convert。預繳對帳警示與同名同生日檢查不移植。
- 本檔在模組層匯入 records（write_event、VersionConflict）；records 只在函式內
  匯入本檔的 stage_condition，也不匯入 schemas，所以沒有循環匯入。呼叫一律寫
  records.xxx，測試可以 monkeypatch。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, get_args

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants, records
from app.admissions.models import RecruitmentVisit
from app.common.timezones import today_local

Stage = Literal["visited", "deposited", "enrolled", "withdrawn"]
# 與 constants.STAGES 相同（tests/test_admissions_records.py 檢查）。
STAGE_VALUES: tuple[str, ...] = get_args(Stage)

# (起, 迄) → 需要的 capability；不在表裡的組合（含同階段）不允許。
_CAPABILITY: dict[tuple[str, str], str] = {
    ("visited", "deposited"): "admissions.write",
    ("deposited", "visited"): "admissions.write",
    ("deposited", "enrolled"): "admissions.convert",
    ("enrolled", "deposited"): "admissions.convert",
    ("enrolled", "visited"): "admissions.convert",
    ("deposited", "withdrawn"): "admissions.write",
    ("enrolled", "withdrawn"): "admissions.convert",
    ("withdrawn", "visited"): "admissions.write",
    ("withdrawn", "deposited"): "admissions.write",
}
# 原因必填：退出，以及從已註冊往前退（園務 is_destructive）。
_REASON_REQUIRED = {("enrolled", "deposited"), ("enrolled", "visited"), ("deposited", "withdrawn"), ("enrolled", "withdrawn")}


class TransitionNotAllowed(Exception):
    """規格 6.3 不允許的組合（路由回 422 TRANSITION_NOT_ALLOWED）。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class TransitionFieldsMissing(Exception):
    """這個轉換的必填欄位沒給（路由回 422 TRANSITION_FIELDS_REQUIRED）。"""

    def __init__(self, fields: list[str]) -> None:
        self.fields = fields
        super().__init__(fields)


def derive_stage(visit) -> Stage:
    """visit 可以是 RecruitmentVisit，也可以是任何有 withdrawn_at、enrolled、
    has_deposit 三個屬性的物件（RecruitmentVisitOut 的 stage 欄位也用這支）。"""
    if visit.withdrawn_at is not None:
        return "withdrawn"
    if visit.enrolled:
        return "enrolled"
    if visit.has_deposit:
        return "deposited"
    return "visited"


def stage_condition(stage: str):
    """與 derive_stage 相同規則的 SQL 條件；未知階段丟 ValueError。"""
    active = RecruitmentVisit.withdrawn_at.is_(None)
    if stage == "withdrawn":
        return RecruitmentVisit.withdrawn_at.is_not(None)
    if stage == "enrolled":
        return and_(active, RecruitmentVisit.enrolled.is_(True))
    if stage == "deposited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(True))
    if stage == "visited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(False))
    raise ValueError(f"未知的招生階段：{stage}")


def transition_capability(from_stage: str, to_stage: str) -> str | None:
    """None＝不允許；否則是 "admissions.write" 或 "admissions.convert"。"""
    return _CAPABILITY.get((from_stage, to_stage))


def not_allowed_reason(from_stage: str, to_stage: str) -> str:
    """不允許的轉換回給畫面的中文說明（visited→withdrawn 用園務原文）。"""
    if from_stage == to_stage:
        return f"已經在「{constants.STAGE_LABELS[to_stage]}」階段"
    if (from_stage, to_stage) == ("visited", "withdrawn"):
        return "已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」"
    if (from_stage, to_stage) == ("visited", "enrolled"):
        return "要先標記預繳，才能標記註冊"
    if (from_stage, to_stage) == ("withdrawn", "enrolled"):
        return "已退出的訪視要先取消退出、回到「已預繳」，才能再標記註冊"
    return f"不能從「{constants.STAGE_LABELS[from_stage]}」直接移到「{constants.STAGE_LABELS[to_stage]}」"


async def transition(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    to_stage: str,
    expected_version: int,
    actor_user_id: uuid.UUID | None,
    reason: str | None = None,
    deposit_collector: str | None = None,
    enrolled_on: date | None = None,
    grade: str | None = None,
    target_school_year: int | None = None,
    target_semester: int | None = None,
) -> Stage:
    """依規格 6.3 改狀態欄位並寫歷程；回傳轉換前的階段。呼叫前已用
    records.get_visit_for_update 鎖列，路由已檢查這個轉換的 capability。

    檢查都在改任何欄位之前做完：丟例外時訪視原封不動。
    - 標記註冊：年級沒給用保留座位的年級，入學學年學期沒給用訪視上的；給了就
      寫進 provisional_grade 與 target_*（註冊的年級為準，同園務以班級年級為準）。
      註冊日期沒給用台北今天。
    - 取消註冊、退註冊不動 provisional_grade：之後取消退出回已預繳，保留座位還在
      （Review Focus 4）。"""
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    from_stage = derive_stage(visit)
    if transition_capability(from_stage, to_stage) is None:
        raise TransitionNotAllowed(not_allowed_reason(from_stage, to_stage))
    reason = reason.strip() if reason and reason.strip() else None
    if (from_stage, to_stage) in _REASON_REQUIRED and reason is None:
        raise TransitionFieldsMissing(["reason"])
    if (from_stage, to_stage) == ("deposited", "enrolled"):
        seat_grade = grade or visit.provisional_grade
        school_year = target_school_year or visit.target_school_year
        missing = [name for name, value in (("grade", seat_grade), ("target_school_year", school_year)) if value is None]
        if missing:
            raise TransitionFieldsMissing(missing)
        semester = target_semester or visit.target_semester or 1

    now = datetime.now(timezone.utc)

    def event(event_type: str, start: str, end: str, *, metadata: dict | None = None, at: datetime | None = None) -> None:
        records.write_event(
            db, visit, event_type=event_type, from_stage=start, to_stage=end,
            actor_user_id=actor_user_id, reason=reason, metadata=metadata, created_at=at or now,
        )

    if (from_stage, to_stage) == ("visited", "deposited"):
        visit.has_deposit = True
        collector = (deposit_collector or "").strip()
        if collector:
            visit.deposit_collector = collector
        event("deposit_added", "visited", "deposited")
    elif (from_stage, to_stage) == ("deposited", "visited"):
        visit.has_deposit = False
        event("deposit_removed", "deposited", "visited")
    elif (from_stage, to_stage) == ("deposited", "enrolled"):
        visit.enrolled = True
        visit.enrolled_on = enrolled_on or today_local()
        visit.provisional_grade = seat_grade
        visit.target_school_year = school_year
        visit.target_semester = semester
        event(
            "converted", "deposited", "enrolled",
            metadata={"website_manual": True, "grade": seat_grade, "school_year": school_year, "semester": semester},
        )
    elif from_stage == "enrolled" and to_stage in ("deposited", "visited"):
        visit.enrolled = False
        visit.enrolled_on = None
        event("revert_converted", "enrolled", "deposited")
        if to_stage == "visited":
            visit.has_deposit = False
            # 同一個動作寫兩筆：第二筆晚一微秒，歷程排序固定（A 計畫調整第 3 條）。
            event("deposit_removed", "deposited", "visited", at=now + timedelta(microseconds=1))
    elif to_stage == "withdrawn":
        visit.enrolled = False
        visit.enrolled_on = None
        visit.has_deposit = False
        visit.withdrawn_at = now
        visit.withdrawn_from = from_stage
        visit.withdraw_reason = reason
        event("withdrawn", from_stage, "withdrawn")
    else:
        # 取消退出：withdrawn → visited／deposited（規格 6.3 最後一列）。
        visit.withdrawn_at = None
        visit.withdrawn_from = None
        visit.withdraw_reason = None
        visit.has_deposit = to_stage == "deposited"
        event("withdraw_cancelled", "withdrawn", to_stage)
    visit.version += 1
    visit.updated_at = now
    await db.flush()
    return from_stage


def _card(visit: RecruitmentVisit) -> dict:
    return {
        "id": visit.id,
        "child_name": visit.child_name,
        "grade": visit.grade,
        "provisional_grade": visit.provisional_grade,
        "target_school_year": visit.target_school_year,
        "target_semester": visit.target_semester,
        "visit_date": visit.visit_date,
        "has_visit_request": visit.visit_request_id is not None,
        "withdrawn_from": visit.withdrawn_from,
        "version": visit.version,
    }


async def board(db: AsyncSession, campus_key: str, school_year: int, semester: int | None) -> dict:
    """漏斗看板（規格 10；園務 GET /board）：以入學學年學期圈範圍，semester 為
    None 時是整學年。unscoped_count 是這一校沒填入學學年的訪視數，不受學年篩選
    影響（沒有它，空看板會像是「還沒有訪視」）。"""
    conditions = [RecruitmentVisit.campus_key == campus_key, RecruitmentVisit.target_school_year == school_year]
    if semester is not None:
        conditions.append(RecruitmentVisit.target_semester == semester)
    result = await db.execute(
        select(RecruitmentVisit)
        .where(*conditions)
        .order_by(RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc())
    )
    columns: dict[str, list[dict]] = {stage: [] for stage in STAGE_VALUES}
    for visit in result.scalars():
        columns[derive_stage(visit)].append(_card(visit))
    unscoped = await db.scalar(
        select(func.count())
        .select_from(RecruitmentVisit)
        .where(RecruitmentVisit.campus_key == campus_key, RecruitmentVisit.target_school_year.is_(None))
    )
    return {"columns": columns, "unscoped_count": int(unscoped or 0), "school_year": school_year, "semester": semester}
```

- [ ] **Step 5：轉換與看板的 schema**

`backend/app/admissions/schemas.py` 檔尾加：

```python


class TransitionRequest(BaseModel):
    """狀態轉換（規格 6.3）。後台一律送齊八個欄位，用不到的送 null；各轉換只讀
    自己需要的欄位。"""

    model_config = ConfigDict(extra="forbid")

    to_stage: Stage
    expected_version: int = Field(ge=1)
    # 退預繳、退註冊、取消註冊必填；其他轉換可以附註。
    reason: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    # 標記預繳時選填。
    deposit_collector: OptionalText = Field(default=None, max_length=constants.LEN_COLLECTOR)
    # 標記註冊：註冊日期（沒給用台北今天）、年級與入學學年學期（沒保留座位時必填）。
    enrolled_on: date | None = None
    grade: Grade | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None


class FunnelCardOut(BaseModel):
    id: uuid.UUID
    child_name: str
    grade: Grade | None
    # 保留座位或註冊的年級。
    provisional_grade: Grade | None
    target_school_year: int | None
    target_semester: int | None
    visit_date: date
    # 由官網預約建立（卡片上的標記）。
    has_visit_request: bool
    # 在退出欄時是退預繳（deposited）還是退註冊（enrolled）。
    withdrawn_from: WithdrawnFrom | None
    version: int


class FunnelColumnsOut(BaseModel):
    """四欄各自一個 list（A 計畫調整第 8 條：產生的 TS 型別不是索引簽章）。"""

    visited: list[FunnelCardOut]
    deposited: list[FunnelCardOut]
    enrolled: list[FunnelCardOut]
    withdrawn: list[FunnelCardOut]


class FunnelBoardOut(BaseModel):
    columns: FunnelColumnsOut
    # 這一校沒填入學學年的訪視數（不受學年篩選影響）。
    unscoped_count: int
    school_year: int
    # None＝整學年。
    semester: int | None
```

- [ ] **Step 6：轉換與看板的路由**

`backend/app/admissions/routes.py`：

1. import 區：`from app.admissions import funnel, records` 換成 `from app.admissions import academic, constants, funnel, records`；`from app.admissions.schemas import (...)` 加入 `FunnelBoardOut`、`TransitionRequest`；加一行 `from app.common.timezones import today_local`。

2. 檔尾加：

```python
_FIELD_NAMES = {"reason": "原因", "grade": "年級", "target_school_year": "入學學年"}


@router.post("/admin/admissions/records/{visit_id}/transition", response_model=RecruitmentVisitOut)
async def transition_recruitment_visit(
    visit_id: uuid.UUID,
    payload: TransitionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """狀態轉換（規格 6.3）。檢查順序：鎖列並確認讀得到這筆（404／403）→ 版本
    （409）→ 這個轉換允不允許（422）→ 這個轉換要的 capability（403）。版本放在
    權限之前：別人剛把卡片拖到別欄，這次一律 409 重新載入，不會因為卡片已換欄
    而誤回 403（A 計畫調整第 10 條）。"""
    visit = await _locked_visit_for(db, current_user, visit_id, "admissions.read")
    if visit.version != payload.expected_version:
        current = visit.version
        await db.rollback()
        raise _version_conflict(records.VersionConflict(current))
    from_stage = funnel.derive_stage(visit)
    capability = funnel.transition_capability(from_stage, payload.to_stage)
    if capability is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSITION_NOT_ALLOWED", "message": funnel.not_allowed_reason(from_stage, payload.to_stage)},
        )
    require_scope(current_user, capability, campus_keys=[visit.campus_key])
    try:
        await funnel.transition(
            db,
            visit,
            to_stage=payload.to_stage,
            expected_version=payload.expected_version,
            actor_user_id=current_user.id,
            reason=payload.reason,
            deposit_collector=payload.deposit_collector,
            enrolled_on=payload.enrolled_on,
            grade=payload.grade,
            target_school_year=payload.target_school_year,
            target_semester=payload.target_semester,
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except funnel.TransitionNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSITION_NOT_ALLOWED", "message": exc.message},
        ) from exc
    except funnel.TransitionFieldsMissing as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "TRANSITION_FIELDS_REQUIRED",
                "message": "請填寫：" + "、".join(_FIELD_NAMES.get(name, name) for name in exc.fields),
                "fields": exc.fields,
            },
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.transition",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"from_stage": from_stage, "to_stage": payload.to_stage, "has_reason": payload.reason is not None},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.get("/admin/admissions/board", response_model=FunnelBoardOut)
async def get_funnel_board(
    campus_key: str,
    school_year: int | None = Query(
        default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年；不帶＝目前學年"
    ),
    semester: int | None = Query(default=None, ge=1, le=2, description="入學學期；不帶＝整學年"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FunnelBoardOut:
    _require_campus(current_user, "admissions.read", campus_key)
    year = school_year if school_year is not None else academic.current_term(today_local())[0]
    return FunnelBoardOut.model_validate(await funnel.board(db, campus_key, year, semester))
```


- [ ] **Step 7：稽核標籤**

`admin/src/api/labels.ts`：

1. `AUDIT_ACTION_LABELS`：在 A3 加的 `'recruitment_visit.delete': '刪除招生訪視',` 之後加：

```ts
  'recruitment_visit.transition': '變更招生階段',
```

2. `AUDIT_PAIRED_KEYS` 換成（多了 `from_stage`、`to_stage`）：

```ts
const AUDIT_PAIRED_KEYS = ['from_status', 'to_status', 'from_slot', 'to_slot', 'from_stage', 'to_stage', 'created_from', 'created_to', 'date_from', 'date_to', 'from', 'to'] as const
```

3. `pairedLines` 裡，`if (has('from_slot') || has('to_slot')) {…}` 這段之後加：

```ts
  if (has('from_stage') || has('to_stage')) {
    const stage = (value: unknown) => RECRUITMENT_STAGE_LABELS[String(value)] ?? String(value)
    lines.push(m.from_stage && m.to_stage ? `招生階段：${stage(m.from_stage)} → ${stage(m.to_stage)}` : `招生階段：${stage(m.from_stage ?? m.to_stage)}`)
  }
```

- [ ] **Step 8：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_funnel.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_records.py tests/test_audit_coverage.py tests/test_permission_table.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions && npm --prefix admin run test:unit -- labelCoverage
```
Expected: `test_admissions_funnel.py` `24 passed`（權限表 1＋允許的轉換 9＋註冊必填 1＋不允許 4＋原因必填 4＋接待權限 1＋409 先於 403 1＋並行 1＋看板 1＋稽核 1）；records 仍 `36 passed`；稽核涵蓋、權限表、`labelCoverage` 全過。

- [ ] **Step 9：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/funnel.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  admin/src/api/labels.ts backend/tests/admissions_helpers.py backend/tests/test_admissions_funnel.py
git commit -m "feat(admissions): 招生狀態轉換（比照園務 6.3 表與權限）與漏斗看板

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A5：保留座位、名額規劃與計畫名額

**Files:**
- Create: `backend/app/admissions/intake.py`
- Modify: `backend/app/admissions/schemas.py`（檔尾加 `SeatRequest`、`SeatOut`、`IntakePlanRowOut`、`IntakePlanTotalsOut`、`IntakePlanOut`、`IntakeTargetsRequest`）
- Modify: `backend/app/admissions/routes.py`（import 區、檔尾加三個端點）
- Modify: `admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS`、`AUDIT_TARGET_LABELS`、`AUDIT_METADATA_FORMATTERS`）
- Test: `backend/tests/test_admissions_intake.py`

**Interfaces:**
- Consumes：A3 `records.VersionConflict`、`records.write_event`、routes 的 `_locked_visit_for`、`_require_campus`、`_version_conflict`；A4 `funnel.derive_stage`、`admissions_helpers.transition`、`record_at_stage`；A2 `GradeIntakeTarget`。
- Produces：
  - `intake.SeatNotAllowed(message)`、`intake.set_seat(db, visit, *, grade, target_school_year, target_semester, expected_version, actor_user_id) -> bool`（是否超額）、`intake.intake_plan(db, campus_key, school_year, semester) -> dict`、`intake.save_targets(db, campus_key, school_year, semester, targets, actor_user_id) -> list[str]`（有變動的年級，依 `GRADES` 順序）
  - `intake_plan` 回傳 `{"school_year", "semester", "rows": [{"grade", "target_seats": int | None, "reserved", "enrolled", "remaining": int | None, "over_capacity"}], "totals": {"target_seats": int | None, "reserved", "enrolled", "remaining": int | None}}`（C2 的五校比較讀 `rows`）
  - `schemas.SeatRequest`（`grade`（null＝釋放）、`target_school_year`、`target_semester`、`expected_version`）、`SeatOut`（調整第 12 條）、`IntakePlanRowOut`、`IntakePlanTotalsOut`、`IntakePlanOut`、`IntakeTargetsRequest`（`{school_year, semester, targets: {年級: int | null}}`，null＝刪除該年級的計畫列）
  - API：`POST /admin/admissions/records/{visit_id}/seat`、`GET /admin/admissions/intake-plan`、`PUT /admin/admissions/intake-targets`
  - 錯誤碼：422 `SEAT_NOT_ALLOWED`（message 用園務原文）；回應裡的警示代碼 `SEAT_CAPACITY_WARNING`
  - 稽核：`recruitment_visit.seat`（`grade_set`、`capacity_warning`）、`grade_intake_target.update`（`school_year`、`semester`、`grades`）

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_intake.py`：

```python
"""保留座位、名額規劃與計畫名額（規格 6.5、8；R08、R09；Review Focus 4）。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select, update

from app.admissions.models import GradeIntakeTarget, RecruitmentVisit
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    create_record,
    record_at_stage,
    reception_yihua_client,
    transition,
)

RECORDS = f"{ADMISSIONS}/records"
PLAN = f"{ADMISSIONS}/intake-plan?campus_key=yihua&school_year=115&semester=1"


async def _seat(client, record: dict, grade: str | None, **fields):
    body = {"grade": grade, "target_school_year": 115, "target_semester": 1, "expected_version": record["version"]}
    return await client.post(f"{RECORDS}/{record['id']}/seat", json={**body, **fields})


async def _targets(client, targets: dict, *, school_year: int = 115, semester: int = 1, campus_key: str = "yihua"):
    return await client.put(
        f"{ADMISSIONS}/intake-targets?campus_key={campus_key}",
        json={"school_year": school_year, "semester": semester, "targets": targets},
    )


async def _plan(client, url: str = PLAN) -> dict:
    response = await client.get(url)
    assert response.status_code == 200, response.text
    return response.json()


def _rows(plan: dict) -> dict[str, tuple]:
    """年級 → (計畫名額, 已保留, 已註冊, 剩餘, 超額)。"""
    return {
        row["grade"]: (row["target_seats"], row["reserved"], row["enrolled"], row["remaining"], row["over_capacity"])
        for row in plan["rows"]
    }


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


@pytest.mark.asyncio
async def test_seat_requires_deposit_year_and_not_enrolled(admin_client):
    """R08：未預繳、未給學年拒絕；已註冊的不能改也不能清除保留（規格 6.5）。"""
    visited = await create_record(admin_client)
    response = await _seat(admin_client, visited, "小班")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "SEAT_NOT_ALLOWED"
    assert response.json()["detail"]["message"] == "未預繳的訪視不可保留座位"

    deposited = await record_at_stage(admin_client, "deposited", child_name="已預繳")
    no_year = await _seat(admin_client, deposited, "小班", target_school_year=None)
    assert no_year.status_code == 422
    assert no_year.json()["detail"]["message"] == "保留座位需指定目標學年"
    stale = await _seat(admin_client, deposited, "小班", expected_version=deposited["version"] + 5)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"

    withdrawn = await record_at_stage(admin_client, "withdrawn", child_name="已退出")
    assert (await _seat(admin_client, withdrawn, "小班")).status_code == 422

    enrolled = await record_at_stage(admin_client, "enrolled", child_name="已註冊")
    change = await _seat(admin_client, enrolled, "中班")
    assert change.status_code == 422 and "請先取消註冊" in change.json()["detail"]["message"]
    release = await _seat(admin_client, enrolled, None)
    assert release.status_code == 422
    assert release.json()["detail"]["message"] == "已註冊的訪視不可清除保留，要改年級或學期請先取消註冊"
    assert (await admin_client.get(f"{RECORDS}/{enrolled['id']}")).json()["provisional_grade"] == "小班"
```

同一檔接著寫：

```python
@pytest.mark.asyncio
async def test_reserve_and_release_keep_term_and_write_events(admin_client):
    deposited = await record_at_stage(admin_client, "deposited")
    reserved = await _seat(admin_client, deposited, "小班", target_school_year=116, target_semester=None)
    assert reserved.status_code == 200, reserved.text
    body = reserved.json()
    assert body["visit"]["provisional_grade"] == "小班"
    assert (body["visit"]["target_school_year"], body["visit"]["target_semester"]) == (116, 1)  # 學期預設上學期
    assert (body["capacity_warning"], body["warning_code"]) == (False, None)
    assert body["visit"]["version"] == deposited["version"] + 1

    released = await _seat(admin_client, body["visit"], None, target_school_year=None, target_semester=None)
    assert released.status_code == 200, released.text
    visit = released.json()["visit"]
    # 釋放只清年級，入學學年學期保留（否則卡片會從看板消失；同園務）。
    assert (visit["provisional_grade"], visit["target_school_year"], visit["target_semester"]) == (None, 116, 1)
    again = await _seat(admin_client, visit, None)
    assert again.status_code == 422 and again.json()["detail"]["message"] == "這筆訪視目前沒有保留座位"

    events = [
        (e["event_type"], e["from_stage"], e["to_stage"], e["metadata_json"])
        for e in (await admin_client.get(f"{RECORDS}/{deposited['id']}/events")).json()
        if e["event_type"].startswith("seat_")
    ]
    assert events == [
        ("seat_reserved", "deposited", "deposited", {"grade": "小班", "school_year": 116, "semester": 1}),
        ("seat_released", "deposited", "deposited", {"grade": "小班", "school_year": 116, "semester": 1}),
    ]


@pytest.mark.asyncio
async def test_over_capacity_only_warns(admin_client, db_session):
    """R08：超過計畫名額只警示（SEAT_CAPACITY_WARNING 放在回應），照樣保留。"""
    assert (await _targets(admin_client, {"小班": 1})).status_code == 200
    first = await record_at_stage(admin_client, "deposited", child_name="一")
    second = await record_at_stage(admin_client, "deposited", child_name="二")
    assert (await _seat(admin_client, first, "小班")).json()["capacity_warning"] is False
    over = await _seat(admin_client, second, "小班")
    assert over.status_code == 200, over.text
    assert (over.json()["capacity_warning"], over.json()["warning_code"]) == (True, "SEAT_CAPACITY_WARNING")
    assert over.json()["visit"]["provisional_grade"] == "小班"
    assert await _audit(db_session, "recruitment_visit.seat") == [
        {"grade_set": True, "capacity_warning": False},
        {"grade_set": True, "capacity_warning": True},
    ]


@pytest.mark.asyncio
async def test_intake_plan_counts_match_spec(admin_client, db_session):
    """R09：已保留、已註冊、退出、轉學期、他學期、他校、未設定計畫（規格 8）。"""
    assert (await _targets(admin_client, {"小班": 2, "中班": 0})).status_code == 200
    # 已保留小班兩筆：其中一筆勾了轉其他學期，同園務 compute_intake_plan 仍依目標學期計算。
    for name, transfer in (("保留一", False), ("保留二", True)):
        record = await record_at_stage(admin_client, "deposited", child_name=name)
        seated = (await _seat(admin_client, record, "小班")).json()["visit"]
        if transfer:
            response = await admin_client.patch(
                f"{RECORDS}/{record['id']}", json={"expected_version": seated["version"], "transfer_term": True}
            )
            assert response.status_code == 200, response.text
    # 已註冊：小班（record_at_stage 的註冊）、中班。
    await record_at_stage(admin_client, "enrolled", child_name="註冊小班")
    middle = await record_at_stage(admin_client, "deposited", child_name="註冊中班")
    await transition(admin_client, middle, "enrolled", grade="中班", target_school_year=115, target_semester=1)
    # 舊資料：已註冊但沒有 provisional_grade，年級取 grade（COALESCE）。
    legacy = await record_at_stage(admin_client, "enrolled", child_name="舊資料大班")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(legacy["id"]))
        .values(provisional_grade=None, grade="大班")
    )
    await db_session.commit()
    # 不該算進來的：保留後退預繳、下學期的保留、他校的保留、沒保留的已預繳與已訪視。
    gone = await record_at_stage(admin_client, "deposited", child_name="退預繳")
    gone = (await _seat(admin_client, gone, "小班")).json()["visit"]
    await transition(admin_client, gone, "withdrawn", reason="改送他校")
    spring = await record_at_stage(admin_client, "deposited", child_name="下學期")
    await _seat(admin_client, spring, "小班", target_semester=2)
    minghua = await record_at_stage(admin_client, "deposited", campus_key="minghua", child_name="明華")
    await _seat(admin_client, minghua, "小班")
    await record_at_stage(admin_client, "deposited", child_name="沒保留")
    await create_record(admin_client, child_name="只參觀")

    plan = await _plan(admin_client)
    assert [row["grade"] for row in plan["rows"]] == ["幼幼班", "小班", "中班", "大班"]
    assert _rows(plan) == {
        "幼幼班": (None, 0, 0, None, False),  # 未設定，與 0 分開
        "小班": (2, 2, 1, -1, True),
        "中班": (0, 0, 1, -1, True),
        "大班": (None, 0, 1, None, False),
    }
    assert plan["totals"] == {"target_seats": 2, "reserved": 2, "enrolled": 3, "remaining": -2}
    assert (plan["school_year"], plan["semester"]) == (115, 1)
    spring_plan = await _plan(admin_client, f"{ADMISSIONS}/intake-plan?campus_key=yihua&school_year=115&semester=2")
    assert _rows(spring_plan)["小班"] == (None, 1, 0, None, False)
    assert spring_plan["totals"] == {"target_seats": None, "reserved": 1, "enrolled": 0, "remaining": None}
```


@pytest.mark.asyncio
async def test_save_targets_upserts_and_null_deletes(admin_client, db_session):
    saved = await _targets(admin_client, {"小班": 10, "中班": 0})
    assert saved.status_code == 200, saved.text
    assert _rows(saved.json())["小班"][0] == 10 and _rows(saved.json())["中班"][0] == 0
    again = await _targets(admin_client, {"小班": 12, "中班": 0, "大班": None})
    assert _rows(again.json())["小班"][0] == 12
    cleared = await _targets(admin_client, {"中班": None})
    assert _rows(cleared.json())["中班"][0] is None  # 回到「未設定」
    assert await db_session.scalar(select(func.count()).select_from(GradeIntakeTarget)) == 1
    # 沒有任何變動不寫稽核；下學期是另一組計畫。
    await _targets(admin_client, {"小班": 12})
    await _targets(admin_client, {"小班": 5}, semester=2)
    assert _rows(await _plan(admin_client))["小班"][0] == 12
    assert await _audit(db_session, "grade_intake_target.update") == [
        {"school_year": 115, "semester": 1, "grades": ["小班", "中班"]},
        {"school_year": 115, "semester": 1, "grades": ["小班"]},
        {"school_year": 115, "semester": 1, "grades": ["中班"]},
        {"school_year": 115, "semester": 2, "grades": ["小班"]},
    ]
    for bad in ({"小一": 3}, {"小班": -1}, {"小班": 1000}):
        assert (await _targets(admin_client, bad)).status_code == 422, bad
    extra = await admin_client.put(
        f"{ADMISSIONS}/intake-targets?campus_key=yihua",
        json={"school_year": 115, "semester": 1, "targets": {}, "campus_key": "minghua"},
    )
    assert extra.status_code == 422


@pytest.mark.asyncio
async def test_cancel_withdraw_restores_reserved_seat(admin_client):
    """Review Focus 4：退註冊 → 取消退出回已預繳，預繳恢復、註冊日期已清、保留座位
    還在並算進「已保留」；退預繳 → 取消退出回已訪視，不算進任何名額。"""
    record = await record_at_stage(admin_client, "deposited", child_name="退註冊")
    seated = (await _seat(admin_client, record, "小班")).json()["visit"]
    enrolled = await transition(admin_client, seated, "enrolled")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (0, 1)
    withdrawn = await transition(admin_client, enrolled, "withdrawn", reason="搬家")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (0, 0)
    back = await transition(admin_client, withdrawn, "deposited")
    assert (back["stage"], back["has_deposit"], back["enrolled_on"], back["provisional_grade"]) == ("deposited", True, None, "小班")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (1, 0)

    other = await record_at_stage(admin_client, "deposited", child_name="退預繳")
    other = (await _seat(admin_client, other, "中班")).json()["visit"]
    other = await transition(admin_client, other, "withdrawn", reason="改送他校")
    visited = await transition(admin_client, other, "visited")
    assert (visited["stage"], visited["has_deposit"]) == ("visited", False)
    rows = _rows(await _plan(admin_client))
    assert rows["中班"][1:3] == (0, 0)
    assert rows["小班"][1:3] == (1, 0)


@pytest.mark.asyncio
async def test_intake_permissions_and_scope(admin_client, reception_yihua_client, editor_client, minghua_client):
    record = await record_at_stage(admin_client, "deposited")
    assert (await _seat(reception_yihua_client, record, "小班")).status_code == 200
    assert (await _targets(reception_yihua_client, {"小班": 3})).status_code == 200
    assert (await reception_yihua_client.get(PLAN)).status_code == 200
    assert (await editor_client.get(PLAN)).status_code == 403
    assert (await _targets(editor_client, {"小班": 3})).status_code == 403
    assert (await minghua_client.get(PLAN)).status_code == 404
    assert (await _targets(minghua_client, {"小班": 3})).status_code == 404
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (await _seat(minghua_client, current, None)).status_code == 404
    assert (await admin_client.get(f"{ADMISSIONS}/intake-plan?campus_key=nowhere&school_year=115")).status_code == 404
```

- [ ] **Step 2：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_intake.py -q
```
Expected: FAIL（`/seat`、`/intake-plan`、`/intake-targets` 回 404／405，`assert ... == 200` 失敗）。

- [ ] **Step 3：`intake.py`**

`backend/app/admissions/intake.py`：

```python
"""保留座位、名額計算與計畫名額（規格 6.5、8；園務 services/recruitment_intake_plan.py
compute_intake_plan、set_provisional_seat、seat_capacity_warning）。

只 flush、丟自訂例外；權限、稽核與 commit 在 routes.py。官網沒有班級，所以
「已註冊」只有園務的「未編班」路徑：年級取 COALESCE(provisional_grade, grade)、
學年學期取訪視的 target_*。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants, records
from app.admissions.funnel import derive_stage
from app.admissions.models import GradeIntakeTarget, RecruitmentVisit


class SeatNotAllowed(Exception):
    """這筆訪視現在不能保留或釋放座位（message 用園務原文，路由回 422）。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def set_seat(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    grade: str | None,
    target_school_year: int | None,
    target_semester: int | None,
    expected_version: int,
    actor_user_id: uuid.UUID | None,
) -> bool:
    """grade 有值＝保留座位，None＝釋放保留。回傳是否超過計畫名額（只警示）。
    呼叫前已用 records.get_visit_for_update 鎖列。

    - 只有已預繳（未註冊、未退出）的訪視可以保留；要指定目標學年，學期預設上學期。
    - 已註冊的訪視不能改、也不能清除保留：要改年級或學期先取消註冊。
    - 釋放只清 provisional_grade、保留 target_*（園務 recruitment_intake_plan.py:220-226）。"""
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    stage = derive_stage(visit)
    if grade is None:
        if stage == "enrolled":
            raise SeatNotAllowed("已註冊的訪視不可清除保留，要改年級或學期請先取消註冊")
        if visit.provisional_grade is None:
            raise SeatNotAllowed("這筆訪視目前沒有保留座位")
        metadata = {"grade": visit.provisional_grade, "school_year": visit.target_school_year, "semester": visit.target_semester}
        visit.provisional_grade = None
        event_type = "seat_released"
    else:
        if stage == "enrolled":
            raise SeatNotAllowed("已註冊的訪視不能改保留座位，要改年級或學期請先取消註冊")
        if stage != "deposited":
            raise SeatNotAllowed("未預繳的訪視不可保留座位")
        if target_school_year is None:
            raise SeatNotAllowed("保留座位需指定目標學年")
        visit.provisional_grade = grade
        visit.target_school_year = target_school_year
        visit.target_semester = target_semester or 1
        metadata = {"grade": grade, "school_year": visit.target_school_year, "semester": visit.target_semester}
        event_type = "seat_reserved"
    now = datetime.now(timezone.utc)
    records.write_event(
        db, visit, event_type=event_type, from_stage=stage, to_stage=stage,
        actor_user_id=actor_user_id, metadata=metadata, created_at=now,
    )
    visit.version += 1
    visit.updated_at = now
    await db.flush()
    if grade is None:
        return False
    plan = await intake_plan(db, visit.campus_key, visit.target_school_year, visit.target_semester)
    return next(row["over_capacity"] for row in plan["rows"] if row["grade"] == grade)


async def intake_plan(db: AsyncSession, campus_key: str, school_year: int, semester: int) -> dict:
    """規格 8：每個年級一列（四個年級固定順序）。

    - 已保留：has_deposit、未註冊、provisional_grade 是該年級、目標學年學期相符。
      退出時 has_deposit 已清成 false，所以不會被算進來。
    - 已註冊：enrolled、COALESCE(provisional_grade, grade) 是該年級、目標學年學期相符。
    - 剩餘＝計畫−已保留−已註冊，可以是負數；沒有計畫列（未設定）時是 None。
    - 超額：有計畫名額且已保留＋已註冊 > 計畫名額，只警示。
    - 合計：計畫名額與剩餘只加總有設定的年級，一個都沒設定時是 None。
    轉其他學期（transfer_term）不影響名額，同園務 compute_intake_plan。"""
    term = (
        RecruitmentVisit.campus_key == campus_key,
        RecruitmentVisit.target_school_year == school_year,
        RecruitmentVisit.target_semester == semester,
    )
    reserved_rows = await db.execute(
        select(RecruitmentVisit.provisional_grade, func.count())
        .where(
            *term,
            RecruitmentVisit.has_deposit.is_(True),
            RecruitmentVisit.enrolled.is_(False),
            RecruitmentVisit.provisional_grade.is_not(None),
        )
        .group_by(RecruitmentVisit.provisional_grade)
    )
    enrolled_grade = func.coalesce(RecruitmentVisit.provisional_grade, RecruitmentVisit.grade)
    enrolled_rows = await db.execute(
        select(enrolled_grade, func.count()).where(*term, RecruitmentVisit.enrolled.is_(True)).group_by(enrolled_grade)
    )
    target_rows = await db.execute(
        select(GradeIntakeTarget.grade, GradeIntakeTarget.target_seats).where(
            GradeIntakeTarget.campus_key == campus_key,
            GradeIntakeTarget.school_year == school_year,
            GradeIntakeTarget.semester == semester,
        )
    )
    reserved = {grade: int(count) for grade, count in reserved_rows.all()}
    enrolled = {grade: int(count) for grade, count in enrolled_rows.all()}
    targets = {grade: seats for grade, seats in target_rows.all()}
    rows = []
    for grade in constants.GRADES:
        target = targets.get(grade)
        held, joined = reserved.get(grade, 0), enrolled.get(grade, 0)
        rows.append(
            {
                "grade": grade,
                "target_seats": target,
                "reserved": held,
                "enrolled": joined,
                "remaining": None if target is None else target - held - joined,
                "over_capacity": target is not None and held + joined > target,
            }
        )
    planned = [row for row in rows if row["target_seats"] is not None]
    totals = {
        "target_seats": sum(row["target_seats"] for row in planned) if planned else None,
        "reserved": sum(row["reserved"] for row in rows),
        "enrolled": sum(row["enrolled"] for row in rows),
        "remaining": sum(row["remaining"] for row in planned) if planned else None,
    }
    return {"school_year": school_year, "semester": semester, "rows": rows, "totals": totals}


async def save_targets(
    db: AsyncSession,
    campus_key: str,
    school_year: int,
    semester: int,
    targets: dict[str, int | None],
    actor_user_id: uuid.UUID | None,
) -> list[str]:
    """存同校同學期的計畫名額。值是 None 代表刪掉該年級的計畫列（回到「未設定」）；
    沒出現在 targets 的年級不動。回傳有變動的年級（GRADES 順序）。同一組
    （校、學年、學期）先排隊，兩人同時第一次設定不會撞唯一鍵。"""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"grade_intake_targets:{campus_key}:{school_year}:{semester}"},
    )
    result = await db.execute(
        select(GradeIntakeTarget).where(
            GradeIntakeTarget.campus_key == campus_key,
            GradeIntakeTarget.school_year == school_year,
            GradeIntakeTarget.semester == semester,
        )
    )
    existing = {row.grade: row for row in result.scalars()}
    now = datetime.now(timezone.utc)
    changed: list[str] = []
    for grade in constants.GRADES:
        if grade not in targets:
            continue
        seats = targets[grade]
        row = existing.get(grade)
        if seats is None:
            if row is not None:
                await db.delete(row)
                changed.append(grade)
        elif row is None:
            db.add(
                GradeIntakeTarget(
                    id=uuid.uuid4(),
                    campus_key=campus_key,
                    grade=grade,
                    school_year=school_year,
                    semester=semester,
                    target_seats=seats,
                    created_at=now,
                    updated_at=now,
                    updated_by=actor_user_id,
                )
            )
            changed.append(grade)
        elif row.target_seats != seats:
            row.target_seats = seats
            row.updated_at = now
            row.updated_by = actor_user_id
            changed.append(grade)
    await db.flush()
    return changed
```

- [ ] **Step 4：座位與名額的 schema**

`backend/app/admissions/schemas.py` 檔尾加：

```python


class SeatRequest(BaseModel):
    """保留座位（grade 有值）或釋放保留（grade 為 null）（規格 6.5）。"""

    model_config = ConfigDict(extra="forbid")

    grade: Grade | None
    # 保留時必填（缺了回 422 SEAT_NOT_ALLOWED「保留座位需指定目標學年」）。
    target_school_year: SchoolYear | None = None
    # 沒給用上學期。
    target_semester: Semester | None = None
    expected_version: int = Field(ge=1)


class SeatOut(BaseModel):
    """A 計畫調整第 12 條：超額只警示，警示代碼放在回應，不是錯誤。"""

    visit: RecruitmentVisitOut
    capacity_warning: bool
    warning_code: Literal["SEAT_CAPACITY_WARNING"] | None


class IntakePlanRowOut(BaseModel):
    grade: Grade
    # None＝未設定（沒有計畫列），與「計畫名額 0」分開。
    target_seats: int | None
    reserved: int
    enrolled: int
    # 計畫−已保留−已註冊，可以是負數；未設定時 None。
    remaining: int | None
    over_capacity: bool


class IntakePlanTotalsOut(BaseModel):
    # 計畫名額與剩餘只加總有設定的年級；一個都沒設定時 None。
    target_seats: int | None
    reserved: int
    enrolled: int
    remaining: int | None


class IntakePlanOut(BaseModel):
    school_year: int
    semester: int
    rows: list[IntakePlanRowOut]
    totals: IntakePlanTotalsOut


class IntakeTargetsRequest(BaseModel):
    """同校同學期一次送多個年級（規格 13 PUT /intake-targets）。值是 null＝刪除
    該年級的計畫（回到「未設定」）；沒送的年級不動。"""

    model_config = ConfigDict(extra="forbid")

    school_year: SchoolYear
    semester: Semester
    targets: dict[Grade, Annotated[int, Field(ge=0, le=999)] | None]
```

- [ ] **Step 5：座位與名額的路由**

`backend/app/admissions/routes.py`：

1. import 區：`from app.admissions import academic, constants, funnel, records` 換成 `from app.admissions import academic, constants, funnel, intake, records`；`from app.admissions.schemas import (...)` 加入 `IntakePlanOut`、`IntakeTargetsRequest`、`SeatOut`、`SeatRequest`。

2. 檔尾加：

```python
@router.post("/admin/admissions/records/{visit_id}/seat", response_model=SeatOut)
async def set_recruitment_seat(
    visit_id: uuid.UUID,
    payload: SeatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SeatOut:
    """保留或釋放座位（規格 6.5）。超過計畫名額只警示，照樣保留。"""
    visit = await _locked_visit_for(db, current_user, visit_id, "admissions.write")
    try:
        warning = await intake.set_seat(
            db,
            visit,
            grade=payload.grade,
            target_school_year=payload.target_school_year,
            target_semester=payload.target_semester,
            expected_version=payload.expected_version,
            actor_user_id=current_user.id,
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except intake.SeatNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "SEAT_NOT_ALLOWED", "message": exc.message},
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.seat",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"grade_set": payload.grade is not None, "capacity_warning": warning},
    )
    await db.commit()
    return SeatOut(
        visit=RecruitmentVisitOut.model_validate(visit),
        capacity_warning=warning,
        warning_code="SEAT_CAPACITY_WARNING" if warning else None,
    )


@router.get("/admin/admissions/intake-plan", response_model=IntakePlanOut)
async def get_intake_plan(
    campus_key: str,
    school_year: int = Query(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX),
    semester: int = Query(default=1, ge=1, le=2),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> IntakePlanOut:
    _require_campus(current_user, "admissions.read", campus_key)
    return IntakePlanOut.model_validate(await intake.intake_plan(db, campus_key, school_year, semester))


@router.put("/admin/admissions/intake-targets", response_model=IntakePlanOut)
async def save_intake_targets(
    campus_key: str,
    payload: IntakeTargetsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> IntakePlanOut:
    """存計畫名額後回傳最新的名額規劃。沒有任何變動不寫稽核。"""
    _require_campus(current_user, "admissions.write", campus_key)
    changed = await intake.save_targets(
        db, campus_key, payload.school_year, payload.semester, dict(payload.targets), current_user.id
    )
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="grade_intake_target.update",
            target_type="grade_intake_target",
            target_id=f"{campus_key}:{payload.school_year}:{payload.semester}",
            campus_key=campus_key,
            metadata={"school_year": payload.school_year, "semester": payload.semester, "grades": changed},
        )
    plan = await intake.intake_plan(db, campus_key, payload.school_year, payload.semester)
    await db.commit()
    return IntakePlanOut.model_validate(plan)
```

- [ ] **Step 6：稽核標籤**

`admin/src/api/labels.ts`：

1. `AUDIT_ACTION_LABELS`：在 `'recruitment_visit.transition': '變更招生階段',` 之後加：

```ts
  'recruitment_visit.seat': '保留或釋放座位',
  'grade_intake_target.update': '設定計畫名額',
```

2. `AUDIT_TARGET_LABELS`：在 `recruitment_visit: '招生訪視',` 之後加：

```ts
  grade_intake_target: '計畫名額',
```

3. `AUDIT_METADATA_FORMATTERS`：在 A3 加的 `stage:` 那一行之後加：

```ts
  grade_set: (v) => (v ? '保留座位' : '釋放保留座位'),
  capacity_warning: (v) => (v ? '超過計畫名額（只提醒，沒有擋下）' : null),
  school_year: (v) => `入學學年：${String(v)} 學年`,
  semester: (v) => `入學學期：${v === 1 ? '上學期' : v === 2 ? '下學期' : String(v)}`,
  grades: (v) => (Array.isArray(v) ? `調整的年級：${v.map(String).join('、')}` : null),
```

- [ ] **Step 7：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_intake.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_funnel.py tests/test_audit_coverage.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions && npm --prefix admin run test:unit -- labelCoverage
```
Expected: `test_admissions_intake.py` `7 passed`；funnel 仍 `24 passed`、稽核涵蓋全過；`labelCoverage` 全過。

- [ ] **Step 8：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/intake.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  admin/src/api/labels.ts backend/tests/test_admissions_intake.py
git commit -m "feat(admissions): 保留座位、名額規劃與計畫名額（未設定與 0 分開、超額只警示）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A6：預約「已到場」自動建立招生訪視、補建與待確認清單

**Files:**
- Create: `backend/app/admissions/booking_link.py`
- Modify: `backend/app/booking/workflow_service.py`（import 區第 10 行 `from app.auth.models import User` 之前；`mark_completed` 第 227–246 行）
- Modify: `backend/app/admissions/schemas.py`（第一行 datetime import 加 `time`；檔尾加 `ArrivalRowOut`、`ArrivalsOut`）
- Modify: `backend/app/admissions/routes.py`（import 區、檔尾加兩個端點）
- Modify: `admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS`、`AUDIT_METADATA_FORMATTERS` 的 `created`；調整第 14 條）
- Modify: `backend/tests/admissions_helpers.py`（import 區、檔尾加「已開始場次的預約」helper）
- Test: `backend/tests/test_admissions_booking_link.py`

**Interfaces:**
- Consumes：A3 `records.create_visit`；A1 `academic.current_term`、`grade_for_birthday`、`roc_month`；`app.booking.history.load_slot`；`app.booking.status_groups.group_condition("past", now)`；`app.booking.workflow_service._resolver_id`；conftest 的 `book_slot`、`legacy_request`、`booking_consent`。
- Produces：
  - `booking_link.REFERRAL_SOURCE_TEXT`、`NOTES_PREFIX`、`fields_from_visit_request(visit_request, *, today, slot_date=None) -> dict`（調整第 4 條；純函式，不丟例外）、`ensure_from_visit_request(db, visit_request, *, actor_user_id) -> tuple[RecruitmentVisit, bool]`、`arrivals(db, campus_key, *, now=None) -> dict`（調整第 5 條）
  - `arrivals` 回傳 `{"awaiting": [row], "missing": [row]}`，row＝`{"visit_request_id", "slot_date", "start_time", "parent_name", "child_name", "party_size", "status"}`
  - `workflow_service.mark_completed` 在 `_close` 之後、`flush` 之前呼叫 `ensure_from_visit_request`
  - `schemas.ArrivalRowOut`、`ArrivalsOut`
  - API：`GET /admin/admissions/arrivals`（`booking.read`）、`POST /admin/admissions/from-visit-request/{visit_request_id}`（`booking.read`＋`admissions.write`，可重複呼叫）
  - 錯誤碼：409 `VISIT_REQUEST_NOT_COMPLETED`、409 `VISIT_REQUEST_ANONYMIZED`（調整第 13 條）
  - 稽核：`recruitment_visit.create_from_booking`（`created`）
  - 測試共用：`admissions_helpers.move_slot(db_session, slot_id, *, slot_date, starts_at=None, closed=None)`、`started_booking(admin_client, public_client, db_session, *, campus_key="yihua", slot_date=None, starts_at=None, **fields) -> dict`（多 `id`、`phone`）、`complete(client, visit_request_id)`

- [ ] **Step 1：測試 helper 加「已開始場次的預約」**

`backend/tests/admissions_helpers.py`：

1. import 區換成：

```python
from __future__ import annotations

import itertools
import uuid
from datetime import date, time, timedelta

import pytest_asyncio
from sqlalchemy import update

from app.auth.models import Role
from app.booking.models import VisitSlot
from app.common.timezones import today_local
from tests.conftest import _create_user, _logged_in_client, book_slot
```

2. 檔尾加：

```python
async def move_slot(
    db_session, slot_id, *, slot_date: date, starts_at: time | None = None, closed: bool | None = None
) -> None:
    """把場次移到指定日期（與開始時間），或改成停止申請。只改資料庫，不改系統時間（規格 14）。"""
    values: dict = {"slot_date": slot_date}
    if starts_at is not None:
        values["start_time"] = starts_at
    if closed is not None:
        values["closed"] = closed
        values["closed_source"] = "manual" if closed else None
    await db_session.execute(update(VisitSlot).where(VisitSlot.id == uuid.UUID(str(slot_id))).values(**values))
    await db_session.commit()


async def started_booking(
    admin_client,
    public_client,
    db_session,
    *,
    campus_key: str = "yihua",
    slot_date: date | None = None,
    starts_at: time | None = None,
    **fields,
) -> dict:
    """「已開始場次的預約」（規格 14）：家長選未來場次送出（book_slot，送出即 confirmed），
    再把那一場移到過去（預設昨天、開始時間不變）。回傳 book_slot 的內容，另加
    id（預約 id）與 phone。每次自動換手機號碼，避開同手機 10 分鐘 5 筆的上限。"""
    fields.setdefault("phone", unique_phone())
    booking = await book_slot(admin_client, public_client, campus_key, **fields)
    await move_slot(
        db_session, booking["slot_id"], slot_date=slot_date or today_local() - timedelta(days=1), starts_at=starts_at
    )
    return {**booking, "id": booking["receipt_id"], "phone": fields["phone"]}


async def complete(client, visit_request_id):
    """預約既有的「標記已到場」。"""
    return await client.post(f"{API}/admin/visit-requests/{visit_request_id}/complete")
```

- [ ] **Step 2：寫失敗的測試**

`backend/tests/test_admissions_booking_link.py`：

```python
"""官網預約「已到場」自動建立招生訪視、補建與待確認清單（規格 6.1；R01、R01a；
Review Focus 1、2）。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.admissions import academic, booking_link, constants, records
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking import status_groups
from app.booking.models import VisitRequest
from app.common.timezones import OPERATING_TZ, today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    complete,
    move_slot,
    reception_yihua_client,
    started_booking,
)
from tests.conftest import legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

LABELS_TS = Path(__file__).resolve().parents[2] / "admin" / "src" / "api" / "labels.ts"
ARRIVALS = f"{ADMISSIONS}/arrivals?campus_key=yihua"


async def _visits_for(db_session, visit_request_id) -> list[RecruitmentVisit]:
    result = await db_session.execute(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(visit_request_id)))
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


def _request(**overrides) -> SimpleNamespace:
    values = {
        "child_name": "王小明",
        "child_birthdate": date(2023, 3, 2),
        "phone": "0912345678",
        "parent_name": "王媽媽",
        "referral_sources": ["facebook", "friends_family"],
        "questions": "午睡怎麼安排？",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_fields_from_visit_request_maps_spec_fields():
    """規格 6.1 第 1 點的欄位對應。"""
    fields = booking_link.fields_from_visit_request(_request(), today=date(2026, 9, 8), slot_date=date(2026, 9, 5))
    assert fields == {
        "visit_date": date(2026, 9, 5),
        "child_name": "王小明",
        "birthday": date(2023, 3, 2),
        "grade": "小班",
        "phone": "0912345678",
        "contact_name": "王媽媽",
        "source": "Facebook、親友介紹",
        "notes": "家長想了解：午睡怎麼安排？",
        "target_school_year": 115,
        "target_semester": 1,
    }


def test_fields_from_visit_request_truncates_and_defaults():
    """Review Focus 1 的純函式部分：超長截斷、缺值用預設，不丟例外。"""
    long = booking_link.fields_from_visit_request(
        _request(
            child_name="王" * 64,
            parent_name="陳" * 64,
            referral_sources=list(booking_link.REFERRAL_SOURCE_TEXT),
            questions="問" * 1000,
        ),
        today=date(2026, 9, 8),
    )
    assert (len(long["child_name"]), len(long["contact_name"])) == (constants.LEN_CHILD_NAME, constants.LEN_CONTACT)
    assert long["source"] == "Facebook、Google 評論、媽媽社團、親友介紹、其他"
    assert len(long["source"]) <= constants.LEN_SOURCE
    assert long["notes"] == booking_link.NOTES_PREFIX + "問" * 1000
    assert long["visit_date"] == date(2026, 9, 8)  # 沒有場次：確認當天
    empty = booking_link.fields_from_visit_request(
        _request(child_name=None, child_birthdate=None, referral_sources=[], questions="   "), today=date(2026, 9, 8)
    )
    assert (empty["child_name"], empty["birthday"], empty["grade"], empty["source"], empty["notes"]) == (
        constants.MISSING_CHILD_NAME, None, None, None, None,
    )
    too_young = booking_link.fields_from_visit_request(_request(child_birthdate=date(2025, 1, 1)), today=date(2026, 9, 8))
    assert too_young["grade"] is None


@pytest.mark.parametrize(
    ("today", "term", "grade"),
    [
        (date(2026, 7, 31), (114, 2), "幼幼班"),
        (date(2026, 8, 1), (115, 1), "小班"),
        (date(2027, 1, 31), (115, 1), "小班"),
        (date(2027, 2, 1), (115, 2), "小班"),
    ],
)
def test_target_term_follows_confirmation_date(today, term, grade):
    """Review Focus 2：確認到場當天的台北學期；年級依那個學年換算。"""
    fields = booking_link.fields_from_visit_request(_request(child_birthdate=date(2023, 9, 1)), today=today)
    assert (fields["target_school_year"], fields["target_semester"]) == term
    assert fields["grade"] == grade


def test_referral_text_matches_admin_labels():
    """後端串來源文案用的對照，與後台 REFERRAL_SOURCE_LABELS 是同一組字。"""
    line = next(
        row for row in LABELS_TS.read_text(encoding="utf-8").splitlines()
        if row.startswith("export const REFERRAL_SOURCE_LABELS")
    )
    assert dict(re.findall(r"(\w+): '([^']+)'", line.split("=", 1)[1])) == booking_link.REFERRAL_SOURCE_TEXT
```

同一檔接著寫（標記已到場、補建、Review Focus 1、2）：

```python
@pytest.mark.asyncio
async def test_completion_creates_exactly_one_visit_and_rebuild_returns_it(admin_client, public_client, db_session):
    """R01：標記已到場建立一筆、欄位依規格 6.1；重複標記與補建都不會多一筆；刪掉後可以再補建。"""
    booking = await started_booking(
        admin_client, public_client, db_session,
        child_name="陳小寶", child_birthdate="2022-05-02", referral_sources=["google_reviews"], questions="有沒有英文課？",
    )
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    [visit] = await _visits_for(db_session, booking["id"])
    slot_date = today_local() - timedelta(days=1)
    school_year, semester = academic.current_term(today_local())
    assert (visit.campus_key, visit.visit_date, visit.month, visit.seq_no) == (
        "yihua", slot_date, academic.roc_month(slot_date), "1",
    )
    assert (visit.child_name, visit.birthday, visit.contact_name, visit.phone) == (
        "陳小寶", date(2022, 5, 2), "陳媽媽", booking["phone"],
    )
    assert visit.grade == academic.grade_for_birthday(date(2022, 5, 2), school_year)
    assert (visit.source, visit.notes) == ("Google 評論", "家長想了解：有沒有英文課？")
    assert (visit.target_school_year, visit.target_semester) == (school_year, semester)
    assert (visit.has_deposit, visit.enrolled, visit.version) == (False, False, 1)
    events = (
        await db_session.execute(select(RecruitmentEventLog).where(RecruitmentEventLog.recruitment_visit_id == visit.id))
    ).scalars().all()
    assert [(e.event_type, e.from_stage, e.to_stage, e.metadata_json) for e in events] == [
        ("created", None, "visited", {"origin": "visit_request"}),
    ]
    assert events[0].actor_user_id is not None  # 按下「標記已到場」的人

    again = await complete(admin_client, booking["id"])
    assert again.status_code == 409
    rebuilt = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert rebuilt.status_code == 200, rebuilt.text
    assert (rebuilt.json()["id"], rebuilt.json()["has_visit_request"]) == (str(visit.id), True)
    assert len(await _visits_for(db_session, booking["id"])) == 1

    deleted = await admin_client.delete(f"{ADMISSIONS}/records/{visit.id}?expected_version=1")
    assert deleted.status_code == 204
    recreated = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert recreated.status_code == 200, recreated.text
    assert recreated.json()["id"] != str(visit.id) and recreated.json()["child_name"] == "陳小寶"
    assert await _audit(db_session, "recruitment_visit.create_from_booking") == [{"created": False}, {"created": True}]
    # 「標記已到場」本身照舊只記預約的稽核。
    assert len(await _audit(db_session, "visit_request.complete")) == 1


@pytest.mark.asyncio
async def test_only_completed_and_not_anonymized_requests_can_be_rebuilt(admin_client, public_client, db_session):
    """R01：已取消、未到場、還沒確認到場的預約不產生招生訪視；已匿名化的不補建（調整第 13 條）。"""
    cancelled = await started_booking(admin_client, public_client, db_session)
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['id']}/cancel")).status_code == 200
    no_show = await started_booking(admin_client, public_client, db_session)
    assert (await admin_client.post(f"{API}/admin/visit-requests/{no_show['id']}/no-show")).status_code == 200
    pending = await started_booking(admin_client, public_client, db_session)
    for booking in (cancelled, no_show, pending):
        response = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "VISIT_REQUEST_NOT_COMPLETED"
        assert await _visits_for(db_session, booking["id"]) == []

    anonymized = await legacy_request(db_session, status="completed")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(anonymized)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    response = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{anonymized}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "VISIT_REQUEST_ANONYMIZED"
    assert (await admin_client.post(f"{ADMISSIONS}/from-visit-request/{uuid.uuid4()}")).status_code == 404


@pytest.mark.asyncio
async def test_completion_never_fails_on_long_or_missing_fields(admin_client, public_client, db_session):
    """Review Focus 1：孩子姓名與家長稱呼 64 字、勾滿五個得知管道、提問 500 字；
    以及什麼都沒填。照常標記成功，招生訪視欄位截斷或用預設值。"""
    full = await started_booking(
        admin_client, public_client, db_session,
        parent_name="陳" * 64, child_name="王" * 64, child_birthdate="2023-09-01",
        referral_sources=list(booking_link.REFERRAL_SOURCE_TEXT), questions="問" * 500,
    )
    bare = await started_booking(admin_client, public_client, db_session)
    for booking in (full, bare):
        response = await complete(admin_client, booking["id"])
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "completed"
    [long_visit] = await _visits_for(db_session, full["id"])
    assert (long_visit.child_name, long_visit.contact_name) == ("王" * 50, "陳" * 50)
    assert long_visit.source == "Facebook、Google 評論、媽媽社團、親友介紹、其他"
    assert long_visit.notes == "家長想了解：" + "問" * 500
    [bare_visit] = await _visits_for(db_session, bare["id"])
    assert (bare_visit.child_name, bare_visit.birthday, bare_visit.grade, bare_visit.source, bare_visit.notes) == (
        constants.MISSING_CHILD_NAME, None, None, None, None,
    )
    assert bare_visit.contact_name == "陳媽媽"


@pytest.mark.asyncio
async def test_database_error_rolls_back_the_whole_completion(admin_client, public_client, db_session, monkeypatch):
    """Global Constraints：不吞例外。資料庫錯誤時整個「標記已到場」回滾，不留下
    「已到場卻沒有招生訪視」的半套狀態。"""
    booking = await started_booking(admin_client, public_client, db_session)

    async def broken(*args, **kwargs):
        raise IntegrityError("INSERT INTO recruitment_visits", {}, Exception("模擬資料庫錯誤"))

    monkeypatch.setattr(records, "create_visit", broken)
    response = await complete(admin_client, booking["id"])
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "INTERNAL_ERROR"
    status = await db_session.scalar(
        select(VisitRequest.status)
        .where(VisitRequest.id == uuid.UUID(booking["id"]))
        .execution_options(populate_existing=True)
    )
    assert status == "confirmed"
    assert await _visits_for(db_session, booking["id"]) == []


@pytest.mark.asyncio
async def test_month_follows_slot_date_not_created_at(admin_client, public_client, db_session):
    """Review Focus 2：民國月份依場次日期（台北牆上日期），不依預約建立時間。"""
    booking = await started_booking(
        admin_client, public_client, db_session, slot_date=date(2025, 12, 31), starts_at=time(23, 30)
    )
    assert (await complete(admin_client, booking["id"])).status_code == 200
    [visit] = await _visits_for(db_session, booking["id"])
    assert (visit.visit_date, visit.month) == (date(2025, 12, 31), "114.12")
    created_at = await db_session.scalar(select(VisitRequest.created_at).where(VisitRequest.id == uuid.UUID(booking["id"])))
    assert academic.roc_month(today_local(created_at)) != "114.12"
    assert (visit.target_school_year, visit.target_semester) == academic.current_term(today_local())
```

同一檔接著寫（待確認清單 R01a 與權限）：

```python
@pytest.mark.asyncio
async def test_arrivals_lists_started_confirmed_and_completed_without_visit(admin_client, public_client, db_session):
    """R01a：只列 confirmed 且場次已開始（含剛好開始、含停止申請的場次）；結果與
    status_groups.group_condition("past") 去掉已到場、未到場一致。"""
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    local = now.astimezone(OPERATING_TZ)
    later = local + timedelta(minutes=1)

    async def booking(**kwargs) -> dict:
        return await started_booking(admin_client, public_client, db_session, **kwargs)

    yesterday = await booking(child_name="昨天")
    on_time = await booking(slot_date=local.date(), starts_at=local.time().replace(tzinfo=None), child_name="剛好開始")
    not_yet = await booking(slot_date=later.date(), starts_at=later.time().replace(tzinfo=None), child_name="還沒開始")
    stopped = await booking(child_name="停止申請")
    await move_slot(db_session, stopped["slot_id"], slot_date=today_local() - timedelta(days=1), closed=True)
    arrived = await booking(child_name="已到場")
    assert (await complete(admin_client, arrived["id"])).status_code == 200
    absent = await booking(child_name="未到場")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{absent['id']}/no-show")).status_code == 200
    cancelled = await booking(child_name="已取消")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['id']}/cancel")).status_code == 200
    other_campus = await started_booking(admin_client, public_client, db_session, campus_key="minghua")
    no_slot = await legacy_request(db_session, status="confirmed")
    legacy_done = await legacy_request(db_session, status="completed", parent_name="上線前到場的家長")
    legacy_gone = await legacy_request(db_session, status="completed")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(legacy_gone)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    result = await booking_link.arrivals(db_session, "yihua", now=now)
    awaiting = {str(row["visit_request_id"]) for row in result["awaiting"]}
    assert awaiting == {yesterday["id"], on_time["id"], stopped["id"]}
    for excluded in (not_yet, arrived, absent, cancelled, other_campus):
        assert excluded["id"] not in awaiting
    assert no_slot not in awaiting
    expected = (
        await db_session.execute(
            select(VisitRequest.id).where(
                VisitRequest.campus_key == "yihua",
                status_groups.group_condition("past", now),
                VisitRequest.status.not_in(["completed", "no_show"]),
            )
        )
    ).scalars()
    assert awaiting == {str(value) for value in expected}
    assert [str(row["visit_request_id"]) for row in result["missing"]] == [legacy_done]
    assert result["missing"][0]["parent_name"] == "上線前到場的家長"
    row = next(row for row in result["awaiting"] if str(row["visit_request_id"]) == yesterday["id"])
    assert (row["child_name"], row["parent_name"], row["party_size"], row["status"]) == ("昨天", "陳媽媽", 2, "confirmed")
    assert row["slot_date"] == today_local() - timedelta(days=1)

    # API 用現在時間：上面確定已開始的幾筆一定在。
    response = await admin_client.get(ARRIVALS)
    assert response.status_code == 200, response.text
    api_awaiting = {row["visit_request_id"] for row in response.json()["awaiting"]}
    assert {yesterday["id"], on_time["id"], stopped["id"]} <= api_awaiting
    assert [row["visit_request_id"] for row in response.json()["missing"]] == [legacy_done]
    # 補建之後就不在「沒有招生訪視」清單。
    assert (await admin_client.post(f"{ADMISSIONS}/from-visit-request/{legacy_done}")).status_code == 200
    assert (await booking_link.arrivals(db_session, "yihua", now=now))["missing"] == []


@pytest.mark.asyncio
async def test_arrivals_and_rebuild_permissions(admin_client, reception_yihua_client, editor_client, minghua_client, db_session):
    """arrivals 要 booking.read；補建要 booking.read＋admissions.write；他校 404（R07）。"""
    request_id = await legacy_request(db_session, status="completed")
    assert (await editor_client.get(ARRIVALS)).status_code == 403
    assert (await editor_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 403
    assert (await minghua_client.get(ARRIVALS)).status_code == 404
    assert (await minghua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 404
    assert (await reception_yihua_client.get(ARRIVALS)).status_code == 200
    created = await reception_yihua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert created.status_code == 200, created.text
    assert created.json()["visit_request_id"] == request_id
    assert created.json()["visit_date"] == today_local().isoformat()  # 舊案沒有場次：建立當天
```

- [ ] **Step 3：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_booking_link.py -q
```
Expected: FAIL（collection error：`ImportError: cannot import name 'booking_link' from 'app.admissions'`）。

- [ ] **Step 4：`booking_link.py`**

`backend/app/admissions/booking_link.py`：

```python
"""官網預約與招生訪視的串接（規格 6.1）。

- fields_from_visit_request：預約欄位 → 招生訪視欄位。純函式：截斷、補預設，
  不丟例外，也不碰 visit_request.slot（async 下 lazy load 會丟 MissingGreenlet）。
- ensure_from_visit_request：在「標記已到場」的同一個交易內建立招生訪視，已有
  就回傳那一筆；workflow_service.mark_completed 與補建端點共用。
- arrivals：「官網預約」分頁的待確認清單與「已到場但沒有招生訪視」。

整條建立路徑沒有會丟例外的資料檢查，也不用 try/except 吞例外：真的是資料庫
錯誤就讓整個「標記已到場」回滾，不會留下「已到場卻沒有招生訪視」的半套狀態。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants, records
from app.admissions.models import RecruitmentVisit
from app.booking import history, status_groups
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import today_local

# 「從哪裡知道我們」的後台顯示文案（與 admin labels.ts 的 REFERRAL_SOURCE_LABELS
# 同一組字，tests/test_admissions_booking_link.py 比對）。
REFERRAL_SOURCE_TEXT: dict[str, str] = {
    "facebook": "Facebook",
    "google_reviews": "Google 評論",
    "parent_community": "媽媽社團",
    "friends_family": "親友介紹",
    "other": "其他",
}
NOTES_PREFIX = "家長想了解："

_DONE = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)


def _cut(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value.strip()[:limit] or None


def fields_from_visit_request(visit_request, *, today: date, slot_date: date | None = None) -> dict:
    """規格 6.1 第 1 點的欄位對應（today 是確認到場當天的台北日期）：

    - visit_date：場次日期；沒有場次（舊案）用 today。
    - child_name：孩子姓名截到 50 字；沒填寫「（未填姓名）」。
    - grade：有生日時依 today 所在學年換算（範圍外為 None）。
    - phone、contact_name：家長手機與稱呼（稱呼截到 50 字）。
    - source：勾選的「從哪裡知道我們」照後台文案以「、」串接，截到 50 字。
    - notes：「家長想了解：」＋想了解的事；沒填為 None。
    - target_school_year／target_semester：today 所在學期（同園務建立時補當前學期）。
    家長 Email 不複製（園務招生沒有 Email 欄位）。"""
    school_year, semester = academic.current_term(today)
    birthday = visit_request.child_birthdate
    sources = "、".join(REFERRAL_SOURCE_TEXT.get(str(code), str(code)) for code in (visit_request.referral_sources or []))
    questions = (visit_request.questions or "").strip()
    return {
        "visit_date": slot_date or today,
        "child_name": _cut(visit_request.child_name, constants.LEN_CHILD_NAME) or constants.MISSING_CHILD_NAME,
        "birthday": birthday,
        "grade": academic.grade_for_birthday(birthday, school_year) if birthday else None,
        "phone": _cut(visit_request.phone, constants.LEN_PHONE),
        "contact_name": _cut(visit_request.parent_name, constants.LEN_CONTACT),
        "source": _cut(sources, constants.LEN_SOURCE),
        "notes": f"{NOTES_PREFIX}{questions}" if questions else None,
        "target_school_year": school_year,
        "target_semester": semester,
    }


async def ensure_from_visit_request(
    db: AsyncSession, visit_request: VisitRequest, *, actor_user_id: uuid.UUID | None
) -> tuple[RecruitmentVisit, bool]:
    """這筆預約的招生訪視；沒有就建立（created 事件 origin＝visit_request）。回傳
    (訪視, 是否新建立)。呼叫端已鎖住預約列（mark_completed 的 _lock_status、補建
    端點的 with_for_update），同一筆預約不會同時建兩次；唯一鍵
    uq_recruitment_visits_visit_request 是最後防線。"""
    existing = await db.scalar(select(RecruitmentVisit).where(RecruitmentVisit.visit_request_id == visit_request.id))
    if existing is not None:
        return existing, False
    slot = await history.load_slot(db, visit_request.slot_id)
    today = today_local()
    fields = fields_from_visit_request(visit_request, today=today, slot_date=slot.slot_date if slot else None)
    visit = await records.create_visit(
        db,
        campus_key=visit_request.campus_key,
        fields=fields,
        actor_user_id=actor_user_id,
        origin="visit_request",
        visit_request_id=visit_request.id,
        today=today,
    )
    return visit, True


def _row(visit_request: VisitRequest, slot: VisitSlot | None) -> dict:
    return {
        "visit_request_id": visit_request.id,
        "slot_date": slot.slot_date if slot else None,
        "start_time": slot.start_time if slot else None,
        "parent_name": visit_request.parent_name,
        "child_name": visit_request.child_name,
        "party_size": visit_request.party_size,
        "status": visit_request.status,
    }


async def arrivals(db: AsyncSession, campus_key: str, *, now: datetime | None = None) -> dict:
    """規格 6.1 第 2 點。

    - awaiting：confirmed 且場次已開始、還沒確認到場。直接用預約改版的
      status_groups.group_condition("past") 再排除已到場、未到場，不另寫「已開始」
      的判斷；已停止申請的場次照列，沒有場次的 confirmed 不在 past，也不列。場次舊到新。
    - missing：已到場、還沒匿名化、沒有招生訪視（本模組上線前就已到場，或招生訪視
      被刪掉）。場次新到舊。"""
    awaiting = await db.execute(
        select(VisitRequest, VisitSlot)
        .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            VisitRequest.campus_key == campus_key,
            status_groups.group_condition("past", now),
            VisitRequest.status.not_in(_DONE),
        )
        .order_by(VisitSlot.slot_date, VisitSlot.start_time, VisitRequest.created_at)
    )
    linked = exists().where(RecruitmentVisit.visit_request_id == VisitRequest.id)
    missing = await db.execute(
        select(VisitRequest, VisitSlot)
        .outerjoin(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            VisitRequest.campus_key == campus_key,
            VisitRequest.status == VisitRequestStatus.COMPLETED.value,
            VisitRequest.anonymized_at.is_(None),
            ~linked,
        )
        .order_by(VisitSlot.slot_date.desc().nulls_last(), VisitRequest.created_at.desc())
    )
    return {
        "awaiting": [_row(visit_request, slot) for visit_request, slot in awaiting.all()],
        "missing": [_row(visit_request, slot) for visit_request, slot in missing.all()],
    }
```

- [ ] **Step 5：`mark_completed` 在同一個交易建立招生訪視**

`backend/app/booking/workflow_service.py`：

1. 第 10 行 `from app.auth.models import User` 之前加一行：

```python
from app.admissions import booking_link
```

2. `mark_completed`（第 227–246 行）整個函式換成：

```python
async def mark_completed(
    db: AsyncSession, visit_request: VisitRequest, *, actor: Actor | None = None
) -> VisitRequest:
    """規格 225：完成參觀後名額仍算已使用。

    招生入學（2026-10 規格 6.1）：同一個交易建立這筆預約的招生訪視（已有就略過）。
    建立路徑不做會丟例外的資料檢查；不吞例外——資料庫錯誤就讓整個「標記已到場」
    回滾，不會出現已到場卻沒有招生訪視。這是確認到場的附帶效果，操作者只需要
    booking.handle。"""
    await _lock_status(db, visit_request)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以標記完成")
    await _require_visit_started(db, visit_request, "參觀時段開始後才能標記完成參觀")
    before = await history.state_of(db, visit_request)
    visit_request.status = VisitRequestStatus.COMPLETED.value
    await _close(db, visit_request, "completed", before=before, actor=actor)
    await booking_link.ensure_from_visit_request(db, visit_request, actor_user_id=_resolver_id(actor))
    await analytics_service.record_internal_event(
        db,
        event_type=AnalyticsEventType.VISIT_COMPLETED,
        campus_key=visit_request.campus_key,
        visit_request=visit_request,
    )
    await db.flush()
    return visit_request
```

- [ ] **Step 6：預約清單的 schema**

`backend/app/admissions/schemas.py`：

1. `from datetime import date, datetime` 換成 `from datetime import date, datetime, time`。

2. 檔尾加：

```python


class ArrivalRowOut(BaseModel):
    """「官網預約」分頁一列（規格 10）：場次、家長稱呼、孩子姓名、參觀人數。"""

    visit_request_id: uuid.UUID
    slot_date: date | None
    start_time: time | None
    parent_name: str
    child_name: str | None
    party_size: int | None
    status: str


class ArrivalsOut(BaseModel):
    # confirmed 且場次已開始、還沒確認到場（分頁標籤上的待確認筆數）。
    awaiting: list[ArrivalRowOut]
    # 已到場但沒有招生訪視，可以補建。
    missing: list[ArrivalRowOut]
```

- [ ] **Step 7：預約清單與補建的路由**

`backend/app/admissions/routes.py`：

1. import 區：`from app.admissions import academic, constants, funnel, intake, records` 換成 `from app.admissions import academic, booking_link, constants, funnel, intake, records`；`from app.admissions.schemas import (...)` 加入 `ArrivalsOut`；另加一行 `from app.booking.models import VisitRequest, VisitRequestStatus`。

2. 檔尾加：

```python
@router.get("/admin/admissions/arrivals", response_model=ArrivalsOut)
async def get_arrivals(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ArrivalsOut:
    """「官網預約」分頁（規格 6.1 第 2 點）。看的是預約資料，所以要 booking.read
    （規格 13）。「已到場」「未到場」沿用預約既有的 /complete、/no-show。"""
    _require_campus(current_user, "booking.read", campus_key)
    return ArrivalsOut.model_validate(await booking_link.arrivals(db, campus_key))


@router.post("/admin/admissions/from-visit-request/{visit_request_id}", response_model=RecruitmentVisitOut)
async def create_from_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """補建：已到場但沒有招生訪視的預約建立一筆；已有就回傳那一筆，可以重複呼叫
    （規格 6.1 第 2 點、6.6）。只接受已到場且未匿名化的預約（A 計畫調整第 13 條）。"""
    visit_request = await db.scalar(
        select(VisitRequest)
        .where(VisitRequest.id == visit_request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if visit_request is None:
        await db.rollback()
        raise ScopeDenied()
    require_scope(current_user, "booking.read", campus_keys=[visit_request.campus_key])
    require_scope(current_user, "admissions.write", campus_keys=[visit_request.campus_key])
    if visit_request.anonymized_at is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_ANONYMIZED", "message": "這筆預約已依保存政策匿名化，無法建立招生訪視"},
        )
    if visit_request.status != VisitRequestStatus.COMPLETED.value:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_NOT_COMPLETED", "message": "只有已到場的預約可以建立招生訪視，請先標記已到場"},
        )
    visit, created = await booking_link.ensure_from_visit_request(db, visit_request, actor_user_id=current_user.id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.create_from_booking",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"created": created},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)
```

- [ ] **Step 8：稽核標籤（調整第 14 條的 `created`）**

`admin/src/api/labels.ts`：

1. `AUDIT_ACTION_LABELS`：在 `'grade_intake_target.update': '設定計畫名額',` 之後加：

```ts
  'recruitment_visit.create_from_booking': '由官網預約建立招生訪視',
```

2. `AUDIT_METADATA_FORMATTERS`：把 `created:` 那一行（「新增 N 場」）換成：

```ts
  // 依規則產生時段（visit_slots.generate）是新增幾場；由官網預約建立招生訪視是有沒有新建。
  created: (v, action) => {
    if (action === 'recruitment_visit.create_from_booking') return v ? '建立招生訪視' : '這筆預約已有招生訪視，沒有重複建立'
    return `新增 ${countOf(v)} 場`
  },
```

- [ ] **Step 9：跑測試確認通過，並回歸既有預約測試**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_booking_link.py -q
```
Expected: `14 passed`（欄位對應 1＋截斷預設 1＋學期邊界 4＋文案對照 1＋其餘 7 支）。

`mark_completed` 改了，下列既有測試會走到「標記已到場」或結案時間，一支一支跑（8GB RAM，不要同時跑）：

```bash
for f in test_visit_manual_workflow test_visit_manual_and_assign test_reception_handling test_audit_actions \
         test_visit_groups test_visit_case_handling test_security_hardening test_retention_policy \
         test_visit_workflow test_analytics_funnel test_operations test_audit_coverage test_permission_table; do
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest "tests/$f.py" -q || break
done
cd /Users/yilunwu/Desktop/ivy-website-admissions && npm --prefix admin run test:unit -- labelCoverage
```
Expected: 全部 PASS（這些測試標完成後都不看招生表；`test_retention_policy.py` 直接改狀態成 completed，不經過 `mark_completed`）。任何一支失敗先看是不是循環匯入（`app.booking.workflow_service` → `app.admissions.booking_link` → `app.admissions.records`），不要改測試去遷就。

- [ ] **Step 10：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/booking_link.py backend/app/booking/workflow_service.py \
  backend/app/admissions/schemas.py backend/app/admissions/routes.py admin/src/api/labels.ts \
  backend/tests/admissions_helpers.py backend/tests/test_admissions_booking_link.py
git commit -m "feat(admissions): 預約標記已到場自動建立招生訪視、補建與官網預約待確認清單

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A7：保存政策的招生訪視類別

**Files:**
- Create: `backend/app/admissions/retention.py`
- Modify: `backend/app/operations/retention_service.py`（模組說明、import、`_DAYS_FIELD` 之後、`policy_days`、`RetentionReport.days`、`preview`、`run_sweep`）
- Modify: `backend/app/operations/routes.py`（`RetentionDaysOut`、`RetentionCountsOut`、`RetentionPolicyUpdate` 約 408–453 行；`update_retention_policy` 約 531–536 行；調整第 6、15 條）
- Modify: `backend/tests/test_retention_policy.py`（第 114–116、168、215、233 行的期望值）
- Modify: `admin/src/api/labels.ts`（`RETENTION_CATEGORY_LABELS`、`AUDIT_FIELD_LABELS`、`AUDIT_FIELD_UNITS`、`auditValueLabel`、`AUDIT_METADATA_FORMATTERS` 的 `days`／`counts`）
- Test: `backend/tests/test_admissions_retention.py`

**Interfaces:**
- Consumes：A2 `RetentionPolicy.admissions_days` 與 DB CHECK `ck_retention_policies_admissions_days`；A1 `constants.ANONYMIZED_TEXT`；`retention_service.find_candidates`、`count_open_overdue`、`anonymize`、`_backfill_anonymized`。
- Produces：
  - `retention.eligible_count(db, days, *, now=None) -> int`、`retention.anonymize_due(db, days, *, now=None) -> int`（days 為 None 時回 0、不動資料；調整第 5 條）、`retention.anonymize_visit(visit, events) -> None`
  - `retention_service.ADMISSIONS = "admissions"`；`policy_days` 多 `admissions_days`；`preview`／`run_sweep` 的 `counts` 只有設定了天數才有 `admissions`
  - API：`RetentionDaysOut.admissions_days: int | None`、`RetentionCountsOut.admissions: int = 0`、`RetentionPolicyUpdate.admissions_days`（只有請求帶了這個鍵才寫入，`model_fields_set`）
  - 稽核：`retention_policy.update` 的 before／after 多 `admissions_days`（`AUDIT_FIELD_LABELS` 的 `'招生訪視保留'`）

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_retention.py`：

```python
"""招生訪視的保存政策（規格 11；R14）：天數設定、試算、只清規格列的欄位、統計欄位
不變、與預約的匿名化互不連動。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.admissions import constants, retention
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest
from app.operations import retention_service
from app.operations.models import AuditLogEntry, RetentionPolicy, RetentionRun
from tests.admissions_helpers import API, create_record, record_at_stage
from tests.conftest import legacy_request

POLICY = f"{API}/admin/site-policies/retention"
DRY_RUN = f"{API}/admin/retention/dry-run"
RUN = f"{API}/admin/retention/run"
# 統計會用到、匿名化後必須原封不動的欄位。
STAT_COLUMNS = (
    "campus_key", "visit_request_id", "month", "seq_no", "visit_date", "grade", "source", "referrer",
    "has_deposit", "enrolled", "enrolled_on", "transfer_term", "no_deposit_reason", "provisional_grade",
    "target_school_year", "target_semester", "withdrawn_at", "withdrawn_from", "created_at", "updated_at",
)
# 規格 11 列出要清的欄位（姓名另外換成固定文字）。
CLEARED = (
    "birthday", "phone", "contact_name", "address", "notes", "parent_response", "no_deposit_reason_detail", "withdraw_reason",
)


def _policy(version: int, **days) -> dict:
    return {
        "expected_version": version,
        "cancelled_days": 365,
        "completed_days": 365,
        "open_overdue_days": 365,
        "auto_run_enabled": False,
        **days,
    }


def _allow_real_run(app) -> None:
    app.state.settings = app.state.settings.model_copy(update={"retention_allow_real_run": True})


async def _set(db_session, visit_id: str, **values) -> None:
    await db_session.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(visit_id)).values(**values))
    await db_session.commit()


def _days_ago(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def _reload(db_session, visit_id: str) -> RecruitmentVisit:
    result = await db_session.execute(
        select(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(visit_id)).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


@pytest.mark.asyncio
async def test_admissions_days_is_optional_and_only_written_when_sent(admin_client, db_session):
    """調整第 15 條：預設 NULL（不自動清理）；請求沒帶這個鍵就不動；範圍與其他天數相同。"""
    assert (await admin_client.get(POLICY)).json()["admissions_days"] is None
    saved = await admin_client.put(POLICY, json=_policy(1, admissions_days=730))
    assert saved.status_code == 200, saved.text
    assert saved.json()["admissions_days"] == 730
    kept = await admin_client.put(POLICY, json=_policy(2, cancelled_days=200))  # 現行保存政策頁的存檔
    assert kept.status_code == 200 and kept.json()["admissions_days"] == 730
    cleared = await admin_client.put(POLICY, json=_policy(3, cancelled_days=200, admissions_days=None))
    assert cleared.json()["admissions_days"] is None
    for bad in (29, 3651):
        assert (await admin_client.put(POLICY, json=_policy(4, admissions_days=bad))).status_code == 422
    entries = await _audit(db_session, "retention_policy.update")
    assert (entries[0]["before"]["admissions_days"], entries[0]["after"]["admissions_days"]) == (None, 730)
    assert entries[1]["after"]["admissions_days"] == 730
    assert entries[2]["after"]["admissions_days"] is None
    # 資料庫層用同一組範圍擋。
    with pytest.raises(IntegrityError):
        await db_session.execute(update(RetentionPolicy).values(admissions_days=10))
    await db_session.rollback()


@pytest.mark.asyncio
async def test_run_clears_only_spec_fields_and_keeps_statistics(app, admin_client, db_session):
    """R14：只清規格 11 的欄位與歷程原因；統計欄位不變；試算不改資料；清理紀錄與稽核只記筆數。"""
    _allow_real_run(app)
    old = await record_at_stage(
        admin_client, "withdrawn",
        child_name="王小明", phone="0912345678", contact_name="王媽媽", address="中正路 1 號", grade="小班",
        source="Facebook", referrer="林老師", notes="住附近", parent_response="再想想",
        no_deposit_reason="時程未到／仍在觀望", no_deposit_reason_detail="等搬家",
    )
    recent = await create_record(admin_client, child_name="陳小華", phone="0922333444")
    await _set(db_session, old["id"], updated_at=_days_ago(400))
    await _set(db_session, recent["id"], updated_at=_days_ago(10))
    assert (await admin_client.put(POLICY, json=_policy(1, admissions_days=365))).status_code == 200
    before = await _reload(db_session, old["id"])
    stats_before = {column: getattr(before, column) for column in STAT_COLUMNS}
    version_before = before.version

    preview = (await admin_client.post(DRY_RUN)).json()
    assert (preview["counts"]["admissions"], preview["days"]["admissions_days"]) == (1, 365)
    assert (await _reload(db_session, old["id"])).anonymized_at is None

    ran = await admin_client.post(RUN)
    assert ran.status_code == 200, ran.text
    assert ran.json()["counts"] == {"cancelled": 0, "no_show": 0, "completed": 0, "admissions": 1}
    assert ran.json()["total"] == 1
    after = await _reload(db_session, old["id"])
    assert after.child_name == constants.ANONYMIZED_TEXT
    assert {column: getattr(after, column) for column in CLEARED} == dict.fromkeys(CLEARED)
    assert {column: getattr(after, column) for column in STAT_COLUMNS} == stats_before
    assert after.anonymized_at is not None and after.version == version_before + 1
    events = (
        await db_session.execute(
            select(RecruitmentEventLog)
            .where(RecruitmentEventLog.recruitment_visit_id == uuid.UUID(old["id"]))
            .order_by(RecruitmentEventLog.created_at)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert [e.event_type for e in events] == ["created", "deposit_added", "withdrawn"]  # 歷程本身保留
    assert all(e.reason is None for e in events)
    untouched = await _reload(db_session, recent["id"])
    assert (untouched.child_name, untouched.phone, untouched.anonymized_at) == ("陳小華", "0922333444", None)

    runs = (await admin_client.get(f"{API}/admin/retention-runs")).json()
    assert (runs[0]["counts"]["admissions"], runs[0]["days"]["admissions_days"]) == (1, 365)
    [entry] = await _audit(db_session, "retention.run")
    assert entry["counts"]["admissions"] == 1
    assert "王小明" not in json.dumps(entry, ensure_ascii=False) and old["id"] not in json.dumps(entry)
    assert (await admin_client.post(RUN)).json()["counts"]["admissions"] == 0  # 已匿名化的不再算


@pytest.mark.asyncio
async def test_without_admissions_days_nothing_is_cleared(app, admin_client, db_session):
    """預設不自動執行（規格 11）：沒設定天數，再舊也不清，清理紀錄也沒有這一類。"""
    _allow_real_run(app)
    record = await create_record(admin_client, phone="0912345678")
    await _set(db_session, record["id"], updated_at=_days_ago(5000))
    assert (await admin_client.post(DRY_RUN)).json()["counts"]["admissions"] == 0
    ran = await admin_client.post(RUN)
    assert ran.status_code == 200 and ran.json()["counts"]["admissions"] == 0
    assert (await _reload(db_session, record["id"])).phone == "0912345678"
    run = (await db_session.execute(select(RetentionRun))).scalar_one()
    assert "admissions" not in run.counts and run.policy["admissions_days"] is None
    assert await retention.eligible_count(db_session, None) == 0
    assert await retention.anonymize_due(db_session, None) == 0


@pytest.mark.asyncio
async def test_booking_and_admissions_anonymization_are_independent(app, admin_client, db_session):
    """R14：預約匿名化不連動招生訪視，招生訪視匿名化也不動預約（規格 11）。"""
    _allow_real_run(app)
    old_request = await legacy_request(db_session, status="cancelled", parent_name="要清掉的媽媽")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(old_request)).values(cancelled_at=_days_ago(400))
    )
    await db_session.commit()
    kept_visit = await create_record(admin_client, child_name="留著的孩子")
    await _set(db_session, kept_visit["id"], visit_request_id=uuid.UUID(old_request), updated_at=_days_ago(10))
    fresh_request = await legacy_request(db_session, status="completed", parent_name="留著的爸爸")
    old_visit = await create_record(admin_client, child_name="要清掉的孩子")
    await _set(db_session, old_visit["id"], visit_request_id=uuid.UUID(fresh_request), updated_at=_days_ago(400))
    assert (await admin_client.put(POLICY, json=_policy(1, admissions_days=365))).status_code == 200

    ran = (await admin_client.post(RUN)).json()
    assert (ran["counts"]["cancelled"], ran["counts"]["admissions"]) == (1, 1)
    assert (await _reload(db_session, kept_visit["id"])).child_name == "留著的孩子"
    assert (await _reload(db_session, old_visit["id"])).child_name == constants.ANONYMIZED_TEXT
    parents = dict(
        (
            await db_session.execute(
                select(VisitRequest.id, VisitRequest.parent_name)
                .where(VisitRequest.id.in_([uuid.UUID(old_request), uuid.UUID(fresh_request)]))
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert parents[uuid.UUID(old_request)] == retention_service.ANONYMIZED_NOTE
    assert parents[uuid.UUID(fresh_request)] == "留著的爸爸"


@pytest.mark.asyncio
async def test_eligibility_uses_updated_at_cutoff(admin_client, db_session):
    """調整第 5 條：now 可注入；條件是 anonymized_at IS NULL AND updated_at < now − days。"""
    now = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
    due = await create_record(admin_client, child_name="剛好過期")
    fresh = await create_record(admin_client, child_name="還沒到期")
    await _set(db_session, due["id"], updated_at=now - timedelta(days=30, seconds=1))
    await _set(db_session, fresh["id"], updated_at=now - timedelta(days=30) + timedelta(seconds=1))
    assert await retention.eligible_count(db_session, 30, now=now) == 1
    assert await retention.anonymize_due(db_session, 30, now=now) == 1
    await db_session.commit()
    assert await retention.eligible_count(db_session, 30, now=now) == 0
    assert (await _reload(db_session, fresh["id"])).child_name == "還沒到期"
```

- [ ] **Step 2：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_retention.py -q
```
Expected: FAIL（`ImportError: cannot import name 'retention' from 'app.admissions'`）。

- [ ] **Step 3：`retention.py`**

`backend/app/admissions/retention.py`：

```python
"""招生訪視的保存政策（規格 11）：試算與匿名化。

- 符合條件：還沒匿名化，且最後更新（updated_at）早於 now − admissions_days。
- 清除：幼生姓名（欄位 NOT NULL，換成「（已依保存政策匿名化）」）、生日、電話、
  聯絡人、地址、備註、電訪回應、未預繳原因說明、退出原因，以及歷程裡人員寫的原因。
- 保留：統計欄位（月份、參觀日期、年級、來源、介紹者、預繳、註冊、轉學期、未預繳
  原因、保留座位、入學學年學期、退出時間與來源）、updated_at 與 anonymized_at。
  version 加一：開著舊畫面的人存檔會收到 409，不會把個資寫回去。
- 與預約的匿名化各自獨立：預約匿名化不連動招生訪視，反之亦然。
- days 為 None（預設，天數待業主裁定）時什麼都不做。

只 flush；retention_service 負責清理紀錄、稽核與 commit。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import now_utc


def _due(days: int, now: datetime | None) -> tuple:
    cutoff = (now or now_utc()) - timedelta(days=days)
    return (RecruitmentVisit.anonymized_at.is_(None), RecruitmentVisit.updated_at < cutoff)


async def eligible_count(db: AsyncSession, days: int | None, *, now: datetime | None = None) -> int:
    """現在執行會匿名化幾筆（試算，不改資料）。"""
    if days is None:
        return 0
    count = await db.scalar(select(func.count()).select_from(RecruitmentVisit).where(*_due(days, now)))
    return int(count or 0)


def anonymize_visit(visit: RecruitmentVisit, events: list[RecruitmentEventLog]) -> None:
    """清掉一筆訪視的個資欄位與歷程原因（events 是這筆訪視的歷程）。"""
    visit.child_name = ANONYMIZED_TEXT
    visit.birthday = None
    visit.phone = None
    visit.contact_name = None
    visit.address = None
    visit.notes = None
    visit.parent_response = None
    visit.no_deposit_reason_detail = None
    visit.withdraw_reason = None
    for event in events:
        event.reason = None
    visit.anonymized_at = datetime.now(timezone.utc)
    visit.version += 1


async def anonymize_due(db: AsyncSession, days: int | None, *, now: datetime | None = None) -> int:
    """匿名化到期的訪視，回傳筆數。鎖住到期的列，與同時進行的編輯排隊。"""
    if days is None:
        return 0
    result = await db.execute(
        select(RecruitmentVisit)
        .where(*_due(days, now))
        .options(selectinload(RecruitmentVisit.events))
        .order_by(RecruitmentVisit.created_at)
        .with_for_update(of=RecruitmentVisit)
    )
    visits = list(result.scalars())
    for visit in visits:
        anonymize_visit(visit, list(visit.events))
    await db.flush()
    return len(visits)
```

- [ ] **Step 4：`retention_service.py` 加上招生類別**

`backend/app/operations/retention_service.py`：

1. 模組說明最後一段（「試算不改資料、不留紀錄；…（不記案件 id）。」）之後、結尾 `"""` 之前加一段：

```text

招生訪視（2026-10 招生入學規格 11）是另一個用途的紀錄，不隨預約匿名化：天數另外
設定（admissions_days，NULL＝不自動清理），只有設定了天數，試算與清理紀錄的
counts 才會有 admissions 這一類（舊的清理紀錄與操作紀錄格式不變）。
```

2. import 區：`from app.booking.access_models import RescheduleRequest` 之前加：

```python
from app.admissions import retention as admissions_retention
```

3. `_DAYS_FIELD = {…}` 這一行之後加（放在「# 各類的代碼」區塊之外：後台 labelCoverage 只把那一段當成預約的狀態類別）：

```python
# 招生訪視的類別代碼（天數用 admissions_days，條件與清除欄位見 app/admissions/retention.py）。
ADMISSIONS = "admissions"
```

4. `policy_days` 換成：

```python
def policy_days(policy: RetentionPolicy) -> dict[str, int | None]:
    return {
        "cancelled_days": policy.cancelled_days,
        "completed_days": policy.completed_days,
        "open_overdue_days": policy.open_overdue_days,
        # None＝招生訪視不自動清理。
        "admissions_days": policy.admissions_days,
    }
```

5. `RetentionReport` 的 `days: dict[str, int]` 換成 `days: dict[str, int | None]`。

6. `preview` 換成：

```python
async def preview(db: AsyncSession, days: dict[str, int | None], *, now: datetime | None = None) -> RetentionReport:
    """只算筆數，不改資料、不留紀錄（保存政策頁的「現在執行會處理幾筆」）。"""
    current = now or now_utc()
    found = await find_candidates(db, days, now=current)
    counts = {k: len(v) for k, v in found.items()}
    if days.get("admissions_days") is not None:
        counts[ADMISSIONS] = await admissions_retention.eligible_count(db, days["admissions_days"], now=current)
    return RetentionReport(
        days=days,
        counts=counts,
        open_overdue_count=await count_open_overdue(db, days, now=current),
    )
```

7. `run_sweep` 換成：

```python
async def run_sweep(
    db: AsyncSession,
    days: dict[str, int | None],
    *,
    trigger: RetentionRunTrigger,
    actor_user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> RetentionReport:
    """匿名化到期的已結案案件（以及設定了天數時到期的招生訪視），並寫一筆
    retention_runs。呼叫端負責確認部署允許真正清理、寫稽核與 commit。"""
    current = now or now_utc()
    found = await find_candidates(db, days, now=current)
    counts = {k: len(v) for k, v in found.items()}
    open_overdue_count = await count_open_overdue(db, days, now=current)
    for candidates in found.values():
        for candidate in candidates:
            await anonymize(db, candidate)
    await _backfill_anonymized(db)
    if days.get("admissions_days") is not None:
        counts[ADMISSIONS] = await admissions_retention.anonymize_due(db, days["admissions_days"], now=current)
    report = RetentionReport(days=days, counts=counts, open_overdue_count=open_overdue_count, dry_run=False)
    run = RetentionRun(
        id=uuid.uuid4(),
        created_at=current,
        trigger=trigger.value,
        actor_user_id=actor_user_id,
        policy=days,
        counts=report.counts,
        total=report.total,
        open_overdue_count=report.open_overdue_count,
    )
    db.add(run)
    await db.flush()
    report.run_id = run.id
    return report
```

- [ ] **Step 5：保存政策 API 的 schema 與存檔（`backend/app/operations/routes.py`）**

1. `RetentionDaysOut` 的 `open_overdue_days: int` 之後加：

```python
    # 招生訪視：最後更新後幾天匿名化；None＝不自動清理（預設，天數待業主裁定）。
    # 舊的清理紀錄沒有這個鍵，讀出來也是 None。
    admissions_days: int | None = None
```

2. `RetentionCountsOut` 的 `completed: int = 0` 之後加：

```python
    # 招生訪視；沒設定天數時不清，為 0。
    admissions: int = 0
```

3. `RetentionPolicyUpdate` 的 `auto_run_enabled: bool` 之後加：

```python
    # 只有請求帶了這個鍵才寫入（model_fields_set）：後台保存政策頁加上這個欄位
    # 之前（B6），現行畫面存檔不會把它清成 NULL。送 null＝不自動清理。
    admissions_days: int | None = Field(default=None, ge=RETENTION_MIN_DAYS, le=RETENTION_MAX_DAYS)
```

4. `update_retention_policy` 裡，`policy.auto_run_enabled = payload.auto_run_enabled` 之後加：

```python
    if "admissions_days" in payload.model_fields_set:
        policy.admissions_days = payload.admissions_days
```

（`before`／`after` 用 `retention_service.policy_days(policy)` 展開，已經包含 `admissions_days`，不必另外改。）

- [ ] **Step 6：既有保存政策測試的期望值補上新鍵**

`backend/tests/test_retention_policy.py`：

1. 第 114–116 行換成：

```python
    assert entry.metadata_json["after"] == {
        "cancelled_days": 180, "completed_days": 730, "open_overdue_days": 90, "admissions_days": None,
        "auto_run_enabled": True,
    }
```

2. 第 168 行換成：

```python
    assert report["counts"] == {"cancelled": 1, "no_show": 2, "completed": 1, "admissions": 0}
```

3. 第 215 行換成：

```python
    assert ran.json()["counts"] == {"cancelled": 1, "no_show": 0, "completed": 0, "admissions": 0}
```

4. 第 233 行換成：

```python
    assert runs[0]["days"] == {
        "cancelled_days": 365, "completed_days": 365, "open_overdue_days": 365, "admissions_days": None,
    }
```

- [ ] **Step 7：後台標籤（調整第 15 條）**

`admin/src/api/labels.ts`：

1. `RETENTION_CATEGORY_LABELS` 換成：

```ts
// 個資保存政策會清理的類別（後端 retention_service.CATEGORIES 與 ADMISSIONS）。
// 招生訪視只在設定了天數時才出現在試算與清理紀錄裡。
export const RETENTION_CATEGORY_LABELS: Record<string, string> = {
  cancelled: '已取消',
  no_show: '未到場',
  completed: '已完成參觀',
  admissions: '招生訪視',
}
```

（原本那行註解「// 個資保存政策會清理的案件類別（後端 retention_service.CATEGORIES）。」一併換掉。A3 加的三個招生表放在這段之前，不受影響。）

2. `AUDIT_FIELD_LABELS` 的 `open_overdue_days: '未結案提醒',` 之後加 `admissions_days: '招生訪視保留',`；`AUDIT_FIELD_UNITS` 的 `open_overdue_days: '天',` 之後加 `admissions_days: '天',`。

3. `auditValueLabel` 函式內、第一行 `if (field === 'role' && typeof value === 'string') return roleLabel(value)` 之前加：

```ts
  if (field === 'admissions_days' && (value === null || value === undefined)) return '不自動清理'
```

4. `AUDIT_METADATA_FORMATTERS` 的 `days`、`counts` 換成：

```ts
  days: (v) => {
    if (!v || typeof v !== 'object') return null
    const d = v as Record<string, unknown>
    const admissions = typeof d.admissions_days === 'number' ? `、招生訪視 ${d.admissions_days} 天` : ''
    return `保留天數：取消／未到場 ${String(d.cancelled_days)} 天、完成 ${String(d.completed_days)} 天${admissions}`
  },
  counts: (v) => {
    if (!v || typeof v !== 'object') return null
    const c = v as Record<string, unknown>
    // 招生訪視只有設定了天數的清理才有；舊紀錄與沒設定的不列，文字跟以前一樣。
    return Object.keys(RETENTION_CATEGORY_LABELS)
      .filter((key) => key !== 'admissions' || key in c)
      .map((key) => `${RETENTION_CATEGORY_LABELS[key]} ${countOf(c[key])} 筆`)
      .join('、')
  },
```

- [ ] **Step 8：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_retention.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_retention_policy.py -q
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_operations.py tests/test_maintenance.py -q
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm --prefix admin run test:unit -- labelCoverage ux20260928H policiesUx
```
Expected: `test_admissions_retention.py` `5 passed`；`test_retention_policy.py`、`test_operations.py`、`test_maintenance.py` 全過（定期工作走同一支 `run_sweep`）；三支後台測試全過（`ux20260928H` 的舊操作紀錄文字不變，`PoliciesView` 的 `CATEGORY_KEYS` 只列三類，畫面不受影響）。

- [ ] **Step 9：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/retention.py backend/app/operations/retention_service.py backend/app/operations/routes.py \
  backend/tests/test_retention_policy.py backend/tests/test_admissions_retention.py admin/src/api/labels.ts
git commit -m "feat(admissions): 保存政策新增招生訪視類別（預設不自動清理、與預約匿名化互不連動）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A8：園務轉移契約、匯出程式與漂移檢查

**Files:**
- Create: `contracts/ivy-recruitment/README.md`、`contracts/ivy-recruitment/ivy-schema.json`
- Create: `backend/app/admissions/export.py`
- Create: `backend/scripts/export_ivy_recruitment.py`、`backend/scripts/check_ivy_recruitment_contract.py`
- Test: `backend/tests/test_admissions_contract.py`

**Interfaces:**
- Consumes：A1 `academic.roc_date`、`ROC_MONTH_RE`、`constants.*`；A2 三個 model；A3–A6 的 API（測試用來造合成資料）；`app.common.timezones.OPERATING_TZ`；園務 `~/Desktop/ivy-backend`（`dfd230c3`）的 `models/recruitment.py`、`models/tenant_mixin.py`、`api/recruitment/shared.py`、`models/recruitment_bonus.py`、`services/recruitment_funnel.py`、`services/recruitment_intake_plan.py`、`services/recruitment_conversion.py`（只用 `ast` 讀）。
- Produces：
  - `export.FILES`、`ivy_visit_row(visit, *, tenant_id=None)`、`ivy_event_row(event, *, actor_name=None)`、`ivy_target_row(target)`、`extension_row(visit)`、`export_campus(db, campus_key, *, tenant_id=None) -> dict[str, list[dict]]`、`write_jsonl(result, out_dir) -> list[Path]`（列格式見調整第 16 條；總覽簽章多出的參數都是選填）
  - `scripts/export_ivy_recruitment.py`：`readonly_engine(settings)`、`parse_args(argv)`、`run(campuses, out) -> int`、`main(argv=None) -> int`
  - `scripts/check_ivy_recruitment_contract.py`：`read_ivy(ivy_root) -> dict`、`diff(snapshot, live) -> list[str]`、`main(argv=None) -> int`
  - `contracts/ivy-recruitment/ivy-schema.json`：`{"description", "ivy_backend_commit", "sources", "tables": {表: {"columns": {欄: {"type", "nullable", "length"?, "primary_key"?, "foreign_key"?}}}}, "enums": {...}, "website_only": {"event_types": ["created"]}}`

- [ ] **Step 1：確認園務版本並寫契約說明**

```bash
git -C ~/Desktop/ivy-backend log --oneline -1
```
Expected：`dfd230c3 …`。不是這個 commit 就先跑 Step 7 的漂移檢查，看差在哪裡，回報後再決定要不要更新快照，不要直接改快照。

`contracts/ivy-recruitment/README.md`：

````markdown
# 招生入學轉移契約（官網 → 園務）

官網後台的招生入學模組（`backend/app/admissions/`）照抄園務的資料模型，併入園務
（ivyManageSystem）時整批轉移。本目錄是兩邊的契約：

| 檔案 | 內容 |
|---|---|
| `ivy-schema.json` | 園務三張表的欄位（名稱、型別、長度、可否為空）與列舉值快照 |
| `grade-cases.json` | 年級與學期換算的共用案例（官網後端、官網前台、後台都讀） |

對齊的園務版本：`ivy-backend` `dfd230c3`。規格：`docs/specs/2026-09-30-website-admissions-design.md` 第 5、12 節。

## 怎麼匯出

```bash
cd backend
uv run python scripts/export_ivy_recruitment.py --campus yihua=1 --campus renwu=3 --out <輸出目錄>
```

- `--campus 校區=租戶編號` 可以給多個；校區對租戶不寫死（明華、崇德、國際的租戶還不存在）。
- 只讀：連線設成 `default_transaction_read_only`，不改任何資料。
- 每個校區一個資料夾，四個 JSONL：`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`、`extensions`。
- 內容含幼生姓名、生日、家長電話：資料夾 0700、檔案 0600，已存在的檔案不覆寫。用完刪除，不要放進 repo 或雲端硬碟。

## 列的格式

前三個檔每一列都是：

```json
{"website_id": "官網 uuid", "columns": {"園務欄位": "值"}, "mapping": {"匯入時要對應的官網值": "值"}}
```

- `columns` 只有園務表的欄位（`ivy-schema.json` 的欄位扣掉 `id`），可以直接 INSERT；園務重新配 `id`。
- 外鍵與年級 id 在 `columns` 一律是 `null`，由匯入端依 `mapping` 填：

| 表 | `columns` 留空的欄位 | 用 `mapping` 的哪個值填 |
|---|---|---|
| `recruitment_visits` | `provisional_grade_id` | `mapping.provisional_grade`（年級名稱）→ 該租戶 `class_grades.id` |
| `recruitment_visits` | `tour_guide_employee_id` | `mapping.tour_guide_name` → 同名員工；對不上留空並列入報告 |
| `recruitment_event_log` | `recruitment_visit_id` | `mapping.recruitment_visit_website_id` → 這次匯入的新訪視 id |
| `grade_intake_targets` | `grade_id` | `mapping.grade`（年級名稱）→ 該租戶 `class_grades.id` |

- `recruitment_visits.columns.tenant_id` 用命令列給的租戶編號；`mapping.campus_key` 是官網校區。
- `student_id`、`actor_user_id`、`expected_start_label` 一律 `null`：官網沒有學生檔；官網帳號沒有對應的園務帳號（改記在 `metadata_json.website_actor`，見下）；`expected_start_label` 由園務依備註重算。

`extensions.jsonl` 每筆訪視一列：`{"website_id", "visit_request_id", "enrolled_on", "tour_guide_user_id", "tour_guide_name"}`。

## 欄位轉換

| 官網 | 園務 | 規則 |
|---|---|---|
| `id`（uuid） | `id`（Integer） | 重新配發；歷程靠 `mapping.recruitment_visit_website_id` 重接 |
| `campus_key` | `tenant_id` | 命令列的對照 |
| `visit_date`（Date） | `visit_date`（String 50） | 民國字串 `115.09.08` |
| `month`、`seq_no` | 同名 | 原樣（`115.09`；同校同月序號） |
| `birthday`、`enrolled_on` | `birthday`；`extensions` | ISO 日期 `2026-09-08` |
| `created_at`、`updated_at`、`withdrawn_at`、`geocoding_consent_at`、歷程 `created_at` | 同名（DateTime，台北時間 naive） | 官網存 UTC，匯出轉台北時間、去掉時區 |
| `provisional_grade`（年級名稱） | `provisional_grade_id` | 見上表 |
| `grade_intake_targets.grade` | `grade_id` | 見上表 |
| `tour_guide_user_id`／`tour_guide_name` | `tour_guide_employee_id` | 見上表；兩個都另外放在 `extensions` |
| 歷程 `actor_user_id` | `metadata_json.website_actor` | `{"user_id": 官網帳號 uuid, "name": 顯示名稱或 Email}`；`actor_user_id` 留空 |
| `visit_request_id` | （沒有對應欄位） | 放在 `extensions`；官網預約模組併入時再對應新 id |
| `enrolled` | 同名 | 園務以學生檔為準：`enrolled=true` 的依「姓名＋生日」唯一比對學生，設 `students.recruitment_visit_id`；比對不到或多筆的列入人工清單，不自動建學生 |
| `version`、`anonymized_at`、`created` 事件 | — | 不轉（`created` 是官網延伸，建立時間以 `recruitment_visits.created_at` 為準） |

其餘欄位名稱、型別、長度與園務相同，原樣轉。

## 刻意與園務不同的地方（併入時由園務決定要不要跟進）

1. 統計比率分母為 0 回 `null`（畫面顯示「—」）；園務回 0，會把「沒有資料」看成「轉換率零」。
2. 來源分析依原文分組；園務的來源別名合併表（`_SOURCE_GROUP_ALIASES`，義華專屬字詞）沒有移植。
3. 主鍵是 uuid、時間存 UTC（匯出時才轉台北時間 naive）。
4. 「已註冊」只有 `enrolled` 旗標與註冊日期 `enrolled_on`，沒有學生檔；退註冊、取消註冊只要 `admissions.convert`，不刪學生檔。
5. 年級固定四個名稱（幼幼班、小班、中班、大班），存名稱不存 `class_grades.id`。
6. 官網多寫 `created` 事件（`metadata_json.origin` 為 `manual` 或 `visit_request`）；園務不寫，匯出時略過。
7. 狀態不允許的轉換回 422 `TRANSITION_NOT_ALLOWED`；園務回 400。

## 漂移檢查（手動，不進 CI）

```bash
cd backend
uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
```

只用 `ast` 讀園務原始碼（不 import、不連資料庫），比對 `ivy-schema.json` 的欄位、未預繳原因與優先度、來源分類、階段、事件類型、退出來源；年級在園務前端，不在檢查範圍。準備併入前、或園務招生模組有改動時執行；不一致就更新快照與本文件、評估官網要不要跟進，並把 `ivy_backend_commit` 改成新的 commit。

## 合約測試（進 CI）

`backend/tests/test_admissions_contract.py` 用合成資料跑匯出，逐列檢查：欄位齊全、型別可轉換、長度不超過園務欄位、NOT NULL 成立、列舉值合法、民國月份與日期格式、歷程都接得回訪視。
````

- [ ] **Step 2：寫園務欄位與列舉快照**

`contracts/ivy-recruitment/ivy-schema.json`（表格部分是 Step 7 的 `read_ivy` 對 `dfd230c3` 實際讀出的結果）：

```json
{
  "description": "園務招生三張表的欄位與列舉快照（規格 12.1）。由 backend/scripts/check_ivy_recruitment_contract.py 比對園務現行程式；backend/tests/test_admissions_contract.py 用它驗證匯出結果。欄位：type 是園務 SQLAlchemy 型別名、length 是 String 長度、nullable 照園務 Column（沒寫 nullable 時主鍵為 false、其他為 true）。",
  "ivy_backend_commit": "dfd230c3",
  "sources": {
    "tables": "models/recruitment.py（RecruitmentVisit、RecruitmentEventLog、GradeIntakeTarget；tenant_id 來自 models/tenant_mixin.py）",
    "no_deposit_reasons": "api/recruitment/shared.py NO_DEPOSIT_REASONS",
    "no_deposit_priority": "api/recruitment/shared.py HIGH／MEDIUM／LOW_PRIORITY_NO_DEPOSIT_REASONS（排序後）",
    "source_categories": "models/recruitment_bonus.py DEFAULT_POINT_CATALOG 的 label",
    "stages": "services/recruitment_funnel.py STAGES",
    "event_types": "services/recruitment_funnel.py、recruitment_intake_plan.py、recruitment_conversion.py 的 event_type 字面值（排序後）",
    "withdrawn_from": "models/recruitment.py ck_rv_withdrawn_from",
    "grades": "ivy-frontend src/constants/recruitment.ts GRADES_ORDER（不在園務後端，漂移檢查不涵蓋）"
  },
  "tables": {
    "recruitment_visits": {"columns": {
      "tenant_id": {"type": "Integer", "nullable": false, "foreign_key": "tenants.id"},
      "id": {"type": "Integer", "nullable": false, "primary_key": true},
      "month": {"type": "String", "nullable": false, "length": 10},
      "seq_no": {"type": "String", "nullable": true, "length": 10},
      "visit_date": {"type": "String", "nullable": true, "length": 50},
      "child_name": {"type": "String", "nullable": false, "length": 50},
      "birthday": {"type": "Date", "nullable": true},
      "grade": {"type": "String", "nullable": true, "length": 20},
      "phone": {"type": "String", "nullable": true, "length": 100},
      "contact_name": {"type": "String", "nullable": true, "length": 50},
      "address": {"type": "String", "nullable": true, "length": 200},
      "district": {"type": "String", "nullable": true, "length": 30},
      "source": {"type": "String", "nullable": true, "length": 50},
      "referrer": {"type": "String", "nullable": true, "length": 50},
      "deposit_collector": {"type": "String", "nullable": true, "length": 50},
      "tour_guide_employee_id": {"type": "Integer", "nullable": true, "foreign_key": "employees.id"},
      "source_category": {"type": "String", "nullable": true, "length": 30},
      "has_deposit": {"type": "Boolean", "nullable": false},
      "rides_bus": {"type": "Boolean", "nullable": false},
      "notes": {"type": "Text", "nullable": true},
      "parent_response": {"type": "Text", "nullable": true},
      "geocoding_consent_at": {"type": "DateTime", "nullable": true},
      "no_deposit_reason": {"type": "String", "nullable": true, "length": 60},
      "no_deposit_reason_detail": {"type": "Text", "nullable": true},
      "enrolled": {"type": "Boolean", "nullable": false},
      "transfer_term": {"type": "Boolean", "nullable": false},
      "expected_start_label": {"type": "String", "nullable": true, "length": 30},
      "provisional_grade_id": {"type": "Integer", "nullable": true, "foreign_key": "class_grades.id"},
      "target_school_year": {"type": "Integer", "nullable": true},
      "target_semester": {"type": "Integer", "nullable": true},
      "withdrawn_at": {"type": "DateTime", "nullable": true},
      "withdrawn_from": {"type": "String", "nullable": true, "length": 20},
      "withdraw_reason": {"type": "Text", "nullable": true},
      "created_at": {"type": "DateTime", "nullable": true},
      "updated_at": {"type": "DateTime", "nullable": true}
    }},
    "recruitment_event_log": {"columns": {
      "id": {"type": "Integer", "nullable": false, "primary_key": true},
      "recruitment_visit_id": {"type": "Integer", "nullable": false, "foreign_key": "recruitment_visits.id"},
      "event_type": {"type": "String", "nullable": false, "length": 40},
      "from_stage": {"type": "String", "nullable": true, "length": 20},
      "to_stage": {"type": "String", "nullable": false, "length": 20},
      "student_id": {"type": "Integer", "nullable": true, "foreign_key": "students.id"},
      "reason": {"type": "Text", "nullable": true},
      "actor_user_id": {"type": "Integer", "nullable": true, "foreign_key": "users.id"},
      "metadata_json": {"type": "JSON", "nullable": true},
      "created_at": {"type": "DateTime", "nullable": false}
    }},
    "grade_intake_targets": {"columns": {
      "id": {"type": "Integer", "nullable": false, "primary_key": true},
      "grade_id": {"type": "Integer", "nullable": false, "foreign_key": "class_grades.id"},
      "school_year": {"type": "Integer", "nullable": false},
      "semester": {"type": "Integer", "nullable": false},
      "target_seats": {"type": "Integer", "nullable": false},
      "created_at": {"type": "DateTime", "nullable": true},
      "updated_at": {"type": "DateTime", "nullable": true}
    }}
  },
  "enums": {
    "grades": ["幼幼班", "小班", "中班", "大班"],
    "no_deposit_reasons": ["時程未到／仍在觀望", "已有其他就學選項／比較他校", "未註明／待追蹤", "距離／地點因素", "家庭照顧安排考量", "特殊需求／名額限制", "課程／環境仍在評估", "費用考量"],
    "no_deposit_priority": {"high": ["時程未到／仍在觀望", "課程／環境仍在評估"], "medium": ["家庭照顧安排考量", "費用考量", "距離／地點因素"], "low": ["已有其他就學選項／比較他校", "特殊需求／名額限制"]},
    "source_categories": {"sibling_current": "在校生弟妹（兄姊老師）", "sibling_split": "在校兄姊二人均分", "sibling_graduate": "畢業生弟妹", "self_report": "自報生（廣告／鄰居／網路／假日活動）", "referral": "有緣名單（家長介紹／社區招生）", "invite_success": "邀約來園——邀約成功者", "invite_origin": "邀約來園——原本招生人", "home_deposit": "到家中收預繳", "returning": "舊生復學（獎金不計，考核 +1 另行人工）"},
    "stages": ["visited", "deposited", "enrolled", "withdrawn"],
    "event_types": ["converted", "deposit_added", "deposit_removed", "revert_converted", "seat_released", "seat_reserved", "withdraw_cancelled", "withdrawn"],
    "withdrawn_from": ["deposited", "enrolled"]
  },
  "website_only": {"event_types": ["created"]}
}
```

- [ ] **Step 3：寫失敗的測試**

`backend/tests/test_admissions_contract.py`：

```python
"""園務轉移契約（規格 12.2；R13）：用合成資料跑匯出，逐列對照
contracts/ivy-recruitment/ivy-schema.json。CI 讀不到園務 repo，這裡只比對快照；
快照與園務現行程式的漂移由 scripts/check_ivy_recruitment_contract.py 手動檢查
（解析與比對邏輯在這裡用假的園務原始碼測）。"""

from __future__ import annotations

import copy
import importlib.util
import json
import re
import stat
from datetime import date, datetime
from pathlib import Path

import pytest
from sqlalchemy import String, text
from sqlalchemy.exc import DBAPIError

from app.admissions import academic, constants, export
from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import OPERATING_TZ
from tests.admissions_helpers import ADMISSIONS, create_record, record_at_stage
from tests.conftest import legacy_request

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "contracts" / "ivy-recruitment" / "ivy-schema.json").read_text(encoding="utf-8"))
MODELS = {
    "recruitment_visits": RecruitmentVisit,
    "recruitment_event_log": RecruitmentEventLog,
    "grade_intake_targets": GradeIntakeTarget,
}
# 匯出時留 null、由匯入端依 mapping 填的欄位（園務 NOT NULL 的外鍵也在這裡）。
FILLED_BY_IMPORTER = {
    "recruitment_visits": {"provisional_grade_id", "tour_guide_employee_id"},
    "recruitment_event_log": {"recruitment_visit_id"},
    "grade_intake_targets": {"grade_id"},
}
ROC_DATE_RE = re.compile(r"^\d{3}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])$")


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "backend" / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _check_row(table: str, row: dict) -> None:
    """一列的欄位齊全、型別可轉換、長度、NOT NULL。"""
    columns = SCHEMA["tables"][table]["columns"]
    assert set(row) == {"website_id", "columns", "mapping"}, table
    assert set(row["columns"]) == set(columns) - {"id"}, table
    for name, value in row["columns"].items():
        spec = columns[name]
        if value is None:
            assert spec["nullable"] or name in FILLED_BY_IMPORTER[table], f"{table}.{name} 園務是 NOT NULL"
            continue
        kind = spec["type"]
        if kind == "String":
            assert isinstance(value, str) and len(value) <= spec["length"], f"{table}.{name} 超過 {spec['length']} 字"
        elif kind == "Text":
            assert isinstance(value, str), f"{table}.{name}"
        elif kind == "Integer":
            assert isinstance(value, int) and not isinstance(value, bool), f"{table}.{name}"
        elif kind == "Boolean":
            assert isinstance(value, bool), f"{table}.{name}"
        elif kind == "Date":
            date.fromisoformat(value)
        elif kind == "DateTime":
            assert datetime.fromisoformat(value).tzinfo is None, f"{table}.{name} 要是台北時間 naive"
        elif kind == "JSON":
            assert isinstance(value, dict), f"{table}.{name}"
        else:
            raise AssertionError(f"契約有沒處理的型別 {kind}（{table}.{name}）")


def test_snapshot_enums_match_website_constants():
    enums = SCHEMA["enums"]
    assert SCHEMA["ivy_backend_commit"] == "dfd230c3"
    assert enums["grades"] == list(constants.GRADES)
    assert enums["no_deposit_reasons"] == list(constants.NO_DEPOSIT_REASONS)
    assert enums["no_deposit_priority"] == {level: sorted(reasons) for level, reasons in constants.NO_DEPOSIT_PRIORITY.items()}
    assert enums["source_categories"] == constants.SOURCE_CATEGORIES
    assert list(enums["source_categories"]) == list(constants.SOURCE_CATEGORIES)
    assert enums["stages"] == list(constants.STAGES)
    assert enums["withdrawn_from"] == list(constants.WITHDRAWN_FROM)
    assert enums["event_types"] == sorted(set(constants.EVENT_TYPES) - set(constants.WEBSITE_ONLY_EVENT_TYPES))
    assert SCHEMA["website_only"]["event_types"] == list(constants.WEBSITE_ONLY_EVENT_TYPES)


def test_website_columns_fit_ivy_columns():
    """同名欄位：官網字串長度不超過園務；園務 NOT NULL 的官網也是 NOT NULL（匯出不會出現 null）。"""
    for table, model in MODELS.items():
        website = model.__table__.columns
        for name, spec in SCHEMA["tables"][table]["columns"].items():
            if name == "id" or name not in website:
                continue
            # visit_date 官網是 Date、匯出才轉成民國字串，長度由 _check_row 檢查。
            if spec["type"] == "String" and isinstance(website[name].type, String):
                assert website[name].type.length <= spec["length"], f"{table}.{name}"
            if not spec["nullable"]:
                assert not website[name].nullable, f"{table}.{name}"


@pytest.mark.asyncio
async def test_export_rows_match_ivy_snapshot(admin_client, db_session, tmp_path):
    """R13：合成資料涵蓋各階段、保留座位、計畫名額、每個字串欄位的最長值、由預約補建的訪視。"""
    longest = await create_record(
        admin_client,
        visit_date="2026-09-08", child_name="長" * constants.LEN_CHILD_NAME, grade="中班",
        phone="0" * constants.LEN_PHONE, contact_name="聯" * constants.LEN_CONTACT, address="址" * constants.LEN_ADDRESS,
        source="源" * constants.LEN_SOURCE, referrer="介" * constants.LEN_REFERRER,
        deposit_collector="收" * constants.LEN_COLLECTOR, tour_guide_name="師" * constants.LEN_TOUR_GUIDE,
        source_category="self_report", rides_bus=True, transfer_term=True, notes="備註", parent_response="再聯絡",
        no_deposit_reason="費用考量", no_deposit_reason_detail="比較學費",
    )
    deposited = await record_at_stage(admin_client, "deposited", child_name="已預繳")
    seat = await admin_client.post(
        f"{ADMISSIONS}/records/{deposited['id']}/seat",
        json={"grade": "小班", "target_school_year": 115, "target_semester": 1, "expected_version": deposited["version"]},
    )
    assert seat.status_code == 200, seat.text
    enrolled = await record_at_stage(admin_client, "enrolled", child_name="已註冊")
    withdrawn = await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="退註冊")
    request_id = await legacy_request(db_session, status="completed")
    from_booking = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert from_booking.status_code == 200, from_booking.text
    targets_saved = await admin_client.put(
        f"{ADMISSIONS}/intake-targets?campus_key=yihua",
        json={"school_year": 115, "semester": 1, "targets": {"小班": 10, "中班": 0}},
    )
    assert targets_saved.status_code == 200, targets_saved.text
    await create_record(admin_client, "minghua", child_name="明華的")

    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    assert list(result) == list(export.FILES)
    visits, events, targets = result["recruitment_visits"], result["recruitment_event_log"], result["grade_intake_targets"]
    assert len(visits) == 5
    visit_ids = {row["website_id"] for row in visits}
    enums = SCHEMA["enums"]
    for row in visits:
        _check_row("recruitment_visits", row)
        columns = row["columns"]
        assert columns["tenant_id"] == 1
        assert academic.ROC_MONTH_RE.match(columns["month"]) and ROC_DATE_RE.match(columns["visit_date"])
        assert columns["grade"] is None or columns["grade"] in enums["grades"]
        assert columns["source_category"] is None or columns["source_category"] in enums["source_categories"]
        assert columns["no_deposit_reason"] is None or columns["no_deposit_reason"] in enums["no_deposit_reasons"]
        assert columns["withdrawn_from"] is None or columns["withdrawn_from"] in enums["withdrawn_from"]
        assert columns["target_semester"] in (1, 2)
        assert row["mapping"]["campus_key"] == "yihua"
        assert row["mapping"]["provisional_grade"] is None or row["mapping"]["provisional_grade"] in enums["grades"]
    assert events, "合成資料應該有歷程"
    for row in events:
        _check_row("recruitment_event_log", row)
        columns = row["columns"]
        assert columns["event_type"] in enums["event_types"]
        assert columns["from_stage"] is None or columns["from_stage"] in enums["stages"]
        assert columns["to_stage"] in enums["stages"]
        assert row["mapping"]["recruitment_visit_website_id"] in visit_ids  # 歷程都接得回訪視
        assert columns["metadata_json"]["website_actor"]["name"] == "admin@ivy.example"
    assert "created" not in {row["columns"]["event_type"] for row in events}
    for row in targets:
        _check_row("grade_intake_targets", row)
        assert row["columns"]["semester"] in (1, 2) and row["mapping"]["grade"] in enums["grades"]
    assert {(row["mapping"]["grade"], row["columns"]["target_seats"]) for row in targets} == {("小班", 10), ("中班", 0)}

    by_id = {row["website_id"]: row for row in visits}
    first = by_id[longest["id"]]["columns"]
    assert (first["visit_date"], first["month"], first["child_name"]) == ("115.09.08", "115.09", "長" * 50)
    assert (first["rides_bus"], first["transfer_term"], first["expected_start_label"]) == (True, True, None)
    utc_created = datetime.fromisoformat(longest["created_at"])
    assert datetime.fromisoformat(first["created_at"]) == utc_created.astimezone(OPERATING_TZ).replace(tzinfo=None)
    assert by_id[deposited["id"]]["mapping"]["provisional_grade"] == "小班"
    assert by_id[deposited["id"]]["columns"]["provisional_grade_id"] is None
    assert by_id[withdrawn["id"]]["columns"]["withdrawn_from"] == "enrolled"
    extensions = {row["website_id"]: row for row in result["extensions"]}
    assert set(extensions) == visit_ids
    assert extensions[from_booking.json()["id"]]["visit_request_id"] == request_id
    assert extensions[enrolled["id"]]["enrolled_on"] == "2026-09-30"

    paths = export.write_jsonl(result, tmp_path / "yihua")
    assert [path.name for path in paths] == [f"{name}.jsonl" for name in export.FILES]
    assert stat.S_IMODE((tmp_path / "yihua").stat().st_mode) == 0o700
    for path, name in zip(paths, export.FILES):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        assert rows == json.loads(json.dumps(result[name], ensure_ascii=False))
    with pytest.raises(FileExistsError):
        export.write_jsonl(result, tmp_path / "yihua")


@pytest.mark.asyncio
async def test_export_script_is_read_only(app, admin_client, tmp_path, monkeypatch):
    """匯出程式只讀（規格 12.2）：連線預設唯讀交易，寫入會被資料庫擋下。"""
    await create_record(admin_client)
    script = _load_script("export_ivy_recruitment")
    monkeypatch.setattr(script, "get_settings", lambda: app.state.settings)
    assert await script.run([("yihua", 1)], tmp_path) == 0
    [line] = (tmp_path / "yihua" / "recruitment_visits.jsonl").read_text(encoding="utf-8").splitlines()
    assert json.loads(line)["columns"]["tenant_id"] == 1
    engine = script.readonly_engine(app.state.settings)
    try:
        async with engine.connect() as conn:
            with pytest.raises(DBAPIError):
                await conn.execute(text("UPDATE recruitment_visits SET notes = '不該寫入'"))
    finally:
        await engine.dispose()
    with pytest.raises(SystemExit):
        script.parse_args(["--campus", "taipei=1", "--out", str(tmp_path)])
    assert script.parse_args(["--campus", "renwu=3", "--out", str(tmp_path)]).campus == [("renwu", 3)]


FAKE_IVY = {
    "models/recruitment.py": '''
class RecruitmentVisit(TenantMixin, Base):
    __tablename__ = "recruitment_visits"
    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(10), nullable=False, index=True)
    withdrawn_from = Column(String(20), nullable=True)
    __table_args__ = (CheckConstraint("withdrawn_from IN ('deposited', 'enrolled')", name="ck_rv_withdrawn_from"),)


class RecruitmentEventLog(Base):
    __tablename__ = "recruitment_event_log"
    id = Column(Integer, primary_key=True, index=True)
    metadata_json = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)


class GradeIntakeTarget(Base):
    __tablename__ = "grade_intake_targets"
    grade_id = Column(Integer, ForeignKey("class_grades.id", ondelete="CASCADE"), nullable=False)
''',
    "api/recruitment/shared.py": '''
NO_DEPOSIT_REASONS = ["甲", "乙"]
HIGH_PRIORITY_NO_DEPOSIT_REASONS = {"甲"}
MEDIUM_PRIORITY_NO_DEPOSIT_REASONS = {"丙"}
LOW_PRIORITY_NO_DEPOSIT_REASONS = {"乙"}
''',
    "models/recruitment_bonus.py": '''
DEFAULT_POINT_CATALOG: dict[str, dict] = {"self_report": {"label": "自報生", "points": 0.3}}
''',
    "services/recruitment_funnel.py": '''
STAGES: tuple[Stage, ...] = ("visited", "deposited")


def toggle(to_stage):
    event_type = "deposit_added" if to_stage == "deposited" else "deposit_removed"
    write(event_type=event_type)
    write(event_type="withdrawn")
''',
    "services/recruitment_intake_plan.py": '''
def seat(is_set):
    return Log(event_type="seat_reserved" if is_set else "seat_released")
''',
    "services/recruitment_conversion.py": '''
def convert(session):
    session.add(StudentChangeLog(event_type="入學"))
    session.query(Log).filter_by(event_type="converted")
''',
}


def test_drift_check_reads_ivy_source_with_ast(tmp_path):
    for relative, source in FAKE_IVY.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    live = _load_script("check_ivy_recruitment_contract").read_ivy(tmp_path)
    assert live["tables"] == {
        "recruitment_visits": {"columns": {
            "tenant_id": {"type": "Integer", "nullable": False, "foreign_key": "tenants.id"},
            "id": {"type": "Integer", "nullable": False, "primary_key": True},
            "month": {"type": "String", "nullable": False, "length": 10},
            "withdrawn_from": {"type": "String", "nullable": True, "length": 20},
        }},
        "recruitment_event_log": {"columns": {
            "id": {"type": "Integer", "nullable": False, "primary_key": True},
            "metadata_json": {"type": "JSON", "nullable": True},
        }},
        "grade_intake_targets": {"columns": {
            "grade_id": {"type": "Integer", "nullable": False, "foreign_key": "class_grades.id"},
        }},
    }
    assert live["enums"] == {
        "no_deposit_reasons": ["甲", "乙"],
        "no_deposit_priority": {"high": ["甲"], "medium": ["丙"], "low": ["乙"]},
        "source_categories": {"self_report": "自報生"},
        "stages": ["visited", "deposited"],
        "event_types": ["converted", "deposit_added", "deposit_removed", "seat_released", "seat_reserved", "withdrawn"],
        "withdrawn_from": ["deposited", "enrolled"],
    }


def test_drift_check_reports_each_difference():
    check = _load_script("check_ivy_recruitment_contract")
    same = {"tables": copy.deepcopy(SCHEMA["tables"]), "enums": {k: v for k, v in SCHEMA["enums"].items() if k != "grades"}}
    assert check.diff(SCHEMA, same) == []
    changed = copy.deepcopy(same)
    del changed["tables"]["recruitment_visits"]["columns"]["district"]
    changed["tables"]["recruitment_visits"]["columns"]["phone"]["length"] = 30
    changed["tables"]["recruitment_event_log"]["columns"]["student_note"] = {"type": "Text", "nullable": True}
    changed["enums"]["event_types"] = [*changed["enums"]["event_types"], "reopened"]
    problems = check.diff(SCHEMA, changed)
    assert len(problems) == 4, problems
    assert any("recruitment_visits.district" in p and "已沒有" in p for p in problems)
    assert any("recruitment_visits.phone" in p for p in problems)
    assert any("recruitment_event_log.student_note" in p and "新增" in p for p in problems)
    assert any("event_types" in p for p in problems)
```

- [ ] **Step 4：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_contract.py -q
```
Expected: FAIL（collection error：`ImportError: cannot import name 'export' from 'app.admissions'`）。

- [ ] **Step 5：`export.py`**

`backend/app/admissions/export.py`：

```python
"""轉成園務招生三張表的欄位形狀（規格 12；格式說明在 contracts/ivy-recruitment/README.md）。

每列是 {"website_id": 官網 uuid, "columns": {園務欄位: 值}, "mapping": {匯入時要對應
的官網值}}（A 計畫調整第 16 條）。columns 只有園務表的欄位（不含 id）；外鍵與年級
id（recruitment_visit_id、grade_id、provisional_grade_id、tour_guide_employee_id）
留 null，由匯入端依 mapping 填；student_id、actor_user_id、expected_start_label
一律 null。日期時間轉台北時間 naive ISO 字串（園務存台北 naive）。官網延伸的
created 事件不匯出。

只讀，不寫資料庫；write_jsonl 寫檔時目錄 0700、檔案 0600、不覆寫。"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants
from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.auth.models import User
from app.common.timezones import OPERATING_TZ

FILES: tuple[str, ...] = ("recruitment_visits", "recruitment_event_log", "grade_intake_targets", "extensions")


def _taipei_naive(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(OPERATING_TZ).replace(tzinfo=None).isoformat()


def ivy_visit_row(visit: RecruitmentVisit, *, tenant_id: int | None = None) -> dict:
    """園務 recruitment_visits 的形狀（不含 id）。"""
    return {
        "website_id": str(visit.id),
        "columns": {
            "tenant_id": tenant_id,
            "month": visit.month,
            "seq_no": visit.seq_no,
            "visit_date": academic.roc_date(visit.visit_date),
            "child_name": visit.child_name,
            "birthday": visit.birthday.isoformat() if visit.birthday else None,
            "grade": visit.grade,
            "phone": visit.phone,
            "contact_name": visit.contact_name,
            "address": visit.address,
            "district": visit.district,
            "source": visit.source,
            "referrer": visit.referrer,
            "deposit_collector": visit.deposit_collector,
            "tour_guide_employee_id": None,
            "source_category": visit.source_category,
            "has_deposit": visit.has_deposit,
            "rides_bus": visit.rides_bus,
            "notes": visit.notes,
            "parent_response": visit.parent_response,
            "geocoding_consent_at": _taipei_naive(visit.geocoding_consent_at),
            "no_deposit_reason": visit.no_deposit_reason,
            "no_deposit_reason_detail": visit.no_deposit_reason_detail,
            "enrolled": visit.enrolled,
            "transfer_term": visit.transfer_term,
            "expected_start_label": None,
            "provisional_grade_id": None,
            "target_school_year": visit.target_school_year,
            "target_semester": visit.target_semester,
            "withdrawn_at": _taipei_naive(visit.withdrawn_at),
            "withdrawn_from": visit.withdrawn_from,
            "withdraw_reason": visit.withdraw_reason,
            "created_at": _taipei_naive(visit.created_at),
            "updated_at": _taipei_naive(visit.updated_at),
        },
        "mapping": {
            "campus_key": visit.campus_key,
            # 依名稱對應該租戶的 class_grades.id，填進 provisional_grade_id。
            "provisional_grade": visit.provisional_grade,
            # 依姓名對應園務員工，填進 tour_guide_employee_id；對不上留空並列入報告。
            "tour_guide_name": visit.tour_guide_name,
        },
    }


def ivy_event_row(event: RecruitmentEventLog, *, actor_name: str | None = None) -> dict:
    """園務 recruitment_event_log 的形狀（不含 id）。官網帳號沒有對應的園務帳號：
    操作者記在 metadata_json.website_actor，actor_user_id 留空。"""
    metadata = dict(event.metadata_json or {})
    if event.actor_user_id is not None:
        metadata["website_actor"] = {"user_id": str(event.actor_user_id), "name": actor_name}
    return {
        "website_id": str(event.id),
        "columns": {
            "recruitment_visit_id": None,
            "event_type": event.event_type,
            "from_stage": event.from_stage,
            "to_stage": event.to_stage,
            "student_id": None,
            "reason": event.reason,
            "actor_user_id": None,
            "metadata_json": metadata or None,
            "created_at": _taipei_naive(event.created_at),
        },
        "mapping": {"recruitment_visit_website_id": str(event.recruitment_visit_id)},
    }


def ivy_target_row(target: GradeIntakeTarget) -> dict:
    """園務 grade_intake_targets 的形狀（不含 id）。"""
    return {
        "website_id": str(target.id),
        "columns": {
            "grade_id": None,
            "school_year": target.school_year,
            "semester": target.semester,
            "target_seats": target.target_seats,
            "created_at": _taipei_naive(target.created_at),
            "updated_at": _taipei_naive(target.updated_at),
        },
        "mapping": {"campus_key": target.campus_key, "grade": target.grade},
    }


def extension_row(visit: RecruitmentVisit) -> dict:
    """規格 12.3 的延伸欄位（version、anonymized_at 不轉）。"""
    return {
        "website_id": str(visit.id),
        "visit_request_id": str(visit.visit_request_id) if visit.visit_request_id else None,
        "enrolled_on": visit.enrolled_on.isoformat() if visit.enrolled_on else None,
        "tour_guide_user_id": str(visit.tour_guide_user_id) if visit.tour_guide_user_id else None,
        "tour_guide_name": visit.tour_guide_name,
    }


async def export_campus(db: AsyncSession, campus_key: str, *, tenant_id: int | None = None) -> dict[str, list[dict]]:
    """一個校區的四份資料（鍵與順序同 FILES）。訪視依建立時間、歷程依時間排序。"""
    visits = list(
        (
            await db.execute(
                select(RecruitmentVisit)
                .where(RecruitmentVisit.campus_key == campus_key)
                .order_by(RecruitmentVisit.created_at, RecruitmentVisit.id)
            )
        ).scalars()
    )
    events = await db.execute(
        select(RecruitmentEventLog, User.display_name, User.email)
        .outerjoin(User, User.id == RecruitmentEventLog.actor_user_id)
        .where(
            RecruitmentEventLog.recruitment_visit_id.in_([visit.id for visit in visits]),
            RecruitmentEventLog.event_type.not_in(constants.WEBSITE_ONLY_EVENT_TYPES),
        )
        .order_by(RecruitmentEventLog.created_at, RecruitmentEventLog.id)
    )
    targets = await db.execute(
        select(GradeIntakeTarget)
        .where(GradeIntakeTarget.campus_key == campus_key)
        .order_by(GradeIntakeTarget.school_year, GradeIntakeTarget.semester, GradeIntakeTarget.grade)
    )
    return {
        "recruitment_visits": [ivy_visit_row(visit, tenant_id=tenant_id) for visit in visits],
        "recruitment_event_log": [
            # 匯出檔會交給園務系統，不帶同事 Email；沒有顯示名稱就只留 user_id。
            ivy_event_row(event, actor_name=display_name) for event, display_name, email in events.all()
        ],
        "grade_intake_targets": [ivy_target_row(target) for target in targets.scalars()],
        "extensions": [extension_row(visit) for visit in visits],
    }


def write_jsonl(result: dict[str, list[dict]], out_dir: Path) -> list[Path]:
    """每份資料一個 JSONL（UTF-8，一列一筆）。含幼生與家長個資：目錄 0700、檔案
    0600；檔案已存在就丟 FileExistsError，不覆寫。"""
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    paths = []
    for name in FILES:
        path = out_dir / f"{name}.jsonl"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for row in result[name]:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        paths.append(path)
    return paths
```

- [ ] **Step 6：匯出程式 `backend/scripts/export_ivy_recruitment.py`**

```python
#!/usr/bin/env python3
"""把官網招生資料匯出成園務招生三張表的 JSONL（規格 12.2；格式見
contracts/ivy-recruitment/README.md）。

只讀：連線的 default_transaction_read_only 設成 on，寫入會被資料庫擋下；結束一律
rollback。校區→租戶對照由命令列給（不寫死：明華、崇德、國際的租戶還不存在）。

用法（在 backend/ 下，環境變數同 API）：
  uv run python scripts/export_ivy_recruitment.py --campus yihua=1 --campus renwu=3 --out <輸出目錄>

每個校區輸出到 <輸出目錄>/<campus_key>/ 的四個 JSONL。內容含幼生與家長個資：目錄
0700、檔案 0600，已存在的檔案不覆寫。"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine  # noqa: E402

from app.admissions import export  # noqa: E402
from app.booking import models as booking_models  # noqa: E402,F401  招生訪視的外鍵 visit_requests 要在同一份 metadata
from app.campuses.models import CAMPUS_KEYS  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402


def readonly_engine(settings: Settings) -> AsyncEngine:
    """每條連線一建立就是唯讀交易（asyncpg server_settings）。"""
    return create_async_engine(
        settings.active_database_url(),
        hide_parameters=True,
        connect_args={"server_settings": {"default_transaction_read_only": "on"}},
    )


def _campus_tenant(value: str) -> tuple[str, int]:
    campus_key, separator, tenant = value.partition("=")
    if not separator or campus_key not in CAMPUS_KEYS or not tenant.isdigit():
        raise argparse.ArgumentTypeError(f"格式是「校區=租戶編號」，例如 yihua=1；校區只能是 {'、'.join(CAMPUS_KEYS)}")
    return campus_key, int(tenant)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="匯出官網招生資料（園務欄位形狀，只讀）")
    parser.add_argument("--campus", action="append", required=True, type=_campus_tenant, metavar="校區=租戶編號")
    parser.add_argument("--out", required=True, type=Path, help="輸出目錄（每個校區一個子資料夾）")
    return parser.parse_args(argv)


async def run(campuses: list[tuple[str, int]], out: Path) -> int:
    engine = readonly_engine(get_settings())
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            for campus_key, tenant_id in campuses:
                result = await export.export_campus(db, campus_key, tenant_id=tenant_id)
                paths = export.write_jsonl(result, out / campus_key)
                counts = "、".join(f"{name} {len(result[name])} 筆" for name in export.FILES)
                print(f"{campus_key}（租戶 {tenant_id}）：{counts} → {paths[0].parent}")
            await db.rollback()
    finally:
        await engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return asyncio.run(run(args.campus, args.out))


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7：漂移檢查 `backend/scripts/check_ivy_recruitment_contract.py`**

```python
#!/usr/bin/env python3
"""招生轉移契約的漂移檢查（規格 12.2；手動執行，不進 CI：CI 讀不到園務 repo）。

比對 contracts/ivy-recruitment/ivy-schema.json 與園務後端現行原始碼：三張表的欄位
（名稱、型別、長度、可否為空、外鍵）、未預繳原因與優先度、來源分類、漏斗階段、
事件類型、退出來源。只用 ast 讀原始碼，不 import 園務程式、不連任何資料庫。年級
（園務前端 GRADES_ORDER）不在園務後端，這支不檢查。

用法（在 backend/ 下）：
  uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
一致回 0；不一致列出每一項差異並回 1。"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "ivy-schema.json"
MODEL_FILE = "models/recruitment.py"
SHARED_FILE = "api/recruitment/shared.py"
BONUS_FILE = "models/recruitment_bonus.py"
FUNNEL_FILE = "services/recruitment_funnel.py"
EVENT_FILES = ("services/recruitment_funnel.py", "services/recruitment_intake_plan.py", "services/recruitment_conversion.py")
CLASSES = {
    "RecruitmentVisit": "recruitment_visits",
    "RecruitmentEventLog": "recruitment_event_log",
    "GradeIntakeTarget": "grade_intake_targets",
}
# 招生事件類型是小寫英文；學生異動紀錄（例如「入學」）不算。
_EVENT_TYPE_RE = re.compile(r"^[a-z_]+$")
# TenantMixin 宣告的 tenant_id（models/tenant_mixin.py _tenant_id_column）。
_TENANT_ID = {"type": "Integer", "nullable": False, "foreign_key": "tenants.id"}


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _type_of(node: ast.expr) -> tuple[str, int | None]:
    """Column 的第一個參數：Integer、String(10)、JSON().with_variant(JSONB(), …)。"""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "with_variant":
        return _type_of(node.func.value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        length = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
        return node.func.id, length
    if isinstance(node, ast.Name):
        return node.id, None
    raise ValueError(f"看不懂的欄位型別：{ast.dump(node)}")


def _column(call: ast.Call) -> dict:
    kind, length = _type_of(call.args[0])
    keywords = {keyword.arg: keyword.value for keyword in call.keywords}
    primary_key = isinstance(keywords.get("primary_key"), ast.Constant) and keywords["primary_key"].value is True
    nullable = keywords.get("nullable")
    column: dict = {"type": kind, "nullable": bool(nullable.value) if isinstance(nullable, ast.Constant) else not primary_key}
    if length is not None:
        column["length"] = length
    if primary_key:
        column["primary_key"] = True
    for argument in call.args[1:]:
        if isinstance(argument, ast.Call) and isinstance(argument.func, ast.Name) and argument.func.id == "ForeignKey":
            column["foreign_key"] = argument.args[0].value
    return column


def _constant(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            return ast.literal_eval(node.value)
    raise KeyError(f"園務原始碼找不到 {name}")


def _strings(node: ast.expr) -> set[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        return _strings(node.body) | _strings(node.orelse)
    return set()


def read_tables(ivy_root: Path) -> dict:
    tables = {}
    for node in _parse(ivy_root / MODEL_FILE).body:
        if not isinstance(node, ast.ClassDef) or node.name not in CLASSES:
            continue
        columns: dict[str, dict] = {}
        if any(isinstance(base, ast.Name) and base.id == "TenantMixin" for base in node.bases):
            columns["tenant_id"] = dict(_TENANT_ID)
        for statement in node.body:
            if (
                isinstance(statement, ast.Assign)
                and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Name)
                and isinstance(statement.value, ast.Call)
                and isinstance(statement.value.func, ast.Name)
                and statement.value.func.id == "Column"
            ):
                columns[statement.targets[0].id] = _column(statement.value)
        tables[CLASSES[node.name]] = {"columns": columns}
    return tables


def read_enums(ivy_root: Path) -> dict:
    shared = _parse(ivy_root / SHARED_FILE)
    event_types: set[str] = set()
    for relative in EVENT_FILES:
        for node in ast.walk(_parse(ivy_root / relative)):
            if isinstance(node, ast.keyword) and node.arg == "event_type":
                event_types |= _strings(node.value)
            elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "event_type" for t in node.targets):
                event_types |= _strings(node.value)
    withdrawn_from: list[str] = []
    for node in ast.walk(_parse(ivy_root / MODEL_FILE)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and "withdrawn_from IN" in node.value:
            withdrawn_from = re.findall(r"'([a-z_]+)'", node.value)
    return {
        "no_deposit_reasons": list(_constant(shared, "NO_DEPOSIT_REASONS")),
        "no_deposit_priority": {
            level: sorted(_constant(shared, f"{level.upper()}_PRIORITY_NO_DEPOSIT_REASONS"))
            for level in ("high", "medium", "low")
        },
        "source_categories": {
            code: entry["label"] for code, entry in _constant(_parse(ivy_root / BONUS_FILE), "DEFAULT_POINT_CATALOG").items()
        },
        "stages": list(_constant(_parse(ivy_root / FUNNEL_FILE), "STAGES")),
        "event_types": sorted(value for value in event_types if _EVENT_TYPE_RE.match(value)),
        "withdrawn_from": withdrawn_from,
    }


def read_ivy(ivy_root: Path) -> dict:
    """園務現行原始碼的欄位與列舉，形狀同 ivy-schema.json 的 tables 與 enums（沒有 grades）。"""
    return {"tables": read_tables(ivy_root), "enums": read_enums(ivy_root)}


def diff(snapshot: dict, live: dict) -> list[str]:
    """逐項列出快照與園務現行程式的差異；一致回空 list。"""
    problems: list[str] = []
    for table, spec in live["tables"].items():
        expected = snapshot["tables"].get(table, {}).get("columns", {})
        actual = spec["columns"]
        for name in sorted(expected.keys() - actual.keys()):
            problems.append(f"{table}.{name}：契約有，園務已沒有這個欄位")
        for name in sorted(actual.keys() - expected.keys()):
            problems.append(f"{table}.{name}：園務新增的欄位，契約沒有：{actual[name]}")
        for name in sorted(expected.keys() & actual.keys()):
            if expected[name] != actual[name]:
                problems.append(f"{table}.{name}：契約 {expected[name]}，園務 {actual[name]}")
    for key, value in live["enums"].items():
        if snapshot["enums"].get(key) != value:
            problems.append(f"列舉 {key}：契約 {snapshot['enums'].get(key)}，園務 {value}")
    return problems


def _head(ivy_root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(ivy_root), "rev-parse", "--short=8", "HEAD"], capture_output=True, text=True, check=False
    )
    return result.stdout.strip() or "（不是 git 目錄）"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="比對招生轉移契約與園務現行程式（只讀）")
    parser.add_argument("--ivy-backend", required=True, type=Path, help="園務後端 repo 的路徑")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    problems = diff(snapshot, read_ivy(args.ivy_backend))
    aligned = f"契約對齊 {snapshot['ivy_backend_commit']}，園務目前 {_head(args.ivy_backend)}"
    if problems:
        for problem in problems:
            print(f"- {problem}")
        print(f"{aligned}。請更新 contracts/ivy-recruitment/ 並評估官網要不要跟進。")
        return 1
    print(f"契約與園務一致（{aligned}）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 8：跑測試確認通過，並對真的園務 repo 跑一次漂移檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest tests/test_admissions_contract.py -q
uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
```
Expected: `test_admissions_contract.py` `6 passed`；漂移檢查印出「契約與園務一致（契約對齊 dfd230c3，園務目前 dfd230c3）。」並以 0 結束。園務若已前進且有差異：不要改快照遷就，把差異列表原文回報給使用者決定。

- [ ] **Step 9：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add contracts/ivy-recruitment/README.md contracts/ivy-recruitment/ivy-schema.json backend/app/admissions/export.py \
  backend/scripts/export_ivy_recruitment.py backend/scripts/check_ivy_recruitment_contract.py \
  backend/tests/test_admissions_contract.py
git commit -m "feat(admissions): 園務招生轉移契約、只讀匯出程式與漂移檢查

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A9：API 契約重產、後台型別別名、驗收紀錄與階段閘門

**Files:**
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（`npm run contract:generate`；A3–A8 都改了 API，集中在這裡重產一次）
- Modify: `admin/src/api/types.ts`（檔尾加招生型別別名）
- Modify: `docs/website-admin/acceptance.md`（檔尾加「招生入學」段落）

**Interfaces:**
- Consumes：A3–A7 的全部 schema 與路由。
- Produces：`admin/src/api/types.ts` 的 `RecruitmentVisit`、`RecruitmentVisitCreate`、`RecruitmentVisitUpdate`、`RecruitmentEvent`、`TransitionRequest`、`SeatRequest`、`SeatResult`（＝`SeatOut`）、`FunnelBoard`、`FunnelColumns`、`FunnelCard`、`IntakePlan`、`IntakePlanRow`、`IntakeTargetsRequest`、`Arrivals`、`ArrivalRow`、`AdmissionsOptions`（名稱去掉 `Out`；B1 的 `api/admissions.ts` 直接匯入）；acceptance.md 的 R01–R17 表。

- [ ] **Step 1：重產契約**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm run contract:generate
npm run contract:check
```
Expected: `contract:check` 印出「契約與目前 API 一致」且型別檢查通過。

- [ ] **Step 2：審查契約 diff（只有招生與保存政策的變動）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git diff --stat -- contracts/
node -e '
const fs = require("fs");
const { execSync } = require("child_process");
const before = JSON.parse(execSync("git show 0be93ea:contracts/openapi.json", { encoding: "utf8", maxBuffer: 1 << 26 }));
const after = JSON.parse(fs.readFileSync("contracts/openapi.json", "utf8"));
const retention = new Set(["RetentionDaysOut", "RetentionCountsOut", "RetentionPolicyUpdate", "RetentionPolicyOut"]);
const changed = Object.keys(before.components.schemas).filter(
  (name) => !retention.has(name) && JSON.stringify(before.components.schemas[name]) !== JSON.stringify(after.components.schemas[name]),
);
const paths = Object.keys(before.paths).filter((path) => JSON.stringify(before.paths[path]) !== JSON.stringify(after.paths[path]));
const added = Object.keys(after.paths).filter((path) => !(path in before.paths));
const expected = [
  "RecruitmentVisitCreate", "RecruitmentVisitUpdate", "RecruitmentVisitOut", "RecruitmentEventOut", "NoDepositReasonOption",
  "AdmissionsOptionsOut", "TransitionRequest", "FunnelCardOut", "FunnelColumnsOut", "FunnelBoardOut", "SeatRequest", "SeatOut",
  "IntakePlanRowOut", "IntakePlanTotalsOut", "IntakePlanOut", "IntakeTargetsRequest", "ArrivalRowOut", "ArrivalsOut",
];
const missing = expected.filter((name) => !after.components.schemas[name]);
const fields = {
  RetentionDaysOut: "admissions_days", RetentionCountsOut: "admissions", RetentionPolicyUpdate: "admissions_days",
};
const noField = Object.entries(fields).filter(([name, field]) => !after.components.schemas[name].properties[field]);
console.log(JSON.stringify({ changed, paths, added: added.length, missing, noField }));
'
```
Expected: `{"changed":[],"paths":[],"added":11,"missing":[],"noField":[]}`——
- 既有 schema 除了保存政策四個以外都沒變、既有路徑都沒變；
- 新增 11 個路徑：`/options`、`/records`、`/records/{visit_id}`、`/records/{visit_id}/events`、`/records/{visit_id}/transition`、`/records/{visit_id}/seat`、`/board`、`/intake-plan`、`/intake-targets`、`/arrivals`、`/from-visit-request/{visit_request_id}`（都在 `/api/website/v1/admin/admissions` 底下）；
- 18 個招生 schema 都在，名稱沒有 `-Input`／`-Output` 後綴。

任何一項不符就停下來回報（例如 `changed` 出現預約的 schema，代表 A6 動到了不該動的地方）。

再看 `contracts/generated/website-api.d.ts`：

```bash
grep -n "RecruitmentVisitOut: {" -A 3 contracts/generated/website-api.d.ts
grep -n "FunnelColumnsOut: {" -A 6 contracts/generated/website-api.d.ts
grep -n "warning_code" contracts/generated/website-api.d.ts
```
Expected：`FunnelColumnsOut` 是四個具名欄位（`visited`、`deposited`、`enrolled`、`withdrawn`），不是索引簽章；`warning_code` 是 `"SEAT_CAPACITY_WARNING" | null`；`RecruitmentVisitOut` 有唯讀的 `stage`、`has_visit_request`。

- [ ] **Step 3：後台型別別名**

`admin/src/api/types.ts` 檔尾加：

```ts

// 招生入學（2026-10 規格 13）。名稱去掉 Out；B 階段的 api/admissions.ts 從這裡匯入。
export type RecruitmentVisit = components['schemas']['RecruitmentVisitOut']
export type RecruitmentVisitCreate = components['schemas']['RecruitmentVisitCreate']
export type RecruitmentVisitUpdate = components['schemas']['RecruitmentVisitUpdate']
export type RecruitmentEvent = components['schemas']['RecruitmentEventOut']
export type TransitionRequest = components['schemas']['TransitionRequest']
export type SeatRequest = components['schemas']['SeatRequest']
export type SeatResult = components['schemas']['SeatOut']
export type FunnelBoard = components['schemas']['FunnelBoardOut']
export type FunnelColumns = components['schemas']['FunnelColumnsOut']
export type FunnelCard = components['schemas']['FunnelCardOut']
export type IntakePlan = components['schemas']['IntakePlanOut']
export type IntakePlanRow = components['schemas']['IntakePlanRowOut']
export type IntakeTargetsRequest = components['schemas']['IntakeTargetsRequest']
export type Arrivals = components['schemas']['ArrivalsOut']
export type ArrivalRow = components['schemas']['ArrivalRowOut']
export type AdmissionsOptions = components['schemas']['AdmissionsOptionsOut']
```

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm --prefix admin run typecheck
```
Expected: 無錯誤（別名都對得到產生檔裡的 schema；`RetentionPolicyOut` 多了選填的 `admissions_days`，現有保存政策頁不受影響）。

- [ ] **Step 4：驗收紀錄（`docs/website-admin/acceptance.md` 檔尾加段落）**

````markdown

## 招生入學（2026-10-01 規格，階段 A 後端完成，尚未部署）

規格 `docs/specs/2026-09-30-website-admissions-design.md`；計畫 `docs/superpowers/plans/2026-10-01-admissions*.md`（A 後端、B 後台、C 統計）。分支 `feature/admissions-20261001` 疊在家長自選場次預約（`0be93ea`）上。後端驗證都用真 PostgreSQL（隔離測試庫 `ivy_website_test_admissions`）。

| 編號 | 案例 | 狀態 | 證據 |
|---|---|---|---|
| R01 | 標記已到場建立招生訪視；重複標記或補建只有一筆；已取消、未到場不產生 | 通過（階段 A） | `backend/tests/test_admissions_booking_link.py`：`test_completion_creates_exactly_one_visit_and_rebuild_returns_it`、`test_only_completed_and_not_anonymized_requests_can_be_rebuilt`、`test_completion_never_fails_on_long_or_missing_fields`、`test_database_error_rolls_back_the_whole_completion` |
| R01a | 官網預約待確認清單：剛好開始、已到場、未到場、已取消、他校、停止申請、沒有場次 | 通過（階段 A） | `test_admissions_booking_link.py::test_arrivals_lists_started_confirmed_and_completed_without_visit`（與 `status_groups.group_condition("past")` 比對） |
| R02 | 手動新增缺必填、年級／未預繳原因／來源分類不合法 | 通過（階段 A） | `test_admissions_records.py::test_create_requires_the_four_ivy_fields`、`test_create_rejects_invalid_and_state_fields` |
| R03 | 同校同月份並行新增，序號不重複 | 通過（階段 A） | `test_admissions_records.py::test_concurrent_creates_get_distinct_seq_numbers` |
| R04 | 規格 6.3 每一種轉換與不允許的組合 | 通過（階段 A） | `test_admissions_funnel.py::test_capability_table_matches_spec`、`test_each_allowed_transition`（9 種）、`test_disallowed_transitions_return_422`、`test_withdraw_and_revert_require_reason`、`test_enroll_uses_reserved_seat_or_requires_grade_and_year` |
| R05 | 兩人同時轉換或編輯同一筆，後送者 409 | 通過（階段 A） | `test_admissions_funnel.py::test_concurrent_transition_conflict`、`test_admissions_records.py::test_patch_uses_fields_set_and_optimistic_lock` |
| R06 | 接待不能標記註冊／退註冊；editor、readonly 讀招生 API 403 | 通過（階段 A） | `test_admissions_funnel.py::test_reception_writes_but_cannot_convert`、`test_stale_version_is_409_before_capability_check`、`test_admissions_records.py::test_reception_writes_but_editor_and_readonly_get_403`、`test_admissions_schema.py::test_admissions_capabilities` |
| R07 | 分校帳號用 campus_key、訪視 id、預約 id 存取他校 404 | 通過（階段 A） | `test_admissions_records.py::test_other_campus_and_unknown_ids_get_404`、`test_admissions_intake.py::test_intake_permissions_and_scope`、`test_admissions_booking_link.py::test_arrivals_and_rebuild_permissions` |
| R08 | 保留座位：未預繳、未給學年拒絕；超額只警示 | 通過（階段 A） | `test_admissions_intake.py::test_seat_requires_deposit_year_and_not_enrolled`、`test_over_capacity_only_warns` |
| R09 | 名額計算：已保留、已註冊、退出、轉學期、未設定；已註冊者清除保留被拒 | 通過（階段 A） | `test_admissions_intake.py::test_intake_plan_counts_match_spec`、`test_cancel_withdraw_restores_reserved_seat`、`test_save_targets_upserts_and_null_deletes` |
| R10 | 統計合成資料、分母 0 | not-run（階段 C） | — |
| R11 | 近 30／90 天台北午夜邊界、參考月份 | not-run（階段 C） | — |
| R12 | 年級換算共用案例 | 部分（後端與官網通過；後台在階段 B） | `contracts/ivy-recruitment/grade-cases.json`；`test_admissions_academic.py`、`web/tests/admission-grade-cases.spec.ts` |
| R13 | 匯出程式契約測試 | 通過（階段 A） | `test_admissions_contract.py`（6 支）；漂移檢查對 `ivy-backend` `dfd230c3` 一致 |
| R14 | 保存政策試算與執行 | 通過（階段 A，天數待業主裁定） | `test_admissions_retention.py`（5 支）；`test_retention_policy.py` 期望值補上招生類別 |
| R15 | 後台看板拖曳與鍵盤、確認框、409 重載、快速切換校區、URL 還原 | not-run（階段 B） | — |
| R16 | 1440px 桌機、390px 手機 | not-run（階段 B、C） | — |
| R17 | stack e2e：預約 → 待確認 → 已到場 → 看板 → 預繳 → 註冊 → 名額 | not-run（階段 C） | — |

Review Focus（總覽）：1「標記已到場」被招生資料拖垮、2 台北日期與學期邊界、3 兩人同時拖同一張卡（後端）、4 退出後取消退出，都在上表的測試裡；5 空資料統計屬階段 C。

上線前必須裁定（規格 15）：官網預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存天數（`retention_policies.admissions_days` 預設 NULL＝不自動清理）。在此之前只在本機與測試環境使用。
````

- [ ] **Step 5：本階段閘門**

1. 完整後端測試（**主 session 用背景指令跑**；subagent 不跑全套，超過 10 分鐘沒有輸出會被中止）：

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q
```

2. 其餘三項依序跑（8GB RAM，不要同時跑）：

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm run contract:check
npm --prefix admin run test:unit -- labelCoverage
npm run test:website
```

Expected: pytest 全綠（含 A1–A8 新增的八個測試檔，以及 A6 列出的既有預約測試）；`contract:check` 一致；`labelCoverage` 全過；`test:website` 全過（含 A1 的 `admission-grade-cases.spec.ts`）。任何一項失敗都不進階段 B。

- [ ] **Step 6：Commit（需使用者已授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add contracts/openapi.json contracts/generated/website-api.d.ts admin/src/api/types.ts docs/website-admin/acceptance.md
git commit -m "chore(contracts): 重產招生入學 API 契約、後台型別別名與階段 A 驗收紀錄

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
