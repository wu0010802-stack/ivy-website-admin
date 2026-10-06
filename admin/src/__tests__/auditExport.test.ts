// 操作紀錄期間篩選與匯出（2026-10-06）：匯出依目前校區、期間與搜尋，逐頁讀完（每次 500 筆），
// 超過 5,000 筆不產生檔案、提示縮短期間。裝置欄人人有，IP 欄只有總部（後端只給總部 IP）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AuditView from '../views/AuditView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { auditCsvHeader, auditCsvRow, auditCsvTime, auditSearchText, AUDIT_CSV_HEADER } from '../utils/auditFormat'
import { auditMetadataDetails } from '../api/labels'
import { testUser } from './fixtures'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))
import { downloadCsv } from '../utils/csv'
import { notifyError, notifyWarning } from '../composables/notify'

const IPHONE_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.mocked(downloadCsv).mockClear()
  vi.mocked(notifyWarning).mockClear()
  vi.mocked(notifyError).mockClear()
})

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, actor_user_id: 'me', actor_email: 'amy@ivy.example', actor_display_name: '王小美',
    action: 'visit_request.export', target_type: 'visit_request', target_id: 'yihua', target_label: null, target_exists: null,
    campus_key: 'yihua', metadata: { row_count: 3 }, created_at: '2026-09-28T06:30:00Z', ...extra,
  }
}

async function mountAudit(role: 'super_admin' | 'campus_admin' = 'super_admin', campusKeys: string[] = ['yihua']) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser(role, { id: 'me', campus_keys: role === 'campus_admin' ? campusKeys : [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/audit')
  await router.isReady()
  const wrapper = mount(AuditView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const paramsOf = (url: unknown) => new URL(String(url), 'http://x').searchParams
const isExportCall = (url: unknown) => paramsOf(url).get('limit') === '500'

describe('操作紀錄 CSV 的欄位', () => {
  it('台北時間、操作者與完整 Email、動作與細節是中文', () => {
    const row = entry('a1')
    expect(auditCsvTime(row.created_at)).toBe('2026/09/28 14:30')
    expect(AUDIT_CSV_HEADER).toEqual(['日期時間', '操作者', '操作者 Email', '動作', '對象類型', '對象帳號', '校區', '細節', '其他細節', '裝置'])
    const cells = auditCsvRow(row as never, auditMetadataDetails(row.metadata, row.action))
    expect(cells.slice(0, 4)).toEqual(['2026/09/28 14:30', '王小美', 'amy@ivy.example', '匯出家長個資'])
    expect(cells[6]).toBe('義華')
    expect(String(cells[7])).toContain('匯出 3 筆')
    expect(cells).toHaveLength(AUDIT_CSV_HEADER.length)
  })

  it('裝置寫解析後的短字；總部多一欄 IP，其他人沒有 IP 欄', () => {
    const row = entry('a1', { user_agent: IPHONE_LINE, ip_address: '203.0.113.9' }) as never
    const details = auditMetadataDetails({}, 'visit_request.export')
    expect(auditCsvHeader(false)).toEqual(AUDIT_CSV_HEADER)
    expect(auditCsvHeader(true)).toEqual([...AUDIT_CSV_HEADER, 'IP'])
    expect(auditCsvRow(row, details, false).at(-1)).toBe('iPhone・LINE')
    expect(auditCsvRow(row, details, false)).toHaveLength(AUDIT_CSV_HEADER.length)
    const withIp = auditCsvRow(row, details, true)
    expect(withIp).toHaveLength(AUDIT_CSV_HEADER.length + 1)
    expect(withIp.slice(-2)).toEqual(['iPhone・LINE', '203.0.113.9'])
  })

  it('沒有來源資訊的紀錄（改版前、系統動作）裝置與 IP 留空白', () => {
    const row = entry('a1', { user_agent: null, ip_address: null }) as never
    const cells = auditCsvRow(row, { lines: [], others: [] }, true)
    expect(cells.slice(-2)).toEqual(['', ''])
  })
})

describe('操作紀錄的搜尋文字', () => {
  it('包含裝置與 IP（畫面與匯出共用同一份）', () => {
    const row = entry('a1', { user_agent: IPHONE_LINE, ip_address: '203.0.113.9' }) as never
    const text = auditSearchText(row, { lines: [], others: [] })
    expect(text).toContain('203.0.113.9')
    expect(text).toContain('iphone・line')
    expect(text).toContain('王小美')
    expect(text).toBe(text.toLocaleLowerCase())
  })
})

describe('操作紀錄期間篩選', () => {
  it('選了期間就帶 created_from／created_to 重新讀取', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const wrapper = await mountAudit()
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await flushPromises()
    const params = paramsOf(get.mock.calls.at(-1)![0])
    expect(params.get('created_from')).toBe('2026-09-01')
    expect(params.get('created_to')).toBe('2026-09-30')
  })

  it('清掉期間就不再帶日期參數', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const wrapper = await mountAudit()
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    picker.vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await flushPromises()
    picker.vm.$emit('update:modelValue', null)
    await flushPromises()
    const params = paramsOf(get.mock.calls.at(-1)![0])
    expect(params.has('created_from')).toBe(false)
    expect(params.has('created_to')).toBe(false)
  })

  it('不能選今天以後的日期', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const wrapper = await mountAudit()
    const disabled = wrapper.findComponent({ name: 'ElDatePicker' }).props('disabledDate') as (date: Date) => boolean
    expect(disabled(new Date(2099, 0, 1))).toBe(true)
    expect(disabled(new Date(2020, 0, 1))).toBe(false)
  })
})

describe('操作紀錄匯出 CSV', () => {
  it('每次讀 500 筆、用最後一筆當游標讀到完，全部寫進檔案', async () => {
    const first = Array.from({ length: 500 }, (_, i) => entry(`a${i}`))
    const get = vi.spyOn(api, 'get').mockImplementation((url) => {
      const params = paramsOf(url)
      if (!isExportCall(url)) return Promise.resolve([entry('screen')]) as Promise<never>
      return Promise.resolve(params.has('before') ? [entry('last', { created_at: '2026-09-01T01:00:00Z' })] : first) as Promise<never>
    })
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const exportCalls = get.mock.calls.map((call) => paramsOf(call[0])).filter((params) => params.get('limit') === '500')
    expect(exportCalls).toHaveLength(2)
    expect(exportCalls[1]!.get('before_id')).toBe('a499')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toMatch(/^操作紀錄-全部校區-全部期間-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')).toHaveLength(1 + 501 + 1)
  })

  it('游標分頁、期間、校區、不列登入與 limit=500 同時帶，每一頁條件都一樣', async () => {
    const first = Array.from({ length: 500 }, (_, i) => entry(`a${i}`, { created_at: `2026-09-20T0${i % 10}:00:00Z` }))
    const get = vi.spyOn(api, 'get').mockImplementation((url) => {
      if (!isExportCall(url)) return Promise.resolve([entry('screen')]) as Promise<never>
      return Promise.resolve(paramsOf(url).has('before') ? [entry('last')] : first) as Promise<never>
    })
    const wrapper = await mountAudit()
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await flushPromises()
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'yihua')
    await wrapper.get('[data-test="audit-hide-logins"] input').setValue(true)
    await flushPromises()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const pages = get.mock.calls.map((call) => paramsOf(call[0])).filter((params) => params.get('limit') === '500')
    expect(pages).toHaveLength(2)
    for (const params of pages) {
      expect(params.get('created_from')).toBe('2026-09-01')
      expect(params.get('created_to')).toBe('2026-09-30')
      expect(params.get('campus_key')).toBe('yihua')
      expect(params.get('exclude_login')).toBe('true')
    }
    expect(pages[0]!.has('before')).toBe(false)
    // 第二頁的游標是第一頁最後一筆（時間與 id 一起帶）。
    expect(pages[1]!.get('before')).toBe(first[499]!.created_at)
    expect(pages[1]!.get('before_id')).toBe('a499')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toMatch(/^操作紀錄-義華-2026-09-01至2026-09-30-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')).toHaveLength(1 + 501 + 1)
  })

  it('匯出途中改了篩選，後面幾頁仍用按下去當時的條件', async () => {
    const first = Array.from({ length: 500 }, (_, i) => entry(`a${i}`))
    let release: (rows: unknown[]) => void = () => undefined
    const get = vi.spyOn(api, 'get').mockImplementation((url) => {
      if (!isExportCall(url)) return Promise.resolve([entry('screen')]) as Promise<never>
      if (paramsOf(url).has('before')) return Promise.resolve([entry('last')]) as Promise<never>
      return new Promise<never>((resolve) => { release = resolve as unknown as (rows: unknown[]) => void })
    })
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-01-01', '2026-01-31'])
    await flushPromises()
    release(first)
    await flushPromises()
    const pages = get.mock.calls.map((call) => paramsOf(call[0])).filter((params) => params.get('limit') === '500')
    expect(pages).toHaveLength(2)
    expect(pages[1]!.has('created_from')).toBe(false)
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toContain('全部期間')
  })

  it('超過 5,000 筆就停下、不產生檔案，提示縮短期間', async () => {
    const page = Array.from({ length: 500 }, (_, i) => entry(`p${i}`))
    vi.spyOn(api, 'get').mockImplementation((url) => Promise.resolve(isExportCall(url) ? page : [entry('screen')]) as Promise<never>)
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(vi.mocked(notifyWarning).mock.calls.at(-1)![0]).toContain('超過 5,000 筆')
    expect(vi.mocked(notifyWarning).mock.calls.at(-1)![0]).toContain('縮短期間')
  })

  it('剛好 5,000 筆還可以匯出', async () => {
    let served = 0
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (!isExportCall(url)) return Promise.resolve([entry('screen')]) as Promise<never>
      const rows = served < 10 ? Array.from({ length: 500 }, (_, i) => entry(`p${served}-${i}`)) : []
      served += 1
      return Promise.resolve(rows) as Promise<never>
    })
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    expect(notifyWarning).not.toHaveBeenCalled()
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![1].split('\r\n')).toHaveLength(1 + 5000 + 1)
  })

  it('有搜尋字時只匯出符合的紀錄', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(
        isExportCall(url)
          ? [entry('a1'), entry('a2', { action: 'user.create', target_type: 'user', metadata: {} })]
          : [entry('screen')],
      ) as Promise<never>,
    )
    const wrapper = await mountAudit()
    await wrapper.get('.filter-search input').setValue('新增帳號')
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('新增帳號')
    expect(csv).not.toContain('匯出家長個資')
  })

  it('可以用 IP 或裝置搜尋再匯出（和畫面搜尋一致）', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(
        isExportCall(url)
          ? [entry('a1', { ip_address: '203.0.113.9', user_agent: IPHONE_LINE }), entry('a2', { ip_address: '198.51.100.7', user_agent: 'curl/8.7.1' })]
          : [entry('screen')],
      ) as Promise<never>,
    )
    const wrapper = await mountAudit()
    await wrapper.get('.filter-search input').setValue('203.0.113')
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('203.0.113.9')
    expect(csv).not.toContain('198.51.100.7')
  })

  it('總部的檔案有 IP 欄與裝置欄', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(isExportCall(url) ? [entry('a1', { ip_address: '203.0.113.9', user_agent: IPHONE_LINE })] : [entry('screen')]) as Promise<never>,
    )
    const wrapper = await mountAudit('super_admin')
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const [headerLine, rowLine] = vi.mocked(downloadCsv).mock.calls.at(-1)![1].split('\r\n')
    expect(headerLine!.replace(/^\uFEFF/, '')).toBe(auditCsvHeader(true).join(','))
    expect(rowLine!.endsWith(',iPhone・LINE,203.0.113.9')).toBe(true)
  })

  it('校區管理員的檔案只有裝置欄，沒有 IP 欄', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(isExportCall(url) ? [entry('a1', { ip_address: '203.0.113.9', user_agent: IPHONE_LINE })] : [entry('screen')]) as Promise<never>,
    )
    const wrapper = await mountAudit('campus_admin')
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const [headerLine, rowLine] = vi.mocked(downloadCsv).mock.calls.at(-1)![1].split('\r\n')
    expect(headerLine!.replace(/^\uFEFF/, '')).toBe(AUDIT_CSV_HEADER.join(','))
    expect(headerLine).not.toContain('IP')
    expect(rowLine!.endsWith(',iPhone・LINE')).toBe(true)
    expect(rowLine).not.toContain('203.0.113.9')
  })

  it('讀取失敗就提示、不產生檔案，按鈕可以再按', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      isExportCall(url) ? Promise.reject(new ApiError(500, { code: 'INTERNAL_ERROR' })) : (Promise.resolve([entry('screen')]) as Promise<never>),
    )
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-test="audit-export"]').classes()).not.toContain('is-loading')
  })

  it('校區管理員自動帶入自己的校區就能匯出；沒有任何校區時不顯示匯出鈕', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const scoped = await mountAudit('campus_admin', ['yihua'])
    expect(scoped.find('[data-test="audit-export"]').exists()).toBe(true)
    expect(paramsOf(get.mock.calls.at(-1)![0]).get('campus_key')).toBe('yihua')
    const none = await mountAudit('campus_admin', [])
    expect(none.find('[data-test="audit-export"]').exists()).toBe(false)
  })
})
