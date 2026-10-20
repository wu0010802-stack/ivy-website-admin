import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import RevisionHistoryDrawer from '../components/RevisionHistoryDrawer.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { staffLabelById, visitSourceLabel, formatShortSlotWhen, visitDisplay, visitDisplayStatus, visitStatus } from '../api/labels'
import { NAV_GROUPS } from '../router/nav'
import type { RevisionHistoryHandle } from '../composables/useContentItem'
import { resetVisitStaff } from '../composables/useVisitStaff'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import DayPanel from '../components/sessions/DayPanel.vue'
import { groupSlotsByDay } from '../utils/sessions'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetVisitStaff()
  document.body.innerHTML = ''
})

function confirmYes() {
  return vi
    .spyOn(ElMessageBox, 'confirm')
    .mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found as HTMLButtonElement
}

describe('標籤與側欄', () => {
  it('接待月曆排在參觀案件後面', () => {
    const visits = NAV_GROUPS.find((g) => g.key === 'visits')!
    const names = visits.items.map((i) => i.name)
    expect(names.indexOf('visit-calendar')).toBe(names.indexOf('visit-requests') + 1)
  })

  it('承辦人顯示 email 帳號名，未指派與已移除分開講', () => {
    const staff = [{ id: 'u1', email: 'amy@ivy.example' }]
    expect(staffLabelById('u1', staff)).toBe('amy')
    expect(staffLabelById(null, staff)).toBe('未指派')
    expect(staffLabelById('gone', staff)).toBe('已移除的帳號')
  })

  it('來源標籤', () => {
    expect(visitSourceLabel('walk_in')).toBe('親自到園')
    expect(visitSourceLabel(undefined)).toBe('官網表單')
  })
})

describe('版本紀錄抽屜', () => {
  function history(overrides: Partial<RevisionHistoryHandle> = {}): RevisionHistoryHandle {
    return {
      list: vi.fn(async () => [
        { id: 'r2', version: 2, created_at: '2026-09-24T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: true },
        { id: 'r1', version: 1, created_at: '2026-09-23T02:00:00Z', created_by_email: null, is_published: false },
      ]),
      payloadOf: vi.fn(async () => ({ title: '舊標題', body_text: '同樣' })),
      savedPayload: () => ({ title: '新標題', body_text: '同樣' }),
      restore: vi.fn(async () => true),
      ...overrides,
    }
  }

  async function mountDrawer(handle: RevisionHistoryHandle, dirty = false) {
    const wrapper = mount(RevisionHistoryDrawer, {
      props: { history: handle, dirty, busy: false, modelValue: false },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  it('列出版本、標出官網目前版本，選舊版顯示會改變的欄位', async () => {
    const handle = history()
    await mountDrawer(handle)
    const text = document.body.textContent ?? ''
    // 不寫版本號（2026-09-29 裁定）；編輯者寫名字（沒設定顯示名稱時是 Email @ 前面那段），完整 Email 在 title。
    expect(text).toContain('編輯者：amy')
    expect(text).not.toMatch(/第 \d+ 版/)
    expect(text).not.toContain('amy@ivy.example')
    expect(document.body.querySelector('.history__meta[title="amy@ivy.example"]')).not.toBeNull()
    expect(text).toContain('官網目前版本')
    expect(text).toContain('系統匯入或已刪除的帳號')

    ;[...document.body.querySelectorAll('.history__item')][1]!.dispatchEvent(new Event('click'))
    await flushPromises()
    expect(handle.payloadOf).toHaveBeenCalledWith('r1')
    expect(document.body.textContent).toContain('還原後會改變 1 個欄位')
    expect(document.body.textContent).toContain('舊標題')
  })

  it('確認後依選擇還原成草稿或直接發布', async () => {
    const confirm = confirmYes()
    const handle = history()
    await mountDrawer(handle, true)
    ;[...document.body.querySelectorAll('.history__item')][1]!.dispatchEvent(new Event('click'))
    await flushPromises()

    buttonByText('還原並發布').click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    // 表單有未儲存修改時要講清楚會被捨棄。
    expect(String(confirm.mock.calls[0]![0])).toContain('還沒儲存的修改會被捨棄')
    expect(handle.restore).toHaveBeenCalledWith('r1', true)
  })
})

describe('補登案件對話框', () => {
  async function mountDialog() {
    vi.spyOn(api, 'get').mockResolvedValue([{ id: 'slot-f', campus_key: 'yihua', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 1, closed: false }] as never)
    const wrapper = mount(ManualVisitDialog, {
      props: { campusKeys: ['yihua'], modelValue: false },
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

  it('必填填完就能送出（2026-10-02 起不用勾同意）；送出時帶 Idempotency-Key 並正規化手機', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'new-case', status: 'confirmed', slot: { slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' } } as never)
    const wrapper = await mountDialog()
    fill('例如：王媽媽', '王媽媽')
    fill('0912345678', '0912-345-678')
    await nextTick()
    expect(buttonByText('補登案件').disabled).toBe(true)
    wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.props('placeholder') === '選擇場次')!.vm.$emit('update:modelValue', 'slot-f')
    await nextTick()
    expect(buttonByText('補登案件').disabled).toBe(false)
    expect(document.body.querySelector('.manual__consent')).toBeNull()
    buttonByText('補登案件').click()
    await flushPromises()

    expect(post).toHaveBeenCalledOnce()
    const [path, body, options] = post.mock.calls[0]!
    expect(path).toBe('/admin/visit-requests')
    expect(body).toMatchObject({ campus_key: 'yihua', source: 'phone', parent_name: '王媽媽', phone: '0912345678', slot_id: 'slot-f', consent_given: false })
    expect(options?.headers?.['Idempotency-Key']).toBeTruthy()
    expect(wrapper.emitted('created')?.[0]?.[0]).toMatchObject({ id: 'new-case' })
  })
})

describe('接待月曆', () => {
  it('把時段裡的家長排進對應日期，點日期列出當天名單', async () => {
    // 固定在早上九點：已結束的場次不算可約，測試不能隨執行時間變。
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T09:00:00+08:00'))
    const today = '2026-09-24'
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-calendar')) {
        return [
          // 早上八點那場已經結束，空位不算進「可約」。
          { id: 's0', campus_key: 'yihua', slot_date: today, start_time: '08:00:00', end_time: '08:30:00', capacity: 5, closed: false, booked_count: 0, visits: [] },
          {
            id: 's1', campus_key: 'yihua', slot_date: today, start_time: '10:00:00', end_time: '10:30:00',
            capacity: 3, closed: false, booked_count: 1,
            visits: [{ id: 'v1', status: 'confirmed', parent_name: '林爸爸', child_name: null, phone: '0911222333', source: 'phone' }],
          },
        ] as never
      }
      return [] as never
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-calendar?campus=yihua')
    await router.isReady()
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const wrapper = mount(VisitCalendarView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()

    const calendarCall = get.mock.calls.find(([p]) => String(p).startsWith('/admin/visit-calendar'))
    expect(calendarCall).toBeTruthy()
    const todayCell = wrapper.find('.calendar__day.is-today')
    expect(todayCell.text()).toContain('上午場 林爸爸')

    // 今天預設就是選取的日期，下方列出名單與電話補登來源。
    const detail = wrapper.find('.calendar__detail')
    expect(detail.text()).toContain('已約 1／3 組')
    expect(detail.find('a[href="/visit-requests/v1"]').exists()).toBe(true)
    expect(detail.text()).toContain('電話補登')
  })
})

// ---- 併自 receptionUx20261002.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-02 接待工作流 UX 修正：已開始的場次先標記到場、狀態用詞一致、
// 寄信沒設定時不承諾寄信、場次選單分組、參觀場次當天清單的狀態與觸控尺寸。
describe('2026-10-02 接待工作流 UX', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); document.body.innerHTML = '' })

  const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
  const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
  const confirmedCase = (extra = {}) => ({
    id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: null,
    child_birthdate: null, email: 'p@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
    slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
    confirmed_at: '2026-09-22T00:00:00.123Z', cancelled_at: null, source: 'web', display_status: 'past',
    history: [], access_link: null, ...extra,
  })

  async function mountDetail(data: Record<string, unknown>, bookingConfig: unknown = { parent_email_enabled: false }) {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      const url = String(path)
      if (url.endsWith('/contact-notes')) return [] as never
      if (url.startsWith('/admin/booking-config/')) return bookingConfig as never
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

  describe('案件明細：參觀已開始', () => {
    it('先問家長到了嗎：頁首「家長到了」實心、「沒來」次之；改期在處理面板收成連結', async () => {
      const wrapper = await mountDetail(confirmedCase())
      const attendance = wrapper.get('.case-hero__actions .detail__attendance')
      expect(attendance.text()).toContain('家長到了嗎？')
      const buttons = attendance.findAll('button')
      expect(buttons.map(b => b.text())).toEqual(['家長到了', '沒來'])
      expect(buttons[0]!.classes()).toContain('el-button--primary')
      expect(buttons[0]!.classes()).not.toContain('is-plain')
      const actions = wrapper.get('.detail__actions')
      expect(actions.find('.reschedule--collapsed').text()).toBe('改到其他場次…')
      expect(actions.text()).not.toContain('改到這一場')
      expect(wrapper.find('.detail__danger').text()).toContain('家長沒來請用上方的「沒來」')
    })

    it('取消預約的確認框提醒家長沒來要按「沒來」', async () => {
      const wrapper = await mountDetail(confirmedCase())
      const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel' as never)
      await wrapper.find('.detail__cancel').trigger('click')
      expect(String(prompt.mock.calls[0]![0])).toContain('家長沒來請改用上方的「沒來」')
    })

    it('頁首和列表同一種說法：預約時間已過・尚未確認到場；確認時間和送出同一分鐘不重複列', async () => {
      const wrapper = await mountDetail(confirmedCase())
      const head = wrapper.find('.detail__status')
      expect(head.text()).toContain('預約時間已過')
      expect(head.find('.detail__status-sub').text()).toBe('尚未確認到場')
      expect(wrapper.text()).not.toContain('確認時間')
      expect(wrapper.text()).not.toContain('方便接電話時段')
    })

    // 2026-10-05 第九輪：還沒開始的場次也先收成連結（見 adminUx.test.ts 的 2026-10-05 第九輪）。
    it('還沒開始的場次沒有到場按鈕，改期收成連結，頁首寫預約正常', async () => {
      const wrapper = await mountDetail(confirmedCase({ slot: future, slot_id: future.id, display_status: 'upcoming' }))
      expect(wrapper.find('.detail__attendance').exists()).toBe(false)
      expect(wrapper.find('.reschedule--collapsed').text()).toBe('改到其他場次…')
      expect(wrapper.find('.detail__status').text()).toBe('預約正常')
      expect(wrapper.find('.detail__danger').text()).toContain('家長不來了？')
    })
  })

  describe('家長管理連結：寄信沒設定', () => {
    const mountPanel = (emailEnabled: boolean | null, accessLink: unknown = { created_at: '2026-09-24T00:00:00Z', expires_at: '2026-10-08T00:00:00Z' }) => {
      const wrapper = mount(ParentAccessLinkPanel, {
        props: { visitId: 'case-a', accessLink: accessLink as never, canHandle: true, status: 'confirmed', email: 'p@example.org', emailEnabled },
        global: { plugins: [ElementPlus] },
      })
      wrappers.push(wrapper)
      return wrapper
    }

    it('不顯示重寄確認信、按鈕不寫並寄出，說明請用簡訊或 LINE 交給家長', () => {
      const wrapper = mountPanel(false)
      const labels = wrapper.findAll('button').map(b => b.text())
      expect(labels).not.toContain('重寄確認信')
      expect(labels).toContain('重新產生連結')
      expect(wrapper.text()).toContain('尚未設定寄信，請產生連結後用簡訊或 LINE 交給家長')
      expect(wrapper.text()).not.toContain('家長送出預約時已收到')
    })

    it('讀不到設定（null）時維持原本的按鈕', () => {
      const labels = mountPanel(null).findAll('button').map(b => b.text())
      expect(labels).toContain('重寄確認信')
      expect(labels).toContain('重新產生連結並寄出')
    })
  })

  describe('補登對話框', () => {
    async function mountDialog(config: unknown, slots: unknown[] = []) {
      vi.spyOn(api, 'get').mockImplementation(async path => (String(path).startsWith('/admin/booking-config/') ? config : slots) as never)
      const wrapper = mount(ManualVisitDialog, {
        props: { campusKeys: ['yihua'], modelValue: false },
        global: { plugins: [ElementPlus] },
        attachTo: document.body,
      })
      wrappers.push(wrapper)
      await wrapper.setProps({ modelValue: true })
      await flushPromises()
      return wrapper
    }

    it('Email 說明跟著寄信設定走', async () => {
      await mountDialog({ parent_email_enabled: false })
      expect(document.body.textContent).toContain('尚未設定寄信。補登後請到案件頁產生家長管理連結')
      expect(document.body.textContent).not.toContain('有填會寄確認信')
    })

    it('場次依日期分組，選項只寫時間與剩幾組，選好後整行寫出完整場次', async () => {
      const slot = (id: string, date: string, start: string) => ({ id, campus_key: 'yihua', slot_date: date, start_time: `${start}:00`, end_time: `${start.slice(0, 2)}:59:00`, capacity: 3, booked_count: 1, closed: false })
      const wrapper = await mountDialog({ parent_email_enabled: true }, [slot('b', '2099-10-02', '10:30'), slot('a', '2099-10-02', '09:30'), slot('c', '2099-10-03', '14:00')])
      const select = wrapper.findAllComponents({ name: 'ElSelect' }).find(s => s.props('placeholder') === '選擇場次')!
      expect(select.props('filterable')).toBe(true)
      expect(select.findAllComponents({ name: 'ElOptionGroup' }).map(g => g.props('label'))).toEqual(['2099/10/02（週五）', '2099/10/03（週六）'])
      select.vm.$emit('update:modelValue', 'a')
      await flushPromises()
      expect(document.body.textContent).toContain('已選：2099/10/02（週五）09:30–09:59，剩 2 組')
    })
  })

  describe('參觀場次當天清單', () => {
    it('場次開始後寫「尚未確認到場」，電話、孩子、來源掛上手機版面用的 class', () => {
      const slot = { id: 's1', campus_key: 'yihua', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 2, closed: false, version: 1, booked_count: 2,
        visits: [
          { id: 'v1', status: 'confirmed', parent_name: '黃志明', child_name: null, phone: '0911222333', source: 'web' },
          { id: 'v2', status: 'completed', parent_name: '王怡君', child_name: null, phone: '0911222444', source: 'web' },
        ] }
      const wrapper = mount(DayPanel, {
        props: { day: '2020-01-01', campusKey: 'yihua', slots: [slot], holiday: null, canManage: false },
        global: { plugins: [ElementPlus], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
      })
      wrappers.push(wrapper)
      const rows = wrapper.findAll('.calendar__visits li')
      expect(rows[0]!.find('.el-tag').text()).toBe('尚未確認到場')
      expect(rows[1]!.find('.el-tag').text()).toBe('已到場')
      expect(rows[0]!.find('a[href^="tel:"]').classes()).toContain('calendar__visit-phone')
      expect(rows[0]!.find('.calendar__visit-child').exists()).toBe(true)
      // 官網送出的來源欄留空、仍占著位置；不再寫承辦人（2026-10-06 拿掉）。
      expect(rows[0]!.find('.calendar__visit-source').text()).toBe('')
      expect(wrapper.text()).not.toContain('承辦')
      expect(wrapper.find('.calendar__slot .hint').text()).toContain('已結束')
    })
  })

  describe('狀態用詞與列表', () => {
    it('同一組詞：confirmed 叫預約正常、completed 叫已到場；時間已過還沒標記的用暖黃', () => {
      expect(visitStatus('confirmed').label).toBe('預約正常')
      expect(visitStatus('completed').label).toBe('已到場')
      expect(visitDisplay({ status: 'confirmed', display_status: 'past' })).toMatchObject({ label: '預約時間已過', tone: 'warning', sub: '尚未確認到場' })
      expect(visitDisplay({ status: 'completed', display_status: 'past' }).tone).toBe('info')
    })

    it('前端分組和後端同一個判準：場次開始那一刻起算時間已過', () => {
      const slot = { slot_date: '2026-10-02', start_time: '10:00:00' }
      expect(visitDisplayStatus('confirmed', slot, new Date('2026-10-02T09:59:00+08:00').getTime())).toBe('upcoming')
      expect(visitDisplayStatus('confirmed', slot, new Date('2026-10-02T10:00:00+08:00').getTime())).toBe('past')
      expect(visitDisplayStatus('no_show', slot)).toBe('past')
      // 2026-10-05：沒有 pending；舊狀態（new／contacting／pending_confirmation）也只依場次是否開始判斷。
      for (const legacy of ['new', 'contacting', 'pending_confirmation']) {
        expect(visitDisplayStatus(legacy, slot, new Date('2026-10-02T09:59:00+08:00').getTime())).toBe('upcoming')
        expect(visitDisplayStatus(legacy, slot, new Date('2026-10-02T10:00:00+08:00').getTime())).toBe('past')
        expect(visitDisplayStatus(legacy, null)).toBe('upcoming')
      }
      expect(visitDisplayStatus('cancelled', slot)).toBe('cancelled')
    })

    it('列表的參觀時間今年省略年份，跨年照寫', () => {
      const year = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Asia/Taipei' }).format(new Date())
      expect(formatShortSlotWhen({ slot_date: `${year}-10-22`, start_time: '09:30:00', end_time: '10:30:00' })).toMatch(/^10\/22（週.）09:30–10:30$/)
      expect(formatShortSlotWhen({ slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' })).toBe('2099/10/01（週四）10:00–11:00')
    })

    it('場次依日期分組、組內依時間排', () => {
      const s = (id: string, slot_date: string, start_time: string) => ({ id, slot_date, start_time, end_time: '23:00:00', capacity: 1, booked_count: 0 })
      expect(groupSlotsByDay([s('b', '2099-10-02', '10:30:00'), s('c', '2099-10-01', '09:00:00'), s('a', '2099-10-02', '09:30:00')]).map(g => [g.day, g.slots.map(x => x.id)]))
        .toEqual([['2099-10-01', ['c']], ['2099-10-02', ['a', 'b']]])
    })

    it('「只看尚未確認到場」送 view=past＆status=confirmed，網址寫 group=past＆status=confirmed；頁籤數字不受影響', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
      const pinia = createPinia()
      useAuthStore(pinia).user = testUser('super_admin')
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests', component: VisitRequestsView }, { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
      await router.push('/visit-requests?group=past&status=confirmed'); await router.isReady()
      const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
      wrappers.push(wrapper)
      await flushPromises()
      const calls = get.mock.calls.map(([p]) => String(p))
      const list = calls.find(p => p.startsWith('/admin/visit-requests?') && p.includes('page='))!
      expect(list).toContain('view=past')
      expect(list).toContain('status=confirmed')
      expect(calls.find(p => p.startsWith('/admin/visit-requests/view-counts'))).not.toContain('status=')
      expect(router.currentRoute.value.query).toMatchObject({ group: 'past', status: 'confirmed' })
      expect(wrapper.text()).toContain('沒有尚未確認到場的案件')
      // status=confirmed 會讓匯出變窄，所以算篩選：範圍說明不能只寫頁籤。
      expect(wrapper.get('#export-scope').text()).toContain('「時間已過」頁籤、目前篩選的全部結果')
    })
  })
})
