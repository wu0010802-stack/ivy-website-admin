// 使用小技巧頁（2026-11-10）：內容資料的完整性（連結、角色、截圖）與頁面的篩選、角色顯示。
// 2026-11-20：入口從側欄搬到頁首；頁面改成可展開的清單＋搜尋。
// 2026-11-26：搜尋同義詞與標示、別的分類還有幾條、展開的那條寫進網址與複製連結、截圖放大。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Role } from '../api/types'
import { routes } from '../router'
import { NAV_GROUPS, SEARCH_ONLY_GROUPS, canListNavItem, canSeeNavItem } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import manifest from '../assets/tips/manifest.json'
import { KEY_TIP_KEYWORDS, TIPS, TIP_SECTIONS, formatKey, matchSnippet, splitKeys, splitMatches, stepText, tipSearchParts } from '../tips/tips'
import { tipSectionForPath } from '../tips/pageSections'
import TipsView from '../views/TipsView.vue'
import { testUser } from './fixtures'

const shotFiles = Object.keys(import.meta.glob('../assets/tips/*.webp'))
  .map(path => path.replace('../assets/tips/', '').replace('.webp', ''))
const sizes = manifest as Record<string, { width: number; height: number }>

describe('小技巧資料', () => {
  it('每條的 id 不重複、分類存在、至少一句說明', () => {
    const ids = TIPS.map(tip => tip.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tip of TIPS) {
      expect(TIP_SECTIONS.map(section => section.key)).toContain(tip.section)
      expect(tip.steps.length, tip.id).toBeGreaterThan(0)
    }
  })

  it('「前往」連結都對得到後台的頁面', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    for (const tip of TIPS.filter(tip => tip.to)) {
      const resolved = router.resolve({ path: tip.to!.path, query: tip.to!.query })
      expect(resolved.name, `${tip.id} → ${tip.to!.path}`).not.toBe('not-found')
    }
  })

  it('寫給某些角色的小技巧，那些角色進得了它連去的頁面（不會寫錯誰能用）', () => {
    const byPath = new Map(NAV_GROUPS.flatMap(group => group.items).map(item => [item.path, item]))
    for (const tip of TIPS.filter(tip => tip.to && tip.roles)) {
      const item = byPath.get(tip.to!.path)
      if (!item?.capability) continue
      for (const role of tip.roles!) expect(canSeeNavItem(item, testUser(role)), `${tip.id}：${role}`).toBe(true)
    }
  })

  it('有寫截圖的都拍了，資料夾裡也沒有沒人用的截圖', () => {
    const wanted = TIPS.flatMap(tip => (tip.image ? [tip.image] : []))
    expect(new Set(wanted).size).toBe(wanted.length)
    expect([...shotFiles].sort()).toEqual([...wanted].sort())
    expect(Object.keys(sizes).sort()).toEqual([...wanted].sort())
    for (const tip of TIPS.filter(tip => tip.image)) {
      expect(tip.imageAlt, `${tip.id} 缺截圖說明`).toBeTruthy()
      expect(sizes[tip.image!]!.width).toBeGreaterThan(0)
    }
  })

  it('按鍵：mod 在 Mac 是 ⌘、其他系統是 Ctrl，反引號拆成按鍵', () => {
    expect(formatKey('mod+K', true)).toBe('⌘K')
    expect(formatKey('mod+K', false)).toBe('Ctrl＋K')
    expect(formatKey('Shift', true)).toBe('Shift')
    // 單獨的 mod（按住再點）後面不帶「＋」
    expect(formatKey('mod', false)).toBe('Ctrl')
    expect(formatKey('mod', true)).toBe('⌘')
    expect(splitKeys('按 `mod+Enter` 送出', false)).toEqual([
      { kind: 'text', value: '按 ' },
      { kind: 'key', value: 'Ctrl＋Enter' },
      { kind: 'text', value: ' 送出' },
    ])
    // 每條說明的反引號都成對，不會整段被當成按鍵。
    for (const tip of TIPS) {
      for (const text of [tip.title, ...tip.steps.map(stepText)]) {
        expect(text.split('`').length % 2, `${tip.id}：${text}`).toBe(1)
      }
    }
  })
})

describe('搜尋用的字', () => {
  const tip = (id: string) => TIPS.find(item => item.id === id)!

  it('有寫按鍵的條目多收「快捷鍵」這些字；keywords 是畫面上沒寫到的說法', () => {
    expect(tipSearchParts(tip('search'))).toEqual(expect.arrayContaining(KEY_TIP_KEYWORDS))
    expect(tipSearchParts(tip('closure'))).not.toContain('快捷鍵')
    expect(tipSearchParts(tip('closure'))).toContain('颱風假')
    // 兩種按鍵寫法都在
    expect(tipSearchParts(tip('search')).join(' ')).toContain('⌘K')
    expect(tipSearchParts(tip('search')).join(' ')).toContain('Ctrl＋K')
    // 已經寫在標題或步驟裡的字不用再列一次
    for (const item of TIPS) {
      const visible = [item.title, ...item.steps.map(stepText)].join(' ')
      for (const word of item.keywords ?? []) expect(visible, `${item.id}：${word}`).not.toContain(word)
    }
  })

  it('splitMatches：標出每個符合的地方，全形與大小寫不同也算，標的是原文', () => {
    expect(splitMatches('「匯出 CSV」匯出的是', ['匯出'])).toEqual([
      { value: '「', hit: false },
      { value: '匯出', hit: true },
      { value: ' CSV」', hit: false },
      { value: '匯出', hit: true },
      { value: '的是', hit: false },
    ])
    expect(splitMatches('Ctrl＋K', ['ctrl+k'])).toEqual([{ value: 'Ctrl＋K', hit: true }])
    expect(splitMatches('匯出 CSV', ['csv', '匯'])).toEqual([
      { value: '匯', hit: true },
      { value: '出 ', hit: false },
      { value: 'CSV', hit: true },
    ])
    expect(splitMatches('沒在搜尋', [])).toEqual([{ value: '沒在搜尋', hit: false }])
    expect(splitMatches('', ['匯出'])).toEqual([])
  })

  it('matchSnippet：搜尋字只在步驟裡時回那一句；標題就有、或只對到 keywords 時不回', () => {
    const steps = ['第一句沒有。第二句有游標，按 `mod+K`。', '另一步也有游標。']
    expect(matchSnippet('標題', steps, ['游標'], false)).toBe('第二句有游標，按 `mod+K`。')
    expect(matchSnippet('標題有游標', steps, ['游標'], false)).toBeNull()
    // 標題只對到一部分：列出補上另一個字的那一句
    expect(matchSnippet('標題有游標', steps, ['游標', '第一句'], false)).toBe('第一句沒有。')
    expect(matchSnippet('標題', steps, ['快捷鍵'], false)).toBeNull()
    expect(matchSnippet('標題', steps, [], false)).toBeNull()
    // 按鍵照這台電腦顯示的寫法比對
    expect(matchSnippet('標題', steps, ['ctrl+k'], false)).toBe('第二句有游標，按 `mod+K`。')
    expect(matchSnippet('標題', steps, ['ctrl+k'], true)).toBeNull()
  })
})

describe('入口', () => {
  it('不在側欄；側欄搜尋找得到，所有角色都看得到', () => {
    expect(NAV_GROUPS.flatMap(group => group.items).some(item => item.path === '/tips')).toBe(false)
    const item = SEARCH_ONLY_GROUPS.flatMap(group => group.items).find(i => i.name === 'tips')!
    expect(item.path).toBe('/tips')
    for (const role of ['super_admin', 'campus_admin', 'editor', 'reception', 'readonly'] as Role[]) {
      expect(canListNavItem(item, testUser(role), { admissions: false }), role).toBe(true)
    }
    const route = routes.flatMap(record => [record, ...(record.children ?? [])]).find(record => record.name === 'tips')!
    expect(route.meta!.title).toBe('使用小技巧')
  })

  it('頁首從哪一頁點，先打開那一頁相關的分類；其他頁打開全部', () => {
    expect(tipSectionForPath('/visit-requests')).toBe('visits')
    expect(tipSectionForPath('/visit-requests/42')).toBe('visits')
    expect(tipSectionForPath('/visit-calendar')).toBe('sessions')
    expect(tipSectionForPath('/admissions')).toBe('admissions')
    expect(tipSectionForPath('/admissions-stats')).toBe('admissions')
    expect(tipSectionForPath('/content/home-hero')).toBe('content')
    expect(tipSectionForPath('/media')).toBe('content')
    expect(tipSectionForPath('/users')).toBe('account')
    expect(tipSectionForPath('/')).toBeNull()
    expect(tipSectionForPath('/analytics')).toBeNull()
    expect(tipSectionForPath('/tips')).toBeNull()
    expect(tipSectionForPath('/visit-requests-old')).toBeNull()
    // 對到的分類都真的有小技巧
    for (const path of ['/visit-requests', '/visit-calendar', '/admissions', '/content/x', '/users']) {
      expect(TIPS.some(tip => tip.section === tipSectionForPath(path)), path).toBe(true)
    }
  })
})

// jsdom 沒有 scrollIntoView（從 #tip-<id> 連進來時會捲過去）。
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})

const wrappers: VueWrapper[] = []
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
})

async function mountTips(role: Role, options: { admissions?: boolean; query?: Record<string, string>; hash?: string } = {}) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser(role, { campus_keys: role === 'super_admin' ? [] : ['yihua'] })
  auth.features = { admissions: options.admissions ?? true, password_reset_email: false }
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push({ path: '/tips', query: options.query, hash: options.hash })
  await router.isReady()
  const wrapper = mount(TipsView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

const titles = (wrapper: VueWrapper) => wrapper.findAll('.tip__title').map(el => el.text())

describe('小技巧頁', () => {
  it('預設列出全部（通用版），每條寫出誰能用', async () => {
    const { wrapper } = await mountTips('reception')
    expect(wrapper.findAll('li.tip')).toHaveLength(TIPS.length)
    const search = wrapper.get('#tip-search')
    expect(search.get('.tip__who').text()).toBe('誰能用：所有人')
    expect(wrapper.get('#tip-users-more .tip__who').text()).toBe('誰能用：總管理者')
    expect(wrapper.get('#tip-export .tip__who').text()).toBe('誰能用：總管理者、校區管理者、櫃台（總管理者以外要另外授權）')
  })

  it('招生功能沒開時，招生的小技巧與「填招生資料」那句都不出現', async () => {
    const { wrapper } = await mountTips('super_admin', { admissions: false })
    expect(wrapper.find('#tip-funnel-move').exists()).toBe(false)
    expect(wrapper.find('#tips-admissions').exists()).toBe(false)
    expect(wrapper.get('#tip-attend-inline').text()).not.toContain('招生資料')
    expect(wrapper.findAll('.status-tab').map(tab => tab.text())).not.toContain(expect.stringContaining('招生入學'))
  })

  it('只列我能用的：櫃台看不到總管理者限定與內容編輯的小技巧，分類也跟著少', async () => {
    const { wrapper, router } = await mountTips('reception', { query: { mine: '1' } })
    expect(wrapper.find('#tip-users-more').exists()).toBe(false)
    expect(wrapper.find('#tip-live-preview').exists()).toBe(false)
    expect(wrapper.find('#tip-exclude').exists()).toBe(false)
    expect(wrapper.find('#tip-notes').exists()).toBe(true)
    expect(wrapper.findAll('.status-tab').map(tab => tab.text()).join()).not.toContain('官網內容')
    // 取消勾選寫回網址
    await wrapper.get('.el-checkbox input').setValue(false)
    await flushPromises()
    expect(router.currentRoute.value.query.mine).toBeUndefined()
    expect(wrapper.find('#tip-users-more').exists()).toBe(true)
  })

  it('分類按鈕寫進網址，只顯示那一類', async () => {
    const { wrapper, router } = await mountTips('super_admin')
    const tab = wrapper.findAll('.status-tab').find(button => button.text().startsWith('參觀場次'))!
    await tab.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.section).toBe('sessions')
    expect(tab.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.tips__section-title').map(el => el.text())).toEqual(['參觀場次'])
    expect(titles(wrapper)).toHaveLength(TIPS.filter(tip => tip.section === 'sessions').length)
  })

  it('「前往」只給進得去的人', async () => {
    const reception = await mountTips('reception')
    expect(reception.wrapper.find('#tip-users-more .tip__link').exists()).toBe(false)
    expect(reception.wrapper.get('#tip-preview .tip__link').text()).toBe('前往參觀案件')
    const admin = await mountTips('super_admin')
    expect(admin.wrapper.get('#tip-users-more .tip__link').attributes('href')).toBe('/users')
    expect(admin.wrapper.get('#tip-batch-attend .tip__link').attributes('href')).toBe('/visit-requests?group=past&status=confirmed')
  })

  it('按鍵畫成 kbd，標題也一樣', async () => {
    const { wrapper } = await mountTips('super_admin')
    const kbd = wrapper.get('#tip-search .tip__title kbd').text()
    expect(['⌘K', 'Ctrl＋K']).toContain(kbd)
  })

  it('預設只列標題；點標題展開步驟，再點收起；全部展開／全部收起', async () => {
    const { wrapper } = await mountTips('super_admin')
    const toggle = wrapper.get('#tip-search .tip__toggle')
    const body = wrapper.get('#tip-search-body')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe('tip-search-body')
    // 收起時用 until-found：頁內尋找（⌘F）找得到，內容仍在 DOM 裡
    expect(body.attributes('hidden')).toBe('until-found')
    expect(body.text()).toContain('游標會跳到')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(body.attributes('hidden')).toBeUndefined()
    await toggle.trigger('click')
    expect(body.attributes('hidden')).toBe('until-found')

    const expandAll = wrapper.get('.tips__expand-all')
    expect(expandAll.text()).toBe('全部展開')
    await expandAll.trigger('click')
    expect(wrapper.findAll('.tip__body[hidden]')).toHaveLength(0)
    expect(expandAll.text()).toBe('全部收起')
    await expandAll.trigger('click')
    expect(wrapper.findAll('.tip__body[hidden]')).toHaveLength(TIPS.length)
  })

  it('頁內尋找找到收起的內容時（beforematch）跟著標成展開', async () => {
    const { wrapper } = await mountTips('super_admin')
    await wrapper.get('#tip-search-body').trigger('beforematch')
    expect(wrapper.get('#tip-search .tip__toggle').attributes('aria-expanded')).toBe('true')
  })

  it('從 #tip-<id> 連進來時那一條自己展開', async () => {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = testUser('reception', { campus_keys: ['yihua'] })
    auth.features = { admissions: true, password_reset_email: false }
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push({ path: '/tips', hash: '#tip-notes' })
    await router.isReady()
    const wrapper = mount(TipsView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('#tip-notes .tip__toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('#tip-search .tip__toggle').attributes('aria-expanded')).toBe('false')
  })

  it('搜尋比對標題、步驟與按鍵的兩種寫法，分類數字跟著變；找不到時可以清除', async () => {
    const { wrapper } = await mountTips('super_admin')
    const input = wrapper.get('.tips__search input')
    await input.setValue('匯出')
    expect(titles(wrapper).some(title => title.includes('匯出 CSV'))).toBe(true)
    expect(titles(wrapper).length).toBeLessThan(TIPS.length)
    expect(wrapper.get('.status-tab').text()).toContain(String(titles(wrapper).length))
    // ⌘ 與 Ctrl 都對得到「`mod+K`」
    await input.setValue('ctrl+k')
    expect(wrapper.find('#tip-search').exists()).toBe(true)
    await input.setValue('⌘k')
    expect(wrapper.find('#tip-search').exists()).toBe(true)
    // 步驟裡的字也算（標題沒有「游標」）
    await input.setValue('游標')
    expect(wrapper.find('#tip-search').exists()).toBe(true)
    // 每個字都要對到
    await input.setValue('匯出 沒有這個字')
    expect(wrapper.findAll('li.tip')).toHaveLength(0)
    expect(wrapper.get('.empty-note').text()).toContain('沒有符合「匯出 沒有這個字」的小技巧')
    await wrapper.get('.empty-note button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('li.tip')).toHaveLength(TIPS.length)
  })

  it('選了某一類又搜到 0 條時，那一類的按鈕仍在、標成選取', async () => {
    const { wrapper } = await mountTips('super_admin', { query: { section: 'sessions' } })
    await wrapper.get('.tips__search input').setValue('匯出 CSV')
    const pressed = wrapper.findAll('.status-tab').filter(tab => tab.attributes('aria-pressed') === 'true')
    expect(pressed.map(tab => tab.text())).toEqual(['參觀場次0 條'])
  })

  it('搜尋：畫面上沒寫的說法也找得到（快捷鍵、颱風假、圖片）', async () => {
    const { wrapper } = await mountTips('super_admin')
    const input = wrapper.get('.tips__search input')
    await input.setValue('快捷鍵')
    const withKeys = TIPS.filter(tip => [tip.title, ...tip.steps.map(stepText)].some(text => text.includes('`')))
    expect(wrapper.findAll('li.tip').map(li => li.attributes('id'))).toEqual(withKeys.map(tip => `tip-${tip.id}`))
    expect(wrapper.find('#tip-search').exists()).toBe(true)
    await input.setValue('颱風假')
    expect(wrapper.findAll('li.tip').map(li => li.attributes('id'))).toEqual(['tip-closure'])
    await input.setValue('圖片')
    expect(wrapper.find('#tip-media-more').exists()).toBe(true)
    await input.setValue('改期')
    expect(wrapper.find('#tip-slot-card').exists()).toBe(true)
  })

  it('搜尋：標出符合的字；只在步驟裡的，收起的列下面列出那一句，展開後不重複', async () => {
    const { wrapper } = await mountTips('super_admin')
    const input = wrapper.get('.tips__search input')
    expect(wrapper.find('mark').exists()).toBe(false)
    await input.setValue('匯出')
    expect(wrapper.findAll('#tip-export .tip__title mark').map(mark => mark.text())).toEqual(['匯出', '匯出'])
    // 標題就有搜尋字：不用再列一句
    expect(wrapper.find('#tip-export .tip__snippet').exists()).toBe(false)
    await input.setValue('游標')
    const snippet = wrapper.get('#tip-search .tip__snippet')
    expect(snippet.text()).toContain('游標會跳到左上角')
    expect(snippet.get('mark').text()).toBe('游標')
    expect(snippet.find('kbd').exists()).toBe(true)
    await wrapper.get('#tip-search .tip__toggle').trigger('click')
    expect(wrapper.find('#tip-search .tip__snippet').exists()).toBe(false)
    expect(wrapper.get('#tip-search-body mark').text()).toBe('游標')
  })

  it('選了某一類時搜尋：別的分類有符合的要講，按一下看全部分類（搜尋字留著）', async () => {
    const { wrapper, router } = await mountTips('super_admin', { query: { section: 'visits' } })
    const input = wrapper.get('.tips__search input')
    const elsewhere = (word: string) => TIPS.filter(tip => tip.section !== 'visits'
      && [tip.title, ...tip.steps.map(stepText), ...(tip.keywords ?? [])].join(' ').includes(word)).length
    // 這一類 0 條、別類有
    await input.setValue('密碼')
    expect(wrapper.findAll('li.tip')).toHaveLength(0)
    expect(wrapper.get('.empty-note').text()).toContain(`「參觀案件」這一類沒有符合「密碼」的小技巧，其他分類有 ${elsewhere('密碼')} 條。`)
    expect(wrapper.get('[aria-live]').text()).toBe(`找到 0 條小技巧，其他分類還有 ${elsewhere('密碼')} 條`)
    // 這一類有、別類也有
    await input.setValue('匯出')
    expect(wrapper.findAll('li.tip').length).toBeGreaterThan(0)
    expect(wrapper.get('.tips__elsewhere').text()).toContain(`其他分類還有 ${elsewhere('匯出')} 條符合「匯出」`)
    await wrapper.get('.tips__elsewhere button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.section).toBeUndefined()
    expect(wrapper.find('.tips__elsewhere').exists()).toBe(false)
    expect((input.element as HTMLInputElement).value).toBe('匯出')
    expect(wrapper.find('#tip-stats-drill').exists()).toBe(true)
    // 沒在搜尋時不寫這一句（別類本來就有別的小技巧）
    await router.replace({ path: '/tips', query: { section: 'visits' } })
    await input.setValue('')
    expect(wrapper.find('.tips__elsewhere').exists()).toBe(false)
    // 哪裡都沒有：照舊是清除搜尋
    await input.setValue('沒有這個字')
    expect(wrapper.get('.empty-note').text()).toContain('沒有符合「沒有這個字」的小技巧。')
    expect(wrapper.get('.empty-note button').text()).toBe('清除搜尋')
  })

  it('展開的那一條寫進網址（分類照留），收起或全部收起就拿掉', async () => {
    const { wrapper, router } = await mountTips('super_admin', { query: { section: 'visits' } })
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await wrapper.get('#tip-notes .tip__toggle').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#tip-notes')
    expect(router.currentRoute.value.query.section).toBe('visits')
    // 自己點開的不捲動
    expect(scrolled).not.toHaveBeenCalled()
    // 再開一條：網址換成後開的那條，前一條仍展開
    await wrapper.get('#tip-next .tip__toggle').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#tip-next')
    expect(wrapper.get('#tip-notes .tip__toggle').attributes('aria-expanded')).toBe('true')
    // 收起不是網址上的那條：網址不動
    await wrapper.get('#tip-notes .tip__toggle').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#tip-next')
    await wrapper.get('#tip-next .tip__toggle').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('')
    // 全部展開不寫（不是某一條），全部收起會拿掉
    await wrapper.get('#tip-notes .tip__toggle').trigger('click')
    await flushPromises()
    await wrapper.get('.tips__expand-all').trigger('click')
    await wrapper.get('.tips__expand-all').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('')
    expect(scrolled).not.toHaveBeenCalled()
    scrolled.mockRestore()
  })

  it('連結指的那一條被分類或「只列我能用的」濾掉時，拿掉條件讓它出現', async () => {
    const { wrapper, router } = await mountTips('reception', { query: { section: 'content', mine: '1' }, hash: '#tip-account' })
    expect(router.currentRoute.value.query.section).toBeUndefined()
    expect(router.currentRoute.value.query.mine).toBeUndefined()
    expect(router.currentRoute.value.hash).toBe('#tip-account')
    expect(wrapper.get('#tip-account .tip__toggle').attributes('aria-expanded')).toBe('true')
    // 同一類裡的連結不動分類
    const same = await mountTips('reception', { query: { section: 'visits' }, hash: '#tip-notes' })
    expect(same.router.currentRoute.value.query.section).toBe('visits')
    expect(same.wrapper.get('#tip-notes .tip__toggle').attributes('aria-expanded')).toBe('true')
  })

  it('複製這一條的連結：不帶分類與只列我能用的；複製不了時請對方複製網址列', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const { wrapper } = await mountTips('reception', { query: { section: 'visits', mine: '1' } })
      const copy = wrapper.get('#tip-notes .tip__copy')
      expect(copy.text()).toBe('複製這一條的連結')
      await copy.trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tips#tip-notes`)
      expect(document.body.textContent).toContain('已複製這一條的連結')
      writeText.mockRejectedValueOnce(new Error('denied'))
      await copy.trigger('click')
      await flushPromises()
      expect(document.body.textContent).toContain('無法自動複製')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
      document.querySelectorAll('.el-message').forEach(el => el.remove())
    }
  })

  it('截圖被縮小時（手機）整張可以點開看原本的大小；放得下時就是一般的圖', async () => {
    // 預設（jsdom 沒有 ResizeObserver）量不到寬度：不給放大
    const plain = await mountTips('super_admin')
    expect(plain.wrapper.find('.tip__zoom').exists()).toBe(false)

    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
    const innerWidth = window.innerWidth
    vi.stubGlobal('ResizeObserver', class {
      private readonly callback: () => void
      constructor(callback: () => void) { this.callback = callback }
      observe() { this.callback() }
      disconnect() {}
    })
    try {
      // 手機：頁面 358px 寬
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 358 })
      window.innerWidth = 390
      const phone = await mountTips('super_admin')
      const wide = phone.wrapper.get('#tip-preview .tip__zoom')
      expect(wide.get('img').attributes('alt')).toBe(TIPS.find(tip => tip.id === 'preview')!.imageAlt)
      expect(wide.text()).toBe('放大')
      expect(phone.wrapper.find('.tips__zoom-scroll').exists()).toBe(false)
      await wide.trigger('click')
      await flushPromises()
      const dialog = phone.wrapper.get('.tips__zoom-dialog')
      expect(dialog.text()).toContain('寬螢幕點案件，右邊直接預覽')
      expect(dialog.text()).toContain('左右拖動可以看截圖的其他地方')
      const big = dialog.get('.tips__zoom-scroll img')
      expect(Number(big.attributes('width'))).toBe(sizes['visit-preview']!.width)
      expect(dialog.get('.tips__zoom-scroll').attributes('tabindex')).toBe('0')

      // 桌機 1440：寬截圖幾乎是原本的大小，窄截圖放在右欄，都不給放大
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 1124 })
      window.innerWidth = 1440
      const desktop = await mountTips('super_admin')
      expect(desktop.wrapper.find('.tip__zoom').exists()).toBe(false)
      expect(desktop.wrapper.get('#tip-preview img').attributes('loading')).toBe('lazy')
    } finally {
      if (width) Object.defineProperty(Element.prototype, 'clientWidth', width)
      window.innerWidth = innerWidth
      vi.unstubAllGlobals()
    }
  })

  it('有截圖的條目附上圖片與說明文字，延遲載入', async () => {
    const { wrapper } = await mountTips('super_admin')
    const withShot = TIPS.filter(tip => tip.image && shotFiles.includes(tip.image))
    for (const tip of withShot) {
      const img = wrapper.get(`#tip-${tip.id} img`)
      expect(img.attributes('alt')).toBe(tip.imageAlt)
      expect(img.attributes('loading')).toBe('lazy')
      expect(Number(img.attributes('width'))).toBe(sizes[tip.image!]!.width)
    }
  })
})
