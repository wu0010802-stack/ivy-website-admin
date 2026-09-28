// 特色教學 水彩 mock-up 的引擎：宣告式，HTML 只標位置，這裡負責畫。
//   data-wash="顏料,fx,fy,frx,fry[,每層透明度,層數]|…"  在所屬段落的 canvas 上、以元素框為基準畫一團顏料
//   data-wash-mobile="…"                                 760px 以下改用這組（橫滑清單不能對位，改鋪一整片）
//   data-blot="顏料"                                      依元素大小生成一團顏料當背景圖（年齡、編號、引言）
//   .cw-frame                                             照片撕紙毛邊，進場時從中間暈開
// 顏料＝同一個基底多邊形反覆變形後，用很低的透明度疊幾十層（Tyler Hobbs 的水彩做法）。
// 減少動態：一次畫完、不暈開、不滴顏料。強制色彩：CSS 直接隱藏顏料層。
;(() => {
  const root = document.documentElement
  root.classList.add('js')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const DPR = Math.min(2, window.devicePixelRatio || 1)
  const mqM = matchMedia('(max-width: 760px)')
  const SCALE = Math.min(1, DPR * 0.5)
  // 與 cw.css 的 --paint-* 同色（mock 直接寫 RGB，正式版改讀 CSS 變數）
  const PIG = { sun: '246, 204, 98', mint: '128, 194, 160', sky: '134, 184, 222', orange: '236, 150, 90', leaf: '108, 162, 112' }
  const ORDER = ['mint', 'sky', 'sun', 'orange']

  const rand = seed => { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296) }
  const gauss = R => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  function blob (R, cx, cy, rx, ry, n = 12) {
    const out = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + (R() - 0.5) * 0.35
      out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
    }
    return out
  }
  function deform (R, pts, depth, v) {
    for (let d = 0; d < depth; d++) {
      const out = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        out.push(a, [(a[0] + b[0]) / 2 + gauss(R) * v * len * 0.5, (a[1] + b[1]) / 2 + gauss(R) * v * len * 0.5])
      }
      pts = out
    }
    return pts
  }
  function washPolys (R, cx, cy, rx, ry, layers) {
    const base = deform(R, blob(R, cx, cy, rx, ry), 2, 0.55)
    const out = []
    for (let i = 0; i < layers; i++) out.push(deform(R, base, 3, 0.32))
    return out
  }
  function fillPoly (c, p) {
    c.beginPath()
    c.moveTo(p[0][0], p[0][1])
    for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1])
    c.closePath()
  }
  function fit (canvas, w, h, scale) {
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    return ctx
  }
  // 元素相對段落的位置：用 offset 系列，不受進場 translateY 影響
  function layoutRect (el, anc) {
    let x = 0, y = 0, e = el
    while (e && e !== anc) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent }
    if (e !== anc) { const r = el.getBoundingClientRect(), a = anc.getBoundingClientRect(); return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height } }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight }
  }
  function inScroller (el, stop) {
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX
      if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 2) return true
    }
    return false
  }

  // ---------- 紙紋 ----------
  ;(() => {
    const S = 256, c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d'), R = rand(5)
    const img = x.createImageData(S, S)
    for (let i = 0; i < S * S; i++) {
      const v = 255 - Math.pow(R(), 5) * 46 - R() * 5
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 2; img.data[i * 4 + 3] = 255
    }
    x.putImageData(img, 0, 0)
    x.strokeStyle = 'rgba(120, 110, 90, .05)'
    for (let i = 0; i < 70; i++) {
      const px = R() * S, py = R() * S, a = R() * Math.PI
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14); x.stroke()
    }
    const g = document.createElement('div')
    g.className = 'cw-grain'
    g.setAttribute('aria-hidden', 'true')
    g.style.backgroundImage = `url(${c.toDataURL()})`
    document.body.appendChild(g)
  })()

  // ---------- 顏料團（背景圖） ----------
  function blotURL (seed, rgb, w, h) {
    const k = Math.min(1, 512 / Math.max(w, h)) * DPR
    const W = Math.max(16, Math.round(w * k)), H = Math.max(16, Math.round(h * k))
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const x = c.getContext('2d'), R = rand(seed)
    const polys = washPolys(R, W / 2, H / 2, W * 0.42, H * 0.38, 26)
    x.fillStyle = `rgba(${rgb}, .085)`
    x.strokeStyle = `rgba(${rgb}, .14)`
    polys.forEach((p, i) => { fillPoly(x, p); x.fill(); if (i % 5 === 0) x.stroke() })
    // 顆粒：顏料沉在紙紋裡的小點
    x.fillStyle = `rgba(${rgb}, .22)`
    for (let i = 0; i < W * H / 900; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.32
      x.fillRect(W / 2 + Math.cos(a) * d * W, H / 2 + Math.sin(a) * d * H, 1.2, 1.2)
    }
    return c.toDataURL()
  }
  function paintBlots () {
    document.querySelectorAll('[data-blot]').forEach((el, i) => {
      const w = el.offsetWidth, h = el.offsetHeight
      if (!w || !h) return
      const key = `${w}x${h}`
      if (el.dataset.blotKey === key) return
      el.dataset.blotKey = key
      el.style.backgroundImage = `url(${blotURL(60 + i * 7, PIG[el.dataset.blot] || PIG.sun, w, h)})`
      if (reduce) el.classList.add('is-painted')
    })
  }

  // ---------- 照片遮罩：撕紙毛邊＋暈開 ----------
  function deckle (w, h, seed) {
    const s = 0.5, W2 = Math.max(8, Math.round(w * s)), H2 = Math.max(8, Math.round(h * s))
    const c = document.createElement('canvas')
    c.width = W2; c.height = H2
    const x = c.getContext('2d'), R = rand(seed)
    const inset = 4, step = 14, per = []
    const edge = (x0, y0, x1, y1) => {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
      for (let i = 0; i < n; i++) per.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n])
    }
    edge(inset, inset, W2 - inset, inset); edge(W2 - inset, inset, W2 - inset, H2 - inset)
    edge(W2 - inset, H2 - inset, inset, H2 - inset); edge(inset, H2 - inset, inset, inset)
    let inn = per.map(() => R() * 5)
    for (let k = 0; k < 2; k++) inn = inn.map((v, i) => (v + inn[(i + 1) % inn.length] + inn[(i - 1 + inn.length) % inn.length]) / 3)
    const cx = W2 / 2, cy = H2 / 2
    const at = (i, extra) => {
      const [px, py] = per[i], dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy) || 1
      const m = inn[i] + extra
      return [px + dx / d * m, py + dy / d * m]
    }
    x.fillStyle = 'rgba(0,0,0,.16)'
    for (let k = 0; k < 8; k++) { fillPoly(x, per.map((_, i) => at(i, gauss(R) * 1.6 + k * 0.5))); x.fill() }
    x.fillStyle = '#000'
    fillPoly(x, per.map((_, i) => at(i, 5)))
    x.fill()
    return c.toDataURL()
  }
  const BLOOM = (() => {
    const S = 128, c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d'), R = rand(3)
    x.fillStyle = 'rgba(0,0,0,.13)'
    washPolys(R, S / 2, S / 2, S * 0.3, S * 0.28, 16).forEach(p => { fillPoly(x, p); x.fill() })
    x.fillStyle = '#000'
    x.beginPath(); x.arc(S / 2, S / 2, S * 0.17, 0, Math.PI * 2); x.fill()
    return c.toDataURL()
  })()
  function maskFrames () {
    document.querySelectorAll('.cw-frame').forEach((f, i) => {
      const w = f.offsetWidth, h = f.offsetHeight
      if (!w || !h) return
      const key = `${w}x${h}`
      if (f.dataset.maskKey === key) return
      f.dataset.maskKey = key
      const url = `url(${deckle(w, h, 100 + i)}), url(${BLOOM})`
      f.style.webkitMaskImage = url
      f.style.maskImage = url
      f.classList.add('has-mask')
      if (reduce) f.classList.add('is-bloomed')
    })
  }

  // ---------- 各段顏料：逐層畫，進畫面時看得到染開 ----------
  const jobs = []
  function pump () {
    const t0 = performance.now()
    let n = 0
    while (jobs.length && performance.now() - t0 < 7) {
      const j = jobs[n % jobs.length]
      const end = Math.min(j.polys.length, j.i + (reduce ? 999 : j.per))
      j.ctx.fillStyle = `rgba(${j.rgb}, ${j.a})`
      j.ctx.strokeStyle = `rgba(${j.rgb}, ${Math.min(0.06, j.a * 1.6)})`
      j.ctx.lineWidth = 1
      for (; j.i < end; j.i++) {
        fillPoly(j.ctx, j.polys[j.i]); j.ctx.fill()
        if (j.i % 4 === 0) j.ctx.stroke()
      }
      if (j.i >= j.polys.length) jobs.splice(jobs.indexOf(j), 1)
      n++
      if (!reduce && n >= jobs.length + 1) break
    }
    requestAnimationFrame(pump)
  }
  requestAnimationFrame(pump)

  const secs = [...document.querySelectorAll('.cw-hero, .cw-sec')]
  const painted = new Map()
  function specs (sec) {
    const out = []
    const mobile = mqM.matches
    sec.querySelectorAll('[data-wash],[data-wash-mobile]').forEach(el => {
      const def = mobile ? (el.dataset.washMobile ?? el.dataset.wash) : el.dataset.wash
      if (!def || !el.offsetWidth || inScroller(el, sec)) return
      const b = layoutRect(el, sec)
      def.split('|').forEach(d => {
        const [pig, fx, fy, frx, fry, a, layers] = d.split(',')
        out.push({ cx: b.x + b.w * +fx, cy: b.y + b.h * +fy, rx: Math.max(40, b.w * +frx), ry: Math.max(34, b.h * +fry), pig, a: +(a || 0.028), layers: +(layers || 36) })
      })
    })
    return out
  }
  function paint (sec, animate) {
    const cv = sec.querySelector(':scope > .cw-wash')
    if (!cv) return
    const w = sec.clientWidth, h = sec.clientHeight
    const ctx = fit(cv, w, h, SCALE)
    const R = rand((sec.id || 'hero').length * 131)
    specs(sec).forEach(s => {
      // 顏料不出段落，碰到上下緣就收半徑（免得被下一段或頁尾切一刀）
      const ry = Math.max(30, Math.min(s.ry, s.cy - 16, h - 16 - s.cy))
      jobs.push({ ctx, polys: washPolys(R, s.cx, s.cy, s.rx, ry, Math.round(s.layers * 1.3)), rgb: PIG[s.pig] || PIG.sun, a: s.a * 0.55, i: 0, per: animate ? 3 : 999 })
    })
    painted.set(sec, { w, h, ctx, mobile: mqM.matches })
  }
  const near = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !painted.has(e.target)) paint(e.target, true)
  }), { rootMargin: '200px 0px' })

  // ---------- 進場：照片暈開 ----------
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return
    e.target.classList.add('is-in')
    io.unobserve(e.target)
    if (reduce) return
    const frames = e.target.classList.contains('cw-frame') ? [e.target] : [...e.target.querySelectorAll('.cw-frame.has-mask')]
    frames.forEach((f, i) => setTimeout(() => requestAnimationFrame(() => f.classList.add('is-bloomed')), 120 + i * 140))
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.01 })

  // ---------- 首屏：滑鼠滴顏料 ----------
  const hero = document.querySelector('.cw-hero')
  let drops = 0, travel = 0, lx = 0, ly = 0
  hero.addEventListener('pointermove', e => {
    if (reduce || e.pointerType !== 'mouse' || drops >= 26) return
    travel += Math.hypot(e.clientX - lx, e.clientY - ly)
    lx = e.clientX; ly = e.clientY
    if (travel < 120) return
    travel = 0
    const p = painted.get(hero)
    if (!p) return
    const r = hero.getBoundingClientRect(), R = rand(900 + drops)
    const size = 16 + R() * 26
    jobs.push({ ctx: p.ctx, polys: washPolys(R, e.clientX - r.left, e.clientY - r.top, size, size * 0.85, 14), rgb: PIG[ORDER[drops % 4]], a: 0.04, i: 0, per: 1 })
    drops++
  }, { passive: true })

  // ---------- 版面變動 ----------
  function refresh (force) {
    maskFrames()
    paintBlots()
    secs.forEach(s => {
      const p = painted.get(s)
      if (!p) return
      if (force || p.mobile !== mqM.matches || Math.abs(s.clientWidth - p.w) > 2 || Math.abs(s.clientHeight - p.h) > 40) paint(s, false)
    })
  }
  maskFrames()
  paintBlots()
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el))
  secs.forEach(s => near.observe(s))
  let t
  const later = force => { clearTimeout(t); t = setTimeout(() => refresh(force), 150) }
  addEventListener('resize', () => later(false))
  new ResizeObserver(() => later(false)).observe(document.querySelector('main'))
  document.fonts && document.fonts.ready.then(() => later(true))
  addEventListener('load', () => later(true))
})()
