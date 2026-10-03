// 30 週年分頁的時間軸：往下捲，蠟筆線跟著畫、紙偶在線頭走路、走到成立那一年卡片立起來，
// 終點把校徽印上去。線畫過就留著（往回捲不會擦掉），跟真的用蠟筆畫一樣。
import { ANNI_MEDIA } from './media'
import { crayonLineX, yearAtOffset, type YearMark } from './timeline'
import { PaperGL, cssColorRGB, loadImage, type CardTextures, type CrestTextures } from './paperGL'
import { createPuppet, PUPPET_ASPECT, PUPPET_TIP, type Puppet } from './puppet'

interface TrackOptions {
  reduce: boolean
  onYear: (year: number) => void
}

interface CardState {
  el: HTMLElement
  key: string
  canvas: HTMLCanvasElement
  triggerY: number
  started: number
  done: boolean
  tex: CardTextures | null
}

const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)))
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/** 同一個 y 永遠得到同一組亂數：重畫或改尺寸時蠟筆紋路不會變 */
function rand(y: number, k: number) {
  const s = Math.sin(y * 12.9898 + k * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export async function mountTrack(track: HTMLElement, opts: TrackOptions): Promise<() => void> {
  const root = track.closest('.anni') as HTMLElement
  const rail = track.querySelector<HTMLElement>('.anni-rail')!
  const ink = track.querySelector<HTMLCanvasElement>('.anni-ink')!
  const kids = track.querySelector<HTMLCanvasElement>('.anni-kids')!
  const crestEl = track.querySelector<HTMLElement>('.anni-crest')!
  const crestCanvas = track.querySelector<HTMLCanvasElement>('.anni-crest-canvas')!
  const style = getComputedStyle(root)
  const crayon = style.getPropertyValue('--anni-crayon').trim() || style.color
  const paperCss = getComputedStyle(document.body).getPropertyValue('--paper').trim() || '#fff'
  const muted = style.getPropertyValue('--muted').trim() || style.color
  const crayonRGB = cssColorRGB(crayon).map((v) => Math.round(v * 255))

  const gl = PaperGL.create(paperCss)
  const cards: CardState[] = [...track.querySelectorAll<HTMLElement>('.anni-campus')].map((el) => ({
    el, key: el.dataset.campus!, canvas: el.querySelector<HTMLCanvasElement>('.anni-card-canvas')!, triggerY: 0, started: -1, done: false, tex: null
  }))
  let crest: CrestTextures | null = null
  let crestStart = -1, crestDone = false, crestTrigger = 0

  // ── 素材 ──
  const [body, border] = await Promise.all([loadImage(ANNI_MEDIA.kidsBody), loadImage(ANNI_MEDIA.kidsBorder)])
  const puppet: Puppet = createPuppet(body, border, crayon, paperCss)
  if (gl) {
    try {
      await gl.loadPaper(ANNI_MEDIA.paper)
      await Promise.all(cards.map(async (c) => {
        c.tex = await gl.loadCard(`/assets/campus-line-art-${c.key}.webp`, `/assets/campus-line-art-${c.key}-colour.webp`, ANNI_MEDIA.fields[c.key as keyof typeof ANNI_MEDIA.fields])
      }))
      crest = await gl.loadCrest('/assets/ivy-30th-anniversary-projection.webp', ANNI_MEDIA.crestFields)
    } catch (e) { console.error(e) }
  }
  // 沒有 WebGL：卡片與校徽改用靜態圖
  for (const c of cards) if (!c.tex) c.el.querySelector('.anni-card')!.classList.add('is-fallback')
  if (!crest) crestEl.classList.add('is-fallback')

  // ── 尺寸 ──
  let marks: YearMark[] = []
  let trackTop = 0, trackH = 0, railW = 0, dpr = 1, inkDrawnTo = 0, maxHead = 0
  const measure = () => {
    const r = track.getBoundingClientRect()
    trackTop = r.top + scrollY
    trackH = track.offsetHeight
    railW = rail.offsetWidth
    marks = [...track.querySelectorAll<HTMLElement>('.anni-years > li')].map((li) => {
      const label = li.querySelector<HTMLElement>('.anni-year')!
      const lr = label.getBoundingClientRect()
      return { year: Number(li.dataset.year), y: lr.top + lr.height / 2 - r.top }
    })
    for (const c of cards) {
      const cr = c.el.getBoundingClientRect()
      c.triggerY = cr.top - r.top + 10
      const w = Math.round(c.canvas.offsetWidth * Math.min(devicePixelRatio, 2)), h = Math.round(c.canvas.offsetHeight * Math.min(devicePixelRatio, 2))
      if (w && h && (c.canvas.width !== w || c.canvas.height !== h)) { c.canvas.width = w; c.canvas.height = h; c.done = false }
    }
    crestTrigger = crestEl.getBoundingClientRect().top - r.top + 40
    const cw = Math.round(crestCanvas.offsetWidth * Math.min(devicePixelRatio, 2))
    if (cw && crestCanvas.width !== cw) { crestCanvas.width = crestCanvas.height = cw; crestDone = false }
    // 蠟筆線畫布：整條時間軸高；太高時降低解析度（iOS 單一 canvas 有面積上限）
    dpr = Math.min(devicePixelRatio || 1, 2, 12000 / Math.max(1, trackH))
    ink.style.height = `${trackH}px`
    ink.width = Math.max(1, Math.round(railW * dpr))
    ink.height = Math.max(1, Math.round(trackH * dpr))
    inkDrawnTo = 0
    const kw = kids.offsetWidth || 120
    kids.width = Math.round(kw * Math.min(devicePixelRatio, 2))
    kids.height = Math.round(kids.width / PUPPET_ASPECT)
    kids.style.height = `${kids.width / Math.min(devicePixelRatio, 2) / PUPPET_ASPECT}px`
  }

  // ── 蠟筆線：一小段一小段往下蓋點 ──
  const inkCtx = ink.getContext('2d')!
  const lineW = () => (railW < 90 ? 5 : 7)
  const xAt = (y: number) => crayonLineX(y) * railW
  const drawInk = (to: number) => {
    to = Math.min(to, trackH)
    if (to <= inkDrawnTo) return
    const g = inkCtx
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = lineW()
    for (let y = inkDrawnTo; y < to; y += 0.9) {
      const x = xAt(y)
      for (let k = 0; k < 5; k++) {
        const off = (rand(y, k) - 0.5) * w
        const r = 0.7 + rand(y, k + 9) * 1.1
        const a = 0.35 + rand(y, k + 17) * 0.5
        g.fillStyle = `rgb(${crayonRGB[0]} ${crayonRGB[1]} ${crayonRGB[2]} / ${a})`
        g.fillRect(x + off - r, y - r, r * 2, r * 2)
      }
    }
    // 年份刻度：線頭經過時，在線的左側點一小橫
    g.fillStyle = muted
    for (const m of marks) if (m.y >= inkDrawnTo && m.y < to) g.fillRect(xAt(m.y) - w - 9, m.y - 1, 8, 2)
    inkDrawnTo = to
  }

  // ── 主迴圈 ──
  let raf = 0, visible = false, lastScroll = scrollY, phase = 0, stride = 0, lastYear = -1, lastT = performance.now()
  const headAt = () => Math.max(0, Math.min(trackH - 20, scrollY + innerHeight * 0.58 - trackTop))
  const renderCard = (c: CardState, now: number) => {
    if (!gl || !c.tex || c.done) return
    const t = c.started < 0 ? 0 : (now - c.started) / 1000
    const draw = opts.reduce ? 1 : easeInOut((t - 0.35) / 1.0)
    const wash = opts.reduce ? 1 : easeOut((t - 0.75) / 1.2)
    gl.drawCard(c.tex, c.canvas, draw, wash)
    if (draw >= 1 && wash >= 1) c.done = true
  }
  const frame = (now: number) => {
    raf = 0
    const dt = Math.min(0.1, (now - lastT) / 1000)
    lastT = now
    const head = headAt()
    const dy = scrollY - lastScroll
    lastScroll = scrollY
    maxHead = Math.max(maxHead, head)
    drawInk(maxHead)
    // 紙偶：捲動時走路，停下來就站好
    const speed = Math.min(1, Math.abs(dy) / 24)
    stride += (speed - stride) * Math.min(1, dt * 8)
    phase += Math.abs(dy) * 0.045
    const kw = kids.width / Math.min(devicePixelRatio, 2), kh = kw / PUPPET_ASPECT
    // 窄螢幕軌道放不下：紙偶翻到背面（鏡像）站在線的左邊，蠟筆尖一樣對著線頭
    const mirror = railW < 90
    const x = xAt(head) - (mirror ? 1 - PUPPET_TIP[0] : PUPPET_TIP[0]) * kw, y = head - PUPPET_TIP[1] * kh
    kids.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${mirror ? ' scaleX(-1)' : ''}`
    puppet.draw(kids, { phase, stride })
    // 年份
    const yr = Math.floor(yearAtOffset(head, marks) + 1e-6)
    if (yr !== lastYear) { lastYear = yr; opts.onYear(yr) }
    // 卡片立起
    let busy = stride > 0.01
    for (const c of cards) {
      if (c.started < 0 && maxHead >= c.triggerY) {
        c.started = now
        c.el.querySelector<HTMLElement>('.anni-card')!.dataset.state = 'pop'
      }
      if (c.started >= 0 && !c.done) { renderCard(c, now); busy = true }
    }
    // 校徽
    if (crest && crestStart < 0 && maxHead >= crestTrigger) crestStart = now
    if (crest && gl && crestStart >= 0 && !crestDone) {
      const t = (now - crestStart) / 2200
      gl.drawCrest(crest, crestCanvas, Math.min(1.1, t * 1.1))
      if (t >= 1) crestDone = true
      busy = true
    }
    if (visible && (busy || dy !== 0)) raf = requestAnimationFrame(frame)
  }
  const kick = () => { if (!raf && visible) { lastT = performance.now(); raf = requestAnimationFrame(frame) } }

  measure()
  if (opts.reduce) {
    // 減少動態：直接是畫完的樣子
    maxHead = trackH
    drawInk(trackH)
    for (const c of cards) { c.started = 0; c.el.querySelector<HTMLElement>('.anni-card')!.dataset.state = 'up'; renderCard(c, 0) }
    if (crest && gl) { gl.drawCrest(crest, crestCanvas, 1.1); crestDone = true }
    kids.style.display = 'none'
    // 不跑動畫，但年份照樣跟著捲動位置換
    let lastY = -1
    const onScrollStill = () => { const yr = Math.floor(yearAtOffset(headAt(), marks) + 1e-6); if (yr !== lastY) { lastY = yr; opts.onYear(yr) } }
    onScrollStill()
    addEventListener('scroll', onScrollStill, { passive: true })
    const ro = new ResizeObserver(() => { measure(); drawInk(trackH); for (const c of cards) renderCard(c, 0); if (crest && gl) gl.drawCrest(crest, crestCanvas, 1.1); onScrollStill() })
    ro.observe(track)
    return () => { ro.disconnect(); removeEventListener('scroll', onScrollStill); gl?.destroy() }
  }

  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick() }, { rootMargin: '200px 0px' })
  io.observe(track)
  const onScroll = () => kick()
  addEventListener('scroll', onScroll, { passive: true })
  let rz = 0
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rz)
    rz = requestAnimationFrame(() => { measure(); drawInk(maxHead); for (const c of cards) if (c.started >= 0) { c.done = false; renderCard(c, performance.now()) } crestDone = false; kick() })
  })
  ro.observe(track)
  kick()
  return () => {
    io.disconnect(); ro.disconnect()
    removeEventListener('scroll', onScroll)
    cancelAnimationFrame(raf); cancelAnimationFrame(rz)
    gl?.destroy()
  }
}
