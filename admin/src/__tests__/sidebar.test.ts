import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import { NAV_GROUPS, SEARCH_ONLY_GROUP } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import AdminLayout from '../layouts/AdminLayout.vue'
import { api } from '../api/client'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  localStorage.clear()
  // jsdom 沒有版面，getClientRects 一律是空的；改成「被 v-show 藏起來才算看不到」。
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[style*="display: none"]') ? [] : [{}]) as unknown as DOMRectList
  })
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  document.querySelectorAll('[data-test-modal]').forEach(el => el.remove())
  vi.restoreAllMocks()
})

async function mountSidebar(path = '/', props: { mobile?: boolean } = {}) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  auth.features = { password_reset_email: false, admissions: true }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const global = { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } }
  const wrapper = mount(AdminSidebar, { props, global, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('側欄圖示（2026-10-05）', () => {
  it('只用線條圖示，不混實心的', () => {
    const solid = ['HomeFilled', 'Grid', 'List', 'TrendCharts', 'Menu', 'Histogram']
    const icons = [...NAV_GROUPS, SEARCH_ONLY_GROUP].flatMap(group => group.items.map(item => item.icon ?? ''))
    expect(icons.filter(icon => solid.includes(icon) || icon.endsWith('Filled'))).toEqual([])
  })
})

describe('側欄分組層級', () => {
  it('收起目前頁面所在的分組，標題改用選取色；展開時不標', async () => {
    const { wrapper } = await mountSidebar('/media')
    const toggle = wrapper.get('[aria-controls="nav-site"]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.classes()).not.toContain('has-current')
    await toggle.trigger('click')
    expect(toggle.classes()).toContain('has-current')
    // 其他收起來的組不標
    expect(wrapper.get('[aria-controls="nav-home"]').classes()).not.toContain('has-current')
  })

  it('搜尋時分組不能收合，箭頭藏起來但保留位置（子組文字仍對齊子項目）', async () => {
    const { wrapper } = await mountSidebar()
    await wrapper.get('input').setValue('預約文案')
    const toggle = wrapper.get('[aria-controls="nav-site"]')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.get('.sidebar__chevron').classes()).toContain('is-hidden')
  })
})

describe('側欄搜尋的鍵盤操作', () => {
  it('Enter 會開的第一筆先標出來，只標一筆', async () => {
    const { wrapper } = await mountSidebar()
    expect(wrapper.find('.sidebar__link.is-first').exists()).toBe(false)
    await wrapper.get('input').setValue('預約')
    const first = wrapper.findAll('.sidebar__link.is-first')
    expect(first.map(link => link.text())).toEqual(['參觀案件'])
  })

  it('Esc 先清掉搜尋字，沒有字時不攔（手機抽屜照常關）', async () => {
    const { wrapper } = await mountSidebar()
    const input = wrapper.get('input')
    await input.setValue('素材')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const reachedDocument = vi.fn()
    document.addEventListener('keydown', reachedDocument)
    input.element.dispatchEvent(escape)
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(reachedDocument).not.toHaveBeenCalled()
    input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(reachedDocument).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', reachedDocument)
  })

  it('搜尋框按 ↓ 到第一個看得到的項目，選單裡 ↑↓ 移動，最上面按 ↑ 回搜尋框', async () => {
    const { wrapper } = await mountSidebar()
    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toContain('營運總覽')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement?.getAttribute('aria-controls')).toBe('nav-visits')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(input.element)

    // 收起來的「首頁」組裡的連結跳過，直接到下一組的標題
    const home = wrapper.get<HTMLButtonElement>('[aria-controls="nav-home"]').element
    expect(home.getAttribute('aria-expanded')).toBe('false')
    home.focus()
    home.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement?.getAttribute('aria-controls')).toBe('nav-campus')
  })

  it('桌機按 ⌘K／Ctrl+K 跳到搜尋框，提示寫在框裡；打字後提示收起', async () => {
    const { wrapper } = await mountSidebar()
    expect(wrapper.find('.sidebar__kbd').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    expect(document.activeElement).toBe(wrapper.get('input').element)
    await wrapper.get('input').setValue('素材')
    expect(wrapper.find('.sidebar__kbd').exists()).toBe(false)
  })

  it('對話框開著時 ⌘K 不搶焦點', async () => {
    const { wrapper } = await mountSidebar()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    modal.dataset.testModal = ''
    document.body.appendChild(modal)
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(wrapper.get('input').element)
  })

  it('手機抽屜沒有快捷鍵也不顯示提示', async () => {
    const { wrapper } = await mountSidebar('/', { mobile: true })
    expect(wrapper.find('.sidebar__kbd').exists()).toBe(false)
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

// ---- 併自 sidebarCollapse20261013.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-13 桌機側欄可以收成 64px 圖示欄（同園務系統 ivy-frontend 的收合）。
describe('2026-10-13 桌機側欄收合成圖示欄', () => {
  const COLLAPSED_KEY = 'ivy-admin-sidebar-collapsed'
  const wrappers: VueWrapper[] = []

  beforeAll(() => {
    // AdminLayout 用 matchMedia 判斷手機版、換頁時捲回頂端；jsdom 兩個都沒有。
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
    })
    Element.prototype.scrollIntoView = () => {}
  })
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
  })
  afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount())
    wrappers.length = 0
    vi.restoreAllMocks()
  })

  async function mountSidebar(props: { mobile?: boolean; collapsed?: boolean } = {}, path = '/') {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', display_name: '王小明' })
    auth.features = { password_reset_email: false, admissions: true }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push(path)
    await router.isReady()
    const global = { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } }
    const wrapper = mount(AdminSidebar, { props, global, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  async function mountLayout(path = '/') {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = testUser('super_admin', { email: 'staff@ivy.example', campus_keys: [] })
    auth.features = { password_reset_email: false, admissions: true }
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: AdminLayout, children: [{ path: ':rest(.*)*', component: { render: () => h('div') } }] },
      { path: '/login', name: 'login', component: { render: () => h('div') } },
    ] })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  const superAdminItems = NAV_GROUPS.flatMap(group => group.items)

  describe('側欄收合鈕', () => {
    it('桌機展開時在品牌列右邊，按了要求收起', async () => {
      const wrapper = await mountSidebar()
      const toggle = wrapper.get('.sidebar__brand button[aria-label="收合側邊欄"]')
      await toggle.trigger('click')
      expect(wrapper.emitted('update:collapsed')).toEqual([[true]])
    })

    it('手機抽屜沒有收合鈕（抽屜本身就能關）', async () => {
      const wrapper = await mountSidebar({ mobile: true })
      expect(wrapper.find('button[aria-label="收合側邊欄"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="展開側邊欄"]').exists()).toBe(false)
    })

    it('收起時品牌列只剩展開鈕，按了要求展開', async () => {
      const wrapper = await mountSidebar({ collapsed: true })
      expect(wrapper.find('.sidebar__home').exists()).toBe(false)
      await wrapper.get('.sidebar__brand button[aria-label="展開側邊欄"]').trigger('click')
      expect(wrapper.emitted('update:collapsed')).toEqual([[false]])
    })
  })

  describe('收起的側欄：圖示欄', () => {
    it('不畫分組標題，所有項目都看得到（連平常收起來的分組），名稱留給報讀器', async () => {
      const wrapper = await mountSidebar({ collapsed: true })
      expect(wrapper.classes()).toContain('is-collapsed')
      expect(wrapper.find('.sidebar__section').exists()).toBe(false)
      expect(wrapper.find('.sidebar__group-toggle').exists()).toBe(false)
      const links = wrapper.findAll('.sidebar__link')
      expect(links.map(link => link.attributes('href'))).toEqual(superAdminItems.map(item => item.path))
      // 「全站與素材」預設收起，圖示欄照樣列出
      expect(wrapper.get('a[href="/media"]').isVisible()).toBe(true)
      // 名稱還在連結裡（報讀器念得到），只是視覺上藏起來
      const media = wrapper.get('a[href="/media"]')
      expect(media.text()).toBe('素材庫')
      expect(media.get('span').classes()).toContain('visually-hidden')
    })

    it('搜尋框換成搜尋鈕，按了要求展開並把焦點放進搜尋框', async () => {
      const wrapper = await mountSidebar({ collapsed: true })
      expect(wrapper.find('input[aria-label="搜尋後台功能"]').exists()).toBe(false)
      await wrapper.get('button[aria-label="搜尋功能"]').trigger('click')
      expect(wrapper.emitted('update:collapsed')).toEqual([[false]])
      await wrapper.setProps({ collapsed: false })
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.get('input[aria-label="搜尋後台功能"]').element)
    })

    it('⌘K 也一樣先展開再跳到搜尋框', async () => {
      const wrapper = await mountSidebar({ collapsed: true })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
      expect(wrapper.emitted('update:collapsed')).toEqual([[false]])
      await wrapper.setProps({ collapsed: false })
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.get('input[aria-label="搜尋後台功能"]').element)
    })

    it('收起前打的搜尋字清掉：圖示欄不該只剩搜尋結果', async () => {
      const wrapper = await mountSidebar()
      await wrapper.get('input[aria-label="搜尋後台功能"]').setValue('預約文案')
      await wrapper.setProps({ collapsed: true })
      expect(wrapper.findAll('.sidebar__link')).toHaveLength(superAdminItems.length)
    })

    it('帳號區只留頭像（我的帳號）與登出；更改密碼在我的帳號頁', async () => {
      const wrapper = await mountSidebar({ collapsed: true })
      const account = wrapper.get('.sidebar__account')
      expect(account.attributes('href')).toBe('/account')
      expect(account.attributes('aria-label')).toContain('王小明')
      expect(wrapper.find('.sidebar__user-text').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="更改密碼"]').exists()).toBe(false)
      await wrapper.get('button[aria-label="登出"]').trigger('click')
      expect(wrapper.emitted('logout')).toHaveLength(1)
    })
  })

  describe('外殼記住收合狀態', () => {
    it('收起後第一欄改成圖示欄寬，重新整理（重新掛載）仍是收起', async () => {
      const wrapper = await mountLayout('/visit-requests')
      expect(wrapper.get('.shell').classes()).not.toContain('is-collapsed')
      await wrapper.get('button[aria-label="收合側邊欄"]').trigger('click')
      expect(wrapper.get('.shell').classes()).toContain('is-collapsed')
      expect(localStorage.getItem(COLLAPSED_KEY)).toBe('1')

      const again = await mountLayout('/visit-requests')
      expect(again.get('.shell').classes()).toContain('is-collapsed')
      await again.get('button[aria-label="展開側邊欄"]').trigger('click')
      expect(again.get('.shell').classes()).not.toContain('is-collapsed')
      expect(localStorage.getItem(COLLAPSED_KEY)).toBe('0')
    })

    it('讀不到瀏覽器儲存（私密視窗）時照常展開、照常能收合', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
      const wrapper = await mountLayout('/')
      expect(wrapper.get('.shell').classes()).not.toContain('is-collapsed')
      await wrapper.get('button[aria-label="收合側邊欄"]').trigger('click')
      expect(wrapper.get('.shell').classes()).toContain('is-collapsed')
    })

    it('收起時按搜尋鈕：側欄展開、焦點在搜尋框', async () => {
      localStorage.setItem(COLLAPSED_KEY, '1')
      const wrapper = await mountLayout('/')
      await wrapper.get('button[aria-label="搜尋功能"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('.shell').classes()).not.toContain('is-collapsed')
      expect(document.activeElement).toBe(wrapper.get('input[aria-label="搜尋後台功能"]').element)
    })
  })

  describe('圖示欄的鍵盤操作（2026-10-13 補）', () => {
    it('收起時選單最上面按 ↑ 回到搜尋鈕（搜尋框不在畫面上）；搜尋鈕按 ↓ 到第一個項目', async () => {
      // jsdom 沒有版面，getClientRects 一律是空的；改成「被 v-show 藏起來才算看不到」（同本檔的側欄搜尋鍵盤操作）。
      vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
        return (this.closest('[style*="display: none"]') ? [] : [{}]) as unknown as DOMRectList
      })
      const wrapper = await mountSidebar({ collapsed: true })
      const button = wrapper.get<HTMLButtonElement>('.sidebar__rail-search')
      await button.trigger('keydown', { key: 'ArrowDown' })
      const first = document.activeElement as HTMLElement
      expect(wrapper.get('nav').element.contains(first)).toBe(true)
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(document.activeElement).toBe(button.element)
      expect(wrapper.emitted('update:collapsed')).toBeUndefined() // 只移焦點，不展開
    })
  })
})
