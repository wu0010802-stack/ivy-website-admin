import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import PoliciesView from '../views/PoliciesView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: ['yihua'], line_linked: false }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/policies')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue({ title: '常春藤', description: '網站說明', share_image: null, noindex: true, privacy_policy_version: '2026-09' })
  const wrapper = mount(PoliciesView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)!
}
const report = { candidate_count: 2, candidate_ids: ['candidate-1', 'candidate-2'] }

describe('個資清理與全站設定保護', () => {
  it('重新檢查數量失敗後移除舊報告，不能沿用舊結果執行清理', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(report).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup()
    await button(wrapper, '檢查數量').trigger('click')
    await flushPromises()
    expect(wrapper.get('.retention__result').text()).toMatch(/2\s*筆符合清理條件/)
    expect(button(wrapper, '執行清理')).toBeDefined()
    await button(wrapper, '檢查數量').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('查詢失敗')
    expect(wrapper.find('.retention__result').exists()).toBe(false)
    expect(button(wrapper, '執行清理')).toBeUndefined()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.every(([url]) => String(url).includes('/retention/dry-run?'))).toBe(true)
    expect(button(wrapper, '檢查數量').classes()).not.toContain('is-loading')
  })

  it('清理發生網路錯誤時提示結果未確認，必須重新檢查數量', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(report).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup()
    await button(wrapper, '檢查數量').trigger('click')
    await flushPromises()
    await button(wrapper, '執行清理').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(post).toHaveBeenLastCalledWith('/admin/retention/run?older_than_days=365')
    expect(error).toHaveBeenCalledWith('無法確認清理結果，請重新檢查數量後再操作。')
    expect(wrapper.find('.retention__result').exists()).toBe(false)
    expect(button(wrapper, '執行清理')).toBeUndefined()
    expect(button(wrapper, '檢查數量').classes()).not.toContain('is-loading')
  })

  it('未儲存表單在重新整理時攔截，乾淨表單則不攔截', async () => {
    const wrapper = await setup()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await wrapper.get('textarea').setValue('尚未儲存的新描述')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    expect(wrapper.text()).toContain('有未儲存的修改')
  })
})
