// 系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）：
// 文案與連結、頁面、側欄與權限、總覽一行；後端步驟名與公開資料清單都要有中文。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SystemStatusView from '../views/SystemStatusView.vue'
import DashboardView from '../views/DashboardView.vue'
import { ApiError, api } from '../api/client'
import type { ErrorGroupListOut, ErrorGroupOut, SystemStatusItem, SystemStatusOut, UserOut } from '../api/types'
import { authGuard, routes } from '../router'
import { canListNavItem, navItem, NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { campusAdmin, cleanup, mountWith, reception } from './admissionsTestKit'
import { testUser } from './fixtures'
import { DATASET_LABELS, ITEM_LABELS, STEP_LABELS, describeItem, itemLink } from '../utils/systemStatusFormat'
import { ERROR_SOURCE_LABELS, errorTitle, formatRelativeTime } from '../utils/errorReportFormat'

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
    expect(itemLink(item('income', 'attention', { imported: true, error: 'x', stale: false }), 'datasets')).toEqual({ to: '/admissions-stats?sub=area', label: '看區域分析' })
    expect(itemLink(item('income', 'ok', { imported: true, error: null, stale: false }), 'datasets')).toBeNull()
    expect(itemLink(item('births', 'info', { imported: true, error: null, stale: true, auto_sync_off: true }), 'datasets')).toBeNull()
  })

  it('LINE 推播與個資自動清理是設定入口：不看狀態一律連到設定頁；其他設定列沒有連結', () => {
    for (const level of ['ok', 'info'] as const) expect(itemLink(item('line_messaging', level, { configured: level === 'ok' }), 'services')).toEqual({ to: '/line-notifications', label: '前往 LINE 通知' })
    expect(itemLink(item('retention_auto_run', 'off', { env_allowed: true, policy_enabled: false }), 'services')).toEqual({ to: '/policies', label: '前往個資與搜尋設定' })
    expect(itemLink(item('smtp', 'attention'), 'services')).toBeNull()
  })
})

const noErrors: ErrorGroupListOut = { items: [], open_count: 0, open_last_24h: 0 }
const statusCalls = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.filter(([path]) => path === '/admin/system-status')

// 狀態與錯誤回報是兩支 API（錯誤區塊自己讀 /admin/error-groups），依路徑回不同的資料。
async function mountPage(data: SystemStatusOut = status(), errors: ErrorGroupListOut = noErrors) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => (String(path).startsWith('/admin/error-groups') ? errors : data) as never)
  const mounted = await mountWith(SystemStatusView, { path: '/system-status' })
  return { ...mounted, get }
}

describe('頁面', () => {
  it('讀一次狀態，四區標題、每列名稱與要注意標籤、台北時間的資料時間；招生關閉時沒有公開資料區', async () => {
    const { wrapper, get } = await mountPage()
    expect(get).toHaveBeenCalledWith('/admin/system-status')
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['對外服務設定', '背景工作', '公開資料', '通知與發布', '錯誤回報'])
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
      expect(statusCalls(get)).toHaveLength(1)
      await wrapper.findAll('button').find((b) => b.text() === '重新整理')!.trigger('click')
      await flushPromises()
      expect(statusCalls(get)).toHaveLength(2)
      // 錯誤回報跟著重新整理，一樣不自動輪詢：掛上時讀一次、重新整理時再讀一次。
      expect(get.mock.calls.filter(([path]) => String(path).startsWith('/admin/error-groups'))).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('第一次讀不到時顯示錯誤與「重新載入」，重新載入後出現內容', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('offline')).mockImplementation(async (path) => (String(path).startsWith('/admin/error-groups') ? noErrors : status()) as never)
    const { wrapper } = await mountWith(SystemStatusView, { path: '/system-status' })
    expect(wrapper.find('li.status-row').exists()).toBe(false)
    expect(wrapper.get('.el-alert').text()).toContain('讀不到系統狀態')
    await wrapper.findAll('button').find((b) => b.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(statusCalls(get)).toHaveLength(2)
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

describe('錯誤回報（系統狀態那一列）', () => {
  it('過去 24 小時有未處理的錯誤：寫幾種、連到下面的錯誤區塊；沒有就是正常', () => {
    const loud = item('error_reports', 'attention', { open_last_24h: 3, open_total: 5 })
    expect(ITEM_LABELS.error_reports).toBe('錯誤回報')
    expect(describeItem(loud, 'background')).toBe('過去 24 小時有 3 種錯誤')
    expect(itemLink(loud, 'background')).toEqual({ to: '/system-status#errors', label: '看錯誤' })
    const quiet = item('error_reports', 'ok', { open_last_24h: 0, open_total: 2 })
    expect(describeItem(quiet, 'background')).toBe('過去 24 小時沒有未處理的錯誤')
    expect(itemLink(quiet, 'background')).toBeNull()
  })
})

describe('錯誤回報區塊', () => {
  const NOW = '2026-10-15T04:00:00Z'
  const group = (overrides: Partial<ErrorGroupOut> = {}): ErrorGroupOut => ({
    id: 1, source: 'web', kind: 'TypeError', message: 'x is not a function', location: '/_nuxt/a.js:1:2', path: '/campuses/yihua',
    release: 'build-1', sample_stack: 'TypeError: x is not a function\n    at f (/_nuxt/a.js:1:2)', sample_user_agent: 'Mozilla/5.0 test',
    count: 3, first_seen_at: '2026-10-15T01:00:00Z', last_seen_at: '2026-10-15T03:55:00Z', resolved_at: null, ...overrides,
  })
  const list = (items: ErrorGroupOut[], open = items.filter((i) => !i.resolved_at).length): ErrorGroupListOut => ({ items, open_count: open, open_last_24h: open })

  /** handler 依 status 參數回對應清單；其餘路徑回系統狀態。 */
  async function mountErrors(byStatus: Partial<Record<'open' | 'resolved' | 'all', ErrorGroupListOut>>) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      const text = String(path)
      if (!text.startsWith('/admin/error-groups')) return status() as never
      const key = new URL(text, 'http://x').searchParams.get('status') as 'open' | 'resolved' | 'all'
      return (byStatus[key] ?? noErrors) as never
    })
    const mounted = await mountWith(SystemStatusView, { path: '/system-status' })
    return { ...mounted, get }
  }
  const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.text() === label)
  const errorCalls = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/admin/error-groups'))

  it('容器是 #errors；每列寫來源、錯誤、頁面、次數、最後發生（相對時間，hover 完整時間）、首次發生', async () => {
    const { wrapper, get } = await mountErrors({ open: list([group(), group({ id: 2, source: 'api', kind: 'sqlalchemy.exc.IntegrityError', message: '', path: '/api/website/v1/admin/x/{id}', count: 1, last_seen_at: '2026-10-14T20:00:00Z' })]) })
    expect(wrapper.get('section#errors h2').text()).toBe('錯誤回報')
    expect(errorCalls(get)).toEqual(['/admin/error-groups?status=open&limit=50'])
    const rows = wrapper.findAll('li.error-row')
    expect(rows).toHaveLength(2)
    const first = rows[0]!
    expect(first.get('.el-tag').text()).toBe('官網')
    expect(first.get('.error-row__title').text()).toBe('TypeError：x is not a function')
    expect(first.text()).toContain('頁面 /campuses/yihua')
    expect(first.text()).toContain('3 次')
    const last = first.findAll('time')[0]!
    expect(last.text()).toBe('5 分鐘前')
    expect(last.attributes('title')).toBe('2026/10/15 11:55')
    expect(first.findAll('time')[1]!.text()).toBe('2026/10/15 09:00')
    expect(rows[1]!.get('.el-tag').text()).toBe('API')
    expect(rows[1]!.get('.error-row__title').text()).toBe('sqlalchemy.exc.IntegrityError')
    expect(rows[1]!.findAll('time')[0]!.text()).toBe('8 小時前')
    expect(wrapper.findAll('.el-radio-button').map((b) => b.text())).toEqual(['未處理（2）', '已處理', '全部'])
  })

  it('沒有錯誤：只寫「目前沒有錯誤」，不出現全部標為已處理', async () => {
    const { wrapper } = await mountErrors({})
    expect(wrapper.get('section#errors').text()).toContain('目前沒有錯誤')
    expect(wrapper.find('li.error-row').exists()).toBe(false)
    expect(button(wrapper, '全部標為已處理')).toBeUndefined()
  })

  it('切到已處理與全部：重讀並帶 status；已處理的列寫處理時間、沒有標為已處理的按鈕', async () => {
    const done = group({ id: 7, resolved_at: '2026-10-15T02:00:00Z' })
    const { wrapper, get } = await mountErrors({ open: list([group()]), resolved: list([done], 1), all: list([group(), done], 1) })
    await wrapper.findAll('.el-radio-button').find((b) => b.text() === '已處理')!.get('input').setValue(true)
    await flushPromises()
    expect(errorCalls(get).at(-1)).toBe('/admin/error-groups?status=resolved&limit=50')
    const row = wrapper.get('li.error-row[data-id="7"]')
    expect(row.text()).toContain('已於 2026/10/15 10:00 標為已處理')
    expect(row.findAll('button').some((b) => b.text() === '標為已處理')).toBe(false)
    await wrapper.findAll('.el-radio-button').find((b) => b.text() === '全部')!.get('input').setValue(true)
    await flushPromises()
    expect(errorCalls(get).at(-1)).toBe('/admin/error-groups?status=all&limit=50')
    expect(wrapper.findAll('li.error-row')).toHaveLength(2)
  })

  it('展開堆疊：等寬字保留換行、顯示位置、版本與瀏覽器；再按一次收起', async () => {
    const { wrapper } = await mountErrors({ open: list([group()]) })
    expect(wrapper.find('.error-row__detail').exists()).toBe(false)
    const toggle = button(wrapper, '展開堆疊')!
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.get('.error-row__stack').text()).toBe('TypeError: x is not a function\n    at f (/_nuxt/a.js:1:2)')
    expect(wrapper.get('.error-row__stack').classes()).toContain('mono')
    const detail = wrapper.get('.error-row__detail').text()
    expect(detail).toContain('位置 /_nuxt/a.js:1:2')
    expect(detail).toContain('版本 build-1')
    expect(detail).toContain('瀏覽器 Mozilla/5.0 test')
    expect(button(wrapper, '收起堆疊')!.attributes('aria-expanded')).toBe('true')
    await button(wrapper, '收起堆疊')!.trigger('click')
    expect(wrapper.find('.error-row__detail').exists()).toBe(false)
  })

  it('標為已處理：POST 該筆、重讀清單、連背景工作那一列的狀態一起更新', async () => {
    const { wrapper, get } = await mountErrors({ open: list([group({ id: 4 })]) })
    const post = vi.spyOn(api, 'post').mockResolvedValue(group({ id: 4, resolved_at: NOW }) as never)
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const before = { errors: errorCalls(get).length, status: statusCalls(get).length }
    await button(wrapper, '標為已處理')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/error-groups/4/resolve')
    expect(success).toHaveBeenCalledWith('已標為已處理')
    expect(errorCalls(get).length).toBe(before.errors + 1)
    expect(statusCalls(get).length).toBe(before.status + 1)
  })

  it('標記失敗：跳出後端訊息，不當作成功', async () => {
    const { wrapper } = await mountErrors({ open: list([group({ id: 4 })]) })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(404, { code: 'ERROR_GROUP_NOT_FOUND', message: '找不到這筆錯誤紀錄' }))
    const toast = vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    await button(wrapper, '標為已處理')!.trigger('click')
    await flushPromises()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: '找不到這筆錯誤紀錄' }))
    expect(success).not.toHaveBeenCalled()
  })

  it('全部標為已處理要先確認：取消不送；確認才 POST resolve-all', async () => {
    const { wrapper, get } = await mountErrors({ open: list([group(), group({ id: 2, kind: 'RangeError' })]) })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ resolved: 2 } as never)
    vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    await button(wrapper, '全部標為已處理')!.trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValue('confirm' as never)
    const before = errorCalls(get).length
    await button(wrapper, '全部標為已處理')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[1]![0])).toContain('2 種未處理的錯誤')
    expect(confirm.mock.calls[1]![2]).toMatchObject({ confirmButtonText: '全部標為已處理', cancelButtonText: '先不要' })
    expect(post).toHaveBeenCalledWith('/admin/error-groups/resolve-all')
    expect(errorCalls(get).length).toBe(before + 1)
  })

  it('讀不到錯誤清單：區塊內顯示錯誤與重新載入，不影響上面的狀態', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (String(path).startsWith('/admin/error-groups')) throw new Error('offline')
      return status() as never
    })
    const { wrapper } = await mountWith(SystemStatusView, { path: '/system-status' })
    expect(wrapper.find('li.status-row[data-key="smtp"]').exists()).toBe(true)
    expect(wrapper.get('section#errors .el-alert').text()).toContain('讀不到錯誤回報')
  })

  it('格式：來源中文、標題、相對時間', () => {
    expect(ERROR_SOURCE_LABELS).toEqual({ web: '官網', admin: '後台', api: 'API' })
    expect(errorTitle({ kind: 'TypeError', message: 'boom' })).toBe('TypeError：boom')
    expect(errorTitle({ kind: 'TypeError', message: '' })).toBe('TypeError')
    const now = Date.parse(NOW)
    expect(formatRelativeTime('2026-10-15T03:59:40Z', now)).toBe('剛剛')
    expect(formatRelativeTime('2026-10-15T04:05:00Z', now)).toBe('剛剛') // 時鐘差造成的未來時間
    expect(formatRelativeTime('2026-10-15T03:15:00Z', now)).toBe('45 分鐘前')
    expect(formatRelativeTime('2026-10-14T23:00:00Z', now)).toBe('5 小時前')
    expect(formatRelativeTime('2026-10-12T04:00:00Z', now)).toBe('3 天前')
    expect(formatRelativeTime('2026-08-01T04:00:00Z', now)).toBe('2026/08/01 12:00')
    expect(formatRelativeTime(null, now)).toBe('—')
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
