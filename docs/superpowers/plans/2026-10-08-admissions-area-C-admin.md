# 招生區域分析 C 階段：後台畫面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台「招生入學 → 統計分析」新增「區域分析」子分頁（狀態列、里界地圖、附近幼兒園、行政區／里／距離三張表），訪視明細可依區域篩選並顯示比對結果，後台 CSP 放行國土測繪圖磚，補 stack e2e 與文件。

**Architecture:** `AreaTab.vue` 讀 B 的三支 API（`/area`、`/area/boundaries`、`/area/kindergartens`），表格沿用 `StatsDimensionTable`（新增「查看明細」按鈕欄），地圖 `AreaMap.vue` 以 `defineAsyncComponent` 另切 chunk（裡面 static import Leaflet），清單 `NearbyKindergartens.vue` 點列時呼叫地圖的 `focusKindergarten`。區域篩選寫在網址 `area`，經 `useAdmissionsFilters` → `AdmissionsView` → `RecordsTab` → API 的 `district`／`village`／`geo`。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Element Plus、Vite 8、Vitest 4（jsdom）、`@vue/test-utils`、Leaflet 1.9.4、Playwright（stack e2e）、Nuxt server util（CSP）。

**Spec:** `docs/specs/2026-10-08-admissions-area-design.md`（§9 畫面、§9.7 CSP、§12 文件、§14.3–14.5）；總覽 `docs/superpowers/plans/2026-10-08-admissions-area.md`（「B 產出」「C 使用的前端名稱」逐字照用）。

## Global Constraints

（總覽的 Global Constraints 全部適用，這裡只列 C 特別會碰到的。）

- 工作目錄 `~/Repositories/ivy-website-wt/admissions-area-20261008`；不動 `~/Desktop/ivy-website-admin`。
- Node 22：所有 npm 指令前綴 `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null;`（`source` 回 3，用 `;` 不用 `&&`）。下文的 `$NODE` 代表這串前綴。
- 後台只新增 `leaflet@1.9.4`（dependencies，exact）與 `@types/leaflet`（devDependencies）。不裝 Leaflet 外掛、不裝圖表套件、不直接 import `geojson` 型別。
- 顏色一律走 `admin/src/style.css` `:root` 的 token；元件裡不寫 rgba／oklch／hex 字面值。字級只用 `--text-*`（`ux20261005.test.ts` 守門：元件不得寫 `font-size: Npx`、不得有 2px 以上的彩色左右邊框、transition 不碰 width／height）。
- 錯誤提示用 `composables/notify.ts`（`crossUx20261002.test.ts` 守門：不直接呼叫 `ElMessage.error／warning`）；每個 `<el-switch>` 都要 `aria-label`（`a11yStructure.test.ts`）。
- 表頭用語同其他子分頁：「參觀人數／預繳人數／預繳率」。文案不寫操作說明或開發輔助字。
- 原始碼不得出現實體 U+FEFF（`noLiteralBom.test.ts`）；測試要驗 BOM 時用 `charCodeAt(0) === 0xfeff`，不寫跳脫字面值；stack 的門牌樣本 CSV 不加 BOM。
- `admin/src/api/labels.ts` 的 `area` 標籤已由 B 加好，C **不要**再加。
- `/area/kindergartens` 的 `radius_km` 前端只送 1、3、6（後端其他值回 422 `INVALID_RADIUS`）。
- `RecruitmentVisitOut.geo` 可能是 `null`（沒有比對紀錄的舊資料）：**展開列不顯示「區域」那一行**（`visitGeoText(null) === ''`，空值項目本來就不列）。
- 只在使用者同意的前提下於本分支 commit（Conventional Commit、繁體中文、結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`）；不 push、不部署。
- 8GB RAM：同時只跑一組測試；stack e2e 前確認沒有別的 vitest／pytest 在跑。

## Review Focus

1. **網址上的 `area` 被手改成任意字串**（`area=hack`、`area=三民區/abc`、`area=a/b/c`）：明細不帶任何區域參數、網址被改回乾淨的 query，不 500 也不顯示空提示。→ C2 `areaFilter.test.ts`、C3 `admissionsView.test.ts (f)`。
2. **快速切換頁首校區**（明華先回、義華晚回）：區域分析只顯示最後一次的資料，地圖與清單不混校。→ C8 `areaTab.test.ts`「快速切換」。
3. **里界或圖磚載入失敗**：表格照常、地圖區顯示錯誤與重試，重試成功恢復；偶發一兩張圖磚失敗不跳錯誤。→ C6、C8。
4. **手機 390px**：地圖不攔單指捲動（整頁捲得動），頁面不橫向溢出。→ C6「手機」、C10 截圖步驟。
5. **只有本機構、沒有其他園所／校區地址比對不到**：清單寫原因，不顯示空白列表或假 0。→ C7。

---

## 前置閘（開工前一次）

- [ ] **確認 B 階段已完成**：

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008
grep -c "AdmissionsAreaOut\|AreaKindergartensOut\|VisitGeoOut\|AreaDistrictRowOut" contracts/generated/website-api.d.ts
grep -n "district\|village\|geo" backend/app/admissions/records.py | grep -i "query" | head
```

Expected：第一行 ≥ 4；第二行看得到 `district`、`village`、`geo` 三個 Query 參數（`RecruitmentVisitFilters`，明細列表與 `/records/export` 共用）。沒有就停下來回報，不要自己補後端。

- [ ] **裝依賴**（worktree 是新的，三個 node_modules 都沒有）：

```bash
$NODE npm ci; npm --prefix admin ci; npm --prefix web ci
```

---

### Task C1: Leaflet 依賴、API 型別別名與 client

**Files:**
- Modify: `admin/package.json`、`admin/package-lock.json`
- Modify: `admin/src/api/types.ts`（「統計（C3）」那段之後）
- Modify: `admin/src/api/admissions.ts`
- Create: `admin/src/components/admissions/area/areaFormat.ts`（本任務只放 `VillageBoundaries` 型別，C2 補齊）
- Test: `admin/src/__tests__/admissionsApi.test.ts`

**Interfaces:**
- Consumes: 契約產生的 `components['schemas']['AdmissionsAreaOut' | 'AreaDistrictRowOut' | 'AreaVillageRowOut' | 'AreaDistanceBandOut' | 'AreaKindergartensOut' | 'AreaKindergartenOut' | 'VisitGeoOut']`（B）。
- Produces: 型別 `AdmissionsArea`、`AreaDistrictRow`、`AreaVillageRow`、`AreaDistanceBand`、`AreaKindergartens`、`AreaKindergarten`、`VisitGeo`；函式 `getArea`、`getAreaKindergartens`、`getAreaBoundaries`；`RecordFilters` 新增 `district`、`village`、`geo`；`VillageBoundaries`、`VillageProperties`、`VillageFeature`。

- [ ] **Step 1: 加依賴**

```bash
$NODE npm --prefix admin install --save-exact leaflet@1.9.4; npm --prefix admin install -D @types/leaflet@1.9
grep -n '"leaflet"\|"@types/leaflet"' admin/package.json
```

Expected：`"leaflet": "1.9.4"` 在 dependencies；`"@types/leaflet": "^1.9.x"` 在 devDependencies。不要動其他套件版本（`git diff admin/package.json` 只多兩行）。

- [ ] **Step 2: 寫失敗的測試**（加在 `admissionsApi.test.ts` 的 `describe('招生 API 路徑（總覽 API 表）'` 裡最後）

```ts
  it('區域分析三支 API：口徑同統計（學年學期沒選不帶）；幼兒園帶半徑；里界不帶參數', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await admissions.getArea({ campus_key: 'yihua', school_year: 115, semester: null })
    await admissions.getAreaKindergartens('yihua', 6)
    await admissions.getAreaBoundaries()
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/admissions/area?campus_key=yihua&school_year=115',
      '/admin/admissions/area/kindergartens?campus_key=yihua&radius_km=6',
      '/admin/admissions/area/boundaries',
    ])
  })

  it('明細的區域篩選：district／village／geo 有值才帶，列表與匯出同一組', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    await admissions.listRecords({ campus_key: 'yihua', district: '三民區', village: '本揚里', geo: null, page: 1, page_size: 50 })
    expect(String(get.mock.calls[0]![0])).toBe('/admin/admissions/records?campus_key=yihua&district=%E4%B8%89%E6%B0%91%E5%8D%80&village=%E6%9C%AC%E6%8F%9A%E9%87%8C&page=1&page_size=50')
    expect(admissions.recordsExportPath({ campus_key: 'yihua', geo: 'no_village' })).toBe('/admin/admissions/records/export?campus_key=yihua&geo=no_village')
  })
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsApi.test.ts`
Expected: FAIL（`admissions.getArea is not a function`）。

- [ ] **Step 4: 實作**

`admin/src/components/admissions/area/areaFormat.ts`（新檔，本任務只放型別）：

```ts
// 區域分析的顯示格式與地圖用的小工具（2026-10-08 規格 9）。

/** 後端 /area/boundaries 的里界 GeoJSON（高雄 893 里，只留三個屬性）。 */
export interface VillageProperties {
  TOWNNAME: string
  VILLNAME: string
  VILLCODE: string
}
export interface VillageFeature {
  type: 'Feature'
  properties: VillageProperties
  geometry: { type: string; coordinates: unknown }
}
export interface VillageBoundaries {
  type: 'FeatureCollection'
  features: VillageFeature[]
}
```

`admin/src/api/types.ts`：在 `export type AdmissionsStats = components['schemas']['AdmissionsStatsOut']` 那行之後加：

```ts

// 區域分析（2026-10-08 規格 8）。
export type AdmissionsArea = components['schemas']['AdmissionsAreaOut']
export type AreaDistrictRow = components['schemas']['AreaDistrictRowOut']
export type AreaVillageRow = components['schemas']['AreaVillageRowOut']
export type AreaDistanceBand = components['schemas']['AreaDistanceBandOut']
export type AreaKindergartens = components['schemas']['AreaKindergartensOut']
export type AreaKindergarten = components['schemas']['AreaKindergartenOut']
export type VisitGeo = components['schemas']['VisitGeoOut']
```

`admin/src/api/admissions.ts`：

1. 檔頭第二行註解改成：`// 統計：getStats（C3）、getNoDepositRecords（C3b）、getCompare（C4）、區域分析 getArea／getAreaKindergartens／getAreaBoundaries（2026-10-08）。「已到場／未到場」沿用預約既有的`
2. import 加型別並 import 里界型別：

```ts
import type {
  AdmissionsArea, AdmissionsCompare, AdmissionsOptions, AdmissionsStaff, AdmissionsStats, AreaKindergartens, ContactLog, ContactLogCreate,
  ContactLogResult, FollowUpUpdate, FunnelBoard, NoDepositRecords, RecruitmentEvent, RecruitmentVisit,
  RecruitmentVisitCreate, RecruitmentVisitUpdate, SeatRequest, SeatResult, TransitionRequest,
} from './types'
import type { Stage } from '../admissions/constants'
import type { VillageBoundaries } from '../components/admissions/area/areaFormat'
```

3. `RecordFilters` 在 `owner?: string | null` 之後加：

```ts
  // 區域分析的「查看明細」（2026-10-08 規格 8.4）：行政區＋里，或 geo=no_village（未定位到里）。
  district?: string | null
  village?: string | null
  geo?: 'no_village' | null
```

4. 在 `getCompare` 之後加：

```ts

/** 區域分析（2026-10-08 規格 8.1）：口徑同 /stats（校區＋入學學年學期，null＝不篩）。 */
export function getArea(params: { campus_key: string; school_year: number | null; semester: number | null }): Promise<AdmissionsArea> {
  return api.get<AdmissionsArea>(`/admin/admissions/area?${toQuery(params)}`)
}

/** 本校半徑內的幼兒園（規格 8.2），後端依距離排序；半徑只有 1、3、6 公里。 */
export function getAreaKindergartens(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaKindergartens> {
  return api.get<AreaKindergartens>(`/admin/admissions/area/kindergartens?${toQuery({ campus_key: campusKey, radius_km: radiusKm })}`)
}

/** 高雄市里界（規格 8.3）。後端帶 ETag 與一天快取，304 由瀏覽器自己處理。 */
export function getAreaBoundaries(): Promise<VillageBoundaries> {
  return api.get<VillageBoundaries>('/admin/admissions/area/boundaries')
}
```

- [ ] **Step 5: 跑測試確認通過＋型別**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsApi.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯。

- [ ] **Step 6: Commit**

```bash
git add admin/package.json admin/package-lock.json admin/src/api/types.ts admin/src/api/admissions.ts admin/src/components/admissions/area/areaFormat.ts admin/src/__tests__/admissionsApi.test.ts
git commit -m "feat(admin): 區域分析 API client 與 Leaflet 依賴"
```

---

### Task C2: 區域篩選、顯示格式、地圖色票與測試假資料

**Files:**
- Create: `admin/src/admissions/areaFilter.ts`
- Modify: `admin/src/components/admissions/area/areaFormat.ts`（補齊）
- Modify: `admin/src/style.css`（`:root` 加 `--area-*` token）
- Modify: `admin/src/__tests__/admissionsTestKit.ts`（`visit()` 加 `geo: null`；新增區域分析假資料）
- Test: `admin/src/__tests__/areaFilter.test.ts`、`admin/src/__tests__/areaFormat.test.ts`

**Interfaces:**
- Consumes: C1 的型別。
- Produces（後續任務照用）：
  - `areaFilter.ts`：`AreaFilter`、`parseAreaQuery(value: unknown): AreaFilter | null`、`areaQuery(filter)`、`areaNotice(filter)`、`areaApiParams(filter | null)`（主控裁定 R14：明細提示列比照 `vr` 的句型，不另做標籤函式）。
  - `areaFormat.ts`：`RadiusKm`、`RADIUS_OPTIONS`、`villageKey`、`levelOf`、`legendRanges`、`KIND_LABELS`、`KIND_ORDER`、`kindLabel`、`BAND_LABELS`、`bandLabel`、`REASON_LABELS`、`reasonLabel`、`doorplateVersionLabel`、`shortDay`、`formatDistance`、`shortName`、`visitGeoText`。
  - testkit：`areaStats()`、`kindergarten()`、`areaKindergartens()`、`villageBoundaries()`。
  - CSS token：`--area-level-1`…`--area-level-5`、`--area-boundary`、`--area-radius`、`--area-kind-public`、`--area-kind-nonprofit`、`--area-kind-quasi-public`、`--area-kind-private`、`--area-kind-own`、`--area-kind-own-ink`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/areaFilter.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { areaApiParams, areaNotice, areaQuery, parseAreaQuery } from '../admissions/areaFilter'

describe('區域篩選（網址 area，2026-10-08）', () => {
  it('行政區、里、未定位到里三種寫法可以來回轉', () => {
    for (const value of ['三民區', '三民區/本揚里', 'no_village', '鼓山區/北美術館里', '那瑪夏區/達卡努瓦里']) {
      const filter = parseAreaQuery(value)
      expect(filter).not.toBeNull()
      expect(areaQuery(filter!)).toBe(value)
    }
    expect(parseAreaQuery('三民區/本揚里')).toEqual({ kind: 'place', district: '三民區', village: '本揚里' })
    expect(parseAreaQuery('no_village')).toEqual({ kind: 'no_village' })
  })

  it('手改的網址當成沒篩：不是「○○區」「○○區/○○里」也不是 no_village', () => {
    for (const value of ['', 'hack', '三民', '三民區/abc', '三民區/本揚里/x', '/本揚里', '三民區/', 'NO_VILLAGE', 42, null, undefined, ['三民區']]) {
      expect(parseAreaQuery(value)).toBeNull()
    }
  })

  it('提示句與 API 參數', () => {
    const village = parseAreaQuery('三民區/本揚里')!
    const district = parseAreaQuery('三民區')!
    const none = parseAreaQuery('no_village')!
    expect(areaNotice(village)).toBe('只顯示三民區本揚里的訪視。')
    expect(areaNotice(district)).toBe('只顯示三民區的訪視。')
    expect(areaNotice(none)).toBe('只顯示未定位到里的訪視（只到區、查無門牌、非高雄市地址或待比對）。')
    expect(areaApiParams(village)).toEqual({ district: '三民區', village: '本揚里', geo: null })
    expect(areaApiParams(district)).toEqual({ district: '三民區', village: null, geo: null })
    expect(areaApiParams(none)).toEqual({ district: null, village: null, geo: 'no_village' })
    expect(areaApiParams(null)).toEqual({ district: null, village: null, geo: null })
  })
})
```

`admin/src/__tests__/areaFormat.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  bandLabel, doorplateVersionLabel, formatDistance, kindLabel, legendRanges, levelOf, reasonLabel, shortDay, shortName, visitGeoText,
} from '../components/admissions/area/areaFormat'

const geo = (changes: Record<string, unknown> = {}) => ({ village: null, match_level: 'exact', unlocated_reason: null, distance_m: null, ...changes }) as never

describe('區域分析格式（2026-10-08）', () => {
  it('里界 5 級：0 筆是 0 級；其餘依最多的那一里等分；圖例和分級一致', () => {
    expect([0, 1, 2, 3].map((count) => levelOf(count, 3))).toEqual([0, 2, 4, 5])
    expect(levelOf(5, 0)).toBe(0)
    expect(legendRanges(3)).toEqual([{ level: 2, label: '1' }, { level: 4, label: '2' }, { level: 5, label: '3' }])
    expect(legendRanges(12)).toEqual([
      { level: 1, label: '1–2' }, { level: 2, label: '3–4' }, { level: 3, label: '5–7' }, { level: 4, label: '8–9' }, { level: 5, label: '10–12' },
    ])
    expect(legendRanges(0)).toEqual([])
    for (const max of [1, 3, 7, 12, 40]) {
      for (const { level, label } of legendRanges(max)) {
        const [low, high = low] = label.split('–').map(Number)
        expect(levelOf(low!, max)).toBe(level)
        expect(levelOf(high!, max)).toBe(level)
      }
    }
  })

  it('類型、距離分組、原因、門牌版本、日期、距離、園名', () => {
    expect(['public', 'nonprofit', 'quasi_public', 'private', 'other'].map(kindLabel)).toEqual(['公立', '非營利', '準公共', '私立', 'other'])
    expect(['0-1', '1-3', '3-6', '6+', 'none'].map(bandLabel)).toEqual(['1 公里內', '1–3 公里', '3–6 公里', '6 公里以上', '無距離'])
    expect(['no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village', 'anonymized'].map(reasonLabel))
      .toEqual(['沒填地址', '非高雄市地址', '查無門牌', '里有歧義', '已匿名化'])
    expect(doorplateVersionLabel('115-10')).toBe('115 年 10 月')
    expect(doorplateVersionLabel('115-09')).toBe('115 年 9 月')
    expect(doorplateVersionLabel('local')).toBe('local')
    expect(shortDay('2026-10-07T18:30:00Z')).toBe('10/08')
    expect(shortDay(null)).toBe('—')
    expect([0, 34, 420, 999, 1000, 1240, null].map(formatDistance)).toEqual(['0 m', '30 m', '420 m', '1000 m', '1.0 km', '1.2 km', '—'])
    expect(shortName('高雄市私立小樹幼兒園')).toBe('小樹幼兒園')
    expect(shortName('高雄市立大樹幼兒園')).toBe('大樹幼兒園')
    expect(shortName('高雄市三民區某某國小附設幼兒園')).toBe('三民區某某國小附設幼兒園')
    expect(shortName('臺南市私立某幼兒園')).toBe('臺南市私立某幼兒園')
  })

  it('訪視明細的比對結果：到里帶距離；只到區寫原因；未定位寫原因；沒有比對紀錄、沒填地址不列', () => {
    expect(visitGeoText(geo({ village: '本揚里', distance_m: 1200 }), '三民區')).toBe('三民區本揚里・距本校 1.2 km')
    expect(visitGeoText(geo({ village: '本揚里', match_level: 'street' }), '三民區')).toBe('三民區本揚里')
    expect(visitGeoText(geo({ match_level: 'district', unlocated_reason: 'ambiguous_village' }), '三民區')).toBe('三民區（里有歧義）')
    expect(visitGeoText(geo({ match_level: 'district' }), '三民區')).toBe('三民區（只到區）')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'no_doorplate' }), null)).toBe('未定位：查無門牌')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'outside_kaohsiung' }), null)).toBe('非高雄市地址')
    expect(visitGeoText(geo({ match_level: 'pending' }), null)).toBe('待比對')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'no_address' }), null)).toBe('')
    expect(visitGeoText(null, '三民區')).toBe('')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaFilter.test.ts src/__tests__/areaFormat.test.ts`
Expected: FAIL（模組或函式不存在）。

- [ ] **Step 3: 實作**

`admin/src/admissions/areaFilter.ts`：

```ts
// 區域分析「查看明細」帶到訪視明細的篩選（2026-10-08 規格 8.4、9.6）。網址 query `area`：
// 「三民區」＝整個行政區、「三民區/本揚里」＝某一里、「no_village」＝未定位到里（只到區、查無門牌、
// 非高雄市地址、待比對）。對到明細 API 的 district／village／geo 三個參數。
export type AreaFilter = { kind: 'place'; district: string; village: string | null } | { kind: 'no_village' }

const NO_VILLAGE = 'no_village'
// 高雄 38 區都叫「○○區」、里都叫「○○里」；其他寫法（手改的網址）當成沒篩。
const DISTRICT = /^\p{Script=Han}{1,6}區$/u
const VILLAGE = /^\p{Script=Han}{1,8}里$/u

export function parseAreaQuery(value: unknown): AreaFilter | null {
  if (typeof value !== 'string' || !value) return null
  if (value === NO_VILLAGE) return { kind: 'no_village' }
  const [district = '', village, ...rest] = value.split('/')
  if (rest.length || !DISTRICT.test(district)) return null
  if (village === undefined) return { kind: 'place', district, village: null }
  return VILLAGE.test(village) ? { kind: 'place', district, village } : null
}

export function areaQuery(filter: AreaFilter): string {
  if (filter.kind === 'no_village') return NO_VILLAGE
  return filter.village ? `${filter.district}/${filter.village}` : filter.district
}

/** 訪視明細上方的提示句（比照「只顯示這筆官網預約建立的招生訪視。」）。 */
export function areaNotice(filter: AreaFilter): string {
  return filter.kind === 'no_village'
    ? '只顯示未定位到里的訪視（只到區、查無門牌、非高雄市地址或待比對）。'
    : `只顯示${filter.district}${filter.village ?? ''}的訪視。`
}

export function areaApiParams(filter: AreaFilter | null): { district: string | null; village: string | null; geo: 'no_village' | null } {
  if (!filter) return { district: null, village: null, geo: null }
  if (filter.kind === 'no_village') return { district: null, village: null, geo: 'no_village' }
  return { district: filter.district, village: filter.village, geo: null }
}
```

`admin/src/components/admissions/area/areaFormat.ts`（整檔換成）：

```ts
import { NO_VALUE } from '../../../admissions/statsFormat'
import type { VisitGeo } from '../../../api/types'

// 區域分析的顯示格式與地圖用的小工具（2026-10-08 規格 9）。

/** 後端 /area/boundaries 的里界 GeoJSON（高雄 893 里，只留三個屬性）。 */
export interface VillageProperties {
  TOWNNAME: string
  VILLNAME: string
  VILLCODE: string
}
export interface VillageFeature {
  type: 'Feature'
  properties: VillageProperties
  geometry: { type: string; coordinates: unknown }
}
export interface VillageBoundaries {
  type: 'FeatureCollection'
  features: VillageFeature[]
}

export type RadiusKm = 1 | 3 | 6
export const RADIUS_OPTIONS: readonly RadiusKm[] = [1, 3, 6]

/** 里的鍵：後端 villages 列（district＋village）與里界屬性（TOWNNAME＋VILLNAME）用同一個。 */
export const villageKey = (district: string, village: string): string => `${district}/${village}`

/** 里界著色 5 級：0 筆是 0 級（不上色），其餘依該範圍參觀人數最多的那一里等分。 */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)))
}

/** 圖例：每一級涵蓋的人數（整數）；沒有整數落在裡面的級數不列。和 levelOf 同一個切法。 */
export function legendRanges(max: number): { level: number; label: string }[] {
  const ranges: { level: number; label: string }[] = []
  for (let level = 1; level <= 5; level++) {
    const low = Math.floor(((level - 1) * max) / 5) + 1
    const high = Math.floor((level * max) / 5)
    if (low > high) continue
    ranges.push({ level, label: low === high ? `${low}` : `${low}–${high}` })
  }
  return ranges
}

export const KIND_ORDER = ['public', 'nonprofit', 'quasi_public', 'private'] as const
export const KIND_LABELS: Record<string, string> = { public: '公立', nonprofit: '非營利', quasi_public: '準公共', private: '私立' }
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

export const BAND_LABELS: Record<string, string> = {
  '0-1': '1 公里內', '1-3': '1–3 公里', '3-6': '3–6 公里', '6+': '6 公里以上', none: '無距離',
}
export const bandLabel = (band: string): string => BAND_LABELS[band] ?? band

export const REASON_LABELS: Record<string, string> = {
  no_address: '沒填地址',
  outside_kaohsiung: '非高雄市地址',
  no_doorplate: '查無門牌',
  ambiguous_village: '里有歧義',
  anonymized: '已匿名化',
}
export const reasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason

/** 門牌資料版本「115-10」→「115 年 10 月」；其他寫法（手動匯入的版本名）照原文。 */
export function doorplateVersionLabel(version: string): string {
  const match = /^(\d{3})-(\d{2})$/.exec(version)
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : version
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' })
/** ISO 時間 → 台北日期「10/08」。 */
export function shortDay(value: string | null | undefined): string {
  if (!value) return NO_VALUE
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return NO_VALUE
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day}`
}

/** 距離：1 公里內寫公尺（取整到 10 公尺），以上寫一位小數的公里。 */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return NO_VALUE
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** 園所名稱去掉「高雄市私立／高雄市立／高雄市」前綴，清單一行放得下。 */
export function shortName(name: string): string {
  return name.replace(/^高雄市(?:私立|市立|立)?/, '') || name
}

const VILLAGE_LEVELS = new Set(['exact', 'nearby', 'street'])

/**
 * 訪視明細展開列「區域」那一行（規格 9.6）。沒有比對紀錄（geo 為 null 的舊資料）、
 * 沒填地址、已匿名化都回空字串：該行不列，不寫「待比對」以免讓人以為系統卡住。
 */
export function visitGeoText(geo: VisitGeo | null | undefined, district: string | null | undefined): string {
  if (!geo) return ''
  if (VILLAGE_LEVELS.has(geo.match_level) && geo.village) {
    const distance = geo.distance_m === null || geo.distance_m === undefined ? '' : `・距本校 ${formatDistance(geo.distance_m)}`
    return `${district ?? ''}${geo.village}${distance}`
  }
  if (geo.match_level === 'pending') return '待比對'
  if (geo.match_level === 'district') {
    if (!district) return ''
    if (geo.unlocated_reason === 'ambiguous_village') return `${district}（里有歧義）`
    if (geo.unlocated_reason === 'anonymized') return ''
    return `${district}（只到區）`
  }
  if (geo.unlocated_reason === 'no_address' || geo.unlocated_reason === 'anonymized') return ''
  if (geo.unlocated_reason === 'outside_kaohsiung') return '非高雄市地址'
  return '未定位：查無門牌'
}
```

`admin/src/style.css`：在 `--photo-caption-ink: oklch(0.98 0 0);` 那行之後、空行之前插入：

```css

  /* 招生區域分析的地圖（2026-10-08）：里界依參觀人數分 5 級，用操作色由淺到深，0 筆不上色；
     幼兒園四種類型與本機構只在地圖與圖例用，避開狀態色（綠＝已上線、暖黃＝草稿）。 */
  --area-level-1: color-mix(in oklch, var(--admin-accent), var(--surface) 82%);
  --area-level-2: color-mix(in oklch, var(--admin-accent), var(--surface) 62%);
  --area-level-3: color-mix(in oklch, var(--admin-accent), var(--surface) 40%);
  --area-level-4: var(--admin-accent);
  --area-level-5: var(--admin-accent-hover);
  --area-boundary: var(--line-strong);
  --area-radius: var(--ink-2);
  --area-kind-public: oklch(0.5 0.14 300);
  --area-kind-nonprofit: oklch(0.52 0.1 190);
  --area-kind-quasi-public: oklch(0.62 0.15 55);
  --area-kind-private: oklch(0.45 0.03 255);
  --area-kind-own: var(--brand-gold);
  --area-kind-own-ink: var(--brand-gold-ink);
```

`admin/src/__tests__/admissionsTestKit.ts`：

1. `visit()` 工廠的 `stage: 'visited', has_visit_request: false, anonymized_at: null, ...changes` 改成 `stage: 'visited', has_visit_request: false, anonymized_at: null, geo: null, ...changes`。
2. 檔尾加：

```ts

// ---- 區域分析（2026-10-08）----
// 數字彼此對得上：參觀 9＝有地址 7＋沒填 2；到里 5（本揚 3、寶業 1、龍子 1）；未定位到里 2（里有歧義 1、查無門牌 1）。
export const areaStats = (changes: Record<string, unknown> = {}) => ({
  as_of: '2026-10-08T02:00:00Z',
  filters: { campus_key: 'yihua', school_year: 115, semester: null },
  data_status: {
    doorplate_version: '115-10', doorplates_synced_at: '2026-10-06T18:00:00Z',
    kindergartens_synced_at: '2026-10-07T18:30:00Z', boundary_version: '115-08-17',
  },
  campus: { key: 'yihua', name: '義華', lat: 22.642456, lng: 120.343713, locate_error: null },
  totals: {
    visit: 9, with_address: 7, village_level: 5, district_level: 1, unlocated: 1, pending: 0,
    unlocated_reasons: [{ reason: 'no_address', count: 2 }, { reason: 'ambiguous_village', count: 1 }, { reason: 'no_doorplate', count: 1 }],
  },
  districts: [
    { district: '三民區', visit: 5, deposit: 2, visit_to_deposit_rate: 40 },
    { district: '鼓山區', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
  ],
  villages: [
    { district: '三民區', village: '本揚里', village_code: '64000050032', visit: 3, deposit: 1, visit_to_deposit_rate: 33.3 },
    { district: '三民區', village: '寶業里', village_code: '64000050020', visit: 1, deposit: 1, visit_to_deposit_rate: 100 },
    { district: '鼓山區', village: '龍子里', village_code: null, visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
  ],
  distance_bands: [
    { band: '0-1', visit: 4, deposit: 2, visit_to_deposit_rate: 50 },
    { band: '1-3', visit: 0, deposit: 0, visit_to_deposit_rate: null },
    { band: '3-6', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
    { band: '6+', visit: 0, deposit: 0, visit_to_deposit_rate: null },
    { band: 'none', visit: 4, deposit: 0, visit_to_deposit_rate: 0 },
  ],
  ...changes,
})

export const kindergarten = (changes: Record<string, unknown> = {}) => ({
  source_id: 'kg-private', name: '高雄市私立小樹幼兒園', kind: 'private', pre_public_period: null, address: '[807]義華路12號',
  lat: 22.6431, lng: 120.3441, distance_m: 420, approved_capacity: 120, monthly_fee_estimate: 9800, has_penalty: false,
  phone: '(07)3800000', is_own: false, ...changes,
})

export const areaKindergartens = (items: unknown[] = [
  kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, approved_capacity: 210, monthly_fee_estimate: 15000, is_own: true }),
  kindergarten({ source_id: 'kg-public', name: '高雄市立大樹幼兒園', kind: 'public', distance_m: 380, approved_capacity: 90, monthly_fee_estimate: 2500, phone: null }),
  kindergarten({ source_id: 'kg-quasi', name: '高雄市私立小草幼兒園', kind: 'quasi_public', pre_public_period: '114-116', distance_m: 950, has_penalty: true }),
  kindergarten({ source_id: 'kg-nonprofit', name: '高雄市三民區小芽非營利幼兒園', kind: 'nonprofit', distance_m: 1800, monthly_fee_estimate: null }),
], changes: Record<string, unknown> = {}) => ({
  synced_at: '2026-10-07T18:30:00Z',
  source_note: '資料來源：全國教保資訊網（kiang 整理），月費為估計值',
  campus: areaStats().campus,
  radius_km: 3,
  items,
  ...changes,
})

const villageFeature = (town: string, village: string, code: string) => ({
  type: 'Feature',
  properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code },
  geometry: { type: 'Polygon', coordinates: [[[120.34, 22.64], [120.35, 22.64], [120.35, 22.65], [120.34, 22.64]]] },
})
export const villageBoundaries = () => ({
  type: 'FeatureCollection',
  features: [
    villageFeature('三民區', '本揚里', '64000050032'),
    villageFeature('三民區', '寶業里', '64000050020'),
    villageFeature('三民區', '鼎金里', '64000050001'),
    villageFeature('鼓山區', '龍子里', '64000020010'),
  ],
})
```

- [ ] **Step 4: 跑測試確認通過＋守門測試**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaFilter.test.ts src/__tests__/areaFormat.test.ts src/__tests__/ux20261005.test.ts src/__tests__/admissionsRecords.test.ts; npm --prefix admin run typecheck`
Expected: 全 PASS（`ux20261005` 的字級守門、明細既有測試不受 `geo: null` 影響）；typecheck 0 錯。

- [ ] **Step 5: Commit**

```bash
git add admin/src/admissions/areaFilter.ts admin/src/components/admissions/area/areaFormat.ts admin/src/style.css admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/areaFilter.test.ts admin/src/__tests__/areaFormat.test.ts
git commit -m "feat(admin): 區域篩選、區域分析顯示格式與地圖色票"
```

---

### Task C3: 網址 `sub=area` 與 `area`，統計跳明細帶區域

**Files:**
- Modify: `admin/src/admissions/useAdmissionsFilters.ts`
- Modify: `admin/src/views/AdmissionsView.vue`
- Test: `admin/src/__tests__/admissionsView.test.ts`

**Interfaces:**
- Consumes: `parseAreaQuery`（C2）。
- Produces: `STATS_SUBS = ['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare']`；`useAdmissionsFilters()` 多回傳 `area: Ref<string>`（只放 `parseAreaQuery` 認得的值）；`AdmissionsView` 的 `openRecords(filter: { month?: string; area?: string })`；`RecordsTab` 收 `v-model:area`（C4 實作 prop）。

- [ ] **Step 1: 寫失敗的測試**（加在 `admissionsView.test.ts` 的 `describe('統計子分頁寫進網址（X2a 3A）'` 裡最後；檔頭 import 加 `import RecordsTab from '../components/admissions/RecordsTab.vue'`）

```ts
  it('(e) sub=area 讀得回來；區域分析「查看明細」push 到訪視明細帶 area、拿掉 month；上一頁回到區域分析', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=area&month=115.09' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('area')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { area: '三民區/本揚里' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', area: '三民區/本揚里' })
    expect(wrapper.findComponent(RecordsTab).props('area')).toBe('三民區/本揚里')
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'area', month: '115.09' })
  })

  it('(f) 統計「查看本月明細」帶 month 時拿掉 area；手改的 area 不帶進明細、網址改回乾淨的', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&area=%E4%B8%89%E6%B0%91%E5%8D%80' })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', month: '115.09' })
    cleanup()
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&area=hack' })
    expect(bad.wrapper.findComponent(RecordsTab).props('area')).toBe('')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsView.test.ts`
Expected: FAIL（`sub` 退回 overview、`area` prop 不存在）。

- [ ] **Step 3: 實作**

`admin/src/admissions/useAdmissionsFilters.ts`：

1. 檔頭 import 加 `import { parseAreaQuery } from './areaFilter'`。
2. `STATS_SUBS` 改成：

```ts
// 統計分析的子分頁（StatsTab 的 pane 名稱去掉 stats- 前綴）；overview 是預設，不寫進網址。
// 順序同園務：區域分析在接待之後、未預繳之前（2026-10-08 起官網也做）。
export const STATS_SUBS = ['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare'] as const
```

3. 文件註解在 `- month：…` 那行之後加一行：` * - area：訪視明細的區域（區域分析的「查看明細」帶過來，寫法見 areaFilter.ts）；手改成認不得的值就當沒篩。`
4. `const sub = ref<StatsSub>('overview')` 之後加 `const area = ref('')`。
5. `apply()` 在 `month.value = …` 之後加：

```ts
    const areaValue = text(query.area)
    area.value = parseAreaQuery(areaValue) ? areaValue : ''
```

6. `stateQuery()` 在 `if (month.value) query.month = month.value` 之後加 `if (area.value) query.area = area.value`。
7. `watch([campus, schoolYear, semester, tab, visitRequestId, month, sub], syncUrl, { immediate: true })` 改成 `watch([campus, schoolYear, semester, tab, visitRequestId, month, area, sub], syncUrl, { immediate: true })`。
8. return 改成：

```ts
  return {
    campus, schoolYear, semester, tab, visitRequestId, month, area, sub, visibleCampusKeys, defaultYear, clearTerm,
  }
```

`admin/src/views/AdmissionsView.vue`：

1. `import { useRoute, useRouter } from 'vue-router'` 改成 `import { useRoute, useRouter, type LocationQuery } from 'vue-router'`。
2. 解構加 `area`：

```ts
const {
  campus, schoolYear, semester, tab, visitRequestId, month, area, sub, visibleCampusKeys, defaultYear, clearTerm,
} = useAdmissionsFilters()
```

3. `openRecords` 換成：

```ts
// 統計的警示與行動入口「查看本月明細」、區域分析的「查看明細」：切到訪視明細並帶月份或區域。
// 兩者擇一：帶一個就拿掉另一個，免得疊成更窄的範圍。用 push 不用 replace：看完明細按上一頁回到統計。
function openRecords(filter: { month?: string; area?: string }) {
  const query: LocationQuery = { ...route.query, tab: 'records' }
  delete query.month
  delete query.area
  if (filter.month) query.month = filter.month
  if (filter.area) query.area = filter.area
  void router.push({ query })
}
```

4. `<RecordsTab` 加一行 `v-model:area="area"`（放在 `v-model:visitRequestId="visitRequestId"` 之後）。

- [ ] **Step 4: 跑測試確認通過**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsView.test.ts src/__tests__/statsTab.test.ts`
Expected: PASS。（C4 之前 `RecordsTab` 還沒有 `area` prop，(e)(f) 的 `props('area')` 會是 `undefined`：如果 C3 先單獨跑，這兩個斷言會紅——**C3 與 C4 一起實作、一起驗**，Step 4 改在 C4 Step 4 一併跑。）

- [ ] **Step 5: Commit**（與 C4 同一個 commit，見 C4 Step 5）

---

### Task C4: 訪視明細的區域篩選與比對結果

**Files:**
- Modify: `admin/src/components/admissions/RecordsTab.vue`
- Test: `admin/src/__tests__/admissionsRecords.test.ts`

**Interfaces:**
- Consumes: `parseAreaQuery`、`areaApiParams`、`areaNotice`（C2 `areaFilter.ts`）；`visitGeoText`（C2 `areaFormat.ts`）；`RecordFilters.district/village/geo`（C1）；`RecruitmentVisit.geo`（B）。
- Produces: `RecordsTab` prop `area?: string`、emit `update:area`。

做法說明：區域沒有對應的下拉選單，放進既有的「已套用篩選」chip 列（`hiddenFilters`）會在展開「更多篩選」時被收掉；所以比照 `vr` 用常駐的提示列（`el-alert`＋「顯示全部」），一定看得到、一定清得掉。

- [ ] **Step 1: 寫失敗的測試**（`admissionsRecords.test.ts` 檔尾）

```ts
describe('訪視明細：區域篩選與比對結果（2026-10-08 區域分析）', () => {
  it('area＝某一里：查詢帶 district、village（不帶 geo）；提示寫出範圍，「顯示全部」清掉', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ area: '三民區/本揚里' }) })
    expect(lastQuery(get).get('district')).toBe('三民區')
    expect(lastQuery(get).get('village')).toBe('本揚里')
    expect(lastQuery(get).has('geo')).toBe(false)
    expect(wrapper.text()).toContain('只顯示三民區本揚里的訪視。')
    await button(wrapper, '顯示全部')!.trigger('click')
    expect(wrapper.emitted('update:area')).toEqual([['']])
  })

  it('area＝no_village：查詢帶 geo=no_village；空結果算「目前篩選條件下」', async () => {
    const get = mockGet({ '/admin/admissions/records': [] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ area: 'no_village' }) })
    expect(lastQuery(get).get('geo')).toBe('no_village')
    expect(lastQuery(get).has('district')).toBe(false)
    expect(wrapper.text()).toContain('只顯示未定位到里的訪視')
    expect(wrapper.text()).toContain('目前篩選條件下沒有訪視紀錄。')
  })

  it('area 換了就重讀；「清除篩選」也清掉區域；手改的 area 不帶參數', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ area: '三民區' }) })
    await wrapper.setProps({ area: '鼓山區' })
    await flushPromises()
    expect(lastQuery(get).get('district')).toBe('鼓山區')
    await button(wrapper, '清除篩選')!.trigger('click')
    expect(wrapper.emitted('update:area')).toContainEqual([''])
    await wrapper.setProps({ area: 'hack' })
    await flushPromises()
    expect(lastQuery(get).has('district')).toBe(false)
    expect(wrapper.text()).not.toContain('只顯示')
  })

  it('展開列：地址下一行「區域」寫比對結果；沒有比對紀錄（geo 為 null）不列', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ address: '高雄市三民區義華路61號', district: '三民區', geo: { village: '寶業里', match_level: 'exact', unlocated_reason: null, distance_m: 1200 } }),
        visit({ id: 'v-2', child_name: '李小樂', address: '高雄市示範路 1 號', geo: null }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const [first, second] = wrapper.findAll('.records-table .el-table__expand-icon')
    await first!.trigger('click')
    await flushPromises()
    const info = wrapper.get('.records__info')
    expect(info.findAll('dt').map((dt) => dt.text())).toEqual(['地址', '區域'])
    expect(info.text()).toContain('三民區寶業里・距本校 1.2 km')
    await first!.trigger('click')
    await second!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.records__info').findAll('dt').map((dt) => dt.text())).toEqual(['地址'])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsRecords.test.ts`
Expected: FAIL（沒有 district 參數、沒有提示列、沒有「區域」項）。

- [ ] **Step 3: 實作** `RecordsTab.vue`

1. import 加：

```ts
import { areaApiParams, areaNotice, parseAreaQuery } from '../../admissions/areaFilter'
import { visitGeoText } from './area/areaFormat'
```

2. 檔頭註解第二行改成：`// 這裡不重複（本檔調整第 11 條）；月份、vr、區域（area，2026-10-08）由頁面寫進網址（第 15、16 條），其餘篩選只在分頁內。`
3. props／emit 換成：

```ts
const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: Semester | null
  month: string
  visitRequestId: string
  /** 區域分析「查看明細」帶來的區域（網址 area）；認不得的寫法當沒篩。 */
  area?: string
}>()
const emit = defineEmits<{
  'update:month': [value: string]
  'update:visitRequestId': [value: string]
  'update:area': [value: string]
  'clear-term': []
}>()
```

4. `const requests = useRequestSequence()` 之後加：

```ts
const areaFilter = computed(() => parseAreaQuery(props.area))
```

5. `filtered` 的 `Boolean(` 內第一行改成 `props.month || props.visitRequestId || areaFilter.value || grade.value || source.value || referrer.value || hasDeposit.value || noDepositReason.value`。
6. `currentFilters()` 的 `owner: owner.value || null,` 之後加 `...areaApiParams(areaFilter.value),`。
7. `filterKey` 的第一行改成 `props.campusKey, props.schoolYear, props.semester, props.month, props.visitRequestId, props.area,`。
8. `clearFilters()` 的 `emit('update:visitRequestId', '')` 之後加 `emit('update:area', '')`。
9. `extraInfo()` 的 `{ label: '地址', value: row.address || row.district || '' },` 之後加：

```ts
    // 門牌比對結果（2026-10-08 區域分析）：geo 為 null（沒有比對紀錄的舊資料）、沒填地址時空字串、不列。
    { label: '區域', value: visitGeoText(row.geo, row.district) },
```

10. template：在 `vr` 的 `<el-alert v-if="visitRequestId" …>…</el-alert>` 之後加：

```html
    <el-alert v-if="areaFilter" type="info" :closable="false" show-icon class="records__notice" :title="areaNotice(areaFilter)">
      <el-button size="small" @click="emit('update:area', '')">顯示全部</el-button>
    </el-alert>
```

- [ ] **Step 4: 跑測試確認通過（含 C3）**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/admissionsRecords.test.ts src/__tests__/admissionsView.test.ts src/__tests__/familyAdmissionsData.test.ts src/__tests__/admissionsApi.test.ts; npm --prefix admin run typecheck`
Expected: 全 PASS；typecheck 0 錯。

- [ ] **Step 5: Commit**

```bash
git add admin/src/admissions/useAdmissionsFilters.ts admin/src/views/AdmissionsView.vue admin/src/components/admissions/RecordsTab.vue admin/src/__tests__/admissionsView.test.ts admin/src/__tests__/admissionsRecords.test.ts
git commit -m "feat(admin): 訪視明細依區域篩選、展開列顯示門牌比對結果"
```

---

### Task C5: 統計表的「查看明細」按鈕欄

**Files:**
- Modify: `admin/src/components/admissions/StatsDimensionTable.vue`
- Test: `admin/src/__tests__/statsDimensionCsv.test.ts`

**Interfaces:**
- Produces: `StatsDimensionTable` 新 prop `actionLabel?: string`（預設 `''`＝沒有按鈕欄）、emit `action: [row: Record<string, unknown>]`；按鈕 `aria-label` 為「`{actionLabel}：{第一個 sticky 欄的顯示值}`」。匯出 CSV 不含按鈕欄。

做法說明：`StatsDimensionTable` 沒有點列事件。不做「整列可點」（表格列不是按鈕，鍵盤與讀屏都不好用），改成有 `actionLabel` 時最後多一欄按鈕。

- [ ] **Step 1: 寫失敗的測試**（`statsDimensionCsv.test.ts` 檔尾）

```ts
describe('StatsDimensionTable「查看明細」欄（2026-10-08 區域分析）', () => {
  it('給了 actionLabel 才多一欄按鈕；按下回報該列；aria-label 帶第一欄的名稱', async () => {
    const wrapper = mount(StatsDimensionTable, { props: { ...base, actionLabel: '查看明細' }, global: { plugins: [ElementPlus] } })
    const buttons = wrapper.findAll('tbody button')
    expect(buttons.map((item) => item.text())).toEqual(['查看明細', '查看明細'])
    expect(buttons[1]!.attributes('aria-label')).toBe('查看明細：網路')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([[base.rows[1]]])
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['來源', '參觀', '預繳率', '操作'])
    wrapper.unmount()
  })

  it('沒給 actionLabel：表頭與原本相同、沒有按鈕', () => {
    const wrapper = mount(StatsDimensionTable, { props: base, global: { plugins: [ElementPlus] } })
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['來源', '參觀', '預繳率'])
    expect(wrapper.findAll('tbody button')).toHaveLength(0)
    wrapper.unmount()
  })

  it('匯出 CSV 不含按鈕欄', async () => {
    const wrapper = mount(StatsDimensionTable, {
      props: { ...base, actionLabel: '查看明細', exportFilename: '招生統計-行政區排行.csv' },
      global: { plugins: [ElementPlus] },
    })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')[0]).toBe('來源,參觀,預繳率')
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/statsDimensionCsv.test.ts`
Expected: FAIL（沒有按鈕）。

- [ ] **Step 3: 實作** `StatsDimensionTable.vue`

1. 檔頭註解最後一行之後加一行：`// 有 actionLabel 時最後多一欄按鈕（區域分析的「查看明細」，2026-10-08）；不做整列可點（列不是按鈕，鍵盤與讀屏不好用）。按鈕欄不匯出。`
2. props 型別加（放在 `csvCell?` 之前）：

```ts
    /** 有值時每列最後多一顆這個字的按鈕，按下 emit('action', row)。 */
    actionLabel?: string
```

並把 defaults 改成 `{ numbered: false, caption: '', exportFilename: '', actionLabel: '' }`。
3. `const headingId = useId()` 之前加：

```ts
const emit = defineEmits<{ action: [row: Record<string, unknown>] }>()
```

4. `const isNumeric = …` 之後加：

```ts
// 按鈕的 aria-label 帶這一列的名稱（第一個 sticky 欄，沒有就第一欄），讀屏才分得出是哪一列的「查看明細」。
const nameColumn = computed(() => props.columns.find((column) => column.sticky) ?? props.columns[0])
const actionAria = (row: Record<string, unknown>) =>
  nameColumn.value ? `${props.actionLabel}：${display(row, nameColumn.value)}` : props.actionLabel
```

5. thead：在 `<th v-for="column in columns" …>…</th>` 之後加：

```html
            <th v-if="actionLabel" scope="col" class="stats-table__action"><span class="visually-hidden">操作</span></th>
```

6. tbody：在 `</template>`（`v-for="column in columns"` 那個）之後、`</tr>` 之前加：

```html
            <td v-if="actionLabel" class="stats-table__action">
              <el-button size="small" text type="primary" :aria-label="actionAria(row)" @click="emit('action', row)">{{ actionLabel }}</el-button>
            </td>
```

7. style 在 `.stats-table .stats-table__index { … }` 之後加：

```css
.stats-table .stats-table__action {
  width: 1%;
  text-align: right;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/statsDimensionCsv.test.ts src/__tests__/statsTab.test.ts src/__tests__/compareTable.test.ts`
Expected: PASS（既有表格不受影響）。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/admissions/StatsDimensionTable.vue admin/src/__tests__/statsDimensionCsv.test.ts
git commit -m "feat(admin): 統計表可選的「查看明細」按鈕欄"
```

---

### Task C6: 地圖元件 AreaMap

**Files:**
- Create: `admin/src/components/admissions/area/AreaMap.vue`
- Test: `admin/src/__tests__/areaMap.test.ts`

**Interfaces:**
- Consumes: `levelOf`、`legendRanges`、`villageKey`、`KIND_LABELS`、`KIND_ORDER`、`kindLabel`、`formatDistance`、`shortName`、`RadiusKm`、`VillageBoundaries`、`VillageProperties`（C2）；`formatRate`（`admissions/statsFormat.ts`）；型別 `AdmissionsArea`、`AreaKindergarten`、`AreaVillageRow`（C1）。
- Produces: 預設匯出元件，props `{ boundaries: VillageBoundaries; villages: readonly AreaVillageRow[]; campus: AdmissionsArea['campus']; campusName: string; kindergartens: readonly AreaKindergarten[]; radiusKm: RadiusKm; narrow: boolean }`，emit `'open-area': [filter: { district: string; village: string }]`，`defineExpose({ focusKindergarten(id: string): void })`。Leaflet 物件掛的 class：`area-village area-village--l{0-5}`、`area-radius`、`area-kg area-kg--{public|nonprofit|quasi_public|private|own}`、divIcon `area-campus`。

做法說明：Leaflet 的 `fillColor` 寫不了 CSS 變數（SVG presentation attribute 不吃 `var()`），所以每個圖形只掛 class，填色由元件的 `:deep` 規則用 token 決定；分級變了就整層重畫（class 只在建立時套用）。這支元件由 `AreaTab` 以 `defineAsyncComponent` 載入，裡面 static import 的 Leaflet 跟著切成獨立 chunk，不需要 `manualChunks`（C12 驗）。

- [ ] **Step 1: 寫失敗的測試** `admin/src/__tests__/areaMap.test.ts`

```ts
// 區域分析地圖（2026-10-08 規格 9.3）：Leaflet 整個 mock 掉，驗呼叫與參數。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { areaKindergartens, areaStats, button, villageBoundaries } from './admissionsTestKit'

// any 只出現在 Leaflet 的 mock 物件上。
const leaflet = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void
  const created: Record<string, any[]> = {}
  function layer(kind: string, extra: Record<string, unknown> = {}): any {
    const handlers: Record<string, Handler[]> = {}
    const self: any = {
      kind,
      fire: (event: string, payload?: unknown) => (handlers[event] ?? []).forEach((fn) => fn(payload)),
      on: vi.fn((event: string, fn: Handler) => { (handlers[event] ??= []).push(fn); return self }),
      addTo: vi.fn(() => self),
      remove: vi.fn(() => self),
      bindPopup: vi.fn(() => self),
      bindTooltip: vi.fn(() => self),
      openPopup: vi.fn(() => self),
      setRadius: vi.fn(() => self),
      redraw: vi.fn(() => self),
      bringToBack: vi.fn(() => self),
      addLayer: vi.fn(() => self),
      removeLayer: vi.fn(() => self),
      clearLayers: vi.fn(() => self),
      getBounds: vi.fn(() => ({ bounds: kind })),
      getLatLng: vi.fn(() => ({ lat: 22.6, lng: 120.3 })),
      ...extra,
    }
    ;(created[kind] ??= []).push(self)
    return self
  }
  const handler = () => ({ enable: vi.fn(), disable: vi.fn() })
  const module = {
    map: vi.fn((element: HTMLElement, options: Record<string, unknown>) => layer('map', {
      element, options, fitBounds: vi.fn(), setView: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(),
      dragging: handler(), touchZoom: handler(), attributionControl: { setPrefix: vi.fn() },
    })),
    tileLayer: vi.fn((url: string, options: Record<string, unknown>) => layer('tileLayer', { url, options })),
    geoJSON: vi.fn((data: unknown, options: Record<string, any>) => layer('geoJSON', { data, options })),
    marker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('marker', { latlng, options })),
    circle: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circle', { latlng, options })),
    circleMarker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circleMarker', { latlng, options })),
    layerGroup: vi.fn(() => layer('layerGroup')),
    divIcon: vi.fn((options: Record<string, unknown>) => ({ divIcon: options })),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng, toBounds: (meters: number) => ({ center: [lat, lng], meters }) })),
  }
  return { created, module, reset: () => { for (const key of Object.keys(created)) delete created[key] } }
})
vi.mock('leaflet', () => leaflet.module)
vi.mock('leaflet/dist/leaflet.css', () => ({}))
import AreaMap from '../components/admissions/area/AreaMap.vue'

const wrappers: VueWrapper[] = []
beforeEach(() => leaflet.reset())
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.clearAllMocks()
})

const baseProps = () => ({
  boundaries: villageBoundaries(),
  villages: areaStats().villages,
  campus: areaStats().campus,
  campusName: '義華',
  kindergartens: areaKindergartens().items,
  radiusKm: 3,
  narrow: false,
})
async function mountMap(changes: Record<string, unknown> = {}): Promise<VueWrapper> {
  const wrapper = mount(AreaMap, { props: { ...baseProps(), ...changes } as never, attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const one = (kind: string): any => leaflet.created[kind]![0]
const feature = (town: string, village: string) => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: '' } })

describe('區域分析地圖（2026-10-08）', () => {
  it('底圖是國土測繪電子地圖並標出處；滾輪不縮放；里界依參觀人數分 5 級（0 筆是 0 級）', async () => {
    await mountMap()
    expect(one('map').options).toMatchObject({ scrollWheelZoom: false, dragging: true, touchZoom: true })
    expect(one('tileLayer').url).toBe('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}')
    expect(one('tileLayer').options.attribution).toBe('© 國土測繪中心')
    const { data, options } = one('geoJSON')
    expect(data).toEqual(villageBoundaries())
    const className = (town: string, village: string) => options.style(feature(town, village)).className
    expect(className('三民區', '本揚里')).toBe('area-village area-village--l5')
    expect(className('三民區', '寶業里')).toBe('area-village area-village--l2')
    expect(className('三民區', '鼎金里')).toBe('area-village area-village--l0')
    expect(one('geoJSON').bringToBack).toHaveBeenCalled()
  })

  it('圖例：每一級的人數，和分級一致', async () => {
    const wrapper = await mountMap()
    expect(wrapper.findAll('.area-legend--levels li').map((item) => item.text())).toEqual(['1 人', '2 人', '3 人'])
    expect(wrapper.findAll('.area-legend--levels .area-swatch').map((item) => item.classes().at(-1))).toEqual(['area-swatch--l2', 'area-swatch--l4', 'area-swatch--l5'])
  })

  it('初始視野：本校為中心 12 公里見方；本校沒定位時看整個里界、不畫星號與半徑', async () => {
    await mountMap()
    expect(one('map').fitBounds).toHaveBeenCalledWith({ center: [22.642456, 120.343713], meters: 12000 })
    leaflet.reset()
    await mountMap({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error: 'no_doorplate' } })
    expect(one('map').fitBounds).toHaveBeenCalledWith({ bounds: 'geoJSON' })
    expect(leaflet.created.marker).toBeUndefined()
    expect(leaflet.created.circle).toBeUndefined()
  })

  it('本校用星號（divIcon，不載預設圖示檔）；半徑虛線圓跟著清單的半徑', async () => {
    const wrapper = await mountMap()
    expect(one('marker').options).toMatchObject({ title: '義華', alt: '義華', keyboard: false })
    expect(leaflet.module.divIcon).toHaveBeenCalledWith(expect.objectContaining({ className: 'area-campus', iconSize: [28, 28] }))
    expect(one('circle').options).toMatchObject({ radius: 3000, className: 'area-radius', fill: false, interactive: false })
    await wrapper.setProps({ radiusKm: 6 })
    expect(one('circle').setRadius).toHaveBeenCalledWith(6000)
  })

  it('幼兒園依類型上色、本機構另一色；開關收起整組，類型圖例跟著收', async () => {
    const wrapper = await mountMap()
    expect(leaflet.created.circleMarker!.map((marker) => marker.options.className)).toEqual([
      'area-kg area-kg--own', 'area-kg area-kg--public', 'area-kg area-kg--quasi_public', 'area-kg area-kg--nonprofit',
    ])
    const group = one('layerGroup')
    expect(group.addLayer).toHaveBeenCalledTimes(4)
    expect(wrapper.text()).toContain('非營利')
    wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(one('map').removeLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).not.toContain('非營利')
    expect(wrapper.find('[aria-label="在地圖上顯示幼兒園"]').exists()).toBe(true)
  })

  it('換了幼兒園清單（半徑變了）整組重畫', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ kindergartens: areaKindergartens().items.slice(0, 2) })
    expect(one('layerGroup').clearLayers).toHaveBeenCalled()
    expect(leaflet.created.circleMarker).toHaveLength(6)
  })

  it('點里：彈出框寫參觀、預繳與預繳率，「查看明細」回報該里；沒有參觀的里不給連結；桌機 hover 顯示里名', async () => {
    const wrapper = await mountMap()
    const { options } = one('geoJSON')
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    options.onEachFeature(feature('三民區', '本揚里'), village)
    const content = village.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(content.textContent).toContain('三民區本揚里')
    expect(content.textContent).toContain('參觀 3・預繳 1（33.3%）')
    content.querySelector('button')!.click()
    expect(wrapper.emitted('open-area')).toEqual([[{ district: '三民區', village: '本揚里' }]])
    expect(village.bindTooltip).toHaveBeenCalledWith('三民區本揚里', expect.objectContaining({ sticky: true }))
    const empty = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    options.onEachFeature(feature('三民區', '鼎金里'), empty)
    const emptyContent = empty.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(emptyContent.textContent).toContain('這個範圍沒有參觀')
    expect(emptyContent.querySelector('button')).toBeNull()
  })

  it('里的參觀人數變了：整層重畫（class 只在建立時套用）', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ villages: [] })
    expect(one('geoJSON').remove).toHaveBeenCalled()
    expect(leaflet.created.geoJSON).toHaveLength(2)
  })

  it('focusKindergarten：地圖移到該園並打開資訊；圖層收起時先打開', async () => {
    const wrapper = await mountMap()
    wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    ;(wrapper.vm as unknown as { focusKindergarten: (id: string) => void }).focusKindergarten('kg-public')
    const marker = leaflet.created.circleMarker![1]
    expect(one('map').addLayer).toHaveBeenCalledWith(one('layerGroup'))
    expect(one('map').setView).toHaveBeenCalledWith({ lat: 22.6, lng: 120.3 }, 15)
    expect(marker.openPopup).toHaveBeenCalled()
  })

  it('手機：預設不攔單指捲動（不能拖曳縮放、不綁 hover 里名），「移動地圖」才打開，「完成」收回', async () => {
    const wrapper = await mountMap({ narrow: true })
    expect(one('map').options).toMatchObject({ dragging: false, touchZoom: false })
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    one('geoJSON').options.onEachFeature(feature('三民區', '本揚里'), village)
    expect(village.bindTooltip).not.toHaveBeenCalled()
    await button(wrapper, '移動地圖')!.trigger('click')
    expect(one('map').dragging.enable).toHaveBeenCalled()
    expect(one('map').touchZoom.enable).toHaveBeenCalled()
    await button(wrapper, '完成')!.trigger('click')
    expect(one('map').dragging.disable).toHaveBeenCalled()
    expect(one('map').touchZoom.disable).toHaveBeenCalled()
  })

  it('桌機沒有「移動地圖」鈕', async () => {
    const wrapper = await mountMap()
    expect(button(wrapper, '移動地圖')).toBeUndefined()
  })

  it('圖磚連續失敗且一張都沒載到：顯示「底圖載入失敗」與重試，重試重畫圖磚', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    for (let index = 0; index < 4; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).toContain('底圖載入失敗。')
    await button(wrapper, '重試')!.trigger('click')
    expect(tiles.redraw).toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('底圖載入失敗。')
  })

  it('載到過圖磚：偶發失敗不跳錯誤', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    tiles.fire('tileload')
    for (let index = 0; index < 6; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).not.toContain('底圖載入失敗。')
  })

  it('卸載時移除地圖', async () => {
    const wrapper = await mountMap()
    const map = one('map')
    wrapper.unmount()
    wrappers.length = 0
    expect(map.remove).toHaveBeenCalled()
  })
})
```

（Element Plus 的 `el-switch` 把 `aria-label` 放在內層 input，所以用屬性選擇器找，不讀元件 attributes。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaMap.test.ts`
Expected: FAIL（找不到 `AreaMap.vue`）。

- [ ] **Step 3: 實作** `admin/src/components/admissions/area/AreaMap.vue`

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { AdmissionsArea, AreaKindergarten, AreaVillageRow } from '../../../api/types'
import { formatRate } from '../../../admissions/statsFormat'
import {
  KIND_LABELS, KIND_ORDER, formatDistance, kindLabel, legendRanges, levelOf, shortName, villageKey,
  type RadiusKm, type VillageBoundaries, type VillageProperties,
} from './areaFormat'

// 區域分析的地圖（2026-10-08 規格 9.3）：國土測繪電子地圖當底圖，里界依參觀人數分 5 級著色，
// 標出本校、半徑虛線圓與附近幼兒園。Leaflet 的 fillColor 寫不了 CSS 變數，所以圖形只掛 class，
// 顏色由下面的 :deep 規則用 --area-* token 決定；分級變了整層重畫（class 只在建立時套用）。
// 圖磚請求只帶視野範圍，不帶家長資料；家長來源只以「里」為單位聚合。
const props = defineProps<{
  boundaries: VillageBoundaries
  villages: readonly AreaVillageRow[]
  campus: AdmissionsArea['campus']
  campusName: string
  kindergartens: readonly AreaKindergarten[]
  radiusKm: RadiusKm
  narrow: boolean
}>()
const emit = defineEmits<{ 'open-area': [filter: { district: string; village: string }] }>()

const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© 國土測繪中心'
// 初始視野：本校為中心、半徑 6 公里（12 公里見方）。
const INITIAL_SPAN_M = 12_000
// 一張都沒載到、又連續失敗這麼多張，才當成底圖壞了（偶發失敗 Leaflet 自己會再試）。
const TILE_FAILURE_LIMIT = 4
const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>'

type GeoJsonInput = Parameters<typeof L.geoJSON>[0]

const container = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
let tiles: L.TileLayer | null = null
let villageLayer: L.GeoJSON | null = null
let campusMarker: L.Marker | null = null
let radiusCircle: L.Circle | null = null
let kindergartenGroup: L.LayerGroup | null = null
const kindergartenMarkers = new Map<string, L.CircleMarker>()
let resizeObserver: ResizeObserver | null = null

const showKindergartens = ref(true)
// 手機上地圖能不能拖曳縮放；桌機一直可以。
const interactive = ref(!props.narrow)
const tilesFailed = ref(false)
let tileErrors = 0
let tilesLoaded = 0

const villageStats = computed(() => ({
  max: Math.max(0, ...props.villages.map((row) => row.visit)),
  byKey: new Map(props.villages.map((row) => [villageKey(row.district, row.village), row])),
}))
const legend = computed(() => legendRanges(villageStats.value.max))
const kindLegend = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABELS[kind] }))

function villageRow(properties: VillageProperties): AreaVillageRow | undefined {
  return villageStats.value.byKey.get(villageKey(properties.TOWNNAME, properties.VILLNAME))
}

// 彈出框用 DOM 組，不用 HTML 字串（名稱一律走 textContent）。
function villagePopup(properties: VillageProperties): HTMLElement {
  const row = villageRow(properties)
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = `${properties.TOWNNAME}${properties.VILLNAME}`
  const line = document.createElement('p')
  line.textContent = row ? `參觀 ${row.visit}・預繳 ${row.deposit}（${formatRate(row.visit_to_deposit_rate)}）` : '這個範圍沒有參觀'
  root.append(title, line)
  if (row && row.visit > 0) {
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'area-popup__link'
    link.textContent = '查看明細'
    link.addEventListener('click', () => emit('open-area', { district: properties.TOWNNAME, village: properties.VILLNAME }))
    root.append(link)
  }
  return root
}

function kindergartenPopup(item: AreaKindergarten): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = shortName(item.name)
  const line = document.createElement('p')
  const capacity = item.approved_capacity === null ? '' : `・核定 ${item.approved_capacity} 人`
  line.textContent = `${item.is_own ? '本機構' : kindLabel(item.kind)}・${formatDistance(item.distance_m)}${capacity}`
  root.append(title, line)
  return root
}

function drawVillages() {
  const current = map.value
  if (!current) return
  villageLayer?.remove()
  const { max } = villageStats.value
  villageLayer = L.geoJSON(props.boundaries as unknown as GeoJsonInput, {
    style: (feature) => {
      const row = feature ? villageRow(feature.properties as VillageProperties) : undefined
      return { className: `area-village area-village--l${levelOf(row?.visit ?? 0, max)}`, weight: 1 }
    },
    onEachFeature: (feature, layer) => {
      const properties = feature.properties as VillageProperties
      layer.bindPopup(() => villagePopup(properties))
      if (!props.narrow) layer.bindTooltip(`${properties.TOWNNAME}${properties.VILLNAME}`, { sticky: true, direction: 'top' })
    },
  }).addTo(current)
  // 里界壓在最底下：半徑圓與幼兒園點畫在同一個 SVG 裡，要在上面。
  villageLayer.bringToBack()
}

function drawCampus() {
  const current = map.value
  if (!current) return
  campusMarker?.remove()
  radiusCircle?.remove()
  campusMarker = null
  radiusCircle = null
  const { lat, lng } = props.campus
  if (lat === null || lng === null) return
  campusMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'area-campus', html: STAR_SVG, iconSize: [28, 28], iconAnchor: [14, 14] }),
    title: props.campusName,
    alt: props.campusName,
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(current)
  radiusCircle = L.circle([lat, lng], {
    radius: props.radiusKm * 1000, className: 'area-radius', fill: false, interactive: false, dashArray: '6 6', weight: 2,
  }).addTo(current)
}

function fitInitialView() {
  const current = map.value
  if (!current) return
  const { lat, lng } = props.campus
  if (lat !== null && lng !== null) current.fitBounds(L.latLng(lat, lng).toBounds(INITIAL_SPAN_M))
  else if (villageLayer) current.fitBounds(villageLayer.getBounds())
}

function drawKindergartens() {
  const group = kindergartenGroup
  if (!group) return
  group.clearLayers()
  kindergartenMarkers.clear()
  for (const item of props.kindergartens) {
    const kind = item.is_own ? 'own' : item.kind
    const marker = L.circleMarker([item.lat, item.lng], { radius: item.is_own ? 8 : 6, className: `area-kg area-kg--${kind}`, weight: 1.5 })
    marker.bindPopup(() => kindergartenPopup(item))
    group.addLayer(marker)
    kindergartenMarkers.set(item.source_id, marker)
  }
}

function setShowKindergartens(value: boolean) {
  showKindergartens.value = value
  const current = map.value
  if (!current || !kindergartenGroup) return
  if (value) current.addLayer(kindergartenGroup)
  else current.removeLayer(kindergartenGroup)
}

/** 清單點一列：地圖移到該園並打開資訊。 */
function focusKindergarten(id: string) {
  const current = map.value
  const marker = kindergartenMarkers.get(id)
  if (!current || !marker) return
  if (!showKindergartens.value) setShowKindergartens(true)
  current.setView(marker.getLatLng(), Math.max(current.getZoom(), 15))
  marker.openPopup()
}
defineExpose({ focusKindergarten })

function setInteractive(value: boolean) {
  interactive.value = value
  const current = map.value
  if (!current) return
  for (const handler of [current.dragging, current.touchZoom]) {
    if (value) handler.enable()
    else handler.disable()
  }
}

function retryTiles() {
  tileErrors = 0
  tilesLoaded = 0
  tilesFailed.value = false
  tiles?.redraw()
}

onMounted(() => {
  if (!container.value) return
  const current = L.map(container.value, {
    zoomControl: true,
    scrollWheelZoom: false,
    dragging: !props.narrow,
    touchZoom: !props.narrow,
    minZoom: 8,
    maxZoom: 18,
  })
  current.attributionControl.setPrefix(false)
  map.value = current
  tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 })
  tiles.on('tileload', () => { tilesLoaded++ })
  tiles.on('tileerror', () => {
    tileErrors++
    if (tilesLoaded === 0 && tileErrors >= TILE_FAILURE_LIMIT) tilesFailed.value = true
  })
  tiles.addTo(current)
  kindergartenGroup = L.layerGroup().addTo(current)
  drawVillages()
  drawCampus()
  drawKindergartens()
  fitInitialView()
  // 子分頁切走再切回來時容器尺寸會變，Leaflet 要重算。
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => current.invalidateSize())
    resizeObserver.observe(container.value)
  }
})

watch(() => [props.boundaries, props.villages], drawVillages)
watch(() => [props.campus.lat, props.campus.lng], () => {
  drawCampus()
  fitInitialView()
})
watch(() => props.radiusKm, (km) => radiusCircle?.setRadius(km * 1000))
watch(() => props.kindergartens, drawKindergartens)
watch(() => props.narrow, (narrow) => setInteractive(!narrow))

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  map.value?.remove()
  map.value = null
})
</script>

<template>
  <section class="area-map" aria-label="區域地圖">
    <div class="area-map__frame">
      <div ref="container" class="area-map__canvas" />
      <div v-if="tilesFailed" class="area-map__notice" role="alert">
        <span>底圖載入失敗。</span>
        <el-button size="small" @click="retryTiles">重試</el-button>
      </div>
      <el-button v-if="narrow" class="area-map__move" size="small" :type="interactive ? 'primary' : 'default'" @click="setInteractive(!interactive)">
        {{ interactive ? '完成' : '移動地圖' }}
      </el-button>
    </div>
    <div class="area-map__legend">
      <ul v-if="legend.length" class="area-legend area-legend--levels" aria-label="參觀人數圖例">
        <li v-for="item in legend" :key="item.level">
          <span class="area-swatch" :class="`area-swatch--l${item.level}`" aria-hidden="true" />{{ item.label }} 人
        </li>
      </ul>
      <p v-else class="area-map__none">這個範圍還沒有定位到里的參觀。</p>
      <div class="area-legend area-legend--kinds">
        <el-switch
          :model-value="showKindergartens"
          aria-label="在地圖上顯示幼兒園"
          active-text="幼兒園"
          @update:model-value="setShowKindergartens(Boolean($event))"
        />
        <ul v-if="showKindergartens" class="area-legend" aria-label="幼兒園類型圖例">
          <li v-for="item in kindLegend" :key="item.kind"><span class="area-dot" :class="`area-dot--${item.kind}`" aria-hidden="true" />{{ item.label }}</li>
          <li><span class="area-dot area-dot--own" aria-hidden="true" />本機構</li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.area-map {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.area-map__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.area-map__canvas {
  height: 520px;
  background: var(--surface-2);
}

.area-map__notice {
  position: absolute;
  inset: 12px 12px auto;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
}

.area-map__move {
  position: absolute;
  right: 10px;
  bottom: 28px;
  z-index: 500;
}

.area-map__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.area-map__none {
  margin: 0;
}

.area-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.area-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.area-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid var(--area-boundary);
  border-radius: 3px;
}

.area-swatch--l1 { background: var(--area-level-1); }
.area-swatch--l2 { background: var(--area-level-2); }
.area-swatch--l3 { background: var(--area-level-3); }
.area-swatch--l4 { background: var(--area-level-4); }
.area-swatch--l5 { background: var(--area-level-5); }

.area-dot {
  width: 10px;
  height: 10px;
  border: 1px solid var(--surface);
  border-radius: 50%;
}

.area-dot--public { background: var(--area-kind-public); }
.area-dot--nonprofit { background: var(--area-kind-nonprofit); }
.area-dot--quasi_public { background: var(--area-kind-quasi-public); }
.area-dot--private { background: var(--area-kind-private); }
.area-dot--own { background: var(--area-kind-own); border-color: var(--area-kind-own-ink); }

/* Leaflet 畫的 SVG：CSS 屬性蓋過 Leaflet 寫的 presentation attribute。
   0 級填透明但仍有 fill（visiblePainted），點得到、看得到 hover 里名。 */
.area-map :deep(.area-village) {
  fill: var(--surface);
  fill-opacity: 0;
  stroke: var(--area-boundary);
  stroke-opacity: 0.8;
  stroke-width: 0.6;
}

.area-map :deep(.area-village--l1) { fill: var(--area-level-1); fill-opacity: 0.6; }
.area-map :deep(.area-village--l2) { fill: var(--area-level-2); fill-opacity: 0.6; }
.area-map :deep(.area-village--l3) { fill: var(--area-level-3); fill-opacity: 0.6; }
.area-map :deep(.area-village--l4) { fill: var(--area-level-4); fill-opacity: 0.6; }
.area-map :deep(.area-village--l5) { fill: var(--area-level-5); fill-opacity: 0.6; }

.area-map :deep(.area-radius) {
  stroke: var(--area-radius);
  stroke-width: 2;
}

.area-map :deep(.area-kg) {
  fill-opacity: 1;
  stroke: var(--surface);
}

.area-map :deep(.area-kg--public) { fill: var(--area-kind-public); }
.area-map :deep(.area-kg--nonprofit) { fill: var(--area-kind-nonprofit); }
.area-map :deep(.area-kg--quasi_public) { fill: var(--area-kind-quasi-public); }
.area-map :deep(.area-kg--private) { fill: var(--area-kind-private); }
.area-map :deep(.area-kg--own) { fill: var(--area-kind-own); stroke: var(--area-kind-own-ink); }

.area-map :deep(.area-campus svg path) {
  fill: var(--area-kind-own);
  stroke: var(--area-kind-own-ink);
  stroke-width: 1.5;
}

.area-map :deep(.area-popup) {
  display: grid;
  gap: 4px;
  color: var(--ink);
  font-size: var(--text-sm);
}

.area-map :deep(.area-popup p) {
  margin: 0;
  color: var(--ink-2);
}

.area-map :deep(.area-popup__link) {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 720px) {
  .area-map__canvas {
    height: 50vh;
    min-height: 280px;
  }
}
</style>
```

- [ ] **Step 4: 跑測試確認通過＋守門**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaMap.test.ts src/__tests__/ux20261005.test.ts src/__tests__/a11yStructure.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯（`@types/leaflet` 的 `geoJSON` 參數型別用 `Parameters<typeof L.geoJSON>[0]` 轉，不 import `geojson`）。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/admissions/area/AreaMap.vue admin/src/__tests__/areaMap.test.ts
git commit -m "feat(admin): 區域分析地圖（里界著色、本校、半徑、附近幼兒園）"
```

---

### Task C7: 附近幼兒園清單

**Files:**
- Create: `admin/src/components/admissions/area/NearbyKindergartens.vue`
- Test: `admin/src/__tests__/nearbyKindergartens.test.ts`

**Interfaces:**
- Consumes: `KIND_LABELS`、`KIND_ORDER`、`RADIUS_OPTIONS`、`formatDistance`、`kindLabel`、`shortDay`、`shortName`、`RadiusKm`（C2）；`NO_VALUE`；型別 `AreaKindergartens`。
- Produces: 元件 props `{ data: AreaKindergartens | null; failed: boolean; radiusKm: RadiusKm }`，emit `'update:radiusKm': [value: RadiusKm]`、`select: [id: string]`、`retry: []`。

- [ ] **Step 1: 寫失敗的測試** `admin/src/__tests__/nearbyKindergartens.test.ts`

```ts
// 附近幼兒園清單（2026-10-08 規格 9.4）。
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import { areaKindergartens, areaStats, button, kindergarten } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
})
function mountList(props: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(NearbyKindergartens, {
    props: { data: areaKindergartens(), failed: false, radiusKm: 3, ...props } as never,
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const names = (wrapper: VueWrapper) => wrapper.findAll('.nearby__name').map((item) => item.text())

describe('附近幼兒園清單', () => {
  it('依後端順序列出：去掉「高雄市私立／市立」前綴、類型、距離、核定人數、月費（估）、裁罰、本機構', () => {
    const wrapper = mountList()
    expect(names(wrapper)).toEqual(['常春藤幼兒園', '大樹幼兒園', '小草幼兒園', '三民區小芽非營利幼兒園'])
    const rows = wrapper.findAll('.nearby__row').map((row) => row.text().replace(/\s+/g, ''))
    expect(rows[0]).toContain('本機構')
    expect(rows[1]).toContain('公立')
    expect(rows[1]).toContain('380m・核定90人・月費（估）2,500元')
    expect(rows[2]).toContain('準公共')
    expect(rows[2]).toContain('有裁罰紀錄')
    expect(rows[3]).toContain('1.8km・核定120人・月費（估）—')
    expect(wrapper.text()).toContain('資料來源：全國教保資訊網（kiang 整理），月費為估計值・10/08 更新')
  })

  it('搜尋名稱與地址；類型 chip 可複選，選了就不列本機構', async () => {
    const wrapper = mountList()
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('大樹')
    expect(names(wrapper)).toEqual(['大樹幼兒園'])
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('義華路')
    expect(names(wrapper)).toHaveLength(4)
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('')
    const chip = (label: string) => wrapper.findAll('.nearby__kind').find((item) => item.text() === label)!
    await chip('公立').trigger('click')
    expect(chip('公立').attributes('aria-pressed')).toBe('true')
    await chip('非營利').trigger('click')
    expect(names(wrapper)).toEqual(['大樹幼兒園', '三民區小芽非營利幼兒園'])
    await chip('公立').trigger('click')
    expect(names(wrapper)).toEqual(['三民區小芽非營利幼兒園'])
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('不存在')
    expect(wrapper.text()).toContain('沒有符合條件的幼兒園。')
  })

  it('先列 20 所，其餘按「顯示更多」；換資料（半徑變了）收回', async () => {
    const many = Array.from({ length: 25 }, (_, index) => kindergarten({ source_id: `kg-${index}`, name: `高雄市私立第${index}幼兒園` }))
    const wrapper = mountList({ data: areaKindergartens(many) })
    expect(names(wrapper)).toHaveLength(20)
    await button(wrapper, '顯示更多（還有 5 所）')!.trigger('click')
    expect(names(wrapper)).toHaveLength(25)
    await wrapper.setProps({ data: areaKindergartens(many, { radius_km: 6 }) })
    expect(names(wrapper)).toHaveLength(20)
  })

  it('點一列：回報 select、展開地址電話與準公共期間；教保資訊網連結開新視窗', async () => {
    const wrapper = mountList()
    const row = wrapper.findAll('.nearby__row')[2]!
    expect(row.attributes('aria-expanded')).toBe('false')
    await row.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['kg-quasi']])
    expect(row.attributes('aria-expanded')).toBe('true')
    const detail = wrapper.get('.nearby__detail')
    expect(detail.text()).toContain('[807]義華路12號')
    expect(detail.text()).toContain('(07)3800000')
    expect(detail.text()).toContain('114-116 學年')
    const link = detail.get('a')
    expect(link.attributes('href')).toBe('https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    await row.trigger('click')
    expect(wrapper.find('.nearby__detail').exists()).toBe(false)
  })

  it('半徑 1／3／6 公里：選了回報 update:radiusKm', async () => {
    const wrapper = mountList()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 6)
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6]])
    expect(wrapper.findAll('.el-radio-button').map((item) => item.text())).toEqual(['1 公里', '3 公里', '6 公里'])
  })

  it('狀態：讀取中骨架、失敗可重試、只有本機構、校址比對不到', async () => {
    expect(mountList({ data: null }).find('.el-skeleton').exists()).toBe(true)
    const failed = mountList({ data: null, failed: true })
    expect(failed.text()).toContain('無法讀取附近幼兒園。')
    await button(failed, '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toEqual([[]])
    const onlyOwn = mountList({ data: areaKindergartens([kindergarten({ source_id: 'kg-own', is_own: true })]), radiusKm: 1 })
    expect(onlyOwn.text()).toContain('1 公里內沒有其他幼兒園。')
    const lost = mountList({
      data: areaKindergartens([], { campus: { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_doorplate' } }),
    })
    expect(lost.text()).toContain('本校地址比對不到門牌，無法列出附近幼兒園。')
    expect(lost.find('input[aria-label="搜尋幼兒園"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/nearbyKindergartens.test.ts`
Expected: FAIL（找不到元件）。

- [ ] **Step 3: 實作** `admin/src/components/admissions/area/NearbyKindergartens.vue`

```vue
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { AreaKindergartens } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { KIND_LABELS, KIND_ORDER, RADIUS_OPTIONS, formatDistance, kindLabel, shortDay, shortName, type RadiusKm } from './areaFormat'

// 附近幼兒園（2026-10-08 規格 9.4）：本校半徑內的公開園所資料，後端已依距離排序。
// 點一列：地圖移過去並打開該園資訊（select），同時展開這一列的詳情。
const props = defineProps<{ data: AreaKindergartens | null; failed: boolean; radiusKm: RadiusKm }>()
const emit = defineEmits<{ 'update:radiusKm': [value: RadiusKm]; select: [id: string]; retry: [] }>()

const PAGE = 20
// 教保資訊網沒有單一園所的固定網址，連到查詢頁。
const MOE_SEARCH = 'https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx'
const headingId = useId()
const search = ref('')
const kinds = ref<string[]>([])
const showAll = ref(false)
const expanded = ref<string | null>(null)

// 換校區或半徑（新資料）：收回「顯示更多」與展開。
watch(() => props.data, () => {
  showAll.value = false
  expanded.value = null
})

const items = computed(() => props.data?.items ?? [])
const others = computed(() => items.value.filter((item) => !item.is_own).length)
const filtered = computed(() => {
  const keyword = search.value.trim()
  return items.value.filter((item) => {
    if (kinds.value.length && (item.is_own || !kinds.value.includes(item.kind))) return false
    return !keyword || item.name.includes(keyword) || item.address.includes(keyword)
  })
})
const visible = computed(() => (showAll.value ? filtered.value : filtered.value.slice(0, PAGE)))
const emptyText = computed(() => {
  if (!others.value) return `${props.radiusKm} 公里內沒有其他幼兒園。`
  return filtered.value.length ? '' : '沒有符合條件的幼兒園。'
})

function toggleKind(kind: string) {
  kinds.value = kinds.value.includes(kind) ? kinds.value.filter((value) => value !== kind) : [...kinds.value, kind]
}
function choose(id: string) {
  expanded.value = expanded.value === id ? null : id
  emit('select', id)
}
function setRadius(value: string | number | boolean | undefined) {
  const km = Number(value)
  if (km === 1 || km === 3 || km === 6) emit('update:radiusKm', km)
}
const fee = (value: number | null) => (value === null ? NO_VALUE : `${value.toLocaleString('zh-TW')} 元`)
</script>

<template>
  <section class="nearby" :aria-labelledby="headingId">
    <div class="nearby__head">
      <h3 :id="headingId" class="nearby__title">附近幼兒園</h3>
      <el-radio-group :model-value="radiusKm" size="small" aria-label="半徑" @update:model-value="setRadius">
        <el-radio-button v-for="km in RADIUS_OPTIONS" :key="km" :value="km">{{ km }} 公里</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近幼兒園。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="data.campus.locate_error" class="nearby__empty">本校地址比對不到門牌，無法列出附近幼兒園。</p>
    <template v-else>
      <el-input v-model="search" clearable maxlength="40" placeholder="園名或地址" aria-label="搜尋幼兒園" />
      <div class="nearby__kinds" role="group" aria-label="依類型篩選">
        <button
          v-for="kind in KIND_ORDER"
          :key="kind"
          type="button"
          class="nearby__kind"
          :class="{ 'is-on': kinds.includes(kind) }"
          :aria-pressed="kinds.includes(kind)"
          @click="toggleKind(kind)"
        >
          <span class="nearby__dot" :class="`nearby__dot--${kind}`" aria-hidden="true" />{{ KIND_LABELS[kind] }}
        </button>
      </div>

      <ul v-if="visible.length" class="nearby__list">
        <li v-for="item in visible" :key="item.source_id" class="nearby__item">
          <button type="button" class="nearby__row" :aria-expanded="expanded === item.source_id" @click="choose(item.source_id)">
            <span class="nearby__line">
              <span class="nearby__name">{{ shortName(item.name) }}</span>
              <el-tag v-if="item.is_own" size="small" effect="plain" round>本機構</el-tag>
              <el-tag v-else size="small" type="info" effect="plain" round>{{ kindLabel(item.kind) }}</el-tag>
              <el-tag v-if="item.has_penalty" size="small" type="danger" effect="plain" round>有裁罰紀錄</el-tag>
            </span>
            <span class="nearby__meta num">{{ formatDistance(item.distance_m) }}・核定 {{ item.approved_capacity ?? NO_VALUE }} 人・月費（估）{{ fee(item.monthly_fee_estimate) }}</span>
          </button>
          <dl v-if="expanded === item.source_id" class="nearby__detail">
            <div><dt>地址</dt><dd>{{ item.address }}</dd></div>
            <div v-if="item.phone"><dt>電話</dt><dd>{{ item.phone }}</dd></div>
            <div v-if="item.pre_public_period"><dt>準公共</dt><dd>{{ item.pre_public_period }} 學年</dd></div>
            <div><dt>官方資料</dt><dd><a :href="MOE_SEARCH" target="_blank" rel="noopener noreferrer">全國教保資訊網查詢 ↗</a></dd></div>
          </dl>
        </li>
      </ul>
      <p v-if="emptyText" class="nearby__empty">{{ emptyText }}</p>
      <el-button v-if="!showAll && filtered.length > PAGE" text @click="showAll = true">顯示更多（還有 {{ filtered.length - PAGE }} 所）</el-button>
      <p class="hint nearby__source">{{ data.source_note }}・{{ shortDay(data.synced_at) }} 更新</p>
    </template>
  </section>
</template>

<style scoped>
.nearby {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.nearby__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nearby__title {
  margin: 0;
  font-size: var(--text-md);
}

.nearby__kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nearby__kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.nearby__kind.is-on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--ink);
}

.nearby__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.nearby__dot--public { background: var(--area-kind-public); }
.nearby__dot--nonprofit { background: var(--area-kind-nonprofit); }
.nearby__dot--quasi_public { background: var(--area-kind-quasi-public); }
.nearby__dot--private { background: var(--area-kind-private); }

.nearby__list {
  display: grid;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.nearby__item + .nearby__item {
  border-top: 1px solid var(--line);
}

.nearby__row {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nearby__row:hover,
.nearby__row[aria-expanded='true'] {
  background: var(--surface-2);
}

.nearby__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.nearby__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.nearby__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.nearby__detail {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
}

.nearby__detail div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}

.nearby__detail dt {
  color: var(--ink-3);
}

.nearby__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.nearby__empty {
  margin: 0;
  color: var(--ink-2);
}

.nearby__source {
  margin: 0;
}

@media (min-width: 1200px) {
  .nearby__list {
    max-height: 420px;
  }
}
</style>
```

- [ ] **Step 4: 跑測試確認通過＋守門**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/nearbyKindergartens.test.ts src/__tests__/ux20261005.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/admissions/area/NearbyKindergartens.vue admin/src/__tests__/nearbyKindergartens.test.ts
git commit -m "feat(admin): 區域分析的附近幼兒園清單"
```

---

### Task C8: 區域分析子分頁 AreaTab 與統計分頁接線

**Files:**
- Create: `admin/src/components/admissions/area/AreaTab.vue`
- Modify: `admin/src/components/admissions/StatsTab.vue`
- Test: `admin/src/__tests__/areaTab.test.ts`、`admin/src/__tests__/statsTab.test.ts`、`admin/src/__tests__/compareTable.test.ts:116`

**Interfaces:**
- Consumes: `getArea`、`getAreaBoundaries`、`getAreaKindergartens`（C1）；`areaQuery`（C2）；`bandLabel`、`doorplateVersionLabel`、`reasonLabel`、`shortDay`、`RadiusKm`、`VillageBoundaries`（C2）；`StatsDimensionTable` 的 `actionLabel`／`action`（C5）；`AreaMap`（C6）；`NearbyKindergartens`（C7）；`campusLabel`、`useNarrowScreen`、`useRequestSequence`。
- Produces: `AreaTab` props `{ campusKey: string; schoolYear: number | null; semester: number | null; csvName: (title: string) => string; emptyText: string }`、emit `'open-records': [filter: { area: string }]`；`StatsTab` emit 型別 `'open-records': [filter: { month?: string; area?: string }]`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/areaTab.test.ts`：

```ts
// 區域分析子分頁（2026-10-08 規格 9）。地圖元件換成 stub（地圖本身見 areaMap.test.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import {
  areaKindergartens, areaStats, button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf, villageBoundaries,
} from './admissionsTestKit'

const mapStub = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('../components/admissions/area/AreaMap.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'AreaMap',
      props: ['boundaries', 'villages', 'campus', 'campusName', 'kindergartens', 'radiusKm', 'narrow'],
      emits: ['open-area'],
      setup(_, { expose }) {
        expose({ focusKindergarten: mapStub.focus })
        return () => h('div', { class: 'area-map-stub' })
      },
    }),
  }
})
vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => {
  mapStub.focus.mockClear()
  cleanup()
})

const EMPTY_TEXT = '義華在 115 學年還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。'
const props = (changes: Record<string, unknown> = {}) => ({
  campusKey: 'yihua', schoolYear: 115, semester: null, csvName: (title: string) => `招生統計-${title}.csv`, emptyText: EMPTY_TEXT, ...changes,
})
const routes = (area: unknown = areaStats()) => ({
  '/admin/admissions/area/boundaries': villageBoundaries(),
  '/admin/admissions/area/kindergartens': areaKindergartens(),
  '/admin/admissions/area': area,
})
async function mountTab(changes: Record<string, unknown> = {}, area: unknown = areaStats()) {
  const get = mockGet(routes(area))
  const mounted = await mountWith(AreaTab, { props: props(changes) })
  await vi.waitFor(() => expect(mounted.wrapper.find('.area-map-stub').exists() || mounted.wrapper.find('.area-map-error').exists()).toBe(true))
  return { ...mounted, get }
}
type Dom = Omit<DOMWrapper<Element>, 'exists'>
const block = (wrapper: VueWrapper, title: string): Dom =>
  wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: Dom) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))
const squash = (text: string) => text.replace(/\s+/g, '')

describe('區域分析：讀取與三張表', () => {
  it('依頁首校區與學期讀區域、里界、附近幼兒園（半徑預設 3 公里）；狀態列寫資料版本', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area?')[0]!))).toEqual({ campus_key: 'yihua', school_year: '115' })
    expect(pathsTo(get, '/admin/admissions/area/boundaries')).toHaveLength(1)
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月・幼兒園 10/08 更新')
    expect(squash(wrapper.get('.area-summary').text())).toBe('有地址7筆：5筆到里、2筆未定位到里查看；另有2筆沒填地址')
    expect(wrapper.get('.area-reasons').text()).toBe('未定位到里的原因：里有歧義 1・查無門牌 1')
  })

  it('行政區、里（依參觀人數排）、距離三張表；表頭同其他子分頁', async () => {
    const { wrapper } = await mountTab()
    expect(block(wrapper, '行政區排行').findAll('thead th').map((th) => th.text())).toEqual(['#', '行政區', '參觀人數', '預繳人數', '預繳率', '操作'])
    expect(bodyRows(block(wrapper, '行政區排行'))).toEqual([
      ['1', '三民區', '5', '2', '40.0%', '查看明細'],
      ['2', '鼓山區', '1', '0', '0.0%', '查看明細'],
    ])
    expect(bodyRows(block(wrapper, '里排行'))).toEqual([
      ['1', '三民區本揚里', '3', '1', '33.3%', '查看明細'],
      ['2', '三民區寶業里', '1', '1', '100.0%', '查看明細'],
      ['3', '鼓山區龍子里', '1', '0', '0.0%', '查看明細'],
    ])
    expect(bodyRows(block(wrapper, '距離分布'))).toEqual([
      ['1 公里內', '4', '2', '50.0%'],
      ['1–3 公里', '0', '0', '—'],
      ['3–6 公里', '1', '0', '0.0%'],
      ['6 公里以上', '0', '0', '—'],
      ['無距離', '4', '0', '0.0%'],
    ])
  })

  it('「查看明細」與「查看」交給頁面帶區域；地圖點里同樣', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '行政區排行').findAll('tbody button')[0]!.trigger('click')
    await block(wrapper, '里排行').findAll('tbody button')[0]!.trigger('click')
    await button(wrapper, '查看')!.trigger('click')
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('open-area', { district: '三民區', village: '寶業里' })
    expect(wrapper.emitted('open-records')).toEqual([
      [{ area: '三民區' }], [{ area: '三民區/本揚里' }], [{ area: 'no_village' }], [{ area: '三民區/寶業里' }],
    ])
  })

  it('地圖拿到里界、各里數字、本校、幼兒園與半徑；清單點一列地圖跟著移過去', async () => {
    const { wrapper } = await mountTab()
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props()).toMatchObject({ campusName: '義華', radiusKm: 3, narrow: false, boundaries: villageBoundaries(), villages: areaStats().villages })
    expect(map.props('kindergartens')).toHaveLength(4)
    wrapper.findComponent(NearbyKindergartens).vm.$emit('select', 'kg-public')
    expect(mapStub.focus).toHaveBeenCalledWith('kg-public')
  })

  it('換半徑：重讀幼兒園帶 radius_km，地圖半徑跟著變', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens').at(-1)!).get('radius_km')).toBe('6')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
  })

  it('匯出 CSV：檔名用頁面給的格式；不含「查看明細」欄', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '行政區排行').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-行政區排行.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('#,行政區,參觀人數,預繳人數,預繳率')
  })
})

describe('區域分析：空狀態與錯誤（規格 9.5）', () => {
  it('門牌資料還沒匯入：狀態列寫出來', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toContain('門牌資料尚未匯入，匯入後會自動比對。')
  })

  it('有訪視但都沒填地址：寫原因、不列三張表（不顯示假的 0）；地圖與清單照常', async () => {
    const area = areaStats({
      totals: { visit: 3, with_address: 0, village_level: 0, district_level: 0, unlocated: 3, pending: 0, unlocated_reasons: [{ reason: 'no_address', count: 3 }] },
      districts: [], villages: [],
      distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: band.band === 'none' ? 3 : 0, deposit: 0, visit_to_deposit_rate: band.band === 'none' ? 0 : null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.text()).toContain('這個範圍的訪視都還沒填地址。')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
    expect(wrapper.find('.area-map-stub').exists()).toBe(true)
    expect(wrapper.find('.area-summary').exists()).toBe(false)
  })

  it('範圍內沒有訪視：沿用統計的空狀態文案', async () => {
    const area = areaStats({
      totals: { visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, unlocated_reasons: [] },
      districts: [], villages: [], distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: 0, deposit: 0, visit_to_deposit_rate: null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.text()).toContain(EMPTY_TEXT)
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('本校地址比對不到門牌：距離表改寫原因', async () => {
    const area = areaStats({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error: 'no_doorplate' } })
    const { wrapper } = await mountTab({}, area)
    expect(block(wrapper, '距離分布').text()).toContain('本校地址比對不到門牌，無法計算距離。')
    expect(block(wrapper, '距離分布').findAll('tbody tr')).toHaveLength(0)
  })

  it('區域讀取失敗：錯誤與重新載入，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area': () => { if (fail) throw new Error('boom'); return areaStats() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    expect(wrapper.text()).toContain('無法讀取區域分析，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.area-status').exists()).toBe(true)
  })

  it('里界讀取失敗：地圖區寫錯誤與重試，表格照常；重試成功出現地圖', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => { if (fail) throw new Error('boom'); return villageBoundaries() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    expect(wrapper.get('.area-map-error').text()).toContain('里界載入失敗，地圖無法顯示。')
    expect(block(wrapper, '行政區排行')).toBeDefined()
    fail = false
    await button(wrapper, '重試')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
  })

  it('快速切換校區只顯示最後一次（明華先回、義華晚回也不會蓋掉）', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area': (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? slow.promise : areaStats({ campus: { key: 'minghua', name: '明華', lat: 22.663189, lng: 120.306301, locate_error: null } })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    slow.resolve(areaStats())
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent({ name: 'AreaMap' }).exists()).toBe(true))
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('campus')).toMatchObject({ key: 'minghua' })
  })
})
```

`admin/src/__tests__/statsTab.test.ts`：

1. 在 `vi.mock('../utils/csv', …)` 那段之前加 stub（整檔只用到 props 與事件）：

```ts
vi.mock('../components/admissions/area/AreaTab.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'AreaTab',
      props: ['campusKey', 'schoolYear', 'semester', 'csvName', 'emptyText'],
      emits: ['open-records'],
      setup: () => () => h('div', { class: 'area-tab-stub' }),
    }),
  }
})
```

2. 在 `describe('統計分頁：子分頁由 sub 控制（X2a 3A）'` 裡最後加：

```ts
  it('區域分析在接待之後、未預繳之前；sub=area 才掛，帶頁首條件、空狀態與匯出檔名；查看明細交給頁面', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ sub: 'area' }) })
    expect(wrapper.findAll('.stats-subtabs .el-tabs__item').map((item) => item.text()))
      .toEqual(['總覽', '班別分析', '來源分析', '接待分析', '區域分析', '未預繳原因'])
    const tab = wrapper.findComponent({ name: 'AreaTab' })
    expect(tab.props()).toMatchObject({ campusKey: 'yihua', schoolYear: 115, semester: 1 })
    expect(tab.props('emptyText')).toContain('還沒有招生訪視')
    expect((tab.props('csvName') as (title: string) => string)('里排行')).toBe(`招生統計-里排行-義華-115 上學期-${taipeiToday()}.csv`)
    tab.vm.$emit('open-records', { area: '三民區' })
    expect(wrapper.emitted('open-records')).toEqual([[{ area: '三民區' }]])
  })

  it('沒點開區域分析不掛（不讀區域 API）', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    expect(wrapper.findComponent({ name: 'AreaTab' }).exists()).toBe(false)
  })
```

（檔名格式同既有「總覽與班別、來源、接待分析的每張表都能匯出」案例：`招生統計-表名-義華-115 上學期-日期.csv`；`taipeiToday` 已在檔頭 import。）

`admin/src/__tests__/compareTable.test.ts:116` 改成：

```ts
    expect(tabTexts(wrapper)).toEqual(['總覽', '班別分析', '來源分析', '接待分析', '區域分析', '未預繳原因'])
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaTab.test.ts src/__tests__/statsTab.test.ts src/__tests__/compareTable.test.ts`
Expected: FAIL（找不到 `AreaTab.vue`、子分頁沒有「區域分析」）。

- [ ] **Step 3: 實作**

`admin/src/components/admissions/area/AreaTab.vue`：

```vue
<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import NearbyKindergartens from './NearbyKindergartens.vue'
import { getArea, getAreaBoundaries, getAreaKindergartens } from '../../../api/admissions'
import { campusLabel } from '../../../api/labels'
import type { AdmissionsArea, AreaKindergartens } from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { areaQuery } from '../../../admissions/areaFilter'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { bandLabel, doorplateVersionLabel, reasonLabel, shortDay, type RadiusKm, type VillageBoundaries } from './areaFormat'

// 區域分析（2026-10-08 規格 9）：家長來源依行政區／里統計、里界地圖、附近幼兒園、距離分布。
// 口徑同其他子分頁（頁首校區＋入學學年學期）；家長地址在後端以公開門牌資料比對，不送任何外部服務。
// 地圖（Leaflet）另切一個 chunk，點開這個子分頁才下載。
const AreaMap = defineAsyncComponent(() => import('./AreaMap.vue'))

const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: number | null
  csvName: (title: string) => string
  emptyText: string
}>()
const emit = defineEmits<{ 'open-records': [filter: { area: string }] }>()

const narrow = useNarrowScreen()

const area = ref<AdmissionsArea | null>(null)
const failed = ref(false)
const requests = useRequestSequence()

// 換校區或學年學期：畫面清空再讀，只採用最後一次的回應（不殘留別校的數字）。
async function load() {
  const request = requests.begin()
  area.value = null
  failed.value = false
  if (!props.campusKey) return
  try {
    const result = await getArea({ campus_key: props.campusKey, school_year: props.schoolYear, semester: props.semester })
    if (requests.isCurrent(request)) area.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  }
}
watch([() => props.campusKey, () => props.schoolYear, () => props.semester], () => void load(), { immediate: true })

// 里界只有一份（高雄 893 里），換校區、學期不重讀。
const boundaries = ref<VillageBoundaries | null>(null)
const boundariesFailed = ref(false)
async function loadBoundaries() {
  boundariesFailed.value = false
  try {
    boundaries.value = await getAreaBoundaries()
  } catch {
    boundariesFailed.value = true
  }
}
void loadBoundaries()

const radiusKm = ref<RadiusKm>(3)
const kindergartens = ref<AreaKindergartens | null>(null)
const kindergartensFailed = ref(false)
const kindergartenRequests = useRequestSequence()
async function loadKindergartens() {
  const request = kindergartenRequests.begin()
  kindergartens.value = null
  kindergartensFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaKindergartens(props.campusKey, radiusKm.value)
    if (kindergartenRequests.isCurrent(request)) kindergartens.value = result
  } catch {
    if (kindergartenRequests.isCurrent(request)) kindergartensFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadKindergartens(), { immediate: true })

const map = ref<{ focusKindergarten: (id: string) => void } | null>(null)
function focusKindergarten(id: string) {
  map.value?.focusKindergarten(id)
}

// 狀態列：資料版本＋「有地址 N 筆：M 筆到里、K 筆未定位到里」＋原因。沒填地址另外寫，不混進未定位。
const status = computed(() => {
  const data = area.value
  if (!data) return null
  const { totals, data_status: dataStatus } = data
  const pending = totals.pending ? [`待比對 ${totals.pending}`] : []
  return {
    doorplate: dataStatus.doorplate_version
      ? `門牌資料 ${doorplateVersionLabel(dataStatus.doorplate_version)}`
      : '門牌資料尚未匯入，匯入後會自動比對。',
    kindergarten: dataStatus.kindergartens_synced_at ? `・幼兒園 ${shortDay(dataStatus.kindergartens_synced_at)} 更新` : '',
    noVillage: Math.max(0, totals.with_address - totals.village_level),
    noAddress: Math.max(0, totals.visit - totals.with_address),
    reasons: [
      ...totals.unlocated_reasons.filter((item) => item.reason !== 'no_address' && item.count > 0).map((item) => `${reasonLabel(item.reason)} ${item.count}`),
      ...pending,
    ].join('・'),
  }
})

const placeColumns = (label: string): StatsColumn[] => [
  { key: 'place', label, sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]
const DISTRICT_COLUMNS = placeColumns('行政區')
const VILLAGE_COLUMNS = placeColumns('里')
const DISTANCE_COLUMNS: StatsColumn[] = [
  { key: 'band_label', label: '距本校', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]

const districtRows = computed(() => (area.value?.districts ?? []).map((row) => ({ ...row, place: row.district })))
// 依參觀人數多到少；同數保留後端的順序（Array.sort 是穩定排序）。
const villageRows = computed(() =>
  [...(area.value?.villages ?? [])]
    .sort((a, b) => b.visit - a.visit)
    .map((row) => ({ ...row, place: `${row.district}${row.village}`, key: `${row.district}/${row.village}` })),
)
const campusLocated = computed(() => !area.value?.campus.locate_error)
const distanceRows = computed(() =>
  campusLocated.value ? (area.value?.distance_bands ?? []).map((row) => ({ ...row, band_label: bandLabel(row.band) })) : [],
)

function openDistrict(row: Record<string, unknown>) {
  const district = String(row.district ?? '')
  // 後端若把沒有行政區的歸成一列（不是「○○區」），查看明細就看未定位到里。
  emit('open-records', { area: /區$/.test(district) ? areaQuery({ kind: 'place', district, village: null }) : areaQuery({ kind: 'no_village' }) })
}
function openVillage(row: Record<string, unknown>) {
  emit('open-records', { area: areaQuery({ kind: 'place', district: String(row.district), village: String(row.village) }) })
}
function openPlace(filter: { district: string; village: string }) {
  emit('open-records', { area: areaQuery({ kind: 'place', ...filter }) })
}
function openNoVillage() {
  emit('open-records', { area: areaQuery({ kind: 'no_village' }) })
}
</script>

<template>
  <div class="area">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取區域分析，請重新載入。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!area || !status" :rows="6" animated />
    <template v-else>
      <div class="area-head">
        <p class="hint area-status"><span>{{ status.doorplate }}</span><span v-if="status.kindergarten">{{ status.kindergarten }}</span></p>
        <p v-if="area.totals.with_address" class="area-summary">
          有地址 <strong class="num">{{ area.totals.with_address }}</strong> 筆：<span class="num">{{ area.totals.village_level }}</span> 筆到里<template v-if="status.noVillage">、<span class="num">{{ status.noVillage }}</span> 筆未定位到里
            <el-button text size="small" @click="openNoVillage">查看</el-button></template><template v-if="status.noAddress">；另有 <span class="num">{{ status.noAddress }}</span> 筆沒填地址</template>
        </p>
        <p v-if="area.totals.with_address && status.reasons" class="hint area-reasons">未定位到里的原因：{{ status.reasons }}</p>
        <p v-if="!area.totals.visit" class="area-empty">{{ emptyText }}</p>
        <p v-else-if="!area.totals.with_address" class="area-empty">這個範圍的訪視都還沒填地址。</p>
      </div>

      <div class="area-top">
        <div class="area-top__map">
          <el-alert v-if="boundariesFailed" class="area-map-error" type="error" :closable="false" show-icon title="里界載入失敗，地圖無法顯示。">
            <el-button size="small" @click="loadBoundaries()">重試</el-button>
          </el-alert>
          <el-skeleton v-else-if="!boundaries" :rows="8" animated />
          <AreaMap
            v-else
            ref="map"
            :boundaries="boundaries"
            :villages="area.villages"
            :campus="area.campus"
            :campus-name="campusLabel(campusKey)"
            :kindergartens="kindergartens?.items ?? []"
            :radius-km="radiusKm"
            :narrow="narrow"
            @open-area="openPlace"
          />
        </div>
        <NearbyKindergartens
          v-model:radius-km="radiusKm"
          :data="kindergartens"
          :failed="kindergartensFailed"
          @select="focusKindergarten"
          @retry="loadKindergartens()"
        />
      </div>

      <div v-if="area.totals.with_address" class="area-tables">
        <StatsDimensionTable
          title="行政區排行"
          :rows="districtRows"
          :columns="DISTRICT_COLUMNS"
          row-key="district"
          numbered
          empty-text="這個範圍還沒有比對到行政區的地址"
          :export-filename="csvName('行政區排行')"
          action-label="查看明細"
          @action="openDistrict"
        />
        <StatsDimensionTable
          title="里排行"
          :rows="villageRows"
          :columns="VILLAGE_COLUMNS"
          row-key="key"
          numbered
          empty-text="這個範圍還沒有定位到里的地址"
          caption="里以門牌資料為準；只到區、未定位的訪視不在這張表。"
          :export-filename="csvName('里排行')"
          action-label="查看明細"
          @action="openVillage"
        />
        <StatsDimensionTable
          title="距離分布"
          :rows="distanceRows"
          :columns="DISTANCE_COLUMNS"
          row-key="band"
          empty-text="本校地址比對不到門牌，無法計算距離。"
          :caption="campusLocated ? '從家長地址的門牌量到本校的直線距離；只到區、未定位的訪視算在「無距離」。' : ''"
          :export-filename="csvName('距離分布')"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.area {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.area-head {
  display: grid;
  gap: 4px;
}

.area-head p {
  margin: 0;
}

.area-summary {
  color: var(--ink);
}

.area-empty {
  padding: 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-2);
  text-align: center;
}

.area-top {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.area-top > * {
  min-width: 0;
}

.area-tables {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  min-width: 0;
}

@media (min-width: 1200px) {
  .area-top {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
  }
}

@media (max-width: 720px) {
  .area-tables {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

`admin/src/components/admissions/StatsTab.vue`：

1. import 加 `import AreaTab from './area/AreaTab.vue'`（放在 `import CompareTable from './CompareTable.vue'` 之前）。
2. 第 19 行註解改成：`// 子分頁順序同園務：總覽、班別分析、來源分析、接待分析、區域分析（2026-10-08 起官網也做，見區域分析規格）、未預繳原因。`
3. emit 改成：`const emit = defineEmits<{ 'open-records': [filter: { month?: string; area?: string }] }>()`
4. template：在「接待分析」那個 `</el-tab-pane>` 之後、「未預繳原因」pane 之前加：

```html
        <el-tab-pane label="區域分析" name="stats-area" lazy>
          <AreaTab
            :campus-key="campusKey"
            :school-year="schoolYear"
            :semester="semester"
            :csv-name="csvName"
            :empty-text="emptyText"
            @open-records="emit('open-records', $event)"
          />
        </el-tab-pane>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `$NODE npm --prefix admin run test:unit -- src/__tests__/areaTab.test.ts src/__tests__/statsTab.test.ts src/__tests__/compareTable.test.ts src/__tests__/admissionsView.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯。

- [ ] **Step 5: 整套 admin 單元測試**

Run: `$NODE npm --prefix admin run test:unit`
Expected: 全綠（基準 origin/main 的 admin 測試數＋本階段新增）。若有既有測試因子分頁多一個而紅，逐一確認是預期的清單變動再改，不要放寬斷言。

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/admissions/area/AreaTab.vue admin/src/components/admissions/StatsTab.vue admin/src/__tests__/areaTab.test.ts admin/src/__tests__/statsTab.test.ts admin/src/__tests__/compareTable.test.ts
git commit -m "feat(admin): 統計分析新增「區域分析」子分頁"
```

---

### Task C9: 後台 CSP 放行國土測繪圖磚

**Files:**
- Modify: `web/server/utils/security-headers.ts`
- Test: `web/tests/security-headers.spec.ts`

**Interfaces:**
- Produces: `ADMIN_CSP` 的 `img-src` 為 `'self' data: blob: https://wmts.nlsc.gov.tw`；公開頁 CSP 不變。

- [ ] **Step 1: 寫失敗的測試**（`web/tests/security-headers.spec.ts` 的 `describe('資安標頭'` 裡，「後台可以用 iframe 嵌同源的 /preview」那個 it 之後）

```ts
  it('後台地圖的底圖圖磚只放行國土測繪中心（招生區域分析，2026-10-08）；公開頁不變', () => {
    expect(ADMIN_CSP).toContain("img-src 'self' data: blob: https://wmts.nlsc.gov.tw;")
    expect(ADMIN_CSP).not.toMatch(/img-src[^;]*\*/)
    expect(ADMIN_CSP).toContain("connect-src 'self';")
    expect(securityHeadersFor('/', 'production')['Content-Security-Policy']).not.toContain('nlsc')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `$NODE npm --prefix web run test:unit -- tests/security-headers.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 實作** `web/server/utils/security-headers.ts`

1. `// frame-src 'self'：…` 那段註解之後、`export const ADMIN_CSP = [` 之前加：

```ts
// img-src 加 https://wmts.nlsc.gov.tw：招生「區域分析」地圖的底圖是國土測繪中心的電子地圖圖磚
// （2026-10-08）。圖磚請求只帶視野範圍（z/x/y），不帶任何家長資料；其他外部圖片仍不放行。
```

2. `"img-src 'self' data: blob:",` 改成 `"img-src 'self' data: blob: https://wmts.nlsc.gov.tw",`。

- [ ] **Step 4: 跑測試確認通過**

Run: `$NODE npm --prefix web run test:unit -- tests/security-headers.spec.ts`
Expected: PASS（含原本「靜態資源處理器回的 /admin/ 也帶標頭」那條，它比對的是 `ADMIN_CSP` 常數本身）。

- [ ] **Step 5: Commit**

```bash
git add web/server/utils/security-headers.ts web/tests/security-headers.spec.ts
git commit -m "feat(web): 後台 CSP 放行國土測繪電子地圖圖磚"
```

---

### Task C10: stack e2e（含 geo 樣本匯入）

**Files:**
- Create: `tests/stack/fixtures/geo-doorplates.csv`
- Create: `tests/stack/fixtures/geo-preschools.json`
- Modify: `tests/stack/start-api.sh`
- Create: `tests/stack/admissions-area.spec.ts`

**Interfaces:**
- Consumes: A 的 CLI `python -m app.cli geo-sync --doorplates-file PATH --kindergartens-file PATH`（不連外、只匯入指定檔案，並重算訪視）；B 的 `/area*` API 與明細篩選；C2–C9 的畫面。
- Produces: stack 啟動時就有 7 個門牌（五校校址＋兩個測試地址）與 7 筆幼兒園樣本（5 筆會被匯入）。

做法說明：
- 樣本放 `tests/stack/fixtures/`，C 自己的檔案，不依賴 A 的 `backend/tests/fixtures/geo/` 內容。門牌列取自高雄市 115 年 10 月門牌坐標 CSV 原文（全形數字、TWD97 TM2 座標），**不加 BOM**。
- 測試用**崇德校**（`chongde`）：`admissions-flow.spec.ts` 的統計是義華的絕對值斷言（「只有本 spec 建招生訪視」），用崇德才不互相影響。
- 地圖圖磚一律 `page.route` 攔下回 1×1 透明 PNG：測試不連國土測繪中心。

- [ ] **Step 1: 確認 A 的 CLI 介面**

Run: `cd backend; uv run python -m app.cli geo-sync --help`
Expected: 看得到 `--doorplates-file`、`--kindergartens-file`。若旗標名稱不同，下面 Step 3 那一行照 A 的實際名稱改，並在回報裡註明。

- [ ] **Step 2: 建樣本**

`tests/stack/fixtures/geo-doorplates.csv`（UTF-8、不加 BOM、行尾 LF）：

```csv
省市縣市代碼,鄉鎮市區代碼,村里,鄰,街路段,地區,巷,弄,號,橫座標,縱座標
64,6400500,本揚里,032,義華路,,,,６８號,182545.620,2504840.809
64,6400500,本揚里,032,義華路,,,,７０號,182533.168,2504843.486
64,6400300,新超里,013,明華一路,,,,１７６號,178710.890,2507154.120
64,6400300,新上里,016,明華一路,,,,１７５號,178805.414,2507107.008
64,6400300,菜福里,005,崇德路,,,,８７號,178808.368,2508313.417
64,6401800,大華里,016,球場路,,,,５９號,181788.690,2506342.190
64,6401700,八卦里,019,京吉一路,,,,１０２號,182380.030,2509289.160
```

（`新上里` 那列的「鄰」欄實際值實作時用原始資料核對；比對與統計不讀「鄰」，填錯不影響測試。）

`tests/stack/fixtures/geo-preschools.json`（kiang `preschools.json` 同格式，名稱與數字是測試用的虛構資料；座標圍著崇德校 22.673662, 120.307197）：

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.307197, 22.673662] },
      "properties": { "reg_no": "e2e-001", "reg_docno": "", "reg_date": "1998/01/15", "title": "高雄市私立常春藤崇德幼兒園", "owner": "", "city": "高雄市", "town": "左營區", "type": "私立", "address": "[813]崇德路87號", "floor": "1-2", "size": "", "size_in": "", "size_out": "", "tel": "(07)0000001", "url": "", "count_approved": "180", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-own", "monthly": 15000, "is_active": 1 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.3105, 22.6765] },
      "properties": { "reg_no": "e2e-002", "reg_docno": "", "reg_date": "2010/08/01", "title": "高雄市立測試甲幼兒園", "owner": "", "city": "高雄市", "town": "左營區", "type": "公立", "address": "[813]測試路1號", "floor": "1", "size": "", "size_in": "", "size_out": "", "tel": "(07)0000002", "url": "", "count_approved": "90", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-public", "monthly": 2500, "is_active": 1 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.304, 22.67] },
      "properties": { "reg_no": "e2e-003", "reg_docno": "", "reg_date": "2015/02/01", "title": "高雄市私立測試乙幼兒園", "owner": "", "city": "高雄市", "town": "左營區", "type": "私立", "address": "[813]測試路2號", "floor": "1-3", "size": "", "size_in": "", "size_out": "", "tel": "(07)0000003", "url": "", "count_approved": "120", "shuttle": "", "pre_public": "114-120", "is_free5": "", "is_after": "無", "penalty": "有", "has_slip": "no", "id": "e2e-kg-quasi", "monthly": 9800, "is_active": 1 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.315, 22.685] },
      "properties": { "reg_no": "e2e-004", "reg_docno": "", "reg_date": "2019/08/01", "title": "高雄市左營區測試丙非營利幼兒園", "owner": "", "city": "高雄市", "town": "左營區", "type": "非營利", "address": "[813]測試路3號", "floor": "1", "size": "", "size_in": "", "size_out": "", "tel": "(07)0000004", "url": "", "count_approved": "60", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-nonprofit", "monthly": 3500, "is_active": 1 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.3, 22.71] },
      "properties": { "reg_no": "e2e-005", "reg_docno": "", "reg_date": "2012/08/01", "title": "高雄市私立測試丁幼兒園", "owner": "", "city": "高雄市", "town": "楠梓區", "type": "私立", "address": "[811]測試路4號", "floor": "1-2", "size": "", "size_in": "", "size_out": "", "tel": "(07)0000005", "url": "", "count_approved": "150", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-far", "monthly": 12000, "is_active": 1 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.3085, 22.6745] },
      "properties": { "reg_no": "e2e-006", "reg_docno": "", "reg_date": "2001/08/01", "title": "高雄市私立測試已停業幼兒園", "owner": "", "city": "高雄市", "town": "左營區", "type": "私立", "address": "[813]測試路5號", "floor": "1", "size": "", "size_in": "", "size_out": "", "tel": "", "url": "", "count_approved": "60", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-closed", "monthly": 8000, "is_active": 0 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [120.2167, 22.9997] },
      "properties": { "reg_no": "e2e-007", "reg_docno": "", "reg_date": "2005/08/01", "title": "臺南市私立測試戊幼兒園", "owner": "", "city": "臺南市", "town": "東區", "type": "私立", "address": "[701]測試路6號", "floor": "1", "size": "", "size_in": "", "size_out": "", "tel": "", "url": "", "count_approved": "60", "shuttle": "", "pre_public": "無", "is_free5": "", "is_after": "無", "penalty": "無", "has_slip": "no", "id": "e2e-kg-tainan", "monthly": 8000, "is_active": 1 } }
  ]
}
```

距崇德的直線距離（驗算過）：本機構 0、甲約 0.46 km、乙約 0.52 km、丙約 1.5 km、丁約 4.1 km；已停業、臺南兩筆應被 A 的匯入濾掉。

- [ ] **Step 3: stack 啟動時匯入樣本** `tests/stack/start-api.sh`

在 `uv run --frozen python -m app.cli initialize-content ../content/site-fixture.json` 那行之後加：

```bash
  # 招生區域分析（2026-10-08）：匯入 stack 專用的門牌與幼兒園樣本（不連外）。五校校址都在樣本裡，
  # 校區座標才算得出來；WEBSITE_GEO_AUTO_SYNC 維持預設關閉，背景不會去抓正式資料。
  uv run --frozen python -m app.cli geo-sync \
    --doorplates-file ../tests/stack/fixtures/geo-doorplates.csv \
    --kindergartens-file ../tests/stack/fixtures/geo-preschools.json
```

- [ ] **Step 4: 寫 e2e** `tests/stack/admissions-area.spec.ts`

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 招生區域分析（2026-10-08 規格 14.4）：start-api.sh 用 tests/stack/fixtures/geo-* 匯入門牌與幼兒園樣本
// （不連外）。在崇德校建兩筆訪視——admissions-flow.spec 的統計斷言只看義華，不互相影響：
// 一筆左營區新上里（距崇德約 1.2 公里）、一筆臺南地址（非高雄市）。地圖底圖圖磚一律攔下回透明圖。
// 最後兩個 test 是 1440／390 截圖（output/playwright/，給人看，不比對像素）與「頁面不橫向溢出」。

const CAMPUS = 'chongde'
const TERM = currentTerm(taipeiDate(0))
const CHILD_NEAR = '區域分析甲童'
const CHILD_TAINAN = '區域分析乙童'
const SHOTS = path.join(ROOT, 'output/playwright')
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const AREA_PATH = `/admissions?campus=${CAMPUS}&tab=stats&sub=area`

async function blockTiles(page: Page): Promise<void> {
  await page.route('https://wmts.nlsc.gov.tw/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }))
}
const statsBlock = (page: Page, title: string) =>
  page.locator('.stats-block', { has: page.getByRole('heading', { name: title, exact: true }) })

test('區域分析：門牌比對到里 → 三張表 → 附近幼兒園 → 地圖著色 → 查看明細帶區域', async ({ browser }) => {
  test.setTimeout(90_000)
  const api = await adminApi('super_admin')
  for (const [child, address] of [
    [CHILD_NEAR, '813高雄市左營區明華一路175號3樓'],
    [CHILD_TAINAN, '臺南市東區大學路1號'],
  ] as const) {
    await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
      visit_date: taipeiDate(0),
      child_name: child,
      birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
      target_school_year: TERM.schoolYear,
      target_semester: TERM.semester,
      address,
    })
  }
  const { context, page } = await openAs(browser, 'super_admin')
  await blockTiles(page)

  await test.step('統計分析 → 區域分析：狀態列與三張表', async () => {
    await gotoAdmin(page, AREA_PATH, '招生入學')
    await expect(page.locator('.area-status')).toContainText('門牌資料')
    await expect(page.locator('.area-status')).not.toContainText('尚未匯入')
    await expect(page.locator('.area-summary')).toContainText('有地址 2 筆')
    await expect(page.locator('.area-summary')).toContainText('1 筆未定位到里')
    await expect(page.locator('.area-reasons')).toContainText('非高雄市地址 1')
    await expect(statsBlock(page, '里排行').locator('tbody tr').first()).toContainText('左營區新上里')
    // 臺南那筆沒有行政區：後端若另列一行，和左營區同為 1 人、先後不定，所以不比第一列。
    await expect(statsBlock(page, '行政區排行').locator('tbody')).toContainText('左營區')
    const band = statsBlock(page, '距離分布').locator('tbody tr', { hasText: '1–3 公里' })
    await expect(band.locator('td').first()).toHaveText('1')
  })

  await test.step('附近幼兒園：3 公里內本機構＋三所；6 公里多一所；停業與外縣市不列', async () => {
    const list = page.locator('.nearby')
    await expect(list.locator('.nearby__item', { hasText: '常春藤崇德幼兒園' })).toContainText('本機構')
    await expect(list.locator('.nearby__item')).toHaveCount(4)
    await list.locator('.el-radio-button', { hasText: '6 公里' }).click()
    await expect(list.locator('.nearby__item')).toHaveCount(5)
    await expect(list).toContainText('測試丁幼兒園')
    await expect(list).not.toContainText('已停業')
    await expect(list).not.toContainText('測試戊')
  })

  await test.step('地圖：里界載入，新上里是最深的一級', async () => {
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    await expect(page.locator('.area-map path.area-village--l5')).toHaveCount(1)
  })

  await test.step('里排行「查看明細」→ 訪視明細只列新上里；上一頁回到區域分析', async () => {
    await statsBlock(page, '里排行').getByRole('button', { name: '查看明細：左營區新上里' }).click()
    await expect(page).toHaveURL(/tab=records/)
    expect(new URL(page.url()).searchParams.get('area')).toBe('左營區/新上里')
    await expect(page.getByText('只顯示左營區新上里的訪視。')).toBeVisible()
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_NEAR })).toHaveCount(1)
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_TAINAN })).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('.stats-subtabs .el-tabs__item.is-active')).toHaveText('區域分析')
  })

  await Promise.all([context.close(), api.dispose()])
})

const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：區域分析截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    await blockTiles(page)
    await gotoAdmin(page, AREA_PATH, '招生入學')
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-skeleton')).toHaveCount(0)
    await test.step('不橫向溢出', () => expectNoHorizontalOverflow(page))
    if (name === '390') await expect(page.getByRole('button', { name: '移動地圖' })).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, `admissions-area-${name}.png`), fullPage: true })
    await context.close()
  })
}
```

- [ ] **Step 5: 建置並跑 stack e2e**（同時只跑這一組；先確認沒有別的測試在跑：`ps aux | grep -c "[v]itest\|[p]ytest"` 應為 0）

```bash
$NODE npm run e2e:build; npm run test:e2e:stack -- tests/stack/admissions-area.spec.ts tests/stack/admissions-flow.spec.ts
```

Expected: 兩個 spec 全過；`output/playwright/admissions-area-1440.png`、`admissions-area-390.png` 產生。失敗時看 `output/e2e-stack/api-prepare.log`（geo-sync 匯入失敗會在這裡）。

- [ ] **Step 6: Commit**

```bash
git add tests/stack/fixtures/geo-doorplates.csv tests/stack/fixtures/geo-preschools.json tests/stack/start-api.sh tests/stack/admissions-area.spec.ts
git commit -m "test(stack): 招生區域分析端到端（門牌與幼兒園樣本、查看明細、1440／390 截圖）"
```

---

### Task C11: 文件回寫

> **實作註記（2026-10-08，主控裁定 R5／R13／R14／R21 與 C11 追加）**：下面 Step 2、Step 3 的區塊已換成實際寫進 DESIGN.md、README.md 的文字（狀態列以有地址為母數、距離分布表沒有「查看明細」、提示列比照 `vr`），不再是起稿。除下列三個檔案外，C11 另外回寫了 `docs/specs/2026-10-08-admissions-area-design.md`（依實作改數字與命名，新增 §17 實作裁定）、`contracts/ivy-recruitment/README.md` 第 18 點、`deploy/README.md`（新增「公開地理資料同步（招生區域分析）」操作說明與環境變數表一列）、總覽與本檔的 `areaLabel` 描述；招生規格另外在第 114、284 行的 `district` 欄位註記 2026-10-08 起由伺服器填寫。

**Files:**
- Modify: `docs/specs/2026-09-30-website-admissions-design.md`
- Modify: `DESIGN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 本階段與 A、B 的實際結果（測試數、commit、未驗證項）。

- [ ] **Step 1: 招生規格**（每個舊字串都已確認在檔內只出現一次；用 Edit 精確替換）

1. §3.2：`- 園務的月份登記表 \`recruitment_months\`、半年期統計快取 \`recruitment_periods\`、\`expected_start_label\` 自動解析、童年綠地專區統計（\`chuannian_*\`）、行政區統計。` 這一項之後（`- 統計 Excel 匯出…` 之前）不動清單，改在本節的「2026-10-06 更新」引言段之後加一段：

```markdown

> **2026-10-08 更新（使用者裁定，取代上面「區域熱點地圖與附近園所」「行政區統計」兩項）**：改做區域分析的一部分——家長來源依行政區／里統計、里界地圖、附近幼兒園、來源距離分布；家長地址只在官網資料庫內以高雄市公開門牌資料比對，不送任何外部服務、不加地址分析同意勾選。競爭園所的 3／6 km 競爭環、人口與飽和度仍不做。規格見 `docs/specs/2026-10-08-admissions-area-design.md`。
```

2. §9.3：`官網不做行政區，\`district\` 不填）。` 改成 `官網原本不做行政區；2026-10-08 起 \`district\` 由伺服器依門牌比對填寫，這條警示規則不變，仍用 \`REVIEW_SOURCE\`）。`
3. §9.3：`不做：區域分析、童年綠地專區、預計就讀月份（依賴未移植欄位）、Excel 匯出。` 改成 `不做：童年綠地專區、預計就讀月份（依賴未移植欄位）、Excel 匯出。區域分析 2026-10-08 起改做（子分頁放在接待分析之後），見區域分析規格。`
4. §10 表格「統計分析」列：`子分頁：總覽、班別分析、來源分析、接待分析、未預繳原因；多校權限者另有「五校比較」。` 改成 `子分頁：總覽、班別分析、來源分析、接待分析、區域分析（2026-10-08 起）、未預繳原因；多校權限者另有「五校比較」。`；同列 `本次以表格加 CSS 長條呈現，不新增圖表套件。` 改成 `本次以表格加 CSS 長條呈現，不新增圖表套件（區域分析的地圖用 Leaflet，圖表仍不裝）。`
5. §10 表格「訪視明細」列：`地址分析同意仍不放。` 改成 `地址分析同意仍不放。2026-10-08 起展開列在地址下多一行「區域」（門牌比對結果），網址 \`area\` 可篩行政區、里或未定位到里（區域分析「查看明細」用）。`
6. §12.3 表格：`| \`version\`、\`anonymized_at\`、\`created\` 事件 | 不轉 |` 之後加一列：

```markdown
| `recruitment_visit_geo`（里、比對等級、距離，2026-10-08） | 官網專用，不轉；`district` 由官網門牌比對填寫，與園務後端 regex 解析的口徑不同，併入時擇一 |
```

- [ ] **Step 2: DESIGN.md**

1. 在第一個 `## ` 標題（`## 案件明細：一條時間線＋一個主動作（2026-10-06，…）`）之前插入新章節：

```markdown
## 招生入學：區域分析（2026-10-08，`feature/admissions-area-20261008`）

使用者 10-08 要把園務「招生入學 → 統計分析 → 區域分析」搬一部分過來（取代 09-30「區域分析不做」）。規格 `docs/specs/2026-10-08-admissions-area-design.md`。

- **範圍**：家長來源依行政區／里統計、里界著色地圖、附近幼兒園、來源距離分布。**不做**：人口與飽和度、機會判讀、各校 3／6 km 競爭環、Google 評分與車程分鐘。
- **資料來源只用公開資料**：高雄市政府資料開放平台的門牌坐標（每月一版）、內政部國土測繪中心村里界圖（115/08/17 版，隨程式提交）、全國教保資訊網經 kiang 整理的幼兒園資料、國土測繪中心電子地圖圖磚。不用 Google Places，也不用以行為人姓名為鍵的裁罰名冊。
- **精度到「里」**：使用者裁定到里即可。里一律以門牌表的「村里」欄為準，不採信家長寫的里；行政區由地址文字解析，門牌資料只用來補里與座標。
- **個資**：不做地址分析同意勾選（維持「地址分析同意不上畫面」的既有裁定），所以家長地址**不送任何外部服務**；後端用門牌資料在本機比對出區、里與到本校的直線距離（取整 100 m），不存家長座標。地圖只以「里」為單位聚合，不畫個別家庭的點。唯一的外部請求是底圖圖磚（只帶視野範圍），後台 CSP 的 `img-src` 只為它放行 `https://wmts.nlsc.gov.tw`，公開站不變。比對與同步的 log 不記地址。
- **同步預設關**：`WEBSITE_GEO_AUTO_SYNC` 所有環境預設 false（開了會匯入約 185MB 的門牌），關著時區域分析寫「門牌資料尚未匯入，匯入後會自動比對。」，三張表照常顯示（全部算待比對）。
- **子分頁**：放在接待分析之後、未預繳原因之前（同園務），`sub=area`，點開才讀。口徑同其他子分頁（頁首校區＋入學學年學期）。狀態列寫門牌資料月份與幼兒園更新日；摘要以「有地址」為母數：「有地址 N 筆：到里 a 筆、未定位到里 b 筆（只到區 c、查無門牌 d、非高雄市 e、待比對 f）」，括號只列非零項，「查看」跳明細 `area=no_village`（筆數＝b）；沒填地址的另外寫「另有 g 筆沒填地址」，已匿名化的不放在狀態列。整個範圍都沒有可比對的地址時寫原因：沒填地址、或「地址都已依保存期限清除」，不把匿名化說成沒填。
- **表格**：行政區排行、里排行、距離分布三張，沿用 `StatsDimensionTable`（表頭「參觀人數／預繳人數／預繳率」、CSS 長條、匯出 CSV）。桌機用 auto-fit 格線，每張至少約 32rem（1440 一列兩張、距離分布換到下一列），窄螢幕單欄、表格在自己的框內橫捲。「查看明細」是行政區表與里表每列最後一欄的按鈕（`actionLabel`），不做整列可點；按鈕欄不匯出。**距離分布表沒有「查看明細」**（沒有對應的明細篩選）。距離是直線距離，分 1 公里內、1–3、3–6、6 公里以上、無距離；本校位置未定位時全部歸無距離，距離表改寫原因（找不到本校地址／門牌資料尚未匯入／本校地址比對不到門牌）。本校改址後，已存的距離要等下一次同步（或 CLI `geo-sync`）才重算。
- **地圖**：Leaflet＋國土測繪中心電子地圖，`AreaMap` 以 `defineAsyncComponent` 另切 chunk（Leaflet 與圖磚網址只在這個 chunk）。里界依參觀人數分 5 級（`--area-level-1…5`，操作色由淺到深，0 筆不上色），本校金色星號、1／3／6 公里虛線圓、幼兒園依類型上色的小圓點（`--area-kind-*`，類型色避開綠＝已上線、暖黃＝草稿；本機構與本校星號用品牌金）。**地圖顏色一律走 token**：Leaflet 的 `fillColor` 寫不了 CSS 變數，圖形只掛 class、顏色由 `:deep` 規則決定。滾輪不縮放；手機預設不攔單指捲動，按「移動地圖」才可拖曳縮放。底圖連續失敗才跳「底圖載入失敗」＋重試；里界載入失敗或地圖 chunk 載入失敗（部署後舊 hash 檔不存在）時地圖區顯示原因，後者只能「重新整理」整頁，表格與幼兒園清單不受影響。
- **附近幼兒園**：資料來自全國教保資訊網（kiang 每日整理、官網每月匯入），清單底部註明來源與「月費為估計值」；類型 chip 可複選、搜尋園名或地址、先列 20 所；距本校 50 m 內的標「本機構」、不算競爭園所；有裁罰只標「有裁罰紀錄」，不放裁罰對象姓名。
- **訪視明細**：網址 `area`（`三民區`／`三民區/本揚里`／`no_village`）篩區域，常駐提示列比照 `vr` 的句型（「只顯示三民區本揚里的訪視。」）＋「顯示全部」（不放進「已套用篩選」chip，展開更多篩選時會被收掉）。展開列在地址下多一行「區域」（例「三民區本揚里・距本校 1.2 km」）；有地址卻沒有比對紀錄的舊資料寫「待比對」，沒填地址的不列。
```

2. `圖一律是表格＋CSS 長條（填色 \`--el-color-primary\`、底 \`--surface-3\`），不裝圖表套件；` 改成 `圖一律是表格＋CSS 長條（填色 \`--el-color-primary\`、底 \`--surface-3\`），不裝圖表套件（2026-10-08 例外：區域分析的地圖用 Leaflet，見「招生入學：區域分析」）；`
3. `- **不做**：區域分析、全管道彙整` 改成 `- **不做**：全管道彙整`，並在同一項句尾（`…也在訪視明細 CSV 裡。` 之後）加 `區域分析 2026-10-08 起改做一部分，見「招生入學：區域分析」。`

- [ ] **Step 3: README.md 頂部加日期段落**（第一行之前插入；部署狀態寫「未部署」，數字用實際跑出來的）

```markdown
## 2026-10-08 招生入學區域分析（`feature/admissions-area-20261008`，未部署、未 push）

使用者要求把園務「統計分析 → 區域分析」搬一部分過來。**使用者 10-08 裁定**：做里別來源統計、里界地圖、附近幼兒園、來源距離分布；精度到里即可、**不做地址分析同意勾選**（所以家長地址不送任何外部服務）、園所只用公開資料、地圖用 Leaflet＋國土測繪底圖。規格 `docs/specs/2026-10-08-admissions-area-design.md`，計畫 `docs/superpowers/plans/2026-10-08-admissions-area*.md`，規則見 DESIGN.md「招生入學：區域分析」，轉移契約記在 `contracts/ivy-recruitment/README.md` 第 18 點。

- **後端**：新子套件 `backend/app/admissions/geo/`——地址解析（全形／之號／樓層／舊高雄縣／缺區／外縣市）、TWD97→WGS84 轉換（不加依賴）、門牌 CSV 串流匯入（分批 COPY、批次標記、成功才切換）、幼兒園 JSON 匯入、五級比對（exact／nearby／street／district／unlocated，另有 pending）與校區座標；migration `e7a1c4d9b2f6` 新增 `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`、`recruitment_visit_geo` 四張表（`recruitment_visits` 不改結構，`district` 改由伺服器依地址填寫）；訪視建立與改地址時同交易比對，匿名化清掉里與距離、保留 `district`；同步由獨立背景迴圈（`workers/geo_loop.py`）與 CLI `python -m app.cli geo-sync` 兩條路，共用 session 級 advisory lock（搶不到就不跑）；新 API `GET /admin/admissions/area`、`/area/kindergartens`、`/area/boundaries`（ETag）；訪視明細新增 `district`／`village`／`geo=no_village` 篩選與 `geo` 回傳欄位；里界 GeoJSON（893 里，約 600KB）隨程式提交。契約重產（`contracts/openapi.json`、`website-api.d.ts`）。
- **後台**：統計分析新增「區域分析」子分頁（狀態列、地圖、附近幼兒園、行政區／里／距離三張表；行政區表與里表每列有「查看明細」）；訪視明細可依區域篩選（網址 `area`）、展開列顯示比對結果；`StatsDimensionTable` 新增可選的按鈕欄；後台 CSP 放行 `https://wmts.nlsc.gov.tw` 圖磚。Leaflet 1.9.4 只在地圖 chunk 動態載入。
- **口徑裁定**：統計以「有地址」為母數（`totals` 另有 `no_address`、`anonymized`）；本校位置未定位時所有訪視的距離一律歸「無距離」；鄰近比對同單雙號優先、號碼差 30 以內；距離分布表沒有「查看明細」。
- **部署注意**：`WEBSITE_GEO_AUTO_SYNC` 所有環境預設關閉；開啟前確認 Railway PG 剩餘空間 ≥ 500MB（門牌一版含索引約 185MB，換版時新舊並存約 370MB）。關著時區域分析顯示「門牌資料尚未匯入」。開啟步驟與手動退路寫在 `deploy/README.md`「公開地理資料同步（招生區域分析）」。本校改址後，已存的距離要等下一次同步（或手動跑 `geo-sync`）才重算。
- **驗證**（Node 22；後端用獨立測試庫 `ivy_website_area1008_test`，皆為本機結果）：A 階段閘 `test_geo_*`＋`test_csv_export` 238 passed、既有六個檔 109 passed、migration 升降升來回；完整 115 年 10 月門牌（775,772 列，略過 544 列）＋kiang 734 所高雄市營業中幼兒園地址比對：exact 708、nearby 11、street 2、district 13，精確＋鄰近 98.0%（門檻 95%），門牌表含索引 185MB。B 階段閘 後端全套 1929 passed、1 skipped，`npm run contract:check` 通過。C 階段：C8 完成時 admin 全套單元測試 1889 passed（其中一個既有的通知逾時測試在機器卡頓時失敗、單獨重跑通過）；stack e2e `admissions-area.spec.ts`＋`admissions-flow.spec.ts` 7 passed（含 1440／390 截圖斷言）。**最終整合驗證**（admin／web 全套單元測試、`contract:check`、stack e2e 重跑與截圖目視、bundle 檢查）尚待做，結果補在這一段。
- **未驗證／未做**：沒有用過真實家長地址（手填錯字與寫法的比對率未知，只有幼兒園地址的 98.0%）；自動找最新月份的頁面解析只用存下來的頁面樣本測過，沒有對線上資料平台實跑同步；Railway PG 剩餘空間未確認、同步在正式環境從未跑過；e2e 的底圖圖磚被攔成透明圖，真底圖與 CSP 放行只在單元測試確認、沒在部署環境看過；沒有手機實機操作；併入園務時 `district` 的口徑要擇一（官網由門牌比對，園務由 regex 切出「○○區」）。不做人口、飽和度、機會判讀與各校 3／6 km 競爭環。
```

（C11 已依 A、B 階段與 C10 的結果寫成實際內容，沒有括號；C12 跑完最終整合驗證後，更新「驗證」「未驗證／未做」兩項即可。）

- [ ] **Step 4: 檢查**

Run: `grep -n "（填\|（A、B 階段" README.md | head; git diff --stat docs/specs/2026-09-30-website-admissions-design.md DESIGN.md README.md`
Expected: Step 3 的括號在 C12 回填後 grep 不到；三個檔案都有變更。

- [ ] **Step 5: Commit**（C12 回填後一起 commit）

---

### Task C12: 最終驗證與回填

**Files:**
- Modify: `README.md`（回填 C11 Step 3 的括號）

- [ ] **Step 1: Leaflet 沒有進主 bundle**

```bash
$NODE npm --prefix admin run build
ls admin/dist/assets | grep -i "AreaMap"
grep -l "wmts.nlsc.gov.tw" admin/dist/assets/*.js
grep -L "wmts.nlsc.gov.tw" admin/dist/assets/index-*.js
```

Expected：有 `AreaMap-*.js`（與其 css）；含 `wmts.nlsc.gov.tw` 的只有 AreaMap chunk；`index-*.js` 不含。若 Leaflet 跑進了主 chunk，檢查是否有別的檔案 static import 了 `AreaMap.vue` 或 `leaflet`。

- [ ] **Step 2: C 完成閘（總覽）**

```bash
$NODE npm --prefix admin run typecheck; npm --prefix admin run test:unit; npm --prefix web run test:unit; npm run contract:check
```

Expected：typecheck 0 錯；admin 與 web 單元測試全綠；契約一致。記下 admin 測試檔數與案例數。

- [ ] **Step 3: stack e2e**（C10 跑過的話，若之後又改了畫面就重跑）

```bash
$NODE npm run e2e:build; npm run test:e2e:stack -- tests/stack/admissions-area.spec.ts tests/stack/admissions-flow.spec.ts tests/stack/a11y.spec.ts
```

Expected：全過。`a11y.spec.ts` 掃 `/admissions?tab=stats`（總覽），確認多一個子分頁頁籤沒有帶進 axe 違規。

- [ ] **Step 4: 目視截圖**

用 Read 工具打開 `output/playwright/admissions-area-1440.png` 與 `admissions-area-390.png`，逐項核對並寫進回報：
- 1440：地圖在左、清單在右（≥1200px 才兩欄）；三張表在下方；里界有一個里上了最深色；本校星號與虛線圓看得到；狀態列、圖例沒有被截斷。
- 390：地圖約半個螢幕高、右下角「移動地圖」鈕；清單在地圖下方；表格在框內橫捲、頁面不溢出；頁首篩選收成摘要鈕。
- 圖磚在 e2e 是透明圖，底圖空白是預期的；要看真底圖時另外在本機 dev server（`docs/website-admin/README.md` 的 API＋`npm --prefix admin run dev -- --port 5173`）開 `http://localhost:5173/admin/admissions?campus=chongde&tab=stats&sub=area`，dev server 沒有 CSP 不擋圖磚。這一步是選做，沒做就在未驗證項寫明。

- [ ] **Step 5: 回填 README 並 commit 文件**

把 C11 Step 3 的三個括號換成實際內容（後端內容取自 A、B 的 commit；驗證寫實際指令與數字；未驗證項照實寫）。

```bash
grep -n "（填\|（A、B 階段" README.md   # 應無輸出
git add docs/specs/2026-09-30-website-admissions-design.md DESIGN.md README.md
git commit -m "docs: 記錄招生區域分析的規則、裁定與驗證"
```

- [ ] **Step 6: 清理**

- stack 測試庫由 `start-api.sh` 每次重建，不用另外刪；`output/` 已 gitignore。
- `git status --short` 確認沒有遺漏的未追蹤檔（`admin/dist/`、`web/public/admin/` 都在 gitignore）。
- 回報：commit 清單、驗證指令與結果、截圖目視結論、未驗證項。不 push、不部署。
