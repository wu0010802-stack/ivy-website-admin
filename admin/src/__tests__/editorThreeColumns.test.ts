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
    expect(pane.get('iframe').attributes('src')).toBe(`${window.location.origin}/preview?embed=1&live=1&page=home`)
    expect(pane.get('.live-preview__meta').text()).toBe('正在載入預覽…')
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

  it('還沒接上即時預覽時：切分頁換網址；寬度切換記在這台瀏覽器', async () => {
    const wrapper = await mountEditor(editorState({ kind: 'booking_content' }))
    expect(wrapper.get('iframe').attributes('src')).toContain('page=visit')
    await wrapper.findAll('.editor__preview .el-radio-button input')[1]!.setValue(true)
    await flushPromises()
    expect(wrapper.get('iframe').attributes('src')).toContain('page=home')
    await wrapper.findAll('.editor__preview .el-radio-button input')[2]!.setValue(true)
    await flushPromises()
    expect(localStorage.getItem('ivy-admin-preview-viewport')).toBe('desktop')
  })

  // 預覽頁回一則訊息給後台（同源、來源是目前這個 iframe）。
  function replyFromPreview(wrapper: VueWrapper, data: unknown) {
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const event = new Event('message')
    Object.assign(event, { data, origin: window.location.origin, source: frame.contentWindow })
    window.dispatchEvent(event)
  }

  it('預覽頁回 ready：改寫成「預覽的是還沒存的修改」，把目前表單送進去', async () => {
    const form = ref({ tagline: '標語' })
    const wrapper = await mountEditor(editorState({ form }))
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    replyFromPreview(wrapper, { type: 'ivy-preview:ready', v: 1 })
    await flushPromises()
    expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是還沒存的修改')
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'ivy-preview:draft', kind: 'site_footer', payload: { tagline: '標語' } }), window.location.origin)
  })

  it('預覽頁沒接上（saved）時，存成新的一版就重新載入預覽', async () => {
    // 只假 setTimeout：@vue/test-utils 的 flushPromises 用 setImmediate，一起假掉會卡住。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const latestRevisionId = ref('r1')
      const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => latestRevisionId.value) }))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
      const first = wrapper.get('iframe').element
      latestRevisionId.value = 'r2'
      await flushPromises()
      expect(wrapper.get('iframe').element).not.toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('預覽頁接上（live）後，存成新的一版不重新載入：預覽本來就是現在的表單', async () => {
    const latestRevisionId = ref('r1')
    const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => latestRevisionId.value) }))
    const first = wrapper.get('iframe').element
    vi.spyOn((first as HTMLIFrameElement).contentWindow!, 'postMessage').mockImplementation(() => {})
    replyFromPreview(wrapper, { type: 'ivy-preview:ready', v: 1 })
    await flushPromises()
    latestRevisionId.value = 'r2'
    await flushPromises()
    expect(wrapper.get('iframe').element).toBe(first)
  })

  it('從沒存過的內容，20 秒沒回應也不說「上次儲存的草稿」', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => null) }))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是官網目前的內容')
    } finally {
      vi.useRealTimers()
    }
  })

  it('預覽頁拒絕（沒登入）：欄內說明＋重新載入，按了就換一個新的 iframe', async () => {
    const wrapper = await mountEditor(editorState())
    const first = wrapper.get('iframe').element
    replyFromPreview(wrapper, { type: 'ivy-preview:denied', v: 1 })
    await flushPromises()
    expect(wrapper.get('.live-preview__failed').text()).toContain('預覽沒有載入，可能是登入逾時。')
    await wrapper.get('.live-preview__failed button').trigger('click')
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
    expect(wrapper.get('.live-preview__meta').text()).toBe('正在載入預覽…')
    expect(wrapper.find('.live-preview__failed').exists()).toBe(false)
  })

  it('這一則修改預覽畫不出來：狀態列說明，和沒登入的拒絕畫面是兩回事', async () => {
    const wrapper = await mountEditor(editorState())
    vi.spyOn((wrapper.get('iframe').element as HTMLIFrameElement).contentWindow!, 'postMessage').mockImplementation(() => {})
    replyFromPreview(wrapper, { type: 'ivy-preview:ready', v: 1 })
    replyFromPreview(wrapper, { type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'failed' })
    await flushPromises()
    expect(wrapper.get('.live-preview__meta').text()).toBe('預覽畫不出這個修改')
    expect(wrapper.find('.live-preview__failed').exists()).toBe(false)
  })

  it('草稿太大：不送，預覽欄說明', async () => {
    const form = ref({ tagline: 'x'.repeat(1_000_001) })
    const wrapper = await mountEditor(editorState({ form }))
    const post = vi.spyOn((wrapper.get('iframe').element as HTMLIFrameElement).contentWindow!, 'postMessage').mockImplementation(() => {})
    replyFromPreview(wrapper, { type: 'ivy-preview:ready', v: 1 })
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('.live-preview__meta').text()).toBe('草稿太大，預覽沒有更新')
  })

  it('不是這個 iframe、別的來源送來的 ready 不理', async () => {
    const wrapper = await mountEditor(editorState())
    const post = vi.spyOn((wrapper.get('iframe').element as HTMLIFrameElement).contentWindow!, 'postMessage').mockImplementation(() => {})
    const stranger = new Event('message')
    Object.assign(stranger, { data: { type: 'ivy-preview:ready', v: 1 }, origin: window.location.origin, source: window })
    window.dispatchEvent(stranger)
    const foreign = new Event('message')
    Object.assign(foreign, { data: { type: 'ivy-preview:ready', v: 1 }, origin: 'https://evil.example', source: (wrapper.get('iframe').element as HTMLIFrameElement).contentWindow })
    window.dispatchEvent(foreign)
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('.live-preview__meta').text()).toBe('正在載入預覽…')
  })

  it('預覽欄沒顯示（1280 以下）：不掛 message listener', async () => {
    narrowScreen()
    const add = vi.spyOn(window, 'addEventListener')
    const wrapper = await mountEditor(editorState())
    expect(wrapper.find('.editor__preview').exists()).toBe(false)
    expect(add.mock.calls.filter(([type]) => type === 'message')).toEqual([])
  })

  it('預覽欄有顯示：掛一個 message listener，卸載時拿掉', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const wrapper = await mountEditor(editorState())
    const added = add.mock.calls.filter(([type]) => type === 'message')
    expect(added).toHaveLength(1)
    wrapper.unmount()
    wrappers.length = 0
    expect(remove.mock.calls.filter(([type, fn]) => type === 'message' && fn === added[0]![1])).toHaveLength(1)
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
