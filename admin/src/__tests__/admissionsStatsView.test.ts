// 招生統計（2026-10-16 業主裁定）：招生入學的「統計分析」分頁抽成獨立的側欄頁，只有總管理者看得到。
// 這裡測側欄與路由、舊連結轉址，以及頁面與 StatsTab 的接縫（原本在 admissionsView.test.ts 的統計部分搬過來）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type NavigationGuardWithThis } from 'vue-router'
import AdmissionsStatsView from '../views/AdmissionsStatsView.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { STATS_SUBS } from '../admissions/useAdmissionsFilters'
import { authGuard, routes } from '../router'
import { canListNavItem, canOpenPath, canSeeNavItem, NAV_GROUPS, navItem, navItemMatchScore, normalizeSearch } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { campusAdmin, cleanup, journeyData, mockGet, mountWith, options, pathsTo, queryOf, reception, superAdmin } from './admissionsTestKit'

vi.mock('../components/analytics/BookingStatsPane.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'BookingStatsPane',
      props: ['campusKey', 'campusKeys'],
      setup: () => () => h('div', { class: 'booking-stats-stub' }),
    }),
  }
})

afterEach(cleanup)

// 2026-10-01（台北）＝115 學年上學期。
function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
}
// options 預設照常回資料（開關開啟）；招生統計的讀取不在這裡驗，丟錯讓 StatsTab 停在錯誤狀態。
const routesOn = {
  '/admin/admissions/options': options(),
  '/admin/admissions/stats': () => {
    throw new Error('統計不在這支測試的範圍')
  },
}
const statsPath = (query = '') => `/admissions-stats${query ? `?${query}` : ''}`

describe('側欄與路由', () => {
  it('「招生統計」在參觀預約組、招生入學之後；只有總管理者看得到，招生開關關閉時不列出', () => {
    const visits = NAV_GROUPS.find((group) => group.key === 'visits')!.items.map((item) => item.name)
    expect(visits.indexOf('admissions-stats')).toBe(visits.indexOf('admissions') + 1)
    const item = navItem('admissions-stats')!
    expect(item).toMatchObject({ path: '/admissions-stats', title: '招生統計', icon: 'DataAnalysis', roles: ['super_admin'], feature: 'admissions' })
    expect(canSeeNavItem(item, { role: 'super_admin' })).toBe(true)
    for (const role of ['campus_admin', 'reception', 'editor', 'readonly']) expect(canSeeNavItem(item, { role })).toBe(false)
    expect(canListNavItem(item, superAdmin(), { admissions: true })).toBe(true)
    expect(canListNavItem(item, superAdmin(), { admissions: false })).toBe(false)
    expect(canOpenPath('/admissions-stats?sub=area', campusAdmin())).toBe(false)
    expect(canOpenPath('/admissions-stats?sub=area', superAdmin())).toBe(true)
    const children = routes.find((route) => route.path === '/')!.children!
    expect(children.find((route) => route.name === 'admissions-stats')).toMatchObject({
      path: 'admissions-stats', meta: { title: '招生統計', roles: ['super_admin'] },
    })
  })

  it('側欄搜尋：統計的說法找到招生統計，不再找到招生入學；漏斗、預繳仍是招生入學', () => {
    const stats = navItem('admissions-stats')!
    const admissions = navItem('admissions')!
    for (const word of ['五校比較', '班別', '預約統計', '到場率', '區域分析', '統計分析']) {
      expect(navItemMatchScore(stats, normalizeSearch(word)), word).toBeGreaterThan(0)
      expect(navItemMatchScore(admissions, normalizeSearch(word)), word).toBe(0)
    }
    for (const word of ['漏斗', '預繳', '訪視明細']) expect(navItemMatchScore(admissions, normalizeSearch(word)), word).toBeGreaterThan(0)
  })

  it('直接開網址：非總管理者被導回起始頁並帶 denied，總管理者進得去', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const target = router.resolve('/admissions-stats?campus=yihua&sub=area')
    setActivePinia(createPinia())
    for (const user of [campusAdmin(), reception()]) {
      useAuthStore().user = user
      expect(await authGuard(target as never)).toEqual({ path: '/', query: { denied: 'admissions-stats' } })
    }
    useAuthStore().user = superAdmin()
    expect(await authGuard(target as never)).toBe(true)
  })
})

describe('舊連結 /admissions?tab=stats', () => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const record = routes.find((route) => route.path === '/')!.children!.find((route) => route.name === 'admissions')!
  const enter = (path: string) => (record.beforeEnter as NavigationGuardWithThis<undefined>).call(undefined, router.resolve(path) as never, router.resolve('/') as never, () => {})

  it('總管理者：轉到招生統計，校區、學年學期、子分頁與預約全程的條件都帶過去，tab 拿掉', () => {
    setActivePinia(createPinia())
    useAuthStore().user = superAdmin()
    expect(enter('/admissions?campus=renwu&sy=114&sem=2&tab=stats&sub=journey&jp=180')).toEqual({
      path: '/admissions-stats', query: { campus: 'renwu', sy: '114', sem: '2', sub: 'journey', jp: '180' }, replace: true,
    })
    expect(enter('/admissions?campus=yihua&tab=records')).toBe(true)
    expect(enter('/admissions')).toBe(true)
  })

  it('看不到招生統計的人照常進招生入學（tab=stats 在那裡退回漏斗看板）', () => {
    setActivePinia(createPinia())
    for (const user of [campusAdmin(), reception()]) {
      useAuthStore().user = user
      expect(enter('/admissions?campus=yihua&tab=stats&sub=area')).toBe(true)
    }
  })

  it('系統狀態「看區域分析」直接連招生統計的區域分析', async () => {
    const { itemLink } = await import('../utils/systemStatusFormat')
    const link = itemLink({ key: 'income', label: '', level: 'attention', detail: {} } as never, 'datasets')
    expect(link).toEqual({ to: '/admissions-stats?sub=area', label: '看區域分析' })
  })
})

describe('招生統計頁：篩選與子分頁跟網址雙向同步', () => {
  it('網址上的校區、學年、學期讀回來；StatsTab 拿到頁首的條件與看得到的校區（決定有沒有五校比較）', async () => {
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=renwu&sy=114&sem=2') })
    expect(wrapper.findComponent(StatsTab).props()).toEqual({
      campusKey: 'renwu', schoolYear: 114, semester: 2, sub: 'overview', campusKeys: ['yihua', 'minghua', 'chongde', 'international', 'renwu'],
      journey: { period: '90', from: '', to: '', source: 'all' },
      areaView: { map: null, village: '', table: 'village' },
    })
    expect(wrapper.findAll('.admissions__tabs')).toHaveLength(0)
  })

  it('沒帶參數：第一個可見校區、目前學年、整學年、總覽；改條件用 replace 寫回網址，沒有 tab', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath() })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    const [, year, semester] = wrapper.findAllComponents({ name: 'ElSelect' })
    year!.vm.$emit('update:modelValue', undefined)
    semester!.vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', sem: '2' })
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'yihua', schoolYear: null, semester: 2 })
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu', sy: 'all', sem: '2' })
  })

  it('網址被改（上一頁、從其他頁連進來）時畫面跟著換', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath() })
    await router.push(statsPath('campus=renwu&sem=1&sub=source'))
    await flushPromises()
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', semester: 1, sub: 'source' })
  })

  it('招生入學的參數（tab、vr、month、area、wr）出現在網址上一律拿掉', async () => {
    mockGet(routesOn)
    const { router } = await mountWith(AdmissionsStatsView, {
      path: statsPath('campus=yihua&tab=records&vr=11111111-2222-4333-8444-555555555555&month=115.09&area=%E4%B8%89%E6%B0%91%E5%8D%80&wr=unclassified&sub=nodeposit'),
    })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'nodeposit' })
  })

  it('options 回 404：顯示「招生入學尚未啟用」，不掛統計、不讀統計', async () => {
    const { ApiError } = await import('../api/client')
    const get = mockGet({
      '/admin/admissions/options': () => { throw new ApiError(404, { code: 'NOT_FOUND' }) },
    })
    const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath() })
    expect(wrapper.text()).toContain('招生入學尚未啟用')
    expect(wrapper.text()).toContain('開啟後這裡會出現招生與參觀預約的統計。')
    expect(wrapper.findComponent(StatsTab).exists()).toBe(false)
    expect(pathsTo(get, '/admin/admissions/stats')).toEqual([])
  })
})

describe('「查看明細」到招生入學的訪視明細', () => {
  it('警示或行動入口要看某月明細：push 到招生入學、帶校區學年學期與 month', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sy=114&sem=1&sub=nodeposit') })
    const push = vi.spyOn(router, 'push')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/admissions', query: { campus: 'yihua', sy: '114', sem: '1', tab: 'records', month: '115.09' } })
  })

  it('區域分析帶 area、退出原因分佈帶 wr；子分頁與預約全程的條件不帶過去', async () => {
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=area') })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { area: '三民區/本揚里' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admissions')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', area: '三民區/本揚里' })
    cleanup()
    mockGet(routesOn)
    const withdraw = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=nodeposit') })
    withdraw.wrapper.findComponent(StatsTab).vm.$emit('open-records', { withdraw: 'unclassified' })
    await flushPromises()
    expect(withdraw.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr: 'unclassified' })
  })

  it('上一頁回到離開時的子分頁；不在招生統計時不理會網址（招生入學的 tab 不會被讀成統計的條件）', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=nodeposit') })
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admissions')
    expect(replace).not.toHaveBeenCalled()
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admissions-stats')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'nodeposit' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('nodeposit')
  })
})

describe('子分頁寫進網址（X2a 3A）', () => {
  it('(a) 網址 sub=nodeposit 掛載：子分頁是未預繳與退出原因', async () => {
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=nodeposit') })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('nodeposit')
  })

  it('(b) 切子分頁用 replace 寫 sub；切回總覽不帶 sub', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua') })
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', sub: 'source' } })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua' } })
    expect(push).not.toHaveBeenCalled()
  })

  it('(d) 不合法的 sub 與只有一校時的 sub=compare 退回總覽', async () => {
    mockGet(routesOn)
    const bad = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=hack') })
    expect(bad.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    cleanup()
    // 招生統計只開給總管理者（五校）；五校比較只有一校時不出現是 StatsTab 自己的規則，這裡仍守住。
    mockGet(routesOn)
    const single = testUser('campus_admin', { campus_keys: ['renwu'] })
    const compare = await mountWith(AdmissionsStatsView, { path: statsPath('campus=renwu&sub=compare'), user: single })
    expect(compare.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(compare.router.currentRoute.value.query).toEqual({ campus: 'renwu' })
  })

  it('(g) 區域分析排在接待之後、未預繳之前；sub=area 跟其他子分頁一樣用 replace 寫進網址', async () => {
    expect(STATS_SUBS).toEqual(['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare', 'booking', 'journey'])
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua') })
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'area')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', sub: 'area' } })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('area')
  })

  // 預約全程（2026-10-15）：jp／jf／jt／js 只在 sub=journey 有意義。
  it('(j) sub=journey 的期間與來源讀得回來、改了寫回網址；換到別的子分頁拿掉', async () => {
    freezeToday()
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=journey&jp=180&js=web') })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('journey')
    expect(wrapper.findComponent(StatsTab).props('journey')).toEqual({ period: '180', from: '', to: '', source: 'web' })
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:journey', { period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'assisted' })
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({
      query: { campus: 'yihua', sub: 'journey', jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' },
    })
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'source' })
  })

  it('(k) 別的子分頁網址上多出來的 jp／js 被忽略，也不寫回', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=source&jp=365&js=web') })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'source' })
  })

  it('(l) 看過預約全程後換子分頁：預約全程不在背景重讀', async () => {
    freezeToday()
    const get = mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=journey') })
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
  })

  it('(m) 預約全程選了非預設期間後換子分頁：重設篩選不在背景重讀；回來才用預設篩選讀一次', async () => {
    freezeToday()
    const get = mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=journey&jp=365&js=web') })
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'journey')
    await flushPromises()
    const paths = pathsTo(get, '/admin/admissions/journey')
    expect(paths).toHaveLength(2)
    expect(Object.fromEntries(queryOf(paths[1]!))).toMatchObject({ source: 'all', from: '2026-07-04', to: '2026-10-01' })
  })

  // 區域分析工作台（2026-10-16）：map／village／table 只在 sub=area 有意義，寫法見 admissions/areaView.ts。
  it('(m) sub=area 的 map／village／table 讀得回來；StatsTab 改了用 replace 寫回；換子分頁拿掉', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, {
      path: statsPath('campus=yihua&sub=area&map=trend&village=64000050015&table=school'),
    })
    expect(wrapper.findComponent(StatsTab).props('areaView')).toEqual({ map: 'trend', village: '64000050015', table: 'school' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'area', map: 'trend', village: '64000050015', table: 'school' })
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:areaView', { map: 'peers', village: '', table: 'village' })
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', sub: 'area', map: 'peers' } })
    expect(wrapper.findComponent(StatsTab).props('areaView')).toEqual({ map: 'peers', village: '', table: 'village' })
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'source' })
    expect(wrapper.findComponent(StatsTab).props('areaView')).toEqual({ map: null, village: '', table: 'village' })
    expect(push).not.toHaveBeenCalled()
  })

  it('(n) 換校區、學年或學期：village 清掉，map 與 table 保留；網址讀回來的 village 不清', async () => {
    freezeToday()
    mockGet(routesOn)
    const areaUrl = statsPath('campus=yihua&sub=area&map=trend&table=fees&village=64000050015')
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: areaUrl })
    const replace = vi.spyOn(router, 'replace')
    const tab = () => wrapper.findComponent(StatsTab)
    const selected = () => tab().props('areaView')
    // 初次掛載讀到的 village 不會被清（換校區的清除只管畫面上的變更）
    expect(selected()).toEqual({ map: 'trend', village: '64000050015', table: 'fees' })

    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'renwu', sub: 'area', map: 'trend', table: 'fees' } })
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu', sub: 'area', map: 'trend', table: 'fees' })
    expect(selected()).toEqual({ map: 'trend', village: '', table: 'fees' })

    // 網址被改（上一頁、連結）帶著 village 回來：照讀，換校區也不會被清掉
    await router.push(areaUrl)
    await flushPromises()
    expect(tab().props('campusKey')).toBe('yihua')
    expect(selected()).toEqual({ map: 'trend', village: '64000050015', table: 'fees' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'area', map: 'trend', table: 'fees', village: '64000050015' })

    // 學年、學期同樣
    const [, year, semester] = wrapper.findAllComponents({ name: 'ElSelect' })
    year!.vm.$emit('update:modelValue', 114)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'area', map: 'trend', table: 'fees', sy: '114' })
    expect(selected()).toEqual({ map: 'trend', village: '', table: 'fees' })
    await router.push(`${areaUrl}&sy=114`)
    await flushPromises()
    expect(selected()).toMatchObject({ village: '64000050015' })
    semester!.vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'area', map: 'trend', table: 'fees', sy: '114', sem: '2' })
    expect(selected()).toEqual({ map: 'trend', village: '', table: 'fees' })
  })

  it('(o) 別的子分頁網址上多出來的 map／village／table 被忽略，也不寫回', async () => {
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, {
      path: statsPath('campus=yihua&sub=source&map=trend&village=64000050015&table=school'),
    })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    expect(wrapper.findComponent(StatsTab).props('areaView')).toEqual({ map: null, village: '', table: 'village' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sub: 'source' })
  })
})

describe('頁首篩選的作用範圍與手機摘要', () => {
  const selects = (wrapper: Awaited<ReturnType<typeof mountWith>>['wrapper']) =>
    ['入學學年', '入學學期'].map((label) => wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === label)!)

  it('參觀預約不分入學學年學期：兩個下拉停用並寫明，值保留；切回總覽恢復', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sy=114&sem=2&sub=booking') })
    expect(selects(wrapper).map((item) => item.props('disabled'))).toEqual([true, true])
    expect(wrapper.get('.admissions__scope-note').text()).toBe('這個分頁不分入學學年學期')
    expect(wrapper.findComponent({ name: 'BookingStatsPane' }).props()).toMatchObject({ campusKey: 'yihua' })
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2', sub: 'booking' })

    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(selects(wrapper).map((item) => item.props('disabled'))).toEqual([false, false])
    expect(wrapper.find('.admissions__scope-note').exists()).toBe(false)
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2' })
  })

  it('預約全程同樣不分入學學年學期：兩個下拉停用並寫明；切到別的子分頁恢復', async () => {
    freezeToday()
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sy=114&sem=2&sub=journey') })
    expect(selects(wrapper).map((item) => item.props('disabled'))).toEqual([true, true])
    expect(wrapper.get('.admissions__scope-note').text()).toBe('這個分頁不分入學學年學期')
    expect(wrapper.find('section[aria-label="預約全程"]').exists()).toBe(true)

    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(selects(wrapper).map((item) => item.props('disabled'))).toEqual([false, false])
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2', sub: 'source' })
  })

  it('手機摘要在參觀預約寫「不分學年學期」', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    freezeToday()
    mockGet(routesOn)
    try {
      const { wrapper } = await mountWith(AdmissionsStatsView, { path: statsPath('campus=yihua&sub=booking') })
      expect(wrapper.get('.admissions__summary').text()).toContain('義華・不分學年學期')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
