// 2026-09-28 案件明細與補登對話框 UX（B2）：未送出的聯絡紀錄、下一筆的範圍與順序、
// 返回、欄位用詞、手機撥號、取消預約的用詞、補登對話框的送出條件與關閉保護。
// 2026-10-06 舊流程（new／contacting／pending_confirmation 的排入場次、確認占位與倒數）
// 已拿掉：案件預設是已確認，舊狀態只剩「確實沒有操作」的斷言。
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
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', source: 'web', parent_name: '陳媽媽', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, party_size: null,
  slot_id: future.id, slot: future, created_at: '2026-09-22T00:00:00Z', follow_up_at: null, version: 1,
  confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, history: [], pending_reschedule: null, access_link: null,
  ...extra,
})

type Lists = { attendance?: unknown[]; due?: unknown[] }

function mockApi(data: Record<string, unknown> | ((path: string) => unknown), lists: Lists = {}, slots: unknown[] = []) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.endsWith('/contact-notes')) return [] as never
    if (path.startsWith('/admin/slots')) return slots as never
    if (path.startsWith('/admin/visit-requests?group=past&status=confirmed')) return (lists.attendance ?? []) as never
    if (path.startsWith('/admin/visit-requests?follow_up_due=true')) return (lists.due ?? []) as never
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
    mockApi((path) => request({ id: path.split('/').pop() }), { due: [request({ id: 'case-b' })] })
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

describe('下一筆：沒有來源列表時，先待標記到場、再到期追蹤（沒有舊需求）', () => {
  const at = (date: string, time: string) => ({ id: `slot-${date}-${time}`, slot_date: date, start_time: `${time}:00`, end_time: '23:00:00' })
  it('待標記到場依參觀時間由早到晚，到期追蹤重複的只算一次，按鈕寫出各幾件，換筆用 replace', async () => {
    const get = mockApi((path) => request({ id: path.split('/').pop() }), {
      attendance: [
        request({ id: 'late', status: 'confirmed', slot: at('2026-09-30', '16:00') }),
        request({ id: 'early', status: 'confirmed', slot: at('2026-09-30', '10:00') }),
        request({ id: 'case-a', status: 'confirmed', slot: at('2026-09-29', '10:00') }),
      ],
      due: [request({ id: 'late', status: 'confirmed' }), request({ id: 'due-1', status: 'confirmed', follow_up_at: '2026-09-01T00:00:00Z' })],
    })
    const { wrapper, router } = await mountDetail()
    const listCalls = get.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/admin/visit-requests?'))
    expect(listCalls.some((path) => path.includes('group=past') && path.includes('status=confirmed') && path.includes('campus_key=yihua'))).toBe(true)
    expect(listCalls.some((path) => path.includes('follow_up_due=true') && path.includes('campus_key=yihua'))).toBe(true)
    const next = wrapper.find('.detail__next')
    expect(next.text()).toBe('下一筆（待標記到場 2・到期追蹤 1）')
    expect(next.attributes('title')).toContain('義華還有參觀時間已過、尚未確認到場 2 件，到期待追蹤 1 件')
    expect(next.text()).not.toContain('待確認')
    expect(next.text()).not.toContain('舊需求')
    // 舊流程的待確認、新需求兩份清單已不再抓。
    expect(listCalls.some((path) => path.includes('status=pending_confirmation') || path.includes('status=new'))).toBe(false)
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')
    await next.trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/visit-requests/early')
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests/early')
  })

  it('同校沒有其他要處理的案件就不顯示', async () => {
    mockApi(request(), { due: [request({ id: 'case-a' })] })
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
  // 2026-10-05 第九輪：官網已不問的參觀人數、想了解的事也改成有值才列（同方便接電話時段）。
  it('官網案件叫「家長填寫的資料」，補登的叫「案件資料」；官網已不問的欄位只有舊資料有值才列', async () => {
    mockApi(request())
    const web = await mountDetail()
    const text = web.wrapper.text()
    expect(text).toContain('家長填寫的資料')
    expect(text).not.toContain('方便接電話時段')
    expect(text).not.toContain('想了解的事')
    expect(text).not.toContain('參觀人數')
    expect(text).not.toContain('—')
    web.wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    mockApi(request({ source: 'phone', preferred_time: 'weekday_morning' }))
    const manual = await mountDetail()
    expect(manual.wrapper.text()).toContain('案件資料')
    expect(manual.wrapper.text()).not.toContain('家長填寫的資料')
    expect(manual.wrapper.text()).toContain('方便接電話時段平日上午')
  })

  it('頁首有撥號按鈕（桌機也有），資料表的電話也能撥', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    const call = wrapper.find('a.detail__call')
    expect(call.attributes('href')).toBe('tel:0912345678')
    expect(call.text()).toBe('撥號')
    expect(call.attributes('aria-label')).toContain('0912345678')
    expect(wrapper.find('.case-facts a.detail__link[href="tel:0912345678"]').exists()).toBe(true)
  })

  it('版面順序：主欄是時間線，右欄的家長資料在設定列（場次、家長管理連結、取消）之前', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__main').find('.case-timeline').exists()).toBe(true)
    const side = Array.from(wrapper.get('.detail__side').element.children)
    const facts = side.findIndex((el) => el.classList.contains('case-facts'))
    const settings = side.findIndex((el) => el.classList.contains('case-settings'))
    expect(facts).toBeGreaterThanOrEqual(0)
    expect(facts).toBeLessThan(settings)
    expect(wrapper.get('.case-settings').text()).toContain('家長管理連結')
  })

  it('時段選單的名額用「組」', async () => {
    // 改期的新場次選單（已確認案件才會抓同校場次）。
    mockApi(request(), {}, [{ ...future, id: 'slot-other', campus_key: 'yihua', capacity: 3, booked_count: 1, closed: false }])
    const { wrapper } = await mountDetail()
    await button(wrapper, '改到其他場次…')!.trigger('click')
    await flushPromises()
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
      // 2026-10-04 參觀後追蹤規格 6.6、7.6：不列入到期待追蹤的案件，頁首不再顯示殘留的「預定聯絡」，
      // 聯絡紀錄框也不給設下次聯絡（設了永遠不會出現在任何待辦）。
      expect(wrapper.find('.detail__follow').exists()).toBe(false)
      expect(wrapper.find('.notes__follow').exists()).toBe(false)
      expect(wrapper.find('.notes__untracked').text()).toContain('不會列入到期待追蹤')
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
    const toggle = button(wrapper, '不照申請，改到其他場次…')!
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
    await button(wrapper, '不照申請，改到其他場次…')!.trigger('click')
    await flushPromises()
    expect(document.activeElement?.classList.contains('reschedule__title')).toBe(true)
    expect(document.activeElement?.textContent).toBe('改期（換場次）')
  })
})

describe('取消需求與取消預約', () => {
  it('舊的新需求／聯絡中案件沒有取消區（不再有「取消這筆需求」）', async () => {
    for (const status of ['new', 'contacting', 'pending_confirmation']) {
      mockApi(request({ status, slot_id: null, slot: null, confirmed_at: null }))
      const { wrapper } = await mountDetail()
      expect(button(wrapper, '取消這筆需求'), status).toBeUndefined()
      expect(button(wrapper, '取消預約'), status).toBeUndefined()
      wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    }
  })

  it('已確認的案件仍是「取消預約」，說明名額會釋出', async () => {
    mockApi(request({ status: 'confirmed', slot_id: future.id, slot: future }))
    const { wrapper } = await mountDetail()
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel' as never)
    await button(wrapper, '取消預約')!.trigger('click')
    await flushPromises()
    const [message, title, options] = prompt.mock.calls[0]!
    expect(title).toBe('取消這筆預約？')
    // 危險確認框：確定鈕危險色、不自動聚焦（第七輪規則，取消預約也適用）。
    expect(options).toMatchObject({ confirmButtonText: '取消預約', confirmButtonClass: 'el-button--danger', autofocus: false })
    expect(String(message)).toContain('名額會釋出')
    expect(String(message)).not.toContain('還沒排場次')
    expect(String(message)).not.toContain('不會通知家長')
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

  it('只有按下去的那顆按鈕轉圈，其他按鈕停用', async () => {
    mockApi(request())
    const { wrapper } = await mountDetail()
    vi.spyOn(api, 'post').mockReturnValue(new Promise(() => {}) as never)
    await wrapper.find('textarea').setValue('已致電')
    await button(wrapper, '新增紀錄')!.trigger('click')
    await nextTick()
    expect(button(wrapper, '新增紀錄')!.classes()).toContain('is-loading')
    const cancelButton = button(wrapper, '取消預約')!
    expect(cancelButton.classes()).not.toContain('is-loading')
    expect(cancelButton.attributes('disabled')).toBeDefined()
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

  it('送出鈕停用時說出還差什麼；2026-10-02 起不用勾選同意', async () => {
    const wrapper = await mountDialog([{ ...future, campus_key: 'yihua', capacity: 3, booked_count: 1, closed: false }])
    expect(missingText()).toBe('還不能送出：還沒填家長稱呼、手機、參觀場次')
    expect(document.body.querySelector('.manual__consent')).toBeNull()
    expect(document.body.textContent).not.toContain('取得同意')
    fill('例如：王媽媽', '王媽媽')
    fill('0912345678', '0912')
    await nextTick()
    expect(missingText()).toBe('還不能送出：還沒填參觀場次；手機號碼格式不對')
    fill('0912345678', '0912345678')
    await nextTick()
    wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.props('placeholder') === '選擇場次')!.vm.$emit('update:modelValue', 'slot-f')
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
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '選擇場次')!
    const options = select.findAllComponents({ name: 'ElOption' }).map((o) => [o.props('value'), o.props('label')])
    expect(options).toEqual([['slot-f', '2099/10/01（週四）10:00–11:00，剩 2 組']])
    wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks(); document.body.innerHTML = ''

    await mountDialog(new Error('offline'))
    expect(document.body.textContent).toContain('讀不到這個校區的場次')
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent?.trim() === '重新讀取')).toBe(true)
  })

  it('家長自選場次之後不再問方便接電話時段（DESIGN.md 2026-09-30）', async () => {
    await mountDialog()
    const labels = [...document.body.querySelectorAll('.el-form-item__label')].map((l) => l.textContent?.trim())
    expect(labels).not.toContain('方便接電話時段')
    expect(labels).not.toContain('方便聯絡時段')
  })
})
