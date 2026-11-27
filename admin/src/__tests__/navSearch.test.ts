import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import { useAuthStore } from '../stores/auth'
import { NAV_GROUPS, navItem, navItemMatchScore, navSearchHits, normalizeSearch, SEARCH_ONLY_GROUPS } from '../router/nav'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0 })

// 2026-11-27 後台 QA／TA：側欄搜尋只比對功能名與關鍵字「包含整串搜尋字」，園方的口語說法
// （停課、颱風、取消預約、補登…）與兩個詞的查詢（「上傳照片」）都找不到東西。
const ALL_ITEMS = [...NAV_GROUPS, ...SEARCH_ONLY_GROUPS].flatMap(group => group.items)

function topHit(query: string): string | undefined {
  const q = normalizeSearch(query)
  return ALL_ITEMS
    .map(item => ({ item, score: navItemMatchScore(item, q) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item.title
}

describe('側欄搜尋：園方的說法', () => {
  it.each([
    ['停課', '參觀場次'],
    ['停班', '參觀場次'],
    ['颱風', '參觀場次'],
    ['放假', '參觀場次'],
    ['國定假日', '參觀場次'],
    ['寒假', '參觀場次'],
    ['取消預約', '參觀案件'],
    ['未到場', '參觀案件'],
    ['補登', '參觀案件'],
    ['確認信', '參觀案件'],
    ['手機通知', '我的帳號'],
  ])('搜「%s」第一筆是%s', (query, title) => {
    expect(topHit(query)).toBe(title)
  })

  it('兩個詞的查詢：關鍵字出現在搜尋字裡也算（「上傳照片」→ 素材庫、「新增消息」→ 消息頁）', () => {
    expect(topHit('上傳照片')).toBe('素材庫')
    expect(topHit('上傳 照片')).toBe('素材庫')
    expect(navItemMatchScore(navItem('campus-news')!, normalizeSearch('新增消息'))).toBeGreaterThan(0)
  })

  it('有功能直接命中時，反過來命中的不列（搜「全站設定」不會多出關鍵字「設定」的系統狀態）', () => {
    const titles = (query: string) => navSearchHits(ALL_ITEMS, normalizeSearch(query)).map(hit => hit.item.title)
    expect(titles('全站設定')).toEqual(['個資與搜尋設定'])
    expect(titles('上傳照片')).toEqual(['素材庫'])
    expect(titles('取消預約')).toEqual(['參觀案件'])
  })

  it('側欄：搜分組名仍列出整組，不會因為關鍵字「預約」反過來命中只剩兩項', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/')
    await router.isReady()
    const sidebar = mount(AdminSidebar, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(sidebar)
    await sidebar.get('input').setValue('參觀預約')
    const titles = sidebar.findAll('.sidebar__nav a').map(link => link.text())
    expect(titles).toContain('各校預約方式')
    expect(titles).toContain('站內通知')
    await sidebar.get('input').setValue('上傳照片')
    expect(sidebar.findAll('.sidebar__nav a').map(link => link.text())).toEqual(['素材庫'])
  })

  it('原本的排序不變：完全相同仍排最前；反過來命中的排在名稱或關鍵字含搜尋字的後面', () => {
    // 「密碼」完全相同的是我的帳號，不是關鍵字「重設密碼」的使用者
    expect(topHit('密碼')).toBe('我的帳號')
    // 「預約統計」：招生統計的關鍵字完全相同；參觀案件只是關鍵字「預約」出現在搜尋字裡
    expect(topHit('預約統計')).toBe('招生統計')
    expect(navItemMatchScore(navItem('visit-requests')!, normalizeSearch('預約統計')))
      .toBeLessThan(navItemMatchScore(navItem('visit-calendar')!, normalizeSearch('場次')))
  })
})
