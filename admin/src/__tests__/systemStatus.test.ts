// 系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）：
// 文案與連結、頁面、側欄與權限、總覽一行；後端步驟名與公開資料清單都要有中文。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import SystemStatusView from '../views/SystemStatusView.vue'
import DashboardView from '../views/DashboardView.vue'
import { ApiError, api } from '../api/client'
import type { SystemStatusItem, SystemStatusOut, UserOut } from '../api/types'
import { authGuard, routes } from '../router'
import { canListNavItem, navItem, NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { campusAdmin, cleanup, mountWith, reception } from './admissionsTestKit'
import { testUser } from './fixtures'
import { DATASET_LABELS, ITEM_LABELS, STEP_LABELS, describeItem, itemLink } from '../utils/systemStatusFormat'

const backendSources = import.meta.glob('../../../backend/app/**/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
function source(path: string): string {
  const key = Object.keys(backendSources).find((k) => k.endsWith(path))
  if (!key) throw new Error(`找不到後端檔案 ${path}`)
  return backendSources[key]!
}

const item = (key: string, level: SystemStatusItem['level'], detail: Record<string, unknown> = {}): SystemStatusItem => ({ key, level, detail })

function status(overrides: Partial<SystemStatusOut> = {}): SystemStatusOut {
  return {
    generated_at: '2026-10-15T04:00:00Z',
    attention_count: 1,
    services: [item('smtp', 'attention'), item('turnstile', 'info', { configured: false }), item('media_storage', 'info', { storage: 'local' })],
    background: [item('maintenance', 'ok', { running: true, interval_seconds: 60, stale_minutes: 5, last_completed_at: '2026-10-15T03:59:00Z', last_clean_at: '2026-10-15T03:59:00Z', failed_steps: [], stalled: false })],
    datasets: [item('doorplates', 'ok', { imported: true, label: '115-10', synced_at: '2026-10-10T00:00:00Z', checked_at: null, error: null, stale: false, stale_days: 35, auto_sync_off: false })],
    notifications: [item('failed_outbox', 'ok', { count: 0 }), item('failed_publish_jobs', 'info', { count: 2 })],
    ...overrides,
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('後端清單都有中文', () => {
  it('維護排程的每個步驟、每種公開資料、每個列 key 都有中文', () => {
    const steps = new Set([...source('workers/maintenance.py').matchAll(/failed_steps\.append\("([a-z_]+)"\)/g)].map((m) => m[1]!))
    expect(steps.size).toBeGreaterThan(5)
    expect([...steps].filter((step) => !STEP_LABELS[step])).toEqual([])

    const block = source('admissions/geo/models.py').match(/^DATASETS = \(([\s\S]*?)\)/m)![1]!
    const datasets = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).filter((name) => name !== 'campuses')
    expect(datasets.length).toBeGreaterThan(5)
    expect(datasets.filter((name) => !DATASET_LABELS[name])).toEqual([])

    const statusSource = source('operations/system_status.py')
    const keys = new Set([...statusSource.matchAll(/(?:key=|configured\(|switch\()"([a-z_]+)"/g)].map((m) => m[1]!))
    expect(keys.size).toBeGreaterThan(10)
    expect([...keys].filter((key) => !ITEM_LABELS[key])).toEqual([])
  })
})

describe('文案', () => {
  it('寄信：有設時寫寄件地址與主機，測試環境寫本機資料夾，沒設時說清楚影響', () => {
    expect(describeItem(item('smtp', 'ok', { host: 'smtp.example.com', port: 587, security: 'starttls', sender: 'noreply@ivy.example' }), 'services'))
      .toBe('寄件地址 noreply@ivy.example，主機 smtp.example.com:587（STARTTLS）')
    expect(describeItem(item('smtp', 'info', { sink: true }), 'services')).toBe('寫入本機資料夾（測試用）')
    expect(describeItem(item('smtp', 'attention'), 'services')).toContain('家長確認信、參觀提醒、停課通知與重設密碼連結都寄不出去')
  })

  it('門牌要注意時一律寫手動匯入（過期或自動下載失敗都一樣）', () => {
    const stale = item('doorplates', 'attention', { imported: true, label: '115-09', stale: true, error: null, stale_days: 35 })
    const failed = item('doorplates', 'attention', { imported: true, label: '115-10', stale: false, error: '連不上', stale_days: 35 })
    for (const row of [stale, failed]) expect(describeItem(row, 'datasets')).toContain('匯入指令更新門牌')
  })

  it('其他公開資料：失敗寫原因、過期寫天數、沒匯入寫尚未匯入、正常寫版本與更新時間', () => {
    expect(describeItem(item('income', 'attention', { imported: true, label: '112', error: 'HTTP 503', stale: false, stale_days: 33 }), 'datasets')).toBe('最近一次同步失敗：HTTP 503')
    expect(describeItem(item('births', 'attention', { imported: true, label: '115-09', error: null, stale: true, stale_days: 33, auto_sync_off: false }), 'datasets')).toBe('超過 33 天沒有更新')
    expect(describeItem(item('income', 'info', { imported: false, error: null, stale: false }), 'datasets')).toBe('尚未匯入')
    expect(describeItem(item('births', 'ok', { imported: true, label: '115-09', synced_at: '2026-10-10T00:00:00Z', checked_at: '2026-10-14T00:00:00Z', error: null, stale: false, stale_days: 33, auto_sync_off: false }), 'datasets'))
      .toBe('版本 115-09・更新於 2026/10/10 08:00・最後確認 2026/10/14 08:00')
  })

  it('公開資料過期但自動同步沒開：說明寫出自動同步沒開，同步出過錯時仍先寫原因', () => {
    const stale = { imported: true, label: '115-09', error: null, stale: true, stale_days: 33, auto_sync_off: true }
    expect(describeItem(item('births', 'info', stale), 'datasets')).toBe('超過 33 天沒有更新（自動同步沒開，資料不會自己更新）')
    expect(describeItem(item('births', 'attention', { ...stale, error: 'HTTP 503' }), 'datasets')).toBe('最近一次同步失敗：HTTP 503')
  })

  it('維護排程：停擺、失敗步驟用中文、剛啟動', () => {
    const base = { running: true, interval_seconds: 60, stale_minutes: 5, last_clean_at: null }
    expect(describeItem(item('maintenance', 'attention', { ...base, last_completed_at: '2026-10-15T03:50:00Z', failed_steps: ['outbox', 'publish_jobs'], stalled: false }), 'background'))
      .toBe('最近一輪失敗的步驟：寄送通知、排程發布')
    expect(describeItem(item('maintenance', 'attention', { ...base, last_completed_at: null, failed_steps: [], stalled: true }), 'background')).toBe('啟動超過 5 分鐘還沒有跑完一輪')
    expect(describeItem(item('maintenance', 'ok', { ...base, last_completed_at: null, failed_steps: [], stalled: false }), 'background')).toBe('剛啟動，還沒有跑完第一輪')
    expect(describeItem(item('maintenance', 'off', { running: false }), 'background')).toBe('這個環境不跑背景排程')
  })
})

describe('處理連結', () => {
  it('寄送失敗、排程發布失敗、轉檔失敗、公開資料出問題時才給連結，沒事的同一列沒有', () => {
    expect(itemLink(item('failed_outbox', 'info', { count: 3 }), 'notifications')).toEqual({ to: '/notifications', label: '重新寄送' })
    expect(itemLink(item('failed_outbox', 'ok', { count: 0 }), 'notifications')).toBeNull()
    expect(itemLink(item('failed_publish_jobs', 'info', { count: 1 }), 'notifications')).toEqual({ to: '/releases?tab=schedules', label: '查看排程' })
    expect(itemLink(item('failed_publish_jobs', 'ok', { count: 0 }), 'notifications')).toBeNull()
    expect(itemLink(item('media_jobs', 'attention', { mode: 'background', loop_running: true, failed_assets: 2, pending: 0, running: 0 }), 'background')).toEqual({ to: '/media', label: '前往素材庫' })
    expect(itemLink(item('media_jobs', 'ok', { mode: 'background', loop_running: true, failed_assets: 0, pending: 0, running: 0 }), 'background')).toBeNull()
    expect(itemLink(item('income', 'attention', { imported: true, error: 'x', stale: false }), 'datasets')).toEqual({ to: '/admissions?tab=stats&sub=area', label: '看區域分析' })
    expect(itemLink(item('income', 'ok', { imported: true, error: null, stale: false }), 'datasets')).toBeNull()
    expect(itemLink(item('births', 'info', { imported: true, error: null, stale: true, auto_sync_off: true }), 'datasets')).toBeNull()
  })

  it('LINE 推播與個資自動清理是設定入口：不看狀態一律連到設定頁；其他設定列沒有連結', () => {
    for (const level of ['ok', 'info'] as const) expect(itemLink(item('line_messaging', level, { configured: level === 'ok' }), 'services')).toEqual({ to: '/line-notifications', label: '前往 LINE 通知' })
    expect(itemLink(item('retention_auto_run', 'off', { env_allowed: true, policy_enabled: false }), 'services')).toEqual({ to: '/policies', label: '前往個資與搜尋設定' })
    expect(itemLink(item('smtp', 'attention'), 'services')).toBeNull()
  })
})

async function mountPage(data: SystemStatusOut = status()) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const mounted = await mountWith(SystemStatusView, { path: '/system-status' })
  return { ...mounted, get }
}

describe('頁面', () => {
  it('讀一次狀態，四區標題、每列名稱與要注意標籤、台北時間的資料時間；招生關閉時沒有公開資料區', async () => {
    const { wrapper, get } = await mountPage()
    expect(get).toHaveBeenCalledWith('/admin/system-status')
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['對外服務設定', '背景工作', '公開資料', '通知與發布'])
    const smtp = wrapper.get('li.status-row[data-key="smtp"]')
    expect(smtp.text()).toContain('寄信（SMTP）')
    expect(smtp.text()).toContain('要注意')
    expect(wrapper.text()).toContain('資料時間 12:00')
    cleanup()
    const off = await mountPage(status({ datasets: null }))
    expect(off.wrapper.findAll('h2').map((h) => h.text())).not.toContain('公開資料')
  })

  it('正常、要注意、資訊、關閉四種狀態各自的標籤文字與顏色', async () => {
    const { wrapper } = await mountPage(status({
      services: [item('smtp', 'attention'), item('turnstile', 'info', { configured: false }), item('geo_auto_sync', 'off', { enabled: false })],
      background: [item('maintenance', 'ok', { running: true, interval_seconds: 60, stale_minutes: 5, last_completed_at: '2026-10-15T03:59:00Z', last_clean_at: null, failed_steps: [], stalled: false })],
    }))
    const tag = (key: string) => wrapper.get(`li.status-row[data-key="${key}"] .el-tag`)
    expect(tag('maintenance').text()).toBe('正常')
    expect(tag('maintenance').classes()).toContain('el-tag--success')
    expect(tag('smtp').text()).toBe('要注意')
    expect(tag('smtp').classes()).toContain('el-tag--danger')
    expect(tag('turnstile').text()).toBe('資訊')
    expect(tag('turnstile').classes()).toContain('el-tag--info')
    expect(tag('geo_auto_sync').text()).toBe('關閉')
    expect(tag('geo_auto_sync').classes()).toContain('el-tag--info')
  })

  it('有處理連結的列顯示連結，沒有的列不顯示', async () => {
    const { wrapper } = await mountPage()
    const retry = wrapper.get('li.status-row[data-key="failed_publish_jobs"] a')
    expect(retry.text()).toBe('查看排程')
    expect(retry.attributes('href')).toBe('/releases?tab=schedules')
    expect(wrapper.find('li.status-row[data-key="failed_outbox"] a').exists()).toBe(false)
  })

  it('重新整理再讀一次；不自動輪詢', async () => {
    // 只假 setInterval：flushPromises 靠真的 setTimeout，全部假掉會卡住。
    vi.useFakeTimers({ toFake: ['setInterval'] })
    try {
      const { wrapper, get } = await mountPage()
      vi.advanceTimersByTime(120_000)
      await flushPromises()
      expect(get).toHaveBeenCalledTimes(1)
      await wrapper.findAll('button').find((b) => b.text() === '重新整理')!.trigger('click')
      await flushPromises()
      expect(get).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('第一次讀不到時顯示錯誤與「重新載入」，重新載入後出現內容', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status() as never)
    const { wrapper } = await mountWith(SystemStatusView, { path: '/system-status' })
    expect(wrapper.find('li.status-row').exists()).toBe(false)
    expect(wrapper.get('.el-alert').text()).toContain('讀不到系統狀態')
    await wrapper.findAll('button').find((b) => b.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.find('li.status-row[data-key="smtp"]').exists()).toBe(true)
  })

  it('寄信沒設時測試信按鈕停用並寫「尚未設定寄信」；有設時寄出並顯示遮罩後的收件地址', async () => {
    const off = await mountPage()
    const disabled = off.wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!
    expect(disabled.attributes('disabled')).toBeDefined()
    expect(off.wrapper.text()).toContain('尚未設定寄信')
    cleanup()

    const ready = status({ services: [item('smtp', 'ok', { host: 'smtp.example.com', port: 587, security: 'starttls', sender: 'noreply@ivy.example' })] })
    const { wrapper } = await mountPage(ready)
    expect(wrapper.text()).not.toContain('尚未設定寄信')
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, error: null } as never)
    await wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/system-status/test-email')
    expect(wrapper.get('[role="status"]').text()).toBe('已寄到 a***@example.invalid，請到信箱確認')
  })

  it('測試環境（寫入本機資料夾）也能按測試信；沒寄出時寫原因', async () => {
    const { wrapper } = await mountPage(status({ services: [item('smtp', 'info', { sink: true })] }))
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'auth_failed' } as never)
    await wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('測試信沒有寄出：寄信伺服器帳號或密碼錯誤')
  })

  it('回應的 error 是 not_configured 時和 409 共用的防呆說法：還沒設定寄信', async () => {
    const { wrapper } = await mountPage(status({ services: [item('smtp', 'info', { sink: true })] }))
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'not_configured' } as never)
    await wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('測試信沒有寄出：還沒設定寄信')
  })
})

describe('測試信被後端擋下', () => {
  const sinkPage = () => mountPage(status({ services: [item('smtp', 'info', { sink: true })] }))
  const sendButton = (wrapper: VueWrapper) => wrapper.findAll('button').find((b) => b.text() === '寄一封測試信給我')!

  it('409 沒設定寄信：和 not_configured 同一句，寫在結果列', async () => {
    const { wrapper } = await sinkPage()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'EMAIL_NOT_CONFIGURED', message: '尚未設定寄信，無法寄出測試信' }))
    await sendButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('測試信沒有寄出：還沒設定寄信')
  })

  it('429 寄太多次：跳出後端的訊息，結果列不留舊內容', async () => {
    const { wrapper } = await sinkPage()
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ ok: true, error: null } as never)
    await sendButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    post.mockRejectedValueOnce(new ApiError(429, { code: 'RATE_LIMITED', message: '測試信寄太多次了，請 10 分鐘後再試' }))
    const toast = vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    await sendButton(wrapper).trigger('click')
    await flushPromises()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: '測試信寄太多次了，請 10 分鐘後再試' }))
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})

describe('側欄與權限', () => {
  it('「系統」分組有「系統狀態」，排在「個資與搜尋設定」前面，只有總管理者看得到', () => {
    const system = NAV_GROUPS.find((group) => group.key === 'system')!
    const names = system.items.map((i) => i.name)
    expect(names.indexOf('system-status')).toBe(names.indexOf('policies') - 1)
    const entry = navItem('system-status')!
    expect(entry.path).toBe('/system-status')
    expect(entry.keywords).toEqual(expect.arrayContaining(['寄信', 'SMTP', '排程']))
    const listed = (role: Parameters<typeof testUser>[0]) => canListNavItem(entry, testUser(role), null)
    expect(listed('super_admin')).toBe(true)
    for (const role of ['campus_admin', 'reception', 'editor', 'readonly'] as const) expect(listed(role)).toBe(false)
  })

  it('直接開網址：非總管理者被導回並帶 denied', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const target = router.resolve('/system-status')
    expect(target.meta.title).toBe('系統狀態')
    setActivePinia(createPinia())
    useAuthStore().user = campusAdmin()
    expect(await authGuard(target as never)).toMatchObject({ query: { denied: 'system-status' } })
    useAuthStore().user = reception()
    expect(await authGuard(target as never)).toMatchObject({ query: { denied: 'system-status' } })
    useAuthStore().user = testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
    expect(await authGuard(target as never)).toBe(true)
  })
})

describe('營運總覽', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers.length = 0 })
  const base = () => ({ today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0 })

  async function mountDashboard(data: object, user: UserOut = testUser('super_admin')) {
    vi.spyOn(api, 'get').mockImplementation(async (path) => (path === '/admin/dashboard' ? data : []) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = user
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  it('有要注意的系統狀態時多一行，連到系統狀態頁；0 或 null 不顯示', async () => {
    const shown = await mountDashboard({ ...base(), system_attention: 2 })
    const link = shown.findAll('a.task').find((a) => a.text().includes('系統狀態'))!
    expect(link.text()).toContain('系統狀態有 2 項要注意')
    expect(link.attributes('href')).toBe('/system-status')
    for (const value of [0, null]) {
      const hidden = await mountDashboard({ ...base(), system_attention: value }, value === null ? campusAdmin() : testUser('super_admin'))
      expect(hidden.findAll('a.task').some((a) => a.text().includes('系統狀態'))).toBe(false)
    }
  })

  it('只有系統狀態要注意時，「要處理」區不會說目前沒有待處理事項', async () => {
    const wrapper = await mountDashboard({ ...base(), system_attention: 1 })
    expect(wrapper.findAll('a.task').some((a) => a.text().includes('系統狀態有 1 項要注意'))).toBe(true)
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
    const quiet = await mountDashboard({ ...base(), system_attention: 0 })
    expect(quiet.text()).toContain('目前沒有待處理事項')
  })
})
