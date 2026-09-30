// 2026-09-28 案件明細與補登對話框 UX（B2）：未送出的聯絡紀錄、下一筆的範圍與順序、
// 返回、欄位用詞、手機撥號、取消需求／預約的用詞、確認期限倒數、補登對話框的
// 送出條件與關閉保護。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { api, ApiError } from '../api/client'
import { visitEventTitle } from '../api/visitHistory'
import type { VisitHistoryOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
  // 聯絡紀錄草稿存在 sessionStorage（visitNoteDraft.ts）：不清的話會帶進下一個測試，
  // 紀錄框有字就觸發離頁確認。
  window.sessionStorage.clear()
})

const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const request = (extra: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', source: 'web', parent_name: '陳媽媽', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, party_size: null,
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, version: 1,
  assigned_staff_id: null, confirmed_at: null, cancelled_at: null, history: [], pending_reschedule: null, access_link: null,
  ...extra,
})

type Lists = { held?: unknown[]; fresh?: unknown[] }

function mockApi(data: Record<string, unknown> | ((path: string) => unknown), lists: Lists = {}, slots: unknown[] = []) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.endsWith('/contact-notes')) return [] as never
    if (path.startsWith('/admin/slots')) return slots as never
    if (path.startsWith('/admin/visit-requests?status=pending_confirmation')) return (lists.held ?? []) as never
    if (path.startsWith('/admin/visit-requests?status=new')) return (lists.fresh ?? []) as never
    if (path.startsWith('/admin/visit-requests?') || path.startsWith('/admin/visit-staff')) return [] as never
    if (path === '/admin/dashboard') return {} as never
    return (typeof data === 'function' ? data(path) : data) as never
  })
}

async function mountDetail(
  path = '/visit-requests/case-a',
  history: RouterHistory = createMemoryHistory(),
  before: string[] = [],
  options: { attach?: boolean } = {},
) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({
    history,
    routes: [
      { path: '/visit-requests', component: defineComponent({ template: '<div class="list-page" />' }) },
      { path: '/visit-requests/:id', component: VisitDetailView },
      { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
    ],
  })
  for (const step of before) await router.push(step)
  await router.push(path)
  await router.isReady()
  const wrapper = mount(
    { template: '<router-view />' },
    { attachTo: options.attach ? document.body : undefined, global: { plugins: [pinia, router, ElementPlus] } },
  )
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)

describe('未送出的聯絡紀錄', () => {
  it('打了紀錄沒新增就按下一筆：先問，留在這頁就不換案件', async () => {
    mockApi((path) => request({ id: path.split('/').pop() }), { fresh: [request({ id: 'case-b' })] })
    const { wrapper, router } = await mountDetail()
    await wrapper.find('textarea').setValue('已致電，家長下週回覆')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    await wrapper.find('.detail__next').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(String(confirm.mock.calls[0]![0])).toContain('離開後會遺失')
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/case-a')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('已致電，家長下週回覆')

    // 確定放棄才換到下一筆。
    confirm.mockResolvedValue({ action: 'confirm' } as never)
    await wrapper.find('.detail__next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/case-b')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('返回列表與從側欄換頁也會先問；紀錄框空白時不問', async () => {
    mockApi(request())
    const { wrapper, router } = await mountDetail()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    await wrapper.find('textarea').setValue('家長說週末再聯絡')
    await wrapper.find('.detail__back').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/case-a')

    await router.push('/visit-slots')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/case-a')

    await wrapper.find('textarea').setValue('   ')
    await router.push('/visit-slots')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.fullPath).toBe('/visit-slots')
  })

  it('結案案件重新預約後紀錄框還有字、選擇留在這頁：說明新案件已建立', async () => {
    mockApi(request({ status: 'completed' }))
    const { wrapper, router } = await mountDetail()
    await wrapper.find('textarea').setValue('家長說下個月再來')
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const info = vi.spyOn(ElMessage, 'info')
    wrapper.findComponent(ManualVisitDialog).vm.$emit('created', request({ id: 'case-new' }))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/case-a')
    expect(info).toHaveBeenCalledWith('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
  })
})

describe('下一筆：同校待確認在前、再接待處理', () => {
  it('待確認依確認期限由早到晚，按鈕寫出兩種各幾件，換筆用 replace', async () => {
    const get = mockApi((path) => request({ id: path.split('/').pop() }), {
      held: [
        request({ id: 'held-late', status: 'pending_confirmation', hold_expires_at: '2099-01-02T00:00:00Z' }),
        request({ id: 'held-early', status: 'pending_confirmation', hold_expires_at: '2099-01-01T00:00:00Z' }),
      ],
      fresh: [request({ id: 'case-a' }), request({ id: 'fresh-1' })],
    })
    const { wrapper, router } = await mountDetail()
    const listCalls = get.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/admin/visit-requests?'))
    expect(listCalls.some((path) => path.includes('status=pending_confirmation') && path.includes('campus_key=yihua'))).toBe(true)
    expect(listCalls.some((path) => path.includes('status=new') && path.includes('campus_key=yihua'))).toBe(true)
    const next = wrapper.find('.detail__next')
    expect(next.text()).toBe('下一筆（待確認 2・待處理 1）')
    expect(next.attributes('title')).toContain('義華還有待園方確認 2 件、待處理 1 件')
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')
    await next.trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/visit-requests/held-early')
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/held-early')
  })

  it('確認期限已過、系統還沒取消的待確認不排進下一筆', async () => {
    mockApi((path) => request({ id: path.split('/').pop() }), {
      held: [
        request({ id: 'held-expired', status: 'pending_confirmation', hold_expires_at: '2020-01-01T00:00:00Z' }),
        request({ id: 'held-ok', status: 'pending_confirmation', hold_expires_at: '2099-01-01T00:00:00Z' }),
      ],
    })
    const { wrapper, router } = await mountDetail()
    const next = wrapper.find('.detail__next')
    expect(next.text()).toBe('下一筆（待確認 1）')
    await next.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/held-ok')
  })

  it('同校沒有其他待確認或待處理的案件就不顯示', async () => {
    mockApi(request(), { fresh: [request({ id: 'case-a' })] })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__next').exists()).toBe(false)
  })
})

describe('返回案件列表', () => {
  it('從列表點進來：瀏覽器返回，保留列表的篩選', async () => {
    window.history.replaceState(null, '', '/')
    mockApi(request())
    const { wrapper, router } = await mountDetail('/visit-requests/case-a', createWebHistory(), ['/visit-requests?status=new'])
    const back = vi.spyOn(router, 'back')
    const push = vi.spyOn(router, 'push')
    await wrapper.find('.detail__back').trigger('click')
    expect(back).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
  })

  it('從通知連結、登入頁或其他頁進來：直接開案件列表，不退回上一頁', async () => {
    window.history.replaceState(null, '', '/')
    mockApi(request())
    const { wrapper, router } = await mountDetail('/visit-requests/case-a', createWebHistory(), ['/login?redirect=/visit-requests/case-a'])
    const back = vi.spyOn(router, 'back')
    const push = vi.spyOn(router, 'push')
    await wrapper.find('.detail__back').trigger('click')
    expect(back).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/visit-requests')
  })
})

describe('明細的欄位與手機撥號', () => {
  it('官網案件叫「家長填寫的資料」，補登的叫「案件資料」；空值一律「未填寫」', async () => {
    mockApi(request())
    const web = await mountDetail()
    const text = web.wrapper.text()
    expect(text).toContain('家長填寫的資料')
    expect(text).toContain('方便接電話時段未填寫')
    expect(text).toContain('想了解的事未填寫')
    expect(text).toContain('參觀人數未填寫')
    expect(text).not.toContain('—')
    web.wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    mockApi(request({ source: 'phone', preferred_time: 'weekday_morning' }))
    const manual = await mountDetail()
    expect(manual.wrapper.text()).toContain('案件資料')
    expect(manual.wrapper.text()).not.toContain('家長填寫的資料')
    expect(manual.wrapper.text()).toContain('方便接電話時段平日上午')
  })

  it('頁首有撥電話按鈕（手機版面才顯示），資料表的電話也能撥', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    const call = wrapper.find('a.detail__call')
    expect(call.attributes('href')).toBe('tel:0912345678')
    expect(call.text()).toContain('撥電話給家長')
    expect(wrapper.find('.detail__desc a.detail__link[href="tel:0912345678"]').exists()).toBe(true)
  })

  it('紀錄與家長管理連結的順序：聯絡紀錄在前', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    const headings = wrapper.findAll('h2').map((h) => h.text())
    expect(headings.indexOf('聯絡紀錄')).toBeLessThan(headings.indexOf('家長管理連結'))
  })

  it('時段選單的名額用「組」', async () => {
    mockApi(request(), {}, [{ ...future, campus_key: 'yihua', capacity: 3, booked_count: 1, closed: false }])
    const { wrapper } = await mountDetail()
    const labels = wrapper.findAllComponents({ name: 'ElOption' }).map((o) => o.props('label'))
    expect(labels).toEqual(['2099/10/01（週四）10:00–11:00，剩 2 組'])
  })
})

describe('下次聯絡', () => {
  it('預填的時間已經過了：不改也照舊只記紀錄，但提示仍會列在到期待追蹤；有快捷選項', async () => {
    mockApi(request({ follow_up_at: '2020-01-01T01:00:00Z' }))
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.notes__past').text()).toContain('下次聯絡的時間已經過了')
    expect(wrapper.find('.notes__past').text()).toContain('到期待追蹤')
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    const shortcuts = picker.props('shortcuts') as { text: string; value: () => Date }[]
    expect(shortcuts.map((s) => s.text)).toEqual(['明天 10:00', '3 天後', '下週一'])
    const tomorrow = shortcuts[0]!.value()
    expect(tomorrow.getHours()).toBe(10)
    expect(tomorrow.getMinutes()).toBe(0)
    const monday = shortcuts[2]!.value()
    expect(monday.getDay()).toBe(1)
    expect(monday.getTime()).toBeGreaterThan(Date.now())

    // 改成未來的時間，提示就消失。
    picker.vm.$emit('update:modelValue', '2099-01-01T10:00:00+08:00')
    await nextTick()
    expect(wrapper.find('.notes__past').exists()).toBe(false)
  })

  it('沒有預填時間時不提示', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.notes__past').exists()).toBe(false)
    // 報讀區一直在，提示之後出現時報讀軟體才會念。
    expect(wrapper.find('.notes__status').attributes('role')).toBe('status')
  })

  it('已完成、已取消的案件不會列進到期待追蹤：時間過了也不提示', async () => {
    for (const status of ['completed', 'cancelled']) {
      mockApi(request({ status, follow_up_at: '2020-01-01T01:00:00Z' }))
      const { wrapper } = await mountDetail()
      expect(wrapper.find('textarea').exists()).toBe(true)
      expect(wrapper.find('.notes__past').exists()).toBe(false)
      expect(wrapper.find('.detail__follow').classes()).not.toContain('is-due')
      wrapper.unmount()
      wrappers.splice(wrappers.indexOf(wrapper), 1)
      vi.restoreAllMocks()
    }
  })

  it('未到場的案件仍會列進到期待追蹤，時間過了照樣提示', async () => {
    mockApi(request({ status: 'no_show', follow_up_at: '2020-01-01T01:00:00Z' }))
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.notes__past').exists()).toBe(true)
  })
})

describe('家長申請改期時的手動改期', () => {
  const slotA = { ...future, id: 'slot-a' }
  const slotB = { ...future, id: 'slot-b', slot_date: '2099-10-03' }
  const confirmedWithRequest = () =>
    request({
      status: 'confirmed', slot_id: slotA.id, slot: slotA, confirmed_at: '2026-09-22T01:00:00Z',
      pending_reschedule: {
        id: 'req-1', visit_request_id: 'case-a', campus_key: 'yihua', status: 'pending', parent_name: '陳媽媽',
        current_slot: slotA, requested_slot: slotB, requested_slot_remaining: 2, requested_slot_available: true,
        created_at: '2026-09-24T02:00:00Z',
      },
    })

  it('展開後焦點移到新時段選單，不會掉回頁面最上面', async () => {
    mockApi(confirmedWithRequest(), {}, [{ ...slotB, campus_key: 'yihua', capacity: 2, booked_count: 0, closed: false }])
    const { wrapper } = await mountDetail(undefined, undefined, undefined, { attach: true })
    const toggle = button(wrapper, '不照申請，改到其他時段…')!
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    await flushPromises()
    const form = wrapper.find('.reschedule:not(.reschedule--collapsed)')
    expect(form.exists()).toBe(true)
    expect(form.attributes('role')).toBe('group')
    expect(form.element.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.tagName).toBe('INPUT')
  })

  it('沒有其他時段可選時，焦點放在改期標題', async () => {
    mockApi(confirmedWithRequest(), {}, [])
    const { wrapper } = await mountDetail(undefined, undefined, undefined, { attach: true })
    await button(wrapper, '不照申請，改到其他時段…')!.trigger('click')
    await flushPromises()
    expect(document.activeElement?.classList.contains('reschedule__title')).toBe(true)
    expect(document.activeElement?.textContent).toBe('改期（換時段）')
  })
})

describe('取消需求與取消預約', () => {
  it('還沒排時段的需求叫「取消這筆需求」，說明改成可以另建新案', async () => {
    mockApi(request({ status: 'contacting' }))
    const { wrapper } = await mountDetail()
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel' as never)
    await button(wrapper, '取消這筆需求')!.trigger('click')
    await flushPromises()
    const [message, title, options] = prompt.mock.calls[0]!
    expect(title).toBe('取消這筆參觀需求？')
    expect(options).toMatchObject({ confirmButtonText: '取消需求', cancelButtonText: '先不要' })
    expect(String(message)).toContain('重新預約（另建新案）')
    expect(String(message)).not.toContain('重新送出需求')
    expect(button(wrapper, '取消預約')).toBeUndefined()
  })

  it('已確認的案件仍是「取消預約」，說明名額會釋出', async () => {
    mockApi(request({ status: 'confirmed', slot_id: future.id, slot: future }))
    const { wrapper } = await mountDetail()
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel' as never)
    await button(wrapper, '取消預約')!.trigger('click')
    await flushPromises()
    const [message, title, options] = prompt.mock.calls[0]!
    expect(title).toBe('取消這筆預約？')
    expect(options).toMatchObject({ confirmButtonText: '取消預約' })
    expect(String(message)).toContain('名額會釋出')
  })

  it('歷程依取消前的狀態寫「取消需求」或「取消預約」', () => {
    const event = (before: Record<string, unknown> | null): VisitHistoryOut => ({
      id: 'e', event_type: 'cancelled', source: 'staff', actor_user_id: null, actor_email: null,
      before, after: { status: 'cancelled' }, reason: null, created_at: '2026-09-24T02:00:00Z',
    })
    expect(visitEventTitle(event({ status: 'new' }))).toBe('取消需求')
    expect(visitEventTitle(event({ status: 'contacting' }))).toBe('取消需求')
    expect(visitEventTitle(event({ status: 'pending_confirmation', slot: future }))).toBe('取消預約')
    expect(visitEventTitle(event({ status: 'confirmed', slot: future }))).toBe('取消預約')
    expect(visitEventTitle(event(null))).toBe('取消預約')
  })
})

describe('讀取與處理中的狀態', () => {
  it('案件與聯絡紀錄同時送出，不等前一個回來', async () => {
    const pending: string[] = []
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      pending.push(path)
      return new Promise(() => {}) as never
    })
    await mountDetail()
    expect(pending).toContain('/admin/visit-requests/case-a')
    expect(pending).toContain('/admin/visit-requests/case-a/contact-notes')
  })

  it('聯絡紀錄先失敗、案件晚一點回找不到：仍說明找不到這筆案件', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.endsWith('/contact-notes')) throw new ApiError(500, 'boom')
      if (path === '/admin/visit-requests/case-a') {
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw new ApiError(404, 'not found')
      }
      return [] as never
    })
    const { wrapper } = await mountDetail()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()
    expect(wrapper.text()).toContain('找不到這筆案件')
  })

  it('確認期限的倒數跟著時間更新，過了期限停用確認', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
    mockApi(request({ status: 'pending_confirmation', slot_id: future.id, slot: future, hold_expires_at: '2099-01-01T01:30:00Z' }))
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.hold-deadline').text()).toContain('還剩 1 小時')
    expect(button(wrapper, '確認已選場次')!.attributes('disabled')).toBeUndefined()
    vi.advanceTimersByTime(31 * 60_000)
    await flushPromises()
    expect(wrapper.find('.hold-deadline').text()).toContain('還剩 59 分鐘')
    expect(wrapper.find('.hold-deadline').classes()).toContain('is-urgent')
    vi.advanceTimersByTime(60 * 60_000)
    await flushPromises()
    expect(wrapper.find('.hold-deadline').text()).toContain('已過，不能再確認')
    // 過期說明出現在一開始就在的報讀區裡，報讀軟體才會念出來。
    expect(wrapper.find('.hold-status[role="status"] .hold-deadline').text()).toContain('已過，不能再確認')
    expect(button(wrapper, '確認已選場次')!.attributes('disabled')).toBeDefined()
  })

  it('只有按下去的那顆按鈕轉圈，其他按鈕停用', async () => {
    mockApi(request({ status: 'pending_confirmation', slot_id: future.id, slot: future, hold_expires_at: '2099-01-01T00:00:00Z' }))
    const { wrapper } = await mountDetail()
    vi.spyOn(api, 'post').mockReturnValue(new Promise(() => {}) as never)
    await wrapper.find('textarea').setValue('已致電')
    await button(wrapper, '新增紀錄')!.trigger('click')
    await nextTick()
    expect(button(wrapper, '新增紀錄')!.classes()).toContain('is-loading')
    const confirmButton = button(wrapper, '確認已選場次')!
    expect(confirmButton.classes()).not.toContain('is-loading')
    expect(confirmButton.attributes('disabled')).toBeDefined()
  })
})

describe('補登對話框', () => {
  async function mountDialog(slots: unknown[] | Error = []) {
    vi.spyOn(api, 'get').mockImplementation(async () => {
      if (slots instanceof Error) throw slots
      return slots as never
    })
    const wrapper = mount(ManualVisitDialog, {
      props: { campusKeys: ['yihua'], modelValue: false, 'onUpdate:modelValue': (value: boolean) => wrapper.setProps({ modelValue: value }) },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  function fill(placeholder: string, value: string) {
    const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
    input.value = value
    input.dispatchEvent(new Event('input'))
  }

  const missingText = () => document.body.querySelector('.manual__missing')?.textContent?.trim() ?? ''

  it('送出鈕停用時說出還差什麼，同意勾選固定在底部', async () => {
    await mountDialog()
    expect(missingText()).toBe('還不能送出：還沒填家長稱呼、手機；還沒勾選同意')
    expect(document.body.querySelector('.el-dialog__footer .manual__consent')).not.toBeNull()
    fill('例如：王媽媽', '王媽媽')
    fill('0912345678', '0912')
    await nextTick()
    expect(missingText()).toBe('還不能送出：手機號碼格式不對；還沒勾選同意')
    fill('0912345678', '0912345678')
    await nextTick()
    expect(missingText()).toBe('還不能送出：還沒勾選同意')
    document.body.querySelector<HTMLInputElement>('.manual__consent input')!.click()
    await nextTick()
    expect(missingText()).toBe('')
  })

  it('有輸入時按右上角關閉或「取消」先確認；沒輸入直接關', async () => {
    const wrapper = await mountDialog()
    // 測試環境沒有轉場動畫，看遮罩有沒有收起來判斷是否已關閉。
    const shown = () => document.body.querySelector<HTMLElement>('.el-overlay')!.style.display !== 'none'
    const closeX = () => document.body.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    fill('例如：王媽媽', '王媽媽')
    await nextTick()
    closeX()
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![1]).toBe('放棄這筆補登？')
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '放棄填寫', cancelButtonText: '先不要' })
    expect(shown()).toBe(true)

    ;[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '取消')!.click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(wrapper.props('modelValue')).toBe(true)

    confirm.mockResolvedValue({ action: 'confirm' } as never)
    closeX()
    await flushPromises()
    expect(shown()).toBe(false)
    wrapper.unmount(); wrappers.length = 0; document.body.innerHTML = ''

    // 沒輸入就直接關，不多問。
    confirm.mockClear()
    await mountDialog()
    expect(shown()).toBe(true)
    closeX()
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(shown()).toBe(false)
  })

  it('時段選單不列已開始的場次，名額用「組」；讀不到時可以重試', async () => {
    const slot = (extra: Record<string, unknown>) => ({ campus_key: 'yihua', capacity: 3, booked_count: 1, closed: false, ...extra })
    const wrapper = await mountDialog([
      slot({ id: 'started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }),
      slot({ ...future }),
    ])
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '還沒談好時間就留空')!
    const options = select.findAllComponents({ name: 'ElOption' }).map((o) => [o.props('value'), o.props('label')])
    expect(options).toEqual([['slot-f', '2099/10/01（週四）10:00–11:00，剩 2 組']])
    wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks(); document.body.innerHTML = ''

    await mountDialog(new Error('offline'))
    expect(document.body.textContent).toContain('讀不到這個校區的時段')
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent?.trim() === '重新讀取')).toBe(true)
  })

  it('欄位叫「方便接電話時段」', async () => {
    await mountDialog()
    const labels = [...document.body.querySelectorAll('.el-form-item__label')].map((l) => l.textContent?.trim())
    expect(labels).toContain('方便接電話時段')
    expect(labels).not.toContain('方便聯絡時段')
  })
})
