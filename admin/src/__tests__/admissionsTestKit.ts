// 招生入學測試共用：掛載（memory router＋Pinia＋Element Plus）、依路徑前綴 mock api、
// 假資料工廠。檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
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
  child_name: '王小安', birthday: '2023-03-02', grade: '小班', phone: '0912345678', contact_name: '王媽媽', address: null,
  district: null, source: '親友介紹', referrer: null, deposit_collector: null, tour_guide_user_id: null, tour_guide_name: null,
  source_category: null, has_deposit: false, rides_bus: false, notes: null, parent_response: null, geocoding_consent_at: null,
  no_deposit_reason: null, no_deposit_reason_detail: null, enrolled: false, enrolled_on: null, transfer_term: false,
  provisional_grade: null, target_school_year: 115, target_semester: 1, withdrawn_at: null, withdrawn_from: null,
  withdraw_reason: null, version: 1, created_at: '2026-09-08T02:00:00Z', updated_at: '2026-09-08T02:00:00Z',
  stage: 'visited', has_visit_request: false, anonymized_at: null, ...changes,
})

export const card = (changes: Record<string, unknown> = {}) => ({
  id: 'v-1', child_name: '王小安', grade: '小班', provisional_grade: null, target_school_year: 115, target_semester: 1,
  visit_date: '2026-09-08', has_visit_request: false, withdrawn_from: null, version: 1, ...changes,
})

type StageKey = 'visited' | 'deposited' | 'enrolled' | 'withdrawn'
export const board = (columns: Partial<Record<StageKey, unknown[]>> = {}, extra: Record<string, unknown> = {}) => ({
  columns: { visited: [], deposited: [], enrolled: [], withdrawn: [], ...columns },
  unscoped_count: 0, school_year: 115, semester: null, campus_key: 'yihua', as_of: '2026-10-01T02:00:00Z', ...extra,
})

export const intakeRow = (grade: string, changes: Record<string, unknown> = {}) => ({
  grade, target_seats: null, reserved: 0, enrolled: 0, remaining: null, over_capacity: false, ...changes,
})
export const intakePlan = (rows: unknown[] = ['幼幼班', '小班', '中班', '大班'].map((grade) => intakeRow(grade)), totals: Record<string, unknown> = {}) => ({
  school_year: 115, semester: 1, campus_key: 'yihua', as_of: '2026-10-01T02:00:00Z', rows,
  totals: { target_seats: null, reserved: 0, enrolled: 0, remaining: null, ...totals },
})

export const arrivalRow = (changes: Record<string, unknown> = {}) => ({
  visit_request_id: VR_ID, slot_date: '2026-09-26', start_time: '10:00:00', parent_name: '陳媽媽', child_name: '陳小寶',
  party_size: 2, status: 'confirmed', ...changes,
})

/** 官網預約清單；total 預設等於清單長度（後端清單最多 200 筆，total 可更大）。 */
export const arrivals = (awaiting: unknown[] = [], missing: unknown[] = [], totals: { awaiting_total?: number; missing_total?: number } = {}) => ({
  awaiting, missing, awaiting_total: totals.awaiting_total ?? awaiting.length, missing_total: totals.missing_total ?? missing.length,
})

export const options = () => ({ months: ['115.09', '115.08'], sources: ['親友介紹', 'Facebook'], referrers: ['林老師'] })
