// 內容取自 web/server/data/site-fixture.json 的 news（首頁只取前 3 則消息）
const ASSET = '../../web/public/assets/'
const events = [
  { id: 'visit', date: '2026-09-26', month: 'SEP', campus: '全校', title: '秋季校園開放日', description: '和孩子一起，來看看未來的日常。' },
  { id: 'family', date: '2026-10-03', month: 'OCT', campus: '義華校', title: '親子共讀・故事的午後', description: '一本繪本，開啟一段親子對話。' },
  { id: 'outdoor', date: '2026-10-17', month: 'OCT', campus: '全校', title: '一起出發！親子探索日', description: '在戶外發現身邊的小驚喜。' }
]
const articles = [
  { id: 'garden', date: '2026-09-16', campus: '義華校', title: '小小園丁，把好奇心種進生活裡。', src: 'responsive/garden-42efe2cb2b79-800.webp', alt: '既有校園果樹情境照片' },
  { id: 'learning', date: '2026-09-12', campus: '義華校', title: '動手試試看，讓每個想法都有形狀。', src: 'responsive/learning-253305c9887f-800.webp', alt: '既有義華校學習活動情境照片' },
  { id: 'renwu', date: '2026-09-10', campus: '仁武校', title: '走進仁武校，認識孩子的成長空間。', src: 'responsive/renwu-ab46d9df4a7f-800.webp', alt: '仁武校既有校園外觀示意圖' }
]
const SAMPLE_NOTE = '設計示意｜消息與活動日期均為範例，圖像取自既有校園素材，非上述消息實拍。'
// D：影片暫用官網既有素材剪段（hero-campus 為學校廣告修復片、day-film 為舞台表演），標題為範例
const films = [
  { id: 'run', title: '一起跑向前', kind: '戶外活動', src: 'hero-campus.mp4', start: 0, end: 9.7, poster: 'posters/film-1.webp' },
  { id: 'stage', title: '準備好了，上台！', kind: '舞台表演', yt: '', poster: 'posters/film-2.webp' },
  { id: 'dance', title: '大家一起來跳舞', kind: '舞台表演', src: 'day-film-mobile.mp4', start: 7.6, end: 12.2, poster: 'posters/film-3.webp' },
  { id: 'family', title: '跳給家人看', kind: '舞台表演', yt: '', poster: 'posters/film-4.webp' }
]
const FILM_NOTE = '設計示意｜影片為官網既有校園影片剪段；消息與日期為範例，圖像取自既有校園素材。'
// 支援 youtu.be、watch?v=、shorts、embed、live 五種網址
function youtubeId(url) {
  const m = String(url).trim().match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/)
  return m ? m[1] : (/^[\w-]{11}$/.test(String(url).trim()) ? String(url).trim() : '')
}
const ytThumb = f => f.yt ? `https://i.ytimg.com/vi/${f.yt}/hqdefault.jpg` : f.poster

// Phosphor Regular，路徑同 web/app/components/IconSprite.vue
const PATHS = {
  left: 'M224 128a8 8 0 0 1-8 8H59.31l58.35 58.34a8 8 0 0 1-11.32 11.32l-72-72a8 8 0 0 1 0-11.32l72-72a8 8 0 0 1 11.32 11.32L59.31 120H216a8 8 0 0 1 8 8',
  right: 'm221.66 133.66l-72 72a8 8 0 0 1-11.32-11.32L196.69 136H40a8 8 0 0 1 0-16h156.69l-58.35-58.34a8 8 0 0 1 11.32-11.32l72 72a8 8 0 0 1 0 11.32',
  play: 'M232.4 114.49L88.32 26.35a16 16 0 0 0-16.2-.3A15.86 15.86 0 0 0 64 39.87v176.26A15.94 15.94 0 0 0 80 232a16.07 16.07 0 0 0 8.36-2.35l144.04-88.14a15.81 15.81 0 0 0 0-27ZM80 215.94V40l143.83 88Z',
  pause: 'M200 32h-40a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176h-40V48h40ZM96 32H56a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176H56V48h40Z'
}
const icon = id => `<svg class="icon" viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="${PATHS[id]}"/></svg>`

const reduce = matchMedia('(prefers-reduced-motion: reduce)')
const easeOut = t => 1 - Math.pow(1 - t, 5)
const SLIDE_MS = 560
const AUTO_MS = 5000
const mod = (a, n) => ((a % n) + n) % n
const dot = d => d.replaceAll('-', '.')

const DIRS = [
  {
    key: 'd', letter: 'D', title: '活動影片＋消息直列', sub: '影片中央聚焦 · 白色圓點 · 無限循環；最新消息上下排列',
    points: [
      '近期活動換成「活動影片」：當前影片置中，左右露出前後一支（縮小變淡）。滑動、點圓點、點兩側影片都能換，最後一支接回第一支。圓點下方不放文字。',
      '<b>兩種影片混著放：</b>自己上傳的檔案（第 1、3 支）當前那支自動靜音循環預覽，右下有暫停鍵；<b>YouTube 連結</b>（第 2、4 支）先顯示縮圖＋播放鍵，點了才就地載入 YouTube 播放器、有聲播放，滑走就卸掉播放器（影片停止）。',
      'YouTube 不做自動預覽：每個播放器都要載入大量程式，開頭還會蓋標題與推薦影片。用 <code>youtube-nocookie.com</code> 嵌入、關閉推薦其他頻道。',
      '比例預設改 16:9（YouTube 原生比例，縮圖的上下黑邊剛好被裁掉）。若放 Shorts 直式影片，16:9 框裡會左右留黑，要改 4:5。',
      '圓點照參考圖：同樣大小，當前實心白、其他白色約 20%，所以影片區用參考圖的鼠尾草綠 <code>#acbe9b</code>；白點對綠底約 2:1。',
      '最新消息改成上下排列：左邊縮圖、右邊分校日期與標題，整列可點。可切「大圖直排」比較。',
      '播放 YouTube 時手指在影片上滑不會換片（觸控會被播放器吃掉），要點兩側露出的影片或圓點。'
    ]
  },
  {
    key: 'now', letter: '現', title: '現況：橫向捲動', sub: '原生捲動 · 右側露出下一張一角 · 不自動播放',
    points: ['比較像「可以滑的清單」：沒有頁碼、沒有換頁鈕，只靠右邊那一角暗示還有下一張。', '活動卡右側露出的是另一個顏色，容易被當成裝飾而不是「還有兩則」。']
  },
  {
    key: 'a', letter: 'A', title: '單張翻頁', sub: '一次一則滿版 · 圓點兼進度條 · 5 秒自動換',
    points: ['控制器照首頁分校輪播的膠囊圓點＋暫停鍵，家長在上一段剛用過一次。', '滿版後活動卡放得下說明文字，消息照片也是三版中最大。', '<b>要重新拍板：</b>09-16 定案寫明消息「不使用自動輪播」。這版兩個輪播錯開 2.5 秒換頁；也可以只留圓點、改成手動。']
  },
  {
    key: 'b', letter: 'B', title: '中央聚焦', sub: '當前置中 · 左右露出前後一則 · 無限循環 · 手動換',
    points: ['三則的位置一次看得到，往左往右都能滑，最後一則接回第一則。', '消息文字只在照片下方一處，跟著當前那則淡入換字；兩側只看到照片。', '兩側只露 36px 而且縮小變淡，看不到標題；箭頭在標題列右側，拇指要往上伸。']
  },
  {
    key: 'c', letter: 'C', title: '疊卡', sub: '一疊卡片 · 甩開最上面那張，它會塞回最底下 · 手動換',
    points: ['手感最強，往左往右甩都行；底下露出的色條直接告訴你還有幾張。', '跟「孩子的一天」拍立得同屬紙的語言，但只有底下兩張微微錯開，不貼膠帶。', '只有「下一張」一個方向（鍵盤 ← 才能退回）；卡片要等高，標題短的會留白。']
  }
]

// ── 卡片 ──
function evCard(e, i, style) {
  const date = `<time class="ev-date" datetime="${e.date}"><b>${e.date.slice(-2)}</b><span lang="en">${e.month}</span></time>`
  if (style === 'row') return `<button type="button" class="ev ev-row c${i}" data-open="${e.title}">${date}<span class="ev-copy"><small>${e.campus}</small><strong>${e.title}</strong></span></button>`
  return `<button type="button" class="ev ev-${style} c${i}" data-open="${e.title}"><span class="ev-top">${date}<span class="ev-campus">${e.campus}</span></span><span class="ev-copy"><strong>${e.title}</strong><span class="ev-desc">${e.description}</span></span></button>`
}
function newsCard(a, style) {
  const img = `<img src="${ASSET}${a.src}" alt="${a.alt}" draggable="false" data-img="${a.id}">`
  const meta = `<span class="meta"><span>${a.campus}</span><time datetime="${a.date}">${dot(a.date)}</time></span>`
  if (style === 'photo') return `<button type="button" class="nc nc-photo" data-open="${a.title}" aria-label="${a.title}">${img}</button>`
  if (style === 'paper') return `<article class="nc nc-paper">${img}<div class="nc-copy">${meta}<h3><button type="button" data-open="${a.title}">${a.title}</button></h3></div></article>`
  return `<article class="nc">${img}<div class="nc-copy">${meta}<h3><button type="button" data-open="${a.title}">${a.title}</button></h3></div></article>`
}

// 影片卡：只有當前那支載入播放，其他停在海報
function filmCard(f) {
  if ('yt' in f) return `<div class="film" data-type="youtube"><button type="button" class="film-open" data-yt="${f.yt}" aria-label="在 YouTube 播放「${f.title}」"><img class="yt-thumb" src="${ytThumb(f)}" alt="" draggable="false"><span class="yt-play" aria-hidden="true">${icon('play')}</span></button></div>`
  return `<div class="film" data-type="file"><button type="button" class="film-open" data-open="${f.title}" aria-label="播放「${f.title}」完整影片"><video muted playsinline loop preload="none" poster="${f.poster}" data-src="${ASSET}${f.src}#t=${f.start}" data-start="${f.start}" data-end="${f.end}"></video></button><button type="button" class="film-toggle" data-film-toggle aria-label="暫停影片">${icon('pause')}</button></div>`
}
function newsRow(a) {
  return `<li class="nr"><img src="${ASSET}${a.src}" alt="${a.alt}" data-img="${a.id}"><div class="nr-copy"><span class="meta"><span>${a.campus}</span><time datetime="${a.date}">${dot(a.date)}</time></span><h3><button type="button" data-open="${a.title}">${a.title}</button></h3></div></li>`
}
const filmDots = n => `<div class="film-dots" role="group" aria-label="選擇影片">${Array.from({ length: n }, (_, i) => `<button type="button" class="fdot" data-dot="${i}" aria-label="第 ${i + 1} 支影片"></button>`).join('')}</div>`

const head = (kicker, title, id, side = '') => `<div class="hn-head${side ? ' split' : ''}"><div><span class="kicker" lang="en">${kicker}</span><h2 id="${id}">${title}</h2></div>${side}</div>`
const more = (label, cls = '') => `<a class="more ${cls}" href="#" data-open="${label}">${label}</a>`
const slides = (cards, n = cards.length) => cards.map((c, i) => `<div class="slide" role="group" aria-roledescription="投影片" aria-label="${i + 1} / ${n}">${c}</div>`).join('')
const viewport = inner => `<div class="car-viewport"><div class="car-track">${inner}</div></div>`
const region = (mode, kind, labelId, inner) => `<div class="car car-${mode}" data-mode="${mode}" data-kind="${kind}" role="region" aria-roledescription="輪播" aria-labelledby="${labelId}">${inner}</div>`
const count = n => `<span class="count" data-count aria-hidden="true"><b>1</b> / ${n}</span>`
const pager = (n, label) => `<div class="pager" role="group" aria-label="${label}">${Array.from({ length: n }, (_, i) => `<button type="button" class="dot" data-dot="${i}" aria-label="第 ${i + 1} 則"><span class="track"><i></i></span></button>`).join('')}</div>`
const play = () => `<button type="button" class="round" data-play aria-label="暫停自動播放">${icon('pause')}</button>`
const arrows = n => `<div class="arrows"><button type="button" class="round" data-prev aria-label="上一則">${icon('left')}</button>${count(n)}<button type="button" class="round" data-next aria-label="下一則">${icon('right')}</button></div>`

function section(key, uid) {
  const E = `${uid}-events`, N = `${uid}-news`
  let ev, nw
  if (key === 'now') {
    ev = `${head('UPCOMING EVENTS', '近期活動', E)}<div class="strip">${events.map((e, i) => evCard(e, i, 'row')).join('')}</div>${more('所有活動')}`
    nw = `${head('LATEST NEWS', '最新消息', N, more('所有最新消息'))}<div class="strip">${articles.map(a => newsCard(a, 'plain')).join('')}</div>`
  } else if (key === 'a') {
    ev = region('a', 'events', E, `${head('UPCOMING EVENTS', '近期活動', E)}${viewport(slides(events.map((e, i) => evCard(e, i, 'big'))))}<div class="ctrl"><div class="ctrl-group">${pager(3, '近期活動輪播進度')}${play()}</div>${more('所有活動')}</div>`)
    nw = region('a', 'news', N, `${head('LATEST NEWS', '最新消息', N)}${viewport(slides(articles.map(a => newsCard(a, 'plain'))))}<div class="ctrl"><div class="ctrl-group">${pager(3, '最新消息輪播進度')}${play()}</div>${more('所有最新消息')}</div>`)
  } else if (key === 'b') {
    ev = region('b', 'events', E, `${head('UPCOMING EVENTS', '近期活動', E, arrows(3))}${viewport(slides(events.map((e, i) => evCard(e, i, 'tall'))))}<div class="b-foot">${more('所有活動')}</div>`)
    nw = region('b', 'news', N, `${head('LATEST NEWS', '最新消息', N, arrows(3))}${viewport(slides(articles.map(a => newsCard(a, 'photo'))))}<div class="b-caption" data-caption aria-live="off"></div><div class="b-foot">${more('所有最新消息')}</div>`)
  } else if (key === 'd') {
    ev = `<div class="car car-b car-films" data-mode="b" data-kind="films" data-frac="0.8" data-fade="0.3" role="region" aria-roledescription="輪播" aria-labelledby="${E}">${head('CAMPUS FILMS', '活動影片', E)}${viewport(slides(films.map(filmCard)))}${filmDots(films.length)}<div class="b-foot">${more('更多活動影片')}</div></div>`
    nw = `${head('LATEST NEWS', '最新消息', N, more('所有最新消息'))}<ul class="news-list" data-list="rows">${articles.map(newsRow).join('')}</ul>`
    return `<section class="hn hn-d" data-ratio="16x9" aria-label="活動影片與最新消息"><div class="hn-block hn-events">${ev}</div><div class="hn-block hn-news">${nw}</div><p class="sample-note">${FILM_NOTE}</p></section>`
  } else {
    const foot = label => `<div class="ctrl c-ctrl">${more(label)}<div class="ctrl-group"><span class="hint" data-hint>滑開看下一張</span>${count(3)}<button type="button" class="round" data-next aria-label="下一張">${icon('right')}</button></div></div>`
    ev = region('c', 'events', E, `${head('UPCOMING EVENTS', '近期活動', E)}${viewport(slides(events.map((e, i) => evCard(e, i, 'big'))))}${foot('所有活動')}`)
    nw = region('c', 'news', N, `${head('LATEST NEWS', '最新消息', N)}${viewport(slides(articles.map(a => newsCard(a, 'paper'))))}${foot('所有最新消息')}`)
  }
  return `<section class="hn hn-${key}" aria-label="近期活動與最新消息"><div class="hn-block hn-events">${ev}</div><div class="hn-block hn-news">${nw}</div><p class="sample-note">${SAMPLE_NOTE}</p></section>`
}

// ── 共用：宣告、點卡片 ──
const live = document.getElementById('live')
function announce(root, i, n) {
  const label = root.querySelector('h2')?.textContent ?? ''
  const title = root.querySelectorAll('.slide')[i]?.querySelector('[data-open]')?.dataset.open ?? ''
  live.textContent = `${label}第 ${i + 1} 則，共 ${n} 則：${title}`
}
function toast(phone, text, what = '') {
  const t = phone.querySelector('.toast')
  t.textContent = what ? `示意：「${text}」${what}` : `示意：開啟「${text}」，正式版沿用現有對話框`
  t.classList.add('on')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.remove('on'), 1800)
}

// 拖曳手勢：水平意圖才接手，垂直留給頁面捲動
function swipe(el, { start, move, end }) {
  let d = null
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    d = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, samples: [] }
    start?.(d)
  })
  el.addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d = null; end?.(null); return }
      if (Math.abs(dx) < 6) return
      d.moved = true
      d.x = e.clientX
      el.setPointerCapture(e.pointerId)
    }
    d.samples.push([performance.now(), e.clientX])
    if (d.samples.length > 6) d.samples.shift()
    move(e.clientX - d.x, d)
  })
  const finish = e => {
    if (!d || e.pointerId !== d.id) return
    const done = d; d = null
    const s = done.samples
    const v = s.length > 1 ? (s.at(-1)[1] - s[0][1]) / Math.max(1, s.at(-1)[0] - s[0][0]) : 0
    if (done.moved) { el._dragged = true; setTimeout(() => { el._dragged = false }, 60) }
    end?.(done.moved ? { dx: e.clientX - done.x, v } : null)
  }
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)
  el.addEventListener('click', e => { if (el._dragged) { e.preventDefault(); e.stopPropagation(); el._dragged = false } }, true)
}

// ── A／B：連續位置 p，A 是滑軌、B 是環形置中 ──
class Slider {
  constructor(root) {
    this.root = root
    this.mode = root.dataset.mode
    this.vp = root.querySelector('.car-viewport')
    this.track = root.querySelector('.car-track')
    this.slides = [...this.track.children]
    this.n = this.slides.length
    this.p = 0; this.target = 0; this.index = -1
    this.auto = this.mode === 'a'
    this.playing = this.auto && !reduce.matches
    this.progress = root.dataset.kind === 'news' ? -0.5 : 0 // 兩個輪播錯開半拍
    this.held = false; this.focusHeld = false; this.visible = true
    this.dots = [...root.querySelectorAll('[data-dot]')]
    this.playBtn = root.querySelector('[data-play]')
    this.countEl = root.querySelector('[data-count] b')
    this.caption = root.querySelector('[data-caption]')
    this.frac = Number(root.dataset.frac || 0.733)
    this.fade = Number(root.dataset.fade || 0.45)
    this.videos = this.slides.map(s => s.querySelector('video'))
    this.filmOn = !reduce.matches
    this.videos.forEach(v => v?.addEventListener('timeupdate', () => { if (v.currentTime >= Number(v.dataset.end)) v.currentTime = Number(v.dataset.start) }))
    this.measure()
    new ResizeObserver(() => { this.measure(); this.render() }).observe(this.vp)
    this.bind()
    this.setIndex(0, false)
    this.render()
    this.syncPlay()
  }
  measure() {
    const w = this.vp.clientWidth
    if (this.mode === 'a') { this.step = w + 12; return }
    this.slideW = Math.round(w * this.frac)
    this.step = this.slideW / 2 + 14 + (this.slideW * 0.9) / 2
    this.root.style.setProperty('--slide-w', `${this.slideW}px`)
  }
  render() {
    if (this.mode === 'a') { this.track.style.transform = `translate3d(${-this.p * this.step}px,0,0)`; return }
    const n = this.n
    this.slides.forEach((s, k) => {
      const d = mod(k - this.p + n / 2, n) - n / 2
      const a = Math.min(Math.abs(d), 1)
      s.style.transform = `translate3d(${(d * this.step).toFixed(2)}px,0,0) scale(${(1 - 0.1 * a).toFixed(4)})`
      s.style.opacity = (1 - this.fade * a).toFixed(3)
      s.style.setProperty('--a', a.toFixed(3))
      s.style.zIndex = String(10 - Math.round(Math.abs(d) * 2))
    })
  }
  go(target, user) {
    if (this.mode === 'a') target = Math.max(0, Math.min(this.n - 1, target))
    this.target = target
    const from = this.p, t0 = performance.now(), dur = reduce.matches ? 0 : SLIDE_MS
    cancelAnimationFrame(this.raf)
    const tick = now => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1
      this.p = from + (target - from) * easeOut(t)
      this.render()
      if (t < 1) this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
    this.setIndex(mod(Math.round(target), this.n), user)
  }
  step1(dir, user) { this.go(Math.round(this.target) + dir, user) }
  goIndex(i, user) {
    if (this.mode === 'a') return this.go(i, user)
    let delta = mod(i - mod(Math.round(this.target), this.n), this.n)
    if (delta > this.n / 2) delta -= this.n
    this.go(Math.round(this.target) + delta, user)
  }
  setIndex(i, user) {
    if (i === this.index) return
    this.index = i
    if (this.progress > 0) this.progress = 0
    this.dots.forEach((d, k) => { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current') })
    this.slides.forEach((s, k) => { s.inert = k !== i; s.setAttribute('aria-hidden', String(k !== i)) })
    if (this.countEl) this.countEl.textContent = String(i + 1)
    if (this.caption) this.writeCaption(i)
    const v = this.videos[i]
    if (v?.src) v.currentTime = Number(v.dataset.start)
    this.slides.forEach((s, k) => { if (k !== i) this.stopYouTube(k) })
    this.syncVideos()
    if (user) announce(this.root, i, this.n)
  }
  stopYouTube(k) {
    const open = this.slides[k].querySelector('.film[data-type="youtube"].is-live')
    if (!open) return
    open.classList.remove('is-live')
    open.querySelector('iframe')?.remove()
  }
  playYouTube(k) {
    const film = this.slides[k].querySelector('.film[data-type="youtube"]')
    const id = film.querySelector('.film-open').dataset.yt
    if (!id) return false
    film.classList.add('is-live')
    film.insertAdjacentHTML('beforeend', `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0" title="${films[k].title}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`)
    film.querySelector('iframe').focus()
    return true
  }
  syncVideos() {
    if (!this.videos.some(Boolean)) return
    const run = this.filmOn && this.visible && !document.hidden
    this.videos.forEach((v, k) => {
      if (!v) return
      if (k === this.index && run) {
        if (!v.src) v.src = v.dataset.src
        v.play().catch(() => {})
      } else if (!v.paused) v.pause()
    })
    this.root.querySelectorAll('[data-film-toggle]').forEach(b => {
      b.innerHTML = icon(this.filmOn ? 'pause' : 'play')
      b.setAttribute('aria-label', this.filmOn ? '暫停影片' : '播放影片')
    })
  }
  writeCaption(i) {
    const c = this.caption
    c.classList.remove('in')
    if (this.root.dataset.kind === 'films') {
      const f = films[i]
      c.innerHTML = `<span class="meta"><span>${f.kind}</span></span><h3><button type="button" data-open="${f.title}">${f.title}</button></h3>`
    } else {
      const a = articles[i]
      c.innerHTML = `<span class="meta"><span>${a.campus}</span><time datetime="${a.date}">${dot(a.date)}</time></span><h3><button type="button" data-open="${a.title}">${a.title}</button></h3>`
    }
    void c.offsetWidth
    c.classList.add('in')
  }
  syncPlay() {
    if (!this.playBtn) return
    this.playBtn.innerHTML = icon(this.playing ? 'pause' : 'play')
    this.playBtn.setAttribute('aria-label', this.playing ? '暫停自動播放' : '開始自動播放')
    this.root.classList.toggle('is-playing', this.playing)
  }
  tick(dt) {
    if (!this.auto) return
    const running = this.playing && !this.held && !this.focusHeld && this.visible && !document.hidden
    if (running) {
      this.progress += dt / AUTO_MS
      if (this.progress >= 1) { this.progress = 0; this.go(this.index === this.n - 1 ? 0 : this.index + 1, false) }
    }
    const shown = this.playing ? Math.max(0, this.progress) : 1
    this.dots.forEach((d, k) => d.style.setProperty('--prog', k === this.index ? shown.toFixed(4) : '0'))
  }
  bind() {
    let p0 = null
    swipe(this.vp, {
      start: () => { this.held = true },
      move: dx => {
        if (p0 === null) { p0 = this.p; cancelAnimationFrame(this.raf) }
        let p = p0 - dx / this.step
        if (this.mode === 'a') { const max = this.n - 1; if (p < 0) p *= 0.3; else if (p > max) p = max + (p - max) * 0.3 }
        this.p = p
        this.render()
      },
      end: r => {
        this.held = false
        const base = p0
        p0 = null
        if (!r || base === null) return
        let target = Math.round(this.p)
        if (Math.abs(r.v) > 0.3) target = r.v < 0 ? Math.floor(this.p) + 1 : Math.ceil(this.p) - 1
        const b = Math.round(base)
        this.go(Math.max(b - 1, Math.min(b + 1, target)), true)
      }
    })
    this.root.addEventListener('click', e => {
      const b = e.target.closest('button,a'); if (!b) return
      if (b.matches('[data-prev]')) this.step1(-1, true)
      else if (b.matches('[data-next]')) this.step1(1, true)
      else if (b.matches('[data-dot]')) this.goIndex(Number(b.dataset.dot), true)
      else if (b.matches('[data-play]')) { this.playing = !this.playing; this.progress = 0; this.syncPlay() }
      else if (b.matches('[data-film-toggle]')) { e.stopPropagation(); this.filmOn = !this.filmOn; this.syncVideos() }
      else if (b.matches('[data-yt]')) {
        e.stopPropagation()
        if (!this.playYouTube(this.index)) toast(b.closest('.phone'), films[this.index].title, '這格是 YouTube：點了會就地載入 YouTube 播放器、有聲播放（右側貼上連結可實測）')
      }
    })
    // 點兩側露出的卡（inert，點擊落在軌道上）就往那邊換一張
    this.vp.addEventListener('click', e => {
      if (this.mode !== 'b' || e.defaultPrevented || e.target.closest('.slide:not([inert])')) return
      const r = this.vp.getBoundingClientRect()
      this.step1(e.clientX < r.left + r.width / 2 ? -1 : 1, true)
    })
    document.addEventListener('visibilitychange', () => this.syncVideos())
    this.root.addEventListener('keydown', e => {
      if (e.target.closest('a')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step1(1, true) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step1(-1, true) }
      else if (this.mode === 'a' && e.key === 'Home') { e.preventDefault(); this.go(0, true) }
      else if (this.mode === 'a' && e.key === 'End') { e.preventDefault(); this.go(this.n - 1, true) }
    })
    this.root.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) this.focusHeld = true })
    this.root.addEventListener('focusout', e => { if (!this.root.contains(e.relatedTarget)) this.focusHeld = false })
    const screen = this.root.closest('.screen')
    const scrolls = screen && getComputedStyle(screen).overflowY !== 'visible'
    new IntersectionObserver(([en]) => { this.visible = en.intersectionRatio >= 0.6; this.syncVideos() }, { root: scrolls ? screen : null, threshold: [0, 0.6, 1] }).observe(this.vp)
  }
}

// ── C：疊卡，離散狀態＋CSS transition ──
class Deck {
  constructor(root) {
    this.root = root
    this.vp = root.querySelector('.car-viewport')
    this.slides = [...root.querySelectorAll('.slide')]
    this.n = this.slides.length
    this.order = this.slides.map((_, i) => i)
    this.countEl = root.querySelector('[data-count] b')
    this.hint = root.querySelector('[data-hint]')
    this.bind()
    this.render()
  }
  place(s, depth, dx = 0) {
    const tilt = [0, -2.2, 1.8][depth] ?? 0
    const rot = depth === 0 ? Math.max(-12, Math.min(12, dx / 22)) : tilt
    s.style.transform = `translate3d(${depth === 0 ? dx : 0}px,${depth * 13}px,0) rotate(${rot}deg) scale(${1 - depth * 0.045})`
    s.style.zIndex = String(10 - depth)
    s.style.opacity = depth > 2 ? '0' : '1'
  }
  render(dx = 0) {
    this.slides.forEach((s, k) => {
      const depth = this.order.indexOf(k)
      this.place(s, depth, dx)
      s.inert = depth !== 0
      s.setAttribute('aria-hidden', String(depth !== 0))
      s.classList.toggle('is-top', depth === 0)
    })
    if (this.countEl) this.countEl.textContent = String(this.order[0] + 1)
  }
  used() { this.hint?.classList.add('gone') }
  next(dir = -1, user = true) {
    if (this.busy) return
    this.used()
    const top = this.slides[this.order[0]]
    const w = this.vp.clientWidth
    const finish = () => {
      this.order.push(this.order.shift())
      top.style.zIndex = '0'
      top.style.transition = ''
      this.render()
      this.busy = false
      if (user) announce(this.root, this.order[0], this.n)
    }
    if (reduce.matches) { finish(); return }
    this.busy = true
    top.style.transition = 'transform .34s cubic-bezier(.22,1,.36,1)'
    top.style.transform = `translate3d(${dir * (w + 70)}px,-8px,0) rotate(${dir * 16}deg)`
    setTimeout(finish, 300)
  }
  prev(user = true) {
    if (this.busy) return
    this.used()
    const k = this.order.pop()
    this.order.unshift(k)
    const s = this.slides[k]
    if (!reduce.matches) {
      s.style.transition = 'none'
      s.style.zIndex = '20'
      s.style.transform = `translate3d(${-(this.vp.clientWidth + 70)}px,-8px,0) rotate(-16deg)`
      void s.offsetWidth
      s.style.transition = ''
    }
    this.render()
    if (user) announce(this.root, this.order[0], this.n)
  }
  bind() {
    swipe(this.vp, {
      move: dx => {
        const top = this.slides[this.order[0]]
        top.style.transition = 'none'
        this.place(top, 0, dx)
      },
      end: r => {
        const top = this.slides[this.order[0]]
        top.style.transition = ''
        if (!r) return this.render()
        const w = this.vp.clientWidth
        if (Math.abs(r.dx) > w * 0.28 || Math.abs(r.v) > 0.45) this.next(Math.sign(r.dx || r.v) || -1)
        else this.render()
      }
    })
    this.root.addEventListener('click', e => {
      if (e.target.closest('[data-next]')) this.next(-1)
    })
    this.root.addEventListener('keydown', e => {
      if (e.target.closest('a')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(-1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev() }
    })
  }
}

// ── 版面 ──
const params = new URLSearchParams(location.search)
const view = ['now', 'a', 'b', 'c', 'd', 'all'].includes(params.get('view')) ? params.get('view') : 'd'
document.body.dataset.view = view
document.querySelectorAll('[data-view]').forEach(a => { if (a.tagName === 'A' && a.dataset.view === view) a.setAttribute('aria-current', 'page') })

const host = document.querySelector('.directions')
const shown = view === 'all' ? DIRS.filter(d => 'abc'.includes(d.key)) : DIRS.filter(d => d.key === view)
// D 的兩個待定項：影片比例、消息排列（網址參數可分享）
const RATIOS = [['16x9', '16:9'], ['4x3', '4:3'], ['4x5', '4:5 直式']]
const LISTS = [['rows', '縮圖列表'], ['cards', '大圖直排']]
const toggles = () => `<div class="toggles">
  <div class="tg" role="group" aria-label="影片比例"><span>影片比例</span>${RATIOS.map(([k, t]) => `<button type="button" data-set-ratio="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
  <div class="tg" role="group" aria-label="最新消息排列"><span>消息排列</span>${LISTS.map(([k, t]) => `<button type="button" data-set-list="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
  <form class="tg tg-yt" data-yt-form novalidate><label for="yt-url">YouTube</label><input id="yt-url" type="url" inputmode="url" autocomplete="off" placeholder="貼上影片連結，例如 https://youtu.be/…"><button type="submit">套用到目前這支</button><p class="yt-msg" role="status"></p></form>
</div>`
host.innerHTML = shown.map(d => `
  <article class="direction" data-key="${d.key}">
    <header class="direction-head"><span class="letter">${d.letter}</span><div><h2>${d.title}</h2><p>${d.sub}</p></div></header>
    <div class="phone"><div class="screen">${section(d.key, `s-${d.key}`)}</div><div class="toast" role="status"></div></div>
    <div class="description">${d.key === 'd' ? toggles() : ''}<ul>${d.points.map(p => `<li>${p}</li>`).join('')}</ul><p class="metric" data-metric></p></div>
  </article>`).join('')

const sliders = [...document.querySelectorAll('.car-a, .car-b')].map(el => new Slider(el))
document.querySelectorAll('.car-c').forEach(el => new Deck(el))

document.querySelectorAll('.phone').forEach(phone => {
  phone.addEventListener('click', e => {
    const t = e.target.closest('[data-open]')
    if (!t) return
    e.preventDefault()
    toast(phone, t.dataset.open, t.matches('.film-open') ? '播放完整影片（有聲、可全螢幕）' : '')
  })
})

function applyD({ ratio, list }) {
  const hn = document.querySelector('.hn-d')
  if (!hn) return
  if (ratio) hn.dataset.ratio = ratio
  if (list) hn.querySelector('.news-list').dataset.list = list
  document.querySelectorAll('[data-set-ratio]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setRatio === hn.dataset.ratio)))
  document.querySelectorAll('[data-set-list]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setList === hn.querySelector('.news-list').dataset.list)))
  const q = new URLSearchParams(location.search)
  q.set('view', 'd'); q.set('ratio', hn.dataset.ratio); q.set('list', hn.querySelector('.news-list').dataset.list)
  history.replaceState(null, '', `?${q}`)
  requestAnimationFrame(metrics)
}
if (view === 'd') {
  applyD({ ratio: RATIOS.some(([k]) => k === params.get('ratio')) ? params.get('ratio') : null, list: LISTS.some(([k]) => k === params.get('list')) ? params.get('list') : null })
  document.querySelector('.toggles').addEventListener('click', e => {
    const b = e.target.closest('button[data-set-ratio],button[data-set-list]'); if (!b) return
    applyD({ ratio: b.dataset.setRatio, list: b.dataset.setList })
  })
  document.querySelector('[data-yt-form]').addEventListener('submit', e => {
    e.preventDefault()
    const input = e.currentTarget.querySelector('input'), msg = e.currentTarget.querySelector('.yt-msg')
    const id = youtubeId(input.value)
    if (!id) { msg.textContent = '看不懂這個連結，請貼 YouTube 影片網址（youtu.be、watch?v=、shorts 都可以）'; return }
    const s = sliders.find(x => x.root.dataset.kind === 'films'), i = s.index
    s.stopYouTube(i)
    films[i] = { id: films[i].id, title: films[i].title, kind: films[i].kind, yt: id, poster: films[i].poster }
    s.slides[i].innerHTML = filmCard(films[i])
    s.videos[i]?.pause(); s.videos[i] = null
    msg.textContent = `已把第 ${i + 1} 支換成 YouTube（${id}），點手機裡的影片播放`
    input.value = ''
  })
}

let last = performance.now()
function frame(now) {
  const dt = Math.min(64, now - last); last = now
  sliders.forEach(s => s.tick(dt))
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 區塊高度：輪播的主要好處是縮短捲動距離
function metrics() {
  // 另外量一份現況當基準（不顯示）
  const probe = document.createElement('div')
  probe.className = 'screen probe'
  probe.innerHTML = section('now', 'probe')
  document.body.append(probe)
  const base = probe.querySelector('.hn').offsetHeight
  probe.remove()
  document.querySelectorAll('.direction').forEach(d => {
    const h = d.querySelector('.hn').offsetHeight
    const diff = h - base
    d.querySelector('[data-metric]').textContent = d.dataset.key === 'now'
      ? `區塊高度 ${h.toLocaleString()}px，約 ${(h / 844).toFixed(2)} 個畫面`
      : `區塊高度 ${h.toLocaleString()}px，約 ${(h / 844).toFixed(2)} 個畫面（現況 ${base.toLocaleString()}px，${diff >= 0 ? '多' : '少'} ${Math.abs(diff)}px）`
  })
}
document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode().catch(() => {})))).then(metrics)
