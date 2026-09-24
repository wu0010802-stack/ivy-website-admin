import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { diffPayload, summarizeValue } from '../composables/useContentItem'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const slot = { id: 'slot-1', slot_date: '2026-09-26', start_time: '10:00:00', end_time: '11:00:00' }
const base = () => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', parent_name: '到期家長', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: '2020-01-01T01:00:00Z',
})

function makePinia() {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: [], line_linked: false }
  return pinia
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: DashboardView },
      { path: '/visit-requests', component: VisitRequestsView },
      { path: '/visit-requests/:id', component: VisitDetailView },
      { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
    ],
  })
}

describe('到期待追蹤有來源也有入口', () => {
  it('總覽的到期數字連到只看到期案件的列表，列表把 follow_up_due 帶給後端', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (path === '/admin/dashboard') return { today_visits: 0, pending_follow_up: 2, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0 } as never
      return [base()] as never
    })
    const router = makeRouter()
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [makePinia(), router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    const link = wrapper.findAll('a').find(a => a.text().includes('查看到期案件'))!
    expect(link.attributes('href')).toBe('/visit-requests?due=1')
    await router.push('/visit-requests?due=1'); await flushPromises()
    const listCall = get.mock.calls.map(c => String(c[0])).find(p => p.startsWith('/admin/visit-requests?'))!
    expect(listCall).toContain('follow_up_due=true')
    expect(wrapper.text()).toContain('到期待追蹤 2020/01/01')
    expect(wrapper.find('a[href="tel:0912345678"]').exists()).toBe(true)
  })

  it('排序切成最早送出在前時把 order=oldest 帶給後端', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const router = makeRouter()
    await router.push('/visit-requests'); await router.isReady()
    const wrapper = mount(VisitRequestsView, { global: { plugins: [makePinia(), router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    const orderSelect = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.classes('order-select'))!
    orderSelect.vm.$emit('update:modelValue', 'oldest')
    await flushPromises()
    expect(String(get.mock.calls.at(-1)![0])).toContain('order=oldest')
  })

  it('聯絡紀錄可以一起記下次聯絡時間，並在頁首顯示已到期', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (path.endsWith('/contact-notes')) return [] as never
      if (path.startsWith('/admin/visit-requests?') || path.startsWith('/admin/slots')) return [] as never
      return base() as never
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const router = makeRouter()
    await router.push('/visit-requests/case-a'); await router.isReady()
    const wrapper = mount(VisitDetailView, { global: { plugins: [makePinia(), router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(wrapper.text()).toContain('已到預定聯絡時間')
    expect(wrapper.text()).not.toContain('家長填的年齡')
    await wrapper.find('textarea').setValue('家長說下週再聯絡')
    await wrapper.findAll('button').find(b => b.text() === '新增紀錄')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/contact-notes', { note: '家長說下週再聯絡', follow_up_at: null })
  })

  it('確認預約後先把「已致電家長」填進紀錄框，並提供下一筆待處理', async () => {
    const data = { ...base(), follow_up_at: null }
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (path.endsWith('/contact-notes')) return [] as never
      if (path.startsWith('/admin/slots')) return [{ ...slot, capacity: 3, booked_count: 0, closed: false }] as never
      if (path.startsWith('/admin/visit-requests?')) return [{ ...base(), id: 'case-b' }, { ...base(), id: 'case-a' }] as never
      return data as never
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ value: '', action: 'confirm' } as never)
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const router = makeRouter()
    await router.push('/visit-requests/case-a'); await router.isReady()
    const wrapper = mount(VisitDetailView, { global: { plugins: [makePinia(), router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(wrapper.text()).toContain('下一筆待處理（還有 1 件）')
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', slot.id)
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '確認並排入時段')!.trigger('click')
    await flushPromises()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toContain('已致電家長，告知參觀時間 2026/09/26')
  })
})

describe('發布前列出會變的欄位', () => {
  it('diffPayload 只列有變動的欄位並翻成中文', () => {
    const changes = diffPayload(
      { eyebrow: '舊小標', copy_lines: ['a', 'b'], cta_label: '預約參觀' },
      { eyebrow: '新小標', copy_lines: ['a', 'c'], cta_label: '預約參觀' },
    )
    expect(changes.map(c => c.label)).toEqual(['小標', '標語'])
    expect(changes[0]).toMatchObject({ before: '舊小標', after: '新小標' })
    expect(changes[1]).toMatchObject({ before: 'a／b', after: 'a／c' })
  })

  it('summarizeValue 把空白、長字串與清單壓成一行', () => {
    expect(summarizeValue('')).toBe('（空白）')
    expect(summarizeValue('x'.repeat(80))).toHaveLength(61)
    expect(summarizeValue([{ a: 1 }, { a: 2 }])).toBe('2 項')
  })
})
