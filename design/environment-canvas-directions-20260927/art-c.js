// C 水彩：整頁是一張冷壓水彩紙。各段背後的顏料用「多邊形反覆變形＋低透明度疊幾十層」畫出來，
// 進到畫面時一層一層染開；照片的邊是撕紙般的毛邊，進場時從中間暈開。首屏用滑鼠滑過會滴下淡淡的顏料。
// 顏色只用品牌的薄荷、天藍、暖黃、橙四種顏料。減少動態時一次畫完、不暈開、不滴顏料。
;(window.ECArt = window.ECArt || {}).c = EC => {
  const { reduce, rand, DPR } = EC
  const PIG = { sun: '246, 204, 98', mint: '128, 194, 160', sky: '134, 184, 222', orange: '236, 150, 90', leaf: '108, 162, 112' }
  const ORDER = ['mint', 'sky', 'sun', 'orange']
  const SCALE = Math.min(1, DPR * 0.5)

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
  // 一團顏料＝同一個基底形狀，各自再變形幾十次
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

  // ---------- 紙紋 ----------
  function makeGrain () {
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
    return c.toDataURL()
  }
  const grain = document.createElement('div')
  grain.className = 'ec-grain'
  grain.setAttribute('aria-hidden', 'true')
  grain.style.backgroundImage = `url(${makeGrain()})`
  document.body.appendChild(grain)

  // ---------- 遮罩：毛邊與暈開 ----------
  function deckle (w, h, seed, rgb) {
    const s = 0.5, W2 = Math.max(8, Math.round(w * s)), H2 = Math.max(8, Math.round(h * s))
    const c = document.createElement('canvas')
    c.width = W2; c.height = H2
    const x = c.getContext('2d'), R = rand(seed)
    const inset = 4, step = 14
    const per = []
    const edge = (x0, y0, x1, y1) => {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
      for (let i = 0; i < n; i++) per.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n])
    }
    edge(inset, inset, W2 - inset, inset); edge(W2 - inset, inset, W2 - inset, H2 - inset)
    edge(W2 - inset, H2 - inset, inset, H2 - inset); edge(inset, H2 - inset, inset, inset)
    // 往內縮的量隨機、再和鄰點平均，像撕過的紙邊
    let inn = per.map(() => R() * 5)
    for (let k = 0; k < 2; k++) inn = inn.map((v, i) => (v + inn[(i + 1) % inn.length] + inn[(i - 1 + inn.length) % inn.length]) / 3)
    const cx = W2 / 2, cy = H2 / 2
    const at = (i, extra) => {
      const [px, py] = per[i], dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy) || 1
      const m = inn[i] + extra
      return [px + dx / d * m, py + dy / d * m]
    }
    x.fillStyle = rgb ? `rgba(${rgb}, .16)` : 'rgba(0,0,0,.16)'
    for (let k = 0; k < 8; k++) fillPoly(x, per.map((_, i) => at(i, gauss(R) * 1.6 + k * 0.5))), x.fill()
    x.fillStyle = rgb ? `rgba(${rgb}, 1)` : '#000'
    fillPoly(x, per.map((_, i) => at(i, 5)))
    x.fill()
    return c.toDataURL()
  }
  function blotURL (seed, rgb, S = 128) {
    const c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d'), R = rand(seed)
    const polys = washPolys(R, S / 2, S / 2, S * 0.3, S * 0.28, 16)
    x.fillStyle = `rgba(${rgb || '0,0,0'}, .13)`
    polys.forEach(p => { fillPoly(x, p); x.fill() })
    x.fillStyle = `rgba(${rgb || '0,0,0'}, ${rgb ? 0.35 : 1})`
    x.beginPath(); x.arc(S / 2, S / 2, S * 0.17, 0, Math.PI * 2); x.fill()
    return c.toDataURL()
  }
  const BLOT = blotURL(3)

  // 保育清單的編號底：一人一團顏料
  const careSw = ['sun', 'mint', 'orange', 'sky', 'leaf']
  document.querySelectorAll('.ec-care-item').forEach((it, i) => {
    it.style.setProperty('--swatch', `url(${blotURL(40 + i, PIG[careSw[i]], 96)})`)
    it.style.setProperty('--rot', `${(i * 67) % 360}deg`)
  })

  function maskFrames () {
    document.querySelectorAll('.ec-frame').forEach((f, i) => {
      if (f.classList.contains('ec-book-cover')) return
      const r = f.getBoundingClientRect()
      if (!r.width) return
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`
      if (f.dataset.maskKey === key) return
      f.dataset.maskKey = key
      const url = `url(${deckle(r.width, r.height, 100 + i)}), url(${BLOT})`
      f.style.webkitMaskImage = url
      f.style.maskImage = url
      f.classList.add('has-mask')
      if (reduce) f.classList.add('is-bloomed')
    })
  }
  function bloom (f, delay = 0) {
    if (reduce) return
    setTimeout(() => requestAnimationFrame(() => f.classList.add('is-bloomed')), delay)
  }

  // ---------- 各段顏料 ----------
  const hero = document.querySelector('.ec-hero')
  const heroCanvas = document.createElement('canvas')
  heroCanvas.className = 'ec-wash'
  heroCanvas.setAttribute('aria-hidden', 'true')
  hero.prepend(heroCanvas)

  const jobs = []
  function pump () {
    const t0 = performance.now()
    let n = 0
    while (jobs.length && performance.now() - t0 < 7) {
      const j = jobs[n % jobs.length]
      const end = Math.min(j.polys.length, j.i + (reduce ? 999 : j.per || 2))
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

  const painted = new Map()
  function specsFor (sec) {
    const sr = sec.getBoundingClientRect()
    const rel = el => { const r = el.getBoundingClientRect(); return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height } }
    const q = s => sec.querySelector(s)
    const S = []
    const add = (b, fx, fy, frx, fry, pig, a = 0.028, layers = 36) => {
      if (!b || !b.w) return
      S.push({ cx: b.x + b.w * fx, cy: b.y + b.h * fy, rx: Math.max(40, b.w * frx), ry: Math.max(34, b.h * fry), pig, a, layers })
    }
    if (sec === hero) {
      const copy = rel(q('.ec-hero-copy')), ph = rel(q('.ec-hero-photo'))
      add(copy, 0.3, 0.44, 0.62, 0.5, 'sun', 0.024, 42)
      add(ph, 0.6, 0.58, 0.6, 0.55, 'mint', 0.03, 40)
      add(ph, 0.98, 0.04, 0.26, 0.2, 'sky', 0.034, 30)
      add(copy, 0.04, 0.96, 0.14, 0.12, 'orange', 0.03, 26)
    } else if (sec.id === 'care') {
      const v = rel(q('.ec-care-view')), hearts = rel(q('.ec-hearts')), wide = rel(q('.ec-care-wide'))
      add(v, 0.66, 0.6, 0.52, 0.5, 'sky', 0.028, 38)
      add(hearts, 0.25, 0.5, 0.42, 1.1, 'sun', 0.03, 30)
      add(wide, 0.3, 0.6, 0.5, 0.7, 'mint', 0.026, 34)
    } else if (sec.id === 'spaces') {
      const gal = q('.ec-gallery')
      const scroller = gal.scrollWidth > gal.clientWidth + 4
      if (scroller) add(rel(gal), 0.4, 0.4, 0.7, 0.42, 'mint', 0.024, 36)
      else {
        sec.querySelectorAll('.ec-space .ec-frame').forEach((f, i) => {
          add(rel(f), 0.56 + (i % 2 ? -0.08 : 0.08), 0.6, 0.6, 0.62, ORDER[i % 4], 0.026, 34)
        })
      }
      add(rel(q('.ec-spaces-head .ec-title')), 0.1, 0.2, 0.2, 0.5, 'orange', 0.028, 24)
    } else if (sec.id === 'meals') {
      add(rel(q('.ec-day')), 0.5, 0.42, 0.56, 0.52, 'sun', 0.026, 40)
      add(rel(q('.ec-book-cover')), 0.5, 0.55, 0.62, 0.5, 'orange', 0.03, 32)
    } else if (sec.id === 'visit') {
      add(rel(q('.ec-visit-photo')), 0.42, 0.5, 0.6, 0.5, 'mint', 0.028, 38)
      add(rel(q('.ec-visit-copy')), 0.6, 0.45, 0.5, 0.5, 'sun', 0.026, 34)
    }
    return S
  }
  function paint (sec, animate) {
    const cv = sec === hero ? heroCanvas : sec.querySelector('.ec-wash')
    if (!cv) return
    const w = sec.clientWidth, h = sec.clientHeight
    const ctx = EC.fit(cv, w, h, SCALE)
    const R = rand(sec.id ? sec.id.length * 131 : 17)
    specsFor(sec).forEach(s => {
      // 顏料不出段落：碰到上下緣就把半徑收回來，免得被頁尾切一刀
      const ry = Math.max(30, Math.min(s.ry, s.cy - 16, h - 16 - s.cy))
      const layers = Math.round(s.layers * 1.3)
      jobs.push({ ctx, polys: washPolys(R, s.cx, s.cy, s.rx, ry, layers), rgb: PIG[s.pig], a: s.a * 0.55, i: 0, per: animate ? 3 : 999 })
    })
    painted.set(sec, { w, h, ctx })
  }
  const secs = [hero, ...document.querySelectorAll('.ec-sec')]
  const near = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !painted.has(e.target)) paint(e.target, true)
  }), { rootMargin: '200px 0px' })

  // ---------- 首屏：滑鼠滴顏料 ----------
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

  return {
    onLayout ({ widthChanged, first }) {
      maskFrames()
      if (first) { secs.forEach(s => near.observe(s)); return }
      if (widthChanged) secs.forEach(s => { if (painted.has(s)) paint(s, false) })
      else secs.forEach(s => { const p = painted.get(s); if (p && Math.abs(s.clientHeight - p.h) > 40) paint(s, false) })
    },
    onReveal (el) {
      const frames = el.classList.contains('ec-frame') ? [el] : [...el.querySelectorAll('.ec-frame.has-mask')]
      frames.forEach((f, i) => bloom(f, 120 + i * 140))
    },
    onCare (i, photo) {
      if (reduce) return
      photo.classList.remove('is-bloomed')
      void photo.offsetWidth
      photo.classList.add('is-bloomed')
    },
    // 日弧：乾筆刷從早上的暖黃刷到下午的橙，亮起的時間點點一滴顏料
    drawDay (ctx, day, p) {
      const { pts, len } = day
      if (p <= 0) return
      const head = EC.pointAt(pts, len * p)
      const last = pts[pts.length - 1]
      const g = day.vertical ? ctx.createLinearGradient(0, pts[0].y, 0, last.y) : ctx.createLinearGradient(pts[0].x, 0, last.x, 0)
      g.addColorStop(0, `rgba(${PIG.sun}, .5)`)
      g.addColorStop(0.55, `rgba(${PIG.sun}, .42)`)
      g.addColorStop(1, `rgba(${PIG.orange}, .5)`)
      const R = rand(99)
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.strokeStyle = g
      for (let k = 0; k < 7; k++) {
        const off = (R() - 0.5) * 6, w = 2 + R() * 6, seed = R() * 50
        ctx.globalAlpha = 0.35 + R() * 0.4
        ctx.lineWidth = w
        ctx.beginPath()
        for (let i = 0; i <= head.i; i++) {
          const q = i === head.i ? head : pts[i]
          const nx = -Math.sin(q.ang || 0), ny = Math.cos(q.ang || 0)
          const j = off + Math.sin(i * 0.37 + seed) * 1.4
          const x = q.x + nx * j, y = q.y + ny * j
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      day.stopT.forEach((st, i) => {
        if (p < st - 0.004) return
        const q = EC.pointAt(pts, st * len)
        const Rs = rand(300 + i)
        const k = Math.min(1, (p - st) / 0.05 + 0.4)
        const polys = washPolys(Rs, q.x, q.y, 20 * k, 18 * k, 10)
        ctx.fillStyle = `rgba(${PIG[ORDER[(i + 1) % 4]]}, .12)`
        polys.forEach(pp => { fillPoly(ctx, pp); ctx.fill() })
      })
    }
  }
}
