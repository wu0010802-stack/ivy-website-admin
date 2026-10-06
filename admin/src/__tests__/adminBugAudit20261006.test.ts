// 2026-10-06 後台 bug 稽核（前端）：預約與總覽（第 1–8 條）。
// 招生入學、內容編輯、素材與帳號管理另見 adminBugAudit20261006*.test.ts。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import DayPanel from '../components/sessions/DayPanel.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { ApiError, api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { LineSettingsOut } from '../api/types'
import { authGuard, routes } from '../router'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { deferred } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function makePinia() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  return pinia
}

async function mountRouted(component: unknown, path: string, routePath = '/:pathMatch(.*)*') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: routePath, component: component as never }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    attachTo: document.body,
    global: { plugins: [makePinia(), router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

const visitCase = (changes: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'contacting', parent_name: '王媽媽', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, source: 'web',
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, assigned_staff_id: null,
  follow_up_at: '2099-01-01T02:00:00Z', version: 4, history: [], ...changes,
})

// ------------------------------------------------------------------ 1
describe('1. 案件頁「下次聯絡」背景重讀後同步', () => {
  async function setup() {
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    const server = { current: visitCase() }
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/visit-requests/case-a') return server.current as never
      return [] as never
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper } = await mountRouted(VisitDetailView, '/visit-requests/case-a', '/visit-requests/:id')
    const picker = () => wrapper.findComponent({ name: 'ElDatePicker' })
    // 切回分頁：距上次讀取超過 30 秒才靜默重讀。
    async function comeBack() {
      now.mockReturnValue(start + 31_000)
      window.dispatchEvent(new Event('focus'))
      await flushPromises()
    }
    async function addNote(text: string) {
      await wrapper.find('textarea').setValue(text)
      await wrapper.findAll('button').find((b) => b.text() === '新增紀錄')!.trigger('click')
      await flushPromises()
    }
    return { wrapper, server, post, picker, comeBack, addNote }
  }

  it('同事改了下次聯絡、選擇器沒動：重讀後跟著換成新值，寫紀錄不會把舊值蓋回去', async () => {
    const { server, post, picker, comeBack, addNote } = await setup()
    expect(picker().props('modelValue')).toBe('2099-01-01T10:00:00+08:00')
    server.current = visitCase({ follow_up_at: '2099-02-01T02:00:00Z', version: 5 })
    await comeBack()
    expect(picker().props('modelValue')).toBe('2099-02-01T10:00:00+08:00')
    await addNote('家長說月底再聯絡')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/contact-notes', { note: '家長說月底再聯絡' })
  })

  it('自己改過選擇器、同事也改了：保留自己的選擇，送出帶開始編輯時的版本，讓後端回 409', async () => {
    const { server, post, picker, comeBack, addNote } = await setup()
    picker().vm.$emit('update:modelValue', '2099-03-01T10:00:00+08:00')
    await flushPromises()
    server.current = visitCase({ follow_up_at: '2099-02-01T02:00:00Z', version: 5 })
    await comeBack()
    expect(picker().props('modelValue')).toBe('2099-03-01T10:00:00+08:00')
    await addNote('改到三月')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/contact-notes', {
      note: '改到三月', follow_up_at: '2099-03-01T10:00:00+08:00', expected_version: 4,
    })
  })

  it('自己改過選擇器、同事只改了別的（下次聯絡沒變）：送出帶新版本，不誤判衝突', async () => {
    const { server, post, picker, comeBack, addNote } = await setup()
    picker().vm.$emit('update:modelValue', '2099-03-01T10:00:00+08:00')
    await flushPromises()
    server.current = visitCase({ assigned_staff_id: 'someone', version: 5 })
    await comeBack()
    await addNote('改到三月')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/contact-notes', {
      note: '改到三月', follow_up_at: '2099-03-01T10:00:00+08:00', expected_version: 5,
    })
  })

  it('送出遇到版本衝突：重讀後以最新版本為準，確認後再送一次不會一直 409', async () => {
    const { server, post, picker, addNote } = await setup()
    picker().vm.$emit('update:modelValue', '2099-03-01T10:00:00+08:00')
    await flushPromises()
    server.current = visitCase({ follow_up_at: '2099-02-01T02:00:00Z', version: 5 })
    post.mockRejectedValueOnce(new ApiError(409, { code: 'VISIT_REQUEST_VERSION_CONFLICT', message: '衝突' }))
    await addNote('改到三月')
    await addNote('改到三月')
    expect(post).toHaveBeenLastCalledWith('/admin/visit-requests/case-a/contact-notes', {
      note: '改到三月', follow_up_at: '2099-03-01T10:00:00+08:00', expected_version: 5,
    })
  })
})

// ------------------------------------------------------------------ 2
describe('2. 別的分頁重新登入後，舊分頁按登出', () => {
  function signedIn() {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('super_admin', { id: 'u1', email: 'a@ivy.example' })
    return auth
  }

  it('登出回 403 CSRF token 無效：當成 session 已換，清掉本地狀態，不丟錯', async () => {
    const auth = signedIn()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'CSRF token 無效'))
    await expect(auth.logout()).resolves.toBe('session-changed')
    expect(auth.user).toBeNull()
  })

  it('其他 403 照舊丟錯，留在登入狀態讓人重試', async () => {
    const auth = signedIn()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, '權限不足'))
    await expect(auth.logout()).rejects.toBeInstanceOf(ApiError)
    expect(auth.user).not.toBeNull()
  })

  it('router：導到登入頁並帶 reason=session-changed；那一次不拿 cookie 恢復別人的 session', async () => {
    const auth = signedIn()
    auth.logoutPending = true
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'CSRF token 無效'))
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const router = createRouter({ history: createMemoryHistory(), routes })
    expect(await authGuard(router.resolve('/login') as never)).toEqual({ name: 'login', query: { reason: 'session-changed' }, replace: true })
    expect(auth.user).toBeNull()
    expect(await authGuard(router.resolve('/login?reason=session-changed') as never)).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ 3
describe('3. 「加開一場」防重複送出', () => {
  it('送出中再按一次不會再送；按鈕轉圈', async () => {
    const pending = deferred<unknown>()
    const post = vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const wrapper = mount(DayPanel, {
      props: { day: '2099-01-05', campusKey: 'yihua', slots: [], holiday: null, canManage: true, staff: [] },
      global: { plugins: [ElementPlus], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.findAll('button').find((b) => b.text() === '＋加開一場')!.trigger('click')
    const form = wrapper.get('form.day-panel__add')
    await form.trigger('submit')
    await form.trigger('submit')
    expect(post).toHaveBeenCalledTimes(1)
    const submit = wrapper.findAll('button').find((b) => b.text() === '加開')!
    expect(submit.classes()).toContain('is-loading')
    pending.resolve({})
    await flushPromises()
  })
})

// ------------------------------------------------------------------ 4
describe('4. 接待月曆換校時休假日不被舊回應蓋掉', () => {
  it('義華的休假讀得慢、先換到明華：畫面只有明華的休假', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T09:00:00+08:00'))
    const slow = deferred<unknown>()
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-schedule/yihua')) return slow.promise as never
      if (path.startsWith('/admin/visit-schedule/minghua')) return { exceptions: [{ id: 'm', exception_date: '2026-09-26', reason: '明華研習' }], rules: [] } as never
      if (path.startsWith('/admin/booking-config')) return {} as never
      return [] as never
    })
    const { wrapper } = await mountRouted(VisitCalendarView, '/visit-calendar?campus=yihua')
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    slow.resolve({ exceptions: [{ id: 'y', exception_date: '2026-09-25', reason: '義華研習' }], rules: [] })
    await flushPromises()
    const holidayDays = wrapper.findAll('.calendar__day.is-holiday').map((cell) => cell.attributes('aria-label')?.slice(0, 10))
    expect(holidayDays).toEqual(['2026/09/26'])
  })
})

// ------------------------------------------------------------------ 5
describe('5. 補登對話框快速切校只列最後選的那一校場次', () => {
  it('義華的場次較晚回來也不會出現在明華的選單裡', async () => {
    const slow = deferred<unknown>()
    const slotOf = (id: string, campus: string, start: string) => ({ id, campus_key: campus, slot_date: '2099-10-02', start_time: `${start}:00`, end_time: `${start.slice(0, 2)}:59:00`, capacity: 3, booked_count: 0, closed: false })
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/booking-config/')) return {} as never
      if (path.includes('campus_key=yihua')) return slow.promise as never
      return [slotOf('m1', 'minghua', '14:00')] as never
    })
    const wrapper = mount(ManualVisitDialog, { props: { campusKeys: ['yihua', 'minghua'], modelValue: false }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    slow.resolve([slotOf('y1', 'yihua', '09:00')])
    await flushPromises()
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '選擇場次')!
    expect(select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(['m1'])
  })
})

// ------------------------------------------------------------------ 6
describe('6. 案件頁「下一筆」照列表的「只看未結案」', () => {
  it('列表帶 open=true 時，下一筆的清單也帶 open=true', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/visit-requests/case-a') return visitCase() as never
      return [] as never
    })
    const list = new URLSearchParams({ campus_key: 'yihua', open: 'true' }).toString()
    await mountRouted(VisitDetailView, `/visit-requests/case-a?list=${encodeURIComponent(list)}`, '/visit-requests/:id')
    const listCall = get.mock.calls.map((call) => String(call[0])).find((path) => path.startsWith('/admin/visit-requests?'))!
    expect(new URLSearchParams(listCall.split('?')[1]).get('open')).toBe('true')
  })
})

// ------------------------------------------------------------------ 7
describe('7. 代理回的非 JSON 錯誤本文不直接顯示', () => {
  it('502 的 HTML／英文本文改用 fallback；後端 JSON 的字串 detail 照常顯示', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }) as never)
    const proxyError = await api.get('/admin/media').catch((err: unknown) => err)
    expect(apiErrorMessage(proxyError, '讀取失敗，請稍後再試')).toBe('讀取失敗，請稍後再試')

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ detail: '這個場次已經有人改過' }), { status: 409 }) as never)
    const backendError = await api.get('/admin/slots').catch((err: unknown) => err)
    expect(apiErrorMessage(backendError, '讀取失敗')).toBe('這個場次已經有人改過')
  })
})

// ------------------------------------------------------------------ 8
describe('8. LINE 通知兩校同時改群組', () => {
  const GROUP = `C${'a'.repeat(32)}`
  function settings(targets: LineSettingsOut['targets']): LineSettingsOut {
    return {
      enabled: true,
      webhook_url: 'https://ivy.example/api/website/v1/line/webhook',
      groups: [{ target_id: GROUP, source_type: 'group', name: '校務群', first_seen_at: '2026-09-24T01:00:00Z', last_seen_at: '2026-09-24T01:00:00Z', left_at: null, verified_at: '2026-09-24T01:05:00Z' }],
      targets,
    }
  }

  it('先送出的較晚回來也不會蓋掉另一校剛改好的群組：全部回來後重讀一次', async () => {
    const initial = settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: GROUP }, { campus_key: 'minghua', campus_name: '明華校', target_id: null }])
    const final = settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: null }, { campus_key: 'minghua', campus_name: '明華校', target_id: GROUP }])
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(initial as never).mockResolvedValue(final as never)
    const puts: Record<string, ReturnType<typeof deferred<unknown>>> = { yihua: deferred(), minghua: deferred() }
    vi.spyOn(api, 'put').mockImplementation(async (path: string) => puts[path.split('/').pop()!]!.promise as never)
    const { wrapper } = await mountRouted(LineNotificationsView, '/line-notifications')
    const selects = () => wrapper.findAll('.target-row').map((row) => row.findComponent({ name: 'ElSelect' }))
    selects()[0]!.vm.$emit('change', '')
    selects()[1]!.vm.$emit('change', GROUP)
    await flushPromises()
    // 明華先處理完；義華的回應是在明華生效前算的（明華還是不推播）。
    puts.minghua!.resolve(settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: GROUP }, { campus_key: 'minghua', campus_name: '明華校', target_id: GROUP }]))
    await flushPromises()
    puts.yihua!.resolve(settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: null }, { campus_key: 'minghua', campus_name: '明華校', target_id: null }]))
    await flushPromises()
    expect(selects().map((select) => select.props('modelValue'))).toEqual(['', GROUP])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('一次只改一校：直接用回應，不多讀一次', async () => {
    const initial = settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: GROUP }, { campus_key: 'minghua', campus_name: '明華校', target_id: null }])
    const get = vi.spyOn(api, 'get').mockResolvedValue(initial as never)
    vi.spyOn(api, 'put').mockResolvedValue(settings([{ campus_key: 'yihua', campus_name: '義華校', target_id: GROUP }, { campus_key: 'minghua', campus_name: '明華校', target_id: GROUP }]) as never)
    const { wrapper } = await mountRouted(LineNotificationsView, '/line-notifications')
    wrapper.findAll('.target-row')[1]!.findComponent({ name: 'ElSelect' }).vm.$emit('change', GROUP)
    await flushPromises()
    expect(wrapper.findAll('.target-row').map((row) => row.findComponent({ name: 'ElSelect' }).props('modelValue'))).toEqual([GROUP, GROUP])
    expect(get).toHaveBeenCalledTimes(1)
  })
})
