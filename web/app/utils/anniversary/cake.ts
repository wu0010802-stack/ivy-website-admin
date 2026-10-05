// 30 週年分頁「幫常春藤吹蠟燭」：手繪的蛋糕（Rough.js 產生 SVG）＋30 支蠟筆蠟燭的火焰、煙、彩帶（canvas）。
// 三種吹法：按住按鈕、滑鼠或手指劃過火焰、對麥克風吹（blow.ts 判斷，只在裝置上算、不錄音）。
// 模擬在 candles.ts（純函式）；這裡只管畫面與輸入。
import { CAKE_H, CAKE_TOP, CAKE_W, CANDLE_HEIGHT, blowWind, litCount, makeCandles, relight, stepCandles, swipeWind, type Candle, type Wind } from './candles'
import { blowReading, nextFloor } from './blow'
import { puff, spark } from './sound'

export interface CakeOptions {
  reduce: boolean
  /** 六支蠟筆的顏色（CSS），蠟燭依序輪流 */
  colors: readonly string[]
  onChange: (lit: number) => void
  onAllOut: () => void
}

export interface CakeController {
  setHold(on: boolean): void
  startMic(): Promise<'on' | 'denied' | 'unsupported'>
  stopMic(): void
  relightAll(): void
  destroy(): void
}

const NS = 'http://www.w3.org/2000/svg'
const TIP_H = 14

interface Smoke { x: number; y: number; s: number; t0: number; ph: number }
interface Bit { x: number; y: number; vx: number; vy: number; rot: number; vr: number; c: number; len: number; curl: number; ph: number }

export async function mountCake(stage: HTMLElement, opts: CakeOptions): Promise<CakeController> {
  const svg = stage.querySelector<SVGSVGElement>('svg.anni-cake-art')!
  const canvas = stage.querySelector<HTMLCanvasElement>('canvas.anni-cake-fx')!
  const css = getComputedStyle(stage)
  const tok = (n: string) => css.getPropertyValue(n).trim()
  const paint = (n: string) => `rgb(${tok(n)})`
  const C = {
    deep: tok('--deep'), green: tok('--green'), white: tok('--white'), muted: tok('--muted'),
    sun: paint('--ivy-paint-sun-rgb'), mint: paint('--ivy-paint-mint-rgb'), orange: paint('--ivy-paint-orange-rgb'), sky: paint('--ivy-paint-sky-rgb'), leaf: paint('--ivy-paint-leaf-rgb')
  }
  const crayonCols = opts.colors.map((c) => (c.includes('var(') ? resolveColor(c, stage) : c))

  // ── 蛋糕（一次畫好） ──
  const { default: rough } = await import('roughjs')
  const gen = rough.generator()
  const add = (drawable: ReturnType<typeof gen.path>, cls?: string) => {
    for (const p of gen.toPaths(drawable)) {
      const el = document.createElementNS(NS, 'path')
      el.setAttribute('d', p.d)
      el.style.fill = p.fill ?? 'none'
      el.style.stroke = p.stroke === 'none' ? 'none' : p.stroke
      el.style.strokeWidth = String(p.strokeWidth)
      if (cls) el.setAttribute('class', cls)
      svg.appendChild(el)
    }
  }
  const ink = { stroke: C.deep, strokeWidth: 2.2, roughness: 1.3, bowing: 0.8 }
  const { cx, cy, rx, ry } = CAKE_TOP
  const bottomY = 440
  // 盤子
  add(gen.ellipse(cx, 474, 540, 96, { ...ink, roughness: 1.6, fill: C.white, fillStyle: 'solid', seed: 11 }))
  add(gen.ellipse(cx, 470, 450, 70, { stroke: C.sky, strokeWidth: 2, roughness: 1.4, seed: 12 }))
  // 側面：暖黃蛋糕體，孩子的鋸齒塗法；中間夾一層薄荷奶油
  const side = `M${cx - rx} ${cy} L${cx - rx} ${bottomY} A${rx} ${ry} 0 0 0 ${cx + rx} ${bottomY} L${cx + rx} ${cy} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z`
  // 先鋪一層白底，盤子的線才不會從鋸齒塗色的縫裡透出來
  add(gen.path(side, { stroke: 'none', fill: C.white, fillStyle: 'solid', roughness: 0.4, seed: 20 }))
  add(gen.path(side, { ...ink, fill: C.sun, fillStyle: 'zigzag', hachureGap: 8, fillWeight: 2.4, hachureAngle: -32, seed: 21 }))
  const band = (y: number) => Array.from({ length: 41 }, (_, i) => { const x = cx - rx + 4 + (rx * 2 - 8) * i / 40; return [x, y + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2))] as [number, number] })
  add(gen.curve(band(372), { stroke: C.mint, strokeWidth: 11, roughness: 1.2, seed: 22 }))
  // 灑在側面的彩色小糖
  const sprinkle = [C.orange, C.sky, C.leaf, C.white]
  for (let i = 0; i < 26; i++) {
    const x = cx - rx + 24 + ((i * 97) % (rx * 2 - 48)), base = cy + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2))
    const y = base + 42 + ((i * 53) % 58)
    if (Math.abs(y - (372 + base - cy)) < 12) continue
    const a = (i * 1.7) % Math.PI
    add(gen.line(x, y, x + Math.cos(a) * 9, y + Math.sin(a) * 9, { stroke: sprinkle[i % 4]!, strokeWidth: 3.2, roughness: 0.6, seed: 40 + i }))
  }
  // 頂面奶油＋往下流的奶油滴
  add(gen.ellipse(cx, cy, rx * 2, ry * 2, { ...ink, fill: C.white, fillStyle: 'solid', seed: 31 }))
  const edge = (x: number) => cy + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2))
  let drip = `M${cx - rx} ${cy}`
  const drips = 13
  for (let i = 0; i < drips; i++) {
    const x0 = cx - rx + (rx * 2) * i / drips, x1 = cx - rx + (rx * 2) * (i + 1) / drips, xm = (x0 + x1) / 2
    const L = 14 + ((i * 37) % 26)
    drip += ` L${x0.toFixed(1)} ${edge(x0).toFixed(1)} C${(x0 + 4).toFixed(1)} ${(edge(x0) + 4).toFixed(1)} ${(xm - 9).toFixed(1)} ${(edge(xm) + L).toFixed(1)} ${xm.toFixed(1)} ${(edge(xm) + L).toFixed(1)} C${(xm + 9).toFixed(1)} ${(edge(xm) + L).toFixed(1)} ${(x1 - 4).toFixed(1)} ${(edge(x1) + 4).toFixed(1)} ${x1.toFixed(1)} ${edge(x1).toFixed(1)}`
  }
  drip += ` L${cx + rx} ${cy} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z`
  add(gen.path(drip, { ...ink, fill: C.white, fillStyle: 'solid', roughness: 1, seed: 32 }))
  // 蠟筆蠟燭：後排先畫，前排蓋在上面
  const candles: Candle[] = makeCandles()
  const order = candles.map((_, i) => i).sort((a, b) => candles[a]!.y - candles[b]!.y)
  for (const i of order) {
    const c = candles[i]!, s = c.s, col = crayonCols[c.color % crayonCols.length]!
    const w = 14 * s, top = c.y - CANDLE_HEIGHT * s, x0 = c.x - w / 2
    const o = { stroke: C.deep, strokeWidth: 1.4, roughness: 0.7, bowing: 0.4, seed: 100 + i }
    add(gen.rectangle(x0, top, w, CANDLE_HEIGHT * s, { ...o, fill: col, fillStyle: 'solid' }))
    // 包裝紙：白色紙帶＋兩條細線
    add(gen.rectangle(x0, top + 26 * s, w, 24 * s, { ...o, fill: C.white, fillStyle: 'solid' }))
    add(gen.line(x0 + 2, top + 31 * s, x0 + w - 2, top + 31 * s, { stroke: col, strokeWidth: 1.6, roughness: 0.5, seed: 300 + i }))
    add(gen.line(x0 + 2, top + 45 * s, x0 + w - 2, top + 45 * s, { stroke: col, strokeWidth: 1.6, roughness: 0.5, seed: 400 + i }))
    // 筆尖
    add(gen.polygon([[x0 + 1, top + 1], [x0 + w - 1, top + 1], [c.x, top - TIP_H * s]], { ...o, fill: col, fillStyle: 'solid' }), 'anni-cake-tip')
  }
  svg.classList.add('is-drawn')

  // ── 火焰、煙、彩帶（canvas） ──
  const g = canvas.getContext('2d')!
  let scale = 1, dpr = 1
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, 2)
    const w = stage.clientWidth, h = stage.clientHeight
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    scale = w / CAKE_W
  }
  size()
  const smokes: Smoke[] = []
  const bits: Bit[] = []
  const sparks: Array<{ x: number; y: number; t0: number }> = []
  const tipOf = (c: Candle) => [c.x, c.y - CANDLE_HEIGHT * c.s - TIP_H * c.s + 1] as const

  const flame = (c: Candle, t: number, i: number) => {
    const [x, y] = tipOf(c)
    const flick = opts.reduce ? 1 : 1 + 0.08 * Math.sin(t * 11 + i * 1.9) + 0.05 * Math.sin(t * 23.7 + i * 0.7)
    const h = 30 * c.s * flick * (0.45 + 0.55 * c.heat)
    const w = 11 * c.s * (0.8 + 0.2 * c.heat)
    const sway = opts.reduce ? 0 : Math.sin(t * 1.8 + i) * 0.05
    // 光暈
    const halo = g.createRadialGradient(x, y - h * 0.45, 0, x, y - h * 0.45, 40 * c.s)
    halo.addColorStop(0, `rgb(${tok('--ivy-paint-sun-rgb')} / ${0.34 * c.heat})`)
    halo.addColorStop(1, `rgb(${tok('--ivy-paint-sun-rgb')} / 0)`)
    g.fillStyle = halo
    g.fillRect(x - 40 * c.s, y - h * 0.45 - 40 * c.s, 80 * c.s, 80 * c.s)
    g.save()
    g.translate(x, y)
    g.rotate(c.lean * 0.9 + sway)
    const drop = (k: number, dy: number) => {
      g.beginPath()
      g.moveTo(0, dy)
      g.bezierCurveTo(w * 0.62 * k, dy - h * 0.12 * k, w * 0.5 * k, dy - h * 0.62 * k, 0, dy - h * k)
      g.bezierCurveTo(-w * 0.5 * k, dy - h * 0.62 * k, -w * 0.62 * k, dy - h * 0.12 * k, 0, dy)
      g.fill()
    }
    g.fillStyle = C.orange; drop(1, 0)
    g.fillStyle = C.sun; drop(0.66, -h * 0.04)
    g.fillStyle = C.white; drop(0.3, -h * 0.05)
    g.restore()
  }

  const drawSmoke = (sm: Smoke, now: number) => {
    const a = (now - sm.t0) / 1000
    if (a > 1.9) return false
    const len = Math.min(1, a / 0.6) * 64 * sm.s
    const alpha = 0.55 * (1 - Math.max(0, a - 0.5) / 1.4)
    g.strokeStyle = C.muted
    g.globalAlpha = Math.max(0, alpha)
    g.lineWidth = 2.4 * sm.s
    g.lineCap = 'round'
    g.beginPath()
    const N = 14
    for (let k = 0; k <= N; k++) {
      const yk = sm.y - a * 18 - (k / N) * len
      const xk = sm.x + Math.sin(k * 0.55 + a * 3.2 + sm.ph) * (1.5 + k * 0.55) * sm.s
      if (k) g.lineTo(xk, yk); else g.moveTo(xk, yk)
    }
    g.stroke()
    g.globalAlpha = 1
    return true
  }

  const drawBits = (dt: number) => {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]!
      b.vy += 420 * dt
      b.vx += Math.sin(b.ph + b.y * 0.05) * 60 * dt
      b.vx *= 1 - 1.4 * dt; b.vy *= 1 - 1.1 * dt
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt
      if (b.y > CAKE_H + 30) { bits.splice(i, 1); continue }
      g.save()
      g.translate(b.x, b.y); g.rotate(b.rot)
      g.strokeStyle = crayonCols[b.c]!
      g.lineWidth = 3.2; g.lineCap = 'round'
      g.beginPath(); g.arc(0, 0, b.len, -b.curl, b.curl); g.stroke()
      g.restore()
    }
  }

  // ── 輸入：按住、劃過、麥克風 ──
  let hold = false, holdLevel = 0, micLevel = 0
  let ptr: { x: number; y: number; vx: number; vy: number; t: number } | null = null
  const toUnits = (e: PointerEvent) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * CAKE_W, (e.clientY - r.top) / r.height * CAKE_H] as const }
  const onMove = (e: PointerEvent) => {
    const [x, y] = toUnits(e)
    const t = e.timeStamp
    if (ptr && t > ptr.t) {
      const dt = Math.max(0.008, (t - ptr.t) / 1000)
      const k = 0.5
      ptr = { x, y, vx: ptr.vx * (1 - k) + ((x - ptr.x) / dt) * k, vy: ptr.vy * (1 - k) + ((y - ptr.y) / dt) * k, t }
    } else ptr = { x, y, vx: 0, vy: 0, t }
    kick()
  }
  const onLeave = () => { ptr = null }
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerleave', onLeave)
  stage.addEventListener('pointercancel', onLeave)

  let mic: { stream: MediaStream; actx: AudioContext; an: AnalyserNode; buf: Float32Array<ArrayBuffer>; floor: number } | null = null
  const stopMic = () => {
    if (!mic) return
    mic.stream.getTracks().forEach((tr) => tr.stop())
    mic.actx.close().catch(() => {})
    mic = null; micLevel = 0
  }

  // ── 主迴圈 ──
  let raf = 0, visible = false, last = performance.now(), wasAll = false, celebrateAt = -1
  let pending: number[] = []
  const windOf = (c: Candle): Wind => {
    const t = performance.now() / 1000
    let x = opts.reduce ? 0 : Math.sin(t * 1.7 + c.x * 0.05) * 0.05, strength = 0
    const base = Math.max(holdLevel, micLevel * 1.15)
    if (base > 0.01) { const w = blowWind(c, base, t); x += w.x; strength += w.strength }
    if (ptr && performance.now() - ptr.t < 120) { const w = swipeWind(c, ptr.x, ptr.y, ptr.vx, ptr.vy); x += w.x; strength += w.strength }
    return { x, strength }
  }
  const frame = (now: number) => {
    raf = 0
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000
    holdLevel += ((hold ? 1 : 0) - holdLevel) * Math.min(1, dt * (hold ? 2.2 : 6))
    if (mic) {
      mic.an.getFloatFrequencyData(mic.buf)
      const r = blowReading(mic.buf, mic.actx.sampleRate / mic.an.fftSize, mic.floor)
      mic.floor = nextFloor(mic.floor, r.lowDb, dt)
      micLevel += (r.level - micLevel) * Math.min(1, dt * 12)
    }
    const out = stepCandles(candles, dt, windOf, now)
    for (const i of out) {
      const c = candles[i]!
      const [x, y] = tipOf(c)
      if (!opts.reduce) smokes.push({ x, y, s: c.s, t0: now, ph: i * 1.3 })
      puff(0.6 + 0.4 * c.s)
    }
    if (out.length) opts.onChange(litCount(candles))
    const lit = litCount(candles)
    // 只有「被吹熄」的那一格才算全部吹熄（一開始還沒點燃時也是 0 支）
    if (lit === 0 && out.length && !wasAll) { wasAll = true; celebrateAt = now + 650; stopMic(); opts.onAllOut() }
    if (celebrateAt > 0 && now >= celebrateAt) {
      celebrateAt = -1
      if (!opts.reduce) for (let k = 0; k < 130; k++) {
        bits.push({ x: Math.random() * CAKE_W, y: -20 - Math.random() * 160, vx: (Math.random() - 0.5) * 120, vy: Math.random() * 80, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 9,
          c: k % crayonCols.length, len: 4 + Math.random() * 5, curl: 0.8 + Math.random() * 1.4, ph: Math.random() * 6 })
      }
    }
    // 畫
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
    g.clearRect(0, 0, CAKE_W, CAKE_H)
    candles.forEach((c, i) => { if (c.lit) flame(c, t, i) })
    for (let i = smokes.length - 1; i >= 0; i--) if (!drawSmoke(smokes[i]!, now)) smokes.splice(i, 1)
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i]!, a = (now - sp.t0) / 260
      if (a >= 1) { sparks.splice(i, 1); continue }
      g.strokeStyle = C.orange; g.lineWidth = 2; g.globalAlpha = 1 - a
      for (let k = 0; k < 6; k++) { const ang = k * Math.PI / 3; g.beginPath(); g.moveTo(sp.x + Math.cos(ang) * 4, sp.y + Math.sin(ang) * 4); g.lineTo(sp.x + Math.cos(ang) * (6 + a * 12), sp.y + Math.sin(ang) * (6 + a * 12)); g.stroke() }
      g.globalAlpha = 1
    }
    drawBits(dt)
    const busy = !opts.reduce || smokes.length || bits.length || sparks.length || hold || holdLevel > 0.01 || mic || (ptr && now - ptr.t < 200) || celebrateAt > 0 || pending.length
    if (visible && busy) raf = requestAnimationFrame(frame)
  }
  const kick = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame) } }

  // 依序點燃（第一次進到畫面、或「再點一次」）
  let lightTimer = 0
  const lightSequence = (all: number[]) => {
    clearInterval(lightTimer)
    pending = all.slice()
    for (const i of pending) { candles[i]!.lit = false; candles[i]!.outAt = -1 }
    if (opts.reduce) { for (const i of pending) relight(candles[i]!); pending = []; opts.onChange(litCount(candles)); kick(); return }
    lightTimer = window.setInterval(() => {
      const i = pending.shift()
      if (i === undefined) { clearInterval(lightTimer); return }
      relight(candles[i]!)
      const [x, y] = tipOf(candles[i]!)
      sparks.push({ x, y: y - 8, t0: performance.now() })
      if (i % 3 === 0) spark()
      opts.onChange(litCount(candles))
      kick()
    }, 42)
  }
  const sequence = () => candles.map((_, i) => i).sort((a, b) => candles[a]!.x - candles[b]!.x)

  let lit0 = false
  const io = new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting)
    if (visible && !lit0) { lit0 = true; lightSequence(sequence()) }
    if (visible) kick()
  }, { threshold: 0.3 })
  io.observe(stage)
  const ro = new ResizeObserver(() => { size(); kick() })
  ro.observe(stage)
  // 一開始全熄（等進到畫面才一支一支點）
  for (const c of candles) c.lit = false
  opts.onChange(0)

  return {
    setHold(on) { hold = on; kick() },
    async startMic() {
      if (mic) return 'on'
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return 'unsupported'
      // AudioContext 要在按鈕的使用者手勢裡建立；等權限視窗回來再建，手勢已經過期，會一直停在 suspended
      const actx = new AudioContext()
      let stream: MediaStream
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }) } catch { actx.close().catch(() => {}); return 'denied' }
      await actx.resume().catch(() => {})
      const an = actx.createAnalyser()
      an.fftSize = 1024
      an.smoothingTimeConstant = 0.2
      actx.createMediaStreamSource(stream).connect(an)
      mic = { stream, actx, an, buf: new Float32Array(an.frequencyBinCount), floor: Number.NaN }
      kick()
      return 'on'
    },
    stopMic,
    relightAll() { wasAll = false; bits.length = 0; lightSequence(sequence()) },
    destroy() {
      io.disconnect(); ro.disconnect(); clearInterval(lightTimer); cancelAnimationFrame(raf); stopMic()
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerleave', onLeave)
      stage.removeEventListener('pointercancel', onLeave)
    }
  }
}

/** var(--token) 之類的顏色交給瀏覽器算出實際值（canvas 吃不了 var()） */
function resolveColor(cssColor: string, host: HTMLElement): string {
  const probe = document.createElement('span')
  probe.style.color = cssColor
  probe.hidden = true
  host.appendChild(probe)
  const v = getComputedStyle(probe).color
  probe.remove()
  return v
}
