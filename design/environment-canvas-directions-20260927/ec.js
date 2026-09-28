// 共用互動：比稿切換、保育清單＋大照片、進場、日弧（08:30–15:30）的捲動進度。
// 各方向的 canvas 引擎註冊在 window.ECArt[a|b|c]，回傳 { drawDay, onCare, onReveal, onLayout }。
;(() => {
  const root = document.documentElement
  root.classList.add('js')
  const art = root.dataset.art
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const DPR = Math.min(2, window.devicePixelRatio || 1)
  const MEDIA = '../environment-mockup-20260925/media/'

  const EC = (window.EC = { art, reduce, DPR, MEDIA })
  EC.noise = (t, s = 0) => Math.sin(t * 1.31 + s) * 0.5 + Math.sin(t * 0.73 + s * 2.1) * 0.33 + Math.sin(t * 2.29 + s * 0.7) * 0.17
  EC.rand = seed => {
    let x = seed >>> 0 || 1
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296)
  }
  EC.fit = (canvas, w, h, scale = DPR) => {
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    return ctx
  }
  // 日弧：x 從 7% 到 93%，中午最高
  EC.arc = t => ({ x: 0.07 + 0.86 * t, y: 0.64 - 0.5 * Math.sin(Math.PI * t) })
  // 沿折線取長度 l 處的點與切線角
  EC.pointAt = (pts, l) => {
    let i = 1
    while (i < pts.length - 1 && pts[i].l < l) i++
    const a = pts[i - 1], b = pts[i]
    const u = b.l > a.l ? Math.min(1, Math.max(0, (l - a.l) / (b.l - a.l))) : 0
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, ang: Math.atan2(b.y - a.y, b.x - a.x), i }
  }
  EC.measure = pts => {
    let L = 0
    pts[0].l = 0
    for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].l = L }
    return L
  }

  document.querySelectorAll('.ec-switch a').forEach(a => { if (a.dataset.art === art) a.setAttribute('aria-current', 'page') })

  const engine = (window.ECArt && window.ECArt[art] && window.ECArt[art](EC)) || {}

  // ---------- 保育：清單＋照片舞台 ----------
  const items = [...document.querySelectorAll('.ec-care-item')]
  const photo = document.querySelector('.ec-care-photo')
  const cap = document.querySelector('.ec-care-view figcaption')
  let current = 0
  function select (i) {
    if (i === current) return
    current = i
    items.forEach((it, j) => {
      it.classList.toggle('is-on', i === j)
      it.querySelector('button').setAttribute('aria-pressed', String(i === j))
    })
    const it = items[i]
    const img = new Image(1200, 571)
    img.src = MEDIA + it.dataset.img + '.webp'
    img.alt = it.dataset.alt
    img.style.objectPosition = it.dataset.pos
    img.style.opacity = '0'
    photo.appendChild(img)
    const olds = [...photo.querySelectorAll('img')].filter(o => o !== img)
    const show = () => requestAnimationFrame(() => {
      if (!img.isConnected) return
      img.style.opacity = '1'
      olds.forEach(o => setTimeout(() => o.remove(), 750))
    })
    ;(img.decode ? img.decode() : Promise.resolve()).then(show, show)
    cap.innerHTML = `<span class="ec-num" lang="en">${String(i + 1).padStart(2, '0')}</span>${it.querySelector('b').textContent}`
    engine.onCare && engine.onCare(i, photo)
  }
  const canHover = matchMedia('(hover: hover) and (min-width: 761px)')
  items.forEach((it, i) => {
    const b = it.querySelector('button')
    b.addEventListener('click', () => select(i))
    b.addEventListener('focus', () => select(i))
    b.addEventListener('pointerenter', () => { if (canHover.matches) select(i) })
  })

  // ---------- 進場 ----------
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return
    e.target.classList.add('is-in')
    io.unobserve(e.target)
    engine.onReveal && engine.onReveal(e.target)
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.01 })
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el))

  // ---------- 日弧 ----------
  const day = document.querySelector('.ec-day')
  const dayCanvas = day.querySelector('.ec-day-canvas')
  const stops = [...day.querySelectorAll('.ec-stop')]
  const mqV = matchMedia('(max-width: 760px)')
  let dayCtx
  let dayP = 0
  let dayDrawn = -1
  function layoutDay () {
    const vertical = mqV.matches
    stops.forEach(s => {
      if (vertical) { s.style.removeProperty('--x'); s.style.removeProperty('--y') } else {
        const p = EC.arc(+s.dataset.t)
        s.style.setProperty('--x', p.x.toFixed(4))
        s.style.setProperty('--y', p.y.toFixed(4))
      }
    })
    const r = day.getBoundingClientRect()
    const w = r.width, h = r.height
    const pts = []
    let stopT
    const N = 180
    // 日弧只畫 08:30 到 15:30，線不會穿過兩端的文字
    const t0 = +stops[0].dataset.t, t1 = +stops[stops.length - 1].dataset.t
    if (!vertical) {
      for (let i = 0; i <= N; i++) { const p = EC.arc(t0 + (t1 - t0) * i / N); pts.push({ x: p.x * w, y: p.y * h }) }
    } else {
      const dots = stops.map(s => { const d = s.querySelector('.ec-dot').getBoundingClientRect(); return { x: d.left + d.width / 2 - r.left, y: d.top + d.height / 2 - r.top } })
      const x0 = dots[0].x, bottom = dots[dots.length - 1].y + 36
      for (let i = 0; i <= N; i++) { const u = i / N; pts.push({ x: x0 + Math.sin(u * Math.PI * 5) * 2.5, y: -8 + (bottom + 8) * u }) }
      stopT = dots.map(d => (d.y + 8) / (bottom + 8))
    }
    const len = EC.measure(pts)
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
      q.ang = Math.atan2(b.y - a.y, b.x - a.x)
    })
    if (!vertical) stopT = stops.map(s => pts[Math.round((+s.dataset.t - t0) / (t1 - t0) * N)].l / len)
    EC.day = { w, h, pts, len, vertical, stopT, stops, el: day, pad: 80 }
    dayCtx = EC.fit(dayCanvas, w + 160, h + 160)
    dayCtx.translate(80, 80)
    dayDrawn = -1
  }
  function dayTarget () {
    if (reduce) return EC.day.stopT[EC.day.stopT.length - 1] + 0.004
    const r = day.getBoundingClientRect(), vh = innerHeight
    const end = EC.day.stopT[EC.day.stopT.length - 1] + 0.004
    return end * Math.min(1, Math.max(0, (vh * 0.86 - r.top) / (vh * 0.42 + r.height * 0.5)))
  }
  function frame (now) {
    const target = dayTarget()
    dayP += (target - dayP) * (reduce ? 1 : 0.09)
    if (Math.abs(target - dayP) < 0.0008) dayP = target
    if (Math.abs(dayP - dayDrawn) > 0.0005 || EC.dayDirty) {
      EC.dayDirty = false
      dayDrawn = dayP
      dayCtx.clearRect(-80, -80, EC.day.w + 160, EC.day.h + 160)
      engine.drawDay && engine.drawDay(dayCtx, EC.day, dayP, now)
      stops.forEach((s, i) => s.classList.toggle('is-lit', dayP >= EC.day.stopT[i] - 0.004))
    }
    requestAnimationFrame(frame)
  }

  // ---------- 版面變動：字型、圖片、視窗寬度 ----------
  let lastW = innerWidth
  let t
  function relayout (force) {
    clearTimeout(t)
    t = setTimeout(() => {
      const widthChanged = innerWidth !== lastW
      lastW = innerWidth
      layoutDay()
      engine.onLayout && engine.onLayout({ widthChanged: widthChanged || force === true })
    }, 120)
  }
  layoutDay()
  engine.onLayout && engine.onLayout({ widthChanged: true, first: true })
  requestAnimationFrame(frame)
  addEventListener('resize', relayout)
  new ResizeObserver(() => relayout()).observe(document.querySelector('main'))
  document.fonts && document.fonts.ready.then(() => relayout(true))
  addEventListener('load', () => relayout(true))
})()
