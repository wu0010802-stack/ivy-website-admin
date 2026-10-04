// 30 週年分頁「孩子的作品拼成的 30」：用品牌標題字把「30」畫進離屏 canvas 當遮罩，
// 切成方格，每一格放 8 件作品之一的局部。進到畫面時一格一格飛回來拼好；
// 滑過下方的作品縮圖，30 裡屬於那件作品的格子會亮起來。
import { ANNI_ARTWORKS, mosaicCells, type MosaicCell } from './gallery'
import { responsiveImage } from '~/utils/responsive-image'
import { loadImage } from './paperGL'

interface MosaicOptions {
  reduce: boolean
  onHover: (art: number) => void
  onPick: (art: number) => void
  active: () => number
}

/** 從 srcset 挑最接近目標寬度的檔案 */
function pickSrc(name: string, want: number) {
  const r = responsiveImage(name)
  const c = (r.srcset ?? '').split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p.length === 2).map(([u, w]) => ({ u: u!, w: parseInt(w!, 10) }))
  if (!c.length) return r.src
  c.sort((a, b) => Math.abs(a.w - want) - Math.abs(b.w - want))
  return c[0]!.u
}

const easeOutBack = (t: number) => { const u = t - 1, s = 1.4; return 1 + (s + 1) * u * u * u + s * u * u }

export async function mountMosaic(canvas: HTMLCanvasElement, opts: MosaicOptions): Promise<() => void> {
  const box = canvas.parentElement!
  const style = getComputedStyle(canvas)
  const font = style.getPropertyValue('--font-head').trim() || 'sans-serif'
  await document.fonts.load(`800 200px ${font}`, '30').catch(() => {})
  const imgs = await Promise.all(ANNI_ARTWORKS.map((a) => loadImage(pickSrc(a.image, 480)).catch(() => null)))

  let cells: MosaicCell[] = []
  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0
  const layout = () => {
    dpr = Math.min(devicePixelRatio || 1, 2)
    W = box.clientWidth; H = box.clientHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    // 字形遮罩：離屏畫「30」，取每一點的透明度
    const mw = 400, mh = Math.round(mw * H / W)
    const m = document.createElement('canvas')
    m.width = mw; m.height = mh
    const g = m.getContext('2d', { willReadFrequently: true })!
    g.fillStyle = '#000'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    let size = mh * 1.08
    g.font = `800 ${size}px ${font}`
    const tw = g.measureText('30').width
    if (tw > mw * 0.96) { size *= (mw * 0.96) / tw; g.font = `800 ${size}px ${font}` }
    g.fillText('30', mw / 2, mh * 0.53)
    const d = g.getImageData(0, 0, mw, mh).data
    const mask = (x: number, y: number) => d[(Math.min(mh - 1, Math.floor(y * mh)) * mw + Math.min(mw - 1, Math.floor(x * mw))) * 4 + 3]! / 255
    cols = W < 420 ? 18 : 24
    rows = Math.round(cols * H / W)
    cells = mosaicCells(mask, cols, rows)
  }

  let start = -1, raf = 0, hover = -1, lastActive = -2, visible = false
  const draw = (now: number) => {
    raf = 0
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const cw = W / cols, ch = H / rows, gap = Math.max(1.5, cw * 0.07)
    const active = opts.active()
    const t = start < 0 ? 0 : (now - start) / 1000
    let animating = false
    for (const c of cells) {
      const img = imgs[c.art]
      const local = opts.reduce ? 1 : Math.min(1, Math.max(0, (t - c.order * 1.3) / 0.7))
      if (local < 1) animating = true
      if (local <= 0) continue
      const e = easeOutBack(local)
      const fly = 1 - e
      const sx = (c.x - 0.5) * 0.6 + (c.cx - 0.5) * 2, sy = 0.7 + (c.cy - 0.5)
      const x = (c.x + sx * fly) * W, y = (c.y + sy * fly) * H
      const rot = (c.cx - 0.5) * 1.6 * fly
      g.save()
      g.globalAlpha = Math.min(1, local * 2.5) * (active >= 0 && active !== c.art ? 0.28 : 1)
      g.translate(x + cw / 2, y + ch / 2)
      g.rotate(rot)
      const s = cw - gap
      if (img) {
        const iw = img.naturalWidth, ih = img.naturalHeight, side = Math.min(iw, ih) * 0.32
        g.drawImage(img, c.cx * (iw - side), c.cy * (ih - side), side, side, -s / 2, -(ch - gap) / 2, s, ch - gap)
      }
      if (active === c.art) { g.lineWidth = 2; g.strokeStyle = style.getPropertyValue('--gold').trim() || 'currentColor'; g.strokeRect(-s / 2, -(ch - gap) / 2, s, ch - gap) }
      g.restore()
    }
    lastActive = active
    if (visible && (animating || opts.active() !== lastActive)) raf = requestAnimationFrame(draw)
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw) }

  const cellAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    const i = Math.floor(x * cols), j = Math.floor(y * rows)
    return cells.find((c) => Math.abs(c.x * cols - i) < 0.5 && Math.abs(c.y * rows - j) < 0.5)
  }
  const onMove = (e: PointerEvent) => {
    const c = cellAt(e)
    const art = c ? c.art : -1
    if (art !== hover) { hover = art; opts.onHover(art); canvas.style.cursor = art >= 0 ? 'pointer' : ''; kick() }
  }
  const onLeave = () => { if (hover !== -1) { hover = -1; opts.onHover(-1); kick() } }
  const onClick = (e: PointerEvent) => { const c = cellAt(e); if (c) opts.onPick(c.art) }

  layout()
  const io = new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting)
    if (visible && start < 0) start = performance.now()
    if (visible) kick()
  }, { threshold: 0.25 })
  io.observe(canvas)
  // 外面（縮圖）換了亮起的作品也要重畫
  const poll = setInterval(() => { if (visible && opts.active() !== lastActive) kick() }, 120)
  const ro = new ResizeObserver(() => { layout(); kick() })
  ro.observe(box)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('click', onClick as EventListener)
  return () => {
    io.disconnect(); ro.disconnect(); clearInterval(poll)
    cancelAnimationFrame(raf)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerleave', onLeave)
    canvas.removeEventListener('click', onClick as EventListener)
  }
}
