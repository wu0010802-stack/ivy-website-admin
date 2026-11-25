// LINE 串聯（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md）：LINE 通知頁的帳號額度與家長通知、
// 系統狀態的額度文案、停課對話框的 LINE 人數、成效統計的 LINE 面板。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import LineInsightsPanel from '../components/LineInsightsPanel.vue'
import ClosureDialog from '../components/sessions/ClosureDialog.vue'
import { api } from '../api/client'
import type { LineInsightsOut, LineSettingsOut } from '../api/types'
import { AUDIT_ACTION_LABELS } from '../api/labels'
import { describeItem } from '../utils/systemStatusFormat'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function settings(overrides: Partial<LineSettingsOut> = {}): LineSettingsOut {
  return {
    enabled: true,
    webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook',
    groups: [],
    targets: [
      { campus_key: 'yihua', campus_name: '義華校', target_id: null },
      { campus_key: 'minghua', campus_name: '明華校', target_id: null },
    ],
    accounts: [
      { key: 'main', webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook', display_name: '常春藤官網', basic_id: '@ivy-main', quota: { limit: 200, used: 12, warning: false }, quota_error_status: null, pnp_available: false },
      { key: 'yihua', webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook/yihua', display_name: '常春藤義華', basic_id: '@ivy-yihua', quota: { limit: 200, used: 170, warning: true }, quota_error_status: null, pnp_available: false },
    ],
    parent_campuses: [
      { campus_key: 'yihua', campus_name: '義華校', account_key: 'yihua', linked_upcoming: 3, pnp_enabled: false },
      { campus_key: 'minghua', campus_name: '明華校', account_key: null, linked_upcoming: 0, pnp_enabled: false },
    ],
    ...overrides,
  }
}

async function mountLinePage(data: LineSettingsOut = settings()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/line-notifications')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue(data)
  const wrapper = mount(LineNotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('LINE 通知頁：帳號額度與家長通知', () => {
  it('列出每個帳號本月用量，快用完時講清楚後果；各校帳號列出自己的 webhook', async () => {
    const wrapper = await mountLinePage()
    const accounts = wrapper.get('[data-test="line-accounts"]').text()
    expect(accounts).toContain('常春藤官網（@ivy-main）')
    expect(accounts).toContain('本月已用 12 ／ 200 則')
    expect(accounts).toContain('本月已用 170 ／ 200 則，快用完了')
    expect(accounts).toContain('https://admin.ivy.example/api/website/v1/line/webhook/yihua')
    expect(accounts).toContain('義華校的官方帳號')
  })

  it('查不到額度時說明可能是金鑰失效', async () => {
    const wrapper = await mountLinePage(settings({
      accounts: [{ key: 'main', webhook_url: null, display_name: null, basic_id: null, quota: null, quota_error_status: 401, pnp_available: false }],
    }))
    expect(wrapper.get('[data-test="line-accounts"]').text()).toContain('金鑰可能已失效')
  })

  it('家長通知：各校只能選園方群組推播帳號或自己的帳號，改了就送 PUT', async () => {
    const wrapper = await mountLinePage()
    const section = wrapper.get('[data-test="line-parent-notify"]')
    expect(section.text()).toContain('3 筆即將參觀的預約已綁定 LINE')
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings() as never)
    const selects = section.findAllComponents({ name: 'ElSelect' })
    expect(selects).toHaveLength(2)
    // 明華沒有自己的帳號：選項只有「不開放」與園方群組推播帳號。
    const optionWrappers: VueWrapper[] = selects[1]!.findAllComponents({ name: 'ElOption' })
    const minghuaOptions = optionWrappers.map(option => (option.props() as { label?: string }).label)
    expect(minghuaOptions).toEqual(['不開放', '園方群組推播帳號（常春藤官網）'])
    selects[1]!.vm.$emit('change', 'main')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/parent-accounts/minghua', { account_key: 'main', pnp_enabled: false })
    selects[0]!.vm.$emit('change', '')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/line/parent-accounts/yihua', { account_key: null, pnp_enabled: false })
  })

  it('新的操作紀錄都有中文', () => {
    for (const action of ['line.parent_account.update', 'line.parent.link', 'line.parent.unlink']) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
    }
  })
})

describe('LINE 通知頁：總部帳號與通知型訊息（2026-11-25）', () => {
  const hq = { key: 'hq', webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook/hq', display_name: '常春藤總部', basic_id: '@ivy-hq', quota: { limit: null, used: 0, warning: false }, quota_error_status: null, pnp_available: true }

  function withHq(parent: LineSettingsOut['parent_campuses']): LineSettingsOut {
    const base = settings()
    return settings({ accounts: [...(base.accounts ?? []), hq], parent_campuses: parent })
  }

  it('總部帳號每校都能選，列出 webhook 並標示已開通', async () => {
    const wrapper = await mountLinePage(withHq(settings().parent_campuses))
    const accounts = wrapper.get('[data-test="line-accounts"]').text()
    expect(accounts).toContain('總部官方帳號')
    expect(accounts).toContain('已開通通知型訊息')
    expect(accounts).toContain('https://admin.ivy.example/api/website/v1/line/webhook/hq')
    const selects = wrapper.get('[data-test="line-parent-notify"]').findAllComponents({ name: 'ElSelect' })
    const minghuaOptions = (selects[1]!.findAllComponents({ name: 'ElOption' }) as VueWrapper[]).map(option => (option.props() as { label?: string }).label)
    expect(minghuaOptions).toEqual(['不開放', '園方群組推播帳號（常春藤官網）', '總部官方帳號（常春藤總部）'])
  })

  it('選了已開通的帳號才能開通知型訊息；開關送出目前帳號與 pnp_enabled', async () => {
    const wrapper = await mountLinePage(withHq([
      { campus_key: 'yihua', campus_name: '義華校', account_key: 'yihua', linked_upcoming: 0, pnp_enabled: false },
      { campus_key: 'minghua', campus_name: '明華校', account_key: 'hq', linked_upcoming: 0, pnp_enabled: false },
    ]))
    const section = wrapper.get('[data-test="line-parent-notify"]')
    expect(section.get('[data-test="line-pnp-help"]').text()).toContain('有留 Email 的家長照舊只收信')
    const switches = section.findAllComponents({ name: 'ElSwitch' })
    expect(switches).toHaveLength(2)
    // 義華選的是自己的帳號（沒開通）：不能開。
    expect(switches[0]!.props('disabled')).toBe(true)
    expect(switches[1]!.props('disabled')).toBe(false)
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings() as never)
    switches[1]!.vm.$emit('change', true)
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/parent-accounts/minghua', { account_key: 'hq', pnp_enabled: true })
  })

  it('換到沒開通的帳號時一併關掉通知型訊息', async () => {
    const wrapper = await mountLinePage(withHq([
      { campus_key: 'yihua', campus_name: '義華校', account_key: 'hq', linked_upcoming: 0, pnp_enabled: true },
      { campus_key: 'minghua', campus_name: '明華校', account_key: null, linked_upcoming: 0, pnp_enabled: false },
    ]))
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings() as never)
    const selects = wrapper.get('[data-test="line-parent-notify"]').findAllComponents({ name: 'ElSelect' })
    selects[0]!.vm.$emit('change', 'yihua')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/parent-accounts/yihua', { account_key: 'yihua', pnp_enabled: false })
  })

  it('沒有任何帳號開通時不顯示開關', async () => {
    const wrapper = await mountLinePage()
    expect(wrapper.get('[data-test="line-parent-notify"]').findAllComponents({ name: 'ElSwitch' })).toHaveLength(0)
  })
})

describe('系統狀態：LINE 官方帳號', () => {
  const item = (detail: Record<string, unknown>) => ({ key: 'line_messaging', level: 'ok' as const, detail })

  it('列出每個帳號的用量，八成以上標快用完；查不到額度另外講', () => {
    expect(describeItem(item({ configured: true, accounts: [
      { key: 'main', name: '常春藤官網', used: 12, limit: 200, error_status: null },
      { key: 'yihua', name: null, used: 170, limit: 200, error_status: null },
      { key: 'renwu', name: '常春藤仁武', used: null, limit: null, error_status: 401 },
    ] }), 'services')).toBe(
      '已設定，參觀通知會推到各校的 LINE 群組；常春藤官網本月 12／200 則、yihua本月 170／200 則（快用完）、常春藤仁武查不到額度（金鑰可能已失效）',
    )
  })

  it('沒有任何帳號時維持原本的說法', () => {
    expect(describeItem(item({ configured: false }), 'services')).toBe('未設定，參觀通知不會推到 LINE 群組')
  })
})

describe('停課對話框：綁了 LINE 的家長', () => {
  function mountDialog() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    const wrapper = mount(ClosureDialog, {
      props: { modelValue: true, 'onUpdate:modelValue': () => {}, campusKeys: ['yihua'], defaultCampus: 'yihua' } as never,
      global: { plugins: [ElementPlus, router] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    return wrapper
  }

  it('沒設寄信也能勾通知：LINE 的家長不算要來電', async () => {
    const row = { campus_key: 'yihua', already_closed: false, closed_slots: 1, confirmed_requests: 3, with_email: 1, notified: 1, already_notified: 0, no_email: 1, with_line: 1 }
    vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
      dry_run: (body as { dry_run: boolean }).dry_run, closure_date: '2026-10-14', parent_email_enabled: false, campuses: [row],
    }) as never)
    mountDialog()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(document.body.querySelector('[data-test="closure-notify"] input')!.hasAttribute('disabled')).toBe(false)
    expect(text).toContain('1 位綁了 LINE 通知的家長會收到 LINE')
    expect(text).toContain('1 位沒有 Email，會用 LINE 通知')
    document.body.querySelector<HTMLButtonElement>('[data-test="closure-submit"]')!.click()
    await flushPromises()
    // 沒設寄信：有 Email 的 1 位＋沒有 Email 也沒 LINE 的 1 位要來電；LINE 那位不用。
    expect(document.body.textContent).toContain('還有 2 位家長要來電通知')
  })
})

describe('成效統計：LINE 面板', () => {
  function insights(overrides: Partial<LineInsightsOut> = {}): LineInsightsOut {
    return {
      configured: true,
      start: '2026-10-20',
      end: '2026-11-16',
      accounts: [
        { key: 'yihua', display_name: '常春藤義華', basic_id: '@ivy-yihua', from_date: '2026-10-19', to_date: '2026-11-15', ready: true, followers: 130, blocks: 7, targeted_reaches: 90, new_followers: 30, blocks_change: 2, error_status: null },
        { key: 'main', display_name: '常春藤官網', basic_id: null, from_date: '2026-10-19', to_date: '2026-11-15', ready: false, followers: null, blocks: null, targeted_reaches: null, new_followers: null, blocks_change: null, error_status: null },
      ],
      campuses: [
        { campus_key: 'yihua', campus_name: '義華校', line_clicks: 12, linked: 4 },
        { campus_key: 'minghua', campus_name: '明華校', line_clicks: 3, linked: 0 },
      ],
      ...overrides,
    }
  }

  it('期間內新增好友、按鈕點擊與綁定數；還沒算好的帳號說明明天再看', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(insights() as never)
    const wrapper = mount(LineInsightsPanel, { props: { days: 28 }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(get.mock.calls[0]![0]).toMatch(/^\/admin\/line-insights\?start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}$/)
    expect(wrapper.get('[data-test="line-insights-totals"]').text()).toContain('15')
    const accounts = wrapper.get('[data-test="line-insights-accounts"]').text()
    expect(accounts).toContain('常春藤義華（@ivy-yihua）')
    expect(accounts).toContain('+30')
    expect(accounts).toContain('10/19–11/15')
    expect(accounts).toContain('LINE 還沒算好這兩天的數字')
    expect(wrapper.get('[data-test="line-insights-campuses"]').text()).toContain('義華校')
  })

  it('沒設任何帳號：只看得到官網的點擊與綁定', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(insights({ configured: false, accounts: [] }) as never)
    const wrapper = mount(LineInsightsPanel, { props: { days: 7 }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.find('[data-test="line-insights-unconfigured"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="line-insights-accounts"]').exists()).toBe(false)
  })
})
