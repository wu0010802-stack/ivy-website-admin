import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
const slot = { id: 'held-slot', slot_date: '2026-09-26', start_time: '10:00:00', end_time: '10:30:00' }
// 預設是已確認的案件（官網送單與後台補登都是當場排進場次）。
const details = (changes: Record<string, unknown> = {}) => ({ ...({ id: 'local-case', campus_key: 'yihua', status: 'confirmed', parent_name: '測試家長', phone: '0912345678', child_name: '測試孩子', child_birthdate: '2022-06-18', email: 'parent@example.org', referral_sources: ['facebook', 'friends_family'], age: null, preferred_time: null, questions: null, slot_id: slot.id, slot, created_at: '2026-09-22T00:00:00Z' }), display_status: 'upcoming', cancel_reason: null, access_link: { created_at: '2026-09-30T00:00:00Z', expires_at: '2026-10-20T00:00:00Z' }, ...changes })
// bookingConfig：undefined＝沿用 data（舊行為）、null＝讀不到（模擬沒有權限）、物件＝該校預約設定。
async function mountDetail(data: Record<string, unknown> = details(), user: UserOut = testUser('super_admin'), bookingConfig?: Record<string, unknown> | null) {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.startsWith('/admin/booking-config') && bookingConfig !== undefined) { if (bookingConfig === null) throw new Error('403'); return bookingConfig as never }
    return (path.endsWith('/contact-notes') || path.startsWith('/admin/slots') || path.startsWith('/admin/visit-staff') || path.startsWith('/admin/visit-requests?')) ? [] : data as never
  })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/local-case'); await router.isReady()
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}


describe('自選場次後的案件明細', () => {
  it('舊的新需求（改版前留下的）沒有「排入場次」也沒有聯絡中，取消區也不顯示', async () => {
    const wrapper = await mountDetail(details({ status: 'new', display_status: 'pending', slot: null, slot_id: null }))
    expect(wrapper.text()).not.toContain('聯絡中')
    expect(wrapper.findAll('button').some(b => b.text() === '排入場次')).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text().includes('取消'))).toBe(false)
  })

  it('已確認的案件：取消前說明會寄信給家長', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming', email: 'wang@example.com' }), testUser('super_admin'), { parent_email_enabled: true })
    await wrapper.findAll('button').find(b => b.text() === '取消預約')!.trigger('click')
    expect(String(prompt.mock.calls[0]?.[0])).toContain('會寄信通知家長（w***@example.com）')
  })

  it('家長連結區可以重寄確認信', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ queued: true } as never)
    const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming', email: 'wang@example.com' }))
    await wrapper.findAll('button').find(b => b.text() === '重寄確認信')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/local-case/resend-confirmation')
  })

  it('補登一定要選場次', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const wrapper = mount(ManualVisitDialog, { props: { campusKeys: ['yihua'], modelValue: true }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain('參觀場次')
    expect(document.body.textContent).not.toContain('還沒談好時間就留空')
    wrapper.unmount()
  })
})

describe('階段 A 帶過來的後台顯示', () => {
  it('家長修改資料的歷程列出改了哪些欄位（不寫內容）', async () => {
    const { visitEventChanges } = await import('../api/visitHistory')
    const lines = visitEventChanges({ id: 'h1', event_type: 'details_updated', source: 'parent', before: null, after: { fields: ['phone', 'party_size', 'questions'] } } as never)
    expect(lines).toEqual(['修改欄位：手機、參觀人數、想了解的事'])
  })

  it('改期申請失效的標籤不寫「園方」（家長自己改期也會讓它失效）', async () => {
    const { visitEventLabel } = await import('../api/labels')
    expect(visitEventLabel('reschedule_superseded')).toBe('家長的改期申請失效（已直接改期）')
  })

  it('重新產生連結沒寄信（emailed=false）時提示園方自行轉交，不說已寄出', async () => {
    const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming', email: null, access_link: null }))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(api, 'post').mockResolvedValue({ manage_url: 'https://x/visit/manage#token=abc', manage_url_fragment: '/visit/manage#token=abc', expires_at: '2026-10-20T00:00:00Z', replaced_previous: false, emailed: false } as never)
    await wrapper.findAll('button').find(b => b.text() === '產生連結')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('沒有寄信，請把連結直接交給家長')
    expect(wrapper.text()).not.toContain('已寄到家長信箱')
  })
})

describe('審查修正：寄信說明與下一筆', () => {
  const confirmedCase = (changes: Record<string, unknown> = {}) => details({ status: 'confirmed', display_status: 'upcoming', email: 'wang@example.com', ...changes })
  const cancelMessage = async (config: Record<string, unknown> | null, data: Record<string, unknown>) => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    const wrapper = await mountDetail(data, testUser('super_admin'), config)
    await wrapper.findAll('button').find(b => b.text().includes('取消'))!.trigger('click')
    return String(prompt.mock.calls[0]?.[0])
  }

  it('沒設定寄信：說請電話通知，不說會寄信', async () => {
    const message = await cancelMessage({ mode: 'slots', parent_email_enabled: false }, confirmedCase())
    expect(message).toContain('尚未設定寄信')
    expect(message).not.toContain('會寄信通知家長')
  })

  it('寄信啟用：說會寄信', async () => {
    const message = await cancelMessage({ mode: 'slots', parent_email_enabled: true }, confirmedCase({ email: 'parent@example.org' }))
    expect(message).toContain('會寄信通知家長（p***@example.org）')
  })

  it('讀不到寄信設定（沒有權限）時不亂保證：提醒確認是否另外通知', async () => {
    const message = await cancelMessage(null, confirmedCase())
    expect(message).not.toContain('會寄信通知家長')
    expect(message).toContain('請確認是否需要另外通知家長')
  })

  it('舊的待確認案件沒有家長管理連結區與取消區（只有已確認才有）', async () => {
    const wrapper = await mountDetail(details({ status: 'pending_confirmation', display_status: 'pending', email: 'wang@example.com' }))
    expect(wrapper.findAll('button').some(b => b.text().startsWith('重新產生連結') || b.text() === '產生連結')).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text().includes('取消'))).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text() === '確認這個場次')).toBe(false)
  })

  it('案件頁照列表的分組查「下一筆」，不把 group 丟掉', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-requests?')) return [] as never
      if (path.endsWith('/contact-notes') || path.startsWith('/admin/slots') || path.startsWith('/admin/visit-staff') || path.startsWith('/admin/booking-config')) return [] as never
      return details({ status: 'confirmed', display_status: 'upcoming' }) as never
    })
    const router = (await import('vue-router')).createRouter({ history: (await import('vue-router')).createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: { template: '<div />' } }] })
    await router.push('/visit-requests/local-case?list=' + encodeURIComponent('group=upcoming&order=oldest')); await router.isReady()
    const pinia = createPinia(); useAuthStore(pinia).user = testUser('super_admin')
    wrappers.push(mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })); await flushPromises()
    const listCalls = get.mock.calls.map(c => String(c[0])).filter(p => p.startsWith('/admin/visit-requests?'))
    expect(listCalls.some(p => p.includes('group=upcoming'))).toBe(true)
  })
})
