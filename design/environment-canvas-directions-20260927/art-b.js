// B 一筆藤：一條常春藤從首屏照片旁長出來，跟著捲動穿過整頁，最後停在「預約校園參觀」旁邊。
// 路徑由 [data-vine] 錨點（元素框的相對座標）串成 centripetal Catmull-Rom；canvas 固定在內容後面，
// 所以藤蔓會從照片「後面」繞過去。保育那段的照片裁成常春藤葉，五個裂片對應五件照顧的事。
// 手機不走錨點，改沿右緣長。減少動態時整條直接畫完。
;(window.ECArt = window.ECArt || {}).b = EC => {
  const { reduce, rand, noise, DPR } = EC
  const cv = document.createElement('canvas')
  cv.className = 'ec-vine'
  cv.setAttribute('aria-hidden', 'true')
  document.body.prepend(cv)
  const ctx = cv.getContext('2d')
  const INK = 'rgba(38, 82, 60, .85)'
  const FILL = 'rgba(186, 220, 192, .6)'
  const GOLD_FILL = 'rgba(244, 204, 96, .62)'
  const GOLD = 'rgba(214, 158, 36, .95)'

  // 常春藤葉：10 段三次貝茲（objectBoundingBox），與 index.html 的 #ivy-leaf-clip 同一條
  const LEAF_START = [0.5, 0.84]
  const LEAF = [
    [0.4, 0.92, 0.2, 0.92, 0.1, 0.8],
    [0.14, 0.72, 0.2, 0.68, 0.24, 0.64],
    [0.14, 0.6, 0.04, 0.52, 0, 0.4],
    [0.12, 0.36, 0.22, 0.36, 0.3, 0.38],
    [0.34, 0.24, 0.42, 0.1, 0.5, 0],
    [0.58, 0.1, 0.66, 0.24, 0.7, 0.38],
    [0.78, 0.36, 0.88, 0.36, 1, 0.4],
    [0.96, 0.52, 0.86, 0.6, 0.76, 0.64],
    [0.8, 0.68, 0.86, 0.72, 0.9, 0.8],
    [0.8, 0.92, 0.6, 0.92, 0.5, 0.84]
  ]
  // 五個裂片 = 五件照顧的事：左下、左、上、右、右下
  const LOBES = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]
  function leafShape (c, x, y, w, h, from = 0, to = 10) {
    const s0 = from === 0 ? LEAF_START : LEAF[from - 1].slice(4)
    c.moveTo(x + s0[0] * w, y + s0[1] * h)
    for (let i = from; i < to; i++) {
      const s = LEAF[i]
      c.bezierCurveTo(x + s[0] * w, y + s[1] * h, x + s[2] * w, y + s[3] * h, x + s[4] * w, y + s[5] * h)
    }
  }

  let W = 0, H = 0, docH = 0
  let path = [], keys = [], total = 0, leaves = [], curls = []
  let big = null
  let headL = 0
  let careIndex = 0
  const lobeA = [1, 0, 0, 0, 0]

  function centripetal (p0, p1, p2, p3, t) {
    const d = (p, q) => Math.max(1e-3, Math.pow(Math.hypot(q.x - p.x, q.y - p.y), 0.5))
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3)
    const tt = t1 + (t2 - t1) * t
    const L = (p, q, a, b) => { const u = (tt - a) / (b - a); return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u } }
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3)
    const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3)
    return L(B1, B2, t1, t2)
  }
  function spline (anchors) {
    const out = []
    const n = anchors.length
    const get = i => {
      if (i < 0) return { x: 2 * anchors[0].x - anchors[1].x, y: 2 * anchors[0].y - anchors[1].y }
      if (i >= n) return { x: 2 * anchors[n - 1].x - anchors[n - 2].x, y: 2 * anchors[n - 1].y - anchors[n - 2].y }
      return anchors[i]
    }
    for (let i = 0; i < n - 1; i++) {
      const p1 = anchors[i], p2 = anchors[i + 1]
      const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 5))
      for (let j = 0; j < steps; j++) out.push(centripetal(get(i - 1), p1, p2, get(i + 2), j / steps))
    }
    out.push({ ...anchors[n - 1] })
    return out
  }

  function anchors () {
    const sy = scrollY
    const pts = []
    // 日弧的錨點由 ec.js 的同一條 arc() 算，藤蔓剛好穿過每個時間點
    const day = document.querySelector('.ec-day')
    day.dataset.vine = '-0.02,0.3;' + [0.0625, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9375]
      .map(t => { const p = EC.arc(t); return `${p.x.toFixed(3)},${p.y.toFixed(3)}` }).join(';') + ';1.04,0.36;1.05,1.06'
    document.querySelectorAll('[data-vine]').forEach(el => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      el.dataset.vine.split(';').forEach(pair => {
        const [fx, fy] = pair.split(',').map(Number)
        pts.push({ x: Math.min(W - 10, Math.max(10, r.left + fx * r.width)), y: r.top + sy + fy * r.height })
      })
    })
    return pts
  }
  function mobileAnchors () {
    const end = document.querySelector('.ec-foot').getBoundingClientRect().top + scrollY - 40
    const pts = []
    for (let y = 70; y < end; y += 150) pts.push({ x: W - 12 + Math.sin(y / 190) * 6, y })
    return pts
  }

  function build () {
    W = innerWidth; H = innerHeight
    docH = document.documentElement.scrollHeight
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR)
    const R = rand(23)
    const mobile = W < 761
    const a = mobile ? mobileAnchors() : anchors()
    if (a.length < 2) { path = []; return }
    path = spline(a)
    // 手繪的抖：沿法線偏一點
    for (let i = 0; i < path.length; i++) {
      const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)]
      const ang = Math.atan2(q.y - o.y, q.x - o.x)
      p.ang = ang
    }
    total = EC.measure(path)
    for (const p of path) {
      const off = noise(p.l * 0.013, 3) * 2.2
      p.x += Math.cos(p.ang + Math.PI / 2) * off
      p.y += Math.sin(p.ang + Math.PI / 2) * off
    }
    total = EC.measure(path)
    // 捲動 → 生長長度：往上走的段落延遲一點，確保單調
    keys = [path[0].y]
    for (let i = 1; i < path.length; i++) {
      keys.push(Math.max(keys[i - 1] + (path[i].l - path[i - 1].l) * 0.25, path[i].y))
    }
    // 小葉與捲鬚
    leaves = []; curls = []
    let side = 1
    for (let l = 40; l < total - 20; l += (mobile ? 90 : 72) + R() * 60) {
      const p = EC.pointAt(path, l)
      side = mobile ? -1 : -side
      leaves.push({ l, x: p.x, y: p.y, ang: p.ang, side, size: (mobile ? 12 : 13) + R() * (mobile ? 6 : 12), gold: R() < 0.09, pet: 5 + R() * 6, born: -1 })
      if (!mobile && R() < 0.35) leaves.push({ l: l + 6, x: p.x, y: p.y, ang: p.ang, side: -side, size: 9 + R() * 7, gold: false, pet: 4 + R() * 4, born: -1 })
    }
    curls.push({ l: 0, x: path[0].x, y: path[0].y, ang: path[0].ang + Math.PI, side: -1, r: 12, born: -1 })
    for (let l = 260; l < total; l += 420 + R() * 300) {
      const p = EC.pointAt(path, l)
      curls.push({ l, x: p.x, y: p.y, ang: p.ang, side: R() < 0.5 ? -1 : 1, r: 9 + R() * 7, born: -1 })
    }
    // 保育的大葉：照片框外擴一點畫輪廓，葉柄從最靠近的藤蔓點接上來
    big = null
    const ph = document.querySelector('.ec-care-photo')
    const pr = ph && ph.getBoundingClientRect()
    if (!mobile && pr && pr.width) {
      const grow = 1.045
      const w = pr.width * grow, h = pr.height * grow
      const x = pr.left + pr.width / 2 - w / 2, y = pr.top + scrollY + pr.height / 2 - h / 2
      const notch = { x: x + 0.5 * w, y: y + 0.84 * h }
      let best = 0, bd = Infinity
      path.forEach((p, i) => { const d = Math.hypot(p.x - notch.x, p.y - notch.y - 90); if (d < bd && p.y > notch.y) { bd = d; best = i } })
      const from = path[best]
      big = { x, y, w, h, notch, from, l: from.l, born: -1, clen: (w + h) * 1.9 }
    }
    headL = reduce ? total : Math.min(headL, total)
  }

  function targetL () {
    if (reduce || !keys.length) return total
    const y = scrollY + H * 0.8
    let lo = 0, hi = keys.length - 1
    if (y <= keys[0]) return 0
    if (y >= keys[hi]) return total
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m] <= y) lo = m; else hi = m }
    const u = (y - keys[lo]) / Math.max(1e-6, keys[hi] - keys[lo])
    return path[lo].l + (path[hi].l - path[lo].l) * u
  }

  const ease = u => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 4)

  function drawLeaf (lf, k, now) {
    const s = lf.size * k
    if (s < 0.5) return
    const axis = lf.ang + lf.side * (Math.PI / 2 - 0.62) + lf.side * (1 - k) * 0.9
    ctx.save()
    ctx.translate(lf.x, lf.y)
    ctx.rotate(axis + Math.PI / 2)
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.1
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -lf.pet * k); ctx.stroke()
    ctx.translate(0, -lf.pet * k)
    ctx.rotate(noise(now / 1400 + lf.l, lf.l) * 0.06)
    ctx.beginPath()
    leafShape(ctx, -0.5 * s, -0.84 * s, s, s)
    ctx.closePath()
    ctx.fillStyle = lf.gold ? GOLD_FILL : FILL
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = 0.55
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -0.66 * s); ctx.stroke()
    ctx.restore()
  }
  function drawCurl (c, k) {
    const n = 40
    const nx = Math.cos(c.ang + c.side * Math.PI / 2), ny = Math.sin(c.ang + c.side * Math.PI / 2)
    const cx = c.x + nx * c.r, cy = c.y + ny * c.r
    const a0 = Math.atan2(c.y - cy, c.x - cx)
    ctx.beginPath()
    for (let i = 0; i <= n * k; i++) {
      const u = i / n
      const r = c.r * (1 - u * 0.85)
      const a = a0 + c.side * u * Math.PI * 3.2
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.lineWidth = 1
    ctx.stroke()
  }

  let active = true, lastSY = -1, lastHead = -1
  function draw (now) {
    const sy = scrollY
    ctx.setTransform(DPR, 0, 0, DPR, 0, -sy * DPR)
    ctx.clearRect(0, sy, W, H)
    if (!path.length) return
    const top = sy - 80, bot = sy + H + 80
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    // 主藤：一粗一細兩筆，像鋼筆描了兩次
    for (const pass of [[1.8, INK, 0, 0], [0.8, 'rgba(38, 82, 60, .28)', 0.9, 0.7]]) {
      ctx.lineWidth = pass[0]; ctx.strokeStyle = pass[1]
      ctx.beginPath()
      let on = false
      for (let i = 0; i < path.length; i++) {
        const p = path[i]
        if (p.l > headL) {
          if (on) { const q = EC.pointAt(path, headL); ctx.lineTo(q.x + pass[2], q.y + pass[3]) }
          break
        }
        if (p.y < top || p.y > bot) { on = false; continue }
        on ? ctx.lineTo(p.x + pass[2], p.y + pass[3]) : ctx.moveTo(p.x + pass[2], p.y + pass[3])
        on = true
      }
      ctx.stroke()
    }
    // 小葉
    let busy = false
    ctx.strokeStyle = INK
    for (const lf of leaves) {
      if (lf.l > headL) break
      if (lf.born < 0) lf.born = now
      if (lf.y < top || lf.y > bot) continue
      const k = reduce ? 1 : ease((now - lf.born) / 950)
      if (k < 1) busy = true
      drawLeaf(lf, k, now)
    }
    for (const c of curls) {
      if (c.l > headL) break
      if (c.born < 0) c.born = now
      if (c.y < top || c.y > bot) continue
      const k = reduce ? 1 : ease((now - c.born) / 1200)
      if (k < 1) busy = true
      ctx.strokeStyle = INK
      drawCurl(c, k)
    }
    // 保育大葉：葉柄 → 輪廓自己描出來 → 目前那件事的裂片亮金色
    if (big && headL >= big.l) {
      if (big.born < 0) big.born = now
      const e = reduce ? 1e9 : now - big.born
      const kp = ease(e / 700), kc = ease((e - 500) / 1500)
      if (kc < 1) busy = true
      const f = big.from, n = big.notch
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(f.x, f.y)
      const mx = f.x + (n.x - f.x) * kp, my = f.y + (n.y - f.y) * kp
      ctx.quadraticCurveTo(f.x + (n.x - f.x) * 0.2 * kp, my + 30 * kp, mx, my)
      ctx.stroke()
      if (kc > 0) {
        ctx.save()
        ctx.setLineDash([big.clen, big.clen])
        ctx.lineDashOffset = big.clen * (1 - kc)
        ctx.lineWidth = 1.6
        ctx.beginPath(); leafShape(ctx, big.x, big.y, big.w, big.h); ctx.stroke()
        ctx.restore()
        ctx.lineWidth = 4
        LOBES.forEach(([a, b], i) => {
          const target = i === careIndex ? 1 : 0
          lobeA[i] += (target - lobeA[i]) * (reduce ? 1 : 0.14)
          if (Math.abs(target - lobeA[i]) > 0.01) busy = true
          const al = lobeA[i] * kc
          if (al < 0.02) return
          ctx.globalAlpha = al
          ctx.strokeStyle = GOLD
          ctx.beginPath(); leafShape(ctx, big.x, big.y, big.w, big.h, a, b); ctx.stroke()
          // 裂片尖端＝該裂片第一段的終點
          const tp = LEAF[a].slice(4)
          ctx.fillStyle = GOLD
          ctx.beginPath(); ctx.arc(big.x + tp[0] * big.w, big.y + tp[1] * big.h, 4.5, 0, Math.PI * 2); ctx.fill()
        })
        ctx.globalAlpha = 1
      }
    }
    // 生長點：一顆小芽
    if (headL < total) {
      const q = EC.pointAt(path, headL)
      if (q.y > top && q.y < bot) {
        ctx.fillStyle = 'rgba(120, 170, 110, .9)'
        ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill()
      }
    }
    active = busy
  }

  function loop (now) {
    const t = targetL()
    headL += (t - headL) * (reduce ? 1 : 0.1)
    if (Math.abs(t - headL) < 0.5) headL = t
    if (active || scrollY !== lastSY || Math.abs(headL - lastHead) > 0.3) {
      lastSY = scrollY; lastHead = headL
      draw(now)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return {
    onLayout ({ widthChanged, first }) {
      const h = document.documentElement.scrollHeight
      if (first || widthChanged || Math.abs(h - docH) > 4 || Math.abs(innerHeight - H) > 120) { build(); active = true }
    },
    onCare (i) { careIndex = i; active = true },
    drawDay (c, day, p) {
      // 亮起的時間點長出一對小葉
      day.stopT.forEach((st, i) => {
        if (p < st - 0.004 || !day.stops[i].classList.contains('is-major')) return
        const q = EC.pointAt(day.pts, st * day.len)
        const k = Math.min(1, (p - st) / 0.06 + 0.35)
        ;[1].forEach(side => {
          const s = 15 * k
          c.save()
          c.translate(q.x, q.y)
          c.rotate(day.vertical ? Math.PI / 2 : -0.5)
          c.translate(0, -8)
          c.beginPath(); leafShape(c, -0.5 * s, -0.84 * s, s, s); c.closePath()
          c.fillStyle = side > 0 ? GOLD_FILL : FILL
          c.strokeStyle = INK; c.lineWidth = 1
          c.fill(); c.stroke()
          c.restore()
        })
      })
    }
  }
}
