// 國定假日匯入、停班停課（2026-10-14 規格 §2、§3）：接待月曆的兩個對話框、休假日面板的
// 「寄停課通知」、操作紀錄搜尋詞展開。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, type Component } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import ClosureDialog from '../components/sessions/ClosureDialog.vue'
import HolidayImportDialog from '../components/sessions/HolidayImportDialog.vue'
import { api, ApiError } from '../api/client'
import { AUDIT_SEARCH_MAX_TERMS, auditSearchTerms } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T09:00:00+08:00'))
})
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const closureRow = (changes: Record<string, unknown> = {}) => ({
  campus_key: 'yihua', already_closed: false, closed_slots: 2, confirmed_requests: 3, with_email: 2,
  notified: 2, already_notified: 0, no_email: 1, ...changes,
})
const closureOut = (dryRun: boolean, rows = [closureRow()], email = true) => ({
  dry_run: dryRun, closure_date: '2026-10-14', parent_email_enabled: email, campuses: rows,
})

function mountDialog(component: Component, props: Record<string, unknown>) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  // 兩個對話框的 props 不同，這裡共用一個掛載函式，props 型別交給各測試自己帶對。
  const wrapper = mount(component, {
    props: { modelValue: true, 'onUpdate:modelValue': () => {}, ...props } as never,
    global: { plugins: [ElementPlus, router] },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (test: string) => document.body.querySelector<HTMLButtonElement>(`[data-test="${test}"]`)!

describe('停班停課對話框', () => {
  it('打開就試算（dry run），列出每校會關幾場、會寄給幾位、幾位要來電；確認後才真的送出', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => closureOut((body as { dry_run: boolean }).dry_run) as never)
    const wrapper = mountDialog(ClosureDialog, { campusKeys: ['yihua', 'renwu'], defaultCampus: 'yihua' })
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/admin/visit-closures', {
      closure_date: '2026-10-14', campus_keys: ['yihua'], reason: '颱風停班停課', notify_parents: true, dry_run: true,
    })
    expect(bodyText()).toContain('義華：關閉 2 場；已約 3 組，會寄停課通知給 2 位，1 位沒有 Email 要來電')

    bodyButton('closure-submit').click()
    await flushPromises()
    expect(post.mock.calls.at(-1)![1]).toMatchObject({ dry_run: false, reason: '颱風停班停課', notify_parents: true })
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(bodyText()).toContain('已停課')
    expect(bodyText()).toContain('寄出 2 封停課通知')
    expect(bodyText()).toContain('還有 1 位家長要來電通知')
    expect(document.body.querySelector('a[href="/visit-requests?attention=1"]')).not.toBeNull()
  })

  it('正式站沒設寄信：不能勾寄信，有 Email 的也算進要來電', async () => {
    vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) =>
      closureOut((body as { dry_run: boolean }).dry_run, [closureRow({ notified: 0 })], false) as never)
    mountDialog(ClosureDialog, { campusKeys: ['yihua'], defaultCampus: 'yihua' })
    await flushPromises()
    expect(document.body.querySelector('[data-test="closure-notify"] input')!.hasAttribute('disabled')).toBe(true)
    expect(bodyText()).toContain('正式站還沒設定寄信')
    expect(bodyText()).toContain('2 位有 Email，但這次不寄信')
    bodyButton('closure-submit').click()
    await flushPromises()
    expect(bodyText()).toContain('還有 3 位家長要來電通知')
  })

  it('沒填原因不能送出；管多校的人可以勾好幾校', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => closureOut((body as { dry_run: boolean }).dry_run) as never)
    mountDialog(ClosureDialog, { campusKeys: ['yihua', 'renwu'], defaultCampus: 'yihua' })
    await flushPromises()
    expect(document.body.querySelector('[data-test="closure-campuses"]')).not.toBeNull()
    const reason = document.body.querySelector<HTMLInputElement>('input[data-test="closure-reason"], [data-test="closure-reason"] input')!
    reason.value = '  '
    reason.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(bodyButton('closure-submit').disabled).toBe(true)
    expect(bodyText()).toContain('還不能送出：請填原因')
    const calls = post.mock.calls.length
    bodyButton('closure-submit').click()
    await flushPromises()
    expect(post.mock.calls.length).toBe(calls)
  })

  it('從某一天補寄：日期固定、只有那一校，原因帶那天的休假原因', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => closureOut((body as { dry_run: boolean }).dry_run, [closureRow({ already_closed: true, closed_slots: 0 })]) as never)
    mountDialog(ClosureDialog, { campusKeys: ['yihua', 'renwu'], defaultCampus: 'yihua', fixed: { date: '2026-10-20', campus: 'yihua', reason: '教師研習' } })
    await flushPromises()
    expect(post.mock.calls[0]![1]).toMatchObject({ closure_date: '2026-10-20', campus_keys: ['yihua'], reason: '教師研習' })
    expect(document.body.querySelector('[data-test="closure-campuses"]')).toBeNull()
    expect(bodyText()).toContain('這天已經是休假日；沒有開放中的場次')
    expect(bodyButton('closure-submit').textContent).toContain('寄停課通知')
  })
})

describe('匯入國定假日對話框', () => {
  const calendar = {
    source: 'open_data', source_label: '116年中華民國政府行政機關辦公日曆表', years: [2027],
    holidays: [
      { date: '2026-10-09', name: '補假', weekday: 4 },
      { date: '2027-01-01', name: '開國紀念日', weekday: 4 },
      { date: '2027-02-08', name: '春節', weekday: 0 },
    ],
  }
  const applyOut = (dryRun: boolean) => ({
    dry_run: dryRun, skipped_past: 0,
    campuses: [{ campus_key: 'yihua', created: 2, skipped_existing: 0, skipped_weekend: 0, affected_requests: 1, affected_dates: ['2027-01-01'] }],
  })

  it('下載明年的辦公日曆、預設勾今天以後的日子、試算後套用', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body: unknown) =>
      (path.endsWith('/fetch') ? calendar : applyOut((body as { dry_run: boolean }).dry_run)) as never)
    const wrapper = mountDialog(HolidayImportDialog, { campusKeys: ['yihua'], defaultCampus: 'yihua' })
    await flushPromises()
    bodyButton('holiday-fetch').click()
    await flushPromises()

    expect(post.mock.calls[0]).toEqual(['/admin/holiday-calendar/fetch', { year: 2027 }])
    expect(bodyText()).toContain('已讀取：116年中華民國政府行政機關辦公日曆表（3 天假日，今天以後 2 天）')
    // 已過的日子不能勾、不送。
    const dryRun = post.mock.calls.find(call => call[0] === '/admin/holiday-calendar/apply')!
    expect(dryRun[1]).toEqual({
      campus_keys: ['yihua'],
      holidays: [{ date: '2027-01-01', name: '開國紀念日' }, { date: '2027-02-08', name: '春節' }],
      dry_run: true,
    })
    expect(bodyText()).toContain('義華：會新增 2 天休假日；2027/01/01 已有 1 組預約，要通知家長改約')

    bodyButton('holiday-apply').click()
    await flushPromises()
    expect(post.mock.calls.at(-1)![1]).toMatchObject({ dry_run: false })
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(bodyText()).toContain('已套用國定假日')
    expect(bodyText()).toContain('用「寄停課通知」請家長改約')
  })

  it('連不到開放平台就說明去哪裡下載、改用上傳；上傳的檔案送到解析', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(502, { code: 'HOLIDAY_SOURCE_UNAVAILABLE', message: '連不到政府資料開放平台，請改用上傳檔案' }))
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({ ...calendar, source: 'upload', source_label: '116.csv' } as never)
    mountDialog(HolidayImportDialog, { campusKeys: ['yihua'], defaultCampus: 'yihua' })
    await flushPromises()
    bodyButton('holiday-fetch').click()
    await flushPromises()
    expect(bodyText()).toContain('搜尋「行政機關辦公日曆表」')
    expect(bodyText()).toContain('不是 Google 行事曆專用的那份')

    const input = document.body.querySelector<HTMLInputElement>('[data-test="holiday-file"]')!
    const file = new File(['西元日期,星期,是否放假,備註'], '116.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0]![0]).toBe('/admin/holiday-calendar/parse')
    expect((upload.mock.calls[0]![1] as FormData).get('file')).toBeInstanceOf(File)
    expect(bodyText()).toContain('已讀取：116.csv')
  })
})

describe('接待月曆接上兩個對話框與「寄停課通知」', () => {
  const slot = (changes: Record<string, unknown> = {}) => ({
    id: 's1', campus_key: 'yihua', slot_date: '2026-10-20', start_time: '10:00:00', end_time: '11:00:00',
    capacity: 2, closed: true, closed_source: 'exception', version: 1, booked_count: 1,
    visits: [{ id: 'v1', status: 'confirmed', parent_name: '王媽媽', child_name: null, phone: '0911222333', source: 'web' }], ...changes,
  })

  async function mountPage(role: 'campus_admin' | 'reception' = 'campus_admin') {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-calendar')) return [slot()] as never
      if (path.startsWith('/admin/visit-schedule')) return { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [{ id: 'e1', exception_date: '2026-10-20', reason: '颱風停班停課' }], version: 1 } as never
      if (path.startsWith('/admin/booking-config')) return { mode: 'slots', version: 1, parent_email_enabled: true } as never
      return [] as never
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => closureOut((body as { dry_run: boolean }).dry_run) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser(role, { id: 'u', email: 'u@example.invalid', campus_keys: ['yihua'] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-calendar?campus=yihua'); await router.isReady()
    const wrapper = mount(VisitCalendarView, {
      global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, post }
  }

  it('校區管理者看得到「停班停課」「匯入國定假日」；櫃台看不到', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.find('[data-test="open-closure"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="open-holiday-import"]').exists()).toBe(true)
    wrappers.pop()!.unmount()
    const desk = await mountPage('reception')
    expect(desk.wrapper.find('[data-test="open-closure"]').exists()).toBe(false)
  })

  it('休假日還有已約的家長：面板有「寄停課通知（N 組）」，打開的對話框日期與校區固定', async () => {
    const { wrapper, post } = await mountPage()
    await wrapper.findAll('.calendar__day').find(b => (b.attributes('aria-label') ?? '').startsWith('2026/10/20'))!.trigger('click')
    await flushPromises()
    const notify = wrapper.get('[data-test="day-closure-notify"]')
    expect(notify.text()).toBe('寄停課通知（1 組）')
    await notify.trigger('click')
    await flushPromises()
    expect(post.mock.calls.at(-1)).toEqual(['/admin/visit-closures', {
      closure_date: '2026-10-20', campus_keys: ['yihua'], reason: '颱風停班停課', notify_parents: true, dry_run: true,
    }])
  })
})

describe('操作紀錄搜尋詞展開', () => {
  it('原字在第一個，加上名稱含這個字的代碼', () => {
    const terms = auditSearchTerms(' 休假 ')
    expect(terms[0]).toBe('休假')
    expect(terms).toEqual(expect.arrayContaining(['visit_exception.create', 'visit_exception.delete']))
    expect(auditSearchTerms('停班停課')).toEqual(expect.arrayContaining(['停班停課', 'visit_closure.create']))
    expect(auditSearchTerms('義華')).toEqual(['義華', 'yihua'])
  })

  it('空白回空陣列；最多 30 個詞', () => {
    expect(auditSearchTerms('   ')).toEqual([])
    expect(auditSearchTerms('的').length).toBeLessThanOrEqual(AUDIT_SEARCH_MAX_TERMS)
  })
})
