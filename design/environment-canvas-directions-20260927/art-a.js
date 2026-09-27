// A 藤蔭：窗外垂下的常春藤，把葉影和光斑投在紙上。
// 兩張低解析度 canvas（遠層 1/3、近層 1/8）放大後自然變柔，mix-blend-mode: multiply 疊在整頁上。
// 游標＝一陣風，靠近的葉子被撥開、光漏下來；捲動讓光影慢慢平移。減少動態時只畫一格。
;(window.ECArt = window.ECArt || {}).a = EC => {
  const { reduce, noise, rand } = EC
  const hasFilter = 'filter' in CanvasRenderingContext2D.prototype
  const INK = '38, 66, 52'

  const layers = [
    { cls: 'far', scale: 1 / 2, blur: 1.1, alpha: 0.15, stem: 0.12 },
    { cls: 'near', scale: 1 / 10, blur: 1.4, alpha: 0.075, stem: 0 }
  ]
  layers.forEach(L => {
    L.el = document.createElement('canvas')
    L.el.className = `ec-shade ec-shade--${L.cls}`
    L.el.setAttribute('aria-hidden', 'true')
    L.buf = document.createElement('canvas')
    document.body.appendChild(L.el)
  })

  // 常春藤葉（葉柄在原點、葉尖朝 -y）：中央、兩側、兩片基部，共五裂
  function leafPath (ctx) {
    ctx.beginPath()
    ctx.moveTo(0, -0.12)
    ctx.quadraticCurveTo(0.26, 0.04, 0.5, -0.16)
    ctx.quadraticCurveTo(0.5, -0.3, 0.3, -0.36)
    ctx.quadraticCurveTo(0.56, -0.42, 0.6, -0.62)
    ctx.quadraticCurveTo(0.4, -0.7, 0.2, -0.62)
    ctx.quadraticCurveTo(0.2, -0.86, 0, -1)
    ctx.quadraticCurveTo(-0.2, -0.86, -0.2, -0.62)
    ctx.quadraticCurveTo(-0.4, -0.7, -0.6, -0.62)
    ctx.quadraticCurveTo(-0.56, -0.42, -0.3, -0.36)
    ctx.quadraticCurveTo(-0.5, -0.3, -0.5, -0.16)
    ctx.quadraticCurveTo(-0.26, 0.04, 0, -0.12)
    ctx.closePath()
  }

  let W = 0, H = 0, strands = [], flecks = []
  function build () {
    W = innerWidth; H = innerHeight
    const R = rand(11)
    const k = Math.min(1.25, Math.max(0.62, Math.min(W, 1500) / 1200))
    strands = []
    // 遠層：從上緣與右緣垂下的細藤，葉子小、晃得快
    const mob = W < 761
    const topCount = mob ? 5 : 8
    // 垂藤集中在右上，越往左越短，像窗框右上角爬進來的一叢
    for (let i = 0; i < topCount; i++) {
      const u = i / (topCount - 1)
      strands.push(makeStrand(R, 0, W * (0.56 + 0.5 * u) + (R() - 0.5) * 50, -30 - R() * 40,
        Math.PI / 2 + (R() - 0.5) * 0.45 + (1 - u) * 0.12, Math.round(3 + u * 6 + R() * 3), (40 + R() * 16) * k, (40 + R() * 22) * k))
    }
    for (let i = 0; i < 3; i++) {
      strands.push(makeStrand(R, 0, W + 30, H * (0.06 + 0.16 * i), Math.PI * (0.8 + R() * 0.1), 3 + Math.floor(R() * 4), (38 + R() * 14) * k, (38 + R() * 20) * k))
    }
    // 近層：兩三片很靠近鏡頭的大葉，完全失焦
    for (let i = 0; i < 3; i++) {
      strands.push(makeStrand(R, 1, W * (0.7 + 0.18 * i), -120, Math.PI / 2 + (R() - 0.5) * 0.6, 3 + Math.floor(R() * 2), (140 + R() * 60) * k, (150 + R() * 70) * k))
    }
    // 光斑：樹冠陰影裡的小洞（針孔成像，稍微橢圓）
    flecks = []
    for (let i = 0; i < 34; i++) {
      const a = R() * Math.PI / 2, d = Math.sqrt(R()) * Math.min(W, 1400) * 0.42
      flecks.push({ x: W - Math.cos(a) * d, y: Math.sin(a) * d * 0.9, r: (6 + R() * 13) * k, s: R() * 10 })
    }
    layers.forEach(L => {
      const w = Math.ceil(W * L.scale), h = Math.ceil(H * L.scale)
      L.el.width = w; L.el.height = h
      L.buf.width = w; L.buf.height = h
      L.ctx = L.el.getContext('2d')
      L.bctx = L.buf.getContext('2d')
    })
  }
  function makeStrand (R, layer, ax, ay, angle, n, seg, leaf) {
    const nodes = []
    for (let i = 1; i <= n; i++) {
      nodes.push({ side: i % 2 ? 1 : -1, size: leaf * (0.7 + R() * 0.55) * (1 - i / (n * 2.6)), tilt: 0.7 + R() * 0.6, seed: R() * 100, push: 0, px: 0, py: 0 })
    }
    return { layer, ax, ay, angle, n, seg, nodes, bend: (R() - 0.5) * 0.08, speed: 0.35 + R() * 0.3, seed: R() * 100 }
  }

  // 風：游標速度＋捲動速度，慢慢回到 1
  let breeze = 1, ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, v: 0 }, lastScroll = scrollY
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return
    const v = Math.hypot(e.clientX - ptr.tx, e.clientY - ptr.ty)
    ptr.tx = e.clientX; ptr.ty = e.clientY
    breeze = Math.min(3.2, breeze + v * 0.004)
  }, { passive: true })
  document.addEventListener('pointerleave', () => { ptr.tx = -9999; ptr.ty = -9999 })

  function draw (t) {
    const drift = Math.sin(scrollY / 1100) * 26
    const pushR = Math.min(220, W * 0.18)
    layers.forEach((L, li) => {
      const c = L.bctx, s = L.scale
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, L.buf.width, L.buf.height)
      c.setTransform(s, 0, 0, s, 0, 0)
      c.fillStyle = `rgba(${INK}, ${L.alpha})`
      c.strokeStyle = `rgba(${INK}, ${L.stem})`
      c.lineCap = 'round'
      for (const st of strands) {
        if (st.layer !== li) continue
        let x = st.ax + drift * (li ? 1.8 : 1), y = st.ay
        const stem = [[x, y]]
        for (let k = 0; k < st.n; k++) {
          const nd = st.nodes[k]
          const sway = noise(t * st.speed + k * 0.28, st.seed) * (0.05 + 0.028 * k) * breeze
          const a = st.angle + st.bend * k + sway
          x += Math.cos(a) * st.seg; y += Math.sin(a) * st.seg
          stem.push([x, y])
          // 葉子本身的抖動與被風撥開
          const flutter = noise(t * 1.9 + nd.seed, nd.seed) * 0.22 * breeze
          const la = a + nd.side * nd.tilt - Math.PI / 2 + flutter
          let lx = x, ly = y
          const dx = lx - ptr.x, dy = ly - ptr.y, d = Math.hypot(dx, dy)
          const want = d < pushR ? (1 - d / pushR) ** 2 * 70 : 0
          nd.push += (want - nd.push) * 0.12
          if (nd.push > 0.2 && d > 0.01) { nd.px = dx / d; nd.py = dy / d }
          lx += nd.px * nd.push; ly += nd.py * nd.push
          c.save()
          c.translate(lx, ly)
          c.rotate(la)
          c.scale(nd.size, nd.size * (0.92 + 0.08 * Math.cos(t + nd.seed)))
          leafPath(c)
          c.fill()
          c.restore()
        }
        if (L.stem) {
          c.lineWidth = 2
          c.beginPath()
          stem.forEach(([sx, sy], i) => (i ? c.lineTo(sx, sy) : c.moveTo(sx, sy)))
          c.stroke()
        }
      }
      if (li === 0) {
        // 樹冠本身的一團柔影（右上角），葉子疊在它上面
        c.globalCompositeOperation = 'destination-over'
        const cx = W * 1.02 + drift, cy = -H * 0.06, cr = Math.min(W, 1400) * 0.46
        const m = c.createRadialGradient(cx, cy, cr * 0.1, cx, cy, cr)
        m.addColorStop(0, `rgba(${INK}, .16)`)
        m.addColorStop(0.55, `rgba(${INK}, .08)`)
        m.addColorStop(1, `rgba(${INK}, 0)`)
        c.fillStyle = m
        c.fillRect(0, 0, W, H)
        // 光斑：從葉影裡挖洞
        c.globalCompositeOperation = 'destination-out'
        for (const f of flecks) {
          const fx = f.x + drift + noise(t * 0.4, f.s) * 14, fy = f.y + noise(t * 0.33, f.s + 3) * 10
          const g = c.createRadialGradient(fx, fy, 0, fx, fy, f.r)
          g.addColorStop(0, 'rgba(0,0,0,.9)')
          g.addColorStop(1, 'rgba(0,0,0,0)')
          c.fillStyle = g
          c.beginPath()
          c.ellipse(fx, fy, f.r * 1.25, f.r, 0.4, 0, Math.PI * 2)
          c.fill()
        }
        c.globalCompositeOperation = 'source-over'
      }
      // 模糊一次再貼上；遠層順便鋪一層很淡的暖色（午後的光）
      const out = L.ctx
      out.setTransform(1, 0, 0, 1, 0, 0)
      out.clearRect(0, 0, L.el.width, L.el.height)
      if (li === 0) {
        const g = out.createLinearGradient(L.el.width, 0, 0, L.el.height)
        g.addColorStop(0, 'rgba(255, 226, 170, .26)')
        g.addColorStop(0.6, 'rgba(255, 238, 205, .12)')
        g.addColorStop(1, 'rgba(255, 244, 225, .04)')
        out.fillStyle = g
        out.fillRect(0, 0, L.el.width, L.el.height)
      }
      if (hasFilter) out.filter = `blur(${L.blur}px)`
      out.drawImage(L.buf, 0, 0)
      if (hasFilter) out.filter = 'none'
    })
  }

  let raf = 0
  function loop (now) {
    const t = now / 1000
    ptr.x += (ptr.tx - ptr.x) * 0.18
    ptr.y += (ptr.ty - ptr.y) * 0.18
    const sv = Math.abs(scrollY - lastScroll); lastScroll = scrollY
    breeze = Math.min(3.2, breeze + sv * 0.0025)
    breeze += (1 - breeze) * 0.02
    draw(t)
    raf = requestAnimationFrame(loop)
  }
  function start () {
    cancelAnimationFrame(raf)
    if (reduce) { draw(0); return }
    raf = requestAnimationFrame(loop)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start() })

  return {
    onLayout ({ widthChanged, first }) {
      if (first || widthChanged || Math.abs(innerHeight - H) > 120) { build(); start() }
    },
    onCare () { breeze = Math.min(3.2, breeze + 1.2) },
    // 日弧：整天是虛線，太陽走過的地方變金線
    drawDay (ctx, day, p) {
      const { pts, len } = day
      ctx.lineCap = 'round'
      ctx.setLineDash([2, 7])
      ctx.strokeStyle = 'rgba(47, 90, 69, .45)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      ctx.stroke()
      ctx.setLineDash([])
      const head = EC.pointAt(pts, len * p)
      ctx.strokeStyle = 'rgba(214, 160, 40, .9)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      for (let i = 0; i < head.i; i++) (i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y))
      ctx.lineTo(head.x, head.y)
      ctx.stroke()
      // 太陽
      const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 64)
      glow.addColorStop(0, 'rgba(255, 215, 94, .55)')
      glow.addColorStop(1, 'rgba(255, 215, 94, 0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(head.x, head.y, 64, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#f1c24b'
      ctx.beginPath(); ctx.arc(head.x, head.y, 11, 0, Math.PI * 2); ctx.fill()
    }
  }
}
