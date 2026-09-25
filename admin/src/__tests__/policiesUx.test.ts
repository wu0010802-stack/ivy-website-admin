import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import PoliciesView from '../views/PoliciesView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const site: { content: { site_meta?: Record<string, unknown> } } = { content: { site_meta: { description: '網站說明', share_image: '', allow_indexing: false } } }

async function setup(firstError?: Error) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/policies')
  await router.isReady()
  const get = vi.spyOn(api, 'get').mockResolvedValue(site)
  if (firstError) get.mockRejectedValueOnce(firstError)
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

  it('搜尋與分享只顯示官網發布中的 site_meta，連到網站標題與電話修改，不再有會誤導的表單', async () => {
    const patch = vi.spyOn(api, 'patch')
    const wrapper = await setup()
    const get = vi.mocked(api.get)
    expect(get).toHaveBeenCalledWith('/public/site')
    expect(get.mock.calls.some(([url]) => String(url).includes('site-settings'))).toBe(false)
    const summary = wrapper.get('.seo-summary').text()
    expect(summary).toContain('不允許收錄')
    expect(summary).toContain('網站說明')
    expect(summary).toContain('沿用首頁大圖')
    expect(summary).toContain('robots.txt 與 sitemap.xml')
    expect(wrapper.find('a[href="/content/site-meta"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/content/booking-content"]').exists()).toBe(true)
    // 沒有可以在這裡儲存的欄位，也不再宣稱「儲存後官網立即生效」。
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('立即')
    expect(wrapper.text()).not.toContain('隱私政策版本')
    expect(patch).not.toHaveBeenCalled()
  })

  it('官網還沒發布過 site_meta 時說明沿用內建設定（允許收錄）', async () => {
    site.content = {}
    try {
      const wrapper = await setup()
      expect(wrapper.get('.seo-summary').text()).toContain('允許收錄')
      expect(wrapper.text()).toContain('還沒發布過網站標題與電話')
    } finally {
      site.content = { site_meta: { description: '網站說明', share_image: '', allow_indexing: false } }
    }
  })

  it('讀不到官網設定時顯示錯誤並可重新載入', async () => {
    const wrapper = await setup(new TypeError('Failed to fetch'))
    expect(wrapper.text()).toContain('無法讀取官網目前的設定')
    expect(wrapper.find('.seo-summary').exists()).toBe(false)
    await button(wrapper, '重新載入').trigger('click')
    await flushPromises()
    expect(wrapper.get('.seo-summary').text()).toContain('不允許收錄')
  })
})
