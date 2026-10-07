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
    expect(basic!.get('.visually-hidden').text()).toBe('（有修改）')
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
