# 官網招生入學模組 Implementation Plan（總覽）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官網後台新增「招生入學」：參觀後的招生追蹤（已訪視 → 已預繳 → 已註冊 → 退預繳／退註冊）、名額規劃、統計分析，流程與公式比照園務系統。官網預約標記「已到場」時自動進漏斗。資料表逐欄對齊園務，併入園務時可以整批轉移。

**Architecture:** 新模組 `backend/app/admissions/`，三張表沿用園務表名（`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`），用 `campus_key` 取代 `tenant_id`。service 只 `flush`，路由 commit 並寫稽核，跟既有 booking 模組同一套分層。預約的 `workflow_service.mark_completed` 在同一個交易內呼叫招生 service 建立招生訪視。後台新增 `/admissions` 頁，有五個分頁：漏斗看板、訪視明細、名額規劃、官網預約、統計分析。轉移契約放在 `contracts/ivy-recruitment/`，匯出程式與契約測試進 CI。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async＋asyncpg、Alembic、PostgreSQL、pytest（`asyncio_mode="auto"`）；後台 Vue 3＋Pinia＋Element Plus＋Vite、vitest＋@vue/test-utils＋jsdom；Nuxt 4（只動 web 的一支測試）；Playwright（stack e2e）。

**Spec:** `docs/specs/2026-09-30-website-admissions-design.md`（實作前必讀，下稱「規格」）。本計畫與規格衝突時以規格為準並回報。例外：本總覽「技術調整」一節列出的項目以本計畫為準，Task C6 回寫規格。

**優先順序**：各階段檔開頭的「對總覽的調整」優先於本總覽的「介面」一節（2026-10-01：A 30 條、B 28 列、C 16 列；跨階段的接縫已由主 session 對齊）。實作某個 task 時，先讀該階段檔的調整，再讀本總覽。Task C6 把三份調整回寫進規格與本總覽。

## 分階段（一次 session 只做一個階段，階段間有硬閘）

| 階段 | 檔案 | 內容 | 閘門（全部通過才進下一階段） |
|---|---|---|---|
| A | `2026-10-01-admissions-A-backend.md` | 年級／學期工具與共用案例、資料表與 migration、權限、訪視 CRUD、狀態轉換、保留座位與名額、預約串接（已到場、補建、待確認清單）、保存政策、轉移契約與匯出、API 契約 | `cd backend && uv run pytest -q` 全綠（主 session 背景跑）；`npm run contract:check`；`npm --prefix admin run test:unit -- labelCoverage`；`npm run test:website` |
| B | `2026-10-01-admissions-B-admin.md` | 後台 API 模組、路由與側欄、頁面骨架與篩選、訪視明細與表單、漏斗看板、名額規劃、官網預約分頁、預約明細的到場確認框與連結、保存政策欄位 | `npm --prefix admin run typecheck`；`npm --prefix admin run test:unit` |
| C | `2026-10-01-admissions-C-stats.md` | 統計查詢與五校比較（後端）、統計分頁與五校比較（後台）、stack e2e、桌機與手機截圖、文件 | `cd backend && uv run pytest -q`；admin typecheck＋test:unit；`npm run e2e:build && npm run test:e2e:stack`；Playwright 1440／390 截圖 |

本計畫**不含部署**。招生分支疊在預約改版分支上；預約改版併入 main 之後，招生分支要 rebase（見「工作環境」）。

## 工作環境

- worktree：`/Users/yilunwu/Desktop/ivy-website-admissions`（sparse checkout：web backend admin content contracts tests deploy scripts docs .github），分支 `feature/admissions-20261001`，基底是 `feature/parent-self-booking-20260930` 的 `0be93ea`。所有指令都在這個目錄跑，不要動 `~/Desktop/ivy-website-admin`。
- 開工前：
  ```bash
  git -C /Users/yilunwu/Desktop/ivy-website-admissions fetch origin
  git -C /Users/yilunwu/Desktop/ivy-website-admissions log --oneline -1 feature/parent-self-booking-20260930
  git -C /Users/yilunwu/Desktop/ivy-website-admissions merge-base --is-ancestor feature/parent-self-booking-20260930 origin/main && echo "預約改版已進 main"
  ```
  - 預約改版分支若前進了，先問使用者要不要 rebase。
  - 預約改版若已進 main，先問使用者要不要把招生分支 rebase 到 `origin/main`。rebase 後重跑 `npm run contract:generate`，不要手動合併 `contracts/` 產生檔；再用 `alembic heads` 確認只有一個 head。
- 相依套件：
  - backend 用自己的 venv：`cd backend && uv sync`。**不要** symlink 別的 worktree 的 `.venv`，editable 安裝會載入別人的原始碼。
  - `web/node_modules`、`admin/node_modules` 要 symlink 回 `/private/tmp/ivy-website-self-booking-20260930` 之前，先 `cmp` 兩邊的 `package-lock.json`；不同就 `npm ci`。
- 後端測試庫：建自己的庫，避免跟其他 worktree 的 head 打架。
  ```bash
  createdb ivy_website_test_admissions
  cd backend
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions \
  WEBSITE_SESSION_SECRET=local-test-session-secret-1001 uv run alembic upgrade head
  ```
  - 之後跑 pytest 都帶 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions`。
  - 每加一支 migration 就重跑上面的 `alembic upgrade head`。
- **subagent 只跑單一測試檔。** 完整的 `uv run pytest -q` 由主 session 用背景指令跑：subagent 超過 10 分鐘沒有輸出會被中止。
- 機器 8GB RAM：同時只跑一組測試或建置。

## Global Constraints

- FastAPI 釘在 0.136.1，不升任何相依套件；不新增 Python 或 npm 套件（圖表用表格加 CSS 長條，不裝圖表庫）。
- Node 22（`.nvmrc`）。
- 不 push、不部署、不改正式 DB、不發真實通知。
- **commit 需使用者授權**（repo 規則「未經要求不 commit」）。使用者授權「在 feature 分支逐 task commit」後，才照各 task 的 commit 步驟做。
  - commit 訊息：Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
  - 只 `git add` 列出的檔案，禁止 `git add .`／`-A`／`commit -a`。
- 表名、欄位名照規格第 5 節：沿用園務名稱，型別依官網慣例。
  - uuid 主鍵 `default=uuid.uuid4`；時間 `DateTime(timezone=True)`。
  - `created_at`／`updated_at` 由程式填 `datetime.now(timezone.utc)`，沒有 server_default。
  - JSON 欄用 `sqlalchemy.JSON`（不是 JSONB）。
  - 列舉用 `String(n)`＋`CheckConstraint`，條件字串在 model 與 migration 逐字相同。
- 年級只有四個：`幼幼班`、`小班`、`中班`、`大班`。其餘列舉值（未預繳原因八類、來源分類九碼、事件類型、退出來源）一律從 `app/admissions/constants.py` 匯入，不在別處重寫。
- 營運日期一律台北：用 `app.common.timezones` 的 `today_local()`／`OPERATING_TZ`，不用 `date.today()`、`datetime.now()`（無時區）。
- service 只 `flush`，不 `commit`、不寫稽核；路由在成功時 `log_action` → `await db.commit()`，失敗時先 `await db.rollback()` 再 raise。
- 錯誤格式：`HTTPException(status_code, detail={"code": "UPPER_SNAKE", "message": "中文", ...})`。
  - 校區越權或查無資料用 `raise ScopeDenied()`（404）。
  - 缺 capability 由 `require_scope` 丟 403。
  - 版本不符 409 `RECRUITMENT_VISIT_VERSION_CONFLICT`，帶 `current_version`。
  - 不允許的轉換 422 `TRANSITION_NOT_ALLOWED`。
- **稽核**：每個 `/admin/` 底下的 POST／PUT／PATCH／DELETE 都要呼叫 `audit_service.log_action(`。
  - `action=`、`target_type=` 寫字面值，`metadata=` 寫字面值 dict。
  - metadata 不放個資（姓名、生日、電話、地址、聯絡人、家長回應、備註、原因全文都不行）。
  - 新的 action、target_type、metadata 鍵、before／after 欄位名要同步加進 `admin/src/api/labels.ts`，否則 `labelCoverage.test.ts` 失敗（見「稽核代碼」一節）。
- 路由裡禁止寫 `Role.XXX`／`.role ==`（`test_permission_table.py` 靜態掃描會擋），一律 `require_scope(user, "<capability>", campus_keys=[...])`。
- 新 capability 要同步：`backend/app/auth/permissions.py` 的 `_CAPABILITY_ROLES`，以及 `admin/src/__tests__/fixtures.ts` 的 `ROLE_CAPABILITIES`。
- 新表要加進 `backend/tests/conftest.py` 的 `_clean_tables` TRUNCATE 字串；model 模組要在 `backend/migrations/env.py` 匯入。
- API 或 schema 有變就跑 `npm run contract:generate`，提交 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`。
- 後台顏色只用既有 CSS token，不寫 rgba／hex／oklch 字面值。
- 招生 service 在 `mark_completed` 內被呼叫時**不得丟例外**。欄位超長就截斷，缺值就用預設，絕不能讓「標記已到場」因為招生資料失敗。
- 統計比率分母為 0 回 `None`（前端顯示「—」），不是 0。這是規格第 9.2 節刻意與園務不同的地方。

## 技術調整（本計畫為準，Task C6 回寫規格）

1. 列表端點照官網慣例回**裸 list**，用 `page`／`page_size` 分頁，前端以「回傳筆數 == page_size」判斷有下一頁；不另回 total。
2. `recruitment_event_log.metadata_json` 用 `JSON`，不是 JSONB（官網慣例）。
3. 狀態不允許的轉換回 **422** `TRANSITION_NOT_ALLOWED`（請求內容不合法）。預約既有的 `INVALID_TRANSITION` 是 409，代表「狀態剛被別人改了」，兩者語意不同，不要混用。
4. 建立訪視的 `campus_key` 放 query 參數，同 `POST /admin/slots` 慣例。
5. 預約的 `child_name`、`parent_name` 最長 64 字，招生的 `child_name`、`contact_name` 對齊園務是 50 字。自動建立時截斷到 50，不報錯。
6. 共用年級案例放在 `contracts/ivy-recruitment/grade-cases.json`，後端 pytest、web vitest、admin vitest 三邊都讀這份。
7. 保存政策新增欄位 `retention_policies.admissions_days`（Integer，可空，NULL＝不自動清理），以及報表類別 `admissions`。符合條件：`anonymized_at IS NULL AND updated_at < now - admissions_days`。

## 檔案配置（鎖定）

**後端 `backend/app/admissions/`**

| 檔案 | 責任 | 負責 task |
|---|---|---|
| `__init__.py` | 空 | A2 |
| `constants.py` | `GRADES`、`NO_DEPOSIT_REASONS`、`NO_DEPOSIT_PRIORITY`、`SOURCE_CATEGORIES`、`STAGES`、`EVENT_TYPES`、`WITHDRAWN_FROM`、`ANONYMIZED_TEXT`、長度上限常數 | A1 |
| `academic.py` | 民國月份與日期、學期、年級換算 | A1 |
| `models.py` | `RecruitmentVisit`、`RecruitmentEventLog`、`GradeIntakeTarget` | A2 |
| `schemas.py` | 所有 In／Out schema | A3 起逐步加 |
| `records.py` | 訪視建立、編輯、刪除、查詢、序號、歷程寫入 | A3 |
| `funnel.py` | 階段推導、狀態轉換、權限對照、看板 | A4 |
| `intake.py` | 保留座位、名額計算、計畫名額存檔 | A5 |
| `booking_link.py` | 由預約建立訪視、待確認清單 | A6 |
| `retention.py` | 招生訪視匿名化與試算 | A7 |
| `export.py` | 轉成園務欄位形狀 | A8 |
| `stats.py` | 統計查詢、五校比較 | C1、C2、C2b |
| `routes.py` | 全部 `/admin/admissions/*` 端點 | A3 起逐步加 |

其他後端檔案：
- `backend/migrations/versions/4a7e2c9d1b63_admissions.py`（A2）：建三張表，加 `retention_policies.admissions_days`。`down_revision = "c7d2e9f4a1b8"`。
- `backend/migrations/env.py`（A2）：匯入 admissions models。
- `backend/app/main.py`（A3）：`include_router(admissions_router)`。
- `backend/app/auth/permissions.py`（A2）：三個 capability。
- `backend/app/booking/workflow_service.py`（A6）：`mark_completed` 呼叫 `booking_link.ensure_from_visit_request`。
- `backend/app/operations/{models,retention_service,routes,schemas}.py`（A7）：`admissions_days` 與報表類別。
- `backend/scripts/export_ivy_recruitment.py`、`backend/scripts/check_ivy_recruitment_contract.py`（A8）。
- `contracts/ivy-recruitment/README.md`、`ivy-schema.json`（A8）；`grade-cases.json`（A1）。
- 測試：
  - `backend/tests/admissions_helpers.py`（A3 建、A6 擴充）
  - `test_admissions_academic.py`（A1）、`test_admissions_records.py`（A3）、`test_admissions_funnel.py`（A4）
  - `test_admissions_intake.py`（A5）、`test_admissions_booking_link.py`（A6）、`test_admissions_retention.py`（A7）
  - `test_admissions_contract.py`（A8）、`test_admissions_stats.py`（C1、C2、C2b）
- web：`web/tests/admission-grade-cases.spec.ts`（A1）。

**後台 `admin/src/`**

| 檔案 | 責任 | 負責 task |
|---|---|---|
| `api/admissions.ts` | 所有招生 API 呼叫（型別取自 generated） | B1 起逐步加 |
| `api/types.ts` | 匯出招生 schema 型別別名 | B1 |
| `api/labels.ts` | 稽核標籤（A 階段）、保存政策欄位標籤（A7） | A3–A7 |
| `admissions/constants.ts` | 階段、事件、年級文案與顏色 token 名稱 | B1 |
| `admissions/academic.ts` | `currentTerm`、`termLabel`、`gradeForBirthday`、`rocMonth` | B1 |
| `admissions/useAdmissionsFilters.ts` | 校區、學年、學期、分頁 ↔ URL query | B1 |
| `views/AdmissionsView.vue` | 頁首、篩選、五個分頁 | B1 |
| `components/admissions/RecordsTab.vue`、`RecordDialog.vue`、`EventsDrawer.vue` | 訪視明細 | B2 |
| `components/admissions/FunnelBoard.vue`、`FunnelCard.vue`、`TransitionDialog.vue` | 漏斗看板 | B3 |
| `components/admissions/IntakePlanTab.vue`、`SeatDialog.vue` | 名額規劃 | B4 |
| `components/admissions/ArrivalsTab.vue` | 官網預約 | B5 |
| `views/VisitDetailView.vue` | 已到場確認框、招生訪視連結 | B5 |
| `views/PoliciesView.vue` | `admissions_days` 欄位 | B6 |
| `components/admissions/StatsTab.vue`、`StatsOverview.vue`、`StatsDimensionTable.vue`、`CompareTable.vue` | 統計分析 | C3、C4 |
| `components/admissions/NoDepositList.vue` | 統計「未預繳原因」分頁的未預繳明細（名單） | C3b |
| `router/index.ts`、`router/nav.ts`、`__tests__/fixtures.ts` | 路由、側欄、測試權限表 | B1 |

## 介面（各 task 照這裡的名稱與型別實作）

### `app/admissions/constants.py`（A1）

```python
GRADES: tuple[str, ...] = ("幼幼班", "小班", "中班", "大班")
NO_DEPOSIT_REASONS: tuple[str, ...] = (
    "時程未到／仍在觀望", "已有其他就學選項／比較他校", "未註明／待追蹤", "距離／地點因素",
    "家庭照顧安排考量", "特殊需求／名額限制", "課程／環境仍在評估", "費用考量",
)
NO_DEPOSIT_PRIORITY: dict[str, tuple[str, ...]] = {
    "high": ("時程未到／仍在觀望", "課程／環境仍在評估"),
    "medium": ("距離／地點因素", "費用考量", "家庭照顧安排考量"),
    "low": ("已有其他就學選項／比較他校", "特殊需求／名額限制"),
}
SOURCE_CATEGORIES: dict[str, str] = {  # code → 園務文案（models/recruitment_bonus.py:51-61）
    "sibling_current": "在校生弟妹（兄姊老師）", "sibling_split": "在校兄姊二人均分",
    "sibling_graduate": "畢業生弟妹", "self_report": "自報生（廣告／鄰居／網路／假日活動）",
    "referral": "有緣名單（家長介紹／社區招生）", "invite_success": "邀約來園——邀約成功者",
    "invite_origin": "邀約來園——原本招生人", "home_deposit": "到家中收預繳",
    "returning": "舊生復學（獎金不計，考核 +1 另行人工）",
}
STAGES: tuple[str, ...] = ("visited", "deposited", "enrolled", "withdrawn")
EVENT_TYPES: tuple[str, ...] = (
    "created", "deposit_added", "deposit_removed", "converted", "revert_converted",
    "withdrawn", "withdraw_cancelled", "seat_reserved", "seat_released",
)
WITHDRAWN_FROM: tuple[str, ...] = ("deposited", "enrolled")
ANONYMIZED_TEXT = "（已依保存政策匿名化）"
MISSING_CHILD_NAME = "（未填姓名）"
# 欄位長度（對齊園務 models/recruitment.py）
LEN_CHILD_NAME = 50; LEN_CONTACT = 50; LEN_PHONE = 100; LEN_ADDRESS = 200; LEN_SOURCE = 50
LEN_REFERRER = 50; LEN_COLLECTOR = 50; LEN_TOUR_GUIDE = 50; LEN_REASON_CODE = 60; LEN_GRADE = 20
TEXT_MAX = 2000  # notes／parent_response／no_deposit_reason_detail／withdraw_reason／reason 的 API 上限
```

### `app/admissions/academic.py`（A1）

```python
def roc_month(day: date) -> str: ...            # date(2026, 9, 8) → "115.09"
def roc_date(day: date) -> str: ...             # date(2026, 9, 8) → "115.09.08"
def current_term(today: date) -> tuple[int, int]: ...
    # 8/1–12/31 → (Y-1911, 1)；1/1–1/31 → (Y-1912, 1)；2/1–7/31 → (Y-1912, 2)
def term_bounds(school_year: int, semester: int) -> tuple[date, date]: ...
    # 上學期：(school_year+1911)/8/1–(school_year+1912)/1/31；下學期：(school_year+1912)/2/1–7/31
def grade_for_birthday(birthday: date, school_year: int) -> str | None: ...
    # 園務 gradeForBirthday：cutoff=(school_year+1911)/9/1（含）；age=cutoff.year-birthday.year，9/1 之後出生減一；2 幼幼班、3 小班、4 中班、5 大班，其餘 None
def shift_roc_month(month: str, delta: int) -> str: ...  # "115.01", -1 → "114.12"
```

### `app/admissions/models.py`（A2）：欄位完全照規格第 5.1–5.3 節

`RecruitmentVisit` 另有 `events: Mapped[list[RecruitmentEventLog]] = relationship(back_populates="visit", cascade="all, delete-orphan", order_by=...created_at)`。CheckConstraint 名稱：
- `ck_recruitment_visits_grade`、`ck_recruitment_visits_provisional_grade`
- `ck_recruitment_visits_source_category`、`ck_recruitment_visits_no_deposit_reason`
- `ck_recruitment_visits_withdrawn_from`、`ck_recruitment_visits_target_semester`
- `ck_recruitment_visits_enrolled_on`（`enrolled = false OR enrolled_on IS NOT NULL`）
- `ck_grade_intake_targets_grade`、`ck_grade_intake_targets_semester`、`ck_grade_intake_targets_seats`

唯一約束：
- `uq_recruitment_visits_visit_request`（`visit_request_id`）
- `uq_recruitment_visits_seq`（`campus_key, month, seq_no`）
- `uq_grade_intake_target`（`campus_key, grade, school_year, semester`）

### `app/admissions/records.py`（A3）

```python
class RecordNotFound(Exception): ...
class VersionConflict(Exception):
    def __init__(self, current_version: int): ...
def stage_of(visit: RecruitmentVisit) -> str: ...           # 規格 6.2（定義在 funnel.py，records 從 funnel 匯入）
async def create_visit(db, *, campus_key: str, fields: dict, actor_user_id: uuid.UUID | None, origin: str,
                       visit_request_id: uuid.UUID | None = None, today: date | None = None) -> RecruitmentVisit
    # origin ∈ {"manual","visit_request"}；算 month、seq_no（pg_advisory_xact_lock(hashtext(campus_key||month))）；
    # target 缺值補 current_term(today_local())；寫 created 事件 metadata={"origin": origin}
async def get_visit_for_update(db, visit_id: uuid.UUID) -> RecruitmentVisit | None   # with_for_update
async def update_visit(db, visit, *, changes: dict, expected_version: int) -> list[str]  # 回傳實際改變的欄位名
async def delete_visit(db, visit, *, expected_version: int) -> None
def write_event(db, visit, *, event_type: str, from_stage: str | None, to_stage: str,
                actor_user_id, reason: str | None = None, metadata: dict | None = None) -> RecruitmentEventLog
class RecruitmentVisitFilters:   # Depends() 類別，同 booking 的 VisitRequestFilters
    def __init__(self, campus_key: str, month: str | None = None, grade: str | None = None,
                 target_school_year: int | None = None, target_semester: int | None = None,
                 source: str | None = None, referrer: str | None = None, has_deposit: bool | None = None,
                 no_deposit_reason: str | None = None, stage: str | None = None,
                 visit_request_id: uuid.UUID | None = None, q: str | None = None): ...
    def apply(self, stmt): ...
async def options(db, campus_key: str) -> dict   # months（新到舊）、sources、referrers（各取前 50 個不重複值）
```

### `app/admissions/funnel.py`（A4）

```python
Stage = Literal["visited", "deposited", "enrolled", "withdrawn"]
def derive_stage(visit) -> Stage
def transition_capability(from_stage: Stage, to_stage: Stage) -> str | None   # None＝不允許；否則 "admissions.write" 或 "admissions.convert"
class TransitionNotAllowed(Exception): ...
class TransitionFieldsMissing(Exception):
    def __init__(self, fields: list[str]): ...
async def transition(db, visit, *, to_stage: Stage, expected_version: int, actor_user_id,
                     reason: str | None = None, deposit_collector: str | None = None,
                     enrolled_on: date | None = None, grade: str | None = None,
                     target_school_year: int | None = None, target_semester: int | None = None) -> Stage  # 回傳 from_stage
async def board(db, campus_key: str, school_year: int, semester: int | None) -> dict
    # {"columns": {"visited": [card...], "deposited": [...], "enrolled": [...], "withdrawn": [...]},
    #  "unscoped_count": int, "school_year": int, "semester": int | None}
```

card：`{"id","child_name","grade","provisional_grade","target_school_year","target_semester","visit_date","has_visit_request","withdrawn_from","version"}`

### `app/admissions/intake.py`（A5）

```python
class SeatNotAllowed(Exception): ...        # message 中文
async def set_seat(db, visit, *, grade: str | None, target_school_year: int | None,
                   target_semester: int, expected_version: int, actor_user_id) -> bool   # 回傳是否超額警示
async def intake_plan(db, campus_key: str, school_year: int, semester: int) -> dict
    # {"school_year","semester","rows":[{"grade","target_seats":int|None,"reserved","enrolled","remaining":int|None,"over_capacity":bool}],
    #  "totals":{"target_seats":int|None,"reserved","enrolled","remaining":int|None}}
async def save_targets(db, campus_key: str, school_year: int, semester: int,
                       targets: dict[str, int | None], actor_user_id) -> list[str]   # 回傳有變動的年級
```

### `app/admissions/booking_link.py`（A6）

```python
def fields_from_visit_request(visit_request, *, today: date) -> dict   # 規格 6.1 的對應（純函式，截斷、補預設，不丟例外）
async def ensure_from_visit_request(db, visit_request, *, actor_user_id) -> tuple[RecruitmentVisit, bool]  # (visit, created)
async def arrivals(db, campus_key: str) -> dict
    # {"awaiting": [row...], "missing": [row...]}
    # row = {"visit_request_id","slot_date","start_time","parent_name","child_name","party_size","status"}
```

### `app/admissions/retention.py`（A7）

```python
async def eligible_count(db, days: int | None) -> int
async def anonymize_due(db, days: int | None) -> int       # days 為 None 時回 0，不動資料
def anonymize_visit(visit, events: list) -> None
```

### `app/admissions/export.py`（A8）

```python
def ivy_visit_row(visit) -> dict        # 園務 recruitment_visits 欄位形狀（不含 id／tenant_id）
def ivy_event_row(event) -> dict
def ivy_target_row(target) -> dict
def extension_row(visit) -> dict        # 規格 12.3 的延伸欄位
async def export_campus(db, campus_key: str) -> dict[str, list[dict]]
    # {"recruitment_visits": [...], "recruitment_event_log": [...], "grade_intake_targets": [...], "extensions": [...]}
```

### `app/admissions/stats.py`（C1、C2、C2b）：欄位與公式見 C 計畫

```python
async def query_stats(db, campus_key: str, *, school_year: int | None, semester: int | None,
                      reference_month: str | None, now: datetime | None = None) -> dict
async def compare(db, campus_keys: list[str], *, school_year: int, semester: int) -> list[dict]
```

### API（prefix `/api/website/v1`，全部 `tags=["admissions"]`）

| 方法與路徑 | capability | request | response | task |
|---|---|---|---|---|
| GET `/admin/admissions/options` | admissions.read | `campus_key` | `AdmissionsOptionsOut` | A3 |
| GET `/admin/admissions/records` | admissions.read | `RecruitmentVisitFilters`＋`page`＋`page_size`（預設 50，上限 100） | `list[RecruitmentVisitOut]` | A3 |
| POST `/admin/admissions/records` | admissions.write | `campus_key` query＋`RecruitmentVisitCreate` | 201 `RecruitmentVisitOut` | A3 |
| GET `/admin/admissions/records/{visit_id}` | admissions.read | — | `RecruitmentVisitOut` | A3 |
| PATCH `/admin/admissions/records/{visit_id}` | admissions.write | `RecruitmentVisitUpdate` | `RecruitmentVisitOut` | A3 |
| DELETE `/admin/admissions/records/{visit_id}` | admissions.write | `expected_version` query | 204 | A3 |
| GET `/admin/admissions/records/{visit_id}/events` | admissions.read | — | `list[RecruitmentEventOut]` | A3 |
| POST `/admin/admissions/records/{visit_id}/transition` | 依 `transition_capability` | `TransitionRequest` | `RecruitmentVisitOut` | A4 |
| GET `/admin/admissions/board` | admissions.read | `campus_key`、`school_year`（預設目前學年）、`semester` | `FunnelBoardOut` | A4 |
| POST `/admin/admissions/records/{visit_id}/seat` | admissions.write | `SeatRequest` | `SeatOut` | A5 |
| GET `/admin/admissions/intake-plan` | admissions.read | `campus_key`、`school_year`、`semester` | `IntakePlanOut` | A5 |
| PUT `/admin/admissions/intake-targets` | admissions.write | `campus_key` query＋`IntakeTargetsRequest` | `IntakePlanOut` | A5 |
| GET `/admin/admissions/arrivals` | booking.read | `campus_key` | `ArrivalsOut` | A6 |
| POST `/admin/admissions/from-visit-request/{visit_request_id}` | admissions.write＋booking.read | — | `RecruitmentVisitOut` | A6 |
| GET `/admin/admissions/stats` | admissions.read | `campus_key`、`school_year`、`semester`、`reference_month` | `AdmissionsStatsOut` | C1 |
| GET `/admin/admissions/compare` | admissions.read | `school_year`、`semester` | `list[AdmissionsCompareRow]` | C2 |
| GET `/admin/admissions/no-deposit-records` | admissions.read | `campus_key`、`school_year`、`semester`、`reason`、`grade`、`priority`、`overdue_days`、`cold_only`、`page`、`page_size` | `NoDepositRecordsOut`（含 `total`、`summary`、`records`，records 有孩子姓名） | C2b |

Schema 名稱（`app/admissions/schemas.py`）：
- 訪視：`RecruitmentVisitCreate`、`RecruitmentVisitUpdate`、`RecruitmentVisitOut`、`RecruitmentEventOut`
- 狀態與座位：`TransitionRequest`、`SeatRequest`、`SeatOut`、`FunnelBoardOut`、`FunnelCardOut`
- 名額：`IntakePlanOut`、`IntakePlanRowOut`、`IntakeTargetsRequest`
- 其他：`ArrivalsOut`、`ArrivalRowOut`、`AdmissionsOptionsOut`、`AdmissionsStatsOut`、`AdmissionsCompareRow`

`RecruitmentVisitOut` 欄位：
- 規格 5.1 全部欄位（`id` 起到 `updated_at`），不含 `anonymized_at`。
- 另加 `stage: str`、`has_visit_request: bool`、`tour_guide_user_id`。
- `RecruitmentVisitUpdate` 用 `model_fields_set` 區分「沒送」和「送 null 清空」。

### 稽核代碼（A 階段，labels.ts 同步）

| action | target_type | metadata（字面值 dict 的鍵） | 出處 |
|---|---|---|---|
| `recruitment_visit.create` | `recruitment_visit` | `origin` | A3 |
| `recruitment_visit.update` | `recruitment_visit` | `fields`（改變的欄位名清單） | A3 |
| `recruitment_visit.delete` | `recruitment_visit` | `stage` | A3 |
| `recruitment_visit.transition` | `recruitment_visit` | `from_stage`、`to_stage`、`has_reason` | A4 |
| `recruitment_visit.seat` | `recruitment_visit` | `grade_set`（bool）、`capacity_warning` | A5 |
| `grade_intake_target.update` | `grade_intake_target` | `school_year`、`semester`、`grades`（改變的年級清單） | A5 |
| `recruitment_visit.create_from_booking` | `recruitment_visit` | `created`（bool） | A6 |

保存政策：`retention_policy.update` 的 before／after 多了 `admissions_days`。`AUDIT_FIELD_LABELS` 加 `admissions_days: '招生訪視保留'`（A7）。

### 後台 API 模組 `admin/src/api/admissions.ts`（B1 起）

```ts
export function listRecords(params: RecordFilters & { page: number; page_size: number }): Promise<RecruitmentVisit[]>
export function createRecord(campusKey: string, body: RecruitmentVisitCreate): Promise<RecruitmentVisit>
export function getRecord(id: string): Promise<RecruitmentVisit>
export function updateRecord(id: string, body: RecruitmentVisitUpdate): Promise<RecruitmentVisit>
export function deleteRecord(id: string, expectedVersion: number): Promise<void>
export function listEvents(id: string): Promise<RecruitmentEvent[]>
export function transition(id: string, body: TransitionRequest): Promise<RecruitmentVisit>
export function setSeat(id: string, body: SeatRequest): Promise<SeatResult>
export function getBoard(campusKey: string, schoolYear: number, semester: number | null): Promise<FunnelBoard>
export function getIntakePlan(campusKey: string, schoolYear: number, semester: number): Promise<IntakePlan>
export function saveIntakeTargets(campusKey: string, body: IntakeTargetsRequest): Promise<IntakePlan>
export function getArrivals(campusKey: string): Promise<Arrivals>
export function createFromVisitRequest(visitRequestId: string): Promise<RecruitmentVisit>
export function getOptions(campusKey: string): Promise<AdmissionsOptions>
export function getStats(params: { campus_key: string; school_year: number | null; semester: number | null; reference_month: string | null }): Promise<AdmissionsStats>   // C3
export function getCompare(schoolYear: number, semester: number): Promise<AdmissionsCompareRow[]>                                                                       // C4
```

型別在 `admin/src/api/types.ts` 以 `components['schemas']['RecruitmentVisitOut']` 等別名匯出，名稱去掉 `Out`。

## Review Focus

規格沒逐條寫、但最可能讓使用者踩到的五種情況。每一條的測試放在負責該程式碼的 task：

1. **「標記已到場」被招生資料拖垮**：預約的孩子姓名 64 字、沒填孩子姓名或生日、勾滿五個得知管道、提問 500 字。期望：照常標記成功，招生訪視欄位截斷或用預設值。→ A6 `test_completion_never_fails_on_long_or_missing_fields`。
2. **台北日期與學期邊界**：
   - 2026-07-31 確認到場 → 目標 114 學年下學期；2026-08-01 → 115 學年上學期；2027-01-31 → 115 上；2027-02-01 → 115 下。
   - 民國月份依 `visit_date`（場次日期），不依建立時間。
   - → A1 `test_current_term_boundaries`、A6 `test_month_follows_slot_date_not_created_at`。
3. **兩人同時在看板拖同一張卡**：後送者收到 409，看板重新載入，卡片回到伺服器的位置，不會停在使用者拖到的錯誤欄。→ A4 `test_concurrent_transition_conflict`、B3 `FunnelBoard`「409 時重載並還原卡片」。
4. **退出後取消退出**：
   - 「退註冊 → 取消退出回已預繳」：`has_deposit` 恢復、`enrolled_on` 已清空、保留座位仍在，名額規劃算進「已保留」。
   - 「退預繳 → 取消退出回已訪視」：不算進任何名額。
   - → A5 `test_cancel_withdraw_restores_reserved_seat`。
5. **空資料的統計**：一筆訪視都沒有的校區、或某年級沒設計畫名額。期望：
   - 比率是 `null`（畫面顯示「—」），參考月份是 `null`，不報錯。
   - 五校比較顯示「未設定」，不是 0。
   - → C1 `test_stats_empty_campus`、C2 `test_compare_without_targets`、C3 `StatsTab`「無資料」。
