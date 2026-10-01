import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
const slot = { id: 'held-slot', slot_date: '2026-09-26', start_time: '10:00:00', end_time: '10:30:00' }
// 確認期限用遠在未來的時間：過了期限畫面會停用確認（後端也會拒絕）。
const details = (changes: Record<string, unknown> = {}) => ({ ...({ id: 'local-case', campus_key: 'yihua', status: 'pending_confirmation', parent_name: '測試家長', phone: '0912345678', child_name: '測試孩子', child_birthdate: '2022-06-18', email: 'parent@example.org', referral_sources: ['facebook', 'friends_family'], age: null, preferred_time: null, questions: null, slot_id: slot.id, slot, created_at: '2026-09-22T00:00:00Z', hold_expires_at: '2099-09-23T00:00:00Z' }), display_status: 'pending', cancel_reason: null, access_link: { created_at: '2026-09-30T00:00:00Z', expires_at: '2026-10-20T00:00:00Z' }, ...changes })
async function mountDetail(data: Record<string, unknown> = details(), user: UserOut = testUser('super_admin')) {
  vi.spyOn(api, 'get').mockImplementation(async path => (path.endsWith('/contact-notes') || path.startsWith('/admin/slots') || path.startsWith('/admin/visit-staff') || path.startsWith('/admin/visit-requests?')) ? [] : data as never)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/local-case'); await router.isReady()
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}


describe('自選場次後的案件明細', () => {
  it('舊的新需求只剩「排入場次」與取消，沒有聯絡中', async () => {
    const wrapper = await mountDetail(details({ status: 'new', display_status: 'pending', slot: null, slot_id: null, hold_expires_at: null }))
    expect(wrapper.text()).not.toContain('聯絡中')
    expect(wrapper.findAll('button').some(b => b.text() === '排入場次')).toBe(true)
  })

  it('已確認的案件：取消前說明會寄信給家長', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming', email: 'wang@example.com', hold_expires_at: null }))
    await wrapper.findAll('button').find(b => b.text() === '取消預約')!.trigger('click')
    expect(String(prompt.mock.calls[0]?.[0])).toContain('會寄信通知家長（w***@example.com）')
  })

  it('家長連結區可以重寄確認信', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ queued: true } as never)
    const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming', email: 'wang@example.com', hold_expires_at: null }))
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
