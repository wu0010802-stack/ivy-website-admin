import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue'
import {
  SCROLL_ACTIVE_TAB_FRAMES,
  useScrollActiveTabIntoView,
  type ScrollableTabs,
} from '../composables/useScrollActiveTabIntoView'

// 手動推進的 rAF：Element Plus 的分頁列要過幾幀才標成可捲動，這裡逐幀確認時機。
let queue: Array<{ id: number; cb: FrameRequestCallback }> = []
let nextId = 1
function runFrame() {
  const current = queue
  queue = []
  for (const item of current) item.cb(0)
}

/** 模擬 el-tabs：根元素裡有 .el-tabs__nav-wrap，scrollable 時加 is-scrollable（同 Element Plus）。 */
function fakeTabs(scrollToActiveTab = vi.fn()) {
  const root = document.createElement('div')
  const wrap = document.createElement('div')
  wrap.className = 'el-tabs__nav-wrap'
  root.append(wrap)
  return {
    instance: { $el: root, tabNavRef: { scrollToActiveTab } } satisfies ScrollableTabs,
    scrollToActiveTab,
    becomeScrollable: () => wrap.classList.add('is-scrollable'),
  }
}

let app: App | null = null
function mountWith(tabs: ReturnType<typeof shallowRef<ScrollableTabs>>) {
  app = createApp(defineComponent({
    setup() {
      useScrollActiveTabIntoView(tabs)
      return () => h('div')
    },
  }))
  app.mount(document.createElement('div'))
}

beforeEach(() => {
  queue = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    queue.push({ id, cb })
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue = queue.filter(item => item.id !== id)
  })
})

afterEach(() => {
  app?.unmount()
  app = null
  vi.unstubAllGlobals()
})

describe('useScrollActiveTabIntoView', () => {
  it('分頁列出現後等到可捲動才呼叫一次 scrollToActiveTab，之後不再呼叫（避免動畫中途重算捲過頭）', async () => {
    const tabs = shallowRef<ScrollableTabs>(null)
    mountWith(tabs)
    runFrame()

    // 例如招生統計：資料載入後分頁列才 v-if 出現；Element Plus 過兩幀才標成可捲動。
    const fake = fakeTabs()
    tabs.value = fake.instance
    await nextTick()
    runFrame()
    runFrame()
    expect(fake.scrollToActiveTab).not.toHaveBeenCalled()

    fake.becomeScrollable()
    for (let i = 0; i < 5; i += 1) runFrame()
    expect(fake.scrollToActiveTab).toHaveBeenCalledTimes(1)
    expect(queue).toHaveLength(0)
  })

  it('一直放得下（寬螢幕）就不呼叫，等滿影格數後停止', async () => {
    const fake = fakeTabs()
    mountWith(shallowRef<ScrollableTabs>(fake.instance))
    await nextTick()
    for (let i = 0; i < SCROLL_ACTIVE_TAB_FRAMES + 3; i += 1) runFrame()
    expect(fake.scrollToActiveTab).not.toHaveBeenCalled()
    expect(queue).toHaveLength(0)
  })

  it('卸載時取消還沒跑的影格', async () => {
    const fake = fakeTabs()
    mountWith(shallowRef<ScrollableTabs>(fake.instance))
    await nextTick()
    runFrame()
    app?.unmount()
    app = null
    fake.becomeScrollable()
    runFrame()
    expect(fake.scrollToActiveTab).not.toHaveBeenCalled()
    expect(queue).toHaveLength(0)
  })

  it('沒有 tabNavRef 或 $el 時不出錯', async () => {
    mountWith(shallowRef<ScrollableTabs>({ $el: null, tabNavRef: null }))
    await nextTick()
    expect(() => runFrame()).not.toThrow()
  })
})
