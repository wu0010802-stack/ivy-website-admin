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

// 後端一定帶 counts.admissions（預設 0）與 days.admissions_days（預設 null）。
const counts = { cancelled: 2, no_show: 0, completed: 1, admissions: 0 }
const days = { cancelled_days: 365, completed_days: 730, open_overdue_days: 180, admissions_days: null as number | null }
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
  { id: 'r2', created_at: '2026-09-24T01:00:00Z', trigger: 'manual', actor_email: 'admin@ivy.example', days, counts: { cancelled: 4, no_show: 1, completed: 0, admissions: 0 }, total: 5, open_overdue_count: 2 },
]

async function setup(firstError?: Error, currentPolicy = policy(), runsResponse: () => Promise<unknown> = async () => runs) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/policies')
  await router.isReady()
  let siteError = firstError
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/admin/site-policies/retention')) return currentPolicy
    if (url.startsWith('/admin/retention-runs')) return runsResponse()
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

// 2026-10-20 稽核 #11：執行清理要帶確認當下的政策版本；別人剛改過天數就不清，重新試算給使用者再確認。
describe('立即清理綁住確認時的政策版本', () => {
  it('執行帶 expected_version', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
      url === '/admin/retention/dry-run' ? report : { ...report, dry_run: false, run_id: 'r3' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await setup(undefined, policy({ version: 7 }))
    await button(wrapper, '立即執行清理')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/admin/retention/run', { expected_version: 7 })
  })

  it('政策剛被改過（409）：提示重新試算、重抓政策與筆數，不顯示成功', async () => {
    const newer = { ...report, counts: { ...counts, cancelled: 300 }, total: 301 }
    let current = policy({ version: 1 })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
      if (url === '/admin/retention/dry-run') return report
      current = policy({ version: 2, cancelled_days: 30, preview: newer })
      throw new ApiError(409, { code: 'RETENTION_POLICY_VERSION_CONFLICT', message: '保存政策剛被其他人修改，請重新試算後再執行清理', current_version: 2 })
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper, get } = await setup(undefined, current)
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/admin/site-policies/retention')) return current
      if (url.startsWith('/admin/retention-runs')) return runs
      return site
    })
    await button(wrapper, '立即執行清理')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/admin/retention/run', { expected_version: 1 })
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '保存政策剛被其他人修改，這次沒有清理；已依新的天數重新試算，請確認筆數後再執行' }))
    expect(wrapper.get('.retention__preview').text()).toMatch(/現在執行會處理\s*301\s*筆/)
  })

  // 審查意見：頁面開著期間別人改過政策，確認框的筆數與送出的版本要來自同一次讀取，
  // 不然使用者確認的是新版筆數、送出的卻是舊版本，白吃一次 409。
  it('頁面開久了政策被改過：確認框與送出的版本都依最新政策', async () => {
    const newer = { ...report, counts: { ...counts, cancelled: 300 }, total: 301 }
    let current = policy({ version: 1 })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
      url === '/admin/retention/dry-run' ? newer : { ...newer, dry_run: false, run_id: 'r3' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    const { wrapper, get } = await setup(undefined, current)
    current = policy({ version: 2, cancelled_days: 30, preview: newer })
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/admin/site-policies/retention')) return current
      if (url.startsWith('/admin/retention-runs')) return runs
      return site
    })
    await button(wrapper, '立即執行清理')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('將匿名化 301 筆案件')
    expect(post).toHaveBeenLastCalledWith('/admin/retention/run', { expected_version: 2 })
    expect(warning).not.toHaveBeenCalled()
  })
})
