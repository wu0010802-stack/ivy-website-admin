// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, onBeforeUnmount, onMounted, onUnmounted, ref, type App } from 'vue'

// 2026-11-10 渲染流暢度：捲動驅動的效果共用一個每幀排程，先一起讀、再一起寫（utils/scrollFrame.ts）。
// 原本各自 scroll→rAF，前面寫了 clip-path／CSS 變數／inert，後面再讀 window.scrollY 或 rect，
// 正式站手機 4 倍降速每幀逼出 10–48ms 的同步重排（README 同日段落）。

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
function flush() {
  const due = [...frames.values()]
  frames.clear()
  due.forEach((cb) => cb(0))
}

/** 記下讀版面與寫 DOM 的先後：scrollY、rect 算讀；style、inert、class、dataset 算寫。 */
let log: string[] = []
let scrollY = 0

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('onUnmounted', onUnmounted)
  frames = new Map()
  log = []
  scrollY = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => { log.push('read:scrollY'); return scrollY } })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('utils/scrollFrame：先讀後寫', () => {
  it('同一幀所有 task 的 read 都在任何 write 之前；scrollY 只讀一次、傳給每個 task', async () => {
    const { requestScrollFrame } = await import('../app/utils/scrollFrame')
    scrollY = 120
    const seen: number[] = []
    const a = { read: (y: number) => { seen.push(y); log.push('a.read') }, write: (y: number) => { seen.push(y); log.push('a.write') } }
    const b = { write: (y: number) => { seen.push(y); log.push('b.write') } }
    const c = { read: (y: number) => { seen.push(y); log.push('c.read') }, write: () => log.push('c.write') }
    requestScrollFrame(a)
    requestScrollFrame(b)
    requestScrollFrame(c)
    expect(frames.size).toBe(1)
    flush()
    expect(log).toEqual(['read:scrollY', 'a.read', 'c.read', 'a.write', 'b.write', 'c.write'])
    expect(seen.every((y) => y === 120)).toBe(true)
  })

  it('同一個 task 一幀只跑一次；寫的時候再排的 task 排到下一幀', async () => {
    const { requestScrollFrame } = await import('../app/utils/scrollFrame')
    let runs = 0
    const again = { write: () => { runs++; if (runs === 1) requestScrollFrame(again) } }
    requestScrollFrame(again)
    requestScrollFrame(again)
    flush()
    expect(runs).toBe(1)
    expect(frames.size).toBe(1)
    flush()
    expect(runs).toBe(2)
  })

  it('取消：排程空了就連 rAF 一起取消；還有別的 task 就只拿掉這一個', async () => {
    const { cancelScrollFrame, requestScrollFrame } = await import('../app/utils/scrollFrame')
    const a = { write: vi.fn() }
    const b = { write: vi.fn() }
    requestScrollFrame(a)
    requestScrollFrame(b)
    cancelScrollFrame(a)
    expect(frames.size).toBe(1)
    cancelScrollFrame(b)
    expect(frames.size).toBe(0)
    // 取消後重新排得起來（不會因為舊的 frame id 卡住）
    requestScrollFrame(a)
    flush()
    expect(a.write).toHaveBeenCalledTimes(1)
    expect(b.write).not.toHaveBeenCalled()
  })

  it('一個 task 丟例外不擋其他 task（跟原本各自一個 rAF 時一樣），例外照舊丟到 window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const { requestScrollFrame } = await import('../app/utils/scrollFrame')
    const after = vi.fn()
    requestScrollFrame({ read: () => { throw new Error('boom') } })
    requestScrollFrame({ write: after })
    flush()
    expect(after).toHaveBeenCalledTimes(1)
    expect(() => vi.runAllTimers()).toThrow('boom')
    vi.useRealTimers()
  })
})

describe('首頁捲動效果接上共用排程：每幀只讀一次 scrollY，讀版面都在第一筆寫入之前', () => {
  let app: App | null = null
  afterEach(() => {
    app?.unmount()
    app = null
  })

  it('兩道簾幕＋首屏揭幕＋消息紙＋頁尾，同一幀的讀寫順序', async () => {
    const { useCurtain } = await import('../app/composables/useCurtain')
    const { useHomeReveal } = await import('../app/composables/useHomeReveal')
    const { useNewsTransition } = await import('../app/composables/useNewsTransition')
    document.body.innerHTML = `
      <div class="home-reveal"><div class="home-reveal-track"><section class="studio-hero">
        <div class="studio-hero-copy"></div><div class="studio-hero-image"></div><div class="studio-media"></div><div class="studio-actions"></div>
      </section></div></div>
      <div class="belief-reveal"><div class="belief-reveal-track"><section class="home-belief"></section></div></div>
      <div class="day-reveal"><div class="day-reveal-track"><section class="day-experience"></section></div></div>
      <div class="news-transition"><div class="news-transition-prior"></div><div class="news-transition-paper"></div></div>`
    const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
    const rect = (top: number, height: number) => () => { log.push('read:rect'); return { top, height, bottom: top + height } as DOMRect }
    q('.studio-hero').getBoundingClientRect = rect(0, 700)
    q('.home-reveal-track').getBoundingClientRect = rect(0, 1600)
    q('.belief-reveal-track').getBoundingClientRect = rect(1600, 2400)
    q('.home-belief').getBoundingClientRect = rect(1600, 900)
    q('.day-reveal-track').getBoundingClientRect = rect(4000, 3000)
    q('.day-experience').getBoundingClientRect = rect(4000, 1500)
    q('.news-transition-paper').getBoundingClientRect = rect(900, 600)
    // 寫入以 inert 為代表（happy-dom 的 style 是 Proxy，攔不到 clipPath）：簾幕、揭幕、消息紙跨過門檻時都會寫
    for (const el of [q('.home-belief'), q('.day-experience'), q('.news-transition-prior'), q('.studio-hero'), q('.studio-media'), q('.studio-actions')]) {
      let inert = false
      Object.defineProperty(el, 'inert', { configurable: true, get: () => inert, set: (v: boolean) => { log.push('write:inert'); inert = v } })
    }
    app = createApp(defineComponent({
      setup() {
        useHomeReveal({ root: ref(q('.home-reveal')), track: ref(q('.home-reveal-track')), hero: ref(q('.studio-hero')), copy: ref(q('.studio-hero-copy')), image: ref(q('.studio-hero-image')), media: ref(q('.studio-media')), actions: ref(q('.studio-actions')) })
        useCurtain(ref(q('.belief-reveal')), ref(q('.belief-reveal-track')), ref(q('.home-belief')), 'belief')
        useCurtain(ref(q('.day-reveal')), ref(q('.day-reveal-track')), ref(q('.day-experience')), 'day')
        useNewsTransition(ref(q('.news-transition')), ref(q('.news-transition-prior')), ref(q('.news-transition-paper')))
        return () => null
      }
    }))
    app.mount(document.createElement('div'))
    flush()

    let framesWithWrites = 0
    for (const y of [900, 1800, 2600, 3400, 5600, 6400]) {
      scrollY = y
      log = []
      window.dispatchEvent(new Event('scroll'))
      flush()
      const reads = log.filter((entry) => entry.startsWith('read:'))
      const firstWrite = log.findIndex((entry) => entry.startsWith('write:'))
      const lastRead = log.findLastIndex((entry) => entry.startsWith('read:'))
      expect(reads.filter((entry) => entry === 'read:scrollY')).toHaveLength(1)
      // 消息紙的位置在任何簾幕寫入之前就讀好
      if (firstWrite >= 0) {
        framesWithWrites++
        expect(lastRead).toBeLessThan(firstWrite)
      }
    }
    expect(framesWithWrites).toBeGreaterThan(1)
  })
})
