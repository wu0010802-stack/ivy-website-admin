# 區域分析：任意點評估、五校版圖、各里房價租金 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 區域分析加上「地圖任意一點的周邊數字」、「五校在籍疊圖」、「各里房價與整戶月租中位數」。

**Architecture:** 後端在六支既有查詢加 `center` 參數，新模組 `area_point.py` 組裝任意點與本校兩欄，數字和單校、五校比較同一套計算；房價租金是新的公開資料集（實價登錄季檔買賣＋租賃，逐筆存、查詢時算中位數），掛進既有 geo 同步與 `/area/trends`；五校版圖是一支新端點＋後台新地圖模式。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async、Alembic、PostgreSQL；後台 Vue 3＋Element Plus＋Leaflet（動態載入）＋Vitest。

**Spec:** `docs/specs/2026-11-20-area-point-overlay-housing-design.md`（§11 是寫稿者裁定，和本文衝突時以規格為準）

## Global Constraints

- 工作目錄：`/Users/yilunwu/Repositories/ivy-website-wt/area-point-overlay-20261120`（sparse worktree，分支 `feature/area-point-overlay-20261120`）。不 `git add .`／`-A`，只加自己改的檔；不 push。
- Node 22：每個 npm 指令前 `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null;`（Node 25 會讓 vitest 假紅）。
- 後端測試一律：`cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pointoverlay1120_test uv run pytest -q <檔案>`。新 migration 後先跑 `WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pointoverlay1120_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pointoverlay1120_test WEBSITE_SESSION_SECRET=test-secret-pointoverlay-1120 uv run alembic upgrade head`。
- 機器 8GB：同時只跑一組測試；單一測試指令超過 10 分鐘無輸出會被中止，跑全套前先分檔。
- 後台測試：`npm --prefix admin run test:unit -- <檔名片段>`；型別 `npm --prefix admin run typecheck`。
- 改了 API schema 的任務最後都要 `npm run contract:generate` 並把 `contracts/` 的變更一起 commit；`npm run contract:check` 要過。
- 程式碼註解、測試名稱描述、UI 文字、commit 訊息：繁體中文（台灣用語）；Conventional Commit；commit 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 顏色只用 token（`admin/src/style.css` 的 `:root`），元件裡不寫色碼、rgba、oklch 字面值。
- 權限只用 `require_scope`／`_require_campus`／`covers_campus`，不寫 `role != SUPER_ADMIN`。
- 測試資料一律虛構：公司名、地址、學生點都不能來自真清冊；字串裡不得出現實體 U+FEFF（要 BOM 就寫 `"﻿"` 跳脫）。
- 房價：近 4 季；少於 5 筆中位數是 null；不著色、不排序、不判讀。
- 任意點座標小數 4 位；高雄範圍用 `app/admissions/geo/kaohsiung.py` 的 `KAOHSIUNG_LAT_RANGE`、`KAOHSIUNG_LNG_RANGE`。
- 五校版圖 gaps：已匯入的校 6 公里內、已匯入的校都 0 位、五校中最近的校不是未匯入的校；依 2–5 歲孩子數降冪取前 15。

## Review Focus

1. **圖釘落在高雄邊界外或海上**（`village_at` 回 None）：點卡片要照算（里名寫「—」），不能 500。→ Task 5 `test_point_outside_any_village_still_computes`。
2. **本校沒座標時的任意點**：第二欄 `unavailable="no_campus_point"`，第一欄照算。→ Task 5 `test_point_campus_column_without_campus_point`。
3. **實價季檔只出了買賣、租賃還沒出**（或反過來）：那一季跳過，不寫半季、不清掉舊資料。→ Task 2 `test_housing_sync_skips_season_missing_rent_file`。
4. **網址 `pt` 被手改成亂碼或高雄外**：當沒帶，畫面不放圖釘、不打 API。→ Task 8 `parseAreaViewQuery` 測試。
5. **五校都還沒匯入清冊**：五校版圖模式停用並寫原因，overview 的 gaps 是空的，不寫「每個里都沒人」。→ Task 6 `test_overview_no_campus_imported`、Task 11 `modeNote('campuses', …)` 測試。

---

## File Structure

**後端（新增）**
- `backend/app/admissions/geo/housing.py`：實價登錄買賣＋租賃季檔的解析、篩選、單價、寫入、保留 4 季、重比、中位數與查詢彙總。
- `backend/migrations/versions/<新>_geo_housing_deals.py`：只新增 `geo_housing_deals`。
- `backend/app/admissions/area_point.py`：任意點與本校兩欄的組裝、在籍點計數。
- `backend/app/admissions/enrolled/overview.py`：五校在籍彙總。
- 測試：`backend/tests/test_geo_housing.py`、`test_geo_housing_sync.py`、`test_admissions_area_center.py`、`test_admissions_area_point.py`、`test_admissions_enrolled_overview.py`。

**後端（修改）**
- `geo/models.py`（`GeoHousingDeal`）、`geo/new_homes.py`（`season_url` 加檔名參數）、`geo/sync.py`（`sync_housing`、`run_geo_sync`、`GeoSyncResult`、重比）、`app/cli.py`（`--housing-file`）。
- `area.py`、`opportunity.py`、`trends.py`、`peer_fees.py`、`presale_area.py`（`center`）、`trends.py`（房價欄位）。
- `schemas/area.py`、`schemas/trends.py`、`schemas/__init__.py`、`routes.py`。

**後台（新增）**
- `admin/src/components/admissions/area/PointCard.vue`、`pointFormat.ts`、`campusOverlay.ts`（五校版圖的純函式：色票 class、排行段、圖例）。
- 測試：`admin/src/__tests__/pointFormat.test.ts`、`pointCard.test.ts`、`campusOverlay.test.ts`。

**後台（修改）**
- `admin/src/admissions/areaView.ts`（`pt`、`campuses` 模式）、`admin/src/api/admissions.ts`、`admin/src/api/types.ts`、`AreaTab.vue`、`AreaMap.vue`、`AreaSidePane.vue`、`areaPane.ts`、`villageTable.ts`、`villageFacts.ts`、`VillageCard.vue`（如需）、`areaFormat.ts`、`admin/src/style.css`、`admin/src/utils/systemStatusFormat.ts`。

**其他**：`tests/stack/admissions-area.spec.ts`、`README.md`（頂部日期段）、`deploy/README.md`（房價同步一段）、`backend/app/admissions/geo_data/README.md`。

---

### Task 1: 房價租金資料模組與資料表

**Files:**
- Create: `backend/app/admissions/geo/housing.py`
- Create: `backend/migrations/versions/<rev>_geo_housing_deals.py`（down_revision `d8b1a9e5c274`；動手前 `git fetch origin main && git log origin/main --oneline -3 -- backend/migrations` 確認沒有新 head）
- Modify: `backend/app/admissions/geo/models.py`（`GeoHousingDeal`）、`backend/app/admissions/geo/new_homes.py:128`（`season_url(season, file_name=FILE_NAME)`）
- Test: `backend/tests/test_geo_housing.py`

**Interfaces:**
- Produces（`geo/housing.py`）：
  - 常數 `SALE_FILE = "e_lvr_land_a.csv"`、`RENT_FILE = "e_lvr_land_c.csv"`、`KEEP_SEASONS = 4`、`MIN_DEALS = 5`、`MIN_SEASON_ROWS = 1000`、`PING_M2 = 3.30579`、`SOURCE_NOTE = "內政部不動產交易實價查詢服務網"`、`RESIDENTIAL_TYPES = ("住宅大樓", "華廈", "公寓", "透天厝", "套房")`。
  - `class HousingFormatError(ValueError)`。
  - `@dataclass(frozen=True) class HousingRow`：`kind: Literal["sale","rent"]`、`serial`、`season`、`building_type`、`district`、`street`、`lane`、`alley`、`number: int|None`、`number_sub: int`、`unit_price: int|None`、`monthly_rent: int|None`；`key` property 同 `NewHomeRow.key`。
  - `@dataclass class HousingBatch`：`season: str`、`sales: list[HousingRow]`、`rents: list[HousingRow]`、`skipped: int`。
  - `parse_sales(text: str, season: str) -> list[HousingRow]`、`parse_rents(text: str, season: str) -> list[HousingRow]`、`parse_season(sale_text: str, rent_text: str, season: str, *, minimum: int = MIN_SEASON_ROWS) -> HousingBatch`（任一種少於 minimum raise `HousingFormatError`）。
  - `median(values: Sequence[int], *, minimum: int = MIN_DEALS) -> int | None`（偶數筆中間兩筆平均用 half-up：`(a + b + 1) // 2`，不用 Python 的 `round`）。
  - `async write_season(session_factory, batch: HousingBatch, *, now: datetime) -> str`（刪該季→以 `(kind, serial)` upsert，`where 舊.season < 新.season`→刪 4 季外→`geo_dataset_status` 的 `housing` 列 `active_version=label=最新季`、`synced_at=now`、`last_error=None`；同一交易）。
  - `async seasons_in_table(db) -> set[str]`、`async rematch(session_factory, *, keys_per_commit: int = 200) -> int`（照 `new_homes.rematch`）。
  - `async deals_by_code(db, codes: Collection[str]) -> tuple[str | None, list[str], dict[str, tuple[list[int], list[int]]]]`：(最新季, 近 4 季中表裡有的季, 代碼 → (單價清單, 月租清單))；只算 `match_level in VILLAGE_LEVELS` 的列（以 `boundaries.village_code(district, village)` 轉代碼）；沒匯入時 `(None, [], {})`。
  - `summarize(by_code: dict[str, tuple[list[int], list[int]]], codes: Iterable[str]) -> dict`：回 `{"sale_median", "sale_count", "rent_median", "rent_count"}`（多個代碼的清單合併後算中位數）。
- Produces（models）：`GeoHousingDeal`，表 `geo_housing_deals`，欄位照規格 §7.1「存什麼」；PK `(kind, serial)`；index `(season)`、`(district, village)`；`kind` 用 `String(4)`＋CheckConstraint `kind in ('sale','rent')`。

- [ ] **Step 1：寫失敗測試**（`test_geo_housing.py`，假 CSV 由測試內的 helper 組：兩列表頭＋資料列，第一欄前加 `"﻿"`）
  - `test_sale_keeps_ordinary_residential_and_computes_net_unit_price`：總價 12,000,000、車位總價 1,500,000、建物移轉總面積 120.0、車位面積 30.0 → `unit_price == 385700`（(10,500,000 ÷ (90 ÷ 3.30579)) 四捨五入到百元＝385,700）。
  - `test_sale_excludes_each_special_note`：參數化備註 親友／員工／特殊關係／共有人／瑕疵／急買急賣／政府機關／債權債務／拍賣／含增建／未登記建物／毛胚／預售屋 → 0 筆。
  - `test_sale_excludes_non_residential_and_multi_building`：主要用途「商業用」、建物型態「店面(店鋪)」、交易標的「土地」、交易筆棟數「土地1建物2車位0」、淨面積 9.9 m²、總價 0 → 各 0 筆。
  - `test_rent_keeps_whole_unit_only`：出租型態「獨立套房」「分租套房」排除；「整棟(戶)出租」＋住宅大樓、總額元 18500 → `monthly_rent == 18500`。
  - `test_rent_excludes_related_party_notes`：親友、員工、特殊關係 → 0 筆。
  - `test_parse_season_rejects_short_file`：買賣 999 筆可用 → `HousingFormatError`。
  - `test_median_needs_five`：`median([1,2,3,4]) is None`、`median([1,2,3,4,5]) == 3`、`median([1,2,3,4,5,6]) == 4`（3.5 四捨五入）。
  - `test_write_season_upserts_newer_season_and_prunes`（DB）：寫 115S1、115S2、115S3、115S4、116S1，表裡只剩後四季；同一 (sale, 編號) 出現在 115S3 和 115S4 時保留 115S4 那列；`geo_dataset_status["housing"].label == "116S1"`。
  - `test_deals_by_code_and_summarize`（DB）：兩個里各 3、4 筆 → 各自 `sale_median is None`，合併兩里 7 筆 → 有中位數、`sale_count == 7`。
- [ ] **Step 2：跑測試確認失敗**：`uv run pytest -q tests/test_geo_housing.py` → ImportError／fail。
- [ ] **Step 3：實作 models＋migration＋`housing.py`＋`season_url` 檔名參數。** 地址解析與比對直接用 `new_homes` 的 `_address`、`match_keys`、`_district_of`（必要時把底線函式改成公開名稱並保留舊名的別名，不改行為）。交易筆棟數用 `re.search(r"建物(\d+)", text)` 取建物數。檔頭檢查：必要欄位缺任何一個就 `HousingFormatError`（訊息不含檔案內容）。
- [ ] **Step 4：套 migration、跑 `tests/test_geo_housing.py tests/test_geo_new_homes.py` 全過。**
- [ ] **Step 5：commit** `feat(geo): 實價登錄房價租金資料表與解析`

### Task 2: 房價租金同步、CLI 與系統狀態

**Files:**
- Modify: `backend/app/admissions/geo/sync.py`（`sync_housing`、`run_geo_sync` 參數 `housing_files: list[Path] | None = None`、`GeoSyncResult` 加 `housing: str = "skipped"`、`housing_version: str | None = None`、`housing_seasons: int = 0`、`housing_rematched: int = 0`、重比段）、`backend/app/cli.py`（`--housing-file`，可給多次）、`admin/src/utils/systemStatusFormat.ts:42` 附近（`housing: '房價租金'`）
- Test: `backend/tests/test_geo_housing_sync.py`、`admin/src/__tests__/systemStatus.test.ts`（加一條標籤斷言）

**Interfaces:**
- Consumes：Task 1 的 `housing.parse_season`、`write_season`、`seasons_in_table`、`rematch`、`SALE_FILE`、`RENT_FILE`、`KEEP_SEASONS`；`new_homes.season_url(season, file_name)`、`new_homes.window(latest, count)`、`new_homes.decode`；`sync.discover_new_home_seasons`（`geo/sync.py:1716`）。
- Produces：`async sync_housing(session_factory, client, *, now, force, files: list[Path] | None) -> tuple[str, int]`。檔案模式：檔名必須含季別與檔名（`115S3_e_lvr_land_a.csv`、`115S3_e_lvr_land_c.csv`），同季要兩個檔都有，否則 `GeoSyncError`。網路模式：找最新季（沿用 `discover_new_home_seasons`）→ 最新往回 4 季、表裡沒有的逐季抓買賣＋租賃（force 時最新季重抓）→ 任一個檔是 None 就跳過該季。到期判斷 `_series_due`；預算常數 `HOUSING_TIME_BUDGET` 同 `NEW_HOMES_TIME_BUDGET`。
- CLI：`geo-sync --housing-file <CSV> ...`，同時算 file mode。

- [ ] **Step 1：失敗測試**（仿 `test_geo_sync.py` 裡新成屋的假 client 寫法）
  - `test_housing_sync_writes_latest_four_seasons`：假 client 對 115S1～116S1 的 a、c 都回合格內容 → 表裡 4 季、回傳 `("updated", 4)`。
  - `test_housing_sync_skips_season_missing_rent_file`：最新季 c 回錯誤頁 HTML → 那一季不寫、其他季照寫、舊資料不刪。
  - `test_housing_sync_records_error_and_keeps_old`：最新季買賣只有 10 筆 → `housing` 的 `last_error` 有字、表裡舊季還在、回 `failed`。
  - `test_housing_files_mode_requires_pairs`：只給 `115S3_e_lvr_land_a.csv` → `GeoSyncError`。
  - `test_run_geo_sync_rematches_housing_after_doorplate_change`：門牌版本換掉後，`housing_rematched > 0`。
- [ ] **Step 2：確認失敗。**
- [ ] **Step 3：實作。** `run_geo_sync` 在新成屋之後呼叫；重比放在新成屋重比之後、各自 try/except、失敗只記在 `housing`。
- [ ] **Step 4：跑 `tests/test_geo_housing_sync.py tests/test_geo_sync.py`、`npm --prefix admin run test:unit -- systemStatus` 全過。**
- [ ] **Step 5：commit** `feat(geo): 房價租金季檔自動同步與 geo-sync --housing-file`

### Task 3: `/area/trends` 各里房價租金欄位

**Files:**
- Modify: `backend/app/admissions/trends.py`（`query_trends` 非 kids_only 時讀房價）、`backend/app/admissions/schemas/trends.py`（里列四欄、`sources.housing`）、`contracts/*`
- Test: `backend/tests/test_admissions_trends.py`（追加）

**Interfaces:**
- Consumes：Task 1 `housing.deals_by_code`、`housing.summarize`、`housing.SOURCE_NOTE`。
- Produces：里列 `housing_sale_median: int | None`、`housing_sale_count: int`、`housing_rent_median: int | None`、`housing_rent_count: int`（沒匯入時中位數 null、筆數 0）；`sources.housing: { latest: str | None, seasons: list[str], note: str }`（note＝`f"{SOURCE_NOTE}；近 4 季，排除親友、特殊關係、預售屋交屋等非一般交易，房價扣除車位"`，沒匯入是空字串）。合併組用組內全部代碼合併算。`kids_only` 不讀、欄位維持預設。

- [ ] **Step 1：失敗測試**：`test_trends_village_housing_columns`（單一里 6 筆買賣、2 筆租賃 → 有房價中位數、月租 null、count 2）、`test_trends_merged_group_housing_combines_codes`、`test_trends_housing_not_imported`、`test_trends_kids_only_skips_housing`。
- [ ] **Step 2：確認失敗。** **Step 3：實作＋`npm run contract:generate`。** **Step 4：跑 `tests/test_admissions_trends.py tests/test_auditfix_trends_merged_radius.py tests/test_admissions_area_compare.py`、`npm run contract:check`。**
- [ ] **Step 5：commit** `feat(admissions): 里的變化加各里房價與整戶月租中位數`

### Task 4: 六支查詢加 `center`

**Files:**
- Modify: `backend/app/admissions/area.py`（`point_center`、`query_babycare`、`query_changes`）、`opportunity.py:117`、`trends.py:437`、`peer_fees.py:47`、`presale_area.py:30`
- Test: `backend/tests/test_admissions_area_center.py`

**Interfaces:**
- Produces：
  - `area.point_center(lat: float, lng: float) -> dict[str, Any]`：`{"key": "", "name": "這一點", "lat": lat, "lng": lng, "locate_error": None, "district": <village_at 反查的區或 None>}`（`boundaries.village_at(lng, lat)` 參數 lng 在前；名稱用 `boundaries.village_names()[code]`）。
  - 六支函式簽名：第二個位置參數 `campus_key: str | None`，新增 keyword-only `center: dict[str, Any] | None = None`；兩個都沒給 raise `ValueError`。給了 `center`：opportunity 不讀參觀；peer_fees 不找本校（`own`、`own_missing` 都 null、不排名）；babycare 的 `own_age2_monthly` null；trends 只允許 `kids_only=True`（否則 `ValueError`）；回應的 `campus` 欄位放 `center`，`filters.campus_key` 放 `""`。
- 不給 `center` 時行為完全不變。

- [ ] **Step 1：失敗測試**：
  - `test_center_equals_campus_for_public_numbers`：seed 一個有座標的校（用 `admissions_area_helpers` 的既有 helper）＋人口、幼兒園、托嬰、預售、異動；以 `point_center(該校 lat, lng)` 呼叫六支，和用 `campus_key` 呼叫的結果比：opportunity `baseline.children`／`infants`、trends（kids_only）`baseline.kids_net`、peer_fees `groups`（各類 schools、median）、babycare `summary.count`、changes `items`、presale `summary` 相等。
  - `test_center_skips_campus_specific_parts`：peer_fees `own is None and own_missing is None`、所有 group `own_rank is None`；opportunity `baseline.visit == 0`。
  - `test_requires_campus_or_center`：兩個都沒給 → `ValueError`；trends 完整模式給 center → `ValueError`。
- [ ] **Step 2：確認失敗。** **Step 3：實作。**
- [ ] **Step 4：跑 `tests/test_admissions_area_center.py tests/test_admissions_area.py tests/test_admissions_area_compare.py tests/test_admissions_trends.py tests/test_admissions_presale_area.py` 與 `grep -l "query_opportunity\|query_peer_fees\|query_babycare\|query_changes\|query_presale\|query_trends" backend/tests/*.py` 列出的其他檔，全過。**
- [ ] **Step 5：commit** `refactor(admissions): 區域分析查詢可指定任意圓心`

### Task 5: `/area/point` 與 `/area/locate`

**Files:**
- Create: `backend/app/admissions/area_point.py`
- Modify: `backend/app/admissions/schemas/area.py`（`AreaPointHousingOut`、`AreaPointEnrolledOut`、`AreaPointRowOut`、`AreaPointRowsOut`、`AreaPointPlaceOut`、`AreaPointNearestOut`、`AreaPointSourcesOut`、`AreaPointOut`、`AreaLocateOut`）、`schemas/__init__.py`、`routes.py`、`contracts/*`
- Test: `backend/tests/test_admissions_area_point.py`

**Interfaces:**
- Consumes：Task 4 的 `center`、`point_center`；Task 1 的 `deals_by_code`、`summarize`；`area_compare._row` 的組裝方式（同一組欄位）。
- Produces：
  - `area_point.POINT_DECIMALS = 4`。
  - `async point_row(db, center: dict, radius_km: int) -> dict`（savepoint；出錯 `unavailable="error"`）。
  - `async query_point(db, *, lat: float, lng: float, radius_km: int, campus_key: str | None) -> dict`（形狀＝規格 §5.2 `AreaPointOut`）。
  - 路由 `GET /admin/admissions/area/point`（`lat: float`、`lng: float`、`radius_km` 用 `_require_integer_radius`、`campus_key: str | None = None`）；範圍外 422，`detail.code = "POINT_OUT_OF_RANGE"`（錯誤格式照 `_invalid_radius()` 的寫法）。
  - 路由 `GET /admin/admissions/area/locate?address=`：回 `AreaLocateOut {lat, lng, district, village, match_level}`；找不到 404 `detail.code = "ADDRESS_NOT_FOUND"`、`detail.reason = unlocated_reason`；地址 strip 後長度 1–100，否則 422。兩支都只讀、不寫稽核。
  - 在籍計數：`EnrolledStudentPoint` lat/lng 非 null、haversine ≤ 半徑；只列 `EnrolledRoster` 有列的校，順序照 `CAMPUS_KEYS`，count 可為 0。

- [ ] **Step 1：失敗測試**：
  - `test_point_requires_stats_scope`：分校管理者 403。
  - `test_point_out_of_range`：`lat=25.03,lng=121.56` → 422 `POINT_OUT_OF_RANGE`。
  - `test_point_campus_column_matches_area_compare`：同校同半徑，`rows.campus` 的 children、kids_net、kindergartens、babycare、changes_12m 等於 `/area/compare` 該校列，`fee_median == compare.fee_median`。
  - `test_point_campus_column_without_campus_point`：校址比對不到 → `rows.campus.unavailable == "no_campus_point"`，`rows.point` 照算。
  - `test_point_outside_any_village_still_computes`：高雄範圍內但不在任何里界（例如海上 22.55, 120.20）→ 200、`point.village is None`。
  - `test_point_counts_enrolled_within_radius`：兩校各匯入幾個虛構點，半徑內外各有 → 計數正確、沒匯入的校不列。
  - `test_point_housing_summary`：圈內 6 筆買賣 → `housing.sale_median` 有值；房價沒匯入 → `housing is None`。
  - `test_point_rounds_to_four_decimals`：`lat=22.627349` → 回應 `point.lat == 22.6273`。
  - `test_locate_found` ／ `test_locate_not_found_reason` ／ `test_locate_rejects_long_address` ／ `test_locate_writes_no_audit`（呼叫後稽核表筆數不變）。
- [ ] **Step 2：確認失敗。** **Step 3：實作＋contract:generate。** **Step 4：跑新測試檔＋`tests/test_admissions_area_compare.py`、`contract:check`、`tests/test_permission_table.py`。**
- [ ] **Step 5：commit** `feat(admissions): 區域分析任意點評估與地址定位 API`

### Task 6: `/area/enrolled-overview`

**Files:**
- Create: `backend/app/admissions/enrolled/overview.py`
- Modify: `schemas/area.py`（`AreaOverviewCampusOut`、`AreaOverviewPointOut`、`AreaOverviewVillageOut`、`AreaOverviewGapOut`、`AreaEnrolledOverviewOut`）、`schemas/__init__.py`、`routes.py`、`contracts/*`
- Test: `backend/tests/test_admissions_enrolled_overview.py`（用 `tests/enrolled_helpers.py`）

**Interfaces:**
- Produces：`GAP_RADIUS_KM = 6`、`GAP_LIMIT = 15`；`async query_enrolled_overview(db, campus_keys: list[str]) -> dict`（形狀＝規格 §6.2）；路由 `GET /admin/admissions/area/enrolled-overview`，權限同 `/area/compare`。gaps 規則見 Global Constraints；人口用 `opportunity` 的 `AGE_BAND` 與 `_sum_ages`（必要時改成公開名稱）。

- [ ] **Step 1：失敗測試**：`test_overview_merges_points_per_campus_cell`（同校同格兩人 → 一點 count 2，不帶 grade）、`test_overview_village_counts_and_overlap`（一個里兩校都有 → 在 overlap，依 total 降冪）、`test_overview_gaps_rules`（6 公里外不列、已匯入校有人的不列、最近的校是未匯入的不列、前 15）、`test_overview_no_campus_imported`（gaps 空、campuses 全 `imported=False`）、`test_overview_population_missing`、`test_overview_requires_stats_scope`。
- [ ] **Step 2–4：** 同上模式；跑新檔＋`tests/test_admissions_enrolled.py`、`contract:check`。
- [ ] **Step 5：commit** `feat(admissions): 五校在籍彙總 API`

### Task 7: 後台各里表、里卡片、CSV 加房價租金

**Files:**
- Modify: `admin/src/components/admissions/area/areaFormat.ts`（`housingPriceText(median: number | null, count: number): string`→`"29.9"`／`"—"`；`housingRentText(...)`→`"18,500"`／`"—"`；萬元／坪＝元／坪 ÷ 10000 取一位小數）、`villageTable.ts`（所得之後兩欄 `housing_price_text`「房價中位（萬／坪）」、`housing_rent_text`「整戶月租中位」；CSV 加 `housing_price`、`housing_price_count`、`housing_rent`、`housing_rent_count` 四欄與一行備註；**不加排序選項**）、`villageFacts.ts`（所得列之後兩列，detail「近 4 季 N 筆」）、`AreaTables.vue`／資料來源那一句（`trends.sources.housing.note` 有字才顯示）
- Test: `admin/src/__tests__/areaFormat.test.ts`、`villageTable.test.ts`、`villageFacts.test.ts`（追加）

- [ ] **Step 1：失敗測試**：`housingPriceText(385700, 6) === '38.6'`、`housingPriceText(null, 3) === '—'`、`housingRentText(18500, 9) === '18,500'`；各里表欄位順序 `income_text` 後緊接兩欄；`villageSortOptions` 不含房價；CSV 表頭含四欄；里卡片兩列與 detail「近 4 季 6 筆」。
- [ ] **Step 2–4：** `npm --prefix admin run test:unit -- areaFormat villageTable villageFacts`、`typecheck`。
- [ ] **Step 5：commit** `feat(admin): 各里表與里卡片加房價、整戶月租中位數`

### Task 8: 網址 `pt`、`campuses` 模式、API 函式

**Files:**
- Modify: `admin/src/admissions/areaView.ts`、`admin/src/api/admissions.ts`、`admin/src/api/types.ts`
- Test: `admin/src/__tests__/areaView.test.ts`（追加）、`admin/src/__tests__/` 既有 api 測試若有就追加

**Interfaces:**
- Produces：
  - `MapMode` 加 `'campuses'`，`MAP_MODES` 第二項 `{ value: 'campuses', label: '五校版圖' }`。
  - `AreaView` 加 `point: { lat: number; lng: number } | null`（預設 null）；`parseAreaViewQuery` 讀 `pt=<lat>,<lng>`（兩個數字、小數最多 6 位、在高雄範圍 lat 22.4–23.5／lng 120.1–121.1）→ 四捨五入 4 位；`areaViewQuery` 寫 `pt=22.6273,120.3014`（`toFixed(4)`）。
  - `getAreaPoint(params: { lat: number; lng: number; radiusKm: 1|3|6; campusKey: string }): Promise<AreaPoint>`、`locateAreaAddress(address: string): Promise<AreaLocate>`、`getAreaEnrolledOverview(): Promise<AreaEnrolledOverview>`；型別別名 `AreaPoint`、`AreaPointRow`、`AreaLocate`、`AreaEnrolledOverview` 取自 `components['schemas']`。

- [ ] **Step 1：失敗測試**：`pt=22.627349,120.30142` → `{lat:22.6273,lng:120.3014}`；`pt=abc`、`pt=25.03,121.56`、`pt=22.6` → null；輸出不帶 null 的 pt；`map=campuses` 解析成功。
- [ ] **Step 2–4：** `test:unit -- areaView`、`typecheck`。
- [ ] **Step 5：commit** `feat(admin): 區域分析網址記住圖釘位置與五校版圖模式`

### Task 9: 地點卡片（純畫面）

**Files:**
- Create: `admin/src/components/admissions/area/pointFormat.ts`、`PointCard.vue`
- Test: `admin/src/__tests__/pointFormat.test.ts`、`admin/src/__tests__/pointCard.test.ts`

**Interfaces:**
- Consumes：Task 8 型別 `AreaPoint`、`AreaPointRow`；Task 7 `housingPriceText`、`housingRentText`；`campusLabel`；`campusNotLocatedReason`；五校比較表的 `kids_unavailable` 文字（`areaCompareFormat.ts`）。
- Produces：
  - `pointRows(data: AreaPoint, campusName: string): { label: string; point: string; campus: string }[]`：列順序與文字照規格 §5.1 示意（2–5 歲孩子、0–1 歲、這一年淨增、幼兒園（私立／準公共／公立／非營利）、托嬰、私立一般 3 歲一學期中位、在建預售（戶）、近 12 個月園所異動、房價中位數（萬元／坪）、整戶月租中位數（元）、常春藤在籍住在圈內）。
  - `pointPlace(data: AreaPoint): string`（例「三民區寶興里・最近的校區 義華 1.8 公里」；沒里寫「不在任何里界內」）。
  - `pointSources(data: AreaPoint): string`（例「人口 115-10・收費 114 學年・實價 115S3（近 4 季）」，缺的那段省略）。
  - `PointCard.vue` props `{ data: AreaPoint | null; loading: boolean; failed: boolean; campusName: string; radiusKm: 1|3|6 }`，emits `clear`、`retry`；標題「這一點 {radius} 公里內」；有 `focusTitle()` expose（同 `VillageCard`）。
- [ ] **Step 1：失敗測試**：房價少於 5 筆顯示「—（3 筆）」；本校沒座標時第二欄全「—」且欄頭有原因；在籍列「義華 40・明華 3」與「其他已匯入的校 0 位」、全沒匯入「尚未匯入清冊」；loading 骨架、failed 有重試鈕且 emit `retry`。
- [ ] **Step 2–4：** `test:unit -- pointFormat pointCard`、`typecheck`。
- [ ] **Step 5：commit** `feat(admin): 區域分析地點卡片`

### Task 10: 工具列、地圖圖釘、右欄串接

**Files:**
- Modify: `AreaTab.vue`（「地點」工具列群組、讀 `/area/point`、Esc、地址定位）、`AreaMap.vue`（props `point`、`placing`；emits `place-point`；圖釘 divIcon 可拖曳、圖釘圈 `className: 'area-point-radius'`；`placing` 時 map 加 class 讓游標變十字，點地圖 emit `place-point` 並且不 emit `select-village`）、`AreaSidePane.vue`（prop `point?: boolean`、slot `point`：`facts` 優先、其次 `point`、其次排行；排行區用 v-show 隱藏以保住同業 slot 狀態）、`admin/src/style.css`（`--area-point`）
- Test: `admin/src/__tests__/areaTab.test.ts`、`areaMap.test.ts`、`areaSidePane.test.ts`（追加）

**Interfaces:**
- Consumes：Task 8 `AreaView.point`、`getAreaPoint`、`locateAreaAddress`；Task 9 `PointCard`。
- `AreaMap` emits `'place-point': [payload: { lat: number; lng: number }]`（座標四捨五入 4 位）。拖曳結束（`dragend`）也 emit `place-point`。
- `AreaTab`：`patchView({ point })`；`watch([view.point, radiusKm, campusKey])` 用 `useRequestSequence` 讀 `getAreaPoint`；地址定位成功 → `patchView({ point })`＋地圖移過去；失敗把原因寫在輸入框下方（404 依 `detail.reason` 對到「找不到這個門牌」「不在高雄市」「門牌資料尚未匯入」，其他「找不到這個地址」）。放點狀態按鈕 `aria-pressed`。

- [ ] **Step 1：失敗測試**：按「放一個點」後地圖 emit `place-point` → 網址 `pt` 被寫入、右欄出現地點卡片；有圖釘時點里 → 里卡片優先，關掉後回到地點卡片；「清除」移除 `pt`；`placing` 時地圖點擊不 emit `select-village`（`areaMap.test.ts` 用既有 Leaflet mock 寫法）；地址找不到顯示原因；換範圍會重新讀 `/area/point`。
- [ ] **Step 2–4：** `test:unit -- areaTab areaMap areaSidePane`、`typecheck`。
- [ ] **Step 5：commit** `feat(admin): 區域分析可在地圖放圖釘或輸入地址評估任意點`

### Task 11: 五校版圖模式

**Files:**
- Create: `admin/src/components/admissions/area/campusOverlay.ts`
- Modify: `admin/src/style.css`（`--area-campus-<key>` 五色，key 照 `CAMPUS_KEYS`；附一行理由）、`AreaMap.vue`（props `overview?: AreaEnrolledOverview | null`；`campuses` 模式畫各校色點、五校星形、依幾校在收著色的里 class）、`areaPane.ts`（`ModeNotes` 加 `campuses: string`；`modeNote`／`rankingFor`／`paneHead` 支援 `campuses`）、`AreaTab.vue`（切到 `campuses` 才讀 overview，失敗可重試）、`villageFacts.ts`／`VillageCard.vue`（`campuses` 模式下在籍列各校分列）
- Test: `admin/src/__tests__/campusOverlay.test.ts`、`areaPane.test.ts`、`areaMap.test.ts`、`villageFacts.test.ts`（追加）

**Interfaces:**
- Produces（`campusOverlay.ts`）：`campusClass(key: string): string`（`area-campus area-campus--<key>`）、`overlayLevel(village: { counts: Record<string, number> }): 0 | 1 | 3`、`overlaySections(overview: AreaEnrolledOverview, campusName: (key: string) => string): RankingSection[]`（兩段，標題「兩校以上都在收的里」「孩子多、五校都沒有在籍的里」）、`overlayLegend(overview): { key: string; label: string; count: string; imported: boolean }[]`、`overlayNote(overview): string`（「只算已匯入清冊的校：義華、明華」；全沒匯入回 `'還沒有任何校區匯入在籍清冊'`）。
- `modeNote('campuses', notes)` 回 `notes.campuses`（AreaTab 在 overview 讀到且全沒匯入時給 `overlayNote` 的文字，其餘空字串）。

- [ ] **Step 1：失敗測試**：`overlayLevel` 0／1／2 校 → 0／1／3；overlap 段依合計降冪、每列 detail 是「義華 3・明華 2」；gaps 段 value「2–5 歲 412 位」、distance「義華 2.1 公里」；圖例未匯入的校 `imported=false`；`modeNote('campuses', {…campuses:'還沒有任何校區匯入在籍清冊'})` 停用；`AreaMap` 在 `campuses` 模式畫出各校色點 class；里卡片在 `campuses` 模式列各校人數。
- [ ] **Step 2：確認失敗。** **Step 3：實作。** 五色挑選：和 `--area-kind-*`、`--area-chance`、`--area-kind-babycare` 色相相距 ≥ 30°，白底對比 ≥ 3:1（用 `node -e` 算 OKLCH→sRGB 對比寫進 commit 說明）。
- [ ] **Step 4：** `test:unit -- campusOverlay areaPane areaMap villageFacts areaTab`、`typecheck`。
- [ ] **Step 5：commit** `feat(admin): 區域分析五校版圖`

### Task 12: e2e、文件與全套驗證

**Files:**
- Modify: `tests/stack/admissions-area.spec.ts`（放圖釘看到卡片、輸入地址、切到五校版圖看到圖例；stack 的 seed 若沒有房價或在籍資料，用該 spec 既有的 seed 方式補虛構資料）、`README.md`（頂部 `## 2026-11-20` 段）、`deploy/README.md`（「公開地理資料同步」加房價租金：資料集 `housing`、`geo-sync --force`、離線 `--housing-file`）、`backend/app/admissions/geo_data/README.md`（來源與篩選摘要）、規格 §11（實作中新的裁定）
- [ ] **Step 1：** 寫 e2e；`npm run e2e:build` 後 `E2E_DB_NAME=ivy_website_pointoverlay1120_e2e_test npx playwright test -c playwright.stack.config.ts tests/stack/admissions-area.spec.ts --project=chrome` 過。
- [ ] **Step 2：全套**（一次一組）：後端 `uv run pytest -q`（分 `tests/test_a*`、`tests/test_[b-f]*`、`tests/test_g*`、其餘四批避免 10 分鐘無輸出）；`npm --prefix admin run test:unit`；`npm --prefix admin run typecheck`；`npm --prefix web run typecheck`；`npm run test:website`；`npm run contract:check`；`python3 -m unittest discover -s deploy/tests`。
- [ ] **Step 3：真資料量測**（不進 repo）：用 scratchpad 的 115S3 檔跑 `parse_season`，回報買賣、租賃可用筆數；有本機門牌庫就量「≥5 筆的里數」，沒有就註明沒量。
- [ ] **Step 4：commit** `docs: 區域分析任意點、五校版圖、房價租金上線前文件與 e2e`
