// 資料照抄 web/server/data/site-fixture.json 的 news（日期與文案皆為範例）。
const ARTICLES = [
  { id: 'garden', date: '2026-09-16', campus: '義華校', title: '小小園丁，把好奇心種進生活裡。', image: 'garden', alt: '既有校園果樹情境照片' },
  { id: 'learning', date: '2026-09-12', campus: '義華校', title: '動手試試看，讓每個想法都有形狀。', image: 'learning', alt: '既有義華校學習活動情境照片' },
  { id: 'renwu', date: '2026-09-10', campus: '仁武校', title: '走進仁武校，認識孩子的成長空間。', image: 'renwu', alt: '仁武校既有校園外觀示意圖' },
  { id: 'minghua', date: '2026-09-08', campus: '明華校', title: '在明華，打開新學期的日常。', image: 'minghua', alt: '明華校既有校園照片' },
  { id: 'chongde', date: '2026-09-05', campus: '崇德校', title: '一起認識崇德校的每個小角落。', image: 'chongde', alt: '崇德校既有校園照片' },
  { id: 'international', date: '2026-09-03', campus: '國際校', title: '新朋友、新發現，校園生活開始了。', image: 'international', alt: '國際校既有校園照片' }
]
const EVENTS = [
  { date: '2026-09-26', month: 'SEP', campus: '全校', title: '秋季校園開放日' },
  { date: '2026-10-03', month: 'OCT', campus: '義華校', title: '親子共讀・故事的午後' },
  { date: '2026-10-17', month: 'OCT', campus: '全校', title: '一起出發！親子探索日' }
]
const N = ARTICLES.length
const LABELS = {
  a: ['A 緩慢漂移', '整排一直往左慢慢流（約 32px／秒），右側延伸到視窗邊緣露出下一張；最左邊那張滑進活動欄前淡出。滑鼠移上去會減速停住，可以直接拖曳或用觸控板左右滑。'],
  b: ['B 逐張推進', '每 4.5 秒整排往左推一張（1 秒），最左邊那張淡出、右側露出下一張的邊。標題旁的細線是倒數，停住時變灰。可以拖曳換張。'],
  c: ['C 原地換片', '卡片位置不動，每 6 秒三張由左到右依序換成下一組：新照片由上往下刷開（和近期活動卡的 hover 刷色同方向），文字上浮替換。']
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)')
const img = (key) => `../../web/public/assets/${key}.webp`
const fmt = (date) => date.replaceAll('-', '.')
const pad = (n) => String(n).padStart(2, '0')

function copyHTML(a) {
  return `<div class="hn-card-copy"><span class="hn-meta"><span>${a.campus}</span><time datetime="${a.date}">${fmt(a.date)}</time></span><h3><button type="button" aria-haspopup="dialog">${a.title}</button></h3></div>`
}
function cardHTML(a, clone = false) {
  // 複本只給循環接縫用：讀屏略過、Tab 略過，但滑鼠照樣點得到（不能用 inert，A 有一半時間畫面上是複本）。
  const html = `<article class="hn-card"${clone ? ' aria-hidden="true"' : ''}><div class="hn-media"><img src="${img(a.image)}" alt="${clone ? '' : a.alt}" draggable="false"></div>${copyHTML(a)}</article>`
  return clone ? html.replace('<button type="button"', '<button type="button" tabindex="-1"') : html
}
function eventsHTML() {
  return EVENTS.map((e) => `<button type="button" class="hn-event" aria-haspopup="dialog"><time class="hn-date" datetime="${e.date}"><b>${e.date.slice(-2)}</b><span lang="en">${e.month}</span></time><span class="hn-event-copy"><small>${e.campus}</small><strong>${e.title}</strong></span></button>`).join('')
}
function newsBody(v) {
  if (v === 'a') return `<div class="hn-viewport"><div class="hn-track">${ARTICLES.map((a) => cardHTML(a)).join('')}${ARTICLES.map((a) => cardHTML(a, true)).join('')}</div></div>`
  if (v === 'b') return `<div class="hn-viewport"><div class="hn-track">${ARTICLES.map((a) => cardHTML(a)).join('')}${ARTICLES.slice(0, 4).map((a) => cardHTML(a, true)).join('')}</div></div>`
  return `<div class="hn-cards">${ARTICLES.slice(0, 3).map((a) => `<article class="hn-card"><div class="hn-media"><img src="${img(a.image)}" alt="${a.alt}" draggable="false"></div><div class="hn-copy-stack">${copyHTML(a)}</div></article>`).join('')}</div>`
}
function sectionHTML(v) {
  const progress = v === 'a' ? '' : `<span class="hn-progress" aria-hidden="true"><span class="hn-count">01 / ${v === 'b' ? pad(N) : '02'}</span><i><b></b></i></span>`
  return `<div class="mk-label" id="mk-${v}"><div class="container"><strong>${LABELS[v][0]}</strong><p>${LABELS[v][1]}</p></div></div>
<section class="home-news" data-variant="${v}" aria-roledescription="輪播" aria-label="最新消息（${LABELS[v][0]}）">
  <div class="container">
    <div class="hn-layout">
      <aside class="hn-events">
        <div class="hn-head"><span class="hn-kicker" lang="en">UPCOMING EVENTS</span><h2>近期活動</h2></div>
        <div class="hn-event-stack">${eventsHTML()}</div>
        <button type="button" class="hn-more" aria-haspopup="dialog">所有活動</button>
      </aside>
      <div class="hn-news">
        <div class="hn-head hn-news-head">
          <div><span class="hn-kicker" lang="en">LATEST NEWS</span><h2>最新消息</h2></div>
          <div class="hn-head-end">${progress}<button type="button" class="hn-more" aria-haspopup="dialog">所有最新消息</button></div>
        </div>
        ${newsBody(v)}
      </div>
    </div>
    <p class="hn-sample-note">設計示意｜消息與活動日期均為範例，圖像取自既有校園素材，非上述消息實拍。</p>
  </div>
</section>`
}

// 暫停條件：滑鼠停在消息上、鍵盤焦點在消息裡、拖曳中、分頁在背景、區塊捲出畫面。
function pauser(section, zone) {
  const s = { hover: false, focus: false, drag: false, hidden: document.hidden, offscreen: true }
  zone.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') s.hover = true })
  zone.addEventListener('pointerleave', () => { s.hover = false })
  zone.addEventListener('focusin', (e) => { s.focus = e.target.matches(':focus-visible') })
  zone.addEventListener('focusout', (e) => { if (!zone.contains(e.relatedTarget)) s.focus = false })
  document.addEventListener('visibilitychange', () => { s.hidden = document.hidden })
  new IntersectionObserver(([entry]) => { s.offscreen = !entry.isIntersecting }, { threshold: 0.35 }).observe(section)
  return { s, get paused() { return s.hover || s.focus || s.drag || s.hidden || s.offscreen || reduce.matches } }
}

// 拖曳超過 6px 才接管指標，單純點擊仍會落在標題按鈕上。
function draggable(zone, p, { onStart, onMove, onEnd }) {
  let d = null
  let swallow = false
  zone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    d = { id: e.pointerId, x0: e.clientX, x: e.clientX, t: e.timeStamp, vel: 0, moved: false }
  })
  zone.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return
    if (!d.moved && Math.abs(e.clientX - d.x0) > 6) {
      d.moved = true
      zone.setPointerCapture(e.pointerId)
      zone.classList.add('is-dragging')
      p.s.drag = true
      onStart()
    }
    if (d.moved) {
      const dx = e.clientX - d.x
      d.vel = (dx / Math.max(1, e.timeStamp - d.t)) * 1000
      onMove(dx, e.clientX - d.x0)
    }
    d.x = e.clientX
    d.t = e.timeStamp
  })
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return
    if (d.moved) {
      swallow = true
      zone.classList.remove('is-dragging')
      p.s.drag = false
      onEnd(d.x - d.x0, d.vel)
    }
    d = null
  }
  zone.addEventListener('pointerup', end)
  zone.addEventListener('pointercancel', end)
  zone.addEventListener('click', (e) => {
    if (!swallow) return
    swallow = false
    e.preventDefault()
    e.stopPropagation()
  }, true)
}

function progressBar(section) {
  const el = section.querySelector('.hn-progress')
  const bar = el.querySelector('b')
  const count = el.querySelector('.hn-count')
  return {
    set(ratio, label, paused) {
      bar.style.transform = `scaleX(${Math.min(1, ratio)})`
      count.textContent = label
      el.toggleAttribute('data-paused', paused)
    }
  }
}

function initA(section) {
  const zone = section.querySelector('.hn-viewport')
  const track = zone.querySelector('.hn-track')
  const cards = [...track.children]
  const p = pauser(section, zone)
  const BASE = 32
  let x = 0, v = 0, fling = 0, step = 1, cardW = 1, dragging = false, last = performance.now()
  const measure = () => {
    cardW = cards[0].offsetWidth
    step = cards[1].offsetLeft - cards[0].offsetLeft
  }
  measure()
  addEventListener('resize', measure)
  draggable(zone, p, {
    onStart() { dragging = true; v = 0; fling = 0 },
    onMove(dx) { x += dx },
    onEnd(_total, vel) { dragging = false; fling = Math.max(-1600, Math.min(1600, -vel)) }
  })
  zone.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    x -= e.deltaX
  }, { passive: false })
  // overflow:clip 不會自己捲，Tab 到畫面外的卡片時把它拉到第一格。
  zone.addEventListener('focusin', (e) => {
    const k = cards.indexOf(e.target.closest('.hn-card'))
    const left = k * step + x
    if (k >= 0 && (left < 0 || left + cardW > zone.parentElement.clientWidth)) x = -k * step
  })
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000)
    last = t
    if (!dragging) {
      const target = p.paused ? 0 : BASE
      v += (target - v) * (1 - Math.exp(-dt / 0.45))
      fling *= Math.exp(-dt / 0.32)
      // 指數收斂永遠到不了 0，太慢就直接停，避免停住時還在次像素漂移讓字發糊。
      if (target === 0 && Math.abs(v) < 1.5) v = 0
      if (Math.abs(fling) < 1.5) fling = 0
      x -= (v + fling) * dt
    }
    const loop = step * N
    x = ((x % loop) - loop) % loop
    track.style.transform = `translate3d(${x}px,0,0)`
    for (let i = 0; i < cards.length; i++) {
      const left = i * step + x
      cards[i].style.opacity = left < 0 ? Math.max(0, 1 + left / (cardW * 0.6)).toFixed(3) : ''
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function initB(section) {
  const zone = section.querySelector('.hn-viewport')
  const track = zone.querySelector('.hn-track')
  const cards = [...track.children]
  const p = pauser(section, zone)
  const bar = progressBar(section)
  const INTERVAL = 4500
  let i = 0, elapsed = 0, moving = false, step = 1, drag = 0, last = performance.now(), wheelAcc = 0, wheelLock = 0
  const measure = () => { step = cards[1].offsetLeft - cards[0].offsetLeft; render(true) }
  function render(instant) {
    track.classList.toggle('is-instant', instant)
    track.style.transform = `translate3d(${-i * step + drag}px,0,0)`
    cards.forEach((card, k) => card.classList.toggle('is-past', k < i))
    if (instant) void track.offsetWidth
  }
  function go(to) {
    if (to < 0) { i = N; render(true); to = N - 1 }
    i = to
    elapsed = 0
    moving = true
    render(false)
    // 減少動態時沒有 transition，transitionend 不會來，直接收尾。
    if (reduce.matches) settle()
  }
  function settle() {
    moving = false
    if (i >= N) { i -= N; render(true) }
  }
  track.addEventListener('transitionend', (e) => {
    if (e.target === track && e.propertyName === 'transform') settle()
  })
  draggable(zone, p, {
    onStart() { track.classList.add('is-instant') },
    onMove(_dx, total) { drag = total; track.style.transform = `translate3d(${-i * step + drag}px,0,0)` },
    onEnd(total) {
      drag = 0
      track.classList.remove('is-instant')
      if (total < -60) go(i + 1)
      else if (total > 60) go(i - 1)
      else render(false)
    }
  })
  zone.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    if (e.timeStamp < wheelLock) return
    wheelAcc += e.deltaX
    if (Math.abs(wheelAcc) > 40) {
      go(wheelAcc > 0 ? i + 1 : i - 1)
      wheelAcc = 0
      wheelLock = e.timeStamp + 900
    }
  }, { passive: false })
  zone.addEventListener('focusin', (e) => {
    const k = cards.indexOf(e.target.closest('.hn-card'))
    if (k >= 0 && (k < i || k > i + 2)) go(k)
  })
  measure()
  addEventListener('resize', measure)
  function frame(t) {
    const dt = t - last
    last = t
    if (!p.paused && !moving) elapsed += dt
    if (elapsed >= INTERVAL) go(i + 1)
    bar.set(elapsed / INTERVAL, `${pad((i % N) + 1)} / ${pad(N)}`, p.paused)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function initC(section) {
  const zone = section.querySelector('.hn-cards')
  const slots = [...zone.children]
  const p = pauser(section, zone)
  const bar = progressBar(section)
  const INTERVAL = 6000
  const PAGES = Math.ceil(N / 3)
  let page = 0, elapsed = 0, busy = false, last = performance.now()
  const ease = 'cubic-bezier(.65,0,.35,1)'
  const settle = 'cubic-bezier(.22,.61,.36,1)'

  async function swap(slot, a, delay) {
    const media = slot.querySelector('.hn-media')
    const oldImg = media.querySelector('img')
    const next = new Image()
    next.src = img(a.image)
    next.alt = a.alt
    next.draggable = false
    next.className = 'is-incoming'
    await next.decode().catch(() => {})
    media.append(next)
    const stack = slot.querySelector('.hn-copy-stack')
    const oldCopy = stack.firstElementChild
    stack.insertAdjacentHTML('beforeend', copyHTML(a))
    const newCopy = stack.lastElementChild
    oldCopy.inert = true
    const wipe = next.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: 1000, delay, easing: ease, fill: 'both' })
    next.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 1700, delay, easing: settle, fill: 'both' })
    oldImg.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.03)', filter: 'brightness(.82)' }], { duration: 1000, delay, easing: ease, fill: 'forwards' })
    // 舊字完全淡掉（80→420ms）才開始上浮新字（460ms 起），兩行不會疊在一起。
    const out = oldCopy.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 340, delay: delay + 80, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    const into = newCopy.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: delay + 460, easing: settle, fill: 'backwards' })
    await Promise.all([wipe.finished, out.finished, into.finished])
    oldImg.remove()
    oldCopy.remove()
    next.classList.remove('is-incoming')
    next.getAnimations().forEach((anim) => { anim.commitStyles?.(); anim.cancel() })
    next.style.clipPath = ''
    next.style.transform = ''
  }
  async function turn() {
    busy = true
    page = (page + 1) % PAGES
    await Promise.all(slots.map((slot, k) => swap(slot, ARTICLES[(page * 3 + k) % N], k * 160)))
    busy = false
    elapsed = 0
  }
  function frame(t) {
    const dt = t - last
    last = t
    if (!p.paused && !busy) elapsed += dt
    if (elapsed >= INTERVAL && !busy) turn()
    bar.set(busy ? 1 : elapsed / INTERVAL, `${pad(page + 1)} / ${pad(PAGES)}`, p.paused)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

const only = new URLSearchParams(location.search).get('v')
const variants = ['a', 'b', 'c'].filter((v) => !only || v === only)
if (only) document.body.classList.add('is-single')
document.getElementById('stage').innerHTML = variants.map(sectionHTML).join('')
const init = { a: initA, b: initB, c: initC }
document.querySelectorAll('.home-news').forEach((section) => init[section.dataset.variant](section))
