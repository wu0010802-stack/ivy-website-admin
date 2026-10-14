// 招生入學測試共用：掛載（memory router＋Pinia＋Element Plus）、依路徑前綴 mock api、
// 假資料工廠。檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { AdmissionsArea, AreaKindergarten, AreaKindergartens, AreaOpportunity, AreaTrends, UserOut, VillageBoundaries } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

export const wrappers: VueWrapper[] = []

/** afterEach 用：卸載、還原 mock 與計時器、清掉掛在 body 的彈出層。 */
export function cleanup(): void {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
}

export const superAdmin = () => testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
export const campusAdmin = () => testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })
export const reception = () => testUser('reception', { id: 'desk', email: 'desk@example.invalid', campus_keys: ['yihua'] })
/** 只能看招生、不能改（例如日後的查看角色）。 */
export const admissionsViewer = () =>
  testUser('reception', { id: 'viewer', email: 'viewer@example.invalid', campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })

export async function mountWith(
  component: unknown,
  options: { path?: string; user?: UserOut; props?: Record<string, unknown> } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = options.user ?? superAdmin()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(options.path ?? '/admissions')
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props: options.props,
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

type Handler = (path: string, body?: unknown) => unknown
type Routes = Record<string, unknown>

/** 多個前綴都對得上時取最長的，`/records/x/events` 不會被 `/records` 吃掉。 */
function pick(routes: Routes, path: string): { found: boolean; value: unknown } {
  const key = Object.keys(routes).filter((prefix) => path.startsWith(prefix)).sort((a, b) => b.length - a.length)[0]
  return key === undefined ? { found: false, value: undefined } : { found: true, value: routes[key] }
}

async function respond(routes: Routes, path: string, body: unknown, fallback: unknown): Promise<unknown> {
  const { found, value } = pick(routes, path)
  if (!found) return fallback
  return typeof value === 'function' ? (value as Handler)(path, body) : value
}

const OPTIONS_PATH = '/admin/admissions/options'

/** GET：值可以是資料，或 `(path) => 資料`（丟例外就是 API 失敗）。對不上的路徑回空陣列。 */
export function mockGet(routes: Routes) {
  // 招生頁靠 options 判定功能開關：呼叫者沒給就預設開啟；給了（含丟錯的函式）用呼叫者的。
  const merged = pick(routes, OPTIONS_PATH).found ? routes : { ...routes, [OPTIONS_PATH]: options() }
  return vi.spyOn(api, 'get').mockImplementation((async (path: string) => respond(merged, path, undefined, [])) as never)
}
export function mockPost(routes: Routes = {}) {
  return vi.spyOn(api, 'post').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockPatch(routes: Routes = {}) {
  return vi.spyOn(api, 'patch').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockPut(routes: Routes = {}) {
  return vi.spyOn(api, 'put').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockDelete(routes: Routes = {}) {
  return vi.spyOn(api, 'delete').mockImplementation((async (path: string) => respond(routes, path, undefined, undefined)) as never)
}

/** 先不回應的請求：測「快速切換只顯示最後一次」。 */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Spy = { mock: { calls: unknown[][] } }
export const pathsTo = (spy: Spy, prefix: string): string[] => spy.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith(prefix))
export const queryOf = (path: string): URLSearchParams => new URLSearchParams(path.split('?')[1] ?? '')
export const bodyOf = (spy: Spy, prefix: string): unknown => spy.mock.calls.find((call) => String(call[0]).startsWith(prefix))?.[1]

// 只要求 findAll：測試裡 `Omit<DOMWrapper, 'exists'>` 之類的別名也能直接傳。
type Findable = VueWrapper | Pick<DOMWrapper<Element>, 'findAll'>
export const button = (wrapper: Findable, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
export const hasButton = (wrapper: Findable, text: string) => button(wrapper, text) !== undefined

export const VR_ID = '11111111-2222-4333-8444-555555555555'
export const VR_ID_2 = '66666666-7777-4888-9999-000000000000'

export const visit = (changes: Record<string, unknown> = {}) => ({
  id: 'v-1', campus_key: 'yihua', visit_request_id: null, month: '115.09', seq_no: '1', visit_date: '2026-09-08',
  child_name: '王小安', english_name: null, birthday: '2023-03-02', grade: '小班', phone: '0912345678', contact_name: '王媽媽',
  father_occupation: null, mother_occupation: null, address: null,
  district: null, source: '親友介紹', referrer: null, deposit_collector: null, tour_guide_user_id: null, tour_guide_name: null,
  source_category: null, has_deposit: false, rides_bus: false, notes: null, parent_response: null, geocoding_consent_at: null,
  no_deposit_reason: null, no_deposit_reason_detail: null, enrolled: false, enrolled_on: null, transfer_term: false,
  provisional_grade: null, target_school_year: 115, target_semester: 1, withdrawn_at: null, withdrawn_from: null,
  withdraw_reason: null, version: 1, created_at: '2026-09-08T02:00:00Z', updated_at: '2026-09-08T02:00:00Z',
  stage: 'visited', has_visit_request: false, anonymized_at: null, geo: null, ...changes,
})

export const card = (changes: Record<string, unknown> = {}) => ({
  id: 'v-1', child_name: '王小安', grade: '小班', provisional_grade: null, target_school_year: 115, target_semester: 1,
  visit_date: '2026-09-08', has_visit_request: false, visit_request_id: null, withdrawn_from: null, version: 1, ...changes,
})

type StageKey = 'visited' | 'deposited' | 'enrolled' | 'withdrawn'
export const board = (columns: Partial<Record<StageKey, unknown[]>> = {}, extra: Record<string, unknown> = {}) => ({
  columns: { visited: [], deposited: [], enrolled: [], withdrawn: [], ...columns },
  unscoped_count: 0, school_year: 115, semester: null, campus_key: 'yihua', as_of: '2026-10-01T02:00:00Z', ...extra,
})

export const options = () => ({
  months: ['115.09', '115.08'], sources: ['親友介紹', 'Facebook'], referrers: ['林老師'], tour_guides: ['Marvyna', '林老師'],
  source_categories: { sibling_current: '在校生弟妹（兄姊老師）', sibling_graduate: '畢業生弟妹', referral: '有緣名單（家長介紹／社區招生）' },
})

// ---- 區域分析（2026-10-08）----
// 數字彼此對得上（主控裁定 R5 兩條不變式）：參觀 9＝有地址 7＋沒填 2＋匿名化 0；
// 有地址 7＝到里 5（本揚 3、寶業 1、龍子 1）＋只到區 1（里有歧義）＋未定位 1（查無門牌）＋待比對 0。
const buildAreaStats = () => ({
  as_of: '2026-10-08T02:00:00Z',
  filters: { campus_key: 'yihua', school_year: 115, semester: null },
  data_status: {
    doorplate_version: '115-10', doorplates_synced_at: '2026-10-06T18:00:00Z',
    kindergartens_synced_at: '2026-10-07T18:30:00Z', boundary_version: '115-08-17',
    population_version: '115-09', population_synced_at: '2026-10-12T18:00:00Z',
  },
  campus: { key: 'yihua', name: '義華', lat: 22.642456, lng: 120.343713, locate_error: null, district: '三民區' },
  totals: {
    visit: 9, with_address: 7, village_level: 5, district_level: 1, unlocated: 1, pending: 0, no_address: 2, anonymized: 0,
    unlocated_reasons: [{ reason: 'ambiguous_village', count: 1 }, { reason: 'no_doorplate', count: 1 }],
  },
  districts: [
    { district: '三民區', visit: 5, deposit: 2, visit_to_deposit_rate: 40, visit_to_deposit_range: { low: 17, high: 47.2 } },
    { district: '鼓山區', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
  ],
  villages: [
    { district: '三民區', village: '本揚里', village_code: '64000050015', visit: 3, deposit: 1, visit_to_deposit_rate: 33.3, visit_to_deposit_range: { low: 13.8, high: 45.1 } },
    { district: '三民區', village: '寶業里', village_code: '64000050025', visit: 1, deposit: 1, visit_to_deposit_rate: 100, visit_to_deposit_range: { low: 16.7, high: 52.5 } },
    { district: '鼓山區', village: '龍子里', village_code: null, visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
  ],
  distance_bands: [
    { band: '0-1', visit: 4, deposit: 2, visit_to_deposit_rate: 50, visit_to_deposit_range: { low: 18.4, high: 50.2 } },
    { band: '1-3', visit: 0, deposit: 0, visit_to_deposit_rate: null, visit_to_deposit_range: null },
    { band: '3-6', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
    { band: '6+', visit: 0, deposit: 0, visit_to_deposit_rate: null, visit_to_deposit_range: null },
    { band: 'none', visit: 4, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 7.5, high: 33.6 } },
  ],
} satisfies AdmissionsArea)
/** 每次呼叫都是一份新的（測試改它不會影響別的測試）；changes 整欄換掉，要改巢狀欄位的某一格就自己展開 areaStats().xxx。 */
export const areaStats = (changes: Record<string, unknown> = {}) => ({ ...buildAreaStats(), ...changes })

// 招生機會（2026-10-13）：3 公里內 3 個里，參觀合計 3＋6＋11＝20、2–5 歲 500＋300＋200＝1,000，參觀率 2.0%；
// 鼎金里明顯偏少（應有 10、實際 3）、本揚里差不多、寶業里比附近多。里代碼同 villageBoundaries。
const buildAreaOpportunity = () => ({
  as_of: '2026-10-13T02:00:00Z',
  filters: { campus_key: 'yihua', school_year: 115, semester: null },
  radius_km: 3,
  population: { version: '115-09', synced_at: '2026-10-12T18:00:00Z', age_band: '2-5', source_note: '資料來源：內政部戶政司 村里戶數、單一年齡人口' },
  campus: { key: 'yihua', name: '義華', lat: 22.642456, lng: 120.343713, locate_error: null, district: '三民區' },
  baseline: { villages: 3, children: 1000, infants: 300, visit: 20, rate: 2, judged: true },
  outside_visit: 2,
  unplaced_visit: 3,
  no_population_villages: [],
  villages: [
    { district: '三民區', village: '鼎金里', village_code: '64000050001', distance_m: 800, children: 500, infants: 150, visit: 3, rate: 0.6, expected: 10, shortfall: 7, signal: 'below' },
    { district: '三民區', village: '本揚里', village_code: '64000050015', distance_m: 300, children: 300, infants: 90, visit: 6, rate: 2, expected: 6, shortfall: 0, signal: 'typical' },
    { district: '三民區', village: '寶業里', village_code: '64000050025', distance_m: 300, children: 200, infants: 60, visit: 11, rate: 5.5, expected: 4, shortfall: -7, signal: 'above' },
  ],
} satisfies AreaOpportunity)
/** 每次呼叫都是一份新的；changes 整欄換掉。 */
export const areaOpportunity = (changes: Partial<AreaOpportunity> = {}): AreaOpportunity => ({ ...buildAreaOpportunity(), ...changes })

// 里的變化（2026-10-14）：本揚里淨增最多、鼎金里減少；寶業里與龍子里因里界調整合併（代碼含一個已廢止的舊代碼）。
const buildAreaTrends = () => ({
  as_of: '2026-10-14T02:00:00Z',
  filters: { campus_key: 'yihua', school_year: 115, semester: null },
  radius_km: 3,
  campus: { key: 'yihua', name: '義華', lat: 22.642456, lng: 120.343713, locate_error: null, district: '三民區' },
  sources: {
    population: { month: '115-09', year_ago_month: '114-09' },
    births: { latest: '115-09', months: ['114-10', '114-11', '114-12', '115-01', '115-02', '115-03', '115-04', '115-05', '115-06', '115-07', '115-08', '115-09'], missing: [] },
    migration: { latest: '115-09', months: ['114-10', '114-11', '114-12', '115-01', '115-02', '115-03', '115-04', '115-05', '115-06', '115-07', '115-08', '115-09'], missing: [] },
    note: '資料來源：內政部戶政司 各村（里）戶籍人口統計月報表、遷入遷出統計表、村里戶數及單一年齡人口',
  },
  baseline: {
    villages: 4, children: 1400, kids_net: 26, kids_base: 1374, births_12m: 180, births_months: 12, births_compared_months: 9,
    births_change_pct: -20.7, migration_net_12m: -160, migration_months: 12,
  },
  kids_unavailable: null,
  villages: [
    { key: '64000050015', district: '三民區', village: '本揚里', codes: ['64000050015'], merged: false, distance_m: 300, children: 317, kids_net: 36, kids_base: 281, kids_level: 'up2', births_12m: 36, migration_net_12m: -122 },
    { key: 'group:三民區:64000050025', district: '三民區', village: '寶業里、龍子里', codes: ['64000050025', '64000020015', '64000059999'], merged: true, distance_m: 300, children: 583, kids_net: 12, kids_base: 600, kids_level: 'flat', births_12m: 90, migration_net_12m: 30 },
    { key: '64000050001', district: '三民區', village: '鼎金里', codes: ['64000050001'], merged: false, distance_m: 800, children: 500, kids_net: -22, kids_base: 493, kids_level: 'down1', births_12m: 54, migration_net_12m: -68 },
  ],
} satisfies AreaTrends)
/** 每次呼叫都是一份新的；changes 整欄換掉。 */
export const areaTrends = (changes: Partial<AreaTrends> = {}): AreaTrends => ({ ...buildAreaTrends(), ...changes })

// 座標由 distance_m 反推（從校區正北方量出去），所以座標和 distance_m 一致、本機構（0 m）落在校區 50 m 內，
// 競爭園所都在 50 m 外（後端 OWN_CAMPUS_RADIUS_M）；areaFormat.test.ts 的守門測試用 haversine 驗。
const METERS_PER_DEGREE_LAT = (Math.PI / 180) * 6371000
const northOfCampus = (distanceM: number) => {
  const { lat, lng } = areaStats().campus
  return { lat: Number((lat + distanceM / METERS_PER_DEGREE_LAT).toFixed(6)), lng }
}

// address 沒有郵遞區號前綴：parse_preschools 存進資料庫前就用 _POSTAL_PREFIX 去掉了「[807]」。
export const kindergarten = (changes: Partial<AreaKindergarten> = {}): AreaKindergarten => {
  const distance_m = changes.distance_m ?? 420
  return {
    source_id: 'kg-private', name: '高雄市私立小樹幼兒園', kind: 'private', pre_public_period: null, address: '義華路12號',
    ...northOfCampus(distance_m), distance_m, approved_capacity: 120, monthly_fee_estimate: 9800, has_penalty: false,
    phone: '(07)3800000', is_own: false, ...changes,
  } satisfies AreaKindergarten
}

export const areaKindergartens = (items: AreaKindergarten[] = [
  kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, approved_capacity: 210, monthly_fee_estimate: 15000, is_own: true }),
  kindergarten({ source_id: 'kg-public', name: '高雄市立大樹幼兒園', kind: 'public', distance_m: 380, approved_capacity: 90, monthly_fee_estimate: 2500, phone: null }),
  // 核定人數未知（null）：畫面寫「—」，不寫 0。
  kindergarten({ source_id: 'kg-quasi', name: '高雄市私立小草幼兒園', kind: 'quasi_public', pre_public_period: '114-116', distance_m: 950, approved_capacity: null, has_penalty: true }),
  kindergarten({ source_id: 'kg-nonprofit', name: '高雄市三民區小芽非營利幼兒園', kind: 'nonprofit', distance_m: 1800, monthly_fee_estimate: null }),
], changes: Partial<AreaKindergartens> = {}): AreaKindergartens => ({
  synced_at: '2026-10-07T18:30:00Z',
  source_note: '資料來源：全國教保資訊網（kiang 整理），月費為估計值',
  campus: areaStats().campus,
  radius_km: 3,
  items,
  ...changes,
})

// 里代碼取自後端打包的 kaohsiung-villages.geojson 的真值（本揚里 64000050015、寶業里 64000050025、
// 鼎金里 64000050001、龍子里 64000020015）。龍子里在 areaStats().villages 的 village_code 刻意是 null，
// 模擬「里表有這一里、里界檔對不到代碼」；地圖仍用 TOWNNAME＋VILLNAME 對。
const villageFeature = (town: string, village: string, code: string) => ({
  type: 'Feature' as const,
  properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code },
  geometry: { type: 'Polygon' as const, coordinates: [[[120.34, 22.64], [120.35, 22.64], [120.35, 22.65], [120.34, 22.64]]] },
})
export const villageBoundaries = (): VillageBoundaries => ({
  type: 'FeatureCollection',
  features: [
    villageFeature('三民區', '本揚里', '64000050015'),
    villageFeature('三民區', '寶業里', '64000050025'),
    villageFeature('三民區', '鼎金里', '64000050001'),
    villageFeature('鼓山區', '龍子里', '64000020015'),
  ],
})
