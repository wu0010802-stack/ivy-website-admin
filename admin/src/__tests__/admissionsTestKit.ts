// 招生入學測試共用：掛載（memory router＋Pinia＋Element Plus）、依路徑前綴 mock api、
// 假資料工廠。檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import { UNCLASSIFIED_LABEL, WITHDRAW_REASON_CATEGORIES } from '../admissions/constants'
import type {
  AdmissionsArea, AdmissionsJourney, AreaBabycare, AreaBabycareItem, AreaChange, AreaChanges, AreaEnrolled, AreaFeeItems, AreaKindergarten, AreaKindergartens, AreaOpportunity, AreaPeerFeeSchool, AreaPeerFees, AreaPresale, AreaPresaleItem, AreaTrends,
  UserOut, VillageBoundaries,
} from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

export const wrappers: VueWrapper[] = []

/** /stats 的退出原因分佈：後端一定回八項＋「未分類」共 9 列（W1 順序），沒有人退出時全是 0。 */
export const emptyWithdrawReasons = () =>
  [...WITHDRAW_REASON_CATEGORIES, UNCLASSIFIED_LABEL].map((reason) => ({ reason, deposited: 0, enrolled: 0, total: 0 }))

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
  withdraw_reason: null, withdraw_reason_category: null, version: 1, created_at: '2026-09-08T02:00:00Z', updated_at: '2026-09-08T02:00:00Z',
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
    population_version: '115-09', population_synced_at: '2026-10-12T18:00:00Z', babycare_synced_at: '2026-10-13T18:30:00Z',
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
  // 沒對到里 3 位，其中沒填地址 1 位。
  unplaced_visit: 3,
  no_address_visit: 1,
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
    income: {
      year: 112,
      note: '資料來源：財政部財政資訊中心（2026）綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市（112年度）。本統計之所得為課稅資料，不含政府移轉、免稅與分離課稅所得，不宜逕作為衡量所得差距之參據',
    },
    new_homes: {
      latest: '115S3', seasons: ['114S4', '115S1', '115S2', '115S3'], unplaced: 7, note: '資料來源：內政部不動產交易實價查詢服務網',
    },
    presale: { version: '115-10', unplaced: 2, note: '內政部實價登錄 預售屋建案備查；地號位置：國土測繪中心' },
    school_districts: {
      school_year: 115,
      note: '學區依高雄市政府教育局「115 學年度國民小學學區劃分一覽表」；學校依教育部「國民小學名錄」（115 學年度）',
    },
  },
  baseline: {
    villages: 4, children: 1400, kids_net: 26, kids_base: 1374, births_12m: 180, births_months: 12, births_compared_months: 9,
    births_change_pct: -20.7, migration_net_12m: -160, migration_months: 12,
    births_series: [
      { starts: '114-10', ends: '115-09', months: 12, missing: [], births: 180, change_pct: -20.7 },
      { starts: '113-10', ends: '114-09', months: 12, missing: [], births: 227, change_pct: -5.2 },
      { starts: '112-10', ends: '113-09', months: 11, missing: ['113-03'], births: 215, change_pct: null },
    ],
    new_homes: 130, new_homes_latest: 41, new_homes_seasons: 4,
    presale_households: 376, presale_cases: 5,
  },
  kids_unavailable: null,
  villages: [
    { key: '64000050015', district: '三民區', village: '本揚里', codes: ['64000050015'], merged: false, distance_m: 300, children: 317, kids_net: 36, kids_base: 281, kids_level: 'up2', births_12m: 36, migration_net_12m: -122, income_median: 458, income_boundary_changed: false, new_homes: 24, new_homes_latest: 9, new_homes_by_code: { '64000050015': 24 } as Record<string, number>,
      presale_households: 156, presale_by_code: { '64000050015': 156 } as Record<string, number>,
      schools: [{ code: '593615', name: '東光國小', district: '三民區', partial: false, free_zone: false }] },
    { key: 'group:三民區:64000050025', district: '三民區', village: '寶業里、龍子里', codes: ['64000050025', '64000020015', '64000059999'], merged: true, distance_m: 300, children: 583, kids_net: 12, kids_base: 600, kids_level: 'flat', births_12m: 90, migration_net_12m: 30, income_median: null, income_boundary_changed: false, new_homes: 0, new_homes_latest: 0, new_homes_by_code: {} as Record<string, number>,
      presale_households: 0, presale_by_code: {} as Record<string, number>,
      schools: [
        { code: '553608', name: '光武國小', district: '三民區', partial: true, free_zone: false },
        { code: '523606', name: '龍華國小', district: '鼓山區', partial: true, free_zone: false },
      ] },
    { key: '64000050001', district: '三民區', village: '鼎金里', codes: ['64000050001'], merged: false, distance_m: 800, children: 500, kids_net: -22, kids_base: 493, kids_level: 'down1', births_12m: 54, migration_net_12m: -68, income_median: 512, income_boundary_changed: true, new_homes: 106, new_homes_latest: 32, new_homes_by_code: { '64000050001': 106 } as Record<string, number>,
      presale_households: 220, presale_by_code: { '64000050001': 220 } as Record<string, number>,
      schools: [
        { code: '553604', name: '獅湖國小', district: '三民區', partial: false, free_zone: false },
        { code: '593603', name: '民族國小', district: '三民區', partial: true, free_zone: true },
      ] },
  ],
  schools: [
    { code: '593615', name: '東光國小', district: '三民區', enrollment: 'district', villages_full: 3, villages_partial: 1, children: 927, kids_net: 93, kids_partial: false, visit: 12, rate: 1.3 },
    { code: '553608', name: '光武國小', district: '三民區', enrollment: 'district', villages_full: 4, villages_partial: 6, children: 1287, kids_net: -19, kids_partial: true, visit: 5, rate: 0.4 },
    { code: '124742', name: '文華國小', district: '鳳山區', enrollment: 'capped', villages_full: 0, villages_partial: 2, children: 756, kids_net: null, kids_partial: false, visit: 0, rate: 0 },
  ],
} satisfies AreaTrends)
/** 每次呼叫都是一份新的；changes 整欄換掉。 */
export const areaTrends = (changes: Partial<AreaTrends> = {}): AreaTrends => ({ ...buildAreaTrends(), ...changes })

// 附近預售建案（2026-10-20）：三案在半徑內——乙案已過預計時間（街名只到里、沒有座標）、甲案依門牌有座標、丙案依地號有座標；
// 另有 2 案只到區沒列出。總共 156 戶＋220 戶中本揚里的兩案是 36＋120。
export const presaleItem = (changes: Partial<AreaPresaleItem> = {}): AreaPresaleItem => ({
  name: '甲案', district: '三民區', village: '本揚里', village_code: '64000050015', households: 120, permit_on: '2024-03-10',
  expected_year: 2028, expected_half: 1, overdue: false, distance_m: 0, match_level: 'exact', lat: 22.642456, lon: 120.343713,
  ...changes,
})
export const areaPresale = (changes: Partial<AreaPresale> = {}): AreaPresale => ({
  as_of: '2026-10-20T04:00:00Z',
  radius_km: 3,
  campus: { key: 'yihua', name: '義華', lat: 22.642456, lng: 120.343713, locate_error: null, district: '三民區' },
  source: { version: '115-10', unplaced: 2, note: '內政部實價登錄 預售屋建案備查；地號位置：國土測繪中心' },
  summary: { cases: 3, households: 376 },
  items: [
    presaleItem({
      name: '乙案', households: 36, permit_on: '2023-06-01', expected_year: 2026, expected_half: 1, overdue: true, distance_m: 300,
      match_level: 'street', lat: null, lon: null,
    }),
    presaleItem(),
    presaleItem({
      name: '丙案', village: '鼎金里', village_code: '64000050001', households: 220, permit_on: '2025-01-01', expected_year: 2029,
      distance_m: 800, match_level: 'parcel', lat: 22.6495, lon: 120.3437,
    }),
  ],
  ...changes,
})

// 預約全程（2026-10-15）：後端 test_admissions_journey_calc 的 13 筆情境（情境 13 是退註冊、註冊日已被清掉的真實形狀，
// 所以預繳到註冊只剩情境 1 的 11 天，另有 1 筆不納入）。
const buildJourney = () => ({
  filters: { campus_key: 'yihua', date_from: '2026-07-17', date_to: '2026-10-15', source: 'all' },
  as_of: '2026-10-15T04:00:00Z',
  cases: { total: 13, by_source: { web: 9, phone: 2, line: 1, walk_in: 1, external: 0 } },
  visit_outcomes: { completed: 8, no_show: 1, cancelled: { total: 3, parent: 1, staff: 1, other: 1 }, unmarked: 1 },
  admissions: {
    with_visit: 7, completed_without_visit: 1, deposited: 4, enrolled: 2,
    withdrawn: { total: 2, from_deposit: 1, from_enrolled: 1 },
    not_deposited: { observing: 1, overdue: 1, cold: 1 },
  },
  rates: [
    { key: 'attendance', numerator: 8, denominator: 9, pct: 88.9 },
    { key: 'cancel', numerator: 3, denominator: 13, pct: 23.1 },
    { key: 'with_visit', numerator: 7, denominator: 8, pct: 87.5 },
    { key: 'deposit', numerator: 4, denominator: 7, pct: 57.1 },
    { key: 'enrolled', numerator: 2, denominator: 4, pct: 50 },
    { key: 'withdrawn', numerator: 2, denominator: 4, pct: 50 },
  ],
  timing: {
    lead_days: { median: 7, n: 13, excluded: 0 },
    cancel_before_visit: {
      n: 3, excluded: 0,
      parent: { after_visit: 0, same_day: 1, day_1: 0, days_2_3: 0, days_4_7: 0, days_8_plus: 0 },
      staff: { after_visit: 0, same_day: 0, day_1: 0, days_2_3: 0, days_4_7: 1, days_8_plus: 0 },
      other: { after_visit: 1, same_day: 0, day_1: 0, days_2_3: 0, days_4_7: 0, days_8_plus: 0 },
    },
    visit_to_deposit: { median: 5, n: 3, excluded: 1 },
    deposit_to_enrolled: { median: 11, n: 1, excluded: 1 },
    deposit_to_withdrawn: { median: 11, n: 2, excluded: 0 },
  },
  rescheduled: { cases: 1, total: 13 },
  coverage: { visits_without_request: 4, completed_without_visit: 1, undated_cases: 2, excluded_cases: 0 },
} satisfies AdmissionsJourney)
/** 每次呼叫都是一份新的；changes 整欄換掉。 */
export const journeyData = (changes: Partial<AdmissionsJourney> = {}): AdmissionsJourney => ({ ...buildJourney(), ...changes })

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
    phone: '(07)3800000', is_own: false,
    indoor_m2_per_child: null, outdoor_m2_per_child: null, has_shuttle: null, after_school_capacity: null,
    penalties_recent: 0, penalty_latest_on: null, has_older_penalty: false, evaluation_latest: null, ...changes,
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
  // 裁罰、評鑑（2026-10-20）：預設還沒匯入（null）；要測匯入後的畫面時用 changes 帶時間。
  penalties_synced_at: null,
  evaluations_synced_at: null,
  source_note: '資料來源：全國教保資訊網（kiang 整理）',
  campus: areaStats().campus,
  radius_km: 3,
  items,
  ...changes,
})

// 托嬰（2026-10-14）：座標同樣由 distance_m 反推；核定、實際收托是官方回報的數字。
export const babycareItem = (changes: Partial<AreaBabycareItem> = {}): AreaBabycareItem => {
  const distance_m = changes.distance_m ?? 520
  return {
    source_id: 'bc-center', name: '高雄市私立小星星托嬰中心', kind: 'center', address: '高雄市三民區義華路20號',
    ...northOfCampus(distance_m), distance_m, approved_capacity: 40, enrolled: 32, phone: '07-3801000',
    monthly_fee: null, fee_note: null, evaluation_grade: null, evaluation_year: null, quasi_public: null, ...changes,
  } satisfies AreaBabycareItem
}

export const areaBabycare = (items: AreaBabycareItem[] = [
  babycareItem({ source_id: 'bc-public', name: '高雄市政府社會局委託辦理高雄市三民公共托嬰中心', distance_m: 165, approved_capacity: 52, enrolled: 52 }),
  babycareItem({ source_id: 'bc-center', distance_m: 520 }),
  // 核定與實際收托未知（null）：畫面寫「—」，總結不計入。
  babycareItem({ source_id: 'bc-home', name: '高雄市鳥松社區公共托育家園', kind: 'home', distance_m: 1297, approved_capacity: null, enrolled: null, phone: null }),
], changes: Partial<AreaBabycare> = {}): AreaBabycare => ({
  synced_at: '2026-10-13T18:30:00Z',
  source_note: '資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料',
  campus: areaStats().campus,
  radius_km: 3,
  summary: {
    count: items.length,
    approved_total: items.reduce((sum, item) => sum + (item.approved_capacity ?? 0), 0),
    enrolled_total: items.reduce((sum, item) => sum + (item.enrolled ?? 0), 0),
    fee_count: 0, fee_median: null, fee_min: null, fee_max: null, own_age2_monthly: null, fee_school_year: null,
  },
  items,
  ...changes,
})

export const providerChange = (changes: Partial<AreaChange> = {}): AreaChange => ({
  provider: 'kindergarten', source_id: 'kg-new', name: '高雄市私立三多哈波特幼兒園', kind: 'private', change: 'opened',
  date: '2026-09-03', date_basis: 'registered', distance_m: 780, old_kind: null, new_kind: null, ...changes,
})

export const areaChanges = (items: AreaChange[] = [
  providerChange({ provider: 'babycare', source_id: 'bc-closed', name: '高雄市私立頂尖小子托嬰中心', kind: 'center', change: 'closed', date: '2026-10-09', date_basis: 'observed', distance_m: 435 }),
  providerChange({ source_id: 'kg-kind', name: '高雄市私立保羅幼兒園', kind: 'quasi_public', change: 'kind_changed', date: '2026-10-04', date_basis: 'observed', distance_m: 513, old_kind: 'private', new_kind: 'quasi_public' }),
  providerChange(),
], changes: Partial<AreaChanges> = {}): AreaChanges => ({
  campus: areaStats().campus,
  radius_km: 3,
  window_months: 12,
  tracking_since: { kindergarten: '2026-10-14', babycare: '2026-10-14' },
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

/** 在籍學生（2026-10-15 規格 §5）：義華 5 位；第一格兩位（小班、中班），一位只對到里（小班）。 */
export function areaEnrolled(changes: Partial<AreaEnrolled> = {}): AreaEnrolled {
  const zero = { 幼幼班: 0, 小班: 0, 中班: 0, 大班: 0, 其他: 0 }
  return {
    status: 'ready',
    roster_date: '2026-10-15',
    school_year: 115,
    doorplate_version: '115-10',
    imported_at: '2026-10-15T08:00:00Z',
    total: 5,
    grades: [
      { grade: '幼幼班', total: 1, placed: 1 },
      { grade: '小班', total: 2, placed: 1 },
      { grade: '中班', total: 1, placed: 1 },
      { grade: '大班', total: 1, placed: 1 },
    ],
    points: [
      { lat: 22.642, lng: 120.344, counts: { ...zero, 小班: 1, 中班: 1 } },
      { lat: 22.65, lng: 120.35, counts: { ...zero, 幼幼班: 1 } },
      { lat: 22.7, lng: 120.3, counts: { ...zero, 大班: 1 } },
    ],
    unplaced: [{ reason: 'street', counts: { ...zero, 小班: 1 } }],
    distance_bands: [
      { band: '0-1', counts: { ...zero, 小班: 1, 中班: 1 } },
      { band: '1-3', counts: { ...zero, 幼幼班: 1 } },
      { band: '3-6', counts: { ...zero } },
      { band: '6+', counts: { ...zero, 大班: 1 } },
      { band: 'none', counts: { ...zero, 小班: 1 } },
    ],
    villages: [
      { district: '三民區', village: '本揚里', village_code: '64000050015', counts: { ...zero, 小班: 2, 中班: 1 }, total: 3 },
      { district: '三民區', village: '寶業里', village_code: '64000050025', counts: { ...zero, 幼幼班: 1 }, total: 1 },
      { district: '左營區', village: '新上里', village_code: '64000030020', counts: { ...zero, 大班: 1 }, total: 1 },
    ],
    ...changes,
  }
}

export const feeItems = (changes: Partial<AreaFeeItems> = {}): AreaFeeItems => ({
  tuition: null, misc_fee: null, materials: null, activities: null, lunch: null, snack: null, after_care_monthly: null, ...changes,
})

export const peerFeeSchool = (changes: Partial<AreaPeerFeeSchool> = {}): AreaPeerFeeSchool => ({
  source_id: 'kg-private', name: '高雄市私立小樹幼兒園', kind: 'private', distance_m: 420, is_own: false,
  semester_total: 75000, monthly_average: 13636, items: feeItems({ tuition: 15000 }), transport_note: null, ...changes,
})

/** 和 areaKindergartens() 同一批園所（kg-own、kg-public、kg-quasi 有收費，kg-nonprofit 沒有），再加三所私立同業。 */
export const areaPeerFees = (changes: Partial<AreaPeerFees> = {}): AreaPeerFees => ({
  campus: areaStats().campus,
  radius_km: 3,
  age: 3,
  school_year: 114,
  current_school_year: 115,
  synced_at: '2026-10-15T03:00:00Z',
  source_note: '資料來源：全國教保資訊網（kiang 整理），園所公告收費',
  own: {
    source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', semester_total: 89750, months: 5.5, monthly_average: 16318,
    items: feeItems({ tuition: 19900, misc_fee: 5500, materials: 24750, activities: 23100, lunch: 8250, snack: 8250, after_care_monthly: 1200 }),
    transport_note: '單 770 雙 1540',
  },
  own_missing: null,
  groups: [
    { kind: 'private', schools: 4, with_fee: 3, median: 75000, lowest: 40200, highest: 93000, own_rank: 2, rank_total: 4 },
    { kind: 'quasi_public', schools: 1, with_fee: 1, median: null, lowest: 63190, highest: 63190, own_rank: null, rank_total: null },
    { kind: 'public', schools: 1, with_fee: 1, median: null, lowest: 17965, highest: 17965, own_rank: null, rank_total: null },
    { kind: 'nonprofit', schools: 1, with_fee: 0, median: null, lowest: null, highest: null, own_rank: null, rank_total: null },
  ],
  items: [
    { key: 'tuition', own: 19900, peer_median: 15000, peer_count: 3 },
    { key: 'misc_fee', own: 5500, peer_median: 21300, peer_count: 3 },
    { key: 'materials', own: 24750, peer_median: 11000, peer_count: 3 },
    { key: 'activities', own: 23100, peer_median: 9900, peer_count: 3 },
    { key: 'lunch', own: 8250, peer_median: 7500, peer_count: 3 },
    { key: 'snack', own: 8250, peer_median: null, peer_count: 2 },
    { key: 'after_care_monthly', own: 1200, peer_median: 1200, peer_count: 3 },
  ],
  schools: [
    peerFeeSchool({
      source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, is_own: true, semester_total: 89750, monthly_average: 16318,
      items: feeItems({ tuition: 19900, misc_fee: 5500, materials: 24750, activities: 23100, lunch: 8250, snack: 8250, after_care_monthly: 1200 }),
      transport_note: '單 770 雙 1540',
    }),
    peerFeeSchool({ source_id: 'kg-p1', name: '高雄市私立甲幼兒園', distance_m: 300, semester_total: 75000, monthly_average: 13636 }),
    peerFeeSchool({ source_id: 'kg-public', name: '高雄市立大樹幼兒園', kind: 'public', distance_m: 380, semester_total: 17965, monthly_average: 3266 }),
    peerFeeSchool({ source_id: 'kg-p2', name: '高雄市私立乙幼兒園', distance_m: 600, semester_total: 93000, monthly_average: 16909 }),
    peerFeeSchool({ source_id: 'kg-p3', name: '高雄市私立丙幼兒園', distance_m: 900, semester_total: 40200, monthly_average: null }),
    peerFeeSchool({ source_id: 'kg-quasi', name: '高雄市私立小草幼兒園', kind: 'quasi_public', distance_m: 950, semester_total: 63190, monthly_average: 11489 }),
    peerFeeSchool({ source_id: 'kg-p4', name: '高雄市私立丁幼兒園', distance_m: 1200, semester_total: null, monthly_average: null, items: feeItems() }),
  ],
  ...changes,
})
