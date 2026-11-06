import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue'
import {
  SCROLL_ACTIVE_TAB_FRAMES,
  useScrollActiveTabIntoView,
  type ScrollableTabs,
} from '../composables/useScrollActiveTabIntoView'

// 手動推進的 rAF：Element Plus 的分頁列要過幾幀才可捲動，這裡逐幀確認有持續呼叫。
let queue: Array<{ id: number; cb: FrameRequestCallback }> = []
let nextId = 1
function runFrame() {
  const current = queue
  queue = []
  for (const item of current) item.cb(0)
}

let app: App | null = null
function mountWith(tabs: ReturnType<typeof shallowRef<ScrollableTabs>>) {
  const host = document.createElement('div')
  app = createApp(defineComponent({
    setup() {
      useScrollActiveTabIntoView(tabs)
      return () => h('div')
    },
  }))
  app.mount(host)
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
  it('分頁列出現後連續幾幀呼叫 scrollToActiveTab，之後停止', async () => {
    const scrollToActiveTab = vi.fn()
    const tabs = shallowRef<ScrollableTabs>(null)
    mountWith(tabs)
    runFrame()
    expect(scrollToActiveTab).not.toHaveBeenCalled()

    // 例如招生統計：資料載入後分頁列才 v-if 出現。
    tabs.value = { tabNavRef: { scrollToActiveTab } }
    await nextTick()
    for (let i = 0; i < SCROLL_ACTIVE_TAB_FRAMES + 3; i += 1) runFrame()
    expect(scrollToActiveTab).toHaveBeenCalledTimes(SCROLL_ACTIVE_TAB_FRAMES)
    expect(queue).toHaveLength(0)
  })

  it('一開始就有分頁列也會呼叫；卸載時取消還沒跑的影格', async () => {
    const scrollToActiveTab = vi.fn()
    mountWith(shallowRef<ScrollableTabs>({ tabNavRef: { scrollToActiveTab } }))
    await nextTick()
    runFrame()
    expect(scrollToActiveTab).toHaveBeenCalledTimes(1)

    app?.unmount()
    app = null
    runFrame()
    expect(scrollToActiveTab).toHaveBeenCalledTimes(1)
    expect(queue).toHaveLength(0)
  })

  it('沒有 tabNavRef 時不出錯', async () => {
    mountWith(shallowRef<ScrollableTabs>({ tabNavRef: null }))
    await nextTick()
    expect(() => runFrame()).not.toThrow()
  })
})
