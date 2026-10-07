// 2026-10-05 後台第九輪 UI/UX：接待流程（列表直接標記到場、明細改期先收起、手機聯絡紀錄提前）、
// 減噪（頁首說明收起、空白舊欄位不列、總覽恆 0 的兩格、篩選收合與已套用條件、分頁數字中性色）、
// 內容編輯「存草稿並預覽」、字級 token、不用彩色側條與 layout 動畫、危險動作收進「更多」。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import PageHeader from '../components/PageHeader.vue'
import UserActions from '../components/UserActions.vue'
import ContentEditor from '../components/ContentEditor.vue'
import detailSource from '../views/VisitDetailView.vue?raw'
import { api, ApiError } from '../api/client'
import { attendanceDue } from '../composables/visitAttendance'
import type { ContentEditorState } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const SRC = join(__dirname, '..')
function styleFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : styleFiles(path)
    return /\.(vue|css)$/.test(entry.name) ? [path] : []
  })
}
function offenders(pattern: RegExp): string[] {
  return styleFiles().flatMap(file => {
    const lines = readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, index) => (pattern.test(line) ? [`${relative(SRC, file)}:${index + 1} ${line.trim()}`] : []))
  })
}

// ---------------------------------------------------------------------------
// 視覺系統守門
// ---------------------------------------------------------------------------

describe('字級只用 style.css 的十級 token', () => {
  it('token 定義在 :root，從 12 到 28', () => {
    const css = readFileSync(join(SRC, 'style.css'), 'utf8')
    const sizes = [...css.matchAll(/--text-([\w]+):\s*(\d+)px;/g)].map(m => Number(m[2]))
    expect(sizes).toEqual([12, 13, 14, 15, 16, 18, 20, 22, 24, 28])
  })

  it('元件與頁面不直接寫 px 字級（自訂屬性 --el-font-size-base 這種不算）', () => {
    expect(offenders(/(?<![-\w])font-size:\s*\d+(\.\d+)?px/)).toEqual([])
  })
})

describe('不用彩色側條、不動畫 layout 屬性', () => {
  it('沒有 2px 以上的彩色左右邊框或 inset 側條（灰色 --line 結構線與 currentColor 三角形不算）', () => {
    expect(offenders(/border-(left|right|inline-start|inline-end):\s*([2-9]|\d{2,})px\s+solid\s+var\(--(?!line)/)).toEqual([])
    expect(offenders(/box-shadow:\s*inset\s+-?[2-9]px\s+0\s+0/)).toEqual([])
  })

  it('transition 不碰 width／height', () => {
    expect(offenders(/transition:[^;]*\b(width|height|max-height)\b/)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 頁首說明收起
// ---------------------------------------------------------------------------

describe('頁首說明：一句話＋可展開的說明', () => {
  it('more 預設收起，按「說明」才展開，aria-expanded 跟著變', async () => {
    const wrapper = mount(PageHeader, { props: { lead: '每一筆參觀預約。', more: '家長在官網選好場次送出，就是預約成功。' }, attachTo: document.body })
    wrappers.push(wrapper)
    const toggle = wrapper.get('.page-header__more-toggle')
    expect(toggle.text()).toBe('說明')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.page-header__more').isVisible()).toBe(false)
    expect(toggle.attributes('aria-controls')).toBe(wrapper.get('.page-header__more').attributes('id'))

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.text()).toBe('收起說明')
    expect(wrapper.get('.page-header__more').isVisible()).toBe(true)
  })

  it('沒有 more 就沒有「說明」鈕', () => {
    const wrapper = mount(PageHeader, { props: { lead: '只有一句。' } })
    wrappers.push(wrapper)
    expect(wrapper.find('.page-header__more-toggle').exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 案件明細
// ---------------------------------------------------------------------------

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const visitCase = (extra: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: '小安',
  child_birthdate: '2022-05-01', email: 'p@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  party_size: null, consent_given: false, consent_revision_id: null, consent_accepted_at: null,
  slot_id: future.id, slot: future, created_at: '2026-10-05T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  confirmed_at: '2026-10-05T00:00:00Z', cancelled_at: null, source: 'web', display_status: 'upcoming',
  history: [], pending_reschedule: null, access_link: null, version: 1, ...extra,
})

async function mountDetail(data: Record<string, unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    const url = String(path)
    if (url.endsWith('/contact-notes')) return [] as never
    if (url.startsWith('/admin/booking-config/')) return { parent_email_enabled: false } as never
    if (url.startsWith('/admin/slots') || url.startsWith('/admin/visit-requests?') || url.startsWith('/admin/visit-staff')) return [] as never
    return data as never
  })
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/case-a'); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const rowLabels = (wrapper: VueWrapper) => wrapper.findAll('.case-facts dt').map(cell => cell.text())

describe('案件明細：官網已不問的欄位只有舊資料才列', () => {
  it('新案件不列參觀人數、想了解的事、同意紀錄（不再固定出現「未填寫」「不需勾選同意」）', async () => {
    const wrapper = await mountDetail(visitCase())
    const labels = rowLabels(wrapper)
    expect(labels).not.toContain('參觀人數')
    expect(labels).not.toContain('想了解的事')
    expect(labels).not.toContain('同意紀錄')
    expect(wrapper.text()).not.toContain('官網預約不需勾選同意')
    expect(labels).toEqual(expect.arrayContaining(['電話', '孩子', 'Email', '得知管道']))
  })

  it('舊案件或補登有填的照樣列出', async () => {
    const wrapper = await mountDetail(visitCase({ party_size: 3, questions: '想看戶外空間', consent_given: true, consent_accepted_at: '2026-09-20T02:00:00Z' }))
    const labels = rowLabels(wrapper)
    expect(labels).toEqual(expect.arrayContaining(['參觀人數', '想了解的事', '同意紀錄']))
    expect(wrapper.text()).toContain('3 位')
    expect(wrapper.text()).toContain('想看戶外空間')
  })
})

describe('案件明細：改期一律先收成連結', () => {
  it('還沒開始的場次也收起來，點了才展開，說明不寫系統用語', async () => {
    const wrapper = await mountDetail(visitCase())
    const actions = wrapper.get('.detail__actions')
    expect(actions.find('.reschedule__title').exists()).toBe(false)
    expect(actions.get('.reschedule--collapsed').text()).toBe('改到其他場次…')
    await actions.get('.reschedule__toggle').trigger('click')
    await flushPromises()
    expect(wrapper.get('.reschedule__title').text()).toBe('改期（換場次）')
    expect(wrapper.text()).toContain('改好後原場次的名額會空出來；新場次剛好額滿的話不會改。')
    expect(wrapper.text()).not.toContain('在同一步釋出')
  })

  it('1100px 以下一欄：聯絡紀錄排在家長資料前面（家庭版面的聯絡紀錄沿用同一個 class）', () => {
    const narrow = detailSource.slice(detailSource.indexOf('@media (max-width: 1100px)'))
    expect(narrow).toMatch(/\.detail__main,\s*\.detail__side \{\s*display: contents;/)
    expect(narrow).not.toContain('.detail__after')
    expect(narrow).toMatch(/\.detail__notes \{\s*order: 3;/)
    expect(detailSource).toContain('<VisitCaseTimeline')
  })
})

// ---------------------------------------------------------------------------
// 案件列表
// ---------------------------------------------------------------------------

const listRow = (extra: Record<string, unknown> = {}) => visitCase({ id: 'r1', slot: started, slot_id: started.id, display_status: 'past', ...extra })

async function mountList(path: string, rows: unknown[], options: { user?: UserOut; counts?: Record<string, number>; admissions?: boolean } = {}) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
    (url.startsWith('/admin/visit-requests/group-counts') ? options.counts ?? {} : url.startsWith('/admin/visit-requests') ? rows : []) as never)
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = options.user ?? testUser('super_admin', { id: 'me', campus_keys: [] })
  auth.features = { admissions: Boolean(options.admissions), password_reset_email: false }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path); await router.isReady()
  const wrapper = mount(VisitRequestsView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, get }
}

describe('案件列表：直接標記到場', () => {
  it('只有預約正常、場次已開始的才出現「到了／沒來」', () => {
    expect(attendanceDue({ status: 'confirmed', parent_name: 'a', slot: started as never }, Date.now())).toBe(true)
    expect(attendanceDue({ status: 'confirmed', parent_name: 'a', slot: future as never }, Date.now())).toBe(false)
    expect(attendanceDue({ status: 'completed', parent_name: 'a', slot: started as never }, Date.now())).toBe(false)
    expect(attendanceDue({ status: 'confirmed', parent_name: 'a', slot: null }, Date.now())).toBe(false)
  })

  it('按「到了」先確認（寫出家長與場次），確定才送出，之後重讀列表', async () => {
    const { wrapper, get } = await mountList('/visit-requests', [listRow(), listRow({ id: 'r2', parent_name: '陳小姐', slot: future, slot_id: future.id, display_status: 'upcoming' })])
    const groups = wrapper.findAll('.requests-table .attendance-actions')
    expect(groups).toHaveLength(1)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const callsBefore = get.mock.calls.length
    await groups[0]!.findAll('button').find(b => b.text() === '到了')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('黃志明')
    expect(confirm.mock.calls[0]![1]).toBe('標記已到場？')
    expect(String(confirm.mock.calls[0]![0])).not.toContain('招生訪視')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/r1/complete')
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('招生入學開著時，確認框講明會建立招生訪視；「沒來」走 no-show', async () => {
    const { wrapper } = await mountList('/visit-requests', [listRow()], { admissions: true })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const buttons = wrapper.get('.requests-table .attendance-actions').findAll('button')
    await buttons.find(b => b.text() === '到了')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('會同時建立一筆招生訪視')
    await buttons.find(b => b.text() === '沒來')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[1]![1]).toBe('標記為未到場？')
    expect(post).toHaveBeenLastCalledWith('/admin/visit-requests/r1/no-show')
  })

  it('按「先不要」不送出；同事剛處理過時講明並重讀', async () => {
    const { wrapper } = await mountList('/visit-requests', [listRow()])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'INVALID_TRANSITION', message: '狀態不對' }))
    const arrive = () => wrapper.get('.requests-table .attendance-actions').findAll('button').find(b => b.text() === '到了')!
    await arrive().trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValue('confirm' as never)
    await arrive().trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('黃志明 這筆剛被其他人處理過，列表已更新')
  })

  it('唯讀帳號看不到按鈕', async () => {
    const { wrapper } = await mountList('/visit-requests', [listRow()], { user: testUser('readonly', { campus_keys: ['yihua'] }) })
    expect(wrapper.find('.attendance-actions').exists()).toBe(false)
  })
})

describe('案件列表：篩選收合、已套用條件、分頁數字', () => {
  it('從總覽帶 ?due=1 進來：更多篩選收著，條件列成可以拿掉的標籤', async () => {
    const { wrapper, router } = await mountList('/visit-requests?due=1&order=oldest', [])
    expect(wrapper.get('.requests-filters').classes()).not.toContain('is-open')
    expect(wrapper.get('.more-filters').text()).toContain('2')
    const chips = wrapper.findAll('.filter-chip')
    expect(chips.map(chip => chip.text().replace(/×.*$/, ''))).toEqual(['到期待追蹤', '最早送出在前'])
    await chips[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.due).toBeUndefined()
    expect(wrapper.findAll('.filter-chip')).toHaveLength(1)
  })

  it('展開更多篩選時不重複列標籤', async () => {
    const { wrapper } = await mountList('/visit-requests?due=1', [])
    await wrapper.get('.more-filters').trigger('click')
    expect(wrapper.get('.requests-filters').classes()).toContain('is-open')
    expect(wrapper.find('.filter-chips').exists()).toBe(false)
  })

  it('多校帳號的校區常駐在外面，不算進更多篩選', async () => {
    const { wrapper } = await mountList('/visit-requests?campus=yihua', [])
    expect(wrapper.find('.filter-field--campus').exists()).toBe(true)
    expect(wrapper.find('.filter-chip').exists()).toBe(false)
    expect(wrapper.get('.more-filters').text()).not.toMatch(/\d/)
  })

  it('分頁數字是件數不是待辦：沒有「待處理」頁籤，也沒有暖黃計數樣式', async () => {
    const { wrapper } = await mountList('/visit-requests', [], { counts: { upcoming: 4, past: 2, cancelled: 3 } })
    const groups = wrapper.findAll('.status-tab').map(tab => tab.attributes('data-group'))
    expect(groups).toEqual(['all', 'upcoming', 'past', 'cancelled'])
    // 頁籤的基本樣式（中性灰計數）在 style.css，案件列表與站內通知共用；案件列表不再有暖黃計數。
    const shared = readFileSync(join(SRC, 'style.css'), 'utf8')
    expect(shared).toMatch(/\.status-tab__count \{[^}]*background: var\(--surface-3\)/)
    const source = readFileSync(join(SRC, 'views/VisitRequestsView.vue'), 'utf8')
    expect(source).not.toContain("data-group='pending'")
  })

  it('面板標題寫目前看的是哪一組，不重複頁名', async () => {
    const { wrapper } = await mountList('/visit-requests?group=cancelled', [])
    expect(wrapper.get('.panel__head h2').text()).toBe('已取消')
  })
})

// ---------------------------------------------------------------------------
// 總覽
// ---------------------------------------------------------------------------

const summary = (changes = {}) => ({
  today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [],
  failed_notifications: 0, ...changes,
})

async function mountDashboard(data: object) {
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/admin/dashboard' ? data : []) as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/'); await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper); await flushPromises()
  return wrapper
}

describe('總覽：舊案兩格已拿掉（2026-10-06 起連兩格大數字都沒有，改成今天的參觀當主體）', () => {
  it('自選場次之後恆為 0：沒有營運摘要格', async () => {
    const wrapper = await mountDashboard(summary())
    expect(wrapper.find('.dash__summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('新需求待聯絡')
    expect(wrapper.text()).not.toContain('待園方確認')
  })

  it('今天的名單：場次開始後才有「到了／沒來」，按了先確認、送出後重讀彙總', async () => {
    // 固定在台北中午，名單的「進行中／已結束」不會因為跑測試的時間不同而變。
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-05T12:00:00+08:00').getTime())
    const list = [
      { id: 'v-ended', parent_name: '王媽媽', campus_key: 'yihua', start_time: '09:00:00', end_time: '10:00:00' },
      { id: 'v-later', parent_name: '林爸爸', campus_key: 'yihua', start_time: '15:00:00', end_time: '16:00:00' },
    ]
    const wrapper = await mountDashboard(summary({ today_visits: 2, today_visit_list: list }))
    const rows = wrapper.findAll('.today li.today__row')
    expect(rows[0]!.find('.today__attendance').exists()).toBe(true)
    expect(rows[1]!.find('.today__attendance').exists()).toBe(false)
    // 按鈕不在連結裡面（互動元素不能巢狀）。
    expect(rows[0]!.find('a .today__attendance').exists()).toBe(false)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const get = vi.mocked(api.get)
    const before = get.mock.calls.filter(([path]) => path === '/admin/dashboard').length
    await rows[0]!.findAll('button').find(b => b.text() === '沒來')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('王媽媽')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/v-ended/no-show')
    expect(get.mock.calls.filter(([path]) => path === '/admin/dashboard').length).toBeGreaterThan(before)
  })

  it('即使舊版 API 還帶舊案數字，也不會多出「新需求待聯絡」「待園方確認」兩格或暖色提醒', async () => {
    const wrapper = await mountDashboard(summary({ new_requests: 2, awaiting_confirmation: 1 }))
    expect(wrapper.find('.dash__summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('新需求待聯絡')
    expect(wrapper.text()).not.toContain('待園方確認')
    expect(wrapper.find('.is-attention').exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 使用者列表的危險動作
// ---------------------------------------------------------------------------

describe('使用者列表：停用與解除綁定收進「更多」', () => {
  const other = (extra: Partial<UserOut> = {}) => testUser('reception', { id: 'u2', email: 'amy@ivy.example', display_name: '櫃台小美', campus_keys: ['yihua'], is_active: true, ...extra })

  function mountActions(user: UserOut) {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
    const wrapper = mount(UserActions, { props: { user, self: false, busy: false, pending: false }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    return wrapper
  }

  it('列上只有角色與校區、重設密碼、更多；不再有紅色「停用」鈕', () => {
    const wrapper = mountActions(other())
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['角色與校區', '重設密碼', '更多'])
    expect(wrapper.findAll('.el-button--danger')).toHaveLength(0)
  })

  it('選「停用帳號」先確認（危險色、不預設聚焦），確定才 emit', async () => {
    const wrapper = mountActions(other())
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'deactivate')
    await flushPromises()
    expect(confirm.mock.calls[0]![1]).toBe('停用這個帳號？')
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonClass: 'el-button--danger', autofocus: false, cancelButtonText: '先不要' })
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('按「先不要」不 emit；停用中的帳號直接給「恢復」', async () => {
    const wrapper = mountActions(other())
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'clearLogins')
    await flushPromises()
    expect(wrapper.emitted('clearLogins')).toBeUndefined()

    const inactive = mountActions(other({ is_active: false }))
    expect(inactive.findAll('button').map(b => b.text())).toEqual(['角色與校區', '重設密碼', '恢復'])
  })
})

// ---------------------------------------------------------------------------
// 內容編輯：存草稿並預覽
// ---------------------------------------------------------------------------

describe('內容編輯：有修改時一鍵存草稿並預覽', () => {
  async function mountEditor(overrides: Partial<ContentEditorState>) {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/content/home-hero'); await router.isReady()
    const editor: ContentEditorState = {
      loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(true),
      isDirty: computed(() => true), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-05T02:00:00Z'),
      previewUrl: computed(() => 'https://example.test/preview?page=home'), publicUrl: computed(() => 'https://example.test/'),
      load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
      ...overrides,
    }
    const wrapper = mount(ContentEditor, { props: { editor }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    return wrapper
  }

  it('已上線的內容改了之後：官網連結旁多一顆「存草稿並預覽」，不再並列改之前的草稿預覽', async () => {
    const wrapper = await mountEditor({})
    const tools = wrapper.get('.editor__tools')
    expect(tools.findAll('a').map(a => a.text())).toEqual(['查看官網此頁 ↗'])
    expect(tools.get('.editor__save-preview').text()).toBe('存草稿並預覽 ↗')
  })

  it('點擊當下先開分頁（不被擋），存好換成預覽頁；存不成功就關掉分頁', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as never)
    const save = vi.fn(async () => true)
    const wrapper = await mountEditor({ save })
    await wrapper.get('.editor__save-preview').trigger('click')
    await flushPromises()
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(save).toHaveBeenCalledWith({ silent: true })
    expect(tab.location.href).toBe('https://example.test/preview?page=home')

    const failedTab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    open.mockReturnValue(failedTab as never)
    const failing = await mountEditor({ save: async () => false })
    await failing.get('.editor__save-preview').trigger('click')
    await flushPromises()
    expect(failedTab.close).toHaveBeenCalled()
    expect(failedTab.location.href).toBe('')
  })

  it('沒有修改、草稿還沒發布時照舊給「預覽草稿」與「手機版」', async () => {
    const wrapper = await mountEditor({ isDirty: computed(() => false), isPublished: ref(false) })
    expect(wrapper.find('.editor__save-preview').exists()).toBe(false)
    expect(wrapper.get('.editor__tools').findAll('a').map(a => a.text())).toEqual(['預覽草稿 ↗', '手機版 ↗'])
  })
})
