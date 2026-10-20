// 2026-10-06 方向 D：段落目錄固定在左、和官網不同的段落打點（和動作列「草稿有 N 處修改」同一個基準）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { dirtySectionIds, type EditorSection, jumpToSection } from '../composables/editorSections'
import type { ContentEditorState, DraftBaseline } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { api } from '../api/client'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import HomeNewsView from '../views/HomeNewsView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
// 從 `@media (min-width: 1280px) {` 切到下一個行首的 `}`（巢狀規則都有縮排），不會一路吃到後面的 @media。
function desktopBlock(css: string): string {
  const start = css.indexOf('@media (min-width: 1280px) {')
  expect(start).toBeGreaterThan(-1)
  const end = css.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end + 2)
}
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const SECTIONS: EditorSection[] = [
  { id: 'basic', label: '基本資料', fields: ['name', 'phone'] },
  { id: 'social', label: '社群', fields: ['line'] },
  { id: 'p0', label: '第一段', fields: ['title', 'sections.0'] },
  { id: 'p1', label: '第二段', fields: ['sections.1'] },
]

describe('dirtySectionIds', () => {
  it('最外層欄位改了，那一段打點', () => {
    expect(dirtySectionIds(SECTIONS, new Set(['phone']), { phone: '1' }, { phone: '2' })).toEqual(['basic'])
  })

  it('清單只看自己那一項：改第二項只點第二段', () => {
    const base = { sections: [{ h: 'a' }, { h: 'b' }] }
    const current = { sections: [{ h: 'a' }, { h: 'B' }] }
    expect(dirtySectionIds(SECTIONS, new Set(['sections']), base, current)).toEqual(['p1'])
  })

  it('清單某一項對的是基準裡「同一項」（依標題），不是同一個位置：刪掉前面的段落，後面的不打點', () => {
    const a = { heading: '甲', body: '1' }
    const b = { heading: '乙', body: '2' }
    const c = { heading: '丙', body: '3' }
    const sections: EditorSection[] = [
      { id: 's0', label: '第一', fields: ['sections.0'] },
      { id: 's1', label: '第二', fields: ['sections.1'] },
    ]
    // 基準 [甲, 乙, 丙] → 現在 [甲, 丙]：位置 1 現在是丙，基準的位置 1 是乙，但丙沒改
    expect(dirtySectionIds(sections, new Set(['sections']), { sections: [a, b, c] }, { sections: [a, c] })).toEqual([])
    // 丙同時改了內文：只有丙那一段打點
    expect(dirtySectionIds(sections, new Set(['sections']), { sections: [a, b, c] }, { sections: [a, { ...c, body: '改' }] })).toEqual(['s1'])
    // 換順序但內容都沒改：沒有一段打點（動作列仍會寫欄位改了）
    expect(dirtySectionIds(sections, new Set(['sections']), { sections: [a, b] }, { sections: [b, a] })).toEqual([])
  })

  it('清單新增的一項在基準裡找不到對應：打點；標題重複分不出是哪一段時退回依位置比', () => {
    const sections: EditorSection[] = [
      { id: 's0', label: '第一', fields: ['sections.0'] },
      { id: 's1', label: '第二', fields: ['sections.1'] },
    ]
    expect(dirtySectionIds(sections, new Set(['sections']), { sections: [{ heading: '甲' }] }, { sections: [{ heading: '甲' }, { heading: '乙' }] })).toEqual(['s1'])
    const dup = [{ heading: '說明', body: '1' }, { heading: '說明', body: '2' }]
    expect(dirtySectionIds(sections, new Set(['sections']), { sections: dup }, { sections: [dup[0], { heading: '說明', body: '改' }] })).toEqual(['s1'])
  })

  it('沒有基準（從沒發布過）時 changedKeys 是空的，不打點', () => {
    expect(dirtySectionIds(SECTIONS, new Set(), null, { phone: '2' })).toEqual([])
  })

  it('沒寫 fields 的段落永遠不打點', () => {
    expect(dirtySectionIds([{ id: 'x', label: '舊段落' }], new Set(['phone']), {}, {})).toEqual([])
  })
})

describe('EditorSectionNav 打點', () => {
  it('dirtyIds 裡的段落有點與報讀文字，其他沒有', () => {
    const wrapper = mount(EditorSectionNav, { props: { sections: SECTIONS.slice(0, 2), dirtyIds: ['basic'] } })
    wrappers.push(wrapper)
    const [basic, social] = wrapper.findAll('a')
    expect(basic!.find('.section-nav__dot').exists()).toBe(true)
    expect(basic!.get('.visually-hidden').text()).toBe('（和官網不同）')
    expect(social!.find('.section-nav__dot').exists()).toBe(false)
    expect(social!.find('.visually-hidden').exists()).toBe(false)
  })

  it('沒傳 dirtyIds 時沒有任何點', () => {
    const wrapper = mount(EditorSectionNav, { props: { sections: SECTIONS.slice(0, 2) } })
    wrappers.push(wrapper)
    expect(wrapper.find('.section-nav__dot').exists()).toBe(false)
  })

  it('桌機樣式：目前段落用淺色主色底，不用左框（點是小圓點、不是色條）', () => {
    const nav = read('../components/EditorSectionNav.vue')
    const desktop = desktopBlock(nav)
    // 切出來的區塊要真的是目錄自己的 1280 規則，而不是吃到後面的 style。
    expect(desktop).toContain('.section-nav { position: sticky;')
    expect(desktop).toContain('.section-nav a[aria-current] { background: var(--el-color-primary-light-9);')
    expect(desktop).not.toMatch(/border-left/)
    expect(nav).toMatch(/\.section-nav__dot \{[^}]*background: var\(--brand-gold\);/)
    expect(nav).not.toMatch(/border-left/)
  })
})

describe('ContentEditor 把打點傳給目錄、目錄在左', () => {
  it('和官網不同的段落打點', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/')
    await router.isReady()
    const editor: ContentEditorState = {
      loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
      isDirty: computed(() => true), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
      load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
      form: ref({ name: '義華校', phone: '07-000-0000', line: 'https://lin.ee/a' }),
      draftBaseline: computed<DraftBaseline>(() => ({ source: 'live', payload: { name: '義華校', phone: '07-392-8366', line: 'https://lin.ee/a' } })),
      draftChanges: computed(() => [{ key: 'phone', label: '參觀專線', before: '07-392-8366', after: '07-000-0000' }]),
    }
    const wrapper = mount(ContentEditor, {
      props: { editor, sections: SECTIONS.slice(0, 2) },
      slots: { default: () => [h('h3', { id: 'basic' }, '基本資料'), h('h3', { id: 'social' }, '社群')] },
      global: { plugins: [pinia, router, ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await flushPromises()
    const dotted = wrapper.findAll('.section-nav a').filter((a) => a.find('.section-nav__dot').exists()).map((a) => a.get('.section-nav__label').text())
    expect(dotted).toEqual(['基本資料'])
    // 狀態列在 .editor__top 裡（1280 以上排在中欄頂端）；目錄與表單是它的兄弟。
    expect(wrapper.find('.editor__layout > .editor__top .editor__status').exists()).toBe(true)
    const layout = wrapper.get('.editor__layout')
    expect(Array.from(layout.element.children).map((el) => el.classList[0])).toEqual(['editor__top', 'section-nav', 'editor__body'])
  })

  it('1280 以上目錄在左：nav top / nav body', () => {
    const editor = read('../components/ContentEditor.vue')
    const desktop = desktopBlock(editor)
    expect(desktop).toContain("grid-template-areas: 'nav top' 'nav body'")
    expect(desktop).toContain('grid-template-columns: 184px minmax(0, 1fr)')
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }')
    expect(desktop).toContain('.editor__layout.has-nav > .editor__nav { grid-area: nav; }')
  })
})

// ---- 併自 uxRound8Nav.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-03 第八輪：長編輯頁的段落目錄（稽核 09-28「超長編輯頁沒有段落導覽」）。
describe('2026-10-03 第八輪：長編輯頁的段落目錄', () => {
  const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  const wrappers: VueWrapper[] = []
  const originalScroll = Element.prototype.scrollIntoView
  afterEach(() => {
    wrappers.forEach((w) => w.unmount())
    wrappers.length = 0
    vi.restoreAllMocks()
    Element.prototype.scrollIntoView = originalScroll
    document.body.innerHTML = ''
  })

  describe('段落目錄', () => {
    it('列出每一段；點一下捲到那一段的標題、焦點移過去、標成目前這段', async () => {
      document.body.innerHTML = '<h2 id="sec-a" data-section-anchor tabindex="-1">最新消息</h2><h2 id="sec-b" data-section-anchor>近期活動</h2>'
      const scrolled: string[] = []
      Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as never
      const wrapper = mount(EditorSectionNav, {
        props: { sections: [{ id: 'sec-a', label: '最新消息', note: '3 則' }, { id: 'sec-b', label: '近期活動' }] },
        attachTo: document.body,
      })
      wrappers.push(wrapper)
      expect(wrapper.get('nav').attributes('aria-label')).toBe('這一頁的段落')
      const links = wrapper.findAll('a')
      expect(links.map((a) => a.attributes('href'))).toEqual(['#sec-a', '#sec-b'])
      expect(links[0]!.get('.section-nav__label').text()).toBe('最新消息')
      expect(links[0]!.get('.section-nav__note').text()).toBe('3 則')
      expect(links[1]!.find('.section-nav__note').exists()).toBe(false)

      await links[1]!.trigger('click')
      expect(scrolled).toEqual(['sec-b'])
      expect(document.activeElement?.id).toBe('sec-b')
      // 原本沒有 tabindex 的標題補上 -1，焦點才移得過去。
      expect(document.getElementById('sec-b')!.getAttribute('tabindex')).toBe('-1')
      expect(links[1]!.attributes('aria-current')).toBe('location')
      expect(links[0]!.attributes('aria-current')).toBeUndefined()
    })

    it('找不到標題時不動、回 false', () => {
      expect(jumpToSection('no-such-section')).toBe(false)
    })

    it('ContentEditor：至少兩段才放目錄；桌機 1280 以上在左側一欄（2026-10-06 方向 D），窄螢幕在表單上方', () => {
      const editor = readSource('../components/ContentEditor.vue')
      expect(editor).toContain("import EditorSectionNav from './EditorSectionNav.vue'")
      expect(editor).toMatch(/hasNav = computed\(\(\) => navSections\.value\.length >= MIN_NAV_SECTIONS\)/)
      expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" :dirty-ids="dirtySections" class="editor__nav" \/>/)
      // 從 1280 的 @media 切到下一個行首 `}`，不會一路吃到後面的 @media。
      const start = editor.indexOf('@media (min-width: 1280px) {')
      const desktop = editor.slice(start, editor.indexOf('\n}', start) + 2)
      expect(desktop).toContain("grid-template-areas: 'nav top' 'nav body'")
      expect(desktop).toContain('.editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }')
      const nav = readSource('../components/EditorSectionNav.vue')
      // 窄螢幕膠囊列自己橫捲，不撐寬頁面；觸控 44px。
      expect(nav).toMatch(/\.section-nav ol \{[^}]*overflow-x: auto;/)
      expect(nav).toMatch(/\.section-nav a \{[^}]*min-height: 44px;/)
      const css = readSource('../style.css')
      expect(css).toMatch(/\[data-section-anchor\] \{ scroll-margin-top: 80px; \}/)
    })
  })

  function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
    return {
      id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
      latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
    }
  }

  async function mountView(component: unknown) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
    resetTitleFontCoverage()
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid' })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(component as ReturnType<typeof defineComponent>, {
      attachTo: document.body,
      global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
    } as never)
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  describe('長編輯頁接上目錄', () => {
    it('首頁消息：最新消息（則數）、近期活動（場數）、手機版活動影片；點了焦點到那一段標題', async () => {
      Element.prototype.scrollIntoView = () => {}
      vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', {
        sample_note: '', home_display_count: null, films: null,
        articles: [{ id: 'a1', date: '2026-10-01', category: '', title: '菜園', description: '', image: '', alt: '', scope: 'global', campus_keys: [], featured: false, body: [] }],
        events: [],
      }) as never)
      const wrapper = await mountView(HomeNewsView)
      const nav = wrapper.get('nav[aria-label="這一頁的段落"]')
      expect(nav.findAll('.section-nav__label').map((s) => s.text())).toEqual(['最新消息', '近期活動', '手機版活動影片'])
      expect(nav.findAll('.section-nav__note').map((s) => s.text())).toEqual(['1 則', '0 場'])
      for (const id of ['section-news-articles', 'section-news-events', 'section-news-films']) {
        expect(document.getElementById(id)?.hasAttribute('data-section-anchor')).toBe(true)
      }
      await nav.findAll('a')[1]!.trigger('click')
      expect(document.activeElement?.id).toBe('section-news-events')
    })

    it('隱私權政策：每一段一個目錄項目，小標改了目錄跟著改；空白小標寫「第 N 段」', async () => {
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => (
        path.startsWith('/admin/content-items/') ? contentItem('privacy_policy', {
          title: '隱私權政策', updated_on: '2026-10-03',
          sections: [{ heading: '蒐集的資料', body: '內文' }, { heading: '', body: '內文' }],
        }) : []
      ) as never)
      const wrapper = await mountView(PrivacyPolicyView)
      const labels = () => wrapper.get('nav[aria-label="這一頁的段落"]').findAll('.section-nav__label').map((s) => s.text())
      expect(labels()).toEqual(['蒐集的資料', '第 2 段'])
      await wrapper.findAll('input').find((i) => (i.element as HTMLInputElement).value === '蒐集的資料')!.setValue('使用目的')
      expect(labels()).toEqual(['使用目的', '第 2 段'])
      expect(document.getElementById('policy-section-1')?.hasAttribute('data-section-anchor')).toBe(true)
    })

    it('入學資訊、孩子的一天、各校消息都傳了 sections', () => {
      expect(readSource('../views/AdmissionContentView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
      expect(readSource('../views/DayExperienceView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
      expect(readSource('../views/CampusNewsView.vue')).toMatch(/:sections="navSections"/)
      for (const id of ['section-admission-steps', 'section-admission-phases', 'section-admission-fees']) {
        expect(readSource('../views/AdmissionContentView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
      }
      for (const id of ['section-day-film', 'section-day-moments']) {
        expect(readSource('../views/DayExperienceView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
      }
    })
  })
})
