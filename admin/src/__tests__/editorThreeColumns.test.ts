// 2026-10-06 方向 D：1280 以上、後台與官網同源時，內容編輯頁右側放官網預覽；其他情況維持原版面。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import type { ContentEditorState } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 正式站的建置：VITE_WEBSITE_ASSET_BASE 是空字串（後台與官網同源）。
vi.mock('../config', () => ({ WEBSITE_ASSET_BASE: '', websiteAssetUrl: (key: string) => `/assets/${key}.webp` }))

// 有些環境（例如 Node 25）的 jsdom localStorage 只是沒有方法的空物件，沒有 Storage 的實作就補一個最小的。
if (typeof (globalThis.localStorage as Storage | undefined)?.getItem !== 'function') {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  })
}

// 路徑要走變數：Vite 會把字面的 new URL('…', import.meta.url) 當成素材網址改寫，讀不到檔案。
const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const editorSource = readSource('../components/ContentEditor.vue')
// 從 `@media (min-width: 1280px) {` 切到下一個行首的 `}`（巢狀規則都有縮排），不會一路吃到後面的 @media。
function desktopBlock(css: string): string {
  const start = css.indexOf('@media (min-width: 1280px) {')
  expect(start).toBeGreaterThan(-1)
  const end = css.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end + 2)
}
const wrappers: VueWrapper[] = []
const originalMatchMedia = window.matchMedia
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  window.matchMedia = originalMatchMedia
  localStorage.clear()
  document.body.innerHTML = ''
})

function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
  return {
    kind: 'site_footer',
    loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(true),
    isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
    latestRevisionId: computed(() => 'r1'),
    form: ref({ tagline: '標語' }),
    ...overrides,
  } as ContentEditorState
}

async function mountEditor(editor: ContentEditorState, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ContentEditor, { props: { editor, ...props }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function narrowScreen() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === 'not all and (min-width: 1280px)', media: query, addEventListener() {}, removeEventListener() {},
  })) as never
}

describe('右側官網預覽欄', () => {
  it('1280 以上、同源、有對應預覽頁：顯示預覽欄，版面放寬', async () => {
    const wrapper = await mountEditor(editorState())
    expect(wrapper.get('.editor').classes()).toContain('editor--preview')
    expect(wrapper.get('.editor__layout').classes()).toContain('has-preview')
    const pane = wrapper.get('aside.editor__preview')
    expect(pane.attributes('aria-label')).toBe('官網預覽')
    expect(pane.get('iframe').attributes('src')).toBe(`${window.location.origin}/preview?embed=1&page=home`)
    expect(pane.get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
  })

  it('1280 以下、校園探索、尚未選校區：不顯示預覽欄', async () => {
    expect((await mountEditor(editorState({ kind: 'campus_tour' }))).find('.editor__preview').exists()).toBe(false)
    expect((await mountEditor(editorState(), { placeholder: '你的帳號沒有可編輯的校區。' })).find('.editor__preview').exists()).toBe(false)
    narrowScreen()
    const narrow = await mountEditor(editorState())
    expect(narrow.find('.editor__preview').exists()).toBe(false)
    expect(narrow.get('.editor').classes()).not.toContain('editor--preview')
    expect(narrow.get('.editor__layout').classes()).not.toContain('has-preview')
  })

  it('兩個預覽分頁：切到另一頁換網址；寬度切換記在這台瀏覽器', async () => {
    const wrapper = await mountEditor(editorState({ kind: 'booking_content' }))
    expect(wrapper.get('iframe').attributes('src')).toContain('page=visit')
    await wrapper.findAll('.editor__preview .el-radio-button input')[1]!.setValue(true)
    await flushPromises()
    expect(wrapper.get('iframe').attributes('src')).toContain('page=home')
    await wrapper.findAll('.editor__preview .el-radio-button input')[2]!.setValue(true)
    await flushPromises()
    expect(localStorage.getItem('ivy-admin-preview-viewport')).toBe('desktop')
  })

  it('存成新的一版後重新載入預覽（這一階段預覽看的是已存草稿）', async () => {
    const latestRevisionId = ref('r1')
    const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => latestRevisionId.value) }))
    const first = wrapper.get('iframe').element
    latestRevisionId.value = 'r2'
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
  })

  it('換校區：預覽跟著重新載入（frameKey 含校區）', async () => {
    const campusKey = ref<string | null>('yihua')
    const wrapper = await mountEditor(editorState({ kind: 'campus_profile', campusKey: computed(() => campusKey.value) }))
    const first = wrapper.get('iframe').element
    campusKey.value = 'minghua'
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
  })

  it('格線：有目錄 152 / 420–560 / 至少 320；沒目錄 440–640 / 至少 320', () => {
    const desktop = desktopBlock(editorSource)
    expect(desktop).toContain('.editor--preview { max-width: none; }')
    expect(desktop).toContain("grid-template-columns: minmax(440px, 640px) minmax(320px, 1fr); grid-template-areas: 'top preview' 'body preview';")
    expect(desktop).toContain("grid-template-columns: 152px minmax(420px, 560px) minmax(320px, 1fr); grid-template-areas: 'nav top preview' 'nav body preview';")
    // 預覽欄跨兩列、高度固定：沒有明寫列高，短表單時多出來的高度會平均分給兩列，把表單推離狀態列。
    expect(desktop).toMatch(/\.editor__layout\.has-preview \{[^}]*grid-template-rows: auto 1fr;/)
    for (const area of ['top', 'nav', 'body', 'preview']) expect(desktop).toContain(`.editor__layout.has-preview > .editor__${area} { grid-area: ${area};`)
  })

  it('JS 與 CSS 斷點是同一條線：1280 以上才放預覽，小數寬（1279.5）兩邊不會都不成立', () => {
    expect(editorSource).toContain("useNarrowScreen('not all and (min-width: 1280px)')")
    expect(editorSource).toContain('@media (min-width: 1280px) {')
    expect(editorSource).not.toContain('max-width: 1279px')
  })

  it('預覽欄高度要扣掉黏底動作列：--editor-actions-h 在 .editor 上依控制項高度算出來', () => {
    // 動作列真實高度＝上框 1＋上下內距 16＋16＋按鈕（--control-h：滑鼠 38、觸控 44）＋和表單的間距 16。
    expect(editorSource).toMatch(/\.editor \{[^}]*--editor-actions-h: calc\(var\(--control-h\) \+ 49px\);/)
    expect(editorSource).toMatch(/\.editor__actions \{[^}]*margin-top: 16px;[^}]*padding: 16px 0 max\(16px, env\(safe-area-inset-bottom\)\);/)
  })
})
