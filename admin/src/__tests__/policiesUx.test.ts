import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import PoliciesView from '../views/PoliciesView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const site: { content: { site_meta?: Record<string, unknown> } } = { content: { site_meta: { description: '網站說明', share_image: '', allow_indexing: false } } }

const counts = { cancelled: 2, no_show: 0, completed: 1 }
const days = { cancelled_days: 365, completed_days: 730, open_overdue_days: 180 }
const report = { days, counts, total: 3, open_overdue_count: 4, dry_run: true, run_id: null }

function policy(overrides: Record<string, unknown> = {}) {
  return {
    ...days,
    auto_run_enabled: false,
    version: 1,
    updated_at: null,
    updated_by_email: null,
    last_scheduled_on: '2026-09-25',
    real_run_allowed: true,
    preview: report,
    ...overrides,
  }
}

const runs = [
  { id: 'r1', created_at: '2026-09-25T01:00:00Z', trigger: 'scheduled', actor_email: null, days, counts, total: 3, open_overdue_count: 0 },
  { id: 'r2', created_at: '2026-09-24T01:00:00Z', trigger: 'manual', actor_email: 'admin@ivy.example', days, counts: { cancelled: 4, no_show: 1, completed: 0 }, total: 5, open_overdue_count: 2 },
]

async function setup(firstError?: Error, currentPolicy = policy()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/policies')
  await router.isReady()
  let siteError = firstError
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/admin/site-policies/retention')) return currentPolicy
    if (url.startsWith('/admin/retention-runs')) return runs
    if (siteError) {
      const error = siteError
      siteError = undefined
      throw error
    }
    return site
  })
  const wrapper = mount(PoliciesView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)
}

describe('個資保存政策與全站設定保護', () => {
  it('顯示已儲存的保存天數、下次執行預估與清理紀錄', async () => {
    const { wrapper, get } = await setup()
    expect(get).toHaveBeenCalledWith('/admin/site-policies/retention')
    const numbers = wrapper.findAll('.retention-form input').map(input => (input.element as HTMLInputElement).value)
    expect(numbers.slice(0, 3)).toEqual(['365', '730', '180'])
    const preview = wrapper.get('.retention__preview').text()
    expect(preview).toMatch(/現在執行會處理\s*3\s*筆/)
    expect(preview).toMatch(/已取消\s*2\s*筆/)
    expect(preview).toMatch(/未到場\s*0\s*筆/)
    // 未結案的不清，只提醒件數並連到案件清單。
    expect(preview).toMatch(/另有\s*4\s*筆送出超過 180 天仍未結案，不會被清理/)
    expect(wrapper.find('.retention__overdue a[href="/visit-requests"]').exists()).toBe(true)
    const history = wrapper.get('.retention-runs').text()
    expect(history).toContain('定期工作')
    expect(history).toContain('已匿名化 3 筆')
    expect(history).toContain('手動執行・admin@ivy.example')
    expect(history).toContain('已匿名化 5 筆')
    expect(history).toContain('當時另有 2 筆超過天數仍未結案')
    expect(history).not.toContain('試算')
  })

  it('儲存政策帶 expected_version；別人先改過就載入最新的設定', async () => {
    const { wrapper } = await setup()
    const put = vi.spyOn(api, 'put')
      .mockRejectedValueOnce(new ApiError(409, { code: 'RETENTION_POLICY_VERSION_CONFLICT', message: '保存政策剛被其他人修改，請重新載入後再編輯' }))
    const warning = vi.spyOn(ElMessage, 'warning')
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 1, auto_run_enabled: true }))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('已載入最新的設定'))
    // 重新載入後表單回到伺服器上的值，不再是未儲存狀態。
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
  })

  it('立即清理前重新試算並確認，完成後重讀紀錄', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
      url === '/admin/retention/dry-run' ? report : { ...report, dry_run: false, run_id: 'r3' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper, get } = await setup()
    await button(wrapper, '立即執行清理')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls.map(([url]) => url)).toEqual(['/admin/retention/dry-run', '/admin/retention/run'])
    expect(confirm).toHaveBeenCalledOnce()
    expect(String(confirm.mock.calls[0]![0])).toContain('將匿名化 3 筆案件')
    expect(success).toHaveBeenCalledWith('已匿名化 3 筆案件')
    expect(get.mock.calls.filter(([url]) => String(url).startsWith('/admin/retention-runs'))).toHaveLength(2)
  })

  it('沒有到期案件時不能按清理，也不會出現未結案提醒', async () => {
    const empty = { ...report, counts: { cancelled: 0, no_show: 0, completed: 0 }, total: 0, open_overdue_count: 0 }
    const { wrapper } = await setup(undefined, policy({ preview: empty }))
    expect(button(wrapper, '立即執行清理')!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.retention__overdue').exists()).toBe(false)
  })

  it('部署設定沒開放真正清理時只能試算', async () => {
    const { wrapper } = await setup(undefined, policy({ real_run_allowed: false }))
    expect(button(wrapper, '立即執行清理')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('WEBSITE_RETENTION_ALLOW_REAL_RUN')
  })

  it('搜尋與分享只顯示官網發布中的 site_meta，連到網站標題與電話修改，不再有會誤導的表單', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper, get } = await setup()
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
    const seo = wrapper.get('.seo-summary').element.closest('section')!
    expect(seo.querySelector('textarea')).toBeNull()
    expect(seo.querySelector('input')).toBeNull()
    expect(seo.textContent).not.toContain('立即')
    expect(wrapper.text()).not.toContain('隱私政策版本')
    expect(patch).not.toHaveBeenCalled()
  })

  it('官網還沒發布過 site_meta 時說明沿用內建設定（允許收錄）', async () => {
    site.content = {}
    try {
      const { wrapper } = await setup()
      expect(wrapper.get('.seo-summary').text()).toContain('允許收錄')
      expect(wrapper.text()).toContain('還沒發布過網站標題與電話')
    } finally {
      site.content = { site_meta: { description: '網站說明', share_image: '', allow_indexing: false } }
    }
  })

  it('讀不到官網設定時顯示錯誤並可重新載入', async () => {
    const { wrapper } = await setup(new TypeError('Failed to fetch'))
    expect(wrapper.text()).toContain('無法讀取官網目前的設定')
    expect(wrapper.find('.seo-summary').exists()).toBe(false)
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.seo-summary').text()).toContain('不允許收錄')
  })

  it('官網從沒發布過任何內容時說明尚未發布，不當成讀取失敗（B11-R4）', async () => {
    const { wrapper } = await setup(new ApiError(503, { code: 'NO_PUBLISHED_CONTENT', message: '尚無可用內容' }))
    const notice = wrapper.get('.site-unpublished')
    expect(notice.text()).toContain('官網還沒發布過任何內容')
    expect(notice.find('a[href="/content/site-meta"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('無法讀取官網目前的設定')
    expect(button(wrapper, '重新載入')).toBeUndefined()
    expect(wrapper.find('.seo-summary').exists()).toBe(false)
  })

  it('其他 503（服務暫時無法使用）仍是讀取失敗', async () => {
    const { wrapper } = await setup(new ApiError(503, 'Service Unavailable'))
    expect(wrapper.text()).toContain('無法讀取官網目前的設定')
    expect(wrapper.find('.site-unpublished').exists()).toBe(false)
  })
})
