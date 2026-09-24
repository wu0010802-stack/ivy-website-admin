import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { api } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
const slot = { id: 'held-slot', slot_date: '2026-09-26', start_time: '10:00:00', end_time: '10:30:00' }
const details = () => ({ id: 'local-case', campus_key: 'yihua', status: 'pending_confirmation', parent_name: '測試家長', phone: '0912345678', child_name: '測試孩子', child_birthdate: '2022-06-18', email: 'parent@example.org', referral_sources: ['facebook', 'friends_family'], age: null, preferred_time: null, questions: null, slot_id: slot.id, slot, created_at: '2026-09-22T00:00:00Z', hold_expires_at: '2026-09-23T00:00:00Z' })
async function setup(data = details()) {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/contact-notes') ? [] : data as never)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/local-case'); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [createPinia(), router, ElementPlus] } })
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
