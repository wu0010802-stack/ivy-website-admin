# 招生區域分析 Implementation Plan（總覽）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官網後台「招生入學 → 統計分析」新增「區域分析」子分頁：家長來源依行政區／里統計、里界著色地圖、附近幼兒園、來源距離分布；地址只在官網資料庫內以公開門牌資料比對。

**Architecture:** 後端新增 `app/admissions/geo/` 子套件，負責公開資料（高雄門牌、幼兒園、里界）的匯入與比對；訪視地址變更時同交易寫 `recruitment_visit_geo`。新 API `/admin/admissions/area*` 只讀聚合。後台 `StatsTab` 新增 lazy 子分頁，地圖用 Leaflet＋國土測繪圖磚。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy 2.0 async＋asyncpg、Alembic、PostgreSQL；Vue 3＋Element Plus＋Vite 8＋Vitest；Leaflet 1.9.4（新增）。

**Spec:** `docs/specs/2026-10-08-admissions-area-design.md`（以下稱「規格」）

本計畫分四份，**依序執行，階段間有硬閘**（前一階段全部任務完成、該階段的驗證指令全綠才開始下一階段）：

| 階段 | 檔案 | 內容 |
|---|---|---|
| A | `2026-10-08-admissions-area-A-geo.md` | 地址解析、座標轉換、geo 資料表與 migration、門牌／幼兒園匯入、比對、同步迴圈、CLI、里界檔、實際資料驗證 |
| B | `2026-10-08-admissions-area-B-api.md` | 訪視建立／更新時比對、匿名化、`/area` 三支 API、明細篩選與 `geo` 欄位、契約重產 |
| C | `2026-10-08-admissions-area-C-admin.md` | 後台 API client、子分頁、三張表、地圖、幼兒園清單、明細篩選 chip 與比對結果、CSP、stack e2e、文件回寫、最終驗證 |

## Global Constraints

- 工作目錄：`~/Repositories/ivy-website-wt/admissions-area-20261008`（sparse worktree，分支 `feature/admissions-area-20261008`，基準 origin/main `82937a9f`）。不要動 `~/Desktop/ivy-website-admin`。
- Node 22（`.nvmrc`）。`source ~/.nvm/nvm.sh` 會回傳 3，Node 指令用 `;` 串、不要用 `&&`：`source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit`。
- 後端用 worktree 自己的 venv：`cd backend; uv sync`（不要 symlink 別的 worktree 的 `.venv`）。
- 測試庫獨立：`createdb ivy_website_area1008_test`，`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test`；先 `WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run alembic upgrade head`。
- FastAPI 0.136.1 釘版，不升。**不新增 Python 依賴**（座標轉換自己寫、下載用既有 `httpx`、CSV 用標準庫）。
- 後台只新增 `leaflet@1.9.4` 與 `@types/leaflet`（devDependency）；不裝圖表套件、不裝地圖外掛。
- 家長地址不得送任何外部服務；log、錯誤訊息、`geo_dataset_status.last_error` 都不得含地址。
- 測試不連外：HTTP 一律用 `httpx.MockTransport`；公開資料用 `backend/tests/fixtures/geo/` 的小樣本。
- `WEBSITE_GEO_AUTO_SYNC` 所有環境預設 false。
- 顏色一律走 CSS token，不寫 rgba／oklch 字面值（`CLAUDE.md` 設計硬規則）。
- 文案：繁體中文台灣用語；不寫開發輔助用字（操作說明、載入中字樣之外的狀態字）；表頭沿用其他子分頁的「參觀人數／預繳人數／預繳率」。
- 計數與比率沿用 `backend/app/admissions/stats.py` 的 `COUNT_FIELDS`、`pct`（分母 0 回 None）。
- 機器 8GB RAM：同一時間只跑一組測試；全套 pytest 由主 session 背景跑（子代理跑超過 10 分鐘會被中止）。
- Commit：只在使用者同意的前提下於本分支 commit（Conventional Commit、繁體中文、結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`）；不 push、不部署。

## Review Focus

1. **地址寫法變體**（全形半形混用、`12-1號`／`12之1號`、`3F`／`3樓之2`、沒寫「高雄市」、寫了「○○里○鄰」、郵遞區號在前）：一律解析出同一個門牌。→ A1 的參數化測試。
2. **把地址改成空白或改到外縣市**：`recruitment_visit_geo` 變 `unlocated`、`recruitment_visits.district` 清成 NULL，舊的里不殘留。→ B1 測試。
3. **門牌同步中途失敗**（下載斷線、CSV 欄位變了）：舊版本照常可查，統計不變，`last_error` 有原因且不含地址。→ A6 測試。
4. **校址比對不到**（內容裡校址被改成錯字）：`/area` 距離分組全部落在 `none`、`campus.locate_error` 有值，`/area/kindergartens` 回空清單與原因，不 500。→ B2、B3 測試。
5. **背景重算不碰樂觀鎖**：重算只寫 `recruitment_visit_geo` 與 `district`，不加 `recruitment_visits.version`，使用者同時編輯不會收到版本衝突。→ A5 測試。

---

## 檔案地圖

### 後端（新增）

| 檔案 | 責任 |
|---|---|
| `backend/app/admissions/geo/__init__.py` | 空 |
| `backend/app/admissions/geo/kaohsiung.py` | 38 區代碼表、舊高雄縣鄉鎮對照、里名補字 |
| `backend/app/admissions/geo/address.py` | 地址正規化與解析（純函式） |
| `backend/app/admissions/geo/projection.py` | TWD97 TM2→WGS84、haversine |
| `backend/app/admissions/geo/models.py` | `GeoDoorplate`、`GeoKindergarten`、`GeoDatasetStatus`、`RecruitmentVisitGeo` |
| `backend/app/admissions/geo/doorplates.py` | 門牌 CSV 列解析、匯入新版本、切換版本 |
| `backend/app/admissions/geo/kindergartens.py` | `preschools.json` 解析、整批換新、半徑查詢 |
| `backend/app/admissions/geo/matcher.py` | 地址→門牌比對、校區座標、寫訪視比對結果、重算 |
| `backend/app/admissions/geo/boundaries.py` | 里界 GeoJSON 讀取、ETag、里代碼對照 |
| `backend/app/admissions/geo/sync.py` | 找最新門牌檔、下載、匯入、狀態記錄、整體同步 |
| `backend/app/admissions/geo_data/kaohsiung-villages.geojson`、`README.md` | 里界檔與產生方式 |
| `backend/app/admissions/area.py` | `/area` 與 `/area/kindergartens` 的查詢與組裝 |
| `backend/app/workers/geo_loop.py` | `GeoSyncLoop` |
| `backend/migrations/versions/e7a1c4d9b2f6_admissions_area_geo.py` | 四張表 |
| `backend/scripts/geo_match_report.py` | 實際資料比對率報告（不進 CI） |
| `backend/tests/fixtures/geo/doorplates-sample.csv`、`preschools-sample.json`、`villages-sample.geojson` | 測試樣本 |
| `backend/tests/geo_helpers.py` | 載入樣本的共用函式 |
| `backend/tests/test_geo_address.py`、`test_geo_projection.py`、`test_geo_doorplates.py`、`test_geo_kindergartens.py`、`test_geo_matcher.py`、`test_geo_sync.py`、`test_geo_boundaries.py`、`test_admissions_area.py` | 測試 |

### 後端（修改）

`backend/app/config.py`（四個設定）、`backend/.env.example`、`backend/app/main.py`（啟動 `GeoSyncLoop`）、`backend/app/cli.py`（`geo-sync`）、`backend/migrations/env.py`（import geo models）、`backend/app/admissions/records.py`（建立／更新時比對、篩選）、`backend/app/admissions/retention.py`（匿名化）、`backend/app/admissions/routes.py`、`backend/app/admissions/schemas.py`、`backend/app/admissions/stats.py`（檔頭註解）、`backend/pyproject.toml`（hatch 打包 geojson，如有需要）、`contracts/openapi.json`、`contracts/generated/website-api.d.ts`、`contracts/ivy-recruitment/README.md`。

### 後台與官網

新增：`admin/src/components/admissions/area/AreaTab.vue`、`AreaMap.vue`、`NearbyKindergartens.vue`、`areaFormat.ts`、`admin/src/admissions/areaFilter.ts`；測試 `admin/src/__tests__/areaTab.test.ts`、`areaMap.test.ts`、`nearbyKindergartens.test.ts`、`areaFilter.test.ts`；stack e2e `tests/stack/admissions-area.spec.ts`。
修改：`admin/package.json`、`admin/src/api/admissions.ts`、`admin/src/api/types.ts`、`admin/src/admissions/useAdmissionsFilters.ts`、`admin/src/components/admissions/StatsTab.vue`、`admin/src/views/AdmissionsView.vue`、`admin/src/components/admissions/RecordsTab.vue`、`admin/src/__tests__/admissionsTestKit.ts`、`web/server/utils/security-headers.ts`（與其測試）。
文件：`docs/specs/2026-09-30-website-admissions-design.md`、`DESIGN.md`（worktree 為 sparse，DESIGN.md 在根目錄，cone 模式下根目錄檔案會 checkout）、`README.md`。

## 跨階段介面（各階段計畫必須逐字使用這些名稱）

> **2026-10-08 A 階段定案覆蓋本節部分寫法**（以 A 計畫開頭「本階段定案」表為準，B、C 已對齊）：`ParsedAddress.lane`／`.alley` 為 `str | None`；`geo_doorplates.dataset_version` 是批次標記「115-10#xxxx」，畫面月份讀 `geo_dataset_status.label`（`matcher.doorplate_label(db)`），B 的 `data_status.doorplate_version` 回的就是這個 label；`matcher` 另匯出 `doorplate_label`、`distance_to`；`run_geo_sync` 多 `doorplates_version` 參數；CLI 旗標 `--doorplates-file`、`--kindergartens-file`、`--force`，只給一個檔案時另一種跳過、不連外，CLI 不看 `WEBSITE_GEO_AUTO_SYNC`。
> 測試 helper 有兩個同名 `add_visit`，簽名不同：`tests.geo_helpers.add_visit(db, *, address, campus_key="yihua", anonymized=False)`（A，只寫訪視不比對）與 `tests.admissions_area_helpers.add_visit(db, *, district=..., geo=..., ...)`（B，連比對結果一起寫）。import 時寫明模組。
> B 另外新增 `backend/tests/test_admissions_visit_geo.py`、`backend/tests/admissions_area_helpers.py`，並改 `admin/src/api/labels.ts` 一行（C 不重複加）；C 另外新增 `admin/src/__tests__/areaFormat.test.ts`、`tests/stack/fixtures/geo-doorplates.csv`、`geo-preschools.json`，`StatsDimensionTable` 加 `actionLabel` prop 與 `action` emit，明細的區域篩選用常駐提示列（不是 chip）。

### A 產出、B／C 使用

```python
# app/admissions/geo/kaohsiung.py
TOWN_CODES: dict[str, str]          # "6400500" -> "三民區"（38 區）
DISTRICTS: frozenset[str]           # 38 個區名
LEGACY_TOWNS: dict[str, str]        # "仁武鄉" -> "仁武區"、"鳳山市" -> "鳳山區" ...（舊高雄縣 27 鄉鎮市）
def fix_village_name(name: str) -> str   # "北美術館" -> "北美術館里"；已有「里」不變

# app/admissions/geo/address.py
@dataclass(frozen=True)
class ParsedAddress:
    district: str | None        # 38 區之一；None＝解析不出高雄市的區
    street: str | None          # 門牌表「街路段」或「地區」的寫法，例 "民族一路"、"中正四路"、"大勇市場"
    lane: int | None
    alley: int | None
    number: int | None
    number_sub: int             # 之號，無為 0
    outside_kaohsiung: bool     # 地址明寫其他縣市
def normalize_text(raw: str) -> str
def parse_address(raw: str | None) -> ParsedAddress | None   # None＝空白

# app/admissions/geo/projection.py
def twd97_tm2_to_wgs84(x: float, y: float) -> tuple[float, float]   # 回 (lat, lng)
def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float

# app/admissions/geo/models.py（表名、欄位見規格 §5）
class GeoDoorplate(Base): __tablename__ = "geo_doorplates"
class GeoKindergarten(Base): __tablename__ = "geo_kindergartens"
class GeoDatasetStatus(Base): __tablename__ = "geo_dataset_status"   # PK dataset: "doorplates" | "kindergartens"
class RecruitmentVisitGeo(Base): __tablename__ = "recruitment_visit_geo"
MATCH_LEVELS = ("exact", "nearby", "street", "district", "unlocated", "pending")
UNLOCATED_REASONS = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized")
VILLAGE_LEVELS = ("exact", "nearby", "street")   # 有里

# app/admissions/geo/matcher.py
@dataclass(frozen=True)
class GeoMatch:
    district: str | None
    village: str | None
    match_level: str
    unlocated_reason: str | None
    lat: float | None
    lng: float | None
@dataclass(frozen=True)
class CampusPoint:
    campus_key: str
    lat: float | None
    lng: float | None
    locate_error: str | None    # "no_address" | "no_doorplate" | "pending"；有座標時 None
async def active_doorplate_version(db: AsyncSession) -> str | None
async def locate(db: AsyncSession, address: str | None, *, version: str | None) -> GeoMatch
async def campus_point(db: AsyncSession, campus_key: str) -> CampusPoint
async def campus_points(db: AsyncSession) -> dict[str, CampusPoint]
async def apply_visit_geo(db: AsyncSession, visit: RecruitmentVisit) -> None
    # 依 visit.address 比對，upsert recruitment_visit_geo，設定 visit.district；不碰 visit.version；不 commit
async def rematch_visits(db: AsyncSession, *, batch_size: int = 500) -> int
    # 重算所有未匿名化訪視；回傳處理筆數；每批 commit；不碰 version

# app/admissions/geo/kindergartens.py
@dataclass(frozen=True)
class NearbyKindergarten:
    source_id: str; name: str; kind: str; pre_public_period: str | None; address: str
    lat: float; lng: float; distance_m: int; approved_capacity: int | None
    monthly_fee_estimate: int | None; has_penalty: bool; phone: str | None
async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyKindergarten]

# app/admissions/geo/boundaries.py
BOUNDARY_VERSION: str               # "115-08-17"
def boundary_bytes() -> bytes
def boundary_etag() -> str          # 例 '"villages-115-08-17-<sha1 前 12 碼>"'
def village_code(district: str, village: str) -> str | None

# app/admissions/geo/sync.py
@dataclass
class GeoSyncResult:
    doorplates: str        # "skipped" | "updated" | "failed"
    kindergartens: str
    doorplate_version: str | None
    rematched: int
async def run_geo_sync(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings, *,
    force: bool = False, doorplates_file: Path | None = None, kindergartens_file: Path | None = None,
    client: httpx.AsyncClient | None = None,
) -> GeoSyncResult

# app/config.py（Settings，env 前綴 WEBSITE_）
geo_auto_sync: bool = False
geo_doorplate_url: str | None = None
geo_kindergartens_url: str = "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"
geo_sync_check_seconds: int = 86400
```

### B 產出、C 使用（API 與 OpenAPI schema 名稱）

- `GET /api/website/v1/admin/admissions/area?campus_key=&school_year=&semester=` → `AdmissionsAreaOut`
  - `as_of: datetime`、`filters: {campus_key, school_year, semester}`
  - `data_status: AreaDataStatusOut {doorplate_version: str|None, doorplates_synced_at: datetime|None, kindergartens_synced_at: datetime|None, boundary_version: str}`
  - `campus: AreaCampusOut {key, name, lat: float|None, lng: float|None, locate_error: str|None}`
  - `totals: AreaTotalsOut {visit, with_address, village_level, district_level, unlocated, pending, unlocated_reasons: list[AreaReasonCountOut {reason, count}]}`
  - `districts: list[AreaDistrictRowOut {district, visit, deposit, visit_to_deposit_rate: float|None}]`
  - `villages: list[AreaVillageRowOut {district, village, village_code: str|None, visit, deposit, visit_to_deposit_rate}]`
  - `distance_bands: list[AreaDistanceBandOut {band: "0-1"|"1-3"|"3-6"|"6+"|"none", visit, deposit, visit_to_deposit_rate}]`（固定五列、此順序）
- `GET /api/website/v1/admin/admissions/area/kindergartens?campus_key=&radius_km=1|3|6` → `AreaKindergartensOut {synced_at: datetime|None, source_note: str, campus: AreaCampusOut, radius_km: int, items: list[AreaKindergartenOut]}`；`AreaKindergartenOut` 欄位＝`NearbyKindergarten` 全部欄位＋`is_own: bool`。
- `GET /api/website/v1/admin/admissions/area/boundaries` → GeoJSON（`application/geo+json`），`ETag`、`Cache-Control: private, max-age=86400`，`If-None-Match` 相符回 304。
- `GET /api/website/v1/admin/admissions/records` 新增 query：`district: str|None`、`village: str|None`、`geo: Literal["no_village"]|None`。
- `RecruitmentVisitOut` 新增 `geo: VisitGeoOut|None`，`VisitGeoOut {village: str|None, match_level: str, unlocated_reason: str|None, distance_m: int|None}`。

### C 使用的前端名稱

```ts
// admin/src/api/types.ts
export type AdmissionsArea = components['schemas']['AdmissionsAreaOut']
export type AreaDistrictRow = components['schemas']['AreaDistrictRowOut']
export type AreaVillageRow = components['schemas']['AreaVillageRowOut']
export type AreaDistanceBand = components['schemas']['AreaDistanceBandOut']
export type AreaKindergartens = components['schemas']['AreaKindergartensOut']
export type AreaKindergarten = components['schemas']['AreaKindergartenOut']
export type VisitGeo = components['schemas']['VisitGeoOut']

// admin/src/api/admissions.ts
export function getArea(params: { campus_key: string; school_year: number | null; semester: number | null }): Promise<AdmissionsArea>
export function getAreaKindergartens(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaKindergartens>
export function getAreaBoundaries(): Promise<VillageBoundaries>   // VillageBoundaries 定義在 areaFormat.ts

// admin/src/admissions/areaFilter.ts（網址 query `area`）
export type AreaFilter = { kind: 'place'; district: string; village: string | null } | { kind: 'no_village' }
export function parseAreaQuery(value: unknown): AreaFilter | null   // "三民區" | "三民區/鼎金里" | "no_village"
export function areaQuery(filter: AreaFilter): string
export function areaLabel(filter: AreaFilter): string               // "區域：三民區鼎金里" | "區域：未定位到里"
export function areaApiParams(filter: AreaFilter | null): { district: string | null; village: string | null; geo: 'no_village' | null }

// StatsTab emit 擴充
'open-records': [filter: { month?: string; area?: string }]
```

`useAdmissionsFilters` 的 `STATS_SUBS` 改為 `['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare']`，並新增 `area` ref（網址 `area`，只在 tab=records 有意義）。

## 各階段驗證閘

- **A 完成**：`cd backend; uv run pytest -q tests/test_geo_*.py`、`uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`（對測試庫）、`uv run python scripts/geo_match_report.py <門牌CSV> <preschools.json>` 精確＋鄰近 ≥ 95%。
- **B 完成**：`uv run pytest -q tests/test_admissions_*.py tests/test_geo_*.py tests/test_config_isolation.py tests/test_audit_coverage.py`；`npm run contract:check`；主 session 背景跑全套 pytest。
- **C 完成**：`npm --prefix admin run typecheck`、`npm --prefix admin run test:unit`、`npm --prefix web run test:unit`（CSP）、`npm run contract:check`、stack e2e（`npm run e2e:build; npm run test:e2e:stack -- tests/stack/admissions-area.spec.ts tests/stack/admissions-flow.spec.ts`）、dev server 上 Playwright 截桌機 1440 與手機 390。
