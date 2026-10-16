# 區域分析地圖工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把招生統計 → 區域分析從十塊往下排的長頁，改成「看什麼」工具列＋地圖＋右欄（排行／里卡片）＋表格分頁的地圖工作台。

**Architecture:** 資料讀取全部留在 `AreaTab.vue`（不改 API）；新增三個純函式檔（`villageFacts.ts` 組里卡片、`areaPane.ts` 組模式停用／預設／排行／摘要、`villageTable.ts` 組合併的各里表與 CSV），元件只負責畫。著色模式從 `AreaMap` 內部提到 `AreaTab`，網址參數 `map`／`village`／`table` 比照預約全程的 `journey` 接進 `useAdmissionsFilters`。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Element Plus、Leaflet（動態 import）、Vitest + @vue/test-utils、Playwright stack e2e。

**Spec:** `docs/specs/2026-10-16-admissions-area-workbench-design.md`（下稱「規格」；W*／D* 是規格 §1.2／§1.3 的編號）。mock：`~/Desktop/ivy-website-admin/design/admissions-area-directions-20261016/b-workbench.html`（版面參考，數字虛構；模式名照規格叫「參觀」不叫「官網參觀」）。

## Global Constraints

- 基準：worktree `~/Repositories/ivy-website-wt/area-workbench-20261016`，分支 `feature/area-workbench-20261016`，已快轉到 origin/main `d196036b`（前置案「招生統計獨立頁」已在裡面）。sparse worktree 沒有 node_modules：第一次先 `source ~/.nvm/nvm.sh; nvm use; npm --prefix admin ci`（`source nvm.sh` 會回 3，一律用 `;` 串，不用 `&&`）。
- 只改 `admin/`、`tests/stack/admissions-area.spec.ts`、`DESIGN.md`、`README.md`、規格狀態列。**不改後端、API、`contracts/`**，不跑 `contract:check`。
- 字級只用 `--text-xs`…`--text-5xl`；顏色一律 token（選取外框 `--ink`）；不用 2px 以上的彩色左右邊框或 inset 側條；不 transition `width`／`height`／`max-height`；錯誤提示走 `notifyError`／`notifyWarning`；每個 `<el-switch>` 要有 `aria-label`；原始碼不得有實體 U+FEFF。違反這些會被 `ux20261005.test.ts`、`crossUx20261002.test.ts`、`a11yStructure.test.ts`、`noLiteralBom.test.ts` 擋。
- 規格 §7 的新文案照抄；摘要句、無資料句、失敗句、停用原因沿用現有函式，不改字。新增的停用原因只有一句：`'附近參觀還不到 10 位，先不判斷哪些里偏少。'`（就是 `opportunitySummary` 現有的判讀句，抽成常數 `NOT_JUDGED_NOTE` 共用）。
- 模式值與順序（`MAP_MODES`）：`enrolled` 在籍學生、`children` 2–5 歲孩子、`trend` 孩子增減、`homes` 新屋交屋、`visits` 參觀、`opportunity` 招生機會、`peers` 同業。
- 表格分頁值與順序：`village` 各里、`school` 國小學區、`enrolled` 在籍學生、`fees` 同業收費、`births` 出生走勢、`visits` 參觀來源。
- 里代碼格式：`/^\d{11}$/`（`VILLCODE`，例 `64000050015`）。
- 版面數字：地圖畫布 620px；右欄 380px；1200px 以下工作台單欄；≤720px 地圖 50vh／最小 280px、排行 5 列；桌機排行 10 列，「顯示更多」到 20。
- 單元測試：`npm --prefix admin run test:unit -- <檔名>`；全套 `npm --prefix admin run test:unit` 與 `npm --prefix admin run typecheck`。機器只有 8GB：同時只跑一組測試；全套與 stack e2e 由主 session 背景跑（subagent 超過 10 分鐘無輸出會被中止）。
- commit：只在 feature 分支，Conventional Commit、繁體中文訊息，結尾附 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；不 push、不部署（push main＝正式部署，要使用者同意）。不 `git add .`／`-A`。
- 截圖只拍 stack 測試庫，**不拍正式站**（含在籍學生真實住處）；存 `output/playwright/`，不進版控。

## Review Focus

1. **合併組裡的里從地圖點進來**（例：點鼓山區龍子里 `64000020015`，它在 `寶業里、龍子里` 那一組）：卡片孩子段用整組數字並寫「里界調整，和寶業里合併計算」，網址寫 `64000020015`、外框只框龍子里 → Task 3 的 `villageFacts` 測試 `merged member picked on map`。
2. **網址帶著 `village` 時換校區**：`village` 被清掉，且不會被還在路上的舊網址讀回來 → Task 2 測試 (n)。
3. **網址的 `village` 在里界還沒載到時**：不能因為「找不到」就先刪掉；里界到了、真的沒有這個代碼才從網址拿掉 → Task 9 測試 `keeps village until boundaries arrive`。
4. **網址 `map=enrolled` 開一個沒匯入清冊的校區**：退回 `children`、網址拿掉 `map`，工具列沒有選到停用的鈕 → Task 9 測試 `falls back when map is disabled`。
5. **地圖 chunk 載入失敗時從排行選里**：卡片照開、不呼叫不存在的地圖實例、不丟錯 → Task 9 的 `areaTabChunkFailure.test.ts` 新案例。

---

### Task 1: `areaView.ts`：模式、表格分頁與網址的純函式

**Files:**
- Create: `admin/src/admissions/areaView.ts`
- Modify: `admin/src/components/admissions/area/areaFormat.ts:157-166`（`MapMode`／`MAP_MODES` 改成從 areaView 轉出）
- Test: `admin/src/__tests__/areaView.test.ts`
- 一起提交：`docs/specs/2026-10-16-admissions-area-workbench-design.md`、本計畫

**Interfaces:**
- Produces（`admin/src/admissions/areaView.ts`）：
  - `export type MapMode = 'enrolled' | 'children' | 'trend' | 'homes' | 'visits' | 'opportunity' | 'peers'`
  - `export const MAP_MODES: readonly { value: MapMode; label: string }[]`（順序與標籤見 Global Constraints）
  - `export type AreaTableTab = 'village' | 'school' | 'enrolled' | 'fees' | 'births' | 'visits'`
  - `export const AREA_TABLE_TABS: readonly AreaTableTab[]`
  - `export interface AreaView { map: MapMode | null; village: string; table: AreaTableTab }`（`map: null`＝這個校區的預設模式；`village: ''`＝沒選）
  - `export const DEFAULT_AREA_VIEW: AreaView`（`{ map: null, village: '', table: 'village' }`）
  - `export function isMapMode(value: unknown): value is MapMode`
  - `export function parseAreaViewQuery(query: LocationQuery): AreaView`
  - `export function areaViewQuery(view: AreaView): Record<string, string>`
- `areaFormat.ts` 改成 `export { MAP_MODES, type MapMode } from '../../../admissions/areaView'`，既有 import 不用改。

- [ ] **Step 1: 寫失敗測試 `areaView.test.ts`**

```ts
it('讀網址：認得的值照收，認不得的退回預設', () => {
  expect(parseAreaViewQuery({ map: 'trend', village: '64000050015', table: 'school' }))
    .toEqual({ map: 'trend', village: '64000050015', table: 'school' })
  expect(parseAreaViewQuery({ map: 'heat', village: 'abc', table: 'x' })).toEqual(DEFAULT_AREA_VIEW)
  expect(parseAreaViewQuery({ map: ['peers', 'visits'] })).toEqual({ ...DEFAULT_AREA_VIEW, map: 'peers' })
})
it('寫網址：預設值不寫', () => {
  expect(areaViewQuery(DEFAULT_AREA_VIEW)).toEqual({})
  expect(areaViewQuery({ map: 'peers', village: '64000050001', table: 'fees' }))
    .toEqual({ map: 'peers', village: '64000050001', table: 'fees' })
  expect(areaViewQuery({ map: null, village: '', table: 'village' })).toEqual({})
})
it('模式順序與標籤（規格 §2.1、D2）', () => {
  expect(MAP_MODES.map((m) => m.label)).toEqual(['在籍學生', '2–5 歲孩子', '孩子增減', '新屋交屋', '參觀', '招生機會', '同業'])
  expect(AREA_TABLE_TABS).toEqual(['village', 'school', 'enrolled', 'fees', 'births', 'visits'])
})
```

陣列值取第一個（同 `text()` 的寫法只收字串；陣列時取 `[0]`）。

- [ ] **Step 2: 跑測試確認失敗** — `npm --prefix admin run test:unit -- areaView` → FAIL（找不到模組）。
- [ ] **Step 3: 實作 `areaView.ts`，改 `areaFormat.ts` 轉出。** `areaFormat.test.ts` 若斷言舊的 `MAP_MODES` 順序或「參觀人數」，改成新值。
- [ ] **Step 4: 跑 `areaView`、`areaFormat`、`npm --prefix admin run typecheck`** → PASS（`AreaMap.vue` 會因 `'peers'` 不在它的分支裡而照舊編得過；它在 Task 6 才處理）。
- [ ] **Step 5: Commit**（含規格與本計畫）

```bash
git add admin/src/admissions/areaView.ts admin/src/components/admissions/area/areaFormat.ts admin/src/__tests__/areaView.test.ts admin/src/__tests__/areaFormat.test.ts docs/specs/2026-10-16-admissions-area-workbench-design.md docs/superpowers/plans/2026-10-16-admissions-area-workbench.md
git commit -m "feat(admin): 區域分析工作台的模式、表格分頁與網址參數"
```

### Task 2: 網址參數接進 `useAdmissionsFilters` → AdmissionsStatsView → StatsTab → AreaTab

**Files:**
- Modify: `admin/src/admissions/useAdmissionsFilters.ts`（比照 `journey`：:82 宣告、:108 apply、:123 stateQuery、:155 離開子分頁重設、:156 watch、:172 回傳）
- Modify: `admin/src/views/AdmissionsStatsView.vue:14,54-62`（`v-model:area-view`）
- Modify: `admin/src/components/admissions/StatsTab.vue:44-46,415-425`（`defineModel('areaView')`，傳 `v-model:view` 給 AreaTab）
- Modify: `admin/src/components/admissions/area/AreaTab.vue`（只宣告 `const view = defineModel<AreaView>('view', { default: () => ({ ...DEFAULT_AREA_VIEW }) })`，Task 9 才用）
- Test: `admin/src/__tests__/admissionsStatsView.test.ts`（在「子分頁寫進網址」describe 加 (m)–(o)）、`admin/src/__tests__/statsTab.test.ts`（AreaTab stub 加 `view` prop）

**Interfaces:**
- Consumes: Task 1 的 `AreaView`、`DEFAULT_AREA_VIEW`、`parseAreaViewQuery`、`areaViewQuery`。
- Produces: `useAdmissionsFilters()` 多回傳 `areaView: Ref<AreaView>`；StatsTab 的 model 名 `areaView`（事件 `update:areaView`）；AreaTab 的 model 名 `view`（事件 `update:view`）。

- [ ] **Step 1: 寫失敗測試**（`statsPath`、`mountWith`、`queryOf` 用該檔現成的）

```ts
it('(m) sub=area 的 map／village／table 讀得回來；StatsTab 改了用 replace 寫回；換子分頁拿掉', async () => {
  // 掛載 statsPath('sub=area&map=trend&village=64000050015&table=school')
  // expect(StatsTab props areaView).toEqual({ map: 'trend', village: '64000050015', table: 'school' })
  // emit('update:areaView', { map: 'peers', village: '', table: 'village' }) → replace query { campus, sub: 'area', map: 'peers' }
  // emit('update:sub', 'source') → query 沒有 map／village／table
})
it('(n) 換校區、學年或學期：village 清掉，map 與 table 保留；舊網址回來不會把 village 讀回去', async () => {
  // 掛載 sub=area&map=trend&village=64000050015 → 換 CampusSelect 成 'renwu'
  // → 最後一次 replace 的 query 是 { campus: 'renwu', sub: 'area', map: 'trend' }，StatsTab areaView.village === ''
})
it('(o) 別的子分頁網址上的 map／village／table 被忽略，也不寫回', async () => {
  // statsPath('sub=source&map=trend&village=64000050015') → query 只剩 { campus, sub: 'source' }
})
```

- [ ] **Step 2: 跑 `admissionsStatsView` 確認 (m)–(o) 失敗。**
- [ ] **Step 3: 實作。** 清 `village` 只在畫面改了校區／學年／學期時做（`apply()` 從網址讀進來的不清）；做法自選（例如 apply 期間設旗標、或比對 `route.query`），測試 (n) 驗結果。`watch(sub)` 離開 `area` 時重設成 `DEFAULT_AREA_VIEW`（已是預設就不重新指派，同 `resetJourney`）。`areaView` 加進 :156 的 deep watch。
- [ ] **Step 4: 跑 `admissionsStatsView`、`statsTab`、`areaTab`（只確認沒弄壞）、typecheck** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 區域分析的模式、選取的里、表格分頁寫進網址`

### Task 3: `villageFacts.ts`：里卡片的資料組合（純函式）

**Files:**
- Create: `admin/src/components/admissions/area/villageFacts.ts`
- Test: `admin/src/__tests__/villageFacts.test.ts`

**Interfaces:**
- Consumes: `areaFormat.ts` 的 `formatDistance`、`formatCount`、`formatRate`（statsFormat）、`kidsNetText`、`KIDS_LEVEL_LABELS`、`signedCount`、`incomeText`、`villageSchoolsText`、`homesCount`、`expectedText`、`signalText`、`shortName`、`kindLabel`、`villageKey`、`pointCount`、`ENROLLED_GRADE_ORDER`、`trendsPlaceName`。
- Produces:
  - `export const NOT_JUDGED_NOTE = '附近參觀還不到 10 位，先不判斷哪些里偏少。'`（`areaFormat.opportunitySummary` 改用它）
  - `export function featureCentroid(feature: VillageBoundaries['features'][number]): { lat: number; lng: number }` — 面積最大那個多邊形外環頂點的平均（去掉和第一點重複的收尾點）。
  - `export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number` — haversine，R = 6,371,000 m。
  - `export function findFeature(boundaries: VillageBoundaries, code: string)` ／ `export function featureCode(boundaries, district: string, village: string): string | null`
  - `export interface FactsSources { boundaries: VillageBoundaries; area: AdmissionsArea; opportunity: AreaOpportunity | null; opportunityFailed: boolean; trends: AreaTrends | null; trendsFailed: boolean; enrolled: AreaEnrolled | null; enrolledFailed: boolean; kindergartens: AreaKindergartens | null; radiusKm: RadiusKm }`
  - `export type SectionState = 'ok' | 'loading' | 'failed'`
  - `export interface FactRow { label: string; value: string; detail?: string; tone?: 'up' | 'down' }`
  - `export interface VillageFacts { code: string; title: string; subtitle: string; kids: { state: SectionState | 'outside' | 'no-population' | 'unavailable'; rows: FactRow[]; note: string; mergeNote: string }; ours: { state: SectionState; rows: FactRow[]; openRecordsArea: string | null }; nearby: { name: string; kind: string; kindLabel: string; distance: string }[] | null }`
  - `export function villageFacts(code: string, sources: FactsSources): VillageFacts | null` — 里界沒有這個代碼回 `null`。
  - `export function outsideRadiusText(centroidDistanceM: number, radiusKm: RadiusKm): string`（D20）

規則（規格 §2.4、D8、D9、D15–D18、D20）：
- 2–5 歲：trends 列的 `children`，沒有 trends 列才用 opportunity 列；0–1 歲：opportunity 的 `infants`（合併組加總組內各代碼）。
- trends 列用 `codes.includes(code)` 找；opportunity 列用 `village_code`；合併組時 opportunity 取組內所有代碼的列加總 `visit`、`expected`、`infants`，不寫判讀。
- 招生機會那列只在 `opportunity.baseline?.judged === true` 時出現：值 `參觀 N 位（x.x%）`，detail `照附近應有約 M 位・<signalText>`（合併組 detail 只寫照附近應有）。
- `kids.state`：opportunity 與 trends 都還沒回來＝`loading`；兩份都失敗＝`failed`；`opportunityUnavailable` 有值＝`unavailable`（note 寫那句原因）；代碼在 `no_population_villages`＝`no-population`（note `這個里沒有人口資料。`）；兩份都沒有這個代碼＝`outside`（note＝`outsideRadiusText`）。
- 副標：半徑內 `距本校 <formatDistance(distance_m)>・<學校>學區`（學校用 `villageSchoolsText`，沒有學區只寫距離）；`outside` 時 `在本校 <r> 公里外`。
- 我們：在籍（`enrolled.status !== 'ready'` 時不列這列；對代碼、對不到用區＋里；detail `幼幼 a・小 b・中 c・大 d`，「其他」大於 0 才接）；參觀（`area.villages` 用 `villageKey`，detail `預繳 M`；`visit > 0` 時 `openRecordsArea = '<區>/<里>'`）。
- 附近的幼兒園：`kindergartens` 是 null 或本校沒座標或 `distanceMeters(centroid, campus) > radiusKm * 1000 - 500` 時回 `null`；否則 500 m 內依距離最多 5 所，`is_own` 的 `kindLabel` 寫 `本機構`。

- [ ] **Step 1: 寫失敗測試**（fixture 全用 `admissionsTestKit`：`areaStats()`、`areaOpportunity()`、`areaTrends()`、`areaEnrolled()`、`areaKindergartens()`、`villageBoundaries()`）

```ts
it('一般的里：本揚里的孩子、我們、附近幼兒園', () => {
  const f = villageFacts('64000050015', sources())!
  expect(f.title).toBe('三民區本揚里')
  expect(f.subtitle).toBe('距本校 300 m・東光國小學區')
  expect(rows(f.kids)).toEqual([
    ['2–5 歲', '317 位'], ['0–1 歲', '90 位'], ['這一年淨增', '+36（+12.8%）', '增加多'],
    ['近 12 個月出生', '36 位'], ['近 12 個月淨遷入', '−122 人'], ['近 4 季新屋交屋', '24 筆'], ['所得中位數', '45.8 萬'],
    ['招生機會', '參觀 6 位（2.0%）', '照附近應有約 6 位・差不多'],
  ])
  expect(rows(f.ours)).toEqual([['在籍', '3 位', '幼幼 0・小 2・中 1・大 0'], ['參觀', '3 位', '預繳 1']])
  expect(f.ours.openRecordsArea).toBe('三民區/本揚里')
  expect(f.nearby!.map((k) => k.name)).toEqual(['常春藤幼兒園', '大樹幼兒園'])
  expect(f.nearby![0]!.kindLabel).toBe('本機構')
})
it('merged member picked on map：龍子里用整組數字、寫和寶業里合併', () => {
  const f = villageFacts('64000020015', sources())!
  expect(f.title).toBe('鼓山區龍子里')
  expect(f.kids.mergeNote).toBe('里界調整，和寶業里合併計算')
  expect(value(f.kids, '2–5 歲')).toBe('583 位')
  expect(value(f.kids, '招生機會')).toBe('參觀 11 位（1.9%）')   // 組內只有寶業里有列：11 ÷ 583
  expect(detail(f.kids, '招生機會')).toBe('照附近應有約 4 位')
})
it('judged 為 false：卡片不列招生機會', () => { /* baseline.judged=false → 沒有「招生機會」列 */ })
it('半徑外：三種文案（D20）', () => {
  expect(outsideRadiusText(2000, 1)).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 3 公里就看得到。')
  expect(outsideRadiusText(4000, 3)).toBe('在本校 3 公里外，孩子數只算範圍內的里；把範圍改成 6 公里就看得到。')
  expect(outsideRadiusText(8000, 3)).toBe('在本校 6 公里外，沒有孩子數。')
  expect(outsideRadiusText(8000, 6)).toBe('在本校 6 公里外，沒有孩子數。')
})
it('半徑外的里：只列在籍與參觀、副標不寫距離、不列附近幼兒園', () => {
  // boundaries 加一個 左營區新上里 64000030020（座標約 120.30, 22.70，離本校約 8 km）
  // → kids.state 'outside'、subtitle '在本校 3 公里外'、ours 在籍 '1 位'、nearby null
})
it('讀取狀態分段：opportunity 與 trends 都 null → kids loading；都失敗 → failed；enrolled 失敗只影響我們段', () => {})
it('沒有人口資料、人口未匯入、本校沒座標', () => {})
it('附近幼兒園：里中心離本校超過半徑減 0.5 km 不列（D8）', () => {})
it('里界沒有的代碼回 null', () => { expect(villageFacts('64000099999', sources())).toBeNull() })
```

`rows()`／`value()`／`detail()` 是測試檔內的小幫手（`[label, value, detail?]`）。百分比「1.9%」用 `formatRate`（小數一位）。

- [ ] **Step 2: 跑 `villageFacts` 確認失敗。**
- [ ] **Step 3: 實作 `villageFacts.ts`；`opportunitySummary` 的判讀句改用 `NOT_JUDGED_NOTE`。**
- [ ] **Step 4: 跑 `villageFacts`、`areaFormat`** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 里卡片的資料組合`

### Task 4: `areaPane.ts`：模式停用、預設、排行、右欄摘要與頁尾文字（純函式）

**Files:**
- Create: `admin/src/components/admissions/area/areaPane.ts`
- Modify: `admin/src/components/admissions/area/AreaTab.vue:267-303`（`status`、`noAddressText` 的組字搬進 `addressSummary`／`dataStatusText`，AreaTab 暫時改呼叫新函式，畫面不變）
- Test: `admin/src/__tests__/areaPane.test.ts`

**Interfaces:**
- Consumes: Task 1 `MapMode`；Task 3 `NOT_JUDGED_NOTE`、`featureCode`；`peerFeesFormat` 的 `peerSummaryText`（同業模式摘要）、`feeLagNote`（收費學年落後）；`areaFormat` 的 `opportunitySummary`、`trendsSummary`、`enrolledVillageRows`、`kidsNetText`、`signedCount`、`signedPercent`、`expectedText`、`trendsPlaceName`、`formatDistance`、`bandLabel`、`reasonLabel`、`doorplateVersionLabel`、`taipeiMonthDay`、`babycareStatusText`、`populationVersionLabel`。
- Produces:
  - `export interface ModeNotes { enrolled: string; opportunity: string; trend: string; homes: string; judged: boolean | null }`（`judged`：opportunity 還沒回來是 null）
  - `export function modeNote(mode: MapMode, notes: ModeNotes): string` — `opportunity`＝`notes.opportunity || (notes.judged === false ? NOT_JUDGED_NOTE : '')`；`children`＝`notes.opportunity`；`visits`、`peers`＝`''`。
  - `export function defaultMapMode(notes: ModeNotes): MapMode` — `enrolled` → `children` → `visits`（規格 §2.1）。
  - `export function resolveMapMode(requested: MapMode | null, notes: ModeNotes): MapMode` — 要的可用就用，否則預設。
  - `export interface RankingItem { code: string | null; name: string; distance: string; value: string; detail: string; tone?: 'up' | 'down' }`
  - `export interface RankingSection { title: string; items: RankingItem[] }`（只有一段時 `title: ''`）
  - `export interface PaneHead { title: string; lines: string[]; note: string; empty: string }`
  - `export function rankingFor(mode: Exclude<MapMode, 'peers'>, data: PaneData): RankingSection[]` 與 `export function paneHead(mode: MapMode, data: PaneData): PaneHead`，`PaneData = { boundaries: VillageBoundaries | null; area: AdmissionsArea; opportunity: AreaOpportunity | null; trends: AreaTrends | null; enrolled: AreaEnrolled | null; gradeFilter: GradeFilter; peerFees: AreaPeerFees | null; emptyText: string; radiusKm: RadiusKm }`
  - `export function enrolledSummary(data: AreaEnrolled): string`（新寫：`N 位，a 位（x%）住 1 公里內、b 位（y%）住 3 公里內。`，百分比四捨五入整數，`b` 含 1 公里內）
  - `export function addressSummary(area: AdmissionsArea): { text: string; showLink: boolean; noAddress: string }`（現 `.area-summary` 那句與 `noAddressText` 原文，`text` 開頭改「參觀有地址」，D2）
  - `export function dataStatusText(area: AdmissionsArea, enrolled: AreaEnrolled | null, peerFees: AreaPeerFees | null): string`（現 `.area-status` 四段＋`在籍清冊 2026/10/15`＋`收費 114 學年公告`；收費學年落後 `current_school_year` 時接 `（目前是 115 學年）`；門牌未匯入時那句照舊放第一句）

排行規則照規格 §2.3 表格；名次由元件畫。`code`：在籍與參觀的列有 `village_code` 用它，沒有就 `featureCode(boundaries, 區, 里)`，再沒有就 `null`（元件畫成不可點的文字）。合併組的 `code` 是 `codes[0]`。

- [ ] **Step 1: 寫失敗測試**

```ts
it('預設模式與退回（§2.1、D15）', () => {
  const ok: ModeNotes = { enrolled: '', opportunity: '', trend: '', homes: '', judged: true }
  expect(defaultMapMode(ok)).toBe('enrolled')
  expect(defaultMapMode({ ...ok, enrolled: '尚未匯入在籍名冊。' })).toBe('children')
  expect(defaultMapMode({ ...ok, enrolled: 'x', opportunity: '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。' })).toBe('visits')
  expect(modeNote('opportunity', { ...ok, judged: false })).toBe('附近參觀還不到 10 位，先不判斷哪些里偏少。')
  expect(modeNote('children', { ...ok, judged: false })).toBe('')
  expect(modeNote('opportunity', { ...ok, judged: null })).toBe('')   // 讀取中不算停用
  expect(resolveMapMode('trend', { ...ok, trend: '里的變化讀取失敗。' })).toBe('enrolled')
  expect(resolveMapMode(null, ok)).toBe('enrolled')
})
it('排行：2–5 歲孩子、孩子增減兩段、新屋、參觀、招生機會、在籍', () => {
  expect(names(rankingFor('children', data()))).toEqual([['三民區鼎金里', '三民區本揚里', '三民區寶業里']])
  const trend = rankingFor('trend', data())
  expect(trend.map((s) => s.title)).toEqual(['增加最多', '減少最多'])
  expect(trend[0]!.items.map((i) => [i.name, i.value, i.detail, i.code])).toEqual([
    ['三民區本揚里', '+36', '+12.8%', '64000050015'],
    ['三民區寶業里、龍子里（里界調整，合併）', '+12', '+2.0%', '64000050025'],
  ])
  expect(trend[1]!.items.map((i) => i.value)).toEqual(['−22'])
  expect(values(rankingFor('homes', data()))).toEqual([['106 筆', '24 筆']])
  expect(rankingFor('visits', data())[0]!.items.map((i) => [i.name, i.value, i.detail, i.code])).toEqual([
    ['三民區本揚里', '3 位', '預繳 1', '64000050015'], ['三民區寶業里', '1 位', '預繳 1', '64000050025'],
    ['鼓山區龍子里', '1 位', '預繳 0', '64000020015'],   // village_code 是 null，靠里界名稱找代碼
  ])
  expect(values(rankingFor('opportunity', data()))).toEqual([['少約 7 位']])
  expect(names(rankingFor('enrolled', data()))).toEqual([['三民區本揚里', '三民區寶業里', '左營區新上里']])
})
it('摘要：在籍、參觀有地址、資料版本', () => {
  expect(enrolledSummary(areaEnrolled())).toBe('5 位，2 位（40%）住 1 公里內、3 位（60%）住 3 公里內。')
  expect(addressSummary(areaStats()).text).toBe('參觀有地址 7 筆：到里 5 筆、未定位到里 2 筆（只到區 1、查無門牌 1）')
  expect(dataStatusText(areaStats(), areaEnrolled(), areaPeerFees()))
    .toContain('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新')
})
```

`addressSummary` 與 `dataStatusText` 的完整期望值，照目前 `areaTab.test.ts` 對 `.area-summary`／`.area-status` 的斷言改成新開頭。

- [ ] **Step 2: 跑 `areaPane` 確認失敗。**
- [ ] **Step 3: 實作；AreaTab 的 `status`／`noAddressText` 改呼叫 `addressSummary`／`dataStatusText`，但 `.area-head` 先留著（Task 9 才搬到頁尾），所以畫面上的字只差「有地址」→「參觀有地址」。** 跟著改 `areaTab.test.ts` 對這兩句的斷言。
- [ ] **Step 4: 跑 `areaPane`、`areaTab`** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 區域分析右欄的模式停用、預設、排行與摘要`

### Task 5: 各里合併表（`villageTable.ts`＋`AreaVillageTable.vue`）與 StatsDimensionTable 兩個新 prop

**Files:**
- Create: `admin/src/components/admissions/area/villageTable.ts`、`admin/src/components/admissions/area/AreaVillageTable.vue`
- Modify: `admin/src/components/admissions/StatsDimensionTable.vue`（新 prop `nameAction`、`captionCollapsed`）
- Test: `admin/src/__tests__/villageTable.test.ts`、`admin/src/__tests__/statsDimensionNameAction.test.ts`

**Interfaces:**
- Consumes: Task 3 `NOT_JUDGED_NOTE`；VillageTrendsPanel 與 OpportunityPanel 現有的 `COLUMNS`、`rows` 映射、`csvCell`、`csvColumns`、`caption` 組字（搬過來，原元件在 Task 9 刪）。
- Produces:
  - `export type VillageSort = 'shortfall' | 'children' | 'up' | 'down' | 'homes' | 'enrolled'`
  - `export interface VillageTableRow extends Record<string, unknown> { key: string; code: string; place: string; merged: boolean; /* 畫面欄位 */ }`
  - `export function villageTableRows(trends: AreaTrends | null, opportunity: AreaOpportunity | null, enrolled: AreaEnrolled | null): VillageTableRow[]`（底：trends，沒有 trends 用 opportunity）
  - `export function sortVillageRows(rows: readonly VillageTableRow[], sort: VillageSort): VillageTableRow[]`
  - `export function villageSortOptions(judged: boolean): { value: VillageSort; label: string }[]`（`judged` 時最前面多 `參觀偏少`）
  - `export function defaultVillageSort(judged: boolean): VillageSort`（D11）
  - `export function villageColumns(judged: boolean, allChildren: boolean): StatsColumn[]`、`export function villageCsvColumns(...)`、`export function villageCsvCell(row, column): CsvCell | undefined`
  - `export function villageHowText(trends: AreaTrends | null, opportunity: AreaOpportunity | null): string`（兩個面板原本的 caption 接起來）
  - `AreaVillageTable.vue` props `{ trends: AreaTrends | null; trendsFailed: boolean; opportunity: AreaOpportunity | null; opportunityFailed: boolean; enrolled: AreaEnrolled | null; csvName: (title: string) => string }`，emits `select-village: [code: string]`、`retry-trends: []`、`retry-opportunity: []`。
  - StatsDimensionTable：`nameAction?: string`（有值時 sticky 名稱欄在所有寬度都是原生 button、`aria-label` 為 `${nameAction}：${名稱}`，按下 emit `name-action: [row: Row]`；和 `actionLabel` 的手機名稱連結互不影響）、`captionCollapsed?: boolean`（caption 改放 `<details class="stats-block__how"><summary>這些數字怎麼算</summary><p class="hint">…</p></details>`）。

欄、排序、合併組、CSV 照規格 §2.8 與 D16–D17。CSV 欄名順序：`#`、`里`、`里代碼`、`距本校`、`2–5 歲`、`0–1 歲`、`這一年淨增`、`一年前 1–4 歲`、`孩子增減`、`近 12 個月出生`、`近 12 個月淨遷入`、`近 4 季新屋`、`最近一季新屋`、`所得中位數（千元）`、`所得年度`、`界線在所得年度後調整`、`國小學區`、`在籍`、`在籍幼幼班`、`在籍小班`、`在籍中班`、`在籍大班`、`在籍其他`、`參觀人數`、`參觀率`、`照附近應有`、`判讀`（參觀四欄不論 judged 都輸出）。`里代碼`欄合併組寫全部代碼以「、」分隔。名稱按鈕的 `nameAction` 文字：`在地圖上選取`。表格上方一行：trends 失敗時 `無法讀取里的變化，請重新載入。`＋重試鈕；opportunity 失敗時 `無法讀取招生機會，請重新載入。`＋重試鈕（原文案）。

- [ ] **Step 1: 寫失敗測試 `villageTable.test.ts`**

```ts
it('judged：多參觀四欄、預設參觀偏少、合併組排最後且不判讀', () => {
  const rows = sortVillageRows(villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled()), defaultVillageSort(true))
  expect(rows.map((r) => r.place)).toEqual(['三民區鼎金里', '三民區本揚里', '三民區寶業里、龍子里（里界調整，合併）'])
  expect(villageColumns(true, true).map((c) => c.label).slice(-4)).toEqual(['參觀人數', '參觀率', '照附近應有', '判讀'])
  const group = rows[2]!
  expect([group.visit, group.expected_text, group.signal_text, group.enrolled]).toEqual([11, '約 4 位', '—', 1])
})
it('沒到門檻：沒有參觀欄、預設孩子最多', () => {
  const opp = areaOpportunity({ baseline: { ...areaOpportunity().baseline!, judged: false } })
  expect(villageColumns(false, true).map((c) => c.label)).not.toContain('參觀人數')
  expect(sortVillageRows(villageTableRows(areaTrends(), opp, null), defaultVillageSort(false)).map((r) => r.place))
    .toEqual(['三民區寶業里、龍子里（里界調整，合併）', '三民區鼎金里', '三民區本揚里'])
  expect(villageSortOptions(false).map((o) => o.label)).toEqual(['孩子最多', '增加最多', '減少最多', '新屋最多', '在籍最多'])
})
it('trends 讀不到：以 opportunity 為底、里的變化欄寫「—」', () => {})
it('CSV：欄名聯集、合併組里代碼、數字格式沿用', () => {})
```

`statsDimensionNameAction.test.ts`：`nameAction` 在桌機與手機寬度都畫 button、`aria-label` 為 `在地圖上選取：三民區本揚里`、點了 emit `name-action`；`captionCollapsed` 時 caption 在 `details` 裡、預設收起。

- [ ] **Step 2: 跑兩個測試確認失敗。**
- [ ] **Step 3: 實作。** `StatsDimensionTable` 加的 button 沿用 `.stats-table__name-link` 樣式。
- [ ] **Step 4: 跑 `villageTable`、`statsDimensionNameAction`、`statsDimensionCsv`** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 招生機會、里的變化、在籍合成一張各里表`

### Task 6: AreaMap：模式改 prop、點里選取、選取外框、同業模式

**Files:**
- Modify: `admin/src/components/admissions/area/AreaMap.vue`
- Test: `admin/src/__tests__/areaMap.test.ts`

**Interfaces:**
- Consumes: Task 1 `MapMode`（含 `peers`）。
- Produces（AreaMap 新介面）：
  - props 新增 `mode: MapMode`（必填）、`selectedCode?: string`（預設 `''`）；拿掉 `opportunityNote`、`trendNote`、`homesNote`、`enrolledNote`（停用判斷搬到 AreaTab）；其餘 props 不變，`gradeFilter` 保留（畫點用），但不再 emit `update:gradeFilter`。
  - emits：拿掉 `open-area` 與 `update:gradeFilter`，新增 `select-village: [payload: { code: string; district: string; village: string }]`。
  - `defineExpose({ focusKindergarten, focusBabycare, revealBabycare, focusVillage })`，`focusVillage(code: string): void`。

做法（規格 §2.2、D3、D6、D7）：
- 刪內部 `mode` ref、`modeNote`、`modeOptions`、`modeNotes`、模式 radio（:698-705）、退回 watch（:649-651）、圖例裡的班別 radio（:707-716）。`modeLabel`、`canvasLabel` 改讀 `props.mode`；`canvasLabel` 的「下方的…」改成對應的表格分頁名（參觀→參觀來源、孩子增減／新屋→各里、招生機會／2–5 歲→各里、在籍→在籍學生、同業→同業收費）。
- `villageClass`：`peers` 回 `area-village area-village--l0`；其餘同現在。
- `onEachFeature`：不再 `bindPopup`，改 `layer.on('click', () => emit('select-village', { code: VILLCODE, district: TOWNNAME, village: VILLNAME }))`；tooltip 照舊。`villagePopup`、`opportunityLines`、`trendLines`、`homesLines`、`enrolledVillageLines` 刪掉。
- `buildMap` 建圖後先 `createPane('area-selected')`（`style.zIndex = '410'`、`style.pointerEvents = 'none'`）與 `createPane('area-points')`（`style.zIndex = '420'`）；幼兒園 circleMarker 與在籍點加 `pane: 'area-points'`。選取外框：`watch(() => props.selectedCode)` 時移除舊外框，用 `L.geoJSON(feature, { pane: 'area-selected', interactive: false, style: { className: 'area-village-selected', fill: false, weight: 2.5 } })` 畫新的；CSS `.area-map :deep(.area-village-selected) { stroke: var(--ink); }`。不動里界圖層、不呼叫 `drawVillages`。
- `focusVillage(code)`：找到 feature 的 bounds，`map.getBounds().contains(bounds)` 為 false 才 `map.panTo(bounds.getCenter())`，不改縮放。
- `peers` 模式：幼兒園圖層強制顯示，開關 `disabled`、`active-text` 後接一行 hint `同業模式一律顯示`。
- `.area-map__canvas` 高度 520 → 620（手機 50vh 規則不動）。

- [ ] **Step 1: 改測試** — mock：geoJSON 子圖形補 `on(event, fn)`（記下 click handler）、map 補 `createPane(name)`（回一個 `{ style: {} }`）、`getBounds()`（回 `{ contains: () => false }` 可改）、`panTo`。新增／改寫：

```ts
it('點里：發出 select-village，不綁 popup', () => {
  // 手動呼叫 onEachFeature(本揚里 feature, layer stub) → layer.bindPopup 沒被呼叫
  // 觸發記下的 click → emitted('select-village')[0] toEqual [{ code: '64000050015', district: '三民區', village: '本揚里' }]
})
it('selectedCode 改變：畫外框在 area-selected pane，不重建里界', () => {
  // geoJSON 呼叫次數只多 1（外框），且那次 options.pane === 'area-selected'、interactive === false
})
it('mode 是 prop：children 時鼎金里 l5；peers 時全部 l0、幼兒園開關鎖住並寫同業模式一律顯示', () => {})
it('幼兒園點畫在 area-points pane', () => {})
it('focusVillage：不在視野才 panTo，不改縮放', () => {})
```

  刪掉 popup 段、模式 radio 段、退回 watch 段、班別 radio 段的舊測試；原始碼掃描（不得靜態 import leaflet、style 不得有色碼、token 名稱在原文中）保留。
- [ ] **Step 2: 跑 `areaMap` 確認新案例失敗。**
- [ ] **Step 3: 實作。** AreaTab 暫時傳 `mode` 與 `selectedCode`：先用 `const mapMode = ref<MapMode>('visits')` 讓它編得過（Task 9 換成真的），`select-village` 先不接。`areaTab.test.ts` 的 AreaMap stub 同步改 props／emits 清單（拿掉四個 note 與 `open-area`，加 `mode`、`selectedCode`、`select-village`）。
- [ ] **Step 4: 跑 `areaMap`、`areaTab`、typecheck** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 區域地圖改由外層決定著色，點里改成選取並畫外框`

### Task 7: 右欄元件：排行、里卡片、右欄容器；附近清單拿掉半徑鈕

**Files:**
- Create: `admin/src/components/admissions/area/AreaRanking.vue`、`VillageCard.vue`、`AreaSidePane.vue`
- Modify: `NearbyPanel.vue`（拿掉 `radiusKm` 的 `update:radiusKm` 轉送）、`NearbyKindergartens.vue:73,102-104`、`NearbyBabycare.vue:48,56-58`（拿掉半徑 radio 與 `update:radiusKm`，`radiusKm` prop 保留給文案）
- Test: `admin/src/__tests__/areaSidePane.test.ts`；改 `nearbyKindergartens.test.ts`、`nearbyProviders.test.ts`

**Interfaces:**
- Consumes: Task 3 `VillageFacts`；Task 4 `RankingSection`、`PaneHead`。
- Produces:
  - `AreaRanking.vue`：props `{ sections: RankingSection[]; limit: number }`；emits `select: [code: string]`。每列 `<button type="button" class="area-ranking__item">`（`code` 為 null 的列畫 `<div>`）；名次、`name`＋`distance`、右側 `value`＋小字 `detail`（tone 用 `--admin-accent-hover`／玫瑰色 token）。超過 `limit` 時「顯示更多」到 20。
  - `VillageCard.vue`：props `{ facts: VillageFacts }`；emits `close: []`、`open-records: [area: string]`、`retry: [section: 'kids' | 'ours']`；`defineExpose({ focusHeading })`。標題 `<h2 tabindex="-1">`、×（`aria-label="關閉里卡片"`）、三段（孩子／我們／附近的幼兒園，`nearby` 是 null 不畫第三段）；段狀態 `loading` 畫 `el-skeleton :rows="3"`、`failed` 寫 `讀取失敗` 加「重試」。我們段 `openRecordsArea` 有值時一顆 `el-button type="primary" plain size="small"`「查看這個里的訪視」。卡片根元素 `@keydown.esc` emit `close`。
  - `AreaSidePane.vue`：props `{ head: PaneHead; sections: RankingSection[]; loading: boolean; failed: string; facts: VillageFacts | null; peers: boolean; narrow: boolean }`；emits `select`、`close`、`open-records`、`retry`、`retry-facts`；default slot＝同業模式的內容（AreaTab 放 NearbyPanel＋ProviderChanges）；named slot `head-extra`（在籍模式放班別 radio）。`facts` 有值時只畫 VillageCard；否則 `peers` 畫 slot、其他畫標題＋摘要＋AreaRanking（`limit` 桌機 10、`narrow` 5）；`loading` 畫骨架、`failed` 寫原因＋重試。`defineExpose({ focusCard })`。

- [ ] **Step 1: 寫失敗測試 `areaSidePane.test.ts`**

```ts
it('排行：列是按鈕、點了 emit select(code)，code 為 null 不可點；手機 5 列＋顯示更多', () => {})
it('里卡片：三段、查看這個里的訪視帶 三民區/本揚里、Esc 與 × 都 emit close', () => {})
it('里卡片：段落讀取中與失敗；nearby 為 null 不畫附近的幼兒園', () => {})
it('同業模式畫 slot；選了里時卡片優先', () => {})
```

  `nearbyKindergartens.test.ts`、`nearbyProviders.test.ts` 裡找「搜尋半徑」radio 的案例改成斷言 radio 不存在、文案仍寫 `3 公里內…`。
- [ ] **Step 2: 跑三個測試確認失敗。**
- [ ] **Step 3: 實作。** 樣式：右欄標題區 `position: sticky; top: 0` 背景 `--surface`；排行列 hover `--surface-2`；不加側條。
- [ ] **Step 4: 跑 `areaSidePane`、`nearbyKindergartens`、`nearbyProviders`** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 區域分析右欄的排行與里卡片`

### Task 8: 表格分頁 `AreaTables.vue`

**Files:**
- Create: `admin/src/components/admissions/area/AreaTables.vue`
- Modify: `SchoolDistrictPanel.vue`（StatsDimensionTable 加 `caption-collapsed`）、`BirthSeries.vue`（不改介面，只確認能單獨放；原本由 VillageTrendsPanel 的 slot 帶的底註搬到 AreaTables 的出生走勢頁）
- Test: `admin/src/__tests__/areaTables.test.ts`

**Interfaces:**
- Consumes: Task 1 `AreaTableTab`；Task 5 `AreaVillageTable`；現有 `SchoolDistrictPanel`、`EnrolledPanel`、`PeerFeesPanel`、`BirthSeries`、`StatsDimensionTable`（參觀來源三張，欄位與 `openDistrict`／`openVillage` 從 AreaTab:305-350 搬來）。
- Produces: `AreaTables.vue` props `{ tab: AreaTableTab; area: AdmissionsArea; trends; trendsFailed; opportunity; opportunityFailed; enrolled; enrolledFailed; gradeFilter: GradeFilter; peerFees; peerFeesFailed; peerAge: PeerAge; csvName; emptyText: string }`；emits `update:tab`、`update:peerAge`、`select-village: [code]`、`open-records: [filter: { area: string }]`、`retry: [source: 'trends' | 'opportunity' | 'enrolled' | 'peerFees']`。

頁籤用 `el-tabs`（底線樣式），標籤與數字照規格 §2.7（數字 `<span class="area-tables__count">` 淺灰；同業收費的數字＝`peerFees.schools` 裡 `semester_total` 不是 null 的所數，資料還沒回來時不帶數字）；`v-if` 只畫目前那頁；標題 `完整表格`（h2 `--text-xl`）。在籍學生頁 `enrolled.status === 'not_imported'` 時寫 `尚未匯入在籍名冊。`。參觀來源頁沒有訪視時寫 `emptyText`。

- [ ] **Step 1: 寫失敗測試**

```ts
it('六個頁籤與數字；預設各里；切頁 emit update:tab', () => {
  // 標籤文字依序 ['各里3', '國小學區3', '在籍學生5', `同業收費${有收費的所數}`, '出生走勢', '參觀來源7']（同業數字依 areaPeerFees() 的 schools 算）
})
it('只畫目前那頁（v-if）', () => {})
it('參觀來源：三張表與查看明細 emit open-records（area 三民區/本揚里）', () => {})
it('各里：點里名 emit select-village(64000050001)', () => {})
it('學區表的長說明收在「這些數字怎麼算」', () => {})
```

- [ ] **Step 2: 跑 `areaTables` 確認失敗。**
- [ ] **Step 3: 實作。**
- [ ] **Step 4: 跑 `areaTables`** → PASS。
- [ ] **Step 5: Commit** — `feat(admin): 區域分析的完整表格收成六個分頁`

### Task 9: AreaTab 組裝：工具列、工作台、選取流程、頁尾；刪舊面板

**Files:**
- Modify: `admin/src/components/admissions/area/AreaTab.vue`（template 與版面整段重寫；資料讀取 :63-251 不動）
- Delete: `admin/src/components/admissions/area/OpportunityPanel.vue`、`VillageTrendsPanel.vue`
- Test: `admin/src/__tests__/areaTab.test.ts`（大改）、`admin/src/__tests__/areaTabChunkFailure.test.ts`

**Interfaces:**
- Consumes: Task 2 `view` model；Task 3 `villageFacts`；Task 4 `modeNote`／`resolveMapMode`／`rankingFor`／`paneHead`／`addressSummary`／`dataStatusText`；Task 5–8 的元件。
- Produces: 無新對外介面（StatsTab 照 Task 2 的接法）。

行為（規格 §2、§3、§4、§5）：
- `notes` computed 組 `ModeNotes`（`judged` 取 `opportunity.value?.baseline?.judged ?? null`）；`mapMode = computed(() => resolveMapMode(view.value.map, notes.value))`。使用者按工具列：`view.value = { ...view.value, map: value === defaultMapMode(notes.value) ? null : value }`。`watch(notes)`：`view.map` 有值但停用了 → 設成 `null`（退回預設、網址拿掉）。
- 工具列：左 `<span>看什麼</span>`＋`el-radio-group`（`aria-label="看什麼"`、`MAP_MODES`、停用依 `modeNote`），右 `範圍`＋`el-radio-group`（`RADIUS_OPTIONS`）；停用原因去重寫在下一行（`.area-toolbar__note`）。≤720px：模式列 `overflow-x: auto`、不換行；範圍換到下一行。
- 工作台：`.area-workbench` grid `minmax(0, 1fr) 380px`，同一個 `--line` 框、`--radius-lg`；1199px 以下單欄。AreaMap 傳 `mode`、`selectedCode = view.village`、`@select-village="selectFromMap"`。
- 卡片重試：`retry-facts('kids')` 重讀 opportunity 與 trends（各自 `loadOpportunity()`／`loadTrends()`），`retry-facts('ours')` 重讀 enrolled 與 area（`loadEnrolled()`／`load()`）。
- 選取：`selectFromMap({ code })` → `view.village = code`、`announce = '已選取' + 名稱`（`<p class="visually-hidden" aria-live="polite">`）；`selectFromList(code)`（排行、各里表）→ `view.village = code`、`map.value?.focusVillage(code)`、`nextTick` 後 `sidePane.value?.focusCard()`；`narrow` 時再 `scrollIntoView({ block: 'start' })` 到卡片。關閉 → `view.village = ''`。
- `facts = computed(() => view.value.village && boundaries.value ? villageFacts(...) : null)`；里界已載入且 `villageFacts` 回 null → `view.village = ''`（Review Focus 3：里界還沒到時不刪）。
- 右欄：`AreaSidePane` 的 `head`／`sections` 用 `paneHead(mapMode, …)`／`rankingFor(mapMode, …)`；`loading`／`failed` 依該模式需要的那份資料（在籍→enrolled、2–5 歲與招生機會→opportunity、孩子增減與新屋→trends、參觀→area、同業→不用）；`head-extra` slot 在在籍模式放班別 radio（`gradeOptions`，`v-model` 到 `gradeFilter`）。同業模式 slot 放 `NearbyPanel`（不再傳 `v-model:radius-km`）＋`ProviderChanges`。
- 地圖下方：`AreaTables`（`v-model:tab` 接 `view.table`、`v-model:peer-age`）；最後頁尾 `.area-footer`（`--line` 上框、`.hint`）：`addressSummary` 那句＋「查看」（`openNoVillage`）＋`noAddress`，再一行 `dataStatusText`。
- 刪 `.area-head`、`.area-top`、`.area-tables` 與它們的樣式；`NoMap` 失敗處理保留。

- [ ] **Step 1: 改寫 `areaTab.test.ts`**（mount 方式、`mockGet` 路由、AreaMap stub 照舊；stub 的 props 已在 Task 6 改過）。保留各份資料各自成敗、骨架、失敗重試的案例，改成在新位置斷言。新增：

```ts
it('預設模式：清冊已匯入 → 在籍學生；未匯入 → 2–5 歲孩子；judged false 時招生機會停用並寫原因', async () => {})
it('falls back when map is disabled：網址 map=enrolled、清冊未匯入 → 工具列選 2–5 歲孩子、emit update:view 的 map 是 null', async () => {})
it('點地圖的里：view.village 寫入、右欄出現里卡片、aria-live 報已選取三民區本揚里', async () => {})
it('從排行選里：focusVillage 被呼叫、焦點到卡片標題；Esc 關卡片、village 清空', async () => {})
it('keeps village until boundaries arrive：里界讀取中不清 village；里界到了沒有這個代碼才清', async () => {})
it('換半徑：保留選取的里，半徑外改限縮卡片', async () => {})
it('同業模式：右欄是附近清單與園所變化；清單沒有半徑鈕', async () => {})
it('頁尾：參觀有地址那句＋查看、資料版本一行；頁首不再有狀態列', async () => {})
it('原始碼掃描：沒有 OpportunityPanel／VillageTrendsPanel、沒有 .area-tables 規則', () => {})
```

  原本對 `.area-tables` 的 `repeat(auto-fit, minmax(min(100%, 36rem), 1fr))` 掃描刪除。`areaTabChunkFailure.test.ts` 加：地圖 chunk 失敗時工具列與右欄在、從排行選里卡片照開且沒有未捕獲錯誤（Review Focus 5）。
- [ ] **Step 2: 跑 `areaTab`、`areaTabChunkFailure` 確認新案例失敗。**
- [ ] **Step 3: 實作 AreaTab；刪兩個舊面板。** `areaTab.test.ts` 裡測招生機會、里的變化面板內容的案例，已在 Task 5（`villageTable.test.ts`）與 Task 8 涵蓋的就刪，沒涵蓋的搬過去。
- [ ] **Step 4: 跑全套 admin 單元測試與 typecheck**（主 session 背景跑）：`npm --prefix admin run test:unit`、`npm --prefix admin run typecheck` → 全綠、0 錯誤。
- [ ] **Step 5: Commit** — `feat(admin): 區域分析改成地圖工作台`

### Task 10: stack e2e、文件與整體驗證

**Files:**
- Modify: `tests/stack/admissions-area.spec.ts`
- Modify: `DESIGN.md`（「招生入學：區域分析」章節後加「區域分析地圖工作台（2026-10-16）」：版面、模式與預設、選取與外框 pane、網址參數、D 項目重點；更正舊段落裡「狀態列寫門牌資料月份」「三張表沿用 auto-fit」等已不成立的描述）、`README.md`（頂部日期段落）、規格狀態列（改成「實作完成、本機驗證通過，待部署」）

**Interfaces:** 無。

- [ ] **Step 1: 環境**：`npm ci`（根目錄）、`npm --prefix web ci`、`(cd backend && uv sync)`；sparse 目錄確認含 `web`、`deploy`（見 memory：缺了會有大量假紅燈）。
- [ ] **Step 2: 改 e2e**：選擇器 `.area-map__modes` → 工具列 `.area-toolbar`；`.area-status`／`.area-summary` → `.area-footer`；三張表 → 「參觀來源」分頁；在籍班別篩選 → 右欄 `head-extra`；查看明細往返改從參觀來源分頁或里卡片按。新增：

```ts
test('工作台：點地圖上的里 → 右欄里卡片、網址 village=、重新整理還原；外框可見、幼兒園點仍可點', async ({ browser }) => {})
test('工作台：從排行選里地圖 panTo；切表格分頁網址 table=；各里表點里名選取並捲回地圖；換校區清掉 village', async ({ browser }) => {})
test('頁長：1440×900 預設狀態 .area 高度 ≤ 1,800px（D19）', async ({ browser }) => {})
test('390px：選里後卡片在地圖下方並捲到標題、移動地圖照舊、頁面不橫向溢出', async ({ browser }) => {})
```

  Axe 掃描加右欄與里卡片。截圖 1440×900、390×844 存 `output/playwright/area-workbench-*.png`。
- [ ] **Step 3: 跑 stack e2e**（主 session 背景；專屬庫名與 port，例 `E2E_DB_NAME=ivy_website_workbench1016_e2e E2E_API_PORT=… E2E_WEB_PORT=…`）：`npm run e2e:build; npm run test:e2e:stack -- admissions-area` → 全過；再跑整套 `npm run test:e2e:stack` 一次（visual 基準不含區域分析）。
- [ ] **Step 4: 全套驗證**：`npm --prefix admin run typecheck`、`npm --prefix admin run test:unit`、`npm run test:website`；`npx impeccable detect --json` 對本機 dev server 的區域分析頁跑一次，處理新出現的問題。
- [ ] **Step 5: 看截圖**：桌機與手機各一張，對照 mock 與規格 §2–§3；有破版就回到對應 Task 修。
- [ ] **Step 6: Commit** — `test(admin): 區域分析工作台的 stack e2e 與文件`

完成後交給使用者：分支、commit 清單、實際跑過的指令與結果、截圖路徑、未驗證項（正式站登入後畫面要使用者看）。push main＝部署，等使用者同意。
