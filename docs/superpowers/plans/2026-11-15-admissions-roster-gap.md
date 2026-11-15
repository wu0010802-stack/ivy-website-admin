# 招生入學「編班與缺額」分頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官網後台招生入學加第三個分頁「編班與缺額」：各校維護編班表（可拖拉），缺額統計依編班表與預繳名單自動計算，可回算到結算日並存紀錄。

**Architecture:** 後端在 `backend/app/admissions/roster/` 新增一個子套件：四張新表、一個不碰資料庫的計算模組、服務層與路由；看板轉預繳時由 `funnel.transition` 單向呼叫 roster 的同步函式。前端在 `admin/src/components/admissions/roster/` 新增分頁元件，所有數字由後端算好回傳，前端只負責顯示與操作。

**Tech Stack:** FastAPI 0.136.1（釘版）＋ async SQLAlchemy 2.0 ＋ Alembic ＋ PostgreSQL；Vue 3 ＋ Pinia ＋ Element Plus ＋ Vite ＋ Vitest；Playwright stack e2e。

**Spec:** `docs/specs/2026-11-14-admissions-roster-gap-design.md`（以下稱「規格」）。畫面、用字、互動以示意頁 `~/Desktop/ivy-website-admin/design/admissions-roster-mockup-20261113/index.html` 為準（單檔，直接讀原始碼；它不在這個 sparse worktree 裡）。

## Global Constraints

- 工作目錄：`~/Repositories/ivy-website-wt/admissions-roster-20261114`，分支 `feature/admissions-roster-20261114`。只在這個分支做本機 commit（Conventional Commit、繁體中文）；**不 push、不合 main、不部署**（push main＝正式部署，要業主另外開口）。
- 不新增任何依賴（後端、前端都是）。FastAPI 維持 0.136.1。
- 全部跟著 `settings.admissions_enabled`：關閉時路由不掛、分頁不出現。
- 權限：讀 `admissions.read`、寫 `admissions.write`，一律用 `routes._require_campus` 的寫法檢查校區 scope（沒權限 403、越權或不存在的校區 404）。
- 「今天」一律 `app.common.timezones.today_local()`，不用 `date.today()`。
- 年級只有 `constants.GRADES` 四個：幼幼班、小班、中班、大班。
- 用字照規格 §8.4。畫面上不得出現把「續讀」當不足齡的寫法；「下學年：續讀／不讀」這個選項可以用。日期顯示用民國年。
- 個資：操作紀錄 metadata、日誌、錯誤訊息不放姓名、生日、特教生、原住民。測試資料、fixture、commit 訊息一律用虛構姓名。
- 前端字級與顏色走 `admin/src/style.css` 的 token，元件裡不寫 px 字級與色碼（`typeScale.test.ts` 會擋）。
- 測試庫名稱要含 `test`，用真 PostgreSQL：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_roster1115_test`（先 `createdb ivy_website_roster1115_test`）。這台機器只有 8GB RAM：同時只跑一組測試。
- 後端指令在 `backend/` 下用 `uv run`；Node 用 22（`source ~/.nvm/nvm.sh; nvm use 22;` 用分號串接，`source` 會回傳 3）。第一次先 `cd backend && uv sync`、`npm ci`、`npm --prefix admin ci`。
- 動到 API 或 schema 後跑 `npm run contract:generate` 並把 `contracts/` 的變更一起 commit；收尾跑 `npm run contract:check`。
- 新的稽核鍵（`roster_*`）要在 `admin/src/api/auditLabels.ts` 歸類，否則 admin 測試會紅。

## Review Focus

規格沒有明寫、但使用者一定會遇到的五種情況。每一條的測試已加在對應任務裡。

1. **兩個人同時拖同一班的幼生**：順序不能重複、不能掉人（Task 4）。
2. **貼上的名單很髒**：空白行、前後空白、同一個名字貼兩次、超過 50 字的一行。空行略過、空白修掉、重複照建並回報提醒、超長的整批拒絕並指出第幾行（Task 4）。
3. **統計日期亂填**：晚於今天、早於該學年 8 月 1 日。一律回 422，不要算出奇怪的數字（Task 6）。
4. **看板卡片在已訪視與已預繳之間來回拖**：編班表不能多出第二位；拖回已訪視後編班表那位留著並顯示提醒（Task 7）。
5. **手上的資料過期**：幼生剛被別人改過（版本不符）、目標班級剛被刪。回 409 或 404 與看得懂的訊息，不是 500；前端重新載入（Task 4、Task 10）。

---

## File Structure

**後端（新增）**
- `backend/app/admissions/roster/__init__.py`：空。
- `backend/app/admissions/roster/models.py`：`RosterClass`、`RosterStudent`、`RosterTierTarget`、`RosterSnapshot`。
- `backend/app/admissions/roster/calc.py`：純計算，不匯入 SQLAlchemy。
- `backend/app/admissions/roster/service.py`：班級與幼生的寫入、排序、狀態動作、讀取整張編班表。
- `backend/app/admissions/roster/sync.py`：看板 → 編班表的同步與看板狀態提醒。
- `backend/app/admissions/roster/routes.py`：`router`，前綴 `/api/website/v1/admin/admissions/roster`。
- `backend/app/admissions/schemas/roster.py`：請求與回應模型。
- `backend/migrations/versions/<rev>_admissions_roster.py`。
- `backend/tests/roster_helpers.py`、`backend/tests/test_admissions_roster_*.py`。

**後端（修改）**
- `backend/migrations/env.py`：匯入 roster models。
- `backend/app/main.py:293` 一帶：`admissions_enabled` 時掛 roster router。
- `backend/app/admissions/funnel.py` `transition()`：結尾呼叫 `sync.on_stage_changed`。

**前端（新增）**
- `admin/src/api/roster.ts`：API 封裝與型別別名。
- `admin/src/admissions/roster.ts`：純函式（字色、備註欄內容、日期文字、缺額文字）。
- `admin/src/components/admissions/roster/RosterTab.vue`（容器）、`RosterTable.vue`、`StudentMenu.vue`、`StudentDialog.vue`、`ClassDialog.vue`、`DepositDialog.vue`、`DepositList.vue`、`GapTable.vue`、`SnapshotList.vue`。
- `admin/src/__tests__/admissionsRoster*.test.ts`。
- `tests/stack/admissions-roster.spec.ts`。

**前端（修改）**
- `admin/src/admissions/useAdmissionsFilters.ts`（`ADMISSIONS_TABS`）、`admin/src/views/AdmissionsView.vue`、`admin/src/components/admissions/AdmissionsFilterBar.vue`、`admin/src/style.css`、`admin/src/api/auditLabels.ts`。

---

## 階段 A：後端

### Task 1: 資料表與 migration

**Files:**
- Create: `backend/app/admissions/roster/__init__.py`, `backend/app/admissions/roster/models.py`, `backend/migrations/versions/<rev>_admissions_roster.py`
- Modify: `backend/migrations/env.py`（比照第 20 行加一行匯入）
- Test: `backend/tests/test_admissions_roster_models.py`

**Interfaces:**
- Produces（欄名是後續任務的依據，不要改名）：
  - `RosterClass`（表 `roster_classes`）：`id: UUID`、`campus_key`（FK `campuses.key` RESTRICT）、`school_year: int`、`grade: str`（CHECK 在 `GRADES`）、`name: str(50)`、`class_code: str(20)`、`english_name: str(50)|None`、`head_teacher: str(50)|None`、`assistant_teacher: str(50)|None`、`english_teacher: str(50)|None`、`target_seats: int|None`（CHECK `>= 0`）、`sort_order: int`、`version: int`（預設 1）、`created_at`、`updated_at`、`updated_by: UUID|None`。唯一鍵 `(campus_key, school_year, class_code)`。
  - `RosterStudent`（表 `roster_students`）：`id`、`campus_key`、`school_year: int`、`class_id: UUID|None`（FK `roster_classes.id` RESTRICT）、`position: int|None`、`grade: str|None`、`child_name: str(50)`、`birthday: date|None`、`note: Text|None`、`status: str`（CHECK 在 `('pending','enrolled','left','refunded')`）、`enrollment_date`、`planned_entry_date`、`deposit_date`、`left_date`、`refunded_date`（都是 `date|None`）、`target_school_year: int|None`、`target_semester: int|None`（CHECK 1 或 2）、`is_special_education: bool`、`is_indigenous: bool`、`is_new_manual: bool`、`underage_manual: bool`、`next_year: str`（CHECK 在 `('continue','leave','repeat')`，預設 `'continue'`）、`recruitment_visit_id: UUID|None`（FK `recruitment_visits.id` SET NULL）、`from_funnel: bool`、`version: int`、`created_at`、`updated_at`、`updated_by`。
    - CHECK：`status <> 'enrolled' OR class_id IS NOT NULL`；`status NOT IN ('left','refunded') OR (class_id IS NULL AND position IS NULL)`；`class_id IS NOT NULL OR position IS NULL`。
    - 部分唯一索引 `uq_roster_students_active_visit`：`(recruitment_visit_id) WHERE recruitment_visit_id IS NOT NULL AND status IN ('pending','enrolled')`。
    - 索引 `(campus_key, school_year)`、`(class_id, position)`。
  - `RosterTierTarget`（表 `roster_tier_targets`）：PK `(campus_key, school_year, semester)`；`base`、`boost`、`top`（`int|None`，CHECK `>= 0`）、`updated_at`、`updated_by`。
  - `RosterSnapshot`（表 `roster_snapshots`）：`id`、`campus_key`、`school_year`、`as_of: date`、`payload: JSONB`、`created_at`、`created_by`。唯一鍵 `(campus_key, school_year, as_of)`。
  - 常數放 `models.py`：`STUDENT_STATUSES = ("pending","enrolled","left","refunded")`、`NEXT_YEAR_CHOICES = ("continue","leave","repeat")`。

- [ ] **Step 1: 寫失敗的測試**

```python
# backend/tests/test_admissions_roster_models.py
async def test_enrolled_student_requires_class(db_session):          # status='enrolled' 且 class_id=None → IntegrityError
async def test_left_student_cannot_keep_class(db_session):           # status='left' 且 class_id 有值 → IntegrityError
async def test_one_active_student_per_visit(db_session):             # 同一 recruitment_visit_id 兩筆 pending → IntegrityError；一筆 refunded＋一筆 pending 可以
async def test_class_code_unique_per_campus_year(db_session):        # 同校同學年同 class_code → IntegrityError；不同學年可以
async def test_class_with_students_cannot_be_deleted(db_session):    # 有 class_id 指向它時 DELETE → IntegrityError
```
用 `tests/conftest.py` 既有的資料庫 session fixture（先讀 conftest 找名稱）。姓名用「測試甲」這類虛構字串。

- [ ] **Step 2: 跑測試確認失敗** — `cd backend && uv run pytest tests/test_admissions_roster_models.py -q`，預期 ImportError。
- [ ] **Step 3: 寫 `models.py`**，風格照 `backend/app/admissions/models.py`（`_sql_in`、`Mapped`、`mapped_column`、時間欄位的預設值）。
- [ ] **Step 4: 產生 migration** — 先 `cd backend && uv run alembic heads` 確認只有一個 head（寫計畫時是 `f3b8d2a6c19e`；不是的話用實際的 head）。手寫 `upgrade()` 建四張表與索引、`downgrade()` 反向刪除。只新增表，不動既有表。
- [ ] **Step 5: 跑測試確認通過**，再跑 `uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`（對測試庫）確認可逆。
- [ ] **Step 6: Commit** — `feat(admissions): 編班表的班級、幼生、三段目標與結算紀錄資料表`

### Task 2: 計算模組（純函式）

**Files:**
- Create: `backend/app/admissions/roster/calc.py`
- Test: `backend/tests/test_admissions_roster_calc.py`

**Interfaces:**
- Consumes: `app.admissions.constants.GRADES`、`app.admissions.academic.term_bounds`。不匯入 models。
- Produces:

```python
GRADE_ORDER = ("大班", "中班", "小班", "幼幼班")   # 畫面與統計的欄位順序

@dataclass(frozen=True)
class Facts:                       # 一位幼生算統計要用到的事實
    grade: str | None              # 排進班級的＝班級年級；沒編班的＝自己的年級
    status: str
    enrollment_date: date | None
    deposit_date: date | None
    left_date: date | None
    refunded_date: date | None
    target_school_year: int | None
    target_semester: int | None
    birthday: date | None
    underage_manual: bool
    is_new_manual: bool
    next_year: str

def underage_cutoff(school_year: int) -> date            # date(school_year + 1 + 1911 - 3, 9, 1)
def is_underage(f: Facts, school_year: int) -> bool      # 只看生日／手動標記，不檢查年級；有生日時 birthday > cutoff
def is_new(f: Facts, school_year: int) -> bool           # deposit_date 有值，或 enrollment_date >= date(school_year+1911, 8, 1)，或 is_new_manual
def state_on(f: Facts, day: date) -> Literal["enrolled", "pending"] | None   # 規格 §6.3「每位幼生在 D 那天的狀態」
def term_for_date(day: date) -> tuple[int, int]          # 預定入園日 → (入學學年, 學期)，同 academic.current_term

@dataclass(frozen=True)
class Gap:
    enrolled: dict[str, int]; pending_s1: dict[str, int]; pending_s2: dict[str, int]; estimate: dict[str, int]
    promoted: dict[str, int]; leaving: dict[str, int]; repeating: dict[str, int]
    pending_next: dict[str, int]; estimate_next: dict[str, int]
    underage_enrolled: int; underage_pending: int; missing_birthday: int; incomplete: int

def compute_gap(students: Iterable[Facts], *, school_year: int, as_of: date) -> Gap
def achievement(estimate: int, target: int | None) -> int | None      # 四捨五入的整數百分比；target 是 None 或 0 回 None
def signed_gap(estimate: int, target: int | None) -> int | None       # estimate - target
@dataclass(frozen=True)
class TierStatus: reached: Literal["base","boost","top"] | None; next: Literal["base","boost","top"] | None; short: int | None
def tier_status(total: int, base: int | None, boost: int | None, top: int | None) -> TierStatus
```

`compute_gap` 的規則照規格 §6.3 第 1–9 列，另外：
- `grade` 是 None，或預繳未入園而入學學年學期不完整的：不計入任何欄，`incomplete` 加一。
- 入學 `(school_year, 1)` 算 `pending_s1`、`(school_year, 2)` 算 `pending_s2`、`(school_year+1, 1)` 算 `pending_next`（依它自己的 `grade`）；其他入學學年不計。
- 不足齡只對學年內的幼幼班（在籍與 s1、s2 預繳）判定；`missing_birthday` 數的是這批裡沒生日的人。
- `leaving` 的歸欄：中班→大班欄、小班→中班欄、幼幼班不足齡→幼幼班欄、其餘幼幼班→小班欄；大班標 `leave` 不計。`repeating` 只算大班標 `repeat` 的，歸大班欄。
- `tier_status`：`reached` 是 `total` 達到的最高一段；`next` 是還沒到的最低一段，`short = 該段 - total`；三段都是 None 時三個欄位都回 None。

- [ ] **Step 1: 寫失敗的測試**

```python
# backend/tests/test_admissions_roster_calc.py
def renwu() -> list[Facts]:
    """規格 §6.3 驗算基準（仁武 115.11.11），用程式產生、不含真實姓名。
    在籍：大 60、中 59、小 40、幼幼 45（其中 10 位生日 2024-09-02 之後、入園日 2026-09/10 月）
    預繳 (115,1)：幼幼 8；(115,2)：中 1、幼幼 23；幼幼預繳 31 位生日都在 2024-09-02 之後
    預繳 (116,1)：小 4、幼幼 20"""

def test_baseline_matches_excel():
    g = compute_gap(renwu(), school_year=115, as_of=date(2026, 11, 11))
    assert g.enrolled == {"大班": 60, "中班": 59, "小班": 40, "幼幼班": 45}
    assert g.pending_s1 == {"大班": 0, "中班": 0, "小班": 0, "幼幼班": 8}
    assert g.pending_s2 == {"大班": 0, "中班": 1, "小班": 0, "幼幼班": 23}
    assert g.estimate == {"大班": 60, "中班": 60, "小班": 40, "幼幼班": 76}
    assert g.promoted == {"大班": 60, "中班": 40, "小班": 35, "幼幼班": 41}
    assert g.pending_next == {"大班": 0, "中班": 0, "小班": 4, "幼幼班": 20}
    assert g.estimate_next == {"大班": 60, "中班": 40, "小班": 39, "幼幼班": 61}
    assert (g.underage_enrolled, g.underage_pending) == (10, 31)

def test_leaving_and_repeating():           # 兩位中班、一位小班標 leave → estimate_next 58/39/39/61；再一位大班標 repeat → 大班 59
def test_underage_boundary():               # 生日 2024-09-01 不是不足齡；2024-09-02 是（school_year=115）
def test_manual_underage_only_without_birthday():   # 沒生日＋underage_manual=True 算不足齡；有生日 2023-10-01＋underage_manual=True 不算
def test_missing_birthday_counted():        # 幼幼班在籍沒生日 4 位 → missing_birthday == 4，且算升小班
def test_incomplete_pending_excluded():     # grade=None 或 target_semester=None 的預繳 → 不在任何欄，incomplete == 2
def test_next_year_underage_not_judged():   # 入學 (116,1) 的幼幼班預繳、生日 2025-01-01 → 算 pending_next 幼幼班，不進 underage_pending
def test_state_on_history():
    # 入園日 2026-10-05、預繳日 2026-08-20：2026-09-15 是 pending，2026-10-05 起是 enrolled
    # 在籍、入園日 None、離園日 2026-10-03：2026-09-15 是 enrolled，2026-10-03 起是 None
    # 已退預繳、預繳日 2026-09-01、退預繳日 2026-10-12：2026-09-15 是 pending，2026-10-12 起是 None
    # 沒預繳日、入園日 2026-10-01 的在籍：2026-09-15 是 None
def test_achievement_and_signed_gap():      # achievement(39, 44) == 89；achievement(5, None) is None；signed_gap(60, 66) == -6；signed_gap(61, 60) == 1
def test_tier_status():                     # tier_status(236, 220, 230, 240) == TierStatus("boost", "top", 4)；tier_status(250, 220, 230, 240) == TierStatus("top", None, None)；tier_status(100, None, None, None) == TierStatus(None, None, None)
def test_term_for_date():                   # 2026-12-01 → (115, 1)；2027-02-01 → (115, 2)；2027-08-01 → (116, 1)
```

- [ ] **Step 2: 跑測試確認失敗** — `uv run pytest tests/test_admissions_roster_calc.py -q`
- [ ] **Step 3: 實作 `calc.py`**
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `feat(admissions): 缺額統計的計算（回算、不足齡、下學年去向）`

### Task 3: 班級的服務與 API

**Files:**
- Create: `backend/app/admissions/roster/service.py`, `backend/app/admissions/roster/routes.py`, `backend/app/admissions/schemas/roster.py`, `backend/tests/roster_helpers.py`
- Modify: `backend/app/main.py`（`admissions_enabled` 區塊加 `app.include_router(roster_router)`）
- Test: `backend/tests/test_admissions_roster_classes.py`

**Interfaces:**
- Produces（路由前綴 `ROSTER = "/api/website/v1/admin/admissions/roster"`）：
  - `POST {ROSTER}/classes?campus_key=` body `ClassCreate{school_year, grade, name, class_code, english_name?, head_teacher?, assistant_teacher?, english_teacher?, target_seats?}` → 201 `ClassOut`。新班排在該年級最後。
  - `PATCH {ROSTER}/classes/{id}` body `ClassUpdate{...同上皆選填, expected_version}` → `ClassOut`；年級不能改（422）。
  - `DELETE {ROSTER}/classes/{id}?expected_version=` → 204；班上有幼生回 409 `{"code": "ROSTER_CLASS_NOT_EMPTY"}`。
  - `ClassOut{id, campus_key, school_year, grade, name, class_code, english_name, head_teacher, assistant_teacher, english_teacher, target_seats, sort_order, version}`。
  - 錯誤碼：同班序 409 `ROSTER_CLASS_CODE_TAKEN`；版本不符 409 `ROSTER_VERSION_CONFLICT`（帶 `current_version`）；找不到或越權 404。
  - 稽核鍵：`roster_class.create`、`roster_class.update`、`roster_class.delete`（metadata 只放 `grade`、`class_code`、改了哪些欄位名）。
  - `tests/roster_helpers.py`：`ROSTER` 常數、`async def make_class(client, **overrides) -> dict`（預設 yihua、115、大班、班序自動遞增）。

- [ ] **Step 1: 寫失敗的測試**

```python
async def test_create_class_appends_in_grade(reception_yihua_client)      # 連建大1、大2 → sort_order 遞增
async def test_duplicate_class_code_conflict(...)                         # 409 ROSTER_CLASS_CODE_TAKEN
async def test_update_class_fields_and_version(...)                       # 改 head_teacher、target_seats；version +1；舊版本再送 → 409 ROSTER_VERSION_CONFLICT
async def test_grade_cannot_change(...)                                   # PATCH 帶 grade → 422
async def test_target_seats_null_vs_zero(...)                             # None 與 0 都能存，回傳分得出來
async def test_delete_empty_class(...) / test_delete_class_with_students_conflict(...)
async def test_other_campus_is_404(...)                                   # 義華帳號操作 renwu 的班 → 404
async def test_routes_absent_when_admissions_disabled(...)                # 照 test_admissions_funnel.py 既有的關閉開關測試寫法
async def test_audit_has_no_teacher_names(...)                            # AuditLogEntry.metadata 不含 head_teacher 的值
```
- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作**。`service.py` 產出 `create_class`、`update_class`、`delete_class`、`get_class_for_update`（`SELECT … FOR UPDATE`）；`routes.py` 照 `backend/app/admissions/routes.py` 的寫法（`_require_campus`、`audit_service.log_action`、最後 `db.commit()`）。
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `feat(admissions): 編班表的班級 API`

### Task 4: 幼生的新增、編輯與移動

**Files:**
- Modify: `backend/app/admissions/roster/service.py`, `routes.py`, `schemas/roster.py`, `backend/tests/roster_helpers.py`
- Test: `backend/tests/test_admissions_roster_students.py`

**Interfaces:**
- Consumes: Task 1 的 `RosterStudent`、Task 2 的 `term_for_date`、Task 3 的 `get_class_for_update`。
- Produces:
  - `POST {ROSTER}/students?campus_key=` body `StudentsCreate{school_year, names: list[str], class_id?: UUID, pending?: PendingFields}`，`PendingFields{grade, target_school_year, target_semester, deposit_date, planned_entry_date?, birthday?}` → 201 `{"students": [StudentOut], "duplicates": [str]}`。
    - 有 `class_id`、沒有 `pending`：建在籍，排在該班最後，`enrollment_date` 為空。
    - 有 `pending`：建預繳未入園，存的 `school_year` 用 `pending.target_school_year`（不是 body 的 `school_year`；在 115 的頁面補登 116上預繳時兩者不同）。`pending.target_school_year` 只能是 body 的 `school_year` 或它加一，且加一時學期必須是 1，否則 422。`class_id` 有給就排進那班（班級學年要等於 `target_school_year`，否則 422）；沒給就是還沒編班。`birthday` 只在 `names` 只有一筆時接受（多筆又帶生日 → 422）。
    - 兩者都沒有 → 422。
    - `names` 清理：每筆去頭尾空白、略過空字串；清理後 0 筆 → 422；任一筆超過 50 字 → 422 `{"code": "ROSTER_NAME_TOO_LONG", "line": <第幾行，1 起算>}` 且一筆都不建。一次最多 60 筆。
    - `duplicates`：這批裡和同校同學年現有預繳未入園或在籍幼生同名、或批內重複的姓名（照樣建立）。
  - `PATCH {ROSTER}/students/{id}` body `StudentUpdate{child_name?, birthday?, note?, enrollment_date?, planned_entry_date?, deposit_date?, target_school_year?, target_semester?, grade?, is_special_education?, is_indigenous?, is_new_manual?, underage_manual?, next_year?, expected_version}` → `StudentOut`。
    - 填了 `planned_entry_date` 就用 `term_for_date` 覆寫入學學年學期。
    - `birthday` 有值時把 `underage_manual` 設回 False。
    - `grade` 只有還沒編班的能改；`enrollment_date` 只有在籍的能改；`planned_entry_date`、`deposit_date`、入學學年學期只有預繳未入園的能改。違反 → 422。
    - `next_year='repeat'` 只有大班可以、`'leave'` 大班不可以 → 422。
  - `POST {ROSTER}/students/{id}/move` body `{class_id: UUID | None, position: int, expected_version}` → `StudentOut`。`class_id=None` 只有預繳未入園的可以（在籍 → 409 `ROSTER_ENROLLED_NEEDS_CLASS`）。`position` 超過班上人數就排最後。跨年級移動時 `next_year` 重設 `'continue'`，移出幼幼班時 `underage_manual` 設 False。已離園、已退預繳的不能移（409）。
  - `StudentOut{id, campus_key, school_year, class_id, position, grade, child_name, birthday, note, status, enrollment_date, planned_entry_date, deposit_date, left_date, refunded_date, target_school_year, target_semester, is_special_education, is_indigenous, is_new_manual, underage_manual, next_year, from_funnel, version, is_new: bool, is_underage: bool | None, board_notice: Literal["deposit_removed","enrolled"] | None}`。`grade` 一律回實際年級（有班級時是班級的年級）。`is_underage` 只有學年內的幼幼班才有值，其餘 None。`board_notice` 這個任務先一律 None（Task 7 補）。
  - 班內順序：同班 `position` 從 0 連續編號。移動時在同一個交易裡鎖來源班與目的班的 `roster_classes` 列（依 id 排序上鎖避免死結），再重排受影響的幼生。
  - 稽核鍵：`roster_student.create`（metadata `{"count": n, "status": ...}`）、`roster_student.update`（改了哪些欄位名）、`roster_student.move`。
  - `tests/roster_helpers.py` 加 `add_students(client, class_id, names)`、`add_pending(client, **fields)`。

- [ ] **Step 1: 寫失敗的測試**

```python
async def test_bulk_add_enrolled_appends_in_order(...)        # 貼三位 → position 0,1,2，status enrolled，enrollment_date None
async def test_dirty_paste(...)                               # ["  測試甲 ", "", "測試甲", "測試乙\t"] → 建 3 位（空行略過、空白修掉），duplicates == ["測試甲"]
async def test_name_too_long_rejects_whole_batch(...)         # 第 2 行 51 字 → 422 ROSTER_NAME_TOO_LONG line == 2，資料庫 0 筆
async def test_add_pending_unassigned_and_assigned(...)       # 沒 class_id → class_id None、grade 照送的；有 class_id → 排進班
async def test_pending_class_year_must_match_target(...)      # 班級學年 115、target_school_year 116 → 422
async def test_planned_entry_date_sets_term(...)              # PATCH planned_entry_date=2027-02-01 → target (115, 2)
async def test_birthday_clears_manual_underage(...)
async def test_field_rules_by_status(...)                     # 在籍改 deposit_date → 422；預繳改 enrollment_date → 422；已編班改 grade → 422
async def test_next_year_rules(...)                           # 大班 leave → 422；中班 repeat → 422
async def test_move_between_classes_and_reorder(...)          # A 班 [a,b,c]、B 班 [x]：b 移到 B 的 position 0 → A [a,c]（0,1）、B [b,x]；同班 c 移到 0 → [c,a]
async def test_move_cross_grade_resets_next_year(...)
async def test_enrolled_cannot_unassign(...)                  # class_id None → 409 ROSTER_ENROLLED_NEEDS_CLASS
async def test_stale_version_and_missing_class(...)           # 舊 expected_version → 409 ROSTER_VERSION_CONFLICT；目的班已刪 → 404
async def test_concurrent_moves_keep_positions_dense(...)     # 真 PostgreSQL：同班 6 位，兩個連線同時各移一位到 position 0 → 兩個都成功，position 是 0..5 不重複不缺
```
最後一個照 `backend/tests/admissions_helpers.py` 的排隊並發寫法（`asyncio.gather` 兩個 client）。

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作** `create_students`、`update_student`、`move_student`、`get_student_for_update` 與三支路由。
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `feat(admissions): 編班表幼生的新增、編輯與拖拉移動`

### Task 5: 已入園、離園、退預繳、恢復

**Files:**
- Modify: `backend/app/admissions/roster/service.py`, `routes.py`, `schemas/roster.py`
- Test: `backend/tests/test_admissions_roster_status.py`

**Interfaces:**
- Produces（body 都帶 `expected_version`，回 `StudentOut`）：
  - `POST {ROSTER}/students/{id}/enter` `{enrollment_date?: date}`：預繳未入園且已編班 → 在籍；日期預設今天，不能晚於今天。還沒編班 → 409 `ROSTER_NEEDS_CLASS`。
  - `POST …/leave` `{left_date?: date}`：在籍 → 已離園；清掉 `class_id`、`position`，把原年級寫進 `grade`，原班其餘幼生補位。
  - `POST …/refund` `{refunded_date?: date}`：預繳未入園 → 已退預繳；同樣清班級並保留年級。
  - `POST …/restore` `{class_id?: UUID}`：已退預繳 → 預繳未入園、還沒編班（忽略 `class_id`）；已離園 → 在籍，`class_id` 必填並排在該班最後，`left_date` 清掉。
  - 狀態不符的動作一律 409 `ROSTER_STATUS_INVALID`。
  - 稽核鍵：`roster_student.enter`、`roster_student.leave`、`roster_student.refund`、`roster_student.restore`。

- [ ] **Step 1: 寫失敗的測試**

```python
async def test_enter_sets_today_and_keeps_deposit_date(...)
async def test_enter_requires_class(...)                    # 409 ROSTER_NEEDS_CLASS
async def test_enter_rejects_future_date(...)               # 422
async def test_leave_clears_class_and_closes_gap(...)       # [a,b,c] 的 b 離園 → a,c 的 position 是 0,1；b 的 grade 是原年級、class_id None
async def test_refund_then_restore_goes_unassigned(...)
async def test_restore_left_needs_class(...)                # 沒給 class_id → 422；給了 → 在籍、排最後
async def test_invalid_transitions(...)                     # 在籍 refund、預繳 leave、已離園 enter → 409 ROSTER_STATUS_INVALID
async def test_refunded_visit_can_get_new_student(...)      # 同一 recruitment_visit_id：舊的退預繳後可以再建一筆 pending（部分唯一索引）
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**
- [ ] **Step 5: Commit** — `feat(admissions): 編班表的已入園、離園、退預繳與恢復`

### Task 6: 讀取整張編班表、缺額統計、三段目標、結算紀錄

**Files:**
- Modify: `backend/app/admissions/roster/service.py`, `routes.py`, `schemas/roster.py`
- Test: `backend/tests/test_admissions_roster_view.py`

**Interfaces:**
- Consumes: Task 2 的 `compute_gap`、`achievement`、`signed_gap`、`tier_status`；`GradeIntakeTarget`（讀 `(school_year+1, 1)`）。
- Produces:
  - `GET {ROSTER}?campus_key=&school_year=&as_of=` → `RosterOut`：

```python
class GapBlockOut(BaseModel):
    rows: dict[str, dict[str, int]]         # 列鍵 → 年級 → 人數；另含 "total" 鍵
    targets: dict[str, int | None]          # 年級 → 目標；全部沒設定時 total 為 None
    achievement: dict[str, int | None]      # 含 "total"
    gap: dict[str, int | None]              # 含 "total"；正的是超額
    tier: TierOut                           # {base, boost, top, reached, next, short}
class RosterOut(BaseModel):
    campus_key: str; school_year: int; today: date; as_of: date
    classes: list[ClassWithStudentsOut]     # ClassOut + students: list[StudentOut]（依 position）+ count + gap（班上人數 - target_seats，沒目標 None）
    unassigned: list[StudentOut]            # 預繳未入園、沒班級、所屬學年 = school_year
    next_year: list[StudentOut]             # 預繳未入園、入學 (school_year+1, 1)
    gone: list[StudentOut]                  # 已離園、已退預繳（依日期新到舊）
    grade_totals: dict[str, GradeTotalOut]  # 年級 → {count, returning, new, pending}（只算排進班級的）
    current: GapBlockOut                    # 列鍵：enrolled, pending_s1, pending_s2, estimate
    next: GapBlockOut                       # 列鍵：promoted, leaving, repeating, pending_next, estimate_next
    underage_enrolled: int; underage_pending: int; missing_birthday: int; incomplete: int
    snapshots: list[SnapshotOut]            # {id, as_of, enrolled: dict, total_enrolled, estimate_total, created_at}
```
    - `as_of` 預設今天；晚於今天或早於 `date(school_year+1911, 8, 1)` → 422 `ROSTER_AS_OF_OUT_OF_RANGE`。
    - `current.targets`＝該年級各班 `target_seats` 加總（沒有任何一班設定時 None）；`next.targets` 讀 `grade_intake_targets` 的 `(school_year+1, 1)`。
    - `total` 的 `achievement`、`gap` 要四個年級都有目標才有值。
    - `current.tier` 讀 `(school_year, 2)`、`next.tier` 讀 `(school_year+1, 1)`，比的是各自的合計預估。
    - 名單（classes、unassigned、next_year、gone）永遠是現在的狀態；只有 `current`、`next` 與 underage 幾個數字跟著 `as_of` 回算。
  - `PUT {ROSTER}/tier-targets?campus_key=` body `{school_year, semester, base: int|None, boost: int|None, top: int|None}`（0–9999）→ `TierOut`。
  - `POST {ROSTER}/snapshots?campus_key=` body `{school_year, as_of, overwrite: bool = False}` → 201 `SnapshotOut`；同一天已有且 `overwrite` 是 False → 409 `ROSTER_SNAPSHOT_EXISTS`。`payload` 存 `{enrolled, pending_s1, pending_s2, estimate_total}`。
  - 下學年年級目標沿用既有的 `PUT /admin/admissions/intake-targets`，這個任務不新增端點。
  - 稽核鍵：`roster_tier.update`、`roster_snapshot.create`。

- [ ] **Step 1: 寫失敗的測試**

```python
async def test_empty_roster_shape(...)                      # 沒資料：classes []、四個年級都是 0、targets 全 None、snapshots []
async def test_view_matches_calc_baseline(...)              # 用 helper 建規格 §6.3 的仁武資料（虛構姓名）→ current.rows["estimate"]["total"] == 236、next.rows["estimate_next"]["total"] == 200
async def test_class_targets_sum_to_grade_target(...)       # 大班三班 22/22/None → current.targets["大班"] == 44；三班都 None → None；total gap 只在四個年級都有時出現
async def test_next_targets_from_intake_targets(...)        # 用既有 intake-targets API 設 (116,1) → next.targets
async def test_class_gap_sign(...)                          # 18 人、目標 22 → gap -4；16 人、目標 16 → 0；17 人、目標 16 → 1
async def test_grade_totals_new_vs_returning(...)
async def test_as_of_recomputes_counts_not_lists(...)       # as_of=2026-09-15：10 月入園的不算在籍；classes 內容與今天相同
async def test_as_of_out_of_range(...)                      # 明天 → 422；2026-07-31（學年 115）→ 422
async def test_tier_targets_roundtrip_and_status(...)       # 設 (115,2) 220/230/240、預估 236 → reached "boost"、next "top"、short 4
async def test_snapshot_create_conflict_overwrite(...)      # 第二次同日 → 409；overwrite → 201 且只剩一筆
async def test_snapshot_is_frozen(...)                      # 存檔後再新增幼生 → 快照數字不變
async def test_next_year_list_and_unassigned_split(...)     # 入學 (116,1) 只在 next_year；(115,2) 沒班級只在 unassigned；(116,2) 兩邊都不在
async def test_view_requires_read_scope(...)                # 其他校帳號 404
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**。一次查出該校該學年的班級與幼生（加上 `target_school_year = school_year+1` 的預繳），在程式裡組 `Facts` 交給 `compute_gap`，不要在 SQL 裡重寫算法。
- [ ] **Step 5: Commit** — `feat(admissions): 編班表讀取、缺額統計、三段目標與結算紀錄`

### Task 7: 看板 → 編班表的同步與提醒

**Files:**
- Create: `backend/app/admissions/roster/sync.py`
- Modify: `backend/app/admissions/funnel.py`（`transition()` 的 `await db.flush()` 之前呼叫）、`backend/app/admissions/roster/service.py`（`StudentOut.board_notice`）
- Test: `backend/tests/test_admissions_roster_sync.py`

**Interfaces:**
- Consumes: `funnel.derive_stage`、`RecruitmentVisit`、`academic.current_term`。
- Produces:
  - `async def on_stage_changed(db: AsyncSession, visit: RecruitmentVisit, *, from_stage: str, to_stage: str, today: date) -> None`：只在 `to_stage == "deposited"` 且 `from_stage in ("visited", "withdrawn")` 時動作。
    1. 該 visit 已有預繳未入園或在籍的幼生 → 什麼都不做。
    2. 否則找可認領的補登幼生：同 `campus_key`、`child_name` 相同、`recruitment_visit_id IS NULL`、`from_funnel` 是 False、狀態預繳未入園；剛好一筆，且（兩邊生日相同，或至少一邊是空的）→ 把 `recruitment_visit_id` 與 `from_funnel=True` 寫上去，它沒有生日就補上 visit 的生日。
    3. 否則新增：`status='pending'`、沒班級、`child_name`、`birthday`、`grade = visit.provisional_grade or visit.grade`、入學學年學期照 visit、`school_year = visit.target_school_year or current_term(today)[0]`、`deposit_date = today`、`from_funnel=True`。
  - `funnel.transition` 在既有流程最後呼叫它（`today` 用 `today_local()`）。`enrolled → deposited`（取消註冊）不觸發。
  - `board_notice`（讀取時算）：幼生 `from_funnel`、狀態預繳未入園時，來源 visit 不存在（已刪）或階段是 `visited`、`withdrawn` → `"deposit_removed"`；階段是 `enrolled` → `"enrolled"`；其餘 None。
  - 編班表的任何動作都不寫 `recruitment_visits`。

- [ ] **Step 1: 寫失敗的測試**（用 `tests/admissions_helpers.py` 的 `create_record`、`transition`）

```python
async def test_deposit_creates_unassigned_pending(...)        # visited→deposited：編班表多一位，欄位照 visit，deposit_date 是今天
async def test_missing_grade_and_term_still_created(...)      # visit 沒 grade、沒 target → 照建，school_year 是今天所在學年；GET 的 incomplete == 1 且不在任何統計欄
async def test_back_and_forth_does_not_duplicate(...)         # deposited→visited→deposited 三次 → 仍只有一位；中間在 visited 時 board_notice == "deposit_removed"
async def test_withdraw_then_cancel(...)                      # 看板退預繳 → notice deposit_removed；編班表按退預繳；看板取消退出回已預繳 → 新增第二位 pending，舊的那筆仍是 refunded
async def test_claims_backfilled_student(...)                 # 先補登「測試甲」（無生日）；看板同名 visit（有生日）轉預繳 → 不新增，補登那位掛上來源並補了生日
async def test_claim_skipped_when_ambiguous(...)              # 補登兩位同名，或生日不同 → 照常新增
async def test_board_enrolled_notice(...)                     # 看板轉已註冊 → notice "enrolled"，編班表狀態不變
async def test_deleted_visit_notice(...)                      # 刪掉 visit → recruitment_visit_id 變 None、from_funnel 仍 True、notice deposit_removed
async def test_roster_actions_do_not_touch_visit(...)         # 編班表 enter／refund 後 visit.version 與 has_deposit 不變
async def test_existing_funnel_tests_still_pass               # 不寫新測試：跑 uv run pytest tests/test_admissions_funnel.py -q
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**
- [ ] **Step 5: 跑整個招生相關測試** — `uv run pytest tests -q -k admissions`，預期全過。
- [ ] **Step 6: Commit** — `feat(admissions): 看板轉預繳自動進編班表，並提示看板後續異動`

---

## 階段 B：前端

### Task 8: 合約、API 封裝與純函式

**Files:**
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（由指令產生）、`admin/src/api/auditLabels.ts`、`admin/src/style.css`
- Create: `admin/src/api/roster.ts`, `admin/src/admissions/roster.ts`
- Test: `admin/src/__tests__/admissionsRosterHelpers.test.ts`、`admin/src/__tests__/admissionsRosterApi.test.ts`

**Interfaces:**
- Consumes: Task 3–7 的端點與 schema（型別從 `contracts/generated/website-api.d.ts` 取，寫法照 `admin/src/api/admissions.ts`）。
- Produces:
  - `admin/src/api/roster.ts`：型別別名 `Roster`、`RosterClass`、`RosterStudent`、`GapBlock`、`Tier`；函式 `getRoster(campusKey, schoolYear, asOf?)`、`createClass`、`updateClass`、`deleteClass`、`createStudents`、`updateStudent`、`moveStudent`、`enterStudent`、`leaveStudent`、`refundStudent`、`restoreStudent`、`saveTierTargets`、`createSnapshot`、`saveNextYearTargets(campusKey, schoolYear, targets)`（打既有的 `PUT /admin/admissions/intake-targets`，固定送 `school_year: schoolYear + 1, semester: 1`；`admin/src/api/admissions.ts` 在 10-05 的 `55c9d68f` 拿掉了舊的 `saveIntakeTargets`，body 格式看 `backend/app/admissions/schemas/records.py` 的 `IntakeTargetsRequest`）。
  - `admin/src/admissions/roster.ts`：

```ts
export const GRADE_ORDER = ['大班', '中班', '小班', '幼幼班'] as const
export type Mark = 'underage' | 'sped' | 'indigenous' | 'new' | null
export function markOf(s: RosterStudent): Mark           // 優先順序：is_underage → is_special_education → is_indigenous → is_new
export function planText(iso: string, today: string): string   // 同年 '12/1'；跨年 '116/2/1'
export function sideParts(s: RosterStudent, grade: string, today: string, schoolYear: number): { text: string; labels: string[] }
//   text：預繳未入園 → 預定入園日的 planText，沒有就備註，都沒有「未定」；在籍且入園日晚於 (schoolYear+1911)-08-31 → 'M/D'；其餘 ''
//   labels 依序：'不足齡'｜'缺生日'（幼幼班、is_underage 為 false 且沒生日）、'特教'、'原民'、'不讀'（非大班 next_year=leave）、'重讀'（大班 next_year=repeat）、'看板已退預繳'、'看板已註冊'
export function gapText(v: number | null): { kind: 'none' | 'short' | 'full' | 'over'; text: string }
//   null → {none,'—'}；負 → {short,'−n'}；0 → {full,'額滿'}；正 → {over,'＋n'}
export function tierText(t: Tier): string
//   '已達激勵目標，離超越目標還差 4 人'；reached 為 null 且 next 有值 → '還沒到基礎目標，離基礎目標還差 n 人'；三段都沒設定 → ''
export function rocDate(iso: string): string             // '115.11.15'
```
  - `style.css` 新增 token：`--roster-grade-1`…`-4`（大班淡綠、中班淡藍、小班淡粉、幼幼班淡黃）、`--roster-pending-bg`（淡灰）、`--roster-mark-new`（綠）、`--roster-mark-underage`（橘）、`--roster-mark-sped`（紫）、`--roster-mark-indigenous`（藍）。數值照示意頁 `:root` 裡的 `--g-da`、`--g-zhong`、`--g-xiao`、`--g-you`、`--pending-bg`、`--mk-green`、`--mk-orange`、`--mk-purple`、`--mk-blue`。
  - `auditLabels.ts`：把 Task 3–7 列的十一個 `roster_*` 稽核鍵歸進招生類，各給一句中文標籤。

- [ ] **Step 1: 產生合約** — `npm run contract:generate`，確認 diff 只多了 roster 相關路徑。
- [ ] **Step 2: 寫失敗的測試**

```ts
// admissionsRosterHelpers.test.ts
it('字色優先順序：不足齡 > 特教生 > 原住民 > 新生')            // 四個旗標全開 → 'underage'；關掉不足齡 → 'sped'…
it('planText：同年 12/1、跨年 116/2/1')                        // planText('2026-12-01','2026-11-15') === '12/1'；planText('2027-02-01','2026-11-15') === '116/2/1'
it('sideParts：預繳沒日期用備註、都沒有是未定')
it('sideParts：開學後才入園的在籍顯示入園日，8/3 入園的不顯示')
it('sideParts：幼幼班沒生日顯示缺生日，其他年級不顯示')
it('sideParts：大班 leave 不顯示不讀、中班 repeat 不顯示重讀')
it('gapText：-6 → −6、0 → 額滿、1 → ＋1、null → —')
it('tierText 三種情況')
// admissionsRosterApi.test.ts：照 admissionsApi.test.ts 的寫法，各函式打對路徑、方法、query 與 body
```
- [ ] **Step 3: 跑測試確認失敗** — `npm --prefix admin run test:unit -- admissionsRoster`
- [ ] **Step 4: 實作**，再跑測試與 `npm --prefix admin run typecheck` 確認通過（auditLabels 的既有測試也要過）。
- [ ] **Step 5: Commit** — `feat(admin): 編班表的 API 封裝、顯示用純函式與色彩 token`

### Task 9: 分頁與編班表（唯讀顯示）

**Files:**
- Create: `admin/src/components/admissions/roster/RosterTab.vue`, `RosterTable.vue`
- Modify: `admin/src/admissions/useAdmissionsFilters.ts`（`ADMISSIONS_TABS = ['funnel','records','roster']`）、`admin/src/views/AdmissionsView.vue`（加 `<el-tab-pane label="編班與缺額" name="roster" />` 與 lazy 載入）、`admin/src/components/admissions/AdmissionsFilterBar.vue`（加 prop `hideSemester?: boolean`，為真時不顯示學期選單）
- Test: `admin/src/__tests__/admissionsRosterTable.test.ts`、補 `admin/src/__tests__/admissionsView.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `getRoster`、`markOf`、`sideParts`、`gapText`。
- Produces:
  - `RosterTab.vue` props `{ campusKey: string; schoolYear: number | null }`。`schoolYear` 是 null（不限學年）時顯示「請先選一個學年」。持有 `roster` 資料與 `asOf`，提供 `reload()`；子元件用事件回報要做的動作，由它呼叫 API 後 `reload()`。卡片上方兩個切換鈕「編班表」「預繳名單 n」（n＝所有預繳未入園人數）。
  - `RosterTable.vue` props `{ roster: Roster; canWrite: boolean }`，emits `open-student(id, anchorEl)`、`edit-student(id)`、`edit-class(id)`、`move(id, classId | null, position)`、`add(classId, names: string[])`、`set-class-target(classId, value | null)`。
  - DOM 約定（測試與 e2e 用）：表格 `table.roster-table`；姓名格 `td[data-class-id][data-index]` 內 `button.roster-kid[data-student-id]`；班級表頭 `th[data-class-id]`；還沒編班那一列 `[data-roster-tray]`；最右欄姓名 `.roster-next [data-student-id]`。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('網址 tab=roster 顯示編班與缺額分頁，學期選單隱藏')
it('表頭四列：班級、班導、副班導、美師；年級順序大中小幼')
it('列數至少 31，某班 35 人時是 36 列')
it('姓名字色 class 依 markOf；預繳未入園的兩格有 is-pending')
it('備註欄顯示 sideParts 的文字與小標記')
it('表尾：各班合計、目標輸入框、缺額文字、年級總計含舊生新生、全園總計含還沒編班人數')
it('最右欄寫成 姓名(幼)，不可拖拉（沒有 draggable）')
it('還沒編班的預繳生列出姓名、班別、入園時段；缺年級的標「缺班別」、缺入學學期的標「缺入學學期」')
it('沒有 admissions.write 時沒有輸入框、沒有 draggable')
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**。版型、欄寬（列標題 56、姓名 86、備註 104、最右欄 128）、固定表頭與固定首欄照示意頁的 `.rt` 樣式，字級用 token。
- [ ] **Step 5: 在 dev server 看畫面** — 依 `docs/website-admin/README.md` 起 backend（開 `WEBSITE_ADMISSIONS_ENABLED`）與 admin，用 API 建幾個班與幼生，Playwright 截 1440 與 390 兩張圖確認和示意頁一致、頁面沒有水平捲軸。
- [ ] **Step 6: Commit** — `feat(admin): 招生入學新增編班與缺額分頁與編班表顯示`

### Task 10: 編班表的操作（格內新增、拖拉、選單）

**Files:**
- Create: `admin/src/components/admissions/roster/StudentMenu.vue`
- Modify: `RosterTable.vue`, `RosterTab.vue`
- Test: `admin/src/__tests__/admissionsRosterActions.test.ts`

**Interfaces:**
- Consumes: Task 8 的 API 函式；Task 9 的事件。
- Produces:
  - 格內新增：點班級最後一格空白出現輸入框；Enter 送出並停在下一格；貼上含換行或 Tab 的文字一次送多筆；Esc 或失焦且空白就收起。回應的 `duplicates` 不是空的時跳提醒「已有同名幼生：○○」。
  - 拖拉：沿用 `FunnelBoard.vue` 的原生 HTML5 drag and drop 寫法。放到姓名格＝該班該列；放到班級表頭＝排最後；放到 `[data-roster-tray]`＝移回還沒編班。成功後顯示可「復原」的提示（復原＝再呼叫一次 `moveStudent` 移回原班原位置）。
  - `StudentMenu.vue` props `{ student: RosterStudent; classLabel: string; classes: RosterClass[] }`，emits `enter`、`edit`、`move(classId)`、`leave`、`refund`。內容照規格 §8.1「點姓名開選單」。離園、退預繳先跳確認框（`ElMessageBox.confirm`）。
  - 錯誤處理：409 `ROSTER_VERSION_CONFLICT` 與 404 → 提示「資料剛被其他人更新，已重新載入」並 `reload()`；`ROSTER_ENROLLED_NEEDS_CLASS` → 「在籍幼生不能放回還沒編班，要離園請點姓名」。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('Enter 新增一位後輸入框移到下一格')
it('貼上三行文字呼叫一次 createStudents，names 是三筆')
it('回應有 duplicates 時顯示同名提醒')
it('拖到別班第 2 列：moveStudent(id, 目的班, 1)')
it('拖到班級表頭：position 是該班人數')
it('在籍幼生拖到還沒編班：不呼叫 API，顯示提示')
it('復原：再呼叫 moveStudent 回原班原位置')
it('選單：預繳且已編班才有「已入園」；在籍顯示「離園」、預繳顯示「退預繳」')
it('離園要先確認，取消就不呼叫 API')
it('版本衝突：顯示提示並重新載入')
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**
- [ ] **Step 5: Commit** — `feat(admin): 編班表的格內新增、拖拉與幼生選單`

### Task 11: 對話框與預繳名單

**Files:**
- Create: `admin/src/components/admissions/roster/StudentDialog.vue`, `ClassDialog.vue`, `DepositDialog.vue`, `DepositList.vue`
- Modify: `RosterTab.vue`
- Test: `admin/src/__tests__/admissionsRosterDialogs.test.ts`

**Interfaces:**
- Produces:
  - `StudentDialog.vue`（編輯資料）：欄位與可否編輯照規格 §8.1 與 Task 4 的欄位規則；自動認定的新生、有生日的不足齡勾選框 disabled；下學年選單大班是「畢業／重讀大班」、其他是「續讀／不讀」；入學 `(Y+1,1)` 的幼生顯示「○○ 學年的班別」而不是入學學期。
  - `ClassDialog.vue`（新增與修改班級）：年級（修改時 disabled）、班序、班級名稱、英文班名、班導、副班導、美師、目標人數；修改模式下班上沒人才顯示「刪除班級」。
  - `DepositDialog.vue`（補登預繳）：姓名多行輸入、入學時段三選一（`(Y,1)`、`(Y,2)`、`(Y+1,1)`）、班別、預繳日期、預定入園日（選填）、生日（只有一行姓名時可填）。
  - `DepositList.vue`：三組 × 四個年級，每列姓名、預繳日期、不足齡標記、班序或「未編班」；最下方收合的「已離園、已退預繳（n）」清單，每位有「恢復」；已離園的恢復要先選班。
  - 點表格備註欄與選單的「編輯資料」開 `StudentDialog`；點班級表頭開 `ClassDialog`。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('編輯在籍幼生：有入園日欄，沒有預定入園日與預繳日期')
it('編輯預繳幼生：填預定入園日後送出的 body 有 planned_entry_date，沒有 target_semester')
it('有生日的幼幼班：不足齡勾選 disabled 且依 is_underage 打勾')
it('大班的下學年選項是 畢業／重讀大班')
it('補登預繳：三行姓名時生日欄 disabled；送出 names 三筆與 pending 欄位')
it('補登 116上：target 是 (schoolYear+1, 1)')
it('新增班級送出的欄位；修改時年級 disabled；班上有人不顯示刪除')
it('預繳名單三組的人數與分欄；已退預繳按恢復呼叫 restoreStudent；已離園要先選班')
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**
- [ ] **Step 5: Commit** — `feat(admin): 編班表的編輯資料、班級、補登預繳與預繳名單`

### Task 12: 缺額統計、統計日期、三段目標、結算紀錄

**Files:**
- Create: `admin/src/components/admissions/roster/GapTable.vue`, `SnapshotList.vue`
- Modify: `RosterTab.vue`
- Test: `admin/src/__tests__/admissionsRosterGap.test.ts`

**Interfaces:**
- Consumes: `Roster.current`、`Roster.next`、`tierText`、`gapText`、Task 8 的 `saveTierTargets`、`createSnapshot`、`saveNextYearTargets`。
- Produces:
  - `GapTable.vue` props `{ roster: Roster; canWrite: boolean }`，emits `change-as-of(date)`、`save-next-target(grade, value | null)`、`save-tier(block: 'current' | 'next', {base, boost, top})`、`snapshot()`。列的順序、列首符號與文字照示意頁；`leaving` 列的數字前面加「−」。Y(下) 的目標是唯讀數字並註明「各班目標加總」；(Y+1)(上) 的目標與兩區塊的三段目標是輸入框，失焦時才送出。
  - 統計日期控制：日期輸入（`min` 是該學年 8/1、`max` 是今天）、「今天」、「9/15 結算日」（今天 ≥ 該學年 9/15 才顯示）、「3/15 結算日」（今天 ≥ 隔年 3/15 才顯示）、「存成結算紀錄」。`as_of` 不是今天時表格下方顯示回算說明。
  - 表格下方的說明句：不足齡定義與人數；`missing_birthday > 0` 時加「還有 n 位幼幼班幼生沒填生日，暫時算可以升小班。」；`incomplete > 0` 時加「有 n 位預繳生缺班別或入學學期，還沒算進來。」
  - `SnapshotList.vue`：結算日（民國）、四個年級在籍、在籍合計、這學期預估、存檔時間。存檔遇 409 `ROSTER_SNAPSHOT_EXISTS` 先確認再帶 `overwrite: true` 重送。

- [ ] **Step 1: 寫失敗的測試**

```ts
it('兩個區塊的列順序與列首符號')
it('Y(下) 目標是文字、(Y+1)(上) 目標是輸入框')
it('缺額文字：−6、額滿、＋1、—；合計在有年級沒目標時是 —')
it('三段目標文字與輸入框；失焦送出 saveTierTargets')
it('改統計日期：emit change-as-of；RosterTab 帶 as_of 重新讀取')
it('9/15 結算日按鈕：今天是 2026-09-10 時不顯示、2026-11-15 時顯示')
it('回算時顯示說明句；今天不顯示')
it('missing_birthday 與 incomplete 的提醒句')
it('存結算紀錄遇 409：確認後帶 overwrite 重送')
```
- [ ] **Step 2–4: 失敗 → 實作 → 通過**
- [ ] **Step 5: 跑前端全套** — `npm --prefix admin run test:unit`、`npm --prefix admin run typecheck`，預期全過。
- [ ] **Step 6: Commit** — `feat(admin): 缺額統計、統計日期回算、三段目標與結算紀錄`

---

## 階段 C：整合

### Task 13: stack e2e、文件與總驗證

**Files:**
- Create: `tests/stack/admissions-roster.spec.ts`
- Modify: `README.md`（頂部加日期段落）、`DESIGN.md`（招生入學章節加「編班與缺額（2026-11-15）」：用字、字色優先順序、缺額正負號、不做的項目）、`docs/website-admin/acceptance.md`（補一段狀態）

- [ ] **Step 1: 寫 e2e**（照 `tests/stack/admissions-flow.spec.ts` 的登入、建資料與資料庫隔離寫法；先讀 `tests/stack/api.ts`、`db.ts`）。一條主流程：
  1. 新增班級「測試班(幼9)」、目標 16。
  2. 在格內貼上三個虛構姓名 → 該班合計 3、缺額「−13」。
  3. 到漏斗看板把一張幼幼班卡片拖到「已預繳」→ 回編班與缺額，還沒編班出現那位。
  4. 把他拖進測試班 → 合計 4；缺額統計「預繳生」列多 1。
  5. 點姓名 →「已入園」→ 目前在籍多 1、預繳少 1、預估不變。
  6. 統計日期改成昨天 → 在籍比今天少 1；按「存成結算紀錄」→ 清單多一列。
  7. 手機寬 390：頁面沒有水平捲軸、選單裡有「移到其他班級」。
- [ ] **Step 2: 跑 e2e** — `npm run e2e:build && E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run test:e2e:stack -- admissions-roster`（埠號避開其他 session；資料庫名稱含 `test`）。預期通過。
- [ ] **Step 3: 跑相關的既有 e2e** — `npm run test:e2e:stack -- admissions-flow admissions-withdraw`，確認看板流程沒被同步掛勾弄壞。
- [ ] **Step 4: 後端全套** — `cd backend && uv run pytest -q`（長測試：不要在跑的時候改原始碼；超過 10 分鐘沒有輸出要注意是不是卡住）。預期全過。
- [ ] **Step 5: 合約與型別** — `npm run contract:check`、`npm --prefix admin run typecheck`、`npm --prefix web run typecheck`、`npm run test:website`。
- [ ] **Step 6: 個資檢查** — `git diff origin/main --stat` 後對 diff 搜尋：`git diff origin/main | grep -nE "原住民|特教" | grep -i "metadata\|log"` 應為空；確認測試與 fixture 的姓名都是「測試○」這類虛構字串。
- [ ] **Step 7: 寫文件並 commit** — `docs: 記錄招生入學編班與缺額分頁`
- [ ] **Step 8: 上線前要回報給業主的事（只查、不改）**：
  - 正式站 `grade_intake_targets` 有沒有 `(116, 1)` 的舊列（會直接顯示成下學年目標）。查詢走 Railway 的唯讀方式，結果列給業主。
  - 這次 migration 只新增四張表，不需要部署前備份閘門；正式站 `WEBSITE_ADMISSIONS_ENABLED` 的現況。
  - 規格 §13 還沒定的一題（已離園、已退預繳的紀錄留多久）。
  - 合併與部署都等業主開口。
