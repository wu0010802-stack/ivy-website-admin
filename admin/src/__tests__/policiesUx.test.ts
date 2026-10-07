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
import { RETENTION_CATEGORY_LABELS } from '../api/labels'

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

describe('個資與搜尋設定：保存政策的保護', () => {
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
    // 逾期未結案多半是場次已過、還沒標記的預約：連到「全部」＋只看未結案（預設的「接下來」看不到它們）。
    expect(wrapper.find('.retention__overdue a[href="/visit-requests?open=1"]').exists()).toBe(true)
    const history = wrapper.get('.retention-runs').text()
    expect(history).toContain('每天自動清理')
    expect(history).not.toContain('定期工作')
    expect(history).toContain('已匿名化 3 筆')
    // 執行的人寫名字（沒設定顯示名稱時是 Email @ 前面那段），完整 Email 在 title。
    expect(history).toContain('手動執行・admin')
    expect(history).not.toContain('admin@ivy.example')
    expect(wrapper.find('.retention-runs [title="admin@ivy.example"]').exists()).toBe(true)
    expect(history).toContain('已匿名化 5 筆')
    expect(history).toContain('當時另有 2 筆超過天數仍未結案')
    expect(history).not.toContain('試算')
  })

  it('儲存政策帶 expected_version；別人先改過就載入最新的設定', async () => {
    const { wrapper } = await setup()
    const put = vi.spyOn(api, 'put')
      .mockRejectedValueOnce(new ApiError(409, { code: 'RETENTION_POLICY_VERSION_CONFLICT', message: '保存政策剛被其他人修改，請重新載入後再編輯' }))
    const warning = vi.spyOn(ElMessage, 'warning')
    // 開啟自動清理會先確認（下一項測試細看確認內容）。
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 1, auto_run_enabled: true }))
    // 畫面已經自動重讀：不接後端「請重新載入後再編輯」，免得同一句話前後矛盾。
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '保存政策剛被其他人修改，已載入最新的設定；你的修改沒有儲存，請確認後再調整' }))
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

  it('系統沒開放真正清理時只能試算：原因只講一次、寫在按鈕旁，不出現設定名稱，開關仍可先設定', async () => {
    const { wrapper } = await setup(undefined, policy({ real_run_allowed: false }))
    const run = button(wrapper, '立即執行清理')!
    expect(run.attributes('disabled')).toBeDefined()
    const reason = wrapper.get('.retention__result .retention__blocked')
    expect(reason.text()).toContain('還沒開放真正清理')
    expect(run.attributes('aria-describedby')).toBe(reason.attributes('id'))
    expect(wrapper.text().match(/還沒開放真正清理/g)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('WEBSITE_RETENTION_ALLOW_REAL_RUN')
    expect(wrapper.text()).not.toContain('部署設定')
    expect(wrapper.text()).not.toContain('定期工作')
    expect(wrapper.get('.retention-form .el-switch').classes()).not.toContain('is-disabled')
  })

  it('立即執行清理按不了時說明原因：有未儲存的修改、沒有到期案件', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('.retention__blocked').exists()).toBe(false)
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    expect(wrapper.get('.retention__blocked').text()).toContain('先儲存政策')
    const empty = { ...report, counts: { cancelled: 0, no_show: 0, completed: 0 }, total: 0, open_overdue_count: 0 }
    const second = await setup(undefined, policy({ preview: empty }))
    expect(second.wrapper.get('.retention__blocked').text()).toContain('沒有到期的案件')
  })

  it('天數欄帶單位與換算', async () => {
    const { wrapper } = await setup()
    const fields = wrapper.findAll('.days-field').map(field => field.text())
    expect(fields[0]).toMatch(/結案後保留\s*天（約 1 年）/)
    expect(fields[1]).toContain('天（約 2 年）')
    expect(fields[2]).toContain('天仍未結案（約 6 個月）')
  })

  it('開啟每天自動清理要先確認，寫出依目前天數會清掉幾筆；只切開關時照常顯示試算', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue(policy({ auto_run_enabled: true, version: 2 }) as never)
    const { wrapper } = await setup()
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    // 天數沒動：試算仍然準，不顯示「天數還沒儲存」。
    const preview = wrapper.get('.retention__preview').text()
    expect(preview).not.toContain('天數還沒儲存')
    expect(preview).toMatch(/現在執行會處理\s*3\s*筆/)
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    const [message, title, options] = confirm.mock.calls[0]! as unknown as [string, string, Record<string, string>]
    expect(title).toBe('確定開啟每天自動清理？')
    expect(message).toContain('約一分鐘內就會執行第一次')
    expect(message).toContain('依目前天數會匿名化 3 筆（已取消 2 筆、未到場 0 筆、已完成參觀 1 筆）')
    expect(message).toContain('無法復原')
    expect(options).toMatchObject({ confirmButtonText: '開啟自動清理', cancelButtonText: '先不要', confirmButtonClass: 'el-button--danger' })
    expect(put).toHaveBeenCalledOnce()
  })

  it('自動清理開著時縮短天數：確認框寫依舊天數的筆數、縮短後會更多；按先不要就不儲存', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const put = vi.spyOn(api, 'put')
    const { wrapper } = await setup(undefined, policy({ auto_run_enabled: true }))
    const days = wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!
    days.vm.$emit('update:modelValue', 180)
    await flushPromises()
    expect(wrapper.get('.retention__preview').text()).toContain('天數還沒儲存')
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    const [message, title] = confirm.mock.calls[0]! as unknown as [string, string]
    expect(title).toBe('確定縮短保留天數？')
    expect(message).toContain('依舊天數有 3 筆，縮短後會更多，確切筆數儲存後才知道')
    expect(message).not.toContain('將匿名化')
    expect(put).not.toHaveBeenCalled()
  })

  it('延長天數、關閉自動清理或自動清理沒開時改天數，不必確認', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const put = vi.spyOn(api, 'put').mockResolvedValue(policy() as never)
    const on = await setup(undefined, policy({ auto_run_enabled: true }))
    on.wrapper.findAllComponents({ name: 'ElInputNumber' })[1]!.vm.$emit('update:modelValue', 1095)
    await flushPromises()
    await button(on.wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    const off = await setup()
    off.wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 60)
    await flushPromises()
    await button(off.wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('系統還沒開放真正清理時開啟自動清理，確認框說明儲存後還不會執行', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const { wrapper } = await setup(undefined, policy({ real_run_allowed: false }))
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('儲存後還不會執行')
  })

  it('清理紀錄讀取中顯示骨架，不先閃出「還沒有清理紀錄」', async () => {
    let resolveRuns: (value: unknown) => void = () => {}
    const { wrapper } = await setup(undefined, policy(), () => new Promise(resolve => { resolveRuns = resolve }))
    expect(wrapper.text()).not.toContain('還沒有清理紀錄')
    expect(wrapper.find('.retention-runs__loading').exists()).toBe(true)
    resolveRuns([])
    await flushPromises()
    expect(wrapper.find('.retention-runs__loading').exists()).toBe(false)
    expect(wrapper.text()).toContain('還沒有清理紀錄')
  })

  it('可以設定的保存政策排在最前面，唯讀的搜尋與分享摘要在頁底', async () => {
    const { wrapper } = await setup()
    const headings = wrapper.findAll('.panel__head h2').map(h => h.text())
    expect(headings).toEqual(['個資保存政策', '清理紀錄', '搜尋與分享'])
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
    // 不給園方看 robots.txt、sitemap.xml 這類工程語。
    expect(summary).toContain('搜尋引擎')
    expect(summary).not.toContain('robots.txt')
    expect(summary).not.toContain('sitemap')
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

describe('招生訪視的保存天數（規格第 11 節）', () => {
  const withAdmissions = (overrides: Record<string, unknown> = {}) => {
    const admissionsDays = (overrides.admissions_days as number | null | undefined) ?? null
    return policy({ preview: { ...report, days: { ...days, admissions_days: admissionsDays } }, ...overrides })
  }

  it('報表類別有招生訪視', () => {
    expect(RETENTION_CATEGORY_LABELS.admissions).toBe('招生訪視')
  })

  it('留空＝不自動清理；欄位放在未結案提醒之後，前三欄位置不變；天數 null 且 0 筆時試算不列招生訪視', async () => {
    const { wrapper } = await setup(undefined, withAdmissions())
    const fields = wrapper.findAll('.days-field').map((field) => field.text())
    expect(fields[2]).toContain('天仍未結案')
    expect(fields[3]).toContain('最後更新後保留')
    expect(fields[3]).toContain('留空＝不自動清理')
    const input = wrapper.findAll('.retention-form input')[3]!
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('placeholder')).toBe('不自動清理')
    expect(wrapper.get('.retention__preview').text()).not.toContain('招生訪視')
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
  })

  it('有設天數時，試算列出招生訪視（0 筆也列）', async () => {
    const { wrapper } = await setup(undefined, withAdmissions({ admissions_days: 365 }))
    expect(wrapper.get('.retention__preview').text()).toMatch(/招生訪視\s*0\s*筆/)
  })

  it('沒設天數但有筆數時，試算仍列出招生訪視', async () => {
    const preview = { ...report, counts: { ...counts, admissions: 2 }, total: 5 }
    const { wrapper } = await setup(undefined, withAdmissions({ preview }))
    expect(wrapper.get('.retention__preview').text()).toMatch(/招生訪視\s*2\s*筆/)
  })

  it('填天數就送出；輸入框限制 30–3650，清空送 null', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue(withAdmissions({ admissions_days: 365, version: 2 }) as never)
    const { wrapper } = await setup(undefined, withAdmissions())
    const number = wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!
    expect(number.props()).toMatchObject({ min: 30, max: 3650, valueOnClear: null })
    number.vm.$emit('update:modelValue', 365)
    await flushPromises()
    expect(wrapper.findAll('.days-field')[3]!.text()).toContain('（約 1 年）')
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 1, admissions_days: 365 }))

    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 2, admissions_days: null }))
  })

  it('自動清理開著時，第一次設定招生訪視天數等於開始清理：先確認，按先不要就不儲存', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const put = vi.spyOn(api, 'put')
    const { wrapper } = await setup(undefined, withAdmissions({ auto_run_enabled: true }))
    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', 730)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    const [message, title] = confirm.mock.calls[0]! as unknown as [string, string]
    expect(title).toBe('確定縮短保留天數？')
    expect(message).toContain('招生訪視到期會清除孩子與聯絡人的個資')
    expect(put).not.toHaveBeenCalled()
  })

  it('F6b：自動清理從關到開、招生訪視已設天數：確認框也提招生訪視個資會清除', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const { wrapper } = await setup(undefined, withAdmissions({ admissions_days: 365 }))
    await wrapper.get('.retention-form .el-switch').trigger('click')
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    const [message, title] = confirm.mock.calls[0]! as unknown as [string, string]
    expect(title).toBe('確定開啟每天自動清理？')
    expect(message).toContain('招生訪視到期會清除孩子與聯絡人的個資')
  })

  it('改成不自動清理（清空）不必確認', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const put = vi.spyOn(api, 'put').mockResolvedValue(withAdmissions({ auto_run_enabled: true, version: 2 }) as never)
    const { wrapper } = await setup(undefined, withAdmissions({ auto_run_enabled: true, admissions_days: 365 }))
    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledOnce()
  })

  it('清理紀錄寫出招生訪視筆數與天數；天數 null 且 0 筆的舊紀錄文字不變', async () => {
    const newer = { ...runs[0]!, counts: { ...counts, admissions: 2 }, days: { ...days, admissions_days: 365 } }
    const { wrapper } = await setup(undefined, withAdmissions({ admissions_days: 365 }), async () => [newer, runs[1]!])
    const items = wrapper.findAll('.retention-runs__item').map((item) => item.text())
    expect(items[0]).toMatch(/招生訪視\s*2\s*筆/)
    expect(items[0]).toContain('招生訪視 365 天')
    expect(items[1]).not.toContain('招生訪視')
  })
})
