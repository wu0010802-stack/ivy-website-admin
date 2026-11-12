import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import AnalyticsView from '../views/AnalyticsView.vue'
import { testUser } from './fixtures'

// 成效統計（2026-11-12）：18 張表分成四類、整頁共用一組期間與裝置，三個選擇都寫在網址。
// 兩個面板各自讀資料（traffic.test.ts、engagement.test.ts），這裡換成只顯示收到的 props 的替身。
const wrappers: VueWrapper[] = []
afterEach(() => { while (wrappers.length) wrappers.pop()!.unmount() })

const TrafficStub = defineComponent({
  name: 'SiteTrafficPanel',
  props: { days: Number },
  emits: ['updating'],
  setup: (props) => () => h('div', { 'data-stub': 'traffic', 'data-days': props.days }),
})
const InterestStub = defineComponent({
  name: 'ContentInterestPanel',
  props: { days: Number, device: String, view: String },
  emits: ['updating'],
  setup: (props) => () => h('div', { 'data-stub': 'interest', 'data-days': props.days, 'data-device': props.device, 'data-view': props.view }),
})

const CruxStub = defineComponent({
  name: 'CruxPanel',
  props: { active: Boolean },
  setup: (props) => () => h('div', { 'data-stub': 'crux', 'data-active': String(props.active) }),
})
const SearchStub = defineComponent({
  name: 'SearchInsightsPanel',
  props: { days: Number, active: Boolean },
  emits: ['updating'],
  setup: (props) => () => h('div', { 'data-stub': 'search', 'data-days': props.days, 'data-active': String(props.active) }),
})

async function mountView(query: LocationQueryRaw = {}, user: UserOut = testUser('super_admin')) {
  setActivePinia(createPinia())
  useAuthStore().user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/analytics', component: AnalyticsView }] })
  await router.push({ path: '/analytics', query })
  await router.isReady()
  const wrapper = mount(AnalyticsView, {
    attachTo: document.body,
    global: {
      plugins: [router, ElementPlus],
      stubs: { SiteTrafficPanel: TrafficStub, ContentInterestPanel: InterestStub, CruxPanel: CruxStub, SearchInsightsPanel: SearchStub },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const traffic = () => wrapper.find('[data-stub="traffic"]')
  const interest = () => wrapper.find('[data-stub="interest"]')
  const crux = () => wrapper.find('[data-stub="crux"]')
  const search = () => wrapper.find('[data-stub="search"]')
  const tabs = () => wrapper.findAll('.status-tab')
  const pressed = () => tabs().filter((tab) => tab.attributes('aria-pressed') === 'true').map((tab) => tab.text())
  return { wrapper, router, traffic, interest, crux, search, tabs, pressed }
}

describe('成效統計：Google 的兩塊只給有 admissions.stats 的角色（2026-11-12）', () => {
  it('分校角色不掛 Chrome 真實使用者與 Google 搜尋（後端 403，原本變成永遠讀不到的錯誤框），其他照常', async () => {
    for (const role of ['campus_admin', 'reception', 'editor'] as const) {
      const { traffic, crux, search, router } = await mountView({}, testUser(role, { campus_keys: ['yihua'] }))
      expect(traffic().exists(), role).toBe(true)
      expect(crux().exists(), role).toBe(false)
      await router.push({ path: '/analytics', query: { tab: 'journey' } })
      await flushPromises()
      expect(search().exists(), role).toBe(false)
    }
  })
})

describe('成效統計的分類與條件', () => {
  it('四類寫成家長會問的問題，預設在「瀏覽與速度」、近 28 天', async () => {
    const { wrapper, traffic, interest, tabs, pressed } = await mountView()
    expect(tabs().map((tab) => tab.text())).toEqual(['瀏覽與速度', '看了什麼', '怎麼來、怎麼逛', '走到預約'])
    expect(pressed()).toEqual(['瀏覽與速度'])
    expect(wrapper.find('.status-tabs').attributes('role')).toBe('group')
    expect(traffic().isVisible()).toBe(true)
    expect(traffic().attributes('data-days')).toBe('28')
    // 內容興趣先讀好、只是不顯示：切過去不用再等。
    expect(interest().exists()).toBe(true)
    expect(interest().isVisible()).toBe(false)
    expect(wrapper.find('.el-radio-button.is-active').text()).toBe('近 28 天')
    // 瀏覽與速度自己有手機、電腦兩欄，不放裝置選單。
    expect(wrapper.find('[data-test="analytics-device"]').exists()).toBe(false)
  })

  it('換分類寫進網址，後三類共用同一個內容興趣面板', async () => {
    const { wrapper, router, traffic, interest, tabs, pressed } = await mountView()
    await tabs()[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'content' })
    expect(pressed()).toEqual(['看了什麼'])
    expect(traffic().isVisible()).toBe(false)
    expect(interest().isVisible()).toBe(true)
    expect(interest().attributes('data-view')).toBe('content')
    expect(wrapper.find('[data-test="analytics-device"]').exists()).toBe(true)
    await tabs()[3]!.trigger('click')
    await flushPromises()
    expect(interest().attributes('data-view')).toBe('convert')
    // 回到預設那一類時網址不留參數。
    await tabs()[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('網址帶分類、期間與裝置時照著開', async () => {
    const { traffic, interest, pressed } = await mountView({ tab: 'journey', days: '7', device: 'mobile' })
    expect(pressed()).toEqual(['怎麼來、怎麼逛'])
    expect(interest().attributes()).toMatchObject({ 'data-view': 'journey', 'data-days': '7', 'data-device': 'mobile' })
    expect(traffic().attributes('data-days')).toBe('7')
  })

  it('舊連結的 ?tab=booking 與不接受的期間回到預設', async () => {
    const { traffic, pressed } = await mountView({ tab: 'booking', days: '30', device: 'tablet' })
    expect(pressed()).toEqual(['瀏覽與速度'])
    expect(traffic().isVisible()).toBe(true)
    expect(traffic().attributes('data-days')).toBe('28')
  })

  it('期間整頁只有一組：換了兩個面板一起換', async () => {
    const { wrapper, router, traffic, interest } = await mountView({ tab: 'content' })
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 90)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'content', days: '90' })
    expect(traffic().attributes('data-days')).toBe('90')
    expect(interest().attributes('data-days')).toBe('90')
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'desktop')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'content', days: '90', device: 'desktop' })
    expect(interest().attributes('data-device')).toBe('desktop')
  })

  it('目前這一類重新讀取時寫「更新中…」', async () => {
    const { wrapper } = await mountView({ tab: 'content' })
    const status = () => wrapper.find('.analytics__bar [role="status"]').text()
    expect(status()).toBe('')
    // 沒在看的那一類在更新不用提示。
    wrapper.findComponent(TrafficStub).vm.$emit('updating', true)
    await flushPromises()
    expect(status()).toBe('')
    wrapper.findComponent(InterestStub).vm.$emit('updating', true)
    await flushPromises()
    expect(status()).toBe('更新中…')
    wrapper.findComponent(InterestStub).vm.$emit('updating', false)
    await flushPromises()
    expect(status()).toBe('')
  })
  it('Chrome 真實使用者在「瀏覽與速度」、Google 搜尋在「怎麼來、怎麼逛」，只有切到那一類才叫它們讀', async () => {
    const { router, crux, search, tabs } = await mountView()
    expect(crux().isVisible()).toBe(true)
    expect(crux().attributes('data-active')).toBe('true')
    expect(search().isVisible()).toBe(false)
    expect(search().attributes('data-active')).toBe('false')

    await tabs()[2]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'journey' })
    expect(crux().isVisible()).toBe(false)
    expect(crux().attributes('data-active')).toBe('false')
    expect(search().isVisible()).toBe(true)
    expect(search().attributes('data-active')).toBe('true')

    // 其他兩類兩個都不顯示。
    await tabs()[1]!.trigger('click')
    await flushPromises()
    expect(crux().isVisible()).toBe(false)
    expect(search().isVisible()).toBe(false)
  })

  it('Google 搜尋跟著整頁的期間；Chrome 真實使用者是 28 天滾動，不吃期間', async () => {
    const { wrapper, search } = await mountView({ tab: 'journey' })
    expect(search().attributes('data-days')).toBe('28')
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 7)
    await flushPromises()
    expect(search().attributes('data-days')).toBe('7')
    expect(wrapper.findComponent(CruxStub).props()).toEqual({ active: false })
  })

  it('「更新中…」依目前這一類看：Google 搜尋在「怎麼來、怎麼逛」才算', async () => {
    const { wrapper } = await mountView({ tab: 'journey' })
    const status = () => wrapper.find('.analytics__bar [role="status"]').text()
    wrapper.findComponent(SearchStub).vm.$emit('updating', true)
    await flushPromises()
    expect(status()).toBe('更新中…')
    wrapper.findComponent(SearchStub).vm.$emit('updating', false)
    await flushPromises()
    expect(status()).toBe('')
    // 在別的分類，Google 搜尋在背景更新不用提示。
    const other = await mountView({ tab: 'content' })
    other.wrapper.findComponent(SearchStub).vm.$emit('updating', true)
    await flushPromises()
    expect(other.wrapper.find('.analytics__bar [role="status"]').text()).toBe('')
  })
})
