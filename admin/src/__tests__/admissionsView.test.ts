import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import AdmissionsView from '../views/AdmissionsView.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { routes } from '../router'
import { canSeeNavItem, NAV_GROUPS, navItem } from '../router/nav'
import { testUser } from './fixtures'
import { arrivalRow, arrivals, cleanup, deferred, mockGet, mountWith, options, pathsTo, VR_ID, VR_ID_2 } from './admissionsTestKit'

afterEach(cleanup)

// 2026-10-01（台北）＝115 學年上學期。
function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
}
// options 預設照常回資料（開關開啟）；arrivals 預設空。
const noArrivals = {
  '/admin/admissions/options': options(),
  '/admin/admissions/arrivals': arrivals(),
  '/admin/admissions/stats': () => {
    throw new Error('統計不在這支測試的範圍')
  },
}
const tabTexts = (wrapper: VueWrapper) => wrapper.findAll('.el-tabs__item').map((tab) => tab.text().replace(/\s+/g, ''))

describe('側欄與路由', () => {
  it('「招生入學」在參觀預約組、參觀場次之後；總管理、分校管理、接待看得到，編輯與唯讀看不到', () => {
    const visits = NAV_GROUPS.find((group) => group.key === 'visits')!.items.map((item) => item.name)
    expect(visits.indexOf('admissions')).toBe(visits.indexOf('visit-calendar') + 1)
    const item = navItem('admissions')!
    expect(item).toMatchObject({ path: '/admissions', title: '招生入學', icon: 'TrendCharts' })
    for (const role of ['super_admin', 'campus_admin', 'reception']) expect(canSeeNavItem(item, { role })).toBe(true)
    for (const role of ['editor', 'readonly']) expect(canSeeNavItem(item, { role })).toBe(false)
    const children = routes.find((route) => route.path === '/')!.children!
    expect(children.find((route) => route.name === 'admissions')).toMatchObject({ path: 'admissions', meta: { title: '招生入學' } })
  })
})

describe('招生入學頁：篩選與分頁跟網址雙向同步（規格第 10 節）', () => {
  it('網址上的校區、學年、學期、分頁掛載時讀回來', async () => {
    freezeToday()
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('統計分析')
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', schoolYear: 114, semester: 2 })
  })

  it('沒帶參數：第一個可見校區、目前學年、整學年、漏斗看板；改條件用 replace 寫回網址，不限學年寫成 sy=all', async () => {
    freezeToday()
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
    const [, year, semester] = wrapper.findAllComponents({ name: 'ElSelect' })
    year!.vm.$emit('update:modelValue', undefined)
    semester!.vm.$emit('update:modelValue', 2)
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'stats')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', sem: '2', tab: 'stats' })
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'yihua', schoolYear: null, semester: 2 })
  })

  it('網址被改（上一頁、從其他頁連進來）時畫面跟著換', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats' })
    await router.push('/admissions?campus=renwu&tab=stats&sem=1')
    await flushPromises()
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', semester: 1 })
  })

  it('F1：使用者主動換校會清掉 vr；從帶 campus＋vr 的網址進來時兩個都保留', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&vr=${VR_ID}` })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', vr: VR_ID })
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu', tab: 'records' })
  })

  it('F6a：民國月份只收三位數年份，99.09 被丟掉、115.09 保留', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=99.09' })
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    cleanup()
    mockGet({ ...noArrivals, '/admin/admissions/records': [] })
    const good = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=115.09' })
    expect(good.router.currentRoute.value.query).toMatchObject({ month: '115.09' })
  })

  it('看不到的校區、亂寫的學期與分頁一律退回預設', async () => {
    mockGet(noArrivals)
    const user = testUser('campus_admin', { campus_keys: ['renwu'] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sem=9&tab=hack', user })
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
  })
})

describe('官網預約分頁標籤與權限', () => {
  it('標籤用 awaiting_total，不用清單長度（R6）', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/arrivals': arrivals([arrivalRow()], [], { awaiting_total: 230 }) })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(wrapper.get('.admissions__count').text()).toBe('230')
  })

  it('標籤顯示待確認筆數；沒有 booking.read 的人看不到這個分頁，網址帶 tab=arrivals 退回看板', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/arrivals': arrivals([arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })]) })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(tabTexts(wrapper)).toEqual(['漏斗看板', '待追蹤', '訪視明細', '名額規劃', '官網預約2', '統計分析'])
    cleanup()

    const get = mockGet({ '/admin/admissions/options': options() })
    const noBooking = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read'] })
    const second = await mountWith(AdmissionsView, { path: '/admissions?tab=arrivals', user: noBooking })
    expect(tabTexts(second.wrapper)).toEqual(['漏斗看板', '待追蹤', '訪視明細', '名額規劃', '統計分析'])
    expect(second.router.currentRoute.value.query.tab).toBeUndefined()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toEqual([])
  })

  it('快速切換校區：標籤只採用最後一次的待確認筆數', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...noArrivals,
      '/admin/admissions/arrivals': (path: string) => (path.includes('campus_key=yihua') ? slow.promise : arrivals([arrivalRow()])),
    })
    const { wrapper } = await mountWith(AdmissionsView)
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    slow.resolve(arrivals([arrivalRow(), arrivalRow(), arrivalRow()]))
    await flushPromises()
    expect(wrapper.get('.admissions__count').text()).toBe('1')
  })

  it('沒有負責校區的帳號看到說明，不送任何招生請求', async () => {
    const get = mockGet({})
    const { wrapper } = await mountWith(AdmissionsView, { user: testUser('campus_admin', { campus_keys: [] }) })
    expect(wrapper.text()).toContain('你的帳號還沒有負責的校區')
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
  })
})

describe('招生開關關閉（R1）', () => {
  it('options 回 404：顯示「招生入學尚未啟用」，沒有分頁、不讀官網預約，也沒有錯誤訊息', async () => {
    const { ApiError } = await import('../api/client')
    const get = mockGet({
      '/admin/admissions/options': () => { throw new ApiError(404, { code: 'NOT_FOUND' }) },
      '/admin/admissions/arrivals': arrivals([arrivalRow()]),
    })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(wrapper.text()).toContain('招生入學尚未啟用')
    expect(wrapper.text()).toContain('開啟後這裡會出現漏斗看板、待追蹤、訪視明細、名額規劃、官網預約與統計分析。')
    expect(wrapper.findAll('.el-tabs__item')).toHaveLength(0)
    expect(pathsTo(get, '/admin/admissions/arrivals')).toEqual([])
    expect(document.body.querySelector('.el-message')).toBeNull()
  })

  it('其他錯誤照常掛分頁', async () => {
    mockGet({
      '/admin/admissions/options': () => { throw new Error('boom') },
      '/admin/admissions/arrivals': arrivals(),
    })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(wrapper.text()).not.toContain('招生入學尚未啟用')
    expect(wrapper.findAll('.el-tabs__item').length).toBeGreaterThan(0)
  })
})

describe('統計分析與頁面的接縫（C3）', () => {
  it('統計分頁拿到頁首的校區、學年學期與看得到的校區（決定有沒有五校比較）', async () => {
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.findComponent(StatsTab).props()).toEqual({
      campusKey: 'renwu', schoolYear: 114, semester: 2, sub: 'overview', campusKeys: ['yihua', 'minghua', 'chongde', 'international', 'renwu'],
    })
  })

  it('警示或行動入口要看某月明細：切到訪視明細並帶 month；用 push，上一頁回到統計', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats' })
    const push = vi.spyOn(router, 'push')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ query: { campus: 'yihua', tab: 'records', month: '115.09' } })
  })
})

describe('頁首學年選項與網址（X2a 1A）', () => {
  const yearLabels = (wrapper: VueWrapper) => {
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[1]!
    return select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))
  }

  it('選項和新增／編輯表單一致：目前學年 +3 到 −2；網址帶 sy=+3 能還原', async () => {
    freezeToday()
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?sy=118' })
    expect(yearLabels(wrapper)).toEqual([118, 117, 116, 115, 114, 113])
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[1]!
    expect(select.props('modelValue')).toBe(118)
  })
})

describe('統計子分頁寫進網址（X2a 3A）', () => {
  it('(a) 網址 tab=stats&sub=nodeposit 掛載：子分頁是未預繳原因', async () => {
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('nodeposit')
  })

  it('(b) 切子分頁用 replace 寫 sub；切回總覽不帶 sub；離開統計分頁也拿掉', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats' })
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', tab: 'stats', sub: 'source' } })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', tab: 'stats' } })
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'staff')
    await flushPromises()
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'records')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    expect(push).not.toHaveBeenCalled()
  })

  it('(c) 名單「查看」push 前的網址帶 sub=nodeposit，上一頁回到未預繳原因', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit' })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('records')
    expect(wrapper.findComponent(StatsTab).exists()).toBe(false)
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'nodeposit' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('nodeposit')
  })

  it('(d) 不合法的 sub 與沒有權限看的 sub=compare 退回總覽', async () => {
    mockGet(noArrivals)
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=hack' })
    expect(bad.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats' })
    cleanup()
    mockGet(noArrivals)
    const single = testUser('campus_admin', { campus_keys: ['renwu'] })
    const compare = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&tab=stats&sub=compare', user: single })
    expect(compare.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(compare.router.currentRoute.value.query).toEqual({ campus: 'renwu', tab: 'stats' })
  })
})

describe('頁首篩選的作用範圍與手機摘要', () => {
  it('待追蹤、官網預約不分入學學年學期：兩個下拉停用並說明，切回其他分頁恢復', async () => {
    mockGet({ ...noArrivals, '/admin/admissions/followups': { items: [], totals: { due: 0, all: 0 }, total: 0 } })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?tab=arrivals' })
    const [, year, semester] = wrapper.findAllComponents({ name: 'ElSelect' })
    expect([year!.props('disabled'), semester!.props('disabled')]).toEqual([true, true])
    expect(wrapper.text()).toContain('這個分頁不分入學學年學期')
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'records')
    await flushPromises()
    const [, year2] = wrapper.findAllComponents({ name: 'ElSelect' })
    expect(year2!.props('disabled')).toBe(false)
    expect(wrapper.text()).not.toContain('這個分頁不分入學學年學期')
  })

  it('手機：篩選收成一顆摘要鈕，點開才出現下拉；待追蹤只寫校區與「不分學年學期」', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    freezeToday()
    mockGet({ ...noArrivals, '/admin/admissions/followups': { items: [], totals: { due: 0, all: 0 }, total: 0 } })
    try {
      const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sy=115' })
      const summary = wrapper.get('.admissions__summary')
      expect(summary.text()).toContain('義華・115 學年・整學年')
      expect(summary.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('#admissions-filters').exists()).toBe(false)
      await summary.trigger('click')
      expect(summary.attributes('aria-expanded')).toBe('true')
      expect(wrapper.find('#admissions-filters').exists()).toBe(true)
      wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'followups')
      await flushPromises()
      expect(wrapper.get('.admissions__summary').text()).toContain('義華・不分學年學期')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
