// 2026-10-13 桌機側欄可以收成 64px 圖示欄（同園務系統 ivy-frontend 的收合）。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminLayout from '../layouts/AdminLayout.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import { api } from '../api/client'
import { NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
    // jsdom 沒有版面，getClientRects 一律是空的；改成「被 v-show 藏起來才算看不到」（同 sidebarNav20261005）。
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
