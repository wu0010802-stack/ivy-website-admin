# 招生潛力與市佔率：第一波（歷年註冊＋市佔率）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招生統計新分頁「招生潛力與市佔率」第一波：匯入義華歷年註冊、回補每年 9 月底各里人口、國小一年級對帳，畫出 107 學年起的 3 公里市佔率卡片與走勢。

**Architecture:**
- 新模組 `backend/app/admissions/history/` 負責歷年註冊：本機用 xlrd 讀 xls 抽出數字 JSON，正式站用 CLI 整批匯入。
- 每年 9 月人口、國小一年級兩種公開資料掛在既有 `geo-sync`，走「檔案、打包、自動同步」三條路。
- 新服務 `backend/app/admissions/share.py` 組出市佔率與對帳，由新端點 `GET /admin/admissions/potential` 回傳。
- admin 新子分頁 `potential`，用手寫 SVG 畫走勢。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、Alembic、PostgreSQL、pydantic 2、xlrd 2（只在本機 extract 群組）、Vue 3、Element Plus、Vitest。

**Spec:** `docs/specs/2026-10-20-admissions-potential-share-design.md`（本計畫只做 §2 的第一波：§3.1、§3.2、§3.3、§4、§6 的 `share` 部分）

## Global Constraints

- worktree `~/Repositories/ivy-website-wt/admissions-potential-20261020`，分支 `feature/admissions-potential-20261020`，Node 22（`source ~/.nvm/nvm.sh; nvm use 22`；nvm source 會回 3，用分號串接，不要用 `&&`）。
- 不 `git add .`／`-A`。commit 用 Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不部署。
- 權限：端點用 `_require_campus(current_user, "admissions.stats", campus_key)`，只有 super_admin。
- **原始 xls（`~/Desktop/義華校資料/…`）不交給 subagent、不進 repo、不放測試**。測試一律用 xlwt 自製的假檔，假檔裡的備註列放假名。
- extract 只讀年級列（第 0 欄是「大班／中班／小班／幼幼班／總人數」的列），備註列（第 9 列以後的其他列）不讀、不存、不印。
- 新 migration 的 `down_revision`：開工時跑 `cd backend; uv run alembic heads`。目前 main 上是 `d4a8f2c6e913`。如果 `ivy-website-admin-30` 的預售／裁罰評鑑 migration 已進 main，就接在它最後一支之後；還沒進就接 `d4a8f2c6e913`，並在交回報告裡註明「上線前要和另一案重接」。
  - **已完成（2026-10-20）**：開工時另一案還沒進 main，migration `76c4bf84b907` 先接 `d4a8f2c6e913`；另一案隨後併入 main `a5ac4998`，已 rebase 到 `ba1030b5` 並重接在它最後一支 `b8e2d6a4f931` 之後；稽核修正案隨後也併入 main（`dfd0a195`），再重接在它新增的 `a6c2e9f4b8d1` 之後（alembic 單一 head 已驗證），「上線前要和另一案重接」不再適用。實作紀錄見規格 §10。
- 對外請求的 User-Agent 沿用 `sync.USER_AGENT`，不帶任何帳號或 email。
- 文案：直白標題、不寫開發輔助字或載入字、不用眉標。數字欄用 `font-variant-numeric: tabular-nums`。
- 市佔率口徑：分子＝上學期（`semester=1`）四個年級的「日期欄註冊人數」相加，不含重讀保留生；分母＝同學年 9 月底、校址 3 公里內（里界面積重心 ≤ 3,000 m）的 2–5 歲戶籍人數。
- 驗收對照值（報告 I-9 §7）：
  - 秋季註冊：107=245、108=279、109=210、110=173、111=108、112=131、113=118、114=121、115=189
  - 分母：107=14,507、108=14,366、109=14,076、110=13,158、111=12,125、112=11,629、113=10,871、114=10,255、115=9,788
- 測試指令：
  - 後端：`cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_potential uv run pytest <路徑>`。測試庫先 `createdb ivy_website_test_potential`，再 `alembic upgrade head`。
  - 前端：`npm --prefix admin run test:unit -- <檔>`。
  - 8GB RAM，同時只跑一組測試。
- 這個 worktree 是 sparse checkout。跑全套 pytest 前要確認 `web content deploy` 目錄都在（記憶：缺了會有 89 個假紅燈）。
- 自己建 `backend/.venv`（`cd backend; uv sync --group dev --group extract`），不要 symlink 別人的 venv。

## Review Focus

1. 某學期某年級有空格（99、100 學年缺新生目標、參觀欄）→ 存 null，不當 0、不報錯（Task 2 測試 `test_missing_columns_become_none`）。
2. 某學年有註冊、但沒有那年 9 月人口（106 學年以前，或 10 月同步前的最新學年）→ 該學年列照回，`share` 為 null，前端顯示「—」，走勢斷開，不畫 0%（Task 6 `test_year_without_population_has_no_share`、Task 8 `null share renders dash`）。
3. 校區沒匯入歷年註冊（明華等四校）→ `status="not_imported"`，畫面只顯示一句「尚未匯入歷年註冊」（Task 6、Task 8）。
4. 校區地址還沒定位（`campus_point.locate_error` 有值）→ `status="no_campus_point"`，不丟 500（Task 6 `test_campus_without_point`）。
5. 同一份 JSON 匯入兩次，或匯入的學年範圍比上次少 → 該校整批取代、其他校不動（Task 3 `test_import_replaces_campus_only`）。

---

### Task 1: 資料表、migration、dataset 名稱

**Files:**
- Create: `backend/app/admissions/history/__init__.py`（空）、`backend/app/admissions/history/models.py`
- Modify: `backend/app/admissions/geo/models.py`（新增兩個類別；`DATASETS` 加 `'elementary'`，約 :56）
- Create: `backend/migrations/versions/<rev>_admissions_potential_share.py`（範本 `f2b8c4d1e7a9_peer_fees.py`）
- Modify: `backend/app/db.py` 或模型匯入處，讓 Alembic／metadata 看得到 `history.models`（照 `enrolled/models.py` 被 import 的方式）
- Modify: `admin/src/utils/systemStatusFormat.ts:32` `DATASET_LABELS` 加 `elementary: '國小一年級人數'`
- Modify: `backend/tests/test_system_status.py`（:339、:387 的數量 +1）
- Test: `backend/tests/test_potential_schema.py`

**Interfaces:**
- Produces（ORM 類別，後面任務都用）：
  - `CampusTermEnrollment`（`campus_term_enrollment`）：
    - PK (`campus_key String(16)`, `school_year Integer`, `semester Integer` 1／2, `grade String(4)`)
    - `as_of Date NOT NULL`、`registered Integer NOT NULL`、`imported_at DateTime(timezone=True) NOT NULL`
    - 可空 Integer：`target, returning_enrolled, returning_deposit, returning_registered, new_target, new_visits, new_deposits, new_registered, repeat_deposit, repeat_registered`
    - CHECK：`grade IN ('大班','中班','小班','幼幼班')`、`semester IN (1, 2)`
  - `GeoVillageAgesSeptember`（`geo_village_ages_september`）：
    - PK (`year Integer` 民國年, `village_code String(11)`)
    - `district String(8)`、`village String(16)`、`age_0`…`age_6 Integer NOT NULL`、`people_total Integer NOT NULL`
  - `GeoElementaryGrade1`（`geo_elementary_grade1`）：PK (`school_year Integer`, `school_code String(6)`)、`grade1 Integer NOT NULL`、`school_name String(32) NOT NULL`
  - `DATASETS` 多一個 `'elementary'`

- [ ] **Step 1: 寫失敗測試** `test_potential_schema.py`
  - `test_tables_exist`：三張表的欄位與 PK 和上面一致。檢查 `inspect(conn).get_pk_constraint`。
  - `test_grade_check_rejects_other`：insert `grade='其他'` 引發 `IntegrityError`。
  - `test_elementary_dataset_allowed`：`geo_dataset_status` 能 insert `dataset='elementary'`。
  - `test_downgrade_roundtrip`：`alembic downgrade -1` 後三張表都不在；`upgrade head` 回來。比照 `test_visit_exclusion_schema.py` 的寫法，`REVISION` 用新 rev。
- [ ] **Step 2: 跑測試，確認失敗**：`uv run pytest tests/test_potential_schema.py -v`，預期 FAIL（表不存在）。
- [ ] **Step 3: 寫 ORM 與 migration**
  - DATASET_CHECK 新字串＝現行字串尾端加 `, 'elementary'`；PREVIOUS 為現行字串。
  - downgrade 先 `DELETE FROM geo_dataset_status WHERE dataset = 'elementary'`。
  - 約束字串要和 `models.py` 逐字相同（`tests/test_geo_schema.py` 會檢查）。
- [ ] **Step 4: 跑測試**：`tests/test_potential_schema.py tests/test_geo_schema.py tests/test_system_status.py` 全 PASS；`npm --prefix admin run test:unit -- systemStatus` PASS。
- [ ] **Step 5: Commit** `feat(admissions): 歷年註冊、每年九月人口與國小一年級資料表`

### Task 2: 讀目標執行統計表（xls → 數字）

**Files:**
- Modify: `backend/pyproject.toml`：`[dependency-groups]` 新增 `extract = ["xlrd>=2.0,<3"]`；`dev` 加 `"xlrd>=2.0,<3"`、`"xlwt>=1.3,<2"`；跑 `uv lock`
- Create: `backend/app/admissions/history/workbook.py`
- Create: `backend/tests/history_helpers.py`（`make_workbook(sheets: dict[str, SheetSpec]) -> bytes`，用 xlwt 產生假檔）
- Test: `backend/tests/test_history_workbook.py`

**Interfaces:**
- Produces:
  - `class WorkbookError(ValueError)`：訊息一定含工作表名
  - `@dataclass(frozen=True) TermRow`：`school_year:int, semester:int, grade:str, as_of:date, registered:int`，以及 Task 1 那十個可空欄（同名，`int|None`）
  - `@dataclass(frozen=True) ParsedWorkbook`：`rows: tuple[TermRow, ...]`、`warnings: tuple[str, ...]`
  - `def parse_workbook(path: Path) -> ParsedWorkbook`
  - `def sheet_headers(path: Path) -> list[tuple[str, list[str], list[str]]]`：回（表名、正規化後第 2 列、正規化後第 3 列），給 `--headers-only` 用
  - `def parse_term_name(name: str) -> tuple[int, int]`：`'104上'→(104, 1)`、`'104下'→(104, 2)`
  - `def parse_as_of(text: str) -> date`：`'99.9.15'`、`'101.03.15'`、`'102.03.20'`、`'1150315'`（前面可接「註冊人數」等字）→ 西元日期
- 欄位對應演算法（測試定不出來，照這個寫）：
  1. 每格先去掉所有空白（含全形空白與換行），這叫「正規化」。
  2. 用第 0 欄的正規化文字找列：`大班`、`中班`、`小班`、`幼幼班`、`總人數`。不寫死列號，`114下` 的總人數在第 9 列。
  3. 第 2 列找三個區塊起點：含 `舊生`、`新生`、`大班重讀生` 的欄。第 2 列在 `舊生` 之前、文字以 `註冊人數` 結尾的那一欄＝`registered`，`as_of` 從它的前綴解析。第 1 欄＝`target`。
  4. 區塊內依第 3 列子欄名：
     - 含 `在籍` → `*_enrolled`
     - 含 `預繳人數` → `*_deposit` 或 `new_deposits`
     - 含 `目標人數` → `new_target`
     - 含 `參觀人數` → `new_visits`
     - 含 `註冊` 而且不含 `率` → `*_registered`
     - 其他（含 `率`）略過
     - 區塊名對應前綴：舊生 `returning_`、新生 `new_`、重讀 `repeat_`。
  5. 數值：空字串 → None；浮點數必須是整數值，否則 `WorkbookError`。`registered` 是 None 時也 `WorkbookError`。
  6. 總人數列的 `registered` ≠ 四個年級加總＋四個年級 `repeat_registered`（None 當 0）→ 加一筆 warning `"104上：總人數 193，四個年級加重讀 190，差 3"`。
  7. 只讀上述五列，其他列一律不碰。

- [ ] **Step 1: 寫失敗測試**（假檔由 `make_workbook` 產生，結構照真檔：第 0–1 列標題、第 2–3 列表頭、第 4–8 列年級、第 9 列以後放備註「*115上新生(3人)：王小明.李小華」）
  - `test_parses_modern_sheet`：`115上`（17 欄、`1150915`）→ 大班 `registered=62, returning_enrolled=43, new_visits=24, as_of=date(2026,9,15)`。
  - `test_parses_99_layout`：`99上`（14 欄、`99.9.15`、舊生子欄 `12/15預繳人數`、新生沒有目標與參觀）→ `new_target is None`、`new_visits is None`、`returning_deposit` 有值。
  - `test_parses_100_layout_with_extra_rate`：`100下`（18 欄、多「預繳註冊率」）→ 欄位不位移，`repeat_registered` 正確。
  - `test_total_row_found_by_label`：總人數放第 9 列、第 8 列放雜字 → 正常解析。
  - `test_missing_columns_become_none`：某格空字串 → None。
  - `test_total_mismatch_warns`：總人數 193、加總 190 → `warnings == ("104上：總人數 193，四個年級加重讀 190，差 3",)`，rows 照常輸出。
  - `test_notes_never_leak`：`repr(parse_workbook(p))` 與 `sheet_headers(p)` 的字串都不含 `王小明`、`李小華`。
  - `test_non_integer_count_rejected`：`56.5` → `WorkbookError`，訊息含 `115上`。
  - `test_parse_as_of` 參數化四種格式；`test_parse_term_name`。
- [ ] **Step 2: 跑測試確認失敗**：`uv run pytest tests/test_history_workbook.py -v` → FAIL（模組不存在）。
- [ ] **Step 3: 實作 `workbook.py`**：`xlrd.open_workbook(path, formatting_info=False)`；所有工作表依 `parse_term_name` 排序。
- [ ] **Step 4: 跑測試確認通過**。
- [ ] **Step 5: Commit** `feat(admissions): 讀目標執行統計表的年級列`

### Task 3: extract／import CLI 與整批匯入

**Files:**
- Create: `backend/app/admissions/history/payload.py`、`backend/app/admissions/history/importer.py`
- Modify: `backend/app/cli.py`：比照 `enrolled_match_options`（:744）／`enrolled_import_options`（:816）新增兩組 options＋command、用法字串（:879-882）、派發（:951-954）
- Test: `backend/tests/test_history_import.py`（`cli_db` fixture 比照 `test_enrolled_import.py:124`）

**Interfaces:**
- Consumes: `parse_workbook`、`sheet_headers`（Task 2），`CampusTermEnrollment`（Task 1），`CAMPUS_KEYS`
- Produces:
  - `FORMAT = "ivy-enrollment-history/1"`
  - `class TermRowIn(BaseModel)`：`extra="forbid"`；欄位同 `TermRow`；`grade: Literal['大班','中班','小班','幼幼班']`；`semester: Literal[1, 2]`；各數 `ge=0, le=999`
  - `class EnrollmentHistoryIn(BaseModel)`：`extra="forbid"`；`format: Literal["ivy-enrollment-history/1"]`、`campus_key`（驗 `CAMPUS_KEYS`）、`rows: list[TermRowIn] = Field(min_length=1, max_length=1000)`、`warnings: list[str] = Field(default_factory=list, max_length=200)`（每條 `max_length=120`）；驗證 (school_year, semester, grade) 不重複
  - `def build_payload(parsed: ParsedWorkbook, campus_key: str) -> dict`
  - `def load_payload(text: str) -> EnrollmentHistoryIn`、`describe_error`（只印 loc＋type，比照 `enrolled/importer.py:86`）
  - `async def replace_history(db: AsyncSession, payload: EnrollmentHistoryIn) -> int`：先刪該校所有列再寫入，回寫入列數；呼叫端 commit
- CLI：
  - `enrollment-history-extract --file <xls> --campus <key> --out <json>`，或 `--headers-only --file <xls>`（只印表名與正規化表頭）。xlrd 在函式內 import，ImportError 時 `SystemExit("要先在 backend 跑 uv sync --group extract")`。
  - `enrollment-history-import --file <json>`：印「匯入 {campus}：{n} 列（{最早學期}～{最新學期}）」，再逐條印 warnings。

- [ ] **Step 1: 寫失敗測試**
  - `test_extract_writes_numbers_only`：假檔 → 輸出 JSON 的 `format`、`campus_key`、`rows` 數量正確，整份文字不含假名。
  - `test_headers_only_prints_no_notes`：capsys 輸出不含假名。
  - `test_bad_payloads_are_rejected`：參數化——多欄位（例 `"names": []`）、未知校區、grade `其他`、重複學期年級、`format` 錯——都 `SystemExit`，訊息不含輸入值。
  - `test_import_replaces_campus_only`：先匯 yihua 兩學期、minghua 一學期；再匯 yihua 一學期 → yihua 只剩一學期，minghua 不變。
  - `test_import_prints_warnings`。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作 payload、importer、cli 兩組指令**。
- [ ] **Step 4: 跑測試確認通過**：`tests/test_history_import.py tests/test_history_workbook.py`。
- [ ] **Step 5: Commit** `feat(admissions): 歷年註冊的 extract 與 import 指令`

### Task 4: 每年 9 月底各里人口

**Files:**
- Modify: `backend/app/admissions/geo/population.py`：`_slim_row`（:107 附近 `parse_page` 的 object_hook）先把鍵 `lstrip("﻿")`
- Modify: `backend/app/admissions/geo/village_series.py`：同樣處理 `parse_page` 的鍵
- Create: `backend/app/admissions/geo/september.py`
- Modify: `backend/app/admissions/geo/sync.py`：`_write_population`（:930）與 `_write_age_history`（:946）寫入月份是 `MM == 09` 時，同一交易呼叫 `upsert_september`；新增 `sync_september_files(session_factory, files)`
- Modify: `backend/app/admissions/geo/bundle.py:26` `KINDS` 加 `"september"`；`backend/app/cli.py:606` `repeated` 加 `"--september-file": "september_files"`，連同 lists、options、bundle 解包（:672-690）；`run_geo_sync`（sync.py:1485）加參數 `september_files: list[Path] | None = None`
- Modify: `backend/scripts/fetch_geo_bundle.py`：新增 september 段，抓 `10709`、`10809`…到最新已公布年的 9 月，每頁存 `BundleFile(f"september-{yyymm}-{i}.json", "september", label, url, content)`
- Test: `backend/tests/test_geo_september.py`；fixture `backend/tests/fixtures/geo/ris-odrp014-10809-bom.json`（從現有 `ris-odrp014-11509-p1.json` 複製一份縮小版，第一個鍵改成 `﻿statistic_yyymm`）

**Interfaces:**
- Consumes: `population.parse_page`、`population.collect -> PopulationBatch`（`rows: PopulationRow(village_code, district, village, age_0..age_6, people_total)`）、`GeoVillageAgesSeptember`（Task 1）
- Produces:
  - `async def upsert_september(db: AsyncSession, year: int, rows: Iterable[PopulationRow]) -> int`：刪該年所有列再寫入，回列數
  - `async def september_years(db) -> list[int]`
  - `--september-file` 的檔只接受 `statistic_yyymm` 以 `09` 結尾，其他月份 `SystemExit`
  - 這條路**不寫** `geo_village_population`／`geo_village_ages`，不影響現行「使用中月份」

- [ ] **Step 1: 寫失敗測試**
  - `test_bom_key_is_stripped`：BOM fixture 經 `parse_page`＋`collect` 後列數與 2–5 歲加總正確。
  - `test_september_file_backfill`：`run_geo_sync(..., september_files=[10809 檔])` → `geo_village_ages_september` 有 year=108 的列；`geo_village_population` 不變。
  - `test_non_september_file_rejected`：11508 檔 → SystemExit。
  - `test_population_sync_september_also_upserts`：正常人口同步寫入 11509 → september 表多出 year=115。寫入 11510 → 不動 september 表。
  - `test_prune_does_not_touch_september`：ages prune 後 september 表列數不變。
  - `test_bundle_kind_september`：`open_bundle` 接受 kind `september`。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**。
- [ ] **Step 4: 跑測試確認通過**：`tests/test_geo_september.py tests/test_geo_population*.py tests/test_geo_bundle.py tests/test_geo_sync*.py`。
- [ ] **Step 5: Commit** `feat(admissions): 保存每年九月底各里人口`

### Task 5: 國小一年級人數

**Files:**
- Create: `backend/app/admissions/geo/elementary.py`
- Modify: `sync.py`：新增 `sync_elementary(session_factory, client, *, now, force, files)`，接進 `run_geo_sync`，dataset `elementary`，30 天檢查一次（比照 `_series_due`）
- Modify: `bundle.py` KINDS 加 `"elementary"`；cli `repeated` 加 `"--elementary-file": "elementary_files"`；`fetch_geo_bundle.py` 抓 107…最新學年
- Modify: `backend/app/config.py`：`geo_elementary_url_template: str = "https://stats.moe.gov.tw/files/detail/{year}/{year}_basec.csv"`（只收 https）
- Test: `backend/tests/test_geo_elementary.py`；fixtures `backend/tests/fixtures/geo/moe-basec-107.csv`（舊格式，無學年度欄）、`moe-basec-114.csv`（新格式）。內容是各 3 列：兩所高雄（含 `553610,市立光武國小`）、一所外縣市。

**Interfaces:**
- Consumes: `GeoElementaryGrade1`（Task 1）、`school_districts.schools()`
- Produces:
  - `def parse_basec(text: str, *, school_year: int) -> list[Grade1Row]`
    - `@dataclass(frozen=True) Grade1Row(school_code: str, school_name: str, grade1: int)`
    - 依表頭名取「縣市名稱」「學校代碼」「學校名稱」「1年級男學生數」「1年級女學生數」；只留縣市名稱＝`高雄市`
    - 若有「學年度」欄且和 `school_year` 不同 → `ValueError`
    - 缺任何必要表頭 → `ValueError("國小校別資料缺欄位：…")`
  - `def year_of_filename(name: str) -> int`：`'114_basec.csv' → 114`，不合格式 → `ValueError`
  - `async def replace_year(db, school_year: int, rows: list[Grade1Row]) -> int`
  - 自動同步：表內最新學年 ≥ 當前學年 −1 時只記 checked；否則從表內最新＋1 抓到當前學年 −1，404 視為還沒公布、不算錯。當前學年用 `constants` 既有的學年計算。高雄列數 < 200 → 不換、寫 `last_error`。

- [ ] **Step 1: 寫失敗測試**
  - `test_parse_old_format`：107 fixture → 兩列，光武 `grade1 == 226`（111＋115）。
  - `test_parse_new_format`：114 fixture → 光武 `grade1 == 178`（106＋72）。
  - `test_year_mismatch_rejected`、`test_missing_header_rejected`、`test_year_of_filename`。
  - `test_file_import_and_status`：`run_geo_sync(elementary_files=[...])` → 表有兩學年，`geo_dataset_status` `elementary` 有 `synced_at`。
  - `test_auto_sync_skips_unpublished`：mock httpx 回 404 → 不寫錯誤、不刪舊列。
  - `test_too_few_rows_kept_old`。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**。
- [ ] **Step 4: 跑測試確認通過**。
- [ ] **Step 5: Commit** `feat(admissions): 國小一年級人數同步`

### Task 6: 市佔率與分母對帳服務

**Files:**
- Create: `backend/app/admissions/share.py`
- Test: `backend/tests/test_admissions_share.py`

**Interfaces:**
- Consumes:
  - `CampusTermEnrollment`、`GeoVillageAgesSeptember`、`GeoElementaryGrade1`
  - `matcher.campus_point(db, campus_key) -> CampusPoint`
  - `boundaries.village_centroids()`、`boundaries.village_names()`、`projection.haversine_m`
  - `school_districts.by_village()`、`school_districts.by_school()`
- Produces: `async def query_share(db: AsyncSession, campus_key: str, *, radius_km: int = 3) -> dict`，回傳：
  ```
  {
    "status": "ready" | "not_imported" | "no_campus_point",
    "radius_km": 3,
    "latest": ShareYear | None,     # 最新一個 share 非 null 的學年
    "best": ShareYear | None,       # share 最高的學年
    "years": [ShareYear, ...],      # 依學年遞增，所有有上學期註冊的學年
    "elementary_check": ElementaryCheck | None,
    "notes": [str, ...],            # 例：「111 學年里界調整，鹽埕區 3 里合併計入」
  }
  ShareYear = {school_year, registered, children: int|None, villages: int|None, share: float|None, merged: bool}
  ElementaryCheck = {years: [{school_year, grade1, age6, ratio}], mean: float, latest_ratio: float, warn: bool}
  ```
- 規則：
  - 半徑內的里 R＝目前里界中，重心到校距離 ≤ `radius_km*1000` 的代碼（**不**四捨五入到 100 m）。
  - 年度 y 的分母：R 裡有 y 年資料的里，2–5 歲加總。
    - R 裡有代碼在 y 年沒有資料時，把 y 年資料中「不在目前里界、而且和缺漏代碼同區」的代碼一起計入，`merged=True`，並寫一條 note。
    - y 年完全沒有 September 列 → `children/villages/share = None`。
  - `share` ＝ `registered / children`，四捨五入到小數 4 位（比例，前端乘 100）。
  - 國小對帳：
    - S＝R 中各里在 `by_village()` 對到的所有學校。
    - y 年分子＝S 的 `grade1` 加總；分母＝Σ（S 中每校 `by_school()` 的每個里的 `age_6` ÷ 該里對到的學校數）。
    - `ratio` 四捨五入到 3 位。
    - `mean` 是**最新一年以外**各年的平均；`warn = abs(latest_ratio - mean) > 0.05`。
    - 少於 2 個學年有資料 → None。

- [ ] **Step 1: 寫失敗測試**（用 `located_campus` 的寫法 monkeypatch `campus_point` 到 22.6424556, 120.3437133；`village_centroids` monkeypatch 成小字典：三個近里、一個 4 km 外的里）
  - `test_share_formula_matches_report`：參數化報告 107–115 的（註冊、分母）。直接塞一個里的 2–5 歲＝報告分母、註冊列＝報告註冊 → `share` 依序為 0.0169、0.0194、0.0149、0.0131、0.0089、0.0113、0.0109、0.0118、0.0193。
  - `test_registered_excludes_repeat`：四個年級 56/80/41/11、`repeat_registered` 合計 5 → `registered == 188`。
  - `test_spring_rows_ignored`：只有 `semester=2` 的學年不出現在 `years`。
  - `test_far_village_excluded`：4 km 外的里不計入分母。
  - `test_year_without_population_has_no_share`：106 學年沒有 September 列 → `share is None`，`latest` 跳過它。
  - `test_merged_group_for_changed_codes`：114 年缺一個 R 代碼、多一個同區的舊代碼 → 舊代碼計入，`merged is True`，有 note。
  - `test_not_imported`、`test_campus_without_point`。
  - `test_elementary_check_ratio_and_warn`：兩所學校、三個學年，一里對到兩校時人數各半；最新一年偏 0.06 → `warn is True`；偏 0.04 → False。
  - `test_best_year`：`best.school_year` 是 share 最高的那年。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作 `share.py`**。
- [ ] **Step 4: 跑測試確認通過**。
- [ ] **Step 5: Commit** `feat(admissions): 計算三公里市佔率與國小一年級對帳`

### Task 7: API 端點與契約

**Files:**
- Modify: `backend/app/admissions/schemas.py`：新增 `PotentialShareYearOut`、`PotentialElementaryYearOut`、`PotentialElementaryCheckOut`、`PotentialShareOut`、`PotentialOut`（欄位對應 Task 6；`PotentialOut = {campus: AreaCampusOut, share: PotentialShareOut, generated_at: datetime}`）
- Modify: `backend/app/admissions/routes.py`：新增 `GET /admin/admissions/potential`（寫法照 :1016-1025 的 enrolled）
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重產）
- Modify: `admin/src/api/types.ts`：加 `export type Potential = components['schemas']['PotentialOut']`、`PotentialShareYear`
- Modify: `admin/src/api/admissions.ts`：`export function getPotential(campusKey: string): Promise<Potential>`
- Test: `backend/tests/test_admissions_potential_api.py`

**Interfaces:**
- Consumes: `query_share`（Task 6）、`area_service.campus_out`
- Produces: `GET /api/website/v1/admin/admissions/potential?campus_key=yihua` → `PotentialOut`；前端 `getPotential(campusKey)`

- [ ] **Step 1: 寫失敗測試**
  - `test_permissions`：比照 `test_admissions_enrolled.py:102`。reception／readonly／minghua／editor 403，admin 200，不存在的校區 404，未登入 401。
  - `test_payload_shape`：匯入兩學期加 September 列後，`share.years[*].share` 與 Task 6 一致，`campus.key == "yihua"`。
  - `test_no_store_header`：回應有 `Cache-Control: no-store`（中介層補的）。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作 schema 與 route；重產契約**：`npm run contract:generate`（根目錄；已用 `env -i`，不會動共用 venv）。
- [ ] **Step 4: 跑測試確認通過**：`uv run pytest tests/test_admissions_potential_api.py`、`npm run contract:check`、`npm --prefix admin run typecheck`。
- [ ] **Step 5: Commit** `feat(admissions): 招生潛力與市佔率 API`

### Task 8: admin 新子分頁

**Files:**
- Modify: `admin/src/admissions/useAdmissionsFilters.ts:19`：`STATS_SUBS` 在 `'journey'` 後面加 `'potential'`
- Modify: `admin/src/components/admissions/StatsTab.vue`：
  - `ownDataSub`（:52）加 `sub.value === 'potential'`
  - 在 journey pane（:502）之後加 `<el-tab-pane label="招生潛力與市佔率" name="stats-potential" lazy><PotentialTab :campus-key="campusKey" :active="sub === 'potential'" /></el-tab-pane>`
- Create: `admin/src/components/admissions/potential/PotentialTab.vue`、`ShareTrendChart.vue`、`potentialFormat.ts`
- Modify: `admin/src/__tests__/admissionsStatsView.test.ts:249` 的陣列斷言
- Test: `admin/src/__tests__/potentialTab.test.ts`、`admin/src/__tests__/potentialFormat.test.ts`

**Interfaces:**
- Consumes: `getPotential`、`Potential`（Task 7）
- Produces:
  - `potentialFormat.ts`：
    - `formatShare(value: number | null): string`：`0.0193 → '1.93%'`，null → `'—'`
    - `shareSentence(latest: PotentialShareYear): string`：`'189 ÷ 9,788 位'`
    - `bestSentence(best, latest): string`：`'歷年最高 1.94%（108 學年）'`；best 就是 latest 時回 `'是歷年最高'`
    - `elementarySentence(check): string`
  - `ShareTrendChart.vue`：props `years: PotentialShareYear[]`。手寫 SVG，`viewBox="0 0 520 160"`，`width="100%"`。
    - share 為 null 的點斷開線段（分成多條 polyline）。
    - x 軸只標第一、最高、最新三個學年。
    - 每點 `<circle>` 加 `<title>` 寫「108 學年：279 ÷ 14,366 位，1.94%」。
    - 顏色用既有 CSS 變數（主綠）。
    - 加 `role="img"` 與 `aria-label`，內容為「107 至 115 學年市佔率走勢」。
- 畫面（版面 A；這一波只有市佔率）：
  1. 大數字卡：標題「{latest.school_year} 學年市佔率（3 公里內 2–5 歲）」、大字 `formatShare`、下方兩行 `shareSentence`、`bestSentence`。
  2. `ShareTrendChart`。
  3. `<el-collapse>`「各學年數字」（預設收起）：表格欄位為學年、秋季註冊、3 公里內 2–5 歲、市佔率，可匯出 CSV（沿用既有 CSV 匯出 helper），`merged` 的學年後面加「*」，表下方列出 notes。
  4. 一行小字 `elementarySentence`：
     - 一般：「國小一年級對帳：114 學年周邊國小一年級 2,000 位，是 6 歲戶籍的 0.82（歷年 0.80–0.85）。」
     - `warn` 時改用黃字，並加一句「戶籍和實際就學差得比往年多，市佔率的分母可能偏高或偏低。」
  5. 一行來源小字：「註冊人數取自園內目標執行統計表（各學期 9/15）；孩子數取自內政部戶政司各里 9 月底人口；國小一年級取自教育部國民小學校別資料。市佔率的分子含住在 3 公里外的孩子。」
  - `status='not_imported'` → 只顯示「尚未匯入歷年註冊。」
  - `status='no_campus_point'` → 只顯示「分校地址還沒對到門牌，算不出 3 公里範圍。」
  - 載入失敗 → 沿用 StatsTab 既有的錯誤呈現。
  - 手機（≤ 760px）：卡片與圖滿版，表格改成卡片列表（比照 `NearbyKindergartens` 的寬窄切換）。

- [ ] **Step 1: 寫失敗測試**
  - `potentialFormat.test.ts`：`formatShare(0.0193) === '1.93%'`、`formatShare(null) === '—'`、`shareSentence({registered:189, children:9788}) === '189 ÷ 9,788 位'`、`bestSentence` 兩種情況、`elementarySentence` 兩種情況。
  - `potentialTab.test.ts`（mock `getPotential`）：
    - ready → 顯示「1.93%」「189 ÷ 9,788 位」「歷年最高 1.94%（108 學年）」。
    - null share renders dash：某學年 share null → 表格那列市佔率是「—」，SVG 有兩條 polyline。
    - not_imported → 只有「尚未匯入歷年註冊。」。
    - `warn` 時有黃字提醒那一句。
  - `admissionsStatsView.test.ts`：陣列加 `'potential'`；切到 `?sub=potential` 時不呼叫 `getStats`（因為是 ownDataSub）。
- [ ] **Step 2: 跑測試確認失敗**：`npm --prefix admin run test:unit -- potential admissionsStatsView`。
- [ ] **Step 3: 實作元件**。
- [ ] **Step 4: 跑測試確認通過**，再跑 `npm --prefix admin run typecheck`。
- [ ] **Step 5: Commit** `feat(admin): 招生統計新增招生潛力與市佔率分頁`

### Task 9: 真檔驗證、文件、全套

**Files:**
- Modify: `DESIGN.md`：
  - 在 :432「招生統計：區域分析地圖工作台」那一節之前，新增一節「## 招生統計：招生潛力與市佔率（2026-10-20，`feature/admissions-potential-20261020`）」，寫：口徑、版面 A、只給總部、這次推翻的「不做預測」只限本分頁（使用者 10-20 裁定）、不做清單（幼童車、續讀畫面、打分排名）。
  - 在 :148、:228、:239、:273、:412 的「不做…預測」後面各補「（招生潛力與市佔率分頁例外，見 2026-10-20）」。
- Modify: `docs/analysis/2026-09-30-enrollment-analytics-report.md:34` 同樣補一句。
- Modify: `docs/specs/2026-10-20-admissions-potential-share-design.md` 狀態列：第一波已實作（附 commit 範圍）。
- Modify: `backend/app/admissions/geo_data/README.md`：寫 september／elementary 的檔案匯入與打包方式。

- [ ] **Step 1: 真檔驗證（主 session 親自做，不交給 subagent）**
  - 在本機跑 `uv run python -m app.cli enrollment-history-extract --headers-only --file "<真檔>"`，確認 33 張表都認得。
  - 再跑 extract 輸出到 scratchpad，用 `jq` 或 python 算 107–115 學年上學期四個年級加總。
  - 預期和 Global Constraints 的秋季註冊值完全一致；有 warnings 就逐條記下來。
- [ ] **Step 2: 分母驗證**：本機測試庫用 `--september-file` 匯入 107–115 年 9 月檔（打包腳本抓），再呼叫 `query_share`。115 必須是 9,788；107–114 和報告分母差距 ≤ 2%，超過就寫原因。
- [ ] **Step 3: 寫文件**（上列四個檔）。
- [ ] **Step 4: 全套**
  - `cd backend; uv run pytest`（背景跑，主 session 等通知）。
  - `npm --prefix admin run test:unit`、`npm --prefix admin run typecheck`、`npm run contract:check`。
  - dev server 上用 Playwright 截桌機 1440×900、手機 390×844 的新分頁，看排版。
- [ ] **Step 5: Commit** `docs: 記錄招生潛力與市佔率第一波`
