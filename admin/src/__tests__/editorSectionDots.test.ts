// 2026-10-06 方向 D：段落目錄固定在左、和官網不同的段落打點（和動作列「草稿有 N 處修改」同一個基準）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { dirtySectionIds, type EditorSection } from '../composables/editorSections'
import type { ContentEditorState, DraftBaseline } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
