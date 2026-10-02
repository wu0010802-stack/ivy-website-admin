// 關於常春藤頁的立體書動態（2026-09-29，使用者選定 J 立體書：design/about-style-directions-20260929/j-popup.*）。
// Motion（motion.dev）只在這頁動態載入，由 AboutContent.vue 傳進來；這支不 import motion 本體，只用型別。
// - 跨頁：右頁以書脊為軸，從闔上（-178°）翻到攤平；scroll() 把捲動進度寫進 --open（只在 901px 以上）。
//   2026-10-02 起右頁背面是章節封面；同時寫 --shade（立起來時紙面背光）與 --cast（還壓在左頁上方時，左頁靠書脊的影子）。
// - 卡紙：--up 0 平躺 → 1 站好，用 spring 寫進 CSS 變數；彈簧會超過 1 一點（往前晃一下）。
// - 一路走來：拉右頁下方的紙條，五個年份等距排在紙槽上；拉過哪一站、那一校就站起來，放手彈到最近一站。
//   紙條是 role="slider"，左右鍵一站一格、Home／End 到頭尾；連按以「正要去的那一站」為準。
//   到站的站點變實心；紙條動過（示範或讀者自己拉）之後，左頁沿革那一列跟著上色。
// - 全人教育：A2 六圈由 AboutWholePerson.vue 管理，收到 abk-open 後才播放。
// - 我們的期許：房子站好後，牆角的常春藤長出來（.abk-scene 加 is-grown）。
// - 家長怎麼說：swap() 讓大卡紙與後排小卡倒下、換內容、再站起來（AboutContent 換家長時呼叫）。
// 沒有 JS（或還沒載入）時 CSS 預設 --open:1、--up:1：書是攤開的、卡紙是站好的，內容全部看得到。
// 掛上時已經在視窗內的跨頁直接維持攤開，不闔上再翻（避免閃一下）。首屏跨頁（data-spread="static"）不翻。
// 減少動態：書攤開、卡紙站好、紙條拉到底，紙條操作直接跳格，六圈維持完成圖，常春藤直接長好，換家長直接換。
import type { animate as MotionAnimate, inView as MotionInView, scroll as MotionScroll } from 'motion'

export interface AboutPopupDeps {
  animate: typeof MotionAnimate
  scroll: typeof MotionScroll
  inView: typeof MotionInView
}
export interface AboutPopup {
  /** 卡紙倒下 → update() 換內容 → 依序站回來；減少動態時直接 update()。 */
  swap: (pops: HTMLElement[], update: () => void) => void
  destroy: () => void
}

/** 紙條位置 t（0–1）落在第幾站：等距的 n 站，四捨五入到最近一站。 */
export function pullIndex(t: number, stops: number) {
  if (stops < 2) return 0
  return Math.round(Math.min(1, Math.max(0, t)) * (stops - 1))
}

/** 捲動進度 p（0–1）→ 右頁翻開程度、紙面背光、壓在左頁的影子。翻開程度用 smoothstep，開頭與收尾比較慢。 */
export function turnState(p: number) {
  const t = Math.min(1, Math.max(0, p))
  const open = t * t * (3 - 2 * t)
  return {
    open,
    shade: Math.sin(Math.PI * open) * 0.55,
    cast: open < 0.5 ? Math.sin(Math.PI * open * 2) * 0.9 : 0
  }
}

export function createAboutPopup(root: HTMLElement, { animate, scroll, inView }: AboutPopupDeps, { reducedMotion }: { reducedMotion: boolean }): AboutPopup {
  const cleanups: (() => void)[] = []
  const running = new Set<{ stop: () => void }>()
  const wide = matchMedia('(min-width: 901px)').matches
  const inViewport = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }
  const later = (fn: () => void, ms: number) => { const timer = window.setTimeout(fn, ms); cleanups.push(() => clearTimeout(timer)) }
  root.classList.add('is-live')

  // from → to 的彈簧；減少動態時直接到終點
  type Control = { stop: () => void }
  const spring = (from: number, to: number, onUpdate: (v: number) => void, options: { bounce?: number, visualDuration?: number } = {}): Control | undefined => {
    if (reducedMotion || from === to) { onUpdate(to); return undefined }
    const control = animate(from, to, { type: 'spring', bounce: 0.5, visualDuration: 0.55, ...options, onUpdate })
    running.add(control)
    control.finished.then(() => running.delete(control), () => running.delete(control))
    return control
  }

  // ---------- 卡紙 ----------
  const upOf = new WeakMap<HTMLElement, number>()
  const aimOf = new WeakMap<HTMLElement, number>()
  const runOf = new WeakMap<HTMLElement, Control>()
  const setUp = (pop: HTMLElement, v: number) => { upOf.set(pop, v); pop.style.setProperty('--up', v.toFixed(3)) }
  // 同一張卡紙一次只跑一個彈簧：新的目標先停掉舊的；延遲啟動時目標已經改了就不跑
  const stand = (pop: HTMLElement, up: boolean, delay = 0) => {
    const to = up ? 1 : 0
    if (aimOf.get(pop) === to) return
    aimOf.set(pop, to)
    const run = () => {
      if (aimOf.get(pop) !== to) return
      runOf.get(pop)?.stop()
      const control = spring(upOf.get(pop) ?? 1, to, (v) => setUp(pop, v), up ? {} : { bounce: 0.15, visualDuration: 0.35 })
      if (control) runOf.set(pop, control)
    }
    if (delay && !reducedMotion) later(run, delay)
    else run()
  }
  const flat = (pop: HTMLElement) => { aimOf.set(pop, 0); setUp(pop, 0) }

  // ---------- 跨頁 ----------
  for (const spread of root.querySelectorAll<HTMLElement>('[data-spread]')) {
    if (spread.dataset.spread === 'static') continue
    const right = spread.querySelector<HTMLElement>('.abk-page.is-right')
    const pops = [...spread.querySelectorAll<HTMLElement>('[data-pop]')]
    const scene = spread.querySelector<HTMLElement>('.abk-scene')
    let opened = false
    const open = (instant: boolean) => {
      if (opened) return
      opened = true
      pops.forEach((pop, i) => (instant ? setUp(pop, 1) : stand(pop, true, i * 140)))
      if (scene) {
        if (instant || reducedMotion) scene.classList.add('is-grown')
        else later(() => scene.classList.add('is-grown'), 650)
      }
      spread.dispatchEvent(new CustomEvent('abk-open', { detail: { instant } }))
    }
    if (reducedMotion || inViewport(spread)) { open(true); continue }
    pops.forEach(flat)
    if (wide && right) {
      right.style.setProperty('--open', '0')
      cleanups.push(scroll((progress: number) => {
        const turn = turnState(progress)
        right.style.setProperty('--open', turn.open.toFixed(4))
        spread.style.setProperty('--shade', turn.shade.toFixed(3))
        spread.style.setProperty('--cast', turn.cast.toFixed(3))
        if (progress > 0.92) open(false)
      }, { target: spread, offset: ['start 0.95', 'start 0.3'] }))
    } else {
      cleanups.push(inView(spread.querySelector('.abk-stage, .abk-whole') ?? spread, () => { open(false) }, { amount: 0.4 }))
    }
  }

  // ---------- 一路走來：拉紙條 ----------
  const pull = root.querySelector<HTMLElement>('[data-pull]')
  const tab = pull?.querySelector<HTMLButtonElement>('[role="slider"]')
  const cards = [...root.querySelectorAll<HTMLElement>('[data-stop]')]
  if (pull && tab && cards.length) {
    const labels = cards.map((card) => card.dataset.stop ?? '')
    const years = cards.map((card) => Number(card.dataset.year))
    const stops = [...pull.querySelectorAll<HTMLElement>('.abk-stop')]
    const rows = [...root.querySelectorAll<HTMLElement>('.abk-list > li')]
    const n = cards.length
    let t = 0
    let index = -1
    let goal = 0
    let armed = false
    let moving: Control | undefined
    const set = (v: number) => {
      t = Math.min(1, Math.max(0, v))
      tab.style.setProperty('--pull', t.toFixed(4))
      const i = pullIndex(t, n)
      if (i !== index) {
        index = i
        tab.setAttribute('aria-valuenow', String(i + 1))
        tab.setAttribute('aria-valuetext', `${years[i]} ${labels[i]}`)
        stops.forEach((stop, k) => stop.classList.toggle('is-on', k <= i))
        rows.forEach((row, k) => row.classList.toggle('is-on', armed && k === i))
      }
      cards.forEach((card, k) => stand(card, k <= i))
    }
    // 左頁那一列的底色：紙條動過才開始跟（index 歸零讓下一次 set 重畫）
    const arm = () => { if (!armed) { armed = true; index = -1 } }
    const toStop = (i: number) => {
      goal = Math.min(n - 1, Math.max(0, i))
      moving?.stop()
      moving = spring(t, goal / (n - 1), set, { bounce: 0.35 })
    }
    let drag: { x: number, t: number, moved: boolean } | null = null
    const onDown = (e: PointerEvent) => { arm(); moving?.stop(); drag = { x: e.clientX, t, moved: false }; tab.setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      if (Math.abs(dx) > 4) drag.moved = true
      set(drag.t + dx / Math.max(1, pull.clientWidth - tab.offsetWidth))
    }
    const onUp = () => { if (!drag) return; const moved = drag.moved; drag = null; toStop(moved ? pullIndex(t, n) : pullIndex(t, n) + 1) }
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
      if (step) { e.preventDefault(); arm(); toStop(goal + step) }
      if (e.key === 'Home') { e.preventDefault(); arm(); toStop(0) }
      if (e.key === 'End') { e.preventDefault(); arm(); toStop(n - 1) }
    }
    tab.addEventListener('pointerdown', onDown)
    tab.addEventListener('pointermove', onMove)
    tab.addEventListener('pointerup', onUp)
    tab.addEventListener('pointercancel', onUp)
    tab.addEventListener('keydown', onKey)
    cleanups.push(() => {
      tab.removeEventListener('pointerdown', onDown)
      tab.removeEventListener('pointermove', onMove)
      tab.removeEventListener('pointerup', onUp)
      tab.removeEventListener('pointercancel', onUp)
      tab.removeEventListener('keydown', onKey)
    })
    const toEnd = () => { arm(); cards.forEach((card) => setUp(card, 1)); set(1); goal = n - 1 }
    // 翻開時示範：紙條自己拉到底，五校一校一校站起來；已經在視窗內（或減少動態）就直接拉到底
    const spread = pull.closest<HTMLElement>('[data-spread]')
    const demo = (e: Event) => {
      if ((e as CustomEvent<{ instant: boolean }>).detail?.instant || reducedMotion) { toEnd(); return }
      arm()
      later(() => {
        if (drag) return
        const control = animate(0, 1, { duration: 2.4, ease: [0.45, 0, 0.2, 1], onUpdate: (v: number) => { set(v); goal = pullIndex(v, n) } })
        running.add(control)
        moving = control
      }, 400)
    }
    if (spread) spread.addEventListener('abk-open', demo, { once: true })
    cards.forEach((card) => flat(card))
    set(0)
    // 掛上時就在視窗內（或減少動態）：翻開事件在上面那個迴圈裡已經發過，直接拉到底
    if (reducedMotion || (spread && inViewport(spread))) toEnd()
  }

  return {
    swap(pops, update) {
      if (reducedMotion) { update(); return }
      pops.forEach((pop) => stand(pop, false))
      later(() => {
        update()
        pops.forEach((pop, i) => stand(pop, true, i ? 120 + (i - 1) * 90 : 0))
      }, 280)
    },
    destroy() {
      cleanups.forEach((fn) => fn())
      running.forEach((control) => control.stop())
      root.classList.remove('is-live')
    }
  }
}
