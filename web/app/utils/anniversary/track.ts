// 30 週年分頁的時間軸：往下捲，蠟筆線跟著畫、紙偶在線頭走路、走到成立那一年卡片立起來；
// 時間軸畫完，線接進結尾舞台畫出「30」，孩子跳進 0 的中間，校徽印上去。
// 線畫過就留著（往回捲不會擦掉），跟真的用蠟筆畫一樣。
import { ANNI_MEDIA } from './media'
import { crayonLineX, yearAtOffset, type YearMark } from './timeline'
import { PaperGL, cssColorRGB, loadImage, type CardTextures, type CrestTextures } from './paperGL'
import { createPuppet, PUPPET_ASPECT, PUPPET_TIP, type Puppet } from './puppet'
import { ZERO, buildFinalePath, finaleLayout, finalePhase, pointAt, type FinalePath } from './finale'

interface TrackOptions {
  reduce: boolean
  /** 線頭走到的年份（整數，換年時才呼叫） */
  onYear: (year: number) => void
  /** 線頭走到的年份（帶小數，有變就呼叫；地圖用） */
  onProgress?: (year: number) => void
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

/** 蠟筆點：沿著法線 (nx, ny) 在 (x, y) 兩側撒幾顆不透明度不一的小方點 */
function stamp(g: CanvasRenderingContext2D, rgb: number[], x: number, y: number, w: number, seed: number, nx = 1, ny = 0) {
  const n = Math.max(5, Math.round(w * 0.8))
  for (let k = 0; k < n; k++) {
    const off = (rand(seed, k) - 0.5) * w
    const r = 0.7 + rand(seed, k + 9) * 1.1
    const a = 0.35 + rand(seed, k + 17) * 0.5
    g.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${a})`
    g.fillRect(x + off * nx - r, y + off * ny - r, r * 2, r * 2)
  }
}

export async function mountTrack(track: HTMLElement, opts: TrackOptions): Promise<() => void> {
  const root = track.closest('.anni') as HTMLElement
  const rail = track.querySelector<HTMLElement>('.anni-rail')!
  const ink = track.querySelector<HTMLCanvasElement>('.anni-ink')!
  const kids = track.querySelector<HTMLCanvasElement>('.anni-kids')!
  const finale = root.querySelector<HTMLElement>('.anni-finale')!
  const fBox = finale.querySelector<HTMLElement>('.anni-finale-box')!
  const fInk = finale.querySelector<HTMLCanvasElement>('.anni-finale-ink')!
  const fKids = finale.querySelector<HTMLCanvasElement>('.anni-finale-kids')!
  const crestCanvas = finale.querySelector<HTMLCanvasElement>('.anni-crest-canvas')!
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
  let crestStart = -1, crestDone = false

  // ── 素材 ──
  const [body, border] = await Promise.all([loadImage(ANNI_MEDIA.kidsBody), loadImage(ANNI_MEDIA.kidsBorder)])
  const puppet: Puppet = createPuppet(body, border, crayon, paperCss)
  // 卡片與校徽的貼圖（五校線稿＋上色＋田野、校徽投影，桌機合計約 3 MB）等線頭快走到才載：
  // 軌道一進到視窗附近就會掛載，一次全抓會跟頁面上其他圖片搶頻寬（2026-10-05 效能盤點）。
  // 載不到（或沒有 WebGL）的卡片與校徽改用靜態圖。
  let disposed = false
  const cardFallback = (c: CardState) => c.el.querySelector('.anni-card')!.classList.add('is-fallback')
  const paperReady = gl ? gl.loadPaper(ANNI_MEDIA.paper).then(() => true, (e) => { console.error(e); return false }) : Promise.resolve(false)
  const cardLoads = new Map<CardState, Promise<void>>()
  const loadCard = (c: CardState) => {
    let pending = cardLoads.get(c)
    if (!pending) {
      pending = paperReady.then(async (ok) => {
        if (!ok || !gl) throw new Error('紙張貼圖沒有載入')
        const tex = await gl.loadCard(`/assets/campus-line-art-${c.key}.webp`, `/assets/campus-line-art-${c.key}-colour.webp`, ANNI_MEDIA.fields[c.key as keyof typeof ANNI_MEDIA.fields])
        if (disposed) return
        c.tex = tex
        // 捲太快、卡片已經立起來才載到：線稿從頭畫
        if (c.started >= 0) c.started = performance.now()
        kick()
      }).catch((e) => { console.error(e); cardFallback(c) })
      cardLoads.set(c, pending)
    }
    return pending
  }
  let crestLoad: Promise<void> | null = null, crestFailed = false
  const loadCrest = () => crestLoad ??= paperReady.then(async (ok) => {
    if (!ok || !gl) throw new Error('紙張貼圖沒有載入')
    const tex = await gl.loadCrest('/assets/ivy-30th-anniversary-projection.webp', ANNI_MEDIA.crestFields)
    if (disposed) return
    crest = tex
    kick()
  }).catch((e) => { console.error(e); crestFailed = true; finale.classList.add('is-fallback') })
  if (!gl) {
    for (const c of cards) cardFallback(c)
    finale.classList.add('is-fallback')
  }
  // 結尾舞台：會動的時候釘住，捲動距離拿來畫 30；減少動態就直接是畫好的樣子
  finale.classList.add('is-live', opts.reduce ? 'is-still' : 'is-pinned')

  // ── 尺寸 ──
  let marks: YearMark[] = []
  let trackTop = 0, trackH = 0, railW = 0, dpr = 1, inkDrawnTo = 0, maxHead = 0
  let finaleTop = 0, finaleH = 0, fDpr = 1, fDrawn = 0, fMax = 0
  let lay = { k: 1, ox: 0, oy: 0 }
  let fp: FinalePath = buildFinalePath([-60, 60])
  const scaleDpr = () => Math.min(devicePixelRatio || 1, 2)
  const sizeKids = (canvas: HTMLCanvasElement, cssW: number) => {
    canvas.style.width = `${cssW}px`
    canvas.width = Math.round(cssW * scaleDpr())
    canvas.height = Math.round(canvas.width / PUPPET_ASPECT)
    canvas.style.height = `${cssW / PUPPET_ASPECT}px`
  }
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
      const w = Math.round(c.canvas.offsetWidth * scaleDpr()), h = Math.round(c.canvas.offsetHeight * scaleDpr())
      if (w && h && (c.canvas.width !== w || c.canvas.height !== h)) { c.canvas.width = w; c.canvas.height = h; c.done = false }
    }
    // 蠟筆線畫布：整條時間軸高；太高時降低解析度（iOS 單一 canvas 有面積上限）
    dpr = Math.min(devicePixelRatio || 1, 2, 12000 / Math.max(1, trackH))
    ink.style.height = `${trackH}px`
    ink.width = Math.max(1, Math.round(railW * dpr))
    ink.height = Math.max(1, Math.round(trackH * dpr))
    inkDrawnTo = 0
    const kw = railW < 90 ? 62 : 132
    sizeKids(kids, kw)
    // 結尾：字形放在舞台中間，入口接在軌道末端的線頭（兩邊都是 .container，左緣對齊）
    const fr = finale.getBoundingClientRect()
    finaleTop = fr.top + scrollY
    finaleH = finale.offsetHeight
    const boxW = fBox.clientWidth, boxH = fBox.clientHeight
    lay = finaleLayout(boxW, boxH)
    fp = buildFinalePath([(xAt(trackH) - lay.ox) / lay.k, lay.oy / lay.k])
    fDpr = scaleDpr()
    fInk.width = Math.max(1, Math.round(boxW * fDpr)); fInk.height = Math.max(1, Math.round(boxH * fDpr))
    fDrawn = 0
    const cx = lay.ox + ZERO.cx * lay.k, cy = lay.oy - ZERO.cy * lay.k
    const d = Math.min(ZERO.rx, ZERO.ry) * 2 * lay.k * 0.94
    fBox.style.setProperty('--crest-x', `${cx.toFixed(1)}px`)
    fBox.style.setProperty('--crest-y', `${cy.toFixed(1)}px`)
    fBox.style.setProperty('--crest-d', `${d.toFixed(1)}px`)
    fBox.style.setProperty('--cap-y', `${(lay.oy + 41.5 * lay.k + Math.max(28, lay.k * 6)).toFixed(1)}px`)
    const cw = Math.round(d * scaleDpr())
    if (cw && crestCanvas.width !== cw) { crestCanvas.width = crestCanvas.height = cw; crestDone = false }
    sizeKids(fKids, Math.round(Math.max(kw, Math.min(150, lay.k * 19))))
  }

  // ── 時間軸的蠟筆線：一小段一小段往下蓋點 ──
  const inkCtx = ink.getContext('2d')!
  const lineW = () => (railW < 90 ? 5 : 7)
  function xAt(y: number) { return crayonLineX(y) * railW }
  const drawInk = (to: number) => {
    to = Math.min(to, trackH)
    if (to <= inkDrawnTo) return
    const g = inkCtx
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = lineW()
    for (let y = inkDrawnTo; y < to; y += 0.9) stamp(g, crayonRGB, xAt(y), y, w, y)
    // 年份刻度：線頭經過時，在線的左側點一小橫
    g.fillStyle = muted
    for (const m of marks) if (m.y >= inkDrawnTo && m.y < to) g.fillRect(xAt(m.y) - w - 9, m.y - 1, 8, 2)
    inkDrawnTo = to
  }

  // ── 結尾的 30：沿著路徑蓋點，畫進 3 之後線變粗（孩子越畫越用力） ──
  const fCtx = fInk.getContext('2d')!
  const toStage = (x: number, y: number): [number, number] => [lay.ox + x * lay.k, lay.oy - y * lay.k]
  const drawFinale = (to: number) => {
    if (to <= fDrawn) return
    const g = fCtx
    g.setTransform(fDpr, 0, 0, fDpr, 0, 0)
    const w0 = lineW()
    const step = 0.9 / lay.k
    const lead = fp.marks.threeEnd * 0.25
    const { threeEnd, zeroStart } = fp.marks
    for (let d = fDrawn * fp.total; d < to * fp.total; d += step) {
      const s = d / fp.total
      const p = pointAt(fp, s)
      const [x, y] = toStage(p.x, p.y)
      // 3 畫完到 0 開始：蠟筆提起來，孩子跳過去
      if (s > threeEnd && s < zeroStart) continue
      const w = w0 * (1 + 0.75 * easeInOut(s / lead))
      stamp(g, crayonRGB, x, y, w, d * 7.31, Math.sin(p.angle), Math.cos(p.angle))
    }
    fDrawn = to
  }

  // ── 主迴圈 ──
  let raf = 0, visible = false, finaleVisible = false, lastScroll = scrollY, phase = 0, stride = 0, lastYear = -1, lastProg = -1, lastT = performance.now()
  let mirror = false, fPhase = 0
  const headAt = () => Math.max(0, Math.min(trackH, scrollY + innerHeight * 0.58 - trackTop))
  const finaleU = () => {
    if (opts.reduce) return 1
    const hf = scrollY + innerHeight * 0.58 - finaleTop
    return Math.max(0, hf / Math.max(1, finaleH - innerHeight * 0.57))
  }
  const renderCard = (c: CardState, now: number) => {
    if (!gl || !c.tex || c.done) return
    const t = c.started < 0 ? 0 : (now - c.started) / 1000
    const draw = opts.reduce ? 1 : easeInOut((t - 0.35) / 1.0)
    const wash = opts.reduce ? 1 : easeOut((t - 0.75) / 1.2)
    gl.drawCard(c.tex, c.canvas, draw, wash)
    if (draw >= 1 && wash >= 1) c.done = true
  }
  /** 把紙偶畫布上的 anchor 點（0–1）放到 (x, y)；預設 anchor 是蠟筆尖 */
  const placeKids = (canvas: HTMLCanvasElement, x: number, y: number, flip: boolean, scale = 1, alpha = 1, anchor: readonly [number, number] = PUPPET_TIP) => {
    const kw = canvas.width / scaleDpr(), kh = kw / PUPPET_ASPECT
    const ax = flip ? 1 - anchor[0] : anchor[0]
    // transform-origin 是畫布中心：縮放後 anchor 會往中心靠，先補回去
    const tx = x - kw / 2 - (ax - 0.5) * kw * scale, ty = y - kh / 2 - (anchor[1] - 0.5) * kh * scale
    canvas.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)${flip ? ' scaleX(-1)' : ''}${scale !== 1 ? ` scale(${scale.toFixed(3)})` : ''}`
    canvas.style.opacity = alpha >= 0.999 ? '' : alpha.toFixed(3)
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
    // 窄螢幕軌道放不下：紙偶翻到背面（鏡像）站在線的左邊，蠟筆尖一樣對著線頭
    placeKids(kids, xAt(head), head, railW < 90)
    puppet.draw(kids, { phase, stride })
    // 年份（整數給計數器，小數給地圖）
    const yf = yearAtOffset(head, marks)
    const yr = Math.floor(yf + 1e-6)
    if (yr !== lastYear) { lastYear = yr; opts.onYear(yr) }
    if (opts.onProgress && Math.abs(yf - lastProg) > 1e-4) { lastProg = yf; opts.onProgress(yf) }
    // 卡片立起
    let busy = stride > 0.01
    for (const c of cards) {
      if (c.started < 0 && maxHead >= c.triggerY) {
        c.started = now
        c.el.querySelector<HTMLElement>('.anni-card')!.dataset.state = 'pop'
      }
      if (c.started >= 0 && !c.done) { renderCard(c, now); busy = true }
    }
    // 結尾：線接進來畫 30，畫完孩子跳進 0，校徽印上去
    const u = finaleU()
    const fz = finalePhase(u)
    kids.style.visibility = u > 0 ? 'hidden' : ''
    fKids.style.visibility = u > 0 ? 'visible' : 'hidden'
    if (u > 0) {
      fMax = Math.max(fMax, fz.s)
      drawFinale(fMax)
      fPhase += Math.abs(dy) * 0.045
      if (fz.jump > 0) {
        // 從 0 的收筆處拋物線跳到 0 的中間，邊跳邊縮小，校徽印出來時淡掉
        const e = pointAt(fp, 1)
        const j = easeInOut(fz.jump)
        const x = e.x + (ZERO.cx - e.x) * j, y = e.y + (ZERO.cy - e.y) * j + Math.sin(Math.PI * j) * 20
        const [sx, sy] = toStage(x, y)
        const anchor = [PUPPET_TIP[0] + (0.5 - PUPPET_TIP[0]) * j, PUPPET_TIP[1] + (0.5 - PUPPET_TIP[1]) * j] as const
        const fade = crestStart < 0 ? 1 : 1 - Math.min(1, (now - crestStart) / 700)
        placeKids(fKids, sx, sy, false, 1 - 0.35 * j, fade, anchor)
        puppet.draw(fKids, { phase: fPhase, stride: 0 })
        if (fade > 0 && crestStart >= 0) busy = true
      } else {
        const p = pointAt(fp, fz.s)
        const cos = Math.cos(p.angle)
        if (cos < -0.3) mirror = true; else if (cos > 0.3) mirror = false
        const [sx, sy] = toStage(p.x, p.y)
        const hopping = fz.s > fp.marks.threeEnd && fz.s < fp.marks.zeroStart
        placeKids(fKids, sx, sy, mirror)
        puppet.draw(fKids, { phase: fPhase, stride: hopping ? 0 : stride })
      }
    }
    // 校徽貼圖還在載就先不印，載到時 loadCrest 會 kick() 回來
    if (fz.print && crestStart < 0 && (crest || crestFailed || !gl)) crestStart = now
    if (crestStart >= 0 && !crestDone) {
      const t = (now - crestStart) / 2200
      if (crest && gl) gl.drawCrest(crest, crestCanvas, Math.min(1.1, t * 1.1))
      if (t >= 1) { crestDone = true; finale.classList.add('is-done') }
      busy = true
    }
    if ((visible || finaleVisible) && (busy || dy !== 0)) raf = requestAnimationFrame(frame)
  }
  const kick = () => { if (!raf && (visible || finaleVisible)) { lastT = performance.now(); raf = requestAnimationFrame(frame) } }
  // 線頭距卡片 1.5 個視窗高就開始載那張卡；結尾舞台的頂端進到視窗下方 2.5 個視窗高內才載校徽
  const prefetch = () => {
    if (!gl) return
    const head = headAt()
    for (const c of cards) if (head + innerHeight * 1.5 >= c.triggerY) void loadCard(c)
    if (scrollY + innerHeight * 3.5 >= finaleTop) void loadCrest()
  }

  measure()
  if (opts.reduce) {
    // 減少動態：直接是畫完的樣子，貼圖全部載完再畫
    if (gl) await Promise.all([...cards.map(loadCard), loadCrest()])
    const still = () => {
      maxHead = trackH
      drawInk(trackH)
      for (const c of cards) { c.started = 0; c.el.querySelector<HTMLElement>('.anni-card')!.dataset.state = 'up'; c.done = false; renderCard(c, 0) }
      drawFinale(1)
      if (crest && gl) gl.drawCrest(crest, crestCanvas, 1.1)
      crestDone = true
      finale.classList.add('is-done')
    }
    still()
    kids.style.display = 'none'
    fKids.style.display = 'none'
    // 不跑動畫，但年份與地圖照樣跟著捲動位置換
    let lastY = -1
    const onScrollStill = () => {
      const yf = yearAtOffset(headAt(), marks)
      const yr = Math.floor(yf + 1e-6)
      if (yr !== lastY) { lastY = yr; opts.onYear(yr) }
      opts.onProgress?.(yf)
    }
    onScrollStill()
    addEventListener('scroll', onScrollStill, { passive: true })
    const ro = new ResizeObserver(() => { measure(); still(); onScrollStill() })
    ro.observe(track); ro.observe(finale)
    return () => { disposed = true; ro.disconnect(); removeEventListener('scroll', onScrollStill); gl?.destroy() }
  }

  const io = new IntersectionObserver((es) => {
    for (const e of es) { if (e.target === track) visible = e.isIntersecting; else finaleVisible = e.isIntersecting }
    kick()
  }, { rootMargin: '200px 0px' })
  io.observe(track); io.observe(finale)
  const onScroll = () => { prefetch(); kick() }
  addEventListener('scroll', onScroll, { passive: true })
  let rz = 0
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rz)
    rz = requestAnimationFrame(() => {
      measure(); drawInk(maxHead); drawFinale(fMax); prefetch()
      for (const c of cards) if (c.started >= 0) { c.done = false; renderCard(c, performance.now()) }
      if (crestStart >= 0) crestDone = false
      kick()
    })
  })
  ro.observe(track); ro.observe(finale)
  prefetch()
  kick()
  return () => {
    disposed = true
    io.disconnect(); ro.disconnect()
    removeEventListener('scroll', onScroll)
    cancelAnimationFrame(raf); cancelAnimationFrame(rz)
    gl?.destroy()
  }
}
