// 內容編輯右側預覽欄的位置與高度改用量的（T8b）：沒捲動時欄底被黏底動作列蓋住 30–105px、捲到底時欄頂被頂欄蓋約 24px，
// 原因是原本只估「視窗高 − 頂欄 − 動作列」，沒算欄的自然位置與版面底端到頁面底端的距離。
// 版面無法在 jsdom 驗；這裡驗算式與「量到的變化會更新變數、卸載會收乾淨」，實際位置要瀏覽器看（見報告）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, toRef } from 'vue'
import { previewPaneFit, usePreviewPaneFit } from '../composables/usePreviewPaneFit'

const base = { viewportHeight: 900, topBarHeight: 64, actionsHeight: 87, layoutTop: 100, tail: 151 }

describe('previewPaneFit：欄高取三個限制的最小值', () => {
  it('黏住的 top＝頂欄＋24；欄高三種位置都放得下', () => {
    // 黏住 900−88−103＝709；沒捲動 900−103−100＝697；捲到底 900−151−88＝661（最緊）
    expect(previewPaneFit(base)).toEqual({ top: 88, height: 661 })
  })

  it('版面離頁首很遠（頁首說明很長）時，沒捲動的限制最緊：欄底不鑽進動作列', () => {
    const fit = previewPaneFit({ ...base, layoutTop: 190 })
    expect(fit.height).toBe(900 - 87 - 16 - 190)
    // 欄自然位置 190、高度 607 → 欄底 797＝動作列頂端 900−87 再往上 16
    expect(190 + fit.height).toBeLessThanOrEqual(900 - 87 - 16)
  })

  it('捲到底：版面底端到頁面底端的距離（空隙、動作列、主區下內距）算進去，欄頂不被往上推到頂欄底下', () => {
    const fit = previewPaneFit({ ...base, layoutTop: 90, tail: 16 + 87 + 48 })
    // 捲到底時版面底端在視窗 900−151＝749；欄貼著頂端 88 → 高度不能超過 661
    expect(88 + fit.height).toBeLessThanOrEqual(900 - 151)
  })

  it('動作列變高（換行）時欄高跟著減；唯讀沒有動作列時不扣', () => {
    const wrapped = previewPaneFit({ ...base, actionsHeight: 131, tail: 16 + 131 + 48 })
    expect(wrapped.height).toBeLessThan(previewPaneFit(base).height)
    const readOnly = previewPaneFit({ ...base, actionsHeight: 0, tail: 48 })
    expect(readOnly.height).toBeGreaterThan(previewPaneFit(base).height)
  })

  it('頂欄比 64 高就用實際高度；視窗很矮時高度不會變負數', () => {
    expect(previewPaneFit({ ...base, topBarHeight: 70 }).top).toBe(94)
    expect(previewPaneFit({ ...base, viewportHeight: 100 }).height).toBe(0)
  })
})

// ResizeObserver 的替身：記下觀察的元素，測試自己觸發回呼。
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false
  callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) { this.observed.push(el) }
  disconnect() { this.disconnected = true }
  trigger() { this.callback() }
}

const rect = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, left: 0, right: 900, x: 0, y: top, width: 900, height: bottom - top, toJSON: () => ({}) }) as DOMRect

describe('usePreviewPaneFit：量到的變化會更新 CSS 變數', () => {
  const wrappers: VueWrapper[] = []
  let header: HTMLElement
  let innerHeight = 900

  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    innerHeight = 900
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => innerHeight)
    header = document.createElement('header')
    header.className = 'top'
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 64 })
    document.body.appendChild(header)
  })
  afterEach(() => {
    wrappers.forEach((w) => w.unmount())
    wrappers.length = 0
    header.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mountHost(active = true, measurable = true) {
    const activeRef = ref(active)
    const root = ref<HTMLElement | null>(null)
    const layout = ref<HTMLElement | null>(null)
    const actions = ref<HTMLElement | null>(null)
    const Host = defineComponent({
      setup() {
        const vars = usePreviewPaneFit({ active: toRef(activeRef), root, layout, actions })
        return () => h('main', { style: { paddingBottom: '48px' } }, [
          h('div', { ref: root, id: 'root', style: vars.value }, [h('div', { ref: layout, id: 'layout' }), h('div', { ref: actions, id: 'actions' })]),
        ])
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    wrappers.push(wrapper)
    const rootEl = wrapper.get('#root').element as HTMLElement
    const state = { layoutTop: 100, layoutBottom: 2500, rootBottom: 2500 + 16 + 87, actionsHeight: 87 }
    // jsdom 沒有版面：量到的數字由測試給（measurable＝false 就維持 jsdom 的全 0）。
    if (!measurable) return { wrapper, activeRef, rootEl, state }
    rootEl.getBoundingClientRect = () => rect(80, state.rootBottom)
    ;(wrapper.get('#layout').element as HTMLElement).getBoundingClientRect = () => rect(state.layoutTop, state.layoutBottom)
    Object.defineProperty(wrapper.get('#actions').element, 'offsetHeight', { configurable: true, get: () => state.actionsHeight })
    return { wrapper, activeRef, rootEl, state }
  }
  const style = (el: HTMLElement) => ({ top: el.style.getPropertyValue('--live-preview-top'), h: el.style.getPropertyValue('--live-preview-h') })

  it('jsdom 沒有版面時不給變數（退回 CSS 的估算值）', async () => {
    const { rootEl } = mountHost(true, false)
    await nextTick()
    expect(style(rootEl)).toEqual({ top: '', h: '' })
  })

  it('ResizeObserver 回呼就量一次、寫進根元素；動作列變高再回呼，欄高跟著變', async () => {
    const { rootEl, state } = mountHost()
    await nextTick()
    const observer = FakeResizeObserver.instances.at(-1)!
    // 觀察根元素、動作列與頂欄
    expect(observer.observed).toContain(rootEl)
    expect(observer.observed).toContain(document.getElementById('actions'))
    expect(observer.observed).toContain(header)

    observer.trigger()
    await nextTick()
    // 尾巴＝版面底端 2500 到根元素底端 2603（16＋87）＋主區下內距 48 ＝151；最緊的是捲到底 900−151−88＝661
    expect(style(rootEl)).toEqual({ top: '88px', h: '661px' })

    // 動作列換行變高 44px：根元素也跟著長，欄高減 44
    state.actionsHeight = 131
    state.rootBottom += 44
    observer.trigger()
    await nextTick()
    expect(style(rootEl)).toEqual({ top: '88px', h: '617px' })

    // 頂欄變高 6px：黏住的 top 跟著
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 70 })
    observer.trigger()
    await nextTick()
    expect(style(rootEl).top).toBe('94px')
  })

  it('視窗大小變了（window resize）也重量', async () => {
    const { rootEl } = mountHost()
    await nextTick()
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(style(rootEl).h).toBe('661px')
    innerHeight = 700
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(style(rootEl).h).toBe('461px')
  })

  it('預覽欄收起時清掉變數並停止觀察；再出現時重新量', async () => {
    const { rootEl, activeRef } = mountHost()
    await nextTick()
    FakeResizeObserver.instances.at(-1)!.trigger()
    await nextTick()
    expect(style(rootEl).h).toBe('661px')
    const first = FakeResizeObserver.instances.at(-1)!

    activeRef.value = false
    await nextTick()
    await nextTick()
    expect(first.disconnected).toBe(true)
    expect(style(rootEl)).toEqual({ top: '', h: '' })
    // 收起後視窗變了不再量
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(style(rootEl).h).toBe('')

    activeRef.value = true
    await nextTick()
    await nextTick()
    expect(FakeResizeObserver.instances.at(-1)).not.toBe(first)
    expect(style(rootEl).h).toBe('661px')
  })

  it('元件卸載時 disconnect 並移掉 resize 監聽', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { wrapper } = mountHost()
    await nextTick()
    const observer = FakeResizeObserver.instances.at(-1)!
    expect(observer.disconnected).toBe(false)
    wrapper.unmount()
    wrappers.length = 0
    expect(observer.disconnected).toBe(true)
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})

describe('接線', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('LivePreviewPane 的 top／height 先用量到的變數，沒有才退回估算', () => {
    const pane = read('../components/LivePreviewPane.vue')
    expect(pane).toContain('top: var(--live-preview-top, calc(var(--top-h) + 24px));')
    expect(pane).toContain('height: var(--live-preview-h, calc(100svh - var(--top-h) - 24px - var(--editor-actions-h, 88px)));')
  })

  it('ContentEditor 把變數綁在根元素上，量的是版面與動作列', () => {
    const editor = read('../components/ContentEditor.vue')
    expect(editor).toContain('usePreviewPaneFit({ active: showPreviewPane, root: editorRoot, layout: editorLayout, actions: editorActions })')
    expect(editor).toMatch(/<div ref="editorRoot" class="editor"[^>]*:style="previewPaneVars">/)
    expect(editor).toContain('<div ref="editorLayout" class="editor__layout"')
    expect(editor).toContain('<div v-if="!readOnly" ref="editorActions" class="editor__actions"')
  })
})
