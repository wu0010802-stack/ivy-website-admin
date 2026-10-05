import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import { NAV_GROUPS, SEARCH_ONLY_GROUP } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
