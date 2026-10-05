// 2026-10-02 接待工作流 UX 修正：已開始的場次先標記到場、狀態用詞一致、
// 寄信沒設定時不承諾寄信、場次選單分組、參觀場次當天清單的狀態與觸控尺寸。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import DayPanel from '../components/sessions/DayPanel.vue'
import { api } from '../api/client'
import { formatShortSlotWhen, visitDisplay, visitDisplayStatus, visitStatus } from '../api/labels'
import { groupSlotsByDay } from '../utils/sessions'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); document.body.innerHTML = '' })

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const confirmedCase = (extra = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: null,
  child_birthdate: null, email: 'p@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T00:00:00.123Z', cancelled_at: null, source: 'web', display_status: 'past',
  history: [], pending_reschedule: null, access_link: null, ...extra,
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
  it('先問家長到了嗎，兩顆實心按鈕排在改期前面；改期收成連結', async () => {
    const wrapper = await mountDetail(confirmedCase())
    const actions = wrapper.find('.detail__actions')
    const attendance = actions.find('.detail__attendance')
    expect(attendance.text()).toContain('家長到了嗎？')
    const buttons = attendance.findAll('button')
    expect(buttons.map(b => b.text())).toEqual(['標記已到場', '標記未到場'])
    expect(buttons[0]!.classes()).toContain('el-button--primary')
    expect(buttons.every(b => !b.classes().includes('is-text'))).toBe(true)
    expect(actions.html().indexOf('detail__attendance')).toBeLessThan(actions.html().indexOf('reschedule'))
    expect(actions.find('.reschedule--collapsed').text()).toBe('改到其他場次…')
    expect(actions.text()).not.toContain('改到這一場')
    expect(wrapper.find('.detail__danger').text()).toContain('家長沒來請用上方的標記未到場')
  })

  it('取消預約的確認框提醒家長沒來要標記未到場', async () => {
    const wrapper = await mountDetail(confirmedCase())
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel' as never)
    await wrapper.find('.detail__cancel').trigger('click')
    expect(String(prompt.mock.calls[0]![0])).toContain('家長沒來請改用上方的「標記未到場」')
  })

  it('頁首和列表同一種說法：預約時間已過・尚未確認到場；確認時間和送出同一分鐘不重複列', async () => {
    const wrapper = await mountDetail(confirmedCase())
    const head = wrapper.find('.detail__status')
    expect(head.text()).toContain('預約時間已過')
    expect(head.find('.detail__status-sub').text()).toBe('尚未確認到場')
    expect(wrapper.text()).not.toContain('確認時間')
    expect(wrapper.text()).not.toContain('方便接電話時段')
  })

  // 2026-10-05 第九輪：還沒開始的場次也先收成連結（見 ux20261005.test.ts）。
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
  it('場次開始後寫「尚未確認到場」，電話、孩子、承辦掛上手機版面用的 class', () => {
    const slot = { id: 's1', campus_key: 'yihua', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 2, closed: false, version: 1, booked_count: 2,
      visits: [
        { id: 'v1', status: 'confirmed', parent_name: '黃志明', child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null },
        { id: 'v2', status: 'completed', parent_name: '王怡君', child_name: null, phone: '0911222444', source: 'web', assigned_staff_id: null },
      ] }
    const wrapper = mount(DayPanel, {
      props: { day: '2020-01-01', campusKey: 'yihua', slots: [slot], holiday: null, canManage: false, staff: [] },
      global: { plugins: [ElementPlus], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    wrappers.push(wrapper)
    const rows = wrapper.findAll('.calendar__visits li')
    expect(rows[0]!.find('.el-tag').text()).toBe('尚未確認到場')
    expect(rows[1]!.find('.el-tag').text()).toBe('已到場')
    expect(rows[0]!.find('a[href^="tel:"]').classes()).toContain('calendar__visit-phone')
    expect(rows[0]!.find('.calendar__visit-child').exists()).toBe(true)
    expect(rows[0]!.find('.calendar__visit-staff').exists()).toBe(true)
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
    expect(visitDisplayStatus('pending_confirmation', slot)).toBe('pending')
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

  it('「只看尚未確認到場」送 group=past＆status=confirmed，網址也寫這兩個；分頁數字不受影響', async () => {
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
    expect(list).toContain('group=past')
    expect(list).toContain('status=confirmed')
    expect(calls.find(p => p.startsWith('/admin/visit-requests/group-counts'))).not.toContain('status=')
    expect(router.currentRoute.value.query).toMatchObject({ group: 'past', status: 'confirmed' })
    expect(wrapper.text()).toContain('沒有尚未確認到場的案件')
  })
})
