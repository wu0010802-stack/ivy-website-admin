import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
const slot = { id: 'held-slot', slot_date: '2026-09-26', start_time: '10:00:00', end_time: '10:30:00' }
const details = () => ({ id: 'local-case', campus_key: 'yihua', status: 'pending_confirmation', parent_name: '測試家長', phone: '0912345678', child_name: '測試孩子', child_birthdate: '2022-06-18', email: 'parent@example.org', referral_sources: ['facebook', 'friends_family'], age: null, preferred_time: null, questions: null, slot_id: slot.id, slot, created_at: '2026-09-22T00:00:00Z', hold_expires_at: '2026-09-23T00:00:00Z' })
async function setup(data: Record<string, unknown> = details()) {
  vi.spyOn(api, 'get').mockImplementation(async path => (path.endsWith('/contact-notes') || path.startsWith('/admin/slots') || path.startsWith('/admin/visit-staff') || path.startsWith('/admin/visit-requests?')) ? [] : data as never)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/local-case'); await router.isReady()
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: [] }
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
describe('參觀資料與已選場次', () => {
  it('明細可閱讀孩子、生日、Email、得知管道與待確認狀態', async () => {
    const wrapper = await setup()
    for (const text of ['測試孩子', '2022-06-18', 'parent@example.org', 'Facebook、親友介紹', '待園方確認', '10:00–10:30']) expect(wrapper.text()).toContain(text)
    expect(wrapper.find('a[href="mailto:parent@example.org"]').exists()).toBe(true)
  })
  it('人工確認使用家長已選的場次，不需再次選擇或新增預約', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const wrapper = await setup()
    await wrapper.findAll('button').find(button => button.text() === '確認已選場次')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/local-case/confirm', { slot_id: slot.id })
  })
})

describe('案件流程補完', () => {
  it('已確認的案件可以標記完成，也保留未到場', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    // 參觀日當天起才能標完成（main 的規則），所以用已過的場次。
    const past = { ...slot, slot_date: '2026-01-05' }
    const wrapper = await setup({ ...details(), status: 'confirmed', hold_expires_at: null, slot: past })
    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).toContain('標記未到場')
    await wrapper.findAll('button').find(button => button.text() === '完成參觀')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/local-case/complete')
  })

  it('新需求可以先標為聯絡中；家長要改時間時待確認可退回聯絡中', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const fresh = await setup({ ...details(), status: 'new', slot_id: null, slot: null, hold_expires_at: null })
    await fresh.findAll('button').find(button => button.text().startsWith('開始聯絡'))!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/local-case/contacting')
    fresh.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
    const post2 = vi.spyOn(api, 'post').mockResolvedValue({})
    const held = await setup()
    await held.findAll('button').find(button => button.text().includes('退回聯絡中'))!.trigger('click')
    await flushPromises()
    expect(post2).toHaveBeenCalledWith('/admin/visit-requests/local-case/contacting')
  })

  it('人工補登的案件顯示來源；只能查看的角色看不到處理按鈕', async () => {
    const wrapper = await setup({ ...details(), status: 'new', source: 'phone', slot_id: null, slot: null })
    expect(wrapper.text()).toContain('電話補登')

    wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/contact-notes') ? [] : details() as never)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-requests/local-case'); await router.isReady()
    const pinia = createPinia()
    useAuthStore(pinia).user = { id: 'reader', email: 'reader@example.invalid', role: 'reception', is_active: true, campus_keys: ['yihua'] }
    const readOnly = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(readOnly); await flushPromises()
    expect(readOnly.text()).toContain('只能查看案件')
    expect(readOnly.findAll('button').some(button => button.text() === '確認已選場次')).toBe(false)
  })
})
