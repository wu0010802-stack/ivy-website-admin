# 後台資料匯入（在籍清冊＋歷年註冊）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 總管理者在「招生統計 → 資料匯入」上傳在籍清冊與歷年註冊統計表，預覽後整校取代，不再需要本機 CLI。

**Architecture:** 清冊在瀏覽器解析、丟姓名與生日，只送「班別＋地址」給伺服器比對；預覽回傳去識別點位，確認時送回點位走既有 `replace_roster`。統計表在瀏覽器用 SheetJS 只擷取表頭與年級列的數字；伺服器把 `workbook.py` 的規則拆成不依賴 xlrd 的格子表解析層，預覽回傳數字，確認時走既有 `replace_history`。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy 2.0、pytest；Vue 3＋Element Plus＋Vitest；SheetJS 0.20.3（vendored tarball）。

**Spec:** `docs/specs/2026-10-21-admin-data-import-design.md`（業主 10-21 核可，歷年註冊用做法 C）

## Global Constraints

- 基準與位置：worktree `~/Repositories/ivy-website-wt/admin-data-import-20261021`，分支 `feature/admin-data-import-20261021`（從 `origin/main` 開，sparse）。不要讀 `~/Desktop/ivy-website-admin` 的 checkout（落後很多）。
- FastAPI 0.136.1 釘版，不升。Node 22（`.nvmrc`）；`source ~/.nvm/nvm.sh` 會回 3，指令用分號串接。
- 真實清冊（`~/Downloads/園所幼生清冊資料匯出.xls`）與真實統計表（`~/Desktop/義華校資料/幼兒園資料/目標執行統計表1150915xls.xls`）不可複製進 repo／worktree、不可交給 subagent 讀；測試只用合成資料（假姓名如「測試小明」、既有 helpers 的假地址）。Task 9 的真檔步驟只由主 session 做，對話只印數字。
- 地址不得出現在任何資料表、日誌、操作紀錄、錯誤回應、前端持久儲存（localStorage／sessionStorage／IndexedDB／Pinia 持久化）。
- 姓名、生日不得出現在任何送到伺服器的請求。
- 不放寬 1 MB 本文上限：不改 `backend/app/common/body_limit.py`、`web/shared/request-guard.ts`。
- xlrd 不進正式依賴（`backend/pyproject.toml` 的 `[project].dependencies` 不動）；`test_production_modules_never_import_xlrd` 要過。
- 新端點全部：`_require_campus(current_user, "admissions.stats", campus_key)`；只在 `settings.admissions_enabled` 時掛路由（關閉一律 404）。
- 業務錯誤 `HTTPException(status_code, detail={"code": ..., "message": ...})`；service 只 flush，路由寫稽核並 commit。
- 稽核 `action`、`target_type`、`metadata` 寫字面值（admin `labelCoverage.test.ts` 會掃）；metadata 只放數字、日期與版本；每個新 action／target／metadata 鍵都要在 admin 補中文。
- 一次預覽最多 2000 位、地址最長 120 字；有點比例門檻沿用 `MIN_PLACED_RATIO = 0.9`。
- CLI（`enrolled-match`、`enrolled-import`、`enrollment-history-extract`、`enrollment-history-import`）的參數與輸出不變。
- 測試：subagent 只跑單檔或單一測試；後端全套由主 session 背景跑（subagent 超過 10 分鐘無輸出會被中止）；同時只跑一組測試（8 GB RAM）。
- Commit：只在功能分支上，Conventional Commit、繁體中文、逐檔 `git add <path>`（不用 `.`／`-A`／`commit -a`），訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不部署。

## Review Focus

- 預覽後在頁首換校區：預覽要立刻清掉，不能拿 A 校的點位按「確認匯入」寫進 B 校（Task 8 測換校清空；Task 3 測伺服器拒絕校區不符）。
- 連點「確認匯入」或兩個分頁同時匯入同一校：只送一次、伺服器序列化（Task 8 測只送一次；Task 3／4 用 advisory lock）。
- 清冊沒有「列印日期」：要先選清冊日期才送預覽，不能用今天硬算班別（Task 8 測）。
- 選錯檔（.xlsx、PDF、空檔、別的 .xls）：顯示可讀的錯誤，不送任何請求（Task 6、Task 7 測解析錯誤；Task 8 測沒有 POST）。
- 預覽到確認之間門牌換版：409，頁面清掉預覽並請使用者重新預覽（Task 3 測 409；Task 8 測清掉預覽）。

---

### Task 1: 在籍比對核心拆層

**Files:**
- Modify: `backend/app/admissions/enrolled/match.py`
- Test: `backend/tests/test_enrolled_match.py`

**Interfaces:**
- Consumes: 現有 `locate_roster_address`、`roster_grade`、`masked_address`、`round_coord`、`matcher.*`。
- Produces（同檔）：
  ```python
  @dataclass(frozen=True)
  class UnplacedStudent:
      match_level: str
      unlocated_reason: str | None
      street: str  # masked_address() 的結果，切不出街路是 ""

  @dataclass(frozen=True)
  class MatchSummary:
      roster_date: date
      school_year: int
      doorplate_label: str
      total: int
      placed: int
      levels: dict[str, int]   # ENROLLED_LEVELS 順序，只放 > 0
      methods: dict[str, int]  # _METHOD_ORDER 順序，只放 > 0
      inferred: int
      grades: dict[str, int]   # ENROLLED_GRADES 順序，只放 > 0
      unplaced: tuple[UnplacedStudent, ...]  # 依 (match_level, unlocated_reason or "", street) 排序

  @dataclass(frozen=True)
  class MatchOutcome:  # 既有，加 summary
      payload: dict[str, Any]
      report: list[str]
      placed_ratio: float
      summary: MatchSummary

  def report_lines(summary: MatchSummary) -> list[str]
  async def match_students(db: AsyncSession, students: Sequence[tuple[str, str]], *, campus_key: str, roster_date: date) -> MatchOutcome
  async def match_roster(db: AsyncSession, roster: Roster, *, campus_key: str, roster_date: date) -> MatchOutcome
  ```
  `students` 是 `(班別, 地址)`。

- [ ] **Step 1: 寫失敗的測試**（加在 `test_enrolled_match.py`，沿用檔內 `_ready`、`ROWS`）

  ```python
  async def test_match_students_takes_grades_as_given(db_session):
      await _ready(db_session)
      outcome = await match_students(
          db_session, [("大班", "本揚里1鄰義華路68號"), ("其他", "臺北市內湖區文德路1號")],
          campus_key="yihua", roster_date=date(2026, 10, 15),
      )
      assert [s["grade"] for s in outcome.payload["students"]] == ["大班", "其他"]
      assert outcome.summary.grades == {"大班": 1, "其他": 1}
      assert (outcome.summary.total, outcome.summary.placed) == (2, 1)
      assert outcome.summary.school_year == 115

  async def test_report_is_built_from_the_summary(db_session):
      await _ready(db_session)
      outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
      assert report_lines(outcome.summary) == outcome.report
      assert all(u.street == "" or u.street.endswith("…") for u in outcome.summary.unplaced)

  async def test_unknown_grade_is_rejected(db_session):
      await _ready(db_session)
      with pytest.raises(MatchError):
          await match_students(db_session, [("大大班", "本揚里1鄰義華路68號")], campus_key="yihua", roster_date=date(2026, 10, 15))
  ```

- [ ] **Step 2: 跑，確認失敗**
  Run: `cd backend && uv run --frozen pytest tests/test_enrolled_match.py -q`
  Expected: 3 個新測試 FAIL（`match_students`／`report_lines` 不存在）。

- [ ] **Step 3: 實作**：把 `match_roster` 的迴圈搬進 `match_students`（班別直接用傳入值，不在 `ENROLLED_GRADES` 就丟 `MatchError("第 N 位的班別不對")`，不印地址）；`match_roster` 先用 `academic.current_term(roster_date)[0]` 與 `roster_grade` 算班別再呼叫它。`report_lines` 產出和現在一字不差的文字（未定位行仍是先格式化再 `sorted`）。逐筆例外仍包成不含地址的 `MatchError(...) from None`。

- [ ] **Step 4: 跑，確認全過**
  Run: `cd backend && uv run --frozen pytest tests/test_enrolled_match.py tests/test_enrolled_import.py -q`
  Expected: 全部 PASS（既有 13 個不改一行）。

- [ ] **Step 5: Commit** — `refactor(admissions): 在籍比對拆出吃班別與地址的核心與結構化報告`

---

### Task 2: 歷年解析拆成格子表層

**Files:**
- Create: `backend/app/admissions/history/grid.py`
- Modify: `backend/app/admissions/history/workbook.py`、`backend/app/admissions/history/payload.py`（`TYPE_CHECKING` 的 import 改指 `grid`）
- Create: `contracts/ivy-recruitment/history-extract-cases.json`
- Modify: `backend/tests/history_helpers.py`
- Test: `backend/tests/test_history_grid.py`（新）、`backend/tests/test_history_import.py`（守門測試）

**Interfaces:**
- Produces（`grid.py`，不 import xlrd）：
  ```python
  CellKind = Literal["empty", "number", "text", "masked"]

  @dataclass(frozen=True)
  class GridCell:
      kind: CellKind
      value: float | str | None = None

  EMPTY: GridCell
  MASKED: GridCell

  @dataclass(frozen=True)
  class SheetGrid:
      name: str
      width: int
      rows: Mapping[int, Sequence[GridCell]]
      @property
      def nrows(self) -> int: ...          # max(rows) + 1，沒有列是 0
      def cell(self, row: int, col: int) -> GridCell: ...  # 沒有就 EMPTY

  def parse_grids(grids: Sequence[SheetGrid]) -> ParsedWorkbook
  def masked_headers(grids: Sequence[SheetGrid]) -> list[tuple[str, list[str], list[str], list[str]]]
  ```
  從 `workbook.py` 搬到 `grid.py`：`WorkbookError`、`TermRow`、`ParsedWorkbook`、`parse_term_name`、`parse_as_of`、`TOTAL_LABEL`、`GRADE_LABELS`、`LABEL_PREVIEW_ROWS`、`REDACTED`、`BLOCK_ROW`、`SUBHEADER_ROW`、`FIRST_GRADE_ROW`、`TARGET_COLUMN`，以及全部解析規則。
- Produces（`workbook.py`，仍 import xlrd，只在 extract／dev 群組）：
  ```python
  def read_grids(path: Path) -> list[SheetGrid]
  def parse_workbook(path: Path) -> ParsedWorkbook      # = parse_grids(read_grids(path))
  def sheet_headers(path: Path) -> list[tuple[str, list[str], list[str], list[str]]]  # = masked_headers(read_grids(path))
  ```
  並 re-export 上面搬走的名字，讓 CLI 與既有測試不用改 import。
- Produces（`history_helpers.py`，測試用，模擬瀏覽器擷取規則，與 Task 7 的 TS 同規則）：
  ```python
  def browser_extract(grid: SheetGrid) -> SheetGrid
  def grid_json(grid: SheetGrid) -> dict   # {"name", "width", "rows": {"2": [cell...]}}；cell = None | 數字 | 字串 | {"masked": True}
  def grid_from_raw(name: str, rows: list[list], width: int) -> SheetGrid  # 原始值 None/數字/字串 → empty/number/text
  ```

格子規則（`grid.py`）：`_text` 遇 `masked` 回 `""`；`_count` 遇 `masked` 丟和非數字文字相同的 `WorkbookError(f"{sheet}：{where}不是整數")`。xlrd 轉接：EMPTY／BLANK → empty、NUMBER → number(float)、TEXT → text、其他（DATE、BOOLEAN、ERROR）→ text(`str(cell.value)`)，與現行 `_text`／`_count` 行為一致。

瀏覽器擷取規則（`browser_extract`，也寫在 `history-extract-cases.json` 的 description）：
1. 第 2、3 列整列保留（字串、數字照原樣，空白是 empty，其他是 masked）。
2. 從第 4 列往下，第 0 欄去掉所有空白後（數字轉不帶小數的字串）是「大班」「中班」「小班」「幼幼班」「總人數」的列，各取第一個，五個找齊就停。
3. 這些列的第 0 欄送去空白後的標籤；其他格：數字照送、去空白後全是數字的字串照送原字串、空字串或全空白送 empty、其他一律 masked。
4. 其他列一律不送；每列補齊或截到 `width`。

- [ ] **Step 1: 寫 `history-extract-cases.json`**（至少兩案：現代版型含標題列、備註列「備註：測試小明」、年級列有「85%」率欄與「12」文字數字；以及第 0 欄「大 班」含空白、重複的「大班」列在後面），每案 `{"name", "sheet", "width", "rows": [[...]], "expected": {"name", "width", "rows": {...}}}`。

- [ ] **Step 2: 寫失敗的測試**（`test_history_grid.py`）

  ```python
  @pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
  def test_browser_extract_shared_cases(case):
      grid = grid_from_raw(case["sheet"], case["rows"], case["width"])
      assert grid_json(browser_extract(grid)) == case["expected"]

  @pytest.mark.parametrize("layout", LAYOUTS, ids=...)
  def test_grids_parse_the_same_as_xlrd(tmp_path, layout):
      # rows 照 test_history_workbook.py 對應版型（test_parses_modern_sheet／99／100）的寫法；備註列用 FAKE_NOTES
      path = write_workbook(tmp_path, {"104上": SheetSpec(layout=layout, rows=...), "104下": SheetSpec(layout=layout, rows=...)})
      assert parse_grids([browser_extract(g) for g in read_grids(path)]) == parse_workbook(path)

  def test_browser_extract_never_carries_notes(tmp_path):
      path = write_workbook(tmp_path, {"104上": SheetSpec(rows=modern_rows())})
      text = json.dumps([grid_json(browser_extract(g)) for g in read_grids(path)], ensure_ascii=False)
      assert not any(note in text for note in FAKE_NOTES)

  def test_masked_count_is_rejected_like_text():
      ...  # 年級列的日期欄註冊人數是 MASKED → WorkbookError，訊息含「不是整數」，不含格子內容

  def test_masked_headers_match_cli_headers(tmp_path):
      path = write_workbook(tmp_path, {...})
      assert masked_headers(read_grids(path)) == sheet_headers(path)
  ```
  守門測試 `test_production_modules_never_import_xlrd` 的 import 清單加 `app.admissions.history.grid`。

- [ ] **Step 3: 跑，確認失敗** — `cd backend && uv run --frozen pytest tests/test_history_grid.py -q`，Expected: FAIL（`grid` 模組不存在）。

- [ ] **Step 4: 實作** `grid.py`、改 `workbook.py`、`payload.py`、`history_helpers.py`。

- [ ] **Step 5: 跑，確認全過** — `cd backend && uv run --frozen pytest tests/test_history_grid.py tests/test_history_workbook.py tests/test_history_import.py -q`，Expected: 全 PASS（`test_history_workbook.py` 的 37 個不改）。

- [ ] **Step 6: Commit** — `refactor(admissions): 歷年註冊解析拆出不依賴 xlrd 的格子表層`

---

### Task 3: 匯入狀態＋在籍預覽／確認／清除端點

**Files:**
- Create: `backend/app/admissions/import_routes.py`、`backend/app/admissions/imports.py`、`backend/app/admissions/schemas/imports.py`
- Modify: `backend/app/admissions/schemas/__init__.py`（匯出）、`backend/app/main.py:260-262`（同一個 `if settings.admissions_enabled:` 裡 `app.include_router(admissions_import_router)`）
- Modify: `admin/src/api/labels.ts`（action 與 target 中文）、`admin/src/api/auditLabels.ts`（metadata 格式）、`admin/src/api/errors.ts`（錯誤碼中文）
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（`npm run contract:generate` 產生）
- Test: `backend/tests/test_admissions_imports_enrolled.py`

**Interfaces:**
- Consumes: Task 1 `match_students`、`MatchSummary`、`MIN_PLACED_RATIO`；既有 `EnrolledRosterIn`、`replace_roster`、`clear_roster`、`matcher.doorplate_label`、`academic.current_term`。
- Produces（路徑都在 `/api/website/v1` 底下、都帶 query `campus_key`）：
  | 方法與路徑 | 本文 | 回應 |
  |---|---|---|
  | `GET /admin/admissions/imports/status` | — | `ImportStatusOut` |
  | `POST /admin/admissions/imports/enrolled/preview` | `EnrolledPreviewIn` | `EnrolledPreviewOut` |
  | `POST /admin/admissions/imports/enrolled/apply` | `EnrolledRosterIn`（既有） | `EnrolledApplyOut` |
  | `DELETE /admin/admissions/imports/enrolled` | — | `EnrolledClearOut` |
- Schemas（`schemas/imports.py`，輸入模型一律 `extra="forbid"`）：
  ```python
  class EnrolledUploadStudentIn(BaseModel):
      grade: EnrolledGrade                       # 沿用 schemas/enrolled.py 的 Literal
      address: str = Field(min_length=1, max_length=120)
  class EnrolledPreviewIn(BaseModel):
      roster_date: date
      students: list[EnrolledUploadStudentIn] = Field(min_length=1, max_length=2000)
  class EnrolledImportPointOut(BaseModel):  grade, district, village, match_level, unlocated_reason, lat: float | None, lng: float | None
  class EnrolledImportPayloadOut(BaseModel): format: Literal["ivy-enrolled-points/1"]; campus_key: str; roster_date: date; school_year: int; doorplate_version: str; students: list[EnrolledImportPointOut]
  class EnrolledImportUnplacedOut(BaseModel): match_level: str; unlocated_reason: str | None; street: str
  class EnrolledPreviewOut(BaseModel):
      roster_date: date; school_year: int; doorplate_version: str
      total: int; placed: int; placed_ratio: float; importable: bool
      levels: dict[str, int]; methods: dict[str, int]; inferred: int; grades: dict[str, int]
      unplaced: list[EnrolledImportUnplacedOut]
      payload: EnrolledImportPayloadOut
  class EnrolledImportStatusOut(BaseModel): roster_date: date; school_year: int; doorplate_version: str; total: int; placed: int; imported_at: datetime
  class HistoryImportStatusOut(BaseModel): rows: int; first_school_year: int; first_semester: int; last_school_year: int; last_semester: int; imported_at: datetime
  class ImportStatusOut(BaseModel): active_doorplate_version: str | None; enrolled: EnrolledImportStatusOut | None; history: HistoryImportStatusOut | None
  class EnrolledApplyOut(BaseModel): students: int; placed: int
  class EnrolledClearOut(BaseModel): removed: bool
  ```
- `imports.py`：`async def import_status(db: AsyncSession, campus_key: str) -> dict`（`history` 取該校列數、最早／最晚學期、`max(imported_at)`）、`async def lock_campus_import(db: AsyncSession, kind: Literal["enrolled_roster", "enrollment_history"], campus_key: str) -> None`（`SELECT pg_advisory_xact_lock(hashtext(:key))`，key＝`f"{kind}:{campus_key}"`，同 `intake.py:171` 寫法）。
- `import_routes.py`：`router = APIRouter(prefix="/api/website/v1", tags=["admissions"], route_class=NoEchoValidationRoute)`。`NoEchoValidationRoute(APIRoute)` 在 `get_route_handler` 攔 `RequestValidationError`，改丟 `HTTPException(422, {"code": "INVALID_IMPORT_PAYLOAD", "message": ...})`，message 只列前 5 個「位置：錯誤種類」；`extra_forbidden` 的最後一段寫「（多餘欄位）」（同 `history/payload.py` 的 `_position`）。
- 錯誤碼：`ENROLLED_MATCH_FAILED`（422，message＝`MatchError` 訊息）、`CAMPUS_MISMATCH`（422「資料的校區和選的校區不同，請重新預覽」）、`LOW_PLACED_RATIO`（422「有點的比例不到 90%，不能匯入」）、`DOORPLATE_CHANGED`（409「門牌已換版，請重新預覽」）、`SCHOOL_YEAR_MISMATCH`（422「清冊日期和學年對不上，請重新預覽」）。
- 稽核（字面值）：
  - 確認匯入：`action="enrolled_roster.import"`、`target_type="enrolled_roster"`、`target_id=campus_key`、`metadata={"students": total, "placed_students": placed, "roster_date": payload.roster_date.isoformat(), "doorplate_version": payload.doorplate_version}`
  - 清除（`removed` 才寫）：`action="enrolled_roster.clear"`、`target_type="enrolled_roster"`、`target_id=campus_key`，不帶 metadata。
- admin 中文：`labels.ts` action `'enrolled_roster.import': '匯入在籍清冊'`、`'enrolled_roster.clear': '清除在籍資料'`，target `enrolled_roster: '在籍清冊'`；`auditLabels.ts` 加 `students`（「共 N 位」）、`placed_students`（「有點 N 位」）、`roster_date`（「清冊日期：…」）、`doorplate_version`（「門牌版本：…」）；`errors.ts` 的 `ERROR_CODE_MESSAGES` 加上面五個碼與 `INVALID_IMPORT_PAYLOAD`（「上傳的資料格式不對」）。

確認匯入的檢查順序：校區相符 → 有點比例 ≥ 0.9（`placed / total`，`placed` 是 `lat` 非空的人數）→ `doorplate_version == await matcher.doorplate_label(db)` → `school_year == current_term(roster_date)[0]` → `lock_campus_import` → `replace_roster` → 稽核 → commit。預覽不寫資料庫、不寫稽核。

- [ ] **Step 1: 寫失敗的測試**（`test_admissions_imports_enrolled.py`；用 `geo_helpers.load_geo_samples`＋`publish_campus_address(db, "yihua", "高雄市三民區義華路68號")` 準備門牌與校址；學生用 `test_enrolled_match.py` 的假地址）

  ```python
  IMPORTS = "/api/website/v1/admin/admissions/imports"
  STUDENTS = [{"grade": "小班", "address": "本揚里1鄰義華路68號"}, {"grade": "小班", "address": "本揚里1鄰義華路68號"},
              {"grade": "中班", "address": "高雄市三民區義華路999號"}, {"grade": "中班", "address": "臺北市內湖區文德路1號"}]

  async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client): ...
      # 四支端點：其他角色 403；admin 對 yihua 200；campus_key=nowhere 404；未登入 401
  async def test_hidden_when_admissions_are_disabled(admin_client): ...   # 四支都 404
  async def test_status_before_and_after_import(admin_client, db_session): ...
      # 先 enrolled/history 都是 None；replace_roster 後 enrolled.total、placed、imported_at 有值
  async def test_preview_reports_and_writes_nothing(admin_client, db_session):
      body = (await admin_client.post(f"{IMPORTS}/enrolled/preview?campus_key=yihua", json={"roster_date": "2026-10-15", "students": STUDENTS})).json()
      assert (body["total"], body["school_year"]) == (4, 115)
      assert body["payload"]["format"] == "ivy-enrolled-points/1" and body["payload"]["campus_key"] == "yihua"
      assert await _count(db_session, EnrolledRoster) == 0 and await _count(db_session, AuditLogEntry) == before
  async def test_preview_never_echoes_or_logs_addresses(admin_client, caplog):
      caplog.set_level(logging.DEBUG)
      ok = await admin_client.post(..., json={"roster_date": "2026-10-15", "students": STUDENTS})
      bad = await admin_client.post(..., json={"roster_date": "2026-10-15", "students": [{"grade": "大大班", "address": "本揚里1鄰義華路68號", "name": "測試小明"}]})
      assert bad.status_code == 422 and bad.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
      for text in (ok.text, bad.text, caplog.text):
          assert "義華路68號" not in text and "文德路1號" not in text and "測試小明" not in text and '"name"' not in text
  async def test_preview_needs_doorplates(admin_client): ...       # 沒有門牌 → 422 ENROLLED_MATCH_FAILED
  async def test_preview_limits(admin_client): ...                  # 2001 位、121 字地址、空清單 → 422
  async def test_apply_replaces_roster_and_audits(admin_client, db_session):
      # 預覽 → 把 payload 原樣 POST 到 apply → 200 {"students": 4, "placed": ...}；status 更新
      # 操作紀錄一筆 enrolled_roster.import，metadata 鍵恰為 {"students","placed_students","roster_date","doorplate_version"}，序列化後不含任何地址字串
  async def test_apply_rejects_low_ratio(admin_client, db_session): ...         # 10 位有點 8 位 → 422 LOW_PLACED_RATIO，資料表沒變
  async def test_apply_rejects_other_campus(admin_client): ...                  # payload campus_key=yihua 送到 campus_key=minghua → 422 CAMPUS_MISMATCH
  async def test_apply_rejects_changed_doorplate(admin_client): ...             # doorplate_version="114-01" → 409 DOORPLATE_CHANGED
  async def test_apply_rejects_school_year_mismatch(admin_client): ...          # roster_date 2026-10-15、school_year 114 → 422
  async def test_apply_rejects_extra_fields_without_echo(admin_client): ...     # 學生多帶 address → 422，回應不含那個地址
  async def test_clear(admin_client, db_session): ...                           # removed true→false；稽核只有一筆 enrolled_roster.clear
  ```
  apply 用的 payload 可以用 `tests/enrolled_helpers.points_payload`（預設門牌 `115-10`，和 `load_geo_samples` 的顯示版本一致；不一致時以 `matcher.doorplate_label` 實際值為準）。

- [ ] **Step 2: 跑，確認失敗** — `cd backend && uv run --frozen pytest tests/test_admissions_imports_enrolled.py -q`，Expected: FAIL（404，路由不存在）。
- [ ] **Step 3: 實作** schemas、`imports.py`、`import_routes.py`、`main.py`。
- [ ] **Step 4: 跑，確認通過** — 同上指令，Expected: 全 PASS。
- [ ] **Step 5: 產生契約** — `npm run contract:generate`，Expected: `contracts/openapi.json` 與 `website-api.d.ts` 出現 `ImportStatusOut`、`EnrolledPreviewIn`、`EnrolledPreviewOut`、`EnrolledRosterIn`。
- [ ] **Step 6: admin 標籤** — 改 `labels.ts`、`auditLabels.ts`、`errors.ts`；Run: `npm --prefix admin run test:unit -- src/__tests__/labelCoverage.test.ts`，Expected: PASS。
- [ ] **Step 7: Commit** — `feat(admissions): 後台匯入在籍清冊的預覽、確認與清除端點`

---

### Task 4: 歷年註冊預覽／確認端點

**Files:**
- Modify: `backend/app/admissions/import_routes.py`、`backend/app/admissions/imports.py`、`backend/app/admissions/schemas/imports.py`、`schemas/__init__.py`
- Modify: `admin/src/api/labels.ts`、`admin/src/api/auditLabels.ts`、`admin/src/api/errors.ts`、契約兩檔
- Test: `backend/tests/test_admissions_imports_history.py`

**Interfaces:**
- Consumes: Task 2 `SheetGrid`、`GridCell`、`parse_grids`、`masked_headers`、`WorkbookError`；Task 3 `NoEchoValidationRoute`、`lock_campus_import`；既有 `build_payload`、`load_payload`、`describe_error`、`EnrollmentHistoryIn`、`replace_history`。
- Produces：
  | 方法與路徑 | 本文 | 回應 |
  |---|---|---|
  | `POST /admin/admissions/imports/history/preview` | `HistoryPreviewIn` | `HistoryPreviewOut` |
  | `POST /admin/admissions/imports/history/apply` | `EnrollmentHistoryIn`（既有） | `HistoryApplyOut` |
- Schemas：
  ```python
  class HistoryMaskedCellIn(BaseModel): masked: Literal[True]           # extra=forbid
  HistoryCellIn = StrictInt | StrictFloat | Annotated[StrictStr, StringConstraints(max_length=200)] | HistoryMaskedCellIn | None
  class HistorySheetIn(BaseModel):                                       # extra=forbid
      name: str = Field(min_length=1, max_length=20)
      width: int = Field(ge=1, le=64)
      rows: dict[int, list[HistoryCellIn]]   # 鍵只能是 2、3 或 4–999，最多 7 列，每列長度 ≤ width
      def to_grid(self) -> SheetGrid: ...
  class HistoryPreviewIn(BaseModel): sheets: list[HistorySheetIn] = Field(min_length=1, max_length=100)
  class HistoryTermOut(BaseModel): school_year: int; semester: int
  class HistoryChangeOut(BaseModel): school_year: int; semester: int; grade: str; before: int; after: int
  class EnrollmentHistoryRowOut(BaseModel): # 欄位同 TermRowIn
  class EnrollmentHistoryPayloadOut(BaseModel): format: Literal["ivy-enrollment-history/1"]; campus_key: str; rows: list[EnrollmentHistoryRowOut]; warnings: list[str]
  class HistoryPreviewOut(BaseModel):
      rows: int; first: HistoryTermOut; last: HistoryTermOut
      removed_terms: list[HistoryTermOut]   # 資料庫有、新檔沒有的學期，依學期排序
      changed: list[HistoryChangeOut]       # 兩邊都有、registered 不同的（學期, 年級）
      warnings: list[str]
      payload: EnrollmentHistoryPayloadOut
  class HistoryApplyOut(BaseModel): rows: int
  ```
- `imports.py`：`async def history_diff(db: AsyncSession, campus_key: str, rows: Sequence[TermRowIn]) -> tuple[list[tuple[int, int]], list[dict]]`。
- 錯誤：`WorkbookError` → 422 `{"code": "HISTORY_WORKBOOK_INVALID", "message": str(error), "headers": [{"name", "row2", "row3", "labels"}]}`（`masked_headers(grids)`）；`load_payload` 的 `ValidationError` → 422 `{"code": "HISTORY_PAYLOAD_INVALID", "message": describe_error(error)}`；校區不符 → 422 `CAMPUS_MISMATCH`。
- 稽核：`action="enrollment_history.import"`、`target_type="enrollment_history"`、`target_id=campus_key`、`metadata={"term_rows": count, "first_term": "104上", "last_term": "115上"}`（學期字樣同 CLI `_term_span` 的寫法）。
- admin 中文：action `'enrollment_history.import': '匯入歷年註冊'`、target `enrollment_history: '歷年註冊'`、metadata `term_rows`（「共 N 列」）、`first_term`（「從 …」）、`last_term`（「到 …」）；錯誤碼 `HISTORY_WORKBOOK_INVALID`（「統計表格式看不懂」）、`HISTORY_PAYLOAD_INVALID`。

- [ ] **Step 1: 寫失敗的測試**（`history_helpers` 產合成檔 → `read_grids` → `browser_extract` → `grid_json` 當本文）

  ```python
  async def test_permissions_and_disabled(...): ...                       # 同 Task 3 的寫法，兩支端點
  async def test_preview_matches_the_cli(admin_client, tmp_path):
      path = write_workbook(tmp_path, {"104上": SheetSpec(rows=modern_rows()), "104下": SheetSpec(rows=modern_rows())})
      sheets = [grid_json(browser_extract(g)) for g in read_grids(path)]
      body = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})).json()
      assert body["payload"] == json.loads(json.dumps(build_payload(parse_workbook(path), "yihua")))
      assert (body["rows"], body["first"], body["last"]) == (8, {"school_year": 104, "semester": 1}, {"school_year": 104, "semester": 2})
  async def test_preview_writes_nothing(admin_client, db_session): ...
  async def test_preview_lists_removed_and_changed_terms(admin_client, db_session): ...
      # 先 replace_history 103上＋104上；新檔 104上（大班 registered 改）＋105上 → removed_terms [103上]、changed 只有 104上 大班
  async def test_invalid_workbook_returns_masked_headers(admin_client, tmp_path):
      # 表名「工作表1」→ 422 HISTORY_WORKBOOK_INVALID；detail.headers[0].name == "工作表1"；整份回應不含 FAKE_NOTES 任何一句
  async def test_preview_rejects_unknown_cell_shapes(admin_client): ...
      # {"masked": False}、巢狀陣列、201 字字串、第 1 列、第 8 列、width 65 → 422 INVALID_IMPORT_PAYLOAD
  async def test_apply_replaces_history_and_audits(admin_client, db_session): ...
      # 預覽的 payload 原樣 apply → {"rows": 8}；他校資料不動；稽核 metadata 鍵恰為 {"term_rows","first_term","last_term"}
  async def test_apply_rejects_other_campus(admin_client): ...
  ```

- [ ] **Step 2: 跑，確認失敗** — `cd backend && uv run --frozen pytest tests/test_admissions_imports_history.py -q`
- [ ] **Step 3: 實作**
- [ ] **Step 4: 跑，確認通過** — 同上，加 `tests/test_admissions_imports_enrolled.py tests/test_history_import.py`
- [ ] **Step 5: 產生契約＋admin 標籤** — `npm run contract:generate`；`npm --prefix admin run test:unit -- src/__tests__/labelCoverage.test.ts` PASS
- [ ] **Step 6: Commit** — `feat(admissions): 後台匯入歷年註冊的預覽與確認端點`

---

### Task 5: 清冊班別規則 `rosterGrade`＋共用案例

**Files:**
- Create: `contracts/ivy-recruitment/roster-grade-cases.json`
- Modify: `admin/src/admissions/academic.ts`
- Test: `admin/src/__tests__/admissionsAcademic.test.ts`、`backend/tests/test_enrolled_roster.py`

**Interfaces:**
- Produces: `export type RosterGrade = Grade | '其他'`；`export function rosterGrade(birthday: string /* YYYY-MM-DD */, schoolYear: number): RosterGrade`（規則同 `roster.py` 的 `roster_grade`：`gradeForBirthday` 有值就用；否則 9/1 足歲未滿 2 歲 → 幼幼班、其餘 → 其他）。

- [ ] **Step 1: 寫案例檔**：`{"description": "...兩邊都讀...", "cases": [{"name", "birthday", "school_year", "expected"}]}`，115 學年至少這些：
  `2023-09-01→小班`、`2023-09-02→幼幼班`、`2024-09-01→幼幼班`、`2024-09-02→幼幼班`、`2025-03-01→幼幼班`、`2022-09-01→中班`、`2021-09-01→大班`、`2020-09-02→大班`、`2020-09-01→其他`、`2019-05-05→其他`。
- [ ] **Step 2: 寫失敗的測試**：Python `test_shared_roster_grade_cases`（parametrize，`roster_grade(date.fromisoformat(c["birthday"]), c["school_year"]) == c["expected"]`）；TS `it.each(cases)('rosterGrade %s', ...)`，讀法同 `grade-cases.json`。
- [ ] **Step 3: 跑** — Python 應該直接 PASS（規則已存在，案例檔是新的）；TS FAIL（`rosterGrade` 不存在）。
- [ ] **Step 4: 實作 `rosterGrade`**
- [ ] **Step 5: 跑** — `cd backend && uv run --frozen pytest tests/test_enrolled_roster.py -q`；`npm --prefix admin run test:unit -- src/__tests__/admissionsAcademic.test.ts`，Expected: 全 PASS
- [ ] **Step 6: Commit** — `feat(admin): 清冊班別規則與後端共用案例`

---

### Task 6: 清冊在瀏覽器解析

**Files:**
- Create: `admin/src/admissions/imports/roster.ts`
- Test: `admin/src/__tests__/importRoster.test.ts`

**Interfaces:**
- Consumes: Task 5 `rosterGrade`；既有 `currentTerm`；Task 3 產生的型別 `components['schemas']['EnrolledPreviewIn']`。
- Produces：
  ```ts
  export class RosterFileError extends Error {}
  export interface RosterStudent { birthday: string /* YYYY-MM-DD */; address: string }
  export interface RosterFile { printedOn: string | null /* YYYY-MM-DD */; institution: string | null; students: RosterStudent[] }
  export function parseRosterHtml(text: string): RosterFile
  export function enrolledPreviewBody(roster: RosterFile, rosterDate: string): EnrolledPreviewRequest
  ```
  `EnrolledPreviewRequest` 在 Task 8 加進 `api/types.ts`；本任務先在 `roster.ts` 直接用 `components['schemas']['EnrolledPreviewIn']`。

規則照 `backend/app/admissions/enrolled/roster.py`：`DOMParser().parseFromString(text, 'text/html')`；每個 `<table>` 的列 × 格（`td`、`th` 一視同仁，`textContent.trim()`）；第一列同時有「出生日期」「通訊地址」的表格才是名冊；錯誤訊息逐字同 Python（「名冊第 N 列的欄數和表頭不同」「名冊第 N 列的出生日期不是 YYYY/MM/DD」「名冊沒有任何學生」「找不到有「出生日期」「通訊地址」兩欄的名冊表格」）。`printedOn` 用 `/列印日期[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/` 掃所有格子。`institution`：非名冊表格中第一個含「幼兒園」或「常春藤」的格子文字（空白收成一格、最多 60 字），沒有就 `null`。其他欄（姓名、性別、編號…）不放進回傳值。`enrolledPreviewBody` 以 `currentTerm(rosterDate).schoolYear` 算 `rosterGrade`，學生依 `(班別順序 幼幼班→小班→中班→大班→其他, address)` 排序，只輸出 `{roster_date, students: [{grade, address}]}`。

- [ ] **Step 1: 寫失敗的測試**（測試檔內自己組合成 HTML：表頭加「幼生姓名」欄、假姓名「測試小明」、假地址用 Task 3 的 `STUDENTS` 那幾個、第一個表格放「高雄市私立常春藤測試幼兒園」）

  ```ts
  it('只取出生日期與通訊地址，認得列印日期與園所名稱', ...)   // students 長度、printedOn '2026-10-15'、institution
  it('送出的本文沒有姓名與生日，也看不出清冊列序', () => {
    const body = enrolledPreviewBody(parseRosterHtml(html), '2026-10-15')
    const text = JSON.stringify(body)
    expect(text).not.toContain('測試小明'); expect(text).not.toContain('2023/03/01'); expect(text).not.toContain('2023-03-01')
    expect(Object.keys(body.students[0]!).sort()).toEqual(['address', 'grade'])
    expect(enrolledPreviewBody(parseRosterHtml(reversedHtml), '2026-10-15')).toEqual(body)
  })
  it.each([...])('格式錯誤時的訊息：%s', ...)                 // 四種錯誤，訊息逐字比對，不含地址
  it('不是 HTML 的檔案丟 RosterFileError', ...)              // PDF 開頭位元組轉字串、空字串
  it('不執行檔案裡的腳本', () => { parseRosterHtml('<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">' + html); expect((window as any).__pwned).toBeUndefined() })
  ```
- [ ] **Step 2: 跑，確認失敗** — `npm --prefix admin run test:unit -- src/__tests__/importRoster.test.ts`
- [ ] **Step 3: 實作**
- [ ] **Step 4: 跑，確認通過**
- [ ] **Step 5: Commit** — `feat(admin): 在籍清冊在瀏覽器解析，只送班別與地址`

---

### Task 7: SheetJS（vendored）＋統計表擷取器

**Files:**
- Create: `admin/vendor/xlsx-0.20.3.tgz`、`admin/vendor/README.md`
- Modify: `admin/package.json`、`admin/package-lock.json`、`deploy/web.Dockerfile:8`
- Create: `admin/src/admissions/imports/historyWorkbook.ts`
- Test: `admin/src/__tests__/importHistoryWorkbook.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `contracts/ivy-recruitment/history-extract-cases.json`。
- Produces：
  ```ts
  export type HistoryCell = null | number | string | { masked: true }
  export interface HistorySheetGrid { name: string; width: number; rows: Record<string, HistoryCell[]> }
  export class HistoryFileError extends Error {}
  export function extractSheet(name: string, rows: readonly (readonly unknown[])[], width: number): HistorySheetGrid  // 純函式，規則同 Task 2
  export async function readHistoryWorkbook(data: ArrayBuffer): Promise<HistorySheetGrid[]>
  ```
  `readHistoryWorkbook` 動態 `import('xlsx')`，`XLSX.read(data, { type: 'array', dense: true })`；每張表用 `XLSX.utils.decode_range(ws['!ref'])` 定 `width = e.c + 1`，直接讀 `ws['!data'][r][c]` 的 `t`／`v`（`n` → 數字、`s` → 字串、其他非空 → 交給 `extractSheet` 當成非數字），讀不了（例外、沒有工作表）丟 `HistoryFileError('無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）')`。

- [ ] **Step 1: 放 tarball** — `curl -sS -A 'Mozilla/5.0' -o admin/vendor/xlsx-0.20.3.tgz https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`；`shasum -a 256 admin/vendor/xlsx-0.20.3.tgz` 必須是 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`；`git check-ignore admin/vendor/xlsx-0.20.3.tgz` 沒有輸出。`admin/vendor/README.md` 寫來源網址、版本、SHA-256、為什麼不用 npm 上的 `xlsx@0.18.5`（CVE-2023-30533、CVE-2024-22363）、只能用套件入口 `xlsx.mjs`（mini／core 讀不了 XLS）。
- [ ] **Step 2: 裝** — 在 `admin/`：`npm install --save ./vendor/xlsx-0.20.3.tgz`，`package.json` 應為 `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`；`deploy/web.Dockerfile` 第 8 行後加 `COPY admin/vendor ./admin/vendor`（要在 `npm ci` 之前）。
- [ ] **Step 3: 寫失敗的測試**

  ```ts
  it.each(cases)('擷取規則和後端一致：$name', ({ sheet, rows, width, expected }) => expect(extractSheet(sheet, rows, width)).toEqual(expected))
  it('讀得到 BIFF8，表名與數字都在、備註不在', async () => {
    // 用 XLSX.utils.aoa_to_sheet 組兩張表（104上、104下，含標題列、年級列、備註「備註：測試小明」），XLSX.write(wb, { bookType: 'biff8', type: 'array' })
    const grids = await readHistoryWorkbook(buffer)
    expect(grids.map((g) => g.name)).toEqual(['104上', '104下'])
    expect(JSON.stringify(grids)).not.toContain('測試小明')
  })
  it('不是 Excel 的檔案丟 HistoryFileError', async () => { await expect(readHistoryWorkbook(new TextEncoder().encode('%PDF-1.4').buffer)).rejects.toBeInstanceOf(HistoryFileError) })
  ```
- [ ] **Step 4: 跑，確認失敗** — `npm --prefix admin run test:unit -- src/__tests__/importHistoryWorkbook.test.ts`
- [ ] **Step 5: 實作 `historyWorkbook.ts`**
- [ ] **Step 6: 跑，確認通過**；`npm --prefix admin run build`，確認 `xlsx` 在獨立的 chunk（`dist/assets/` 下有含 xlsx 的檔，主 chunk 大小和改前相比沒有多出幾百 KB）。
- [ ] **Step 7: 驗證 Docker 的 npm ci 前置** — 在 scratchpad 建空目錄，只複製 `admin/package.json`、`admin/package-lock.json`、`admin/vendor/`，跑 `npm ci --ignore-scripts`，Expected: 成功（證明 Dockerfile 只先複製這三樣也裝得起來）。
- [ ] **Step 8: Commit** — `feat(admin): 引入 SheetJS 0.20.3 並在瀏覽器擷取統計表數字`

---

### Task 8: 「資料匯入」分頁

**Files:**
- Create: `admin/src/components/admissions/imports/ImportsTab.vue`、`EnrolledImportCard.vue`、`HistoryImportCard.vue`、`importFormat.ts`
- Modify: `admin/src/components/admissions/StatsTab.vue`（:9 附近 import、:53 `ownDataSub`、:508 後加 pane）、`admin/src/admissions/useAdmissionsFilters.ts:19`（`STATS_SUBS` 加 `'imports'`）、`admin/src/views/AdmissionsStatsView.vue:22`（`termless` 加 `'imports'`）
- Modify: `admin/src/api/types.ts`、`admin/src/api/admissions.ts`
- Modify: `admin/src/__tests__/admissionsTestKit.ts`（加 `importStatus(changes)`、`enrolledPreview(changes)`、`historyPreview(changes)` 資料工廠）
- Test: `admin/src/__tests__/importsTab.test.ts`

**Interfaces:**
- Consumes: Task 3／4 端點與契約型別；Task 6 `parseRosterHtml`、`enrolledPreviewBody`、`RosterFileError`；Task 7 `readHistoryWorkbook`、`HistoryFileError`。
- Produces（`api/types.ts` 別名）：`ImportStatus`＝`ImportStatusOut`、`EnrolledPreviewRequest`＝`EnrolledPreviewIn`、`EnrolledPreview`＝`EnrolledPreviewOut`、`EnrolledImportPayload`＝`EnrolledRosterIn`、`EnrolledApplyResult`＝`EnrolledApplyOut`、`EnrolledClearResult`＝`EnrolledClearOut`、`HistoryPreviewRequest`＝`HistoryPreviewIn`、`HistoryPreview`＝`HistoryPreviewOut`、`EnrollmentHistoryPayload`＝`EnrollmentHistoryIn`、`HistoryApplyResult`＝`HistoryApplyOut`。
- Produces（`api/admissions.ts`，路徑寫法同 `getPotential`）：
  ```ts
  getImportStatus(campusKey: string): Promise<ImportStatus>
  previewEnrolledImport(campusKey: string, body: EnrolledPreviewRequest): Promise<EnrolledPreview>
  applyEnrolledImport(campusKey: string, payload: EnrolledImportPayload): Promise<EnrolledApplyResult>
  clearEnrolledImport(campusKey: string): Promise<EnrolledClearResult>
  previewHistoryImport(campusKey: string, body: HistoryPreviewRequest): Promise<HistoryPreview>
  applyHistoryImport(campusKey: string, payload: EnrollmentHistoryPayload): Promise<HistoryApplyResult>
  ```
- 元件：`ImportsTab` props `{ campusKey: string; active?: boolean }`（讀狀態的寫法照 `PotentialTab`：`useRequestSequence`、換校先清空、`active` 為 false 時延後讀）；兩張卡片 props `{ campusKey: string; status: ImportStatus | null }`、emit `imported`（`ImportsTab` 收到就重讀狀態）。
- 「目前資料」：在籍顯示清冊日期、學年、人數（有點幾位）、比對用門牌版本、匯入時間；歷年顯示學期範圍（例：99上～115上）、列數、匯入時間。
- 固定文案：
  - 說明：在籍「只會送出地址和班別，地址比對完不保存。」；歷年「只會送出表頭和各年級的數字。」
  - 沒有資料：「還沒有匯入」；門牌換版（`status.enrolled.doorplate_version !== status.active_doorplate_version`）：「門牌已換版，可以重新上傳清冊。」
  - 預覽與確認對話框：「匯入到：{campusLabel(campusKey)}」；在籍另有「檔案上的園所：{institution}」（`institution` 為 null 時不顯示這行）。
  - 比例不足：「有點的比例不到 90%，不能匯入。」，「確認匯入」停用。
  - 會被刪掉的學期：列出學期後加勾選「我知道這些學期會被刪掉」，勾了才能確認。
  - 按鈕：「選擇清冊檔」「選擇統計表」「確認匯入」「清除這校在籍資料」（次要位置，`ElMessageBox.confirm` 再確認）。
- 行為：
  - 選檔用隱藏的 `<input type="file" accept=".xls">`，清冊用 `file.text()`、統計表用 `file.arrayBuffer()`；解析錯誤（`RosterFileError`／`HistoryFileError`）就地顯示訊息、不送請求。
  - 清冊 `printedOn` 為 null 時顯示日期欄（`el-date-picker`，`value-format="YYYY-MM-DD"`），選了才送預覽。
  - 地址只存在送預覽的那個函式範圍內；元件 state 只留 `institution`、預覽回應，不留 `RosterFile`。
  - 預覽後再和目前資料並列：在籍「目前：{清冊日期}・{人數} 位 → 新的：{清冊日期}・{人數} 位」；歷年列出 `changed`。
  - `campusKey` 改變、或確認回 409／422 `CAMPUS_MISMATCH`：清掉預覽與選檔狀態。
  - 送出中按鈕 `loading` 且忽略再次點擊。
  - 歷年 `HISTORY_WORKBOOK_INVALID`：顯示 message，並把 `detail.headers` 以「表名／第 2 列／第 3 列／第 0 欄」列出（可選取複製）。
  - 不用 localStorage／sessionStorage。

- [ ] **Step 1: 寫失敗的測試**（`importsTab.test.ts`；`mockGet`／`mockPost`／`mockDelete`、`mountWith` 照 `potentialTab.test.ts`；`vi.mock('../admissions/imports/historyWorkbook', ...)` 控制擷取結果；檔案用 jsdom `File` 觸發 `change`）

  ```ts
  it('依頁首校區讀匯入狀態', ...)                          // GET /admin/admissions/imports/status，query campus_key=yihua
  it('沒有資料時寫「還沒有匯入」', ...)
  it('門牌換版時提醒可以重新上傳', ...)
  it('選清冊後只送班別與地址並顯示預覽', ...)               // bodyOf(post, '/admin/admissions/imports/enrolled/preview') 不含「測試小明」與生日；畫面有「匯入到：義華」「檔案上的園所：」、總數與有點數
  it('清冊沒有列印日期時要先選日期才送預覽', ...)            // 選檔後 post 未被呼叫；選日期後才呼叫，roster_date 為所選日期
  it('比例不足時確認匯入停用', ...)
  it('確認送出預覽回來的資料並重讀狀態', ...)               // apply 本文 toEqual(preview.payload)；status 被讀第二次
  it('連點確認只送一次', ...)                               // deferred apply，點兩下，apply 呼叫一次
  it('換校區清掉預覽', ...)                                 // setProps({ campusKey: 'minghua' }) 後沒有「確認匯入」
  it('門牌換版的 409 清掉預覽並提示重新預覽', ...)
  it('清除要再確認一次', ...)                               // ElMessageBox.confirm resolve 後才 DELETE
  it('選到讀不了的檔不送任何請求', ...)                     // 清冊給 PDF 文字、統計表 mock reject HistoryFileError；post 未被呼叫、畫面有錯誤訊息
  it('統計表預覽顯示各學期人數、警告與會被刪掉的學期', ...)   // 未勾「我知道這些學期會被刪掉」前確認停用
  it('統計表看不懂時列出遮罩表頭', ...)                      // post reject new ApiError(422, { code: 'HISTORY_WORKBOOK_INVALID', message, headers })
  it('子分頁寫進網址', ...)                                 // StatsTab／useAdmissionsFilters：sub=imports 可往返
  ```
- [ ] **Step 2: 跑，確認失敗** — `npm --prefix admin run test:unit -- src/__tests__/importsTab.test.ts`
- [ ] **Step 3: 實作** API 函式、型別、三個元件、`importFormat.ts`（比對等級、原因、補區方式的中文；`areaFormat.ts` 已有同義的就 import，不重寫）、StatsTab／filters／view 的接線。
- [ ] **Step 4: 跑，確認通過**；再跑 `npm --prefix admin run typecheck` 與 `npm --prefix admin run test:unit -- --maxWorkers=2`（整個 admin），Expected: 全 PASS。
- [ ] **Step 5: 用 dev server 看畫面**（`docs/website-admin/README.md` 的 admin＋backend 啟動方式；本機測試庫灌合成門牌：`load_geo_samples` 那份樣本），桌機 1440 與手機 390 各截一張「資料匯入」分頁、預覽後一張；用測試檔案，不用真檔。
- [ ] **Step 6: Commit** — `feat(admin): 招生統計新增資料匯入分頁`

---

### Task 9: 文件與完整驗證

**Files:**
- Modify: `deploy/README.md`（:1223-1253 兩節改成「後台上傳為主、CLI 為備用」，保留 CLI 指令）
- Modify: `README.md`（頂部加 2026-10-21 日期段落）
- 已在分支上：`docs/specs/2026-10-21-admin-data-import-design.md`、本計畫

- [ ] **Step 1: 改文件並 commit** — `docs: 後台資料匯入的操作說明與改版紀錄`
- [ ] **Step 2: 補 sparse 目錄**（全套測試要讀）：`git sparse-checkout add web/server/data web/public web/app web/app/generated web/server deploy`
- [ ] **Step 3: 後端全套（主 session 背景跑）** — `cd backend && uv sync --frozen; uv run --frozen pytest -q`，Expected: 0 failed。
- [ ] **Step 4: 前端與契約** — `npm --prefix admin ci; npm --prefix admin run typecheck; npm --prefix admin run test:unit -- --maxWorkers=2; npm --prefix admin run build; npm --prefix web run typecheck; npm run test:website; npm run contract:check`；`cd backend && uv run --frozen python -m unittest discover -s ../deploy/tests`（路徑照 `website.yml:172` 實際寫法），Expected: 全過。
- [ ] **Step 5: 隱私自查** — `git diff origin/main --stat` 只有計畫列出的檔；`git grep -n -E "localStorage|sessionStorage" -- admin/src/components/admissions/imports admin/src/admissions/imports` 沒有輸出；`git grep -n "logger\." -- backend/app/admissions/import_routes.py backend/app/admissions/imports.py` 逐行確認不帶地址；`body_limit.py`、`request-guard.ts`、`pyproject.toml` 的 `[project].dependencies` 沒有變更；`git grep -n -E "console\.(log|info|warn|error)" -- 'web/server/routes/api/website/v1/[...].ts' web/shared/request-guard.ts admin/src/api/client.ts` 逐行確認沒有印請求本文。
- [ ] **Step 6: 真檔驗證（只有主 session，對話只印數字）**
  - 歷年：在 scratchpad 寫腳本，同一份真統計表分別走 `parse_workbook`（xlrd）與「`readHistoryWorkbook` 的輸出 → `HistorySheetIn.to_grid` → `parse_grids`」，兩份 `build_payload` 相同就印「相同」與列數，不同只印不同的列數與學期名。
  - 在籍：本機沒有正式門牌就跳過，部署後由業主在正式站上傳義華清冊，預覽應約為 192 位、有點約 180 位（10-15 匯入結果；門牌版本不同會有小差異）。
- [ ] **Step 7: 回報** — 跑過的指令與結果、截圖路徑、未驗證項目（正式站真清冊預覽、Docker 實際建置）。不 push、不部署，等業主指示。
