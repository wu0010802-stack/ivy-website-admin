// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, type App, type Component } from 'vue'

// 2026-11-26 吹蠟燭的麥克風（utils/anniversary/cake.ts 的 startMic、AnniversaryCake.vue 的 toggleMic）：
// 原本只用「mic 有值」擋重複，但 mic 要等權限框與開裝置都回來才有值。等待中再按一次會開第二條串流，
// 先回來的那條永遠關不掉；等待中離開頁面（destroy）或 30 支都吹熄，晚到的串流照樣接上，麥克風一直開著。
// DESIGN.md「麥克風」：全部吹熄或離開就關。這裡用假的 getUserMedia（手動決定何時回來）與假的 AudioContext 驗。

const TOKENS: Record<string, string> = {
  '--green': 'oklch(37% .057 157)', '--deep': 'oklch(28% .04 162)', '--white': 'oklch(99.7% .003 100)', '--muted': 'oklch(47% .025 155)',
  '--ivy-paint-sun-rgb': '246 204 98', '--ivy-paint-mint-rgb': '128 194 160', '--ivy-paint-orange-rgb': '236 150 90',
  '--ivy-paint-sky-rgb': '134 184 222', '--ivy-paint-leaf-rgb': '108 162 112'
}
const PAD = ['var(--green)', 'rgb(var(--ivy-paint-leaf-rgb))', 'rgb(var(--ivy-paint-sun-rgb))', 'rgb(var(--ivy-paint-orange-rgb))', 'rgb(var(--ivy-paint-sky-rgb))', 'rgb(var(--ivy-paint-mint-rgb))']

// ── 假的 2D context：什麼都吃 ──
function fake2d(canvas: HTMLCanvasElement) {
  const own: Record<string | symbol, unknown> = {
    canvas,
    createRadialGradient: () => ({ addColorStop() {} })
  }
  return new Proxy(own, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: () => true
  })
}

class FakeObserver {
  constructor(public cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ── 假麥克風：每次 getUserMedia 都是各自的 track（真 Chrome 也是），何時回來由測試決定 ──
interface FakeTrack { stopped: number; stop(): void }
interface FakeStream { tracks: FakeTrack[]; getTracks(): FakeTrack[] }
interface Pending { resolve(s: FakeStream): void; reject(e: unknown): void; stream: FakeStream }
class FakeAudioContext {
  closed = 0
  sampleRate = 48000
  constructor() { actxs.push(this) }
  resume() { return Promise.resolve() }
  close() { this.closed++; return Promise.resolve() }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 512, getFloatFrequencyData(buf: Float32Array) { buf.fill(-140) } } }
  createMediaStreamSource() { return { connect() {} } }
}
let ios: FakeObserver[] = []
let frames = new Map<number, FrameRequestCallback>()
let frameId = 0
const clock = { now: 1000 }
let gum: Pending[] = []
let actxs: FakeAudioContext[] = []
const tracks = () => gum.map((p) => p.stream.tracks[0]!.stopped)
const runFrame = (dt = 16) => {
  clock.now += dt
  const due = [...frames.values()]
  frames.clear()
  for (const cb of due) cb(clock.now)
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(() => {
  vi.resetModules()
  ios = []; frames = new Map(); frameId = 0; gum = []; actxs = []
  clock.now = 1000
  const contexts = new WeakMap<HTMLCanvasElement, unknown>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, fake2d(this))
    return contexts.get(this)
  } as never)
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({ color: 'rgb(9, 9, 9)', getPropertyValue: (n: string) => TOKENS[n] ?? '' })))
  vi.stubGlobal('IntersectionObserver', class extends FakeObserver { constructor(cb: FakeObserver['cb']) { super(cb); ios.push(this) } })
  vi.stubGlobal('ResizeObserver', FakeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => new Promise<FakeStream>((resolve, reject) => {
        const track: FakeTrack = { stopped: 0, stop() { this.stopped++ } }
        gum.push({ resolve, reject, stream: { tracks: [track], getTracks: () => [track] } })
      }))
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'mediaDevices')
  document.body.innerHTML = ''
})

async function mount(reduce = true) {
  const stage = document.createElement('div')
  stage.innerHTML = '<svg class="anni-cake-art"></svg><canvas class="anni-cake-fx"></canvas>'
  document.body.append(stage)
  const { mountCake } = await import('../app/utils/anniversary/cake')
  let allOut = 0
  const ctl = await mountCake(stage, { reduce, colors: PAD, onChange: () => {}, onAllOut: () => { allOut++ } })
  // 進到畫面：減少動態時一次點著 30 支，跑完那一格就停
  ios.at(-1)!.cb([{ target: stage, isIntersecting: true }])
  for (let i = 0; i < 20 && frames.size; i++) runFrame()
  return { ctl, allOut: () => allOut }
}

describe('cakemic：startMic 請求中再按一次，共用同一個請求', () => {
  it('權限框還開著時連呼兩次：只要一次權限、只建一個 AudioContext；關掉麥克風就全部還回去', async () => {
    const { ctl } = await mount()
    const p1 = ctl.startMic()
    const p2 = ctl.startMic()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    expect(actxs).toHaveLength(1)
    expect(p2).toBe(p1)
    gum.forEach((p) => p.resolve(p.stream))
    expect(await p1).toBe('on')
    expect(await p2).toBe('on')
    ctl.stopMic()
    expect(tracks()).toEqual([1])
    expect(actxs.map((a) => a.closed)).toEqual([1])
    // 關掉之後可以再開一次，是新的請求
    const p3 = ctl.startMic()
    expect(p3).not.toBe(p1)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    gum[1]!.resolve(gum[1]!.stream)
    expect(await p3).toBe('on')
    ctl.destroy()
    expect(tracks()).toEqual([1, 1])
    expect(actxs.map((a) => a.closed)).toEqual([1, 1])
  })

  it('拒絕權限：AudioContext 關掉，之後還能再請求一次', async () => {
    const { ctl } = await mount()
    const p1 = ctl.startMic()
    gum[0]!.reject(new DOMException('no', 'NotAllowedError'))
    expect(await p1).toBe('denied')
    expect(actxs.map((a) => a.closed)).toEqual([1])
    const p2 = ctl.startMic()
    expect(p2).not.toBe(p1)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    gum[1]!.resolve(gum[1]!.stream)
    expect(await p2).toBe('on')
    ctl.destroy()
  })
})

describe('cakemic：權限還沒回來就離開頁面或吹熄，晚到的串流立刻還回去', () => {
  it('離開頁面（destroy）後才允許：track 停掉、AudioContext 關掉，不接上麥克風，也不再排幀', async () => {
    const { ctl } = await mount(true)
    expect(frames.size).toBe(0)
    const p = ctl.startMic()
    ctl.destroy()
    gum[0]!.resolve(gum[0]!.stream)
    expect(await p).toBe('off')
    await flush()
    expect(tracks()).toEqual([1])
    expect(actxs.map((a) => a.closed)).toEqual([1])
    expect(frames.size).toBe(0)
    // 銷毀之後再呼叫也不會去要權限
    expect(await ctl.startMic()).toBe('off')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('沒有開減少動態時也一樣：destroy 之後按住吹氣不會重新開始畫', async () => {
    const { ctl } = await mount(false)
    const p = ctl.startMic()
    ctl.destroy()
    expect(frames.size).toBe(0)
    gum[0]!.resolve(gum[0]!.stream)
    expect(await p).toBe('off')
    ctl.setHold(true)
    expect(frames.size).toBe(0)
    expect(tracks()).toEqual([1])
  })

  it('權限框開著時用按鈕把 30 支都吹熄，之後才允許：麥克風不接上', async () => {
    const { ctl, allOut } = await mount(true)
    const p = ctl.startMic()
    ctl.setHold(true)
    for (let i = 0; i < 2000 && !allOut(); i++) runFrame()
    ctl.setHold(false)
    expect(allOut()).toBe(1)
    gum[0]!.resolve(gum[0]!.stream)
    expect(await p).toBe('off')
    expect(tracks()).toEqual([1])
    expect(actxs.map((a) => a.closed)).toEqual([1])
    ctl.destroy()
  })
})

// ── 元件：請求中按鈕 disabled，連點不會再要一次 ──
describe('cakemic：AnniversaryCake.vue 的「用麥克風吹」', () => {
  let app: App | null = null
  afterEach(() => { app?.unmount(); app = null })

  it('等權限時按鈕 disabled、連點只請求一次；允許後變「關掉麥克風」，卸載時串流還回去', async () => {
    // Nuxt 的自動匯入在單元測試裡沒有，這裡補上（afterEach 會清掉 stub，所以放在測試裡）
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
    history.replaceState(null, '', '/anniversary')
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const { default: AnniversaryCake } = await import('../app/components/AnniversaryCake.vue')
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(AnniversaryCake as Component, { colors: PAD }) })
    app.component('AnniversarySoundToggle', defineComponent({ render: () => h('button', { type: 'button' }, '開聲音') }))
    app.config.warnHandler = () => {}
    app.mount(host)
    // 元件自己的觀察者：進到附近才載入蛋糕
    const stage = host.querySelector<HTMLElement>('.anni-cake-stage')!
    ios[0]!.cb([{ target: stage, isIntersecting: true }])
    const micBtn = () => [...host.querySelectorAll<HTMLButtonElement>('.anni-cake-tools button')].find((b) => /麥克風/.test(b.textContent ?? ''))!
    await vi.waitFor(() => expect(micBtn().disabled).toBe(false))

    micBtn().click()
    await nextTick()
    expect(micBtn().disabled).toBe(true)
    micBtn().click()
    micBtn().dispatchEvent(new MouseEvent('click'))
    await flush()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)

    gum.forEach((p) => p.resolve(p.stream))
    await vi.waitFor(() => expect(micBtn().textContent).toContain('關掉麥克風'))
    expect(micBtn().disabled).toBe(false)
    expect(micBtn().getAttribute('aria-pressed')).toBe('true')

    app.unmount()
    app = null
    expect(tracks()).toEqual([1])
    expect(actxs.map((a) => a.closed)).toEqual([1])
  })
})
