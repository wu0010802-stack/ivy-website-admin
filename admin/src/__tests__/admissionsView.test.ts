import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import AdmissionsView from '../views/AdmissionsView.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import { STATS_SUBS } from '../admissions/useAdmissionsFilters'
import { routes } from '../router'
import { canSeeNavItem, NAV_GROUPS, navItem } from '../router/nav'
import { testUser } from './fixtures'
import { cleanup, journeyData, mockGet, mountWith, options, pathsTo, VR_ID } from './admissionsTestKit'

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
// options 預設照常回資料（開關開啟）。
const routesOn = {
  '/admin/admissions/options': options(),
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
    expect(item).toMatchObject({ path: '/admissions', title: '招生入學', icon: 'PieChart' })
    for (const role of ['super_admin', 'campus_admin', 'reception']) expect(canSeeNavItem(item, { role })).toBe(true)
    for (const role of ['editor', 'readonly']) expect(canSeeNavItem(item, { role })).toBe(false)
    const children = routes.find((route) => route.path === '/')!.children!
    expect(children.find((route) => route.name === 'admissions')).toMatchObject({ path: 'admissions', meta: { title: '招生入學' } })
  })
})

describe('招生入學頁：篩選與分頁跟網址雙向同步（規格第 10 節）', () => {
  it('網址上的校區、學年、學期、分頁掛載時讀回來', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('統計分析')
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', schoolYear: 114, semester: 2 })
  })

  it('沒帶參數：第一個可見校區、目前學年、整學年、漏斗看板；改條件用 replace 寫回網址，不限學年寫成 sy=all', async () => {
    freezeToday()
    mockGet(routesOn)
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
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats' })
    await router.push('/admissions?campus=renwu&tab=stats&sem=1')
    await flushPromises()
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', semester: 1 })
  })

  it('F1：使用者主動換校會清掉 vr；從帶 campus＋vr 的網址進來時兩個都保留', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&vr=${VR_ID}` })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', vr: VR_ID })
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu', tab: 'records' })
  })

  it('F6a：民國月份只收三位數年份，99.09 被丟掉、115.09 保留', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=99.09' })
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    cleanup()
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const good = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=115.09' })
    expect(good.router.currentRoute.value.query).toMatchObject({ month: '115.09' })
  })

  it('看不到的校區、亂寫的學期與分頁一律退回預設', async () => {
    mockGet(routesOn)
    const user = testUser('campus_admin', { campus_keys: ['renwu'] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sem=9&tab=hack', user })
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
  })

  it('名額規劃已拿掉：舊連結 tab=intake 退回漏斗看板，網址拿掉 tab，不讀名額', async () => {
    const get = mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=intake' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
    expect(wrapper.text()).not.toContain('名額規劃')
    expect(pathsTo(get, '/admin/admissions/intake')).toEqual([])
  })
})

describe('官網預約分頁已拿掉（2026-10-05）', () => {
  it('分頁只剩三個（待追蹤 2026-10-06 也拿掉）；舊連結 tab=arrivals 退回漏斗看板，網址拿掉 tab，不讀官網預約', async () => {
    const get = mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=arrivals' })
    expect(tabTexts(wrapper)).toEqual(['漏斗看板', '訪視明細', '統計分析'])
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toEqual([])
  })

  it('沒有負責校區的帳號看到說明，不送任何招生請求', async () => {
    const get = mockGet({})
    const { wrapper } = await mountWith(AdmissionsView, { user: testUser('campus_admin', { campus_keys: [] }) })
    expect(wrapper.text()).toContain('你的帳號還沒有負責的校區')
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
  })
})

describe('招生開關關閉（R1）', () => {
  it('options 回 404：顯示「招生入學尚未啟用」，沒有分頁，也沒有錯誤訊息', async () => {
    const { ApiError } = await import('../api/client')
    const get = mockGet({
      '/admin/admissions/options': () => { throw new ApiError(404, { code: 'NOT_FOUND' }) },
    })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(wrapper.text()).toContain('招生入學尚未啟用')
    expect(wrapper.text()).toContain('開啟後這裡會出現漏斗看板、訪視明細與統計分析（含參觀預約的統計）。')
    expect(wrapper.findAll('.el-tabs__item')).toHaveLength(0)
    expect(pathsTo(get, '/admin/admissions/follow-ups')).toEqual([])
    expect(document.body.querySelector('.el-message')).toBeNull()
  })

  it('其他錯誤照常掛分頁', async () => {
    mockGet({
      '/admin/admissions/options': () => { throw new Error('boom') },
    })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(wrapper.text()).not.toContain('招生入學尚未啟用')
    expect(wrapper.findAll('.el-tabs__item').length).toBeGreaterThan(0)
  })
})

describe('統計分析與頁面的接縫（C3）', () => {
  it('統計分頁拿到頁首的校區、學年學期與看得到的校區（決定有沒有五校比較）', async () => {
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.findComponent(StatsTab).props()).toEqual({
      campusKey: 'renwu', schoolYear: 114, semester: 2, sub: 'overview', campusKeys: ['yihua', 'minghua', 'chongde', 'international', 'renwu'],
      journey: { period: '90', from: '', to: '', source: 'all' },
    })
  })

  it('警示或行動入口要看某月明細：切到訪視明細並帶 month；用 push，上一頁回到統計', async () => {
    mockGet(routesOn)
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
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?sy=118' })
    expect(yearLabels(wrapper)).toEqual([118, 117, 116, 115, 114, 113])
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[1]!
    expect(select.props('modelValue')).toBe(118)
  })
})

describe('統計子分頁寫進網址（X2a 3A）', () => {
  it('(a) 網址 tab=stats&sub=nodeposit 掛載：子分頁是未預繳原因', async () => {
    mockGet(routesOn)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('nodeposit')
  })

  it('(b) 切子分頁用 replace 寫 sub；切回總覽不帶 sub；離開統計分頁也拿掉', async () => {
    mockGet(routesOn)
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
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
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
    mockGet(routesOn)
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=hack' })
    expect(bad.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats' })
    cleanup()
    mockGet(routesOn)
    const single = testUser('campus_admin', { campus_keys: ['renwu'] })
    const compare = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&tab=stats&sub=compare', user: single })
    expect(compare.wrapper.findComponent(StatsTab).props('sub')).toBe('overview')
    expect(compare.router.currentRoute.value.query).toEqual({ campus: 'renwu', tab: 'stats' })
  })

  it('(e) sub=area 讀得回來；區域分析「查看明細」push 到訪視明細帶 area、拿掉 month；上一頁回到區域分析', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=area&month=115.09' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('area')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { area: '三民區/本揚里' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', area: '三民區/本揚里' })
    expect(wrapper.findComponent(RecordsTab).props('area')).toBe('三民區/本揚里')
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'area', month: '115.09' })
  })

  it('(f) 統計「查看本月明細」帶 month 時拿掉 area；手改的 area 不帶進明細、網址改回乾淨的', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&area=%E4%B8%89%E6%B0%91%E5%8D%80' })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', month: '115.09' })
    cleanup()
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&area=hack' })
    expect(bad.wrapper.findComponent(RecordsTab).props('area')).toBe('')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
  })

  it('(g) 區域分析排在接待之後、未預繳之前；sub=area 跟其他子分頁一樣用 replace 寫進網址，切回總覽不帶 sub', async () => {
    expect(STATS_SUBS).toEqual(['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare', 'booking', 'journey'])
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats' })
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'area')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', tab: 'stats', sub: 'area' } })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('area')
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({ query: { campus: 'yihua', tab: 'stats' } })
    expect(push).not.toHaveBeenCalled()
  })

  it('(h) 訪視明細的 area：整區、單一里、未定位都讀得回來並留在網址；寫法不合的值（多一層、里名不對、空段）被清掉', async () => {
    for (const area of ['三民區', '三民區/本揚里', 'no_village']) {
      mockGet({ ...routesOn, '/admin/admissions/records': [] })
      const good = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&area=${encodeURIComponent(area)}` })
      expect(good.wrapper.findComponent(RecordsTab).props('area')).toBe(area)
      expect(good.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', area })
      cleanup()
    }
    for (const area of ['a/b/c', '三民區/abc', '三民區/', '/本揚里']) {
      mockGet({ ...routesOn, '/admin/admissions/records': [] })
      const bad = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&area=${encodeURIComponent(area)}` })
      expect(bad.wrapper.findComponent(RecordsTab).props('area')).toBe('')
      expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
      cleanup()
    }
  })

  it('(h2) 訪視明細按「不限區域」：網址拿掉 area、重讀的明細不再帶 district／village；按「不限這筆預約」只清 vr', async () => {
    const get = mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, {
      path: `/admissions?campus=yihua&tab=records&area=${encodeURIComponent('三民區/本揚里')}&vr=${VR_ID}`,
    })
    const lastList = () => new URLSearchParams(pathsTo(get, '/admin/admissions/records?').at(-1)!.split('?')[1])
    expect(lastList().get('district')).toBe('三民區')
    expect(lastList().get('village')).toBe('本揚里')
    expect(router.currentRoute.value.query).toMatchObject({ area: '三民區/本揚里', vr: VR_ID })
    const clear = (label: string) => wrapper.findAll('.records__notice button').find((item) => item.text() === label)!
    await clear('不限區域').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.area).toBeUndefined()
    expect(router.currentRoute.value.query.vr).toBe(VR_ID)
    expect(wrapper.findComponent(RecordsTab).props('area')).toBe('')
    expect(lastList().has('district')).toBe(false)
    expect(lastList().has('village')).toBe(false)
    expect(lastList().get('visit_request_id')).toBe(VR_ID)
    await clear('不限這筆預約').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.vr).toBeUndefined()
    expect(lastList().has('visit_request_id')).toBe(false)
  })

  it('(i) area 只在訪視明細有意義：離開訪視明細就從網址拿掉；其他分頁的網址帶 area 也被清掉', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&area=%E4%B8%89%E6%B0%91%E5%8D%80' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', area: '三民區' })
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'funnel')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    cleanup()
    mockGet(routesOn)
    const stats = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&area=%E4%B8%89%E6%B0%91%E5%8D%80' })
    expect(stats.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats' })
  })

  it('(i2) 訪視明細的 wr（退出原因）：八項與 unclassified 讀得回來；亂碼清掉；統計「查看明細」帶 withdraw 過去並拿掉 month、area', async () => {
    for (const wr of ['費用考量', 'unclassified']) {
      mockGet({ ...routesOn, '/admin/admissions/records': [] })
      const good = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&wr=${encodeURIComponent(wr)}` })
      expect(good.wrapper.findComponent(RecordsTab).props('withdrawCategory')).toBe(wr)
      expect(good.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr })
      cleanup()
    }
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&wr=hack' })
    expect(bad.wrapper.findComponent(RecordsTab).props('withdrawCategory')).toBe('')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    cleanup()
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit' })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { withdraw: 'unclassified' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr: 'unclassified' })
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'funnel')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
  })

  it('(i3) 退出原因帶進明細時拿掉 month、area；其他分頁的網址帶 wr 也被清掉，統計分頁不會把它帶進明細', async () => {
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const from = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit&month=115.09&area=%E4%B8%89%E6%B0%91%E5%8D%80' })
    expect(from.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'nodeposit', month: '115.09' })
    from.wrapper.findComponent(StatsTab).vm.$emit('open-records', { withdraw: '費用考量' })
    await flushPromises()
    expect(from.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr: '費用考量' })
    cleanup()
    mockGet(routesOn)
    const stats = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&wr=%E8%B2%BB%E7%94%A8%E8%80%83%E9%87%8F' })
    expect(stats.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats' })
    cleanup()
    mockGet(routesOn)
    const funnel = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&wr=unclassified' })
    expect(funnel.router.currentRoute.value.query).toEqual({ campus: 'yihua' })
  })

  // 預約全程（2026-10-15）：jp／jf／jt／js 只在 tab=stats&sub=journey 有意義。
  it('(j) sub=journey 的期間與來源讀得回來、改了寫回網址；離開統計分頁拿掉', async () => {
    freezeToday()
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsView, {
      path: '/admissions?campus=yihua&tab=stats&sub=journey&jp=180&js=web',
    })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('journey')
    expect(wrapper.findComponent(StatsTab).props('journey')).toEqual({ period: '180', from: '', to: '', source: 'web' })
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:journey', { period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'assisted' })
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({
      query: { campus: 'yihua', tab: 'stats', sub: 'journey', jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' },
    })
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'records')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
  })

  it('(k) 別的子分頁網址上多出來的 jp／js 被忽略，也不寫回', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=source&jp=365&js=web' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'source' })
  })

  it('(l) 看過預約全程後換子分頁、離開統計分頁：預約全程不在背景重讀', async () => {
    freezeToday()
    const get = mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=journey' })
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'records')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(1)
  })
})

describe('頁首篩選的作用範圍與手機摘要', () => {
  it('手機：篩選收成一顆摘要鈕，點開才出現下拉', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    freezeToday()
    mockGet(routesOn)
    try {
      const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sy=115' })
      const summary = wrapper.get('.admissions__summary')
      expect(summary.text()).toContain('義華・115 學年・整學年')
      expect(summary.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('#admissions-filters').exists()).toBe(false)
      await summary.trigger('click')
      expect(summary.attributes('aria-expanded')).toBe('true')
      expect(wrapper.find('#admissions-filters').exists()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('統計分析的參觀預約不分入學學年學期：兩個下拉停用並寫明，值保留；切回總覽恢復', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sy=114&sem=2&tab=stats&sub=booking' })
    const selects = () => ['入學學年', '入學學期'].map((label) => wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === label)!)
    expect(selects().map((item) => item.props('disabled'))).toEqual([true, true])
    expect(wrapper.get('.admissions__scope-note').text()).toBe('這個分頁不分入學學年學期')
    expect(wrapper.findComponent({ name: 'BookingStatsPane' }).props()).toMatchObject({ campusKey: 'yihua' })
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2', sub: 'booking' })

    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'overview')
    await flushPromises()
    expect(selects().map((item) => item.props('disabled'))).toEqual([false, false])
    expect(wrapper.find('.admissions__scope-note').exists()).toBe(false)
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2' })
  })

  it('統計分析的預約全程同樣不分入學學年學期：兩個下拉停用並寫明；切到別的子分頁恢復', async () => {
    freezeToday()
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sy=114&sem=2&tab=stats&sub=journey' })
    const selects = () => ['入學學年', '入學學期'].map((label) => wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === label)!)
    expect(selects().map((item) => item.props('disabled'))).toEqual([true, true])
    expect(wrapper.get('.admissions__scope-note').text()).toBe('這個分頁不分入學學年學期')
    expect(wrapper.find('section[aria-label="預約全程"]').exists()).toBe(true)
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2', sub: 'journey' })

    wrapper.findComponent(StatsTab).vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(selects().map((item) => item.props('disabled'))).toEqual([false, false])
    expect(wrapper.find('.admissions__scope-note').exists()).toBe(false)
    expect(router.currentRoute.value.query).toMatchObject({ sy: '114', sem: '2', sub: 'source' })
  })

  it('手機摘要在參觀預約寫「不分學年學期」', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    freezeToday()
    mockGet(routesOn)
    try {
      const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=booking' })
      expect(wrapper.get('.admissions__summary').text()).toContain('義華・不分學年學期')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
