// 關於常春藤頁的立體書動態（2026-09-29，使用者選定 J 立體書：design/about-style-directions-20260929/j-popup.*）。
// Motion（motion.dev）只在這頁動態載入，由 AboutContent.vue 傳進來；這支不 import motion 本體，只用型別。
// - 跨頁：右頁以書脊為軸，從闔上（-178°）翻到攤平；scroll() 把捲動進度寫進 --open（只在 901px 以上）。
// - 卡紙：--up 0 平躺 → 1 站好，用 spring 寫進 CSS 變數；彈簧會超過 1 一點（往前晃一下）。
// - 一路走來：拉右頁下方的紙條，五個年份等距排在軌道上；拉過哪一站、那一校就站起來，放手彈到最近一站。
//   紙條是 role="slider"，左右鍵一站一格、Home／End 到頭尾。
// - 全人教育：A2 六圈由 AboutWholePerson.vue 管理，收到 abk-open 後才播放。
// 沒有 JS（或還沒載入）時 CSS 預設 --open:1、--up:1：書是攤開的、卡紙是站好的，內容全部看得到。
// 掛上時已經在視窗內的跨頁直接維持攤開，不闔上再翻（避免閃一下）。首屏跨頁（data-spread="static"）不翻。
// 減少動態：書攤開、卡紙站好、紙條拉到底，紙條操作直接跳格，六圈維持完成圖。
import type { animate as MotionAnimate, inView as MotionInView, scroll as MotionScroll } from 'motion'

export interface AboutPopupDeps {
  animate: typeof MotionAnimate
  scroll: typeof MotionScroll
  inView: typeof MotionInView
}
export interface AboutPopup { destroy: () => void }

/** 紙條位置 t（0–1）落在第幾站：等距的 n 站，四捨五入到最近一站。 */
export function pullIndex(t: number, stops: number) {
  if (stops < 2) return 0
  return Math.round(Math.min(1, Math.max(0, t)) * (stops - 1))
}
export function createAboutPopup(root: HTMLElement, { animate, scroll, inView }: AboutPopupDeps, { reducedMotion }: { reducedMotion: boolean }): AboutPopup {
  const cleanups: (() => void)[] = []
  const running = new Set<{ stop: () => void }>()
  const wide = matchMedia('(min-width: 901px)').matches
  const inViewport = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }
  root.classList.add('is-live')

  // from → to 的彈簧；減少動態時直接到終點
  const spring = (from: number, to: number, onUpdate: (v: number) => void, options: { bounce?: number, visualDuration?: number } = {}) => {
    if (reducedMotion || from === to) { onUpdate(to); return }
    const control = animate(from, to, { type: 'spring', bounce: 0.5, visualDuration: 0.55, ...options, onUpdate })
    running.add(control)
    control.finished.then(() => running.delete(control), () => running.delete(control))
  }

  // ---------- 卡紙 ----------
  const upOf = new WeakMap<HTMLElement, number>()
  const aimOf = new WeakMap<HTMLElement, number>()
  const setUp = (pop: HTMLElement, v: number) => { upOf.set(pop, v); pop.style.setProperty('--up', v.toFixed(3)) }
  const stand = (pop: HTMLElement, up: boolean, delay = 0) => {
    const to = up ? 1 : 0
    if (aimOf.get(pop) === to) return
    aimOf.set(pop, to)
    const run = () => spring(upOf.get(pop) ?? 1, to, (v) => setUp(pop, v), up ? {} : { bounce: 0.15, visualDuration: 0.35 })
    if (delay && !reducedMotion) { const timer = window.setTimeout(run, delay); cleanups.push(() => clearTimeout(timer)) } else run()
  }
  const flat = (pop: HTMLElement) => { aimOf.set(pop, 0); setUp(pop, 0) }

  // ---------- 跨頁 ----------
  for (const spread of root.querySelectorAll<HTMLElement>('[data-spread]')) {
    if (spread.dataset.spread === 'static') continue
    const right = spread.querySelector<HTMLElement>('.abk-page.is-right')
    const pops = [...spread.querySelectorAll<HTMLElement>('[data-pop]')]
    let opened = false
    const open = (instant: boolean) => {
      if (opened) return
      opened = true
      pops.forEach((pop, i) => (instant ? setUp(pop, 1) : stand(pop, true, i * 140)))
      spread.dispatchEvent(new CustomEvent('abk-open', { detail: { instant } }))
    }
    if (reducedMotion || inViewport(spread)) { open(true); continue }
    pops.forEach(flat)
    if (wide && right) {
      right.style.setProperty('--open', '0')
      cleanups.push(scroll((progress: number) => {
        right.style.setProperty('--open', progress.toFixed(4))
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
    const n = cards.length
    const yearOut = tab.querySelector<HTMLElement>('[data-pull-year]')
    let t = 0
    let index = -1
    const set = (v: number) => {
      t = Math.min(1, Math.max(0, v))
      tab.style.setProperty('--pull', t.toFixed(4))
      const i = pullIndex(t, n)
      if (i !== index) {
        index = i
        if (yearOut) yearOut.textContent = String(years[i])
        tab.setAttribute('aria-valuenow', String(i + 1))
        tab.setAttribute('aria-valuetext', `${years[i]} ${labels[i]}`)
      }
      cards.forEach((card, k) => stand(card, k <= i))
    }
    const toStop = (i: number) => spring(t, Math.min(n - 1, Math.max(0, i)) / (n - 1), set, { bounce: 0.35 })
    let drag: { x: number, t: number, moved: boolean } | null = null
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, t, moved: false }; tab.setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      if (Math.abs(dx) > 4) drag.moved = true
      set(drag.t + dx / Math.max(1, pull.clientWidth - tab.offsetWidth))
    }
    const onUp = () => { if (!drag) return; const moved = drag.moved; drag = null; toStop(moved ? pullIndex(t, n) : pullIndex(t, n) + 1) }
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
      if (step) { e.preventDefault(); toStop(pullIndex(t, n) + step) }
      if (e.key === 'Home') { e.preventDefault(); toStop(0) }
      if (e.key === 'End') { e.preventDefault(); toStop(n - 1) }
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
    // 翻開時示範：紙條自己拉到底，五校一校一校站起來；已經在視窗內（或減少動態）就直接拉到底
    const spread = pull.closest<HTMLElement>('[data-spread]')
    const demo = (e: Event) => {
      if ((e as CustomEvent<{ instant: boolean }>).detail?.instant || reducedMotion) { cards.forEach((card) => setUp(card, 1)); set(1); return }
      const timer = window.setTimeout(() => {
        const control = animate(0, 1, { duration: 2.4, ease: [0.45, 0, 0.2, 1], onUpdate: set })
        running.add(control)
      }, 400)
      cleanups.push(() => clearTimeout(timer))
    }
    if (spread) spread.addEventListener('abk-open', demo, { once: true })
    cards.forEach((card) => flat(card))
    set(0)
    // 掛上時就在視窗內（或減少動態）：翻開事件在上面那個迴圈裡已經發過，直接拉到底
    if (reducedMotion || (spread && inViewport(spread))) { cards.forEach((card) => setUp(card, 1)); set(1) }
  }

  return {
    destroy() {
      cleanups.forEach((fn) => fn())
      running.forEach((control) => control.stop())
      root.classList.remove('is-live')
    }
  }
}
