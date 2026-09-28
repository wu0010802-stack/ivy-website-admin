// 進入特色教學頁的換頁 mock-up（2026-09-28）。
// 正式版的做法會一樣：document.startViewTransition(async () => { 換頁，等新頁畫好 })，
// 舊頁是靜止截圖、新頁是 live，所以特色教學頁自己的顏料與照片暈開會在遮罩裡一起動。
// 遮罩用與特色教學頁相同的顏料演算法（多邊形反覆變形、低透明度疊層）現場生成。
;(() => {
  const root = document.documentElement
  const variant = root.dataset.vt
  const canTransition = typeof document.startViewTransition === 'function'
  const pages = Object.fromEntries([...document.querySelectorAll('.vt-page')].map((f) => [f.dataset.page, f]))
  const note = document.getElementById('vt-note')
  const slow = document.getElementById('vt-slow')
  let current = 'environment'
  let busy = false

  const NOTES = {
    0: '現行：新頁準備好就直接換上，沒有過場。',
    a: 'A 中央暈開：從畫面中央滲開，約 0.9 秒；三團顏料用不同速度長大，邊緣一路在變。',
    b: 'B 從點擊處：從你點的「特色教學」滲開（手機從選單鈕），約 0.9 秒。',
    c: 'C 刷過去：一大筆水彩從左刷到右，前緣是乾筆毛邊，約 0.85 秒。'
  }
  document.querySelectorAll('.vt-variants a').forEach((a) => { if (a.dataset.v === variant) a.setAttribute('aria-current', 'page') })
  const setNote = (extra = '') => { note.textContent = `${NOTES[variant]}${canTransition ? '' : '（這個瀏覽器不支援 View Transitions，會直接換頁）'}${extra}` }
  setNote('　回環境頁是一般的短淡入淡出。')

  // ---------- 顏料遮罩 ----------
  const rand = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296) }
  const gauss = (R) => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  const ellipse = (R, cx, cy, rx, ry, n = 12) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2, k = 1 + (R() - 0.5) * 0.35; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] })
  const deform = (R, pts, depth, v) => {
    for (let d = 0; d < depth; d++) {
      const out = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1])
        out.push(a, [(a[0] + b[0]) / 2 + gauss(R) * v * len * 0.5, (a[1] + b[1]) / 2 + gauss(R) * v * len * 0.5])
      }
      pts = out
    }
    return pts
  }
  const trace = (c, p) => { c.beginPath(); c.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]); c.closePath() }

  // 一團顏料：外圈幾十層很淡的變形多邊形（濕邊），中間一個變形過的實心塊
  function blobMask (seed) {
    const S = 1024, c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d'), R = rand(seed)
    const base = deform(R, ellipse(R, S / 2, S / 2, S * 0.33, S * 0.33), 2, 0.5)
    x.fillStyle = 'rgba(0,0,0,.07)'
    for (let i = 0; i < 28; i++) { trace(x, deform(R, base, 3, 0.3)); x.fill() }
    x.fillStyle = '#000'
    trace(x, deform(R, ellipse(R, S / 2, S / 2, S * 0.29, S * 0.29, 16), 3, 0.18))
    x.fill()
    return `url(${c.toDataURL()})`
  }
  // 一大筆：左邊三分之二是實心，接著半個畫面寬的乾筆前緣（每一列拖痕長短不一、邊緣微斜）
  function brushMask () {
    const U = 640, W = U * 3, H = 480, c = document.createElement('canvas')
    c.width = W; c.height = H
    const x = c.getContext('2d'), R = rand(77)
    const edge = (y) => 2 * U + (y / H - 0.5) * 0.3 * U + Math.sin(y / 23) * 6
    x.fillStyle = '#000'
    x.beginPath(); x.moveTo(0, 0)
    for (let y = 0; y <= H; y += 4) x.lineTo(edge(y), y)
    x.lineTo(0, H); x.closePath(); x.fill()
    // 刷毛：一束一束、粗細不一，每束末端變細變淡；整張再柔化，看起來是紙上的筆觸而不是掃描線
    x.filter = 'blur(2.5px)'
    for (let y = -6; y < H + 6;) {
      const thick = 6 + R() * 16
      const start = edge(y + thick / 2) - 4
      const len = U * 0.5 * (0.25 + 0.75 * Math.pow(R(), 0.8)) * (0.7 + 0.3 * Math.sin(y / 53 + 0.7))
      const g = x.createLinearGradient(start, 0, start + len, 0)
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,.8)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      x.fillStyle = g
      x.beginPath()
      x.moveTo(start, y); x.lineTo(start + len * 0.85, y + thick * 0.3)
      x.quadraticCurveTo(start + len, y + thick * 0.5, start + len * 0.85, y + thick * 0.7)
      x.lineTo(start, y + thick); x.closePath(); x.fill()
      y += thick * (0.55 + R() * 0.5)
    }
    x.filter = 'none'
    return `url(${c.toDataURL()})`
  }
  if (variant === 'a' || variant === 'b') {
    root.style.setProperty('--vt-blob-1', blobMask(11))
    root.style.setProperty('--vt-blob-2', blobMask(23))
    root.style.setProperty('--vt-blob-3', blobMask(37))
  } else if (variant === 'c') root.style.setProperty('--vt-brush', brushMask())

  // ---------- 頁面 ----------
  const hide = { environment: '.header,.menu-panel{display:none!important}', curriculum: '.cw-head{display:none!important}' }
  const prepare = (name) => {
    const doc = pages[name].contentDocument
    if (!doc || doc.getElementById('vt-mock-style')) return
    const style = doc.createElement('style')
    style.id = 'vt-mock-style'
    style.textContent = hide[name]
    doc.head.appendChild(style)
  }
  pages.environment.addEventListener('load', () => prepare('environment'))
  const CURRICULUM = '../curriculum-watercolor-mockup-20260928/index.html'
  // 先在背景載一次，讓圖片與字型進快取；每次換頁再重新載入，讓頁面自己的進場重跑
  pages.curriculum.src = CURRICULUM
  pages.curriculum.addEventListener('load', () => prepare('curriculum'))

  // 等新頁：DOM 就緒、字型好了就開始（SPA 換頁也不會等全部圖片載完）；最多等 2.5 秒
  const loadFresh = (frame) => new Promise((resolve) => {
    // 注意：更新 DOM 這段期間瀏覽器暫停畫面更新，requestAnimationFrame 不會觸發，不能拿它來等
    const token = `t=${Date.now()}`
    const started = performance.now()
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    setTimeout(finish, 2500)
    const poll = async () => {
      if (done) return
      const doc = frame.contentDocument
      if (doc && doc.location.search.includes(token) && doc.readyState !== 'loading' && doc.body) {
        prepare('curriculum')
        try { await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 600))]) } catch {}
        setTimeout(finish, 30)
        return
      }
      if (performance.now() - started > 2500) return
      setTimeout(poll, 25)
    }
    frame.src = `${CURRICULUM}?${token}`
    setTimeout(poll, 25)
  })
  const show = (name) => {
    Object.entries(pages).forEach(([key, frame]) => frame.classList.toggle('is-on', key === name))
    document.querySelectorAll('.vt-nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.go === name))
    current = name
  }

  const origin = (el) => {
    const r = el.getBoundingClientRect()
    return [r.left + r.width / 2, r.top + r.height / 2]
  }
  const defaultTrigger = () => {
    const link = document.querySelector('.vt-nav a[data-go="curriculum"]')
    return link.offsetParent ? link : document.querySelector('.vt-menu')
  }

  async function go (name, trigger) {
    if (busy || name === current || !pages[name]) return
    busy = true
    const enter = name === 'curriculum'
    const W = innerWidth, H = innerHeight
    root.style.setProperty('--vt-dur', `${(variant === 'c' ? 850 : 900) * (slow.checked ? 3 : 1)}ms`)
    const [ox, oy] = variant === 'b' ? origin(trigger || defaultTrigger()) : [W / 2, (H + 84) / 2]
    const far = Math.max(Math.hypot(ox, oy), Math.hypot(W - ox, oy), Math.hypot(ox, H - oy), Math.hypot(W - ox, H - oy))
    root.style.setProperty('--vt-x', `${ox}px`)
    root.style.setProperty('--vt-y', `${oy}px`)
    root.style.setProperty('--vt-s', `${Math.ceil(far / 0.24)}px`)
    root.style.setProperty('--vt-w', `${W}px`)
    const update = async () => { if (enter) await loadFresh(pages.curriculum); show(name) }
    try {
      if (!canTransition || variant === '0') { await update(); return }
      root.dataset.vtRun = enter ? 'enter' : 'leave'
      const t0 = performance.now()
      const transition = document.startViewTransition(update)
      await transition.ready
      const wait = Math.round(performance.now() - t0)
      await transition.finished
      if (enter) setNote(`　（等新頁 ${wait}ms）`)
    } finally {
      delete root.dataset.vtRun
      busy = false
    }
  }

  document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (event) => {
    event.preventDefault()
    if (el.getAttribute('aria-disabled')) return
    go(el.dataset.go, el)
  }))
  document.getElementById('vt-play').addEventListener('click', async () => {
    if (busy) return
    if (current === 'curriculum') { show('environment'); await new Promise((r) => setTimeout(r, 350)) }
    go('curriculum')
  })
})()
