# 區域分析：人口年份滑桿、五校周邊環境、園所異動通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在招生統計的區域分析加上 2–5 歲人口年份滑桿，在五校比較加上五校周邊環境表，並在公開資料同步後把五校 3 公里內的園所異動與裁罰寫進站內通知（只給總管理者）。

**Architecture:** 三塊各自獨立：滑桿＝新 API `/area/children-history`（讀九月人口表）＋前端純函式算色階與排行＋`AreaMap` 新 prop；五校表＝新 API `/area/compare`（逐校重用 opportunity／trends（新增只算孩子的模式）／peer_fees／changes，每校一個 savepoint）＋`StatsTab` 新表；通知＝兩張記帳表＋`geo/notices.py` 在 `run_geo_sync` 尾端檢查、直接寫 `NotificationInboxItem`，`notifications/routes.py` 依 `admissions.stats` 過濾。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async、Alembic、PostgreSQL；Vue 3＋Element Plus＋Vitest；契約 openapi-typescript。

**Spec:** `docs/specs/2026-11-16-area-compare-notices-design.md`（業主 11-16 核可）

## Global Constraints

- 一律在 worktree `~/Repositories/ivy-website-wt/area-compare-notices-20261116`（分支 `feature/area-compare-notices-20261116`，已 unset upstream）。**不 push、不合 main**；commit 只在這條分支。
- 開工前補 sparse 目錄（後端／admin 測試會讀）：cone 模式已含整個 `web`、`deploy`；另外 `cd backend && uv sync --frozen`、`npm ci --prefix admin`、`npm ci --prefix web`、根目錄 `npm ci`。
- 後端測試庫：自己 `createdb ivy_website_areacmp1116_test`，`WEBSITE_ENVIRONMENT=test` 下 `uv run alembic upgrade head`；跑測試一律同一行帶 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test`（Bash 不保留環境變數）。用到 `dependency_overrides` 的測試改用 `uncached_create_app`。
- 機器 8GB：同時只跑一組測試。
- 半徑只收 1、3、6（`area_service.RADIUS_CHOICES`）；不是整數走既有 `_require_integer_radius`，回 `INVALID_RADIUS`。
- 權限只用 capability：`admissions.stats`（`require_scope`／`_require_campus`／`has_capability`），路由裡不寫角色判斷（`tests/test_permission_table.py` 會擋）。讀取端點不寫稽核。
- 介面文字繁體中文（台灣），稱「您」不用；數字用既有 `formatCount`／`signedCount`／`formatDistance`。顏色只走 token（`admin/src/style.css` 的 `:root`），不寫色碼、rgba。
- 新用到的 Element Plus 元件（`el-slider`）要補進 `admin/src/element-plus.css`（`elementPlusStyles.test.ts` 會比對）。
- 改了 Pydantic schema 就 `npm run contract:generate`（根目錄），commit 時連同 `contracts/openapi.json`、`contracts/generated/website-api.d.ts`；前端型別一律 `components['schemas'][...]` 經 `admin/src/api/types.ts`。
- 子代理寫中文字串時不要用反斜線跳脫（BOM、減號曾被解碼成實體字元）；需要特殊字元用 `\N{NAME}`。
- Commit：Conventional Commit、繁體中文訊息，結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；只 `git add` 自己動到的檔。

## Review Focus

1. **同步同時跑兩次**（自動迴圈與 CLI `geo-sync` 重疊、或同一輪重試）：同一件事不能發兩則。通知檢查要在 `run_geo_sync` 持有 advisory lock 的區段內執行，寫記帳用 `ON CONFLICT (dedupe_key) DO NOTHING` 並只對真的插入成功的那筆寫通知。→ Task 5 加測試。
2. **五校表某一校的 SQL 出錯**：async session 的交易被污染後，後面幾校的查詢全部會炸。每校包在 `db.begin_nested()` 裡，出錯 rollback 到 savepoint、那列 `unavailable="error"`，其他列照常。→ Task 3 加測試。
3. **網址帶怪年份**（`year=999`、`year=abc`、`year=106`（九月表沒有）、或換校區後新範圍沒有那年）：一律退回「最新」，網址拿掉 `year`，不顯示空白地圖。→ Task 2 加測試。
4. **115-07 新設的里**（例如仁武廍後）：調整前各年 `counts` 是 null，地圖畫 l0、排行不列、「比前一年」不寫數字；不能當成 0 位排在最後或算出「+380」。→ Task 1、Task 2 加測試。
5. **本校沒座標**（校址未發布或比不到門牌）：滑桿 API 回 `unavailable="no_campus_point"`、五校表該列寫 `locate_error` 的原因、通知略過該校且不寫基準列（之後有座標才算首輪）。→ Task 1、3、5 加測試。

---

### Task 1: 歷年 2–5 歲 API（`/area/children-history`）

**Files:**
- Create: `backend/app/admissions/children_history.py`
- Modify: `backend/app/admissions/schemas/trends.py`（加四個 Out 類別）
- Modify: `backend/app/admissions/routes.py`（`/area/opportunity` 路由之後加一支）
- Test: `backend/tests/test_admissions_children_history.py`
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Produces: `async def query_children_history(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]`
- Produces schema `AreaChildrenHistoryOut`：
  - `campus: AreaCampusOut`、`radius_km: int`
  - `unavailable: Literal["no_campus_point", "no_history"] | None`
  - `latest: AreaChildrenHistoryLatestOut | None`（`label: str`＝人口狀態的月份如 `"115-10"`、`synced_at: datetime | None`）
  - `years: list[int]`（九月表實際有的民國年，舊到新）
  - `villages: list[AreaChildrenHistoryVillageOut]`：`village_code: str`、`district: str`、`village: str`、`distance_m: int`、`counts: dict[str, int | None]`（鍵＝`str(year)` 與 `"latest"`）、`adjusted: list[str]`（月份如 `"115-07"`）
  - `retired: list[AreaChildrenHistoryRetiredOut]`：`village_code`、`district`、`village`、`years: list[int]`
  - `max_children: int`
- Produces route `GET /api/website/v1/admin/admissions/area/children-history?campus_key=&radius_km=`（`dependencies=[Depends(_require_integer_radius)]`、`_require_campus(user, "admissions.stats", campus_key)`）

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_admissions_children_history.py`。seed 方式照 `tests/test_admissions_opportunity.py` 的 `_seed`（`geo_helpers.publish_campus_address` 讓義華有座標、`GeoVillagePopulation` 寫最新月、`GeoDatasetStatus("population")`），另外寫 `GeoVillageAges September`（`geo_village_ages_september`）107、108、115 三年，以及一筆 `GeoVillageMigration` 行政區域調整。測試與斷言：
  - `test_years_and_counts`：`years == [107, 108, 115]`；某里 `counts == {"107": a2+a3+a4+a5, "108": …, "115": …, "latest": 最新月 2–5 歲}`；`max_children` 等於所有 counts 的最大值。
  - `test_new_village_has_null_before_it_existed`：只在 115 年與最新有資料的代碼，`counts["107"] is None and counts["108"] is None`。
  - `test_retired_listed_only_in_same_district`：九月表有一個里界檔沒有的代碼、前 7 碼和範圍內某里相同 → 出現在 `retired`，`years` 正確；另一個前 7 碼不同的廢止代碼不出現。
  - `test_adjusted_month_flagged`：`GeoVillageMigration` 某月 `max(boundary_in, boundary_out) >= 20` 且 `>= 1%` 該里 `people_total` → 該里 `adjusted == ["115-07"]`；只有 19 人的不標。
  - `test_campus_without_point`：校址沒發布 → `unavailable == "no_campus_point"`、`villages == []`。
  - `test_no_history`：九月表空 → `unavailable == "no_history"`、`years == []`。
  - `test_radius_and_permissions`：`radius_km=2` 回 422 `INVALID_RADIUS`；`radius_km=abc` 同；分校管理者（`tests.admissions_helpers` 的非總管理者 client）回 403；`campus_key=nope` 回 404。
  - `test_only_villages_within_radius`：半徑外重心的里不在 `villages`。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test uv run pytest tests/test_admissions_children_history.py -q`
  Expected: FAIL（404 route／ImportError）

- [ ] **Step 3: 實作 `query_children_history`**。範圍內的里：`boundaries.village_centroids()` 與本校距離 ≤ 半徑（同 `opportunity.query_opportunity`，距離用 `opportunity._round_distance`）。九月表一次讀「範圍內代碼＋同區（代碼前 7 碼）不在 `boundaries.village_names()` 的代碼」；2–5 歲用 `opportunity._sum_ages(row, opportunity.AGE_BAND)`（九月列與人口列欄位同名）。`latest` 取 `opportunity.population_status(db)`，counts["latest"] 讀 `GeoVillagePopulation`。`adjusted`：`GeoVillageMigration` 對範圍內代碼取 `greatest(boundary_in, boundary_out) >= trends.BOUNDARY_MIN_PEOPLE` 的月份，且 `>= trends.BOUNDARY_SHARE * people_total`（`people_total` 取 `GeoVillagePopulation`）。`villages` 依距離、區、里排序。

- [ ] **Step 4: 加 schema 與路由**，`npm run contract:generate`。

- [ ] **Step 5: 跑測試確認通過**（同 Step 2 指令）＋ `uv run pytest tests/test_admissions_opportunity.py tests/test_permission_table.py -q`
  Expected: PASS

- [ ] **Step 6: Commit**
  `git add backend/app/admissions/children_history.py backend/app/admissions/schemas/trends.py backend/app/admissions/routes.py backend/tests/test_admissions_children_history.py contracts/`
  `git commit -m "feat(admissions): 區域分析歷年 2–5 歲人口 API"`

---

### Task 2: 滑桿畫面（只在「2–5 歲孩子」模式）

**Files:**
- Create: `admin/src/components/admissions/area/childrenHistory.ts`（純函式）
- Create: `admin/src/components/admissions/area/ChildrenYearSlider.vue`
- Modify: `admin/src/api/types.ts`、`admin/src/api/admissions.ts`
- Modify: `admin/src/admissions/areaView.ts`（`AreaView.year`）
- Modify: `admin/src/components/admissions/area/AreaTab.vue`（讀取、工具列、傳給地圖與右欄）
- Modify: `admin/src/components/admissions/area/AreaMap.vue`（`childrenShade` prop）
- Modify: `admin/src/components/admissions/area/areaPane.ts`（`PaneData`、children 排行）
- Modify: `admin/src/element-plus.css`（`el-slider`）
- Test: `admin/src/__tests__/childrenHistory.test.ts`（新）、`childrenYearSlider.test.ts`（新）、`areaView.test.ts`、`areaMap.test.ts`、`areaPane.test.ts`、`areaTab.test.ts`；fixture 加在 `admin/src/__tests__/admissionsTestKit.ts`：`areaChildrenHistory(overrides?)`

**Interfaces:**
- Consumes: Task 1 的 `AreaChildrenHistoryOut`（前端型別名 `AreaChildrenHistory`）
- Produces（`childrenHistory.ts`）：
  - `export type YearStop = number | 'latest'`
  - `export function childrenStops(data: AreaChildrenHistory): YearStop[]` — `[...years, 'latest']`；`latest` 為 null 時不加 `'latest'`
  - `export function stopKey(stop: YearStop): string` — `String(stop)`
  - `export function stopLabel(stop: YearStop, data: AreaChildrenHistory): string` — 年份寫 `"107"`，最新寫 `"最新 115.10"`（`latest.label` 的 `-` 換 `.`）
  - `export interface ChildrenShade { byCode: ReadonlyMap<string, number | null>; max: number }`
  - `export function childrenShade(data: AreaChildrenHistory, stop: YearStop): ChildrenShade`
  - `export function yearChangeText(village: AreaChildrenHistoryVillage, stop: YearStop, stops: readonly YearStop[]): string` — 前一格兩邊都有數字且兩點之間沒有 `adjusted` 月份 → `"比前一年 +3"`（用 `signedCount`；前一格是最新的前一年時文字同樣寫「比前一年」）；之間有調整 → `"界線 115-07 調整"`；其他 → `""`。「之間」判斷：年份 Y 代表 `Y-09`，最新代表 `latest.label`。
  - `export function retiredNote(data: AreaChildrenHistory, stop: YearStop): string` — 該年有資料的 `retired` 數 N>0 → `"同區另有 N 個已廢止的里（廍北、廍南）有這年的資料，地圖上畫不出來。"`（名稱用 `、` 接，最多列 3 個再寫「等」）；否則 `""`
  - `export function resolveStop(requested: number | null, stops: readonly YearStop[]): YearStop` — 不在 stops 裡一律 `'latest'`（stops 沒有 `'latest'` 時取最後一格）
- Produces（`areaView.ts`）：`AreaView` 加 `year: number | null`；`DEFAULT_AREA_VIEW.year = null`；`parseAreaViewQuery` 只收 `/^\d{3}$/` 的 `year`；`areaViewQuery` 在 `year !== null` 時寫 `year`。
- Produces（`api/types.ts`）：`AreaChildrenHistory`、`AreaChildrenHistoryVillage`、`AreaChildrenHistoryRetired`（各對應 `…Out`）。Task 4 同法加 `AreaCompare`、`AreaCompareRow`。
- Produces（`api/admissions.ts`）：`getAreaChildrenHistory(campusKey: string, radiusKm: number): Promise<AreaChildrenHistory>`
- Produces（`AreaMap.vue`）：新 prop `childrenShade?: ChildrenShade | null`（預設 null）；children 模式且有值時里的 class 用 `levelOf(shade.byCode.get(code) ?? 0, shade.max)`（null 當 0＝l0），`legendMax` 用 `shade.max`；`restyleVillages` 的 watch 加上這個 prop。
- Produces（`areaPane.ts`）：`PaneData` 加 `childrenHistory: AreaChildrenHistory | null` 與 `childrenStop: YearStop`；`rankingFor('children', data)` 在 `childrenHistory` 有值時改用它：該格 counts 非 null 且 > 0 的里，依數字由大到小，`value` = `"N 位"`，`detail` = `yearChangeText(...)`；沒有值時維持現行（opportunity）。
- Produces（`ChildrenYearSlider.vue`）：props `stops: readonly YearStop[]`、`modelValue: YearStop`、`labels: Readonly<Record<string, string>>`；emits `update:modelValue`；▶／❚❚ 播放鈕每 1000 ms 前進一格、到最後一格停；`prefers-reduced-motion: reduce` 時不顯示播放鈕；元件卸載、`stops` 改變、使用者拖動時停止播放。`el-slider` 用索引（0…n-1），`:format-tooltip` 顯示 label，`marks` 只標頭尾與最新。

- [ ] **Step 1: 寫失敗的測試**
  - `childrenHistory.test.ts`：`childrenStops` 有／無 latest；`stopLabel(115…)`、`stopLabel('latest')=="最新 115.10"`；`childrenShade` 的 `max` 取 `data.max_children`、null 保留 null；`yearChangeText`：一般 `+3`／`-2`、前一格 null → `""`、跨 `adjusted: ["115-07"]`（114→115 之間）→ `"界線 115-07 調整"`、115→latest（115-09→115-10）不跨 115-07 → 照常寫數字、第一格 → `""`；`retiredNote` 0 個 → `""`、2 個 → 含「廍北、廍南」；`resolveStop(999, stops) === 'latest'`、`resolveStop(108, stops) === 108`。
  - `areaView.test.ts`：`?year=108` → `year: 108`；`?year=abc`、`?year=1080` → `null`；`areaViewQuery({...DEFAULT_AREA_VIEW, year: 108})` 含 `year: '108'`；預設不寫。
  - `areaMap.test.ts`：mode `children`＋`childrenShade`（某碼 120、max 120 → `area-village--l5`；某碼 null → `l0`）；圖例最大值跟 `shade.max`；換 `childrenShade` 會 restyle。
  - `areaPane.test.ts`：有 `childrenHistory` 時 children 排行依所選格排序、null 與 0 不列、`detail` 用 `yearChangeText`。
  - `childrenYearSlider.test.ts`：`vi.useFakeTimers()`，按播放後每 1000 ms emit 下一格、到最後一格停；拖動（emit from el-slider）會停；`matchMedia('(prefers-reduced-motion: reduce)')` 為 true 時沒有播放鈕。
  - `areaTab.test.ts`：
    - `test children mode loads history once and shows slider`：`mockGet` 加 `'/admin/admissions/area/children-history'`；模式不是 children 時不打這支、沒有 `.children-year`；切到 children 才打、出現滑桿。
    - 選 108 → `view` emit 含 `year: 108`；換到其他模式 → `year: null`。
    - 網址 `year: 999` → 畫面用最新、`view.year` 被寫回 `null`。
    - 歷年讀取失敗 → 沒有滑桿、地圖 `childrenShade` 為 null、工具列原因列含「歷年人口讀取失敗」、其他畫面照常。
    - 換半徑 → 重新讀、晚到的舊回應丟掉（同 `useRequestSequence` 既有測試寫法）。
    - 地圖下方 `retiredNote` 文字在有 retired 的年份出現。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `npm --prefix admin run test:unit -- childrenHistory childrenYearSlider areaView areaMap areaPane areaTab`
  Expected: FAIL

- [ ] **Step 3: 實作** `childrenHistory.ts`、`ChildrenYearSlider.vue`、`areaView.ts`、API 函式與型別。

- [ ] **Step 4: 接 `AreaTab.vue`**：`childrenHistory` 的讀取放在現有各區塊讀取旁（`useRequestSequence`、`campusKey`／`radiusKm` 變了清空），但只在 `mapMode === 'children'` 時才發請求（切進 children 時若是空的才讀）；`childrenStop = resolveStop(view.year, stops)`；滑桿放在工具列「範圍」群組之後，用同樣的 `.area-toolbar__group`＋`.area-toolbar__label`（標籤「年份」、`aria-label="年份"`），只有 children 模式且資料 ready 時出現；`setStop(stop)` → `patchView({ year: stop === 'latest' ? null : stop })`；`watch(mapMode)` 離開 children 時 `patchView({ year: null })`；`view.year` 不在 stops（資料到了之後）→ `patchView({ year: null })`。讀取失敗把「歷年人口讀取失敗。」加進 `modeReasons` 的同一列。地圖 `:children-shade`、右欄 `paneData` 帶上 `childrenHistory`／`childrenStop`。`retiredNote` 放在地圖框下方（`.area-workbench__map` 之後一行 `p.hint`）。

- [ ] **Step 5: `el-slider` 補進 `admin/src/element-plus.css`**；樣式只用 token，工具列窄螢幕（≤720px）滑桿佔滿一行。

- [ ] **Step 6: 跑測試確認通過**
  Run: `npm --prefix admin run test:unit -- childrenHistory childrenYearSlider areaView areaMap areaPane areaTab elementPlusStyles && npm --prefix admin run typecheck`
  Expected: PASS、typecheck 0 error

- [ ] **Step 7: Commit**
  `git commit -m "feat(admin): 區域分析 2–5 歲加年份滑桿"`（只 add 上列檔案）

---

### Task 3: 五校周邊環境 API（`/area/compare`）

**Files:**
- Create: `backend/app/admissions/area_compare.py`
- Modify: `backend/app/admissions/trends.py`（`query_trends` 加 `kids_only`）
- Modify: `backend/app/admissions/peer_fees.py`（`own` 加 `kind`）
- Modify: `backend/app/admissions/schemas/area.py`（`AreaPeerFeeOwnOut.kind`、新三個 Out）
- Modify: `backend/app/admissions/routes.py`
- Test: `backend/tests/test_admissions_area_compare.py`（新）、`backend/tests/test_admissions_trends.py`、`backend/tests/test_admissions_peer_fees_api.py`
- Regenerate: contracts

**Interfaces:**
- Produces: `query_trends(db, campus_key, *, school_year, semester, radius_km, now=None, kids_only: bool = False)`。`kids_only=True` 時不讀所得、新屋、預售、國小學區（`_income`／`_new_homes`／`_presale`／`_schools` 不呼叫，`districts` 只用半徑內的里的區），回應鍵不變（這些來源維持初始值、`schools=[]`）；`baseline.kids_net`、`kids_unavailable`、各里 `kids_net` 與完整模式完全相同。
- Produces: `peer_fees.query_peer_fees` 的 `own` 多 `kind: str`（`kind_of(own_school.kind, own_school.pre_public_period)`）；schema `AreaPeerFeeOwnOut.kind: KindergartenKind`。
- Produces: `async def query_area_compare(db: AsyncSession, campus_keys: list[str], *, radius_km: int) -> dict[str, Any]`
- Produces schema `AreaCompareOut`：`radius_km: int`、`population_version: str | None`、`fee_school_year: int | None`、`rows: list[AreaCompareRowOut]`。`AreaCompareRowOut`：
  - `campus_key: str`
  - `unavailable: Literal["no_campus_point", "error"] | None`、`locate_error: str | None`
  - `children: int | None`（opportunity `baseline.children`，`school_year=None, semester=None`）
  - `kids_net: int | None`、`kids_unavailable: str | None`（trends `kids_only=True`）
  - `kindergartens: AreaCompareKindergartensOut | None`（`private`、`quasi_public`、`public`、`nonprofit` 皆 int，取 peer_fees `groups[*].schools`，已排除本機構）
  - `babycare: int | None`（`query_babycare` 的 `summary.count`）
  - `own_fee: int | None`（3 歲 `own.semester_total`）、`own_kind: KindergartenKind | None`、`own_missing: Literal["not_found", "no_fee"] | None`
  - `fee_median: int | None`、`fee_rank: int | None`、`fee_rank_total: int | None`（private 組）
  - `changes_12m: int | None`（`query_changes` 的 `len(items)`）
- Produces route `GET /api/website/v1/admin/admissions/area/compare?radius_km=3`：`require_scope(user, "admissions.stats")`，`campus_keys = [k for k in CAMPUS_KEYS if covers_campus(user, k)]`，半徑規則同其他。

- [ ] **Step 1: 寫失敗的測試**
  - `test_admissions_trends.py::test_kids_only_matches_full`：同一份 seed（含合併組）`kids_only=True` 與 `False` 的 `baseline.kids_net`、`kids_unavailable`、各里 `(key, kids_net)` 相同；`kids_only=True` 時 `schools == []`。
  - `test_admissions_peer_fees_api.py::test_own_carries_kind`：本校私立一般 → `own.kind == "private"`；本校準公共（`pre_public_period` 涵蓋當學年）→ `"quasi_public"` 且 private 組 `own_rank is None`。
  - `test_admissions_area_compare.py`：
    - `test_rows_for_visible_campuses`：總管理者 → 5 列、順序同 `CAMPUS_KEYS`。
    - `test_numbers_match_single_campus_endpoints`：義華列的 `children`、`kids_net`、`kindergartens`、`fee_rank`、`changes_12m` 分別等於 `/area/opportunity`、`/area/trends`、`/area/fees?age=3`、`/area/changes` 同半徑的值。
    - `test_campus_without_point`：某校沒座標 → 那列 `unavailable == "no_campus_point"`、`locate_error` 有值、數字全 null；其他列正常。
    - `test_one_campus_error_does_not_poison_others`：`monkeypatch` 讓第二校的 `query_babycare` 丟 `sqlalchemy.exc.ProgrammingError`（在 savepoint 內真的執行一句壞 SQL 更好）→ 那列 `unavailable == "error"`，第三、四、五校數字正常，回應 200。
    - `test_quasi_public_campus_fee_cell`：本校準公共 → `own_kind == "quasi_public"`、`fee_rank is None`、`fee_median` 照列。
    - `test_radius_and_permissions`：`radius_km=2` 422；非總管理者 403。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test uv run pytest tests/test_admissions_area_compare.py tests/test_admissions_trends.py tests/test_admissions_peer_fees_api.py -q`
  Expected: FAIL

- [ ] **Step 3: 實作** `kids_only`、`own.kind`、`query_area_compare`（逐校 `async with db.begin_nested():`，例外 `logger.exception` 後那列 `unavailable="error"`；`population_version` 取 `opportunity.population_status`；`fee_school_year` 取 peer_fees 回應的 `school_year`），schema、路由，`npm run contract:generate`。

- [ ] **Step 4: 跑測試確認通過**（Step 2 指令）＋ `uv run pytest tests/test_admissions_opportunity.py tests/test_auditfix_trends_merged_radius.py tests/test_admissions_peer_fees.py tests/test_permission_table.py -q`
  Expected: PASS

- [ ] **Step 5: Commit** `git commit -m "feat(admissions): 五校周邊環境比較 API"`

---

### Task 4: 五校周邊環境表（五校比較分頁）

**Files:**
- Create: `admin/src/components/admissions/AreaCompareTable.vue`
- Create: `admin/src/admissions/areaCompareFormat.ts`
- Modify: `admin/src/api/types.ts`、`admin/src/api/admissions.ts`
- Modify: `admin/src/components/admissions/StatsTab.vue`（五校比較 pane、新 emit）
- Modify: `admin/src/views/AdmissionsStatsView.vue`（處理 `open-area`）
- Test: `admin/src/__tests__/areaCompareTable.test.ts`（新）、`areaCompareFormat.test.ts`（新）、`admissionsStatsView.test.ts`；fixture `areaCompare(overrides?)` 加在 `admissionsTestKit.ts`

**Interfaces:**
- Consumes: Task 3 的 `AreaCompareOut`（前端 `AreaCompare`、`AreaCompareRow`）
- Produces: `getAreaCompare(radiusKm: number): Promise<AreaCompare>`
- Produces（`areaCompareFormat.ts`）：
  - `export function areaCompareCells(row: AreaCompareRow): Record<string, string | number>` — 鍵：`campus`、`children`、`kids_net`（`signedCount`；null 寫 `—`）、`kg_private`、`kg_quasi_public`、`kg_public`、`kg_nonprofit`、`babycare`、`own_fee`、`fee_median`、`fee_rank`（`第 n 高／共 m`；`own_kind !== 'private'` 寫 `本校${kindLabel(own_kind)}`；`own_missing` 寫 `peerFeesFormat` 既有的原因文字）、`changes_12m`；`unavailable` 時除校區外寫 `—`，校區後附原因（`campusNotLocatedReason(locate_error)`／「讀取失敗」）。
  - `export const AREA_COMPARE_NOTE = '人口為最新月份；收費為 3 歲、和私立一般園所比；幼兒園家數不含常春藤各校。'`
- Produces（`AreaCompareTable.vue`）：props `data: AreaCompare`、`exportFilename: string`；emits `open-area: [campusKey: string]`（`StatsDimensionTable` 的 `name-action`，`nameAction="看區域分析"`）。
- Produces（`StatsTab.vue`）：新 emit `'open-area': [campusKey: string]`；五校比較 pane 在 `CompareTable` 之後加 `<section class="area-compare">`：標題「周邊環境」＋右側 1／3／6 公里 `el-radio-group`（預設 3、畫面狀態不進網址）＋表＋`AREA_COMPARE_NOTE`；`subTab === 'stats-compare'` 時才讀、換半徑重讀、`useRequestSequence`；失敗只影響這張表（`el-alert`＋重新載入）。CSV 檔名 `csvFilename('招生統計', '五校周邊環境', `${km}公里`, taipeiToday())`。
- Produces（`AdmissionsStatsView.vue`）：`@open-area="(key) => { campus = key; sub = 'area' }"`（照 `useAdmissionsFilters` 既有 ref 寫入，網址由它同步）。

- [ ] **Step 1: 寫失敗的測試**
  - `areaCompareFormat.test.ts`：一般列各欄文字；`kids_net` −412 → `"−412"`（用 `signedCount` 的實際輸出）；準公共 → `fee_rank` 寫「本校準公共」；`own_missing: 'no_fee'`；`unavailable: 'no_campus_point'` 全 `—`。
  - `areaCompareTable.test.ts`：五列、欄名順序「校區、2–5 歲、一年增減、私立、準公共、公立、非營利、托嬰、本校 3 歲收費、私立一般中位數、排名、近 12 月異動」；點校區名按鈕 emit `open-area` 帶 key；CSV 匯出欄同畫面。
  - `admissionsStatsView.test.ts`：五校比較分頁出現「周邊環境」；打 `/admin/admissions/area/compare?radius_km=3`；切 1 公里重打 `radius_km=1`；`/area/compare` 失敗時招生件數表照常、周邊環境顯示錯誤；`open-area('minghua')` → 網址 `campus=minghua&sub=area`；只看得到一校時整個五校比較分頁不出現（既有行為不變）。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `npm --prefix admin run test:unit -- areaCompareFormat areaCompareTable admissionsStatsView compareTable`
  Expected: FAIL

- [ ] **Step 3: 實作**上列檔案。

- [ ] **Step 4: 跑測試確認通過**（Step 2 指令）＋ `npm --prefix admin run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit** `git commit -m "feat(admin): 五校比較加周邊環境表"`

---

### Task 5: 異動通知的記帳表與檢查（同步後）

**Files:**
- Create: `backend/app/notifications/area_kinds.py`
- Create: `backend/app/admissions/geo/notices.py`
- Modify: `backend/app/admissions/geo/models.py`（兩個 model）
- Create: `backend/migrations/versions/<12 碼 hex>_geo_change_notices.py`（`down_revision = "d4b7e1a95c26"`；開工前 `git fetch origin main` 再確認 head，main 有新 migration 就接新的）
- Modify: `backend/app/admissions/geo/sync.py`（`GeoSyncResult` 兩欄、`run_geo_sync` 尾端呼叫）
- Modify: `backend/app/workers/geo_loop.py`、`backend/app/cli.py`（若逐欄印出結果，補 notices）
- Test: `backend/tests/test_geo_change_notices.py`（新）、`backend/tests/test_geo_loop.py`、`backend/tests/test_geo_schema.py`（若有表清單守門）

**Interfaces:**
- Produces（`area_kinds.py`）：`AREA_PROVIDER_CHANGE = "area_provider_change"`、`AREA_PENALTY = "area_penalty"`、`AREA_NOTICE_KINDS: frozenset[str]`
- Produces（models）：
  - `GeoChangeNotice`（`geo_change_notices`）：`id` BigInteger Identity PK、`campus_key` String(32) FK `campuses.key` ON DELETE CASCADE、`dedupe_key` String(400) UNIQUE、`kind` String(32)、`notified` Boolean not null、`created_at` timestamptz server_default now()；索引 `(campus_key, kind, created_at)`。
  - `GeoChangeNoticeBaseline`（`geo_change_notice_baselines`）：PK `(campus_key, kind)`、`established_at` timestamptz。
- Produces（`notices.py`）：
  - 常數 `NOTICE_RADIUS_KM = 3`、`CHANGE_FRESH_DAYS = 90`、`PENALTY_FRESH_DAYS = 365`、`REPEAT_GUARD_DAYS = 90`
  - `async def check_change_notices(db: AsyncSession, *, today: date) -> int` — 只 flush，回傳這次寫了幾則通知。
  - `async def run_change_notices(session_factory: async_sessionmaker[AsyncSession], *, today: date) -> tuple[str, int]` — 開 session、呼叫 check、commit；回 `("updated", n)`（n 可為 0）或例外時 `logger.exception` 後 `("failed", 0)`。
  - payload（異動）：`{"radius_km": 3, "provider", "source_id", "name", "change", "kind", "old_kind", "new_kind", "distance_m", "date": "YYYY-MM-DD", "date_basis"}`；payload（裁罰）：`{"radius_km": 3, "source_id", "name", "occurred_on": "YYYY-MM-DD", "doc_no", "laws": [str, ...], "distance_m"}`。
  - dedupe_key：異動 `f"{campus}:{provider}:{source_id}:{change}:{date.isoformat()}"`；裁罰 `f"{campus}:penalty:{school_name}:{occurred_on.isoformat()}:{doc_no}"`。
- Produces（sync）：`GeoSyncResult.notices: str = "skipped"`、`GeoSyncResult.notices_sent: int = 0`；`run_geo_sync` 在 `rematch_if_changed` 與新屋／預售重比之後、**仍在 `_exclusive` 鎖內**呼叫 `run_change_notices(session_factory, today=today_local(now))`。

**演算法（check_change_notices）：**
```
points = await matcher.campus_points(db)
own = 有座標的五校點
for campus_key in CAMPUS_KEYS:
    point = points[campus_key]; 沒座標 → continue（不寫基準）
    for kind, candidates in (
        (AREA_PROVIDER_CHANGE, nearby_changes(db, lat, lng, 3000, today=today) 排除距任一 own ≤ OWN_CAMPUS_RADIUS_M 的園所),
        (AREA_PENALTY, 3 km 內、source_id 對得到 GeoKindergarten、非本機構的裁罰，依 (school_name, occurred_on, doc_no) 合併 laws),
    ):
        baseline = await db.get(GeoChangeNoticeBaseline, (campus_key, kind))
        for c in candidates:
            fresh = baseline is not None and c.date >= today - fresh_days(kind)
            repeat = kind == AREA_PROVIDER_CHANGE and 90 天內已有同 (campus, provider, source_id, change) 且 notified 的記帳
            notify = fresh and not repeat
            inserted = INSERT geo_change_notices (...) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
            if inserted and notify: db.add(NotificationInboxItem(campus_key=..., kind=kind, payload=...)); sent += 1
        if baseline is None: db.add(GeoChangeNoticeBaseline(campus_key, kind, established_at=now))
```
（`repeat` 用 dedupe_key 前綴 `LIKE '{campus}:{provider}:{source_id}:{change}:%'` 且 `created_at >= now - 90 days` 且 `notified`。）

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_geo_change_notices.py`（seed：`geo_helpers.load_geo_samples`、`publish_campus_address`；異動直接寫 `GeoProviderEvent`／設 `GeoKindergarten.registered_on`；裁罰寫 `GeoKindergartenPenalty`）：
  - `test_first_run_only_records_baseline`：已有 2 件異動、3 筆裁罰 → 第一次 `check_change_notices` 回 0、`NotificationInboxItem` 0 筆、`geo_change_notices` 5 筆 `notified=False`、義華兩種基準列都在。
  - `test_quiet_first_run_then_next_event_notifies`：首輪 0 件 → 有基準列；之後新增一件 → 回 1、有一則 `area_provider_change`。
  - `test_second_run_only_new`：首輪後新增 1 件異動、1 份裁罰 → 回 2；再跑一次回 0。
  - `test_stale_items_recorded_silently`：首輪後新增 `occurred_on = today - 91 天` 的停辦、處分日 `today - 366 天` 的裁罰 → 回 0、記帳 `notified=False`。
  - `test_overlap_two_campuses`：一所同時在義華與明華 3 km 內 → 兩則，`campus_key` 各一。
  - `test_own_campus_excluded`：距任一校 ≤ 50 m 的園所異動不記帳也不發。
  - `test_penalty_multiple_laws_one_notice`：同 `(school_name, occurred_on, doc_no)` 兩條 `law` → 一則、`payload["laws"]` 兩條。
  - `test_repeat_guard`：同一所同一種 30 天內換了日期再出現 → 不發第二則（仍記帳）。
  - `test_campus_without_point_skipped`：某校沒座標 → 沒有該校基準列；補上座標後下一輪才是它的首輪（不發）。
  - `test_concurrent_runs_do_not_double_send`：兩個 session 各自 `check_change_notices` 同一批（先後 commit）→ 通知總數 1（靠 `ON CONFLICT DO NOTHING RETURNING`）。
  - `test_run_change_notices_failure_isolated`：`monkeypatch` 讓 check 丟例外 → 回 `("failed", 0)`、不往外丟。
  - `test_geo_loop.py`：`run_geo_sync` 結果帶 `notices` 與 `notices_sent`（照該檔既有的「跑真的 run_geo_sync、下載換成假網站」寫法）；通知失敗時其他資料集結果不變。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test uv run pytest tests/test_geo_change_notices.py tests/test_geo_loop.py -q`
  Expected: FAIL

- [ ] **Step 3: 實作** models、migration（只 `create_table`／`drop_table`，`WEBSITE_ENVIRONMENT=test` 下對測試庫 `alembic upgrade head` 再 `downgrade -1` 再 `upgrade head` 驗一次）、`area_kinds.py`、`notices.py`、sync 呼叫與 `GeoSyncResult` 欄位、geo_loop／CLI 的結果輸出。

- [ ] **Step 4: 跑測試確認通過**（Step 2 指令）＋ `uv run pytest tests/test_geo_schema.py tests/test_geo_sync*.py tests/test_admissions_provider_area.py -q` ＋ `python3 deploy/check_schema.py` 若該腳本有離線模式則跑（看 `deploy/tests`）。
  Expected: PASS

- [ ] **Step 5: Commit** `git commit -m "feat(admissions): 公開資料同步後檢查五校附近園所異動與裁罰並寫站內通知"`

---

### Task 6: 站內通知的權限過濾與標題（後端）

**Files:**
- Modify: `backend/app/notifications/routes.py`（`_inbox_scope`、`mark_notification_read`、`mark_all_notifications_read`）
- Modify: `backend/app/notifications/service.py`（`_KIND_LABELS`）
- Test: `backend/tests/test_area_change_notices_inbox.py`（新）

**Interfaces:**
- Consumes: Task 5 的 `AREA_NOTICE_KINDS`、兩種 kind
- Produces: 沒有 `has_capability(user, "admissions.stats")` 的使用者，列表、計數、全部已讀都加 `NotificationInboxItem.kind.not_in(AREA_NOTICE_KINDS)`；單筆已讀遇到這兩種 kind 回 404（同查無此則，`detail="找不到這個項目"`）。`_KIND_LABELS["area_provider_change"] = "附近園所異動"`、`_KIND_LABELS["area_penalty"] = "附近幼兒園裁罰"`。

- [ ] **Step 1: 寫失敗的測試**（直接寫兩則 area 通知＋一則 `visit_request_created` 到義華）：
  - 總管理者 `GET /admin/notifications` 看到 3 則、`/counts` total 3；`POST /read-all` 後三則都已讀。
  - 義華分校管理者：列表只有 1 則（visit）、`/counts` total 1；帶 `campus_key=yihua` 也是 1 則（不是 403）；`POST /admin/notifications/{area 那則 id}/read` 回 404；`POST /read-all` 後 area 兩則 `read_at` 仍是 null。
  - 義華接待：列表只有 1 則。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test uv run pytest tests/test_area_change_notices_inbox.py -q`
  Expected: FAIL

- [ ] **Step 3: 實作**。

- [ ] **Step 4: 跑測試確認通過**（Step 2 指令）＋ `uv run pytest tests/test_audit_search_and_inbox_paging.py tests/test_permission_table.py -q`
  Expected: PASS

- [ ] **Step 5: Commit** `git commit -m "feat(notifications): 附近園所異動通知只給總管理者"`

---

### Task 7: 站內通知頁顯示異動與裁罰

**Files:**
- Create: `admin/src/admissions/areaNotices.ts`
- Modify: `admin/src/api/labels.ts`（`NOTIFICATION_KIND_LABELS` 兩種）
- Modify: `admin/src/views/NotificationsView.vue`（`KIND_META`、連結、內文）
- Test: `admin/src/__tests__/areaNotices.test.ts`（新）、`admin/src/__tests__/lineNotifications.test.ts` 或現有 NotificationsView 測試檔（`grep -l NotificationsView admin/src/__tests__` 找掛載它的那支）

**Interfaces:**
- Consumes: Task 5 的 payload 欄位
- Produces（`areaNotices.ts`）：
  - `export function isAreaNotice(kind: string): boolean`
  - `export function areaNoticeTitle(kind: string, payload: Record<string, unknown>): string` — 異動：`"3 公里內新設：○○幼兒園"`／`"停辦："`／`"類型變動：○○幼兒園 私立 → 準公共"`（用 `kindLabel`；名稱過 `shortName`／托嬰用 `babycareShortName`）；裁罰：`"3 公里內裁罰：○○幼兒園"`。payload 欄位缺或型別不對時退回 `notificationKindLabel(kind)`。
  - `export function areaNoticeMeta(kind: string, payload: Record<string, unknown>): string` — `"1.2 km・私立・115-10-02"`（異動：距離、類型、日期；裁罰：距離、處分日、法條第一條＋「等 n 條」）。
  - `export function areaNoticeLink(campusKey: string): string` — `/admissions-stats?campus=${campusKey}&sub=area&map=peers`
- `NotificationsView.vue`：`KIND_META` 加 `area_provider_change: { tone: 'primary', icon: OfficeBuilding }`、`area_penalty: { tone: 'warning', icon: WarningFilled }`（`@element-plus/icons-vue`，同檔既有圖示來源）；連結判斷改成 `noticeLink(row)`：visit 走原本 `/visit-requests/<id>`、area 走 `areaNoticeLink`；標題用 `areaNoticeTitle`，`summary` 前接 `areaNoticeMeta`（全部校區時前面照舊帶校名）。

- [ ] **Step 1: 寫失敗的測試**：`areaNotices.test.ts` 三種異動與裁罰的標題、meta；payload 壞掉的退回；連結字串。NotificationsView 掛載測試：回傳一則 `area_provider_change`（義華）→ 標題含「3 公里內新設」、`RouterLink` 指向 `/admissions-stats?campus=yihua&sub=area&map=peers`、圖示色調 `data-tone="primary"`；點擊會標已讀（沿用 `markReadOnOpen`）。

- [ ] **Step 2: 跑測試確認失敗**
  Run: `npm --prefix admin run test:unit -- areaNotices <NotificationsView 的測試檔>`
  Expected: FAIL

- [ ] **Step 3: 實作**。

- [ ] **Step 4: 跑測試確認通過**（Step 2 指令）＋ `npm --prefix admin run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit** `git commit -m "feat(admin): 站內通知顯示附近園所異動與裁罰"`

---

### Task 8: 文件、全套驗證、畫面確認

**Files:**
- Modify: `README.md`（頂部加 `## 2026-11-16 …` 日期段落）
- Modify: `DESIGN.md`（後台招生統計相關章節：滑桿色階共用、五校表口徑、通知首輪與時間窗）
- Modify: `docs/specs/2026-11-16-area-compare-notices-design.md`（狀態改「已核可（11-16）、已實作」，§12 寫實作裁定）
- Modify: `deploy/README.md`（「公開地理資料同步」段補：同步後會檢查附近異動並寫站內通知；上線第一輪只記帳）

- [ ] **Step 1: 契約與型別**
  Run: `npm run contract:check && npm --prefix admin run typecheck && npm --prefix web run typecheck`
  Expected: 全部 0 error

- [ ] **Step 2: 後端全套**
  Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_areacmp1116_test uv run pytest -q`
  Expected: 全過（看到 passed 數字；失敗先依例外與缺檔路徑分組，排除 sparse 缺檔再判斷）。新增測試多就 `uv run pytest --store-durations` 重產 `backend/.test_durations`。

- [ ] **Step 3: 前端全套**
  Run: `npm --prefix admin run test:unit && npm run test:website`
  Expected: 全過（負載逾時的檔單獨重跑確認）

- [ ] **Step 4: stack e2e 招生區域相關**
  Run: `E2E_DB_NAME=ivy_website_areacmp1116_e2e_test E2E_API_PORT=8736 E2E_WEB_PORT=3736 npm run e2e:build && E2E_DB_NAME=ivy_website_areacmp1116_e2e_test E2E_API_PORT=8736 E2E_WEB_PORT=3736 npm run test:e2e:stack -- --grep "area|區域|notification|通知"`
  Expected: PASS

- [ ] **Step 5: 畫面確認**：stack 起著的狀態下用 Playwright（`require('playwright')`、`chromium.launch({channel:'chrome'})`）以總管理者登入，截 1440×900 與 390×844：區域分析切到 2–5 歲孩子、拉到 107 與最新、按播放；五校比較的周邊環境表；站內通知頁一則 area 通知。截圖放 `output/area-compare-notices-20261116/`（gitignore）。確認：滑桿不擠破工具列、手機滑桿佔滿一行、表格在 390 可橫捲、通知文字不斷行錯位。

- [ ] **Step 6: 文件**：寫上列四份文件。

- [ ] **Step 7: Commit** `git commit -m "docs: 區域分析年份滑桿、五校周邊環境、異動通知的紀錄"`
