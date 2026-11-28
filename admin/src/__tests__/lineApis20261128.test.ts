// 再接六個 LINE API 的後台畫面（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §2、§4、§5、§6）：
// 檢查連線、圖文選單、群組成員、稽核顯示、好友輪廓。API 一律用 mock，不連後端。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import LineInsightsPanel from '../components/LineInsightsPanel.vue'
import { api, ApiError } from '../api/client'
import type { LineAccountWithMenu, LineDemographicsOut, LineGroupOut, LineSettingsOut } from '../api/types'
import { areaBars, webhookCheckMessages } from '../api/lineTools'
import { auditMetadataDetails, auditMetadataSummary, auditSearchTerms } from '../api/auditLabels'
import { AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const ALL_KINDS = ['visit_request_created', 'visit_request_confirmed', 'visit_request_rescheduled', 'visit_request_cancelled']

function group(overrides: Partial<LineGroupOut> = {}): LineGroupOut {
  return {
    target_id: 'C1',
    source_type: 'group',
    name: '義華員工群',
    first_seen_at: '2026-11-01T01:00:00Z',
    last_seen_at: '2026-11-01T01:00:00Z',
    left_at: null,
    verified_at: '2026-11-02T01:00:00Z',
    kinds: ALL_KINDS,
    digest_enabled: true,
    mention_all_same_day: true,
    is_hq: false,
    ...overrides,
  } as LineGroupOut
}

function account(overrides: Record<string, unknown> = {}): LineAccountWithMenu {
  return {
    key: 'yihua',
    webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook/yihua',
    display_name: '常春藤義華',
    basic_id: '@ivy-yihua',
    quota: { limit: 200, used: 10, warning: false },
    quota_error_status: null,
    pnp_available: false,
    rich_menu: null,
    ...overrides,
  } as unknown as LineAccountWithMenu
}

function settings(accounts: LineAccountWithMenu[] = [account()], groups: LineGroupOut[] = []): LineSettingsOut {
  return {
    enabled: true,
    webhook_url: 'https://admin.ivy.example/api/website/v1/line/webhook',
    groups,
    targets: [{ campus_key: 'yihua', campus_name: '義華校', target_id: null }],
    accounts,
    parent_campuses: [],
  } as unknown as LineSettingsOut
}

async function mountPage(data: LineSettingsOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/line-notifications')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue(data)
  const wrapper = mount(LineNotificationsView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function check(overrides: Record<string, unknown> = {}) {
  return {
    account_key: 'yihua',
    expected_url: 'https://admin.ivy.example/api/website/v1/line/webhook/yihua',
    endpoint: 'https://admin.ivy.example/api/website/v1/line/webhook/yihua',
    active: true,
    matches: true,
    test: { success: true, status_code: 200, reason: 'OK' },
    error_status: null,
    ...overrides,
  }
}

async function runCheck(wrapper: VueWrapper, result: unknown) {
  vi.spyOn(api, 'post').mockResolvedValue(result as never)
  await wrapper.get('[data-test="line-webhook-check-button"]').trigger('click')
  await flushPromises()
  return wrapper.get('[data-test="line-webhook-check-yihua"]').text()
}

describe('§2 檢查連線', () => {
  it('呼叫帳號的 webhook-check，全部正常只有一句', async () => {
    const wrapper = await mountPage(settings())
    const post = vi.spyOn(api, 'post').mockResolvedValue(check() as never)
    await wrapper.get('[data-test="line-webhook-check-button"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/line/accounts/yihua/webhook-check')
    expect(wrapper.get('[data-test="line-webhook-check-yihua"]').text()).toContain('webhook 網址正確，LINE 連得到。')
  })

  it('各種結果換成對應的句子', async () => {
    const wrapper = await mountPage(settings())
    expect(await runCheck(wrapper, check({ endpoint: null, active: null, matches: null, test: null }))).toContain('LINE 後台還沒填 webhook 網址。')
    expect(await runCheck(wrapper, check({ endpoint: 'https://other.example/hook', matches: false }))).toContain('LINE 後台填的是另一個網址：https://other.example/hook')
    expect(await runCheck(wrapper, check({ active: false }))).toContain('LINE 後台的「使用 Webhook」沒有打開，收不到任何事件。')
    expect(await runCheck(wrapper, check({ test: { success: false, status_code: null, reason: 'COULD_NOT_CONNECT' } }))).toContain('LINE 連不到這個網址（連不上）。')
    expect(await runCheck(wrapper, check({ test: { success: false, status_code: null, reason: 'REQUEST_TIMEOUT' } }))).toContain('LINE 連不到這個網址（逾時）。')
    expect(await runCheck(wrapper, check({ test: { success: false, status_code: 500, reason: 'ERROR_STATUS_CODE' } }))).toContain('LINE 連不到這個網址（回了錯誤 500）。')
    expect(await runCheck(wrapper, check({ test: { success: false, status_code: null, reason: 'UNCLASSIFIED' } }))).toContain('LINE 連不到這個網址（其他）。')
    expect(await runCheck(wrapper, check({ endpoint: null, test: null, active: null, matches: null, error_status: 401 }))).toContain('金鑰失效，請重新設定')
    expect(await runCheck(wrapper, check({ error_status: 502 }))).toContain('LINE 查詢失敗（狀態 502）')
    expect(await runCheck(wrapper, check({ error_status: 0 }))).toContain('連不上 LINE')
  })

  it('同時有多個問題就全部列出', async () => {
    const wrapper = await mountPage(settings())
    await runCheck(wrapper, check({ endpoint: 'https://other.example/hook', matches: false, active: false, test: { success: false, status_code: 404, reason: 'ERROR_STATUS_CODE' } }))
    const lines = wrapper.findAll('[data-test="line-webhook-check-line"]').map(line => line.text())
    expect(lines).toHaveLength(3)
    expect(lines.join('')).toContain('另一個網址')
    expect(lines.join('')).toContain('沒有打開')
    expect(lines.join('')).toContain('回了錯誤 404')
    expect(webhookCheckMessages(check({ error_status: 0 }) as never).ok).toBe(false)
  })

  it('429 顯示「檢查太多次了」', async () => {
    const wrapper = await mountPage(settings())
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, { code: 'RATE_LIMITED', message: 'Too many' }))
    await wrapper.get('[data-test="line-webhook-check-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="line-webhook-check-error"]').text()).toBe('檢查太多次了，請稍後再試')
  })
})

describe('§4 圖文選單', () => {
  function radio(wrapper: VueWrapper, mode: 'none' | 'booked' | 'all') {
    return wrapper.get(`[data-test="line-rich-menu-yihua-${mode}"] input`)
  }

  it('目前值來自 rich_menu.mode，null 等於不使用', async () => {
    const none = await mountPage(settings())
    expect((radio(none, 'none').element as HTMLInputElement).checked).toBe(true)
    expect(none.find('[data-test="line-rich-menu-insight-button"]').exists()).toBe(false)
    const booked = await mountPage(settings([account({ rich_menu: { mode: 'booked', created_at: '2026-11-28T01:00:00Z', outdated: false } })]))
    expect((radio(booked, 'booked').element as HTMLInputElement).checked).toBe(true)
    expect(booked.find('[data-test="line-rich-menu-insight-button"]').exists()).toBe(true)
  })

  it('選「所有好友」先確認，說清楚會蓋掉 OA Manager 的選單，確認後 PUT 並取代頁面資料', async () => {
    const wrapper = await mountPage(settings())
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const next = settings([account({ rich_menu: { mode: 'all', created_at: '2026-11-28T01:00:00Z', outdated: false } })])
    const put = vi.spyOn(api, 'put').mockResolvedValue(next as never)
    await radio(wrapper, 'all').setValue(true)
    await flushPromises()
    expect(confirm.mock.calls[0]![0]).toContain('會蓋掉在 LINE Official Account Manager 設定的圖文選單')
    expect(put).toHaveBeenCalledWith('/admin/line/accounts/yihua/rich-menu', { mode: 'all' })
    expect((radio(wrapper, 'all').element as HTMLInputElement).checked).toBe(true)
  })

  it('選「只給已預約的家長」確認後送 booked', async () => {
    const wrapper = await mountPage(settings())
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings() as never)
    await radio(wrapper, 'booked').setValue(true)
    await flushPromises()
    expect(confirm.mock.calls[0]![0]).toContain('其他好友照舊')
    expect(put).toHaveBeenCalledWith('/admin/line/accounts/yihua/rich-menu', { mode: 'booked' })
  })

  it('選「不使用」說明已預約的家長會換回原本的選單，送 null', async () => {
    const wrapper = await mountPage(settings([account({ rich_menu: { mode: 'all', created_at: '2026-11-28T01:00:00Z', outdated: false } })]))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings() as never)
    await radio(wrapper, 'none').setValue(true)
    await flushPromises()
    expect(confirm.mock.calls[0]![0]).toContain('已預約的家長會換回原本的選單')
    expect(put).toHaveBeenCalledWith('/admin/line/accounts/yihua/rich-menu', { mode: null })
  })

  it('確認框按「先不要」就不送出', async () => {
    const wrapper = await mountPage(settings())
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const put = vi.spyOn(api, 'put')
    await radio(wrapper, 'all').setValue(true)
    await flushPromises()
    expect(put).not.toHaveBeenCalled()
    expect((radio(wrapper, 'none').element as HTMLInputElement).checked).toBe(true)
  })

  it('錯誤碼：沒設官網網址、LINE 沒建立成功、太頻繁', async () => {
    const wrapper = await mountPage(settings())
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const put = vi.spyOn(api, 'put')
    const messages: string[] = []
    const { ElMessage } = await import('element-plus')
    vi.spyOn(ElMessage, 'error').mockImplementation(((options: { message: string }) => { messages.push(options.message); return undefined }) as never)
    put.mockRejectedValueOnce(new ApiError(409, { code: 'LINE_RICH_MENU_UNAVAILABLE' }))
    await radio(wrapper, 'all').setValue(true)
    await flushPromises()
    put.mockRejectedValueOnce(new ApiError(502, { code: 'LINE_RICH_MENU_FAILED' }))
    await radio(wrapper, 'booked').setValue(true)
    await flushPromises()
    put.mockRejectedValueOnce(new ApiError(429, { code: 'RATE_LIMITED' }))
    await radio(wrapper, 'all').setValue(true)
    await flushPromises()
    expect(messages[0]).toBe('還沒設定官網網址，不能建立圖文選單')
    expect(messages[1]).toBe('LINE 沒有建立成功，請稍後再試')
    expect(messages[2]).toContain('太頻繁')
  })

  it('選單過期時顯示提示，按「重新套用」用同一個模式再 PUT 一次，不再確認', async () => {
    const wrapper = await mountPage(settings([account({ rich_menu: { mode: 'booked', created_at: '2026-11-28T01:00:00Z', outdated: true } })]))
    expect(wrapper.get('[data-test="line-rich-menu-outdated"]').text()).toContain('選單內容有更新（校區電話、地址或預約連結變了）')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings([account({ rich_menu: { mode: 'booked', created_at: '2026-11-28T02:00:00Z', outdated: false } })]) as never)
    await wrapper.get('[data-test="line-rich-menu-reapply"]').trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/accounts/yihua/rich-menu', { mode: 'booked' })
    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="line-rich-menu-outdated"]').exists()).toBe(false)
  })

  it('沒過期就沒有重新套用', async () => {
    const wrapper = await mountPage(settings([account({ rich_menu: { mode: 'all', created_at: '2026-11-28T01:00:00Z', outdated: false } })]))
    expect(wrapper.find('[data-test="line-rich-menu-outdated"]').exists()).toBe(false)
  })

  it('進頁面不查統計，按了才查；顯示次數與左中右各格', async () => {
    const wrapper = await mountPage(settings([account({ rich_menu: { mode: 'all', created_at: '2026-11-28T01:00:00Z', outdated: false } })]))
    const get = vi.mocked(api.get)
    expect(get.mock.calls.some(call => String(call[0]).includes('rich-menu/insight'))).toBe(false)
    get.mockResolvedValueOnce({
      from_date: '2026-10-31', to_date: '2026-11-27', error_status: null,
      menus: [
        { kind: 'default', available: true, impressions: 1234, impression_users: 321, areas: [{ label: '預約參觀', clicks: 40, users: 30 }, { label: '園所位置', clicks: 12, users: 10 }, { label: '撥打電話', clicks: 5, users: 4 }] },
        { kind: 'booked', available: false, impressions: null, impression_users: null, areas: [] },
      ],
    } as never)
    await wrapper.get('[data-test="line-rich-menu-insight-button"]').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/line/accounts/yihua/rich-menu/insight?days=28')
    const rows = wrapper.findAll('[data-test="line-rich-menu-insight-row"]').map(row => row.text())
    expect(rows[0]).toContain('所有好友的選單')
    expect(rows[0]).toContain('顯示 1,234 次（321 人）')
    expect(rows[0]).toContain('預約參觀 40 次')
    expect(rows[0]).toContain('園所位置 12 次')
    expect(rows[0]).toContain('撥打電話 5 次')
    expect(rows[1]).toContain('已預約家長的選單')
    expect(rows[1]).toContain('點的人不到 20 位，或剛建好還沒有統計')
  })

  it('統計查詢失敗時只在統計那一行說明', async () => {
    const wrapper = await mountPage(settings([account({ rich_menu: { mode: 'all', created_at: '2026-11-28T01:00:00Z', outdated: false } })]))
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(429, { code: 'RATE_LIMITED' }))
    await wrapper.get('[data-test="line-rich-menu-insight-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="line-rich-menu-insight-error"]').text()).toContain('太頻繁')
  })
})

describe('§5.1 群組成員', () => {
  async function openMembers(members: unknown) {
    const wrapper = await mountPage(settings([account()], [group(), group({ target_id: 'C2', name: '離開的群', left_at: '2026-11-10T00:00:00Z' })]))
    expect(wrapper.find('[data-test="line-group-members-C2"]').exists()).toBe(false)
    vi.mocked(api.get).mockResolvedValueOnce(members as never)
    await wrapper.get('[data-test="line-group-members-C1"]').trigger('click')
    await flushPromises()
    return wrapper
  }
  const dialogText = () => document.body.querySelector('[data-test="line-members-dialog"]')?.textContent ?? ''

  it('顯示人數（不含官方帳號）與名稱清單', async () => {
    await openMembers({ count: 3, names: ['王老師', '李老師', '陳老師'], names_unavailable: null, truncated: false })
    expect(vi.mocked(api.get)).toHaveBeenLastCalledWith('/admin/line/groups/C1/members')
    const text = dialogText()
    expect(text).toContain('3 位成員（不含官方帳號）')
    expect(text).toContain('王老師')
    expect(text).toContain('陳老師')
    expect(text).not.toContain('只列出前 200 位')
    expect(text).not.toContain('沒有列出')
  })

  it('人數比名單多（LINE 只給手機版成員的名稱）：說明還有幾位沒列出；人數與名單一致時不說', async () => {
    await openMembers({ count: 5, names: ['王老師', '李老師', '陳老師'], names_unavailable: null, truncated: false })
    expect(document.body.querySelector('[data-test="line-members-unlisted"]')?.textContent).toContain('另有 2 位沒有列出')
  })

  it('超過 200 位時註明只列出前 200 位', async () => {
    await openMembers({ count: 350, names: Array.from({ length: 200 }, (_, i) => `老師${i}`), names_unavailable: null, truncated: true })
    expect(dialogText()).toContain('350 位成員（不含官方帳號）')
    expect(dialogText()).toContain('只列出前 200 位')
  })

  it('不是認證帳號：只有人數，說明原因', async () => {
    await openMembers({ count: 5, names: null, names_unavailable: 'unverified', truncated: false })
    expect(dialogText()).toContain('5 位成員（不含官方帳號）')
    expect(dialogText()).toContain('這個官方帳號不是認證帳號，LINE 只提供人數，不提供名單。')
  })

  it('暫時拿不到名單', async () => {
    await openMembers({ count: 5, names: null, names_unavailable: 'error', truncated: false })
    expect(dialogText()).toContain('暫時拿不到名單，請稍後再試。')
  })

  it('查詢失敗（群組已離開等）顯示同一句', async () => {
    const wrapper = await mountPage(settings([account()], [group()]))
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, { code: 'NOT_FOUND' }))
    await wrapper.get('[data-test="line-group-members-C1"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-test="line-members-error"]')?.textContent).toContain('暫時拿不到名單')
  })
})

describe('§5.2 稽核顯示', () => {
  it('按的人：line_display_name', () => {
    const lines = auditMetadataDetails({ group_id: 'Cabc', line_user_id: 'Uabc', line_display_name: '王老師' }, 'line.group.visit_attend').lines
    expect(lines).toContain('按的人：王老師')
    expect(lines.join('')).not.toContain('Uabc')
    expect(auditMetadataDetails({ line_display_name: '王老師' }, 'line.group.visit_attend').others).toEqual([])
  })

  it('圖文選單：動作有名稱，前後值翻成中文', () => {
    expect(AUDIT_ACTION_LABELS['line.rich_menu.update']).toBe('更新 LINE 圖文選單')
    expect(AUDIT_TARGET_LABELS.line_account).toBeTruthy()
    expect(auditMetadataSummary({ before: null, after: 'all' }, 'line.rich_menu.update')).toBe('圖文選單：不使用 → 所有好友')
    expect(auditMetadataSummary({ before: 'all', after: 'booked' }, 'line.rich_menu.update')).toBe('圖文選單：所有好友 → 只給已預約的家長')
    expect(auditMetadataSummary({ before: 'booked', after: null }, 'line.rich_menu.update')).toBe('圖文選單：只給已預約的家長 → 不使用')
    expect(auditSearchTerms('所有好友')).toContain('all')
  })

  it('在 LINE 裡預約時綁定：via liff', () => {
    const details = auditMetadataDetails({ account_key: 'yihua', via: 'liff' }, 'line.parent.link')
    expect(details.lines).toContain('在 LINE 裡預約時綁定')
    expect(details.others).toEqual([])
  })
})

describe('§6 好友輪廓', () => {
  function demographics(overrides: Partial<LineDemographicsOut['accounts'][number]> = {}): LineDemographicsOut {
    return {
      configured: true,
      accounts: [{
        key: 'yihua', display_name: '常春藤義華', available: true, error_status: null,
        genders: [{ key: 'female', percentage: 62.5 }, { key: 'male', percentage: 30 }, { key: 'unknown', percentage: 7.5 }],
        ages: [{ key: 'from30to34', percentage: 40 }, { key: 'from0to14', percentage: 5 }, { key: 'from50', percentage: 10 }, { key: 'from70', percentage: 2 }, { key: 'from15to19', percentage: 3 }],
        areas: [
          ...['高雄市', '台南市', '屏東縣', '台北市', '新北市', '台中市', '桃園市', '新竹市'].map((key, i) => ({ key, percentage: 20 - i })),
          { key: '嘉義市', percentage: 3 }, { key: 'unknown', percentage: 2 },
        ],
        subscription_periods: [{ key: 'over365days', percentage: 50 }, { key: 'within7days', percentage: 5 }, { key: 'within180days', percentage: 15 }],
        ...overrides,
      }],
    }
  }

  function insightsPayload() {
    return { configured: false, from_date: '2026-11-01', to_date: '2026-11-27', accounts: [], campuses: [] }
  }

  async function mountPanel(demo: LineDemographicsOut | Error) {
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.startsWith('/admin/line-insights/demographics')) {
        if (demo instanceof Error) throw demo
        return demo
      }
      return insightsPayload()
    }) as never)
    const wrapper = mount(LineInsightsPanel, { props: { days: 28 }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('標籤對照、順序與百分比', async () => {
    const wrapper = await mountPanel(demographics())
    const gender = wrapper.get('[data-test="line-demographics-yihua-gender"]').text()
    expect(gender).toMatch(/男.*女.*不明/)
    expect(gender).toContain('62.5%')
    const age = wrapper.get('[data-test="line-demographics-yihua-age"]').text()
    expect(age).toMatch(/14 歲以下.*15–19 歲.*30–34 歲.*50 歲以上.*70 歲以上/)
    const period = wrapper.get('[data-test="line-demographics-yihua-period"]').text()
    expect(period).toMatch(/7 天內.*半年內.*超過一年/)
    expect(wrapper.get('[data-test="line-demographics"]').text()).toContain('LINE 的估計值，約晚 3 天')
  })

  it('橫條寬度＝百分比，純 CSS', async () => {
    const wrapper = await mountPanel(demographics())
    const fills = wrapper.findAll('[data-test="line-demographics-yihua-gender"] .demo__fill').map(fill => (fill.element as HTMLElement).style.width)
    expect(fills).toEqual(['30%', '62.5%', '7.5%'])
  })

  it('地區只列前 8 名，其餘合成「其他」', async () => {
    const wrapper = await mountPanel(demographics())
    const rows = wrapper.findAll('[data-test="line-demographics-yihua-area"] .demo__row').map(row => row.text())
    expect(rows).toHaveLength(9)
    expect(rows[0]).toContain('高雄市')
    expect(rows[7]).toContain('新竹市')
    expect(rows[8]).toContain('其他')
    expect(rows[8]).toContain('5%')
    expect(rows.join('')).not.toContain('嘉義市')
  })

  it('地區剛好 8 個以內不產生「其他」', () => {
    const bars = areaBars([{ key: '高雄市', percentage: 70 }, { key: 'unknown', percentage: 30 }])
    expect(bars.map(bar => bar.label)).toEqual(['高雄市', '不明'])
  })

  it('好友不到 20 位：說明沒有輪廓', async () => {
    const wrapper = await mountPanel(demographics({ available: false, genders: [], ages: [], areas: [], subscription_periods: [] }))
    expect(wrapper.get('[data-test="line-demographics-unavailable"]').text()).toBe('好友不到 20 位，LINE 不提供輪廓。')
    expect(wrapper.find('[data-test="line-demographics-yihua-gender"]').exists()).toBe(false)
  })

  it('某個帳號查詢失敗：只那個帳號顯示查詢失敗', async () => {
    const wrapper = await mountPanel(demographics({ error_status: 401 }))
    expect(wrapper.get('[data-test="line-demographics-account-error"]').text()).toContain('查詢失敗')
  })

  it('輪廓整段讀不到時，原本的好友數表照常顯示', async () => {
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.startsWith('/admin/line-insights/demographics')) throw new ApiError(502, { code: 'X' })
      return { ...insightsPayload(), configured: true, accounts: [] }
    }) as never)
    const wrapper = mount(LineInsightsPanel, { props: { days: 28 }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.find('[data-test="line-insights-accounts"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="line-demographics-error"]').text()).toContain('好友輪廓暫時讀不到')
  })
})
