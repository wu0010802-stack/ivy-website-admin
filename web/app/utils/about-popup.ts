// 關於常春藤頁的立體書動態（2026-09-29，使用者選定 J 立體書：design/about-style-directions-20260929/j-popup.*）。
// Motion（motion.dev）只在這頁動態載入，由 AboutContent.vue 傳進來；這支不 import motion 本體，只用型別。
// - 跨頁：右頁以書脊為軸，從闔上（-178°）翻到攤平；scroll() 把捲動進度寫進 --open（只在 901px 以上）。
//   2026-10-02 起右頁背面是章節封面；同時寫 --shade（立起來時紙面背光）與 --cast（還壓在左頁上方時，左頁靠書脊的影子）。
// - 卡紙：--up 0 平躺 → 1 站好，用 spring 寫進 CSS 變數；彈簧會超過 1 一點（往前晃一下）。
// - 一路走來（2026-10-03 取代拉紙條；比稿 design/about-medal-directions-20261003/，使用者選「章名旁＋連續轉」）：
//   章名旁的紀念章（AboutMedal）跟著捲動翻面：校徽正面 → 1997 義華 → … → 2021 仁武，翻到哪一站、那一校的卡紙站起來、
//   左頁沿革那一列上色。放得下「紀念章頂端到沿革底」時跨頁釘住（手機釘右頁），多捲 6 × 0.4 個畫面；放不下就照常捲，
//   跨頁經過時走完五站。每站中間 40% 停住讓人看清楚，兩站之間才轉；背對讀者的那一面先換成下一站。
// - 全人教育：A2 六圈由 AboutWholePerson.vue 管理，收到 abk-open 後才播放。
// - 我們的期許：房子站好後，牆角的常春藤長出來（.abk-scene 加 is-grown）。
// - 家長怎麼說：swap() 讓大卡紙與後排小卡倒下、換內容、再站起來（AboutContent 換家長時呼叫）。
// 沒有 JS（或還沒載入）時 CSS 預設 --open:1、--up:1：書是攤開的、卡紙是站好的，內容全部看得到。
// 掛上時已經在視窗內的跨頁直接維持攤開，不闔上再翻（避免閃一下）。首屏跨頁（data-spread="static"）不翻。
// 減少動態：書攤開、卡紙站好、紀念章停在校徽正面不釘住，六圈維持完成圖，常春藤直接長好，換家長直接換。
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

/** 紀念章靜止時往左偏的角度（AboutMedal.vue 的 rotateY(… - 18deg) 要同步）。 */
export const MEDAL_YAW = -18
/** 紀念章每一站佔幾個畫面高的捲動距離（釘住時）。 */
export const MEDAL_STOP_SCREENS = 0.4

/** 捲動位置 c（0＝校徽正面，k＝第 k 所校園，可以是小數）→ 紀念章轉了幾個半圈：每站中間 40% 停住，兩站之間 smoothstep 轉過去。 */
export function medalTurn(c: number) {
  const k = Math.round(c)
  const x = c - k
  const t = Math.min(1, Math.max(0, (Math.abs(x) - 0.2) / 0.3))
  return k + Math.sign(x) * 0.5 * t * t * (3 - 2 * t)
}

/** 轉了 turn 個半圈時兩面各印哪一站：A 面印偶數站、B 面印奇數站，背對讀者的那一面先換成下一站（共 states 站，含校徽正面）。 */
export function medalFaces(turn: number, states: number) {
  return { a: Math.min(states - 1, 2 * Math.round(turn / 2)), b: Math.min(states - 1, 2 * Math.floor(turn / 2) + 1) }
}

/** 讀者現在看到哪一站：靜止時往左偏 MEDAL_YAW，朝外的是 A 面還是 B 面由實際角度決定。 */
export function medalShown(turn: number, states: number) {
  const { a, b } = medalFaces(turn, states)
  return Math.cos(((turn * 180 + MEDAL_YAW) * Math.PI) / 180) > 0 ? a : b
}

/** 釘住時跨頁（或右頁）頂端離視窗頂多遠：要看到的範圍 [from, to]（相對元素頂端）放進上下留白之內，能置中就置中；放不下回傳 null。 */
export function medalPinTop(viewport: number, height: number, from: number, to: number, margin: { top: number, bottom: number }) {
  const lo = margin.top - from
  const hi = viewport - margin.bottom - to
  if (lo > hi) return null
  return Math.min(hi, Math.max(lo, (viewport - height) / 2))
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
      }, { target: spread.closest<HTMLElement>('[data-medal-track]') ?? spread, offset: ['start 0.95', 'start 0.3'] }))
    } else {
      cleanups.push(inView(spread.querySelector('.abk-stage, .abk-whole') ?? spread, () => { open(false) }, { amount: 0.4 }))
    }
  }

  // ---------- 一路走來：紀念章跟著捲動翻面 ----------
  const track = root.querySelector<HTMLElement>('[data-medal-track]')
  const story = track?.querySelector<HTMLElement>('[data-spread]')
  const left = story?.querySelector<HTMLElement>('.abk-page.is-left')
  const right = story?.querySelector<HTMLElement>('.abk-page.is-right')
  const cards = [...(story?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])]
  const medals = [...(story?.querySelectorAll<HTMLElement>('[data-medal]') ?? [])]
  // 減少動態：不釘住、不轉，卡紙照 CSS 預設站好，紀念章停在校徽正面
  if (track && story && left && right && cards.length && medals.length && !reducedMotion) {
    const states = cards.length + 1
    const stops = cards.map((card) => ({ name: card.dataset.stop ?? '', year: card.dataset.year ?? '' }))
    const rows = [...story.querySelectorAll<HTMLElement>('.abk-list > li')]
    const faces = medals.flatMap((medal) => [...medal.querySelectorAll<HTMLElement>('[data-face]')])
    const print = (face: HTMLElement, k: number) => {
      if (face.dataset.state === String(k)) return
      face.dataset.state = String(k)
      const stop = stops[k - 1]
      if (!stop) return
      face.querySelector('.is-name')!.textContent = stop.name
      face.querySelector('.is-year')!.textContent = stop.year
    }
    let shown = -1
    const show = (k: number, instant: boolean) => {
      if (k === shown) return
      shown = k
      cards.forEach((card, i) => {
        if (!instant) { stand(card, i < k); return }
        aimOf.set(card, i < k ? 1 : 0)
        setUp(card, i < k ? 1 : 0)
      })
      rows.forEach((row, i) => row.classList.toggle('is-on', i === k - 1))
    }
    const paint = (turn: number, instant = false) => {
      const { a, b } = medalFaces(turn, states)
      faces.forEach((face) => print(face, face.dataset.face === 'a' ? a : b))
      const frac = turn - Math.floor(turn)
      for (const medal of medals) {
        medal.style.setProperty('--medal-turn', turn.toFixed(4))
        medal.style.setProperty('--medal-lift', Math.sin(frac * Math.PI).toFixed(3))
        medal.style.setProperty('--medal-frac', frac.toFixed(3))
      }
      show(medalShown(turn, states), instant)
    }

    // 釘住：要看到「紀念章頂端（含翻面時跳起）到卡紙與沿革底」；桌機釘整個跨頁，手機釘右頁（頁首膠囊約 80px 高）
    let pinned = false
    let wideNow = true
    let pinTop = 0
    let lastWidth = 0
    const measure = () => {
      lastWidth = innerWidth
      wideNow = matchMedia('(min-width: 901px)').matches
      const el = wideNow ? story : right
      const box = el.getBoundingClientRect()
      const medal = medals.find((m) => m.offsetParent)
      const lift = medal ? medal.offsetHeight * 0.16 : 0
      const from = medal ? medal.getBoundingClientRect().top - box.top - lift : 0
      const bottoms = [...cards, ...(wideNow ? rows : [])].map((node) => node.getBoundingClientRect().bottom - box.top)
      const top = medalPinTop(innerHeight, box.height, from, Math.max(...bottoms) + 12, wideNow ? { top: 16, bottom: 16 } : { top: 88, bottom: 12 })
      pinned = top !== null
      pinTop = top ?? 0
      track.style.setProperty('--abk-pin-top', `${Math.round(pinTop)}px`)
      // 撐高度的那一列和釘住的元素重疊（元素跨兩列），所以要加回元素自己的高度；用 svh，手機網址列收合時不跟著變
      track.style.setProperty('--abk-pin-run', `calc(${Math.round(states * MEDAL_STOP_SCREENS * 100)}svh + ${Math.round(box.height)}px)`)
      track.classList.toggle('is-pinned', pinned && wideNow)
      story.classList.toggle('is-pinned', pinned && !wideNow)
    }
    // 進度 0–1：釘住時看「沒釘住的話元素會在哪」（桌機是軌道頂、手機是左頁底），除以多出來的捲動距離；
    // 沒釘住時看元素經過視窗（桌機等右頁翻開後才開始）
    const progress = () => {
      if (pinned) {
        const natural = wideNow ? track.getBoundingClientRect().top : left.getBoundingClientRect().bottom
        const run = wideNow ? track.offsetHeight - story.offsetHeight : story.offsetHeight - left.offsetHeight - right.offsetHeight
        return (pinTop - natural) / Math.max(1, run)
      }
      const box = (wideNow ? story : right).getBoundingClientRect()
      return wideNow
        ? (innerHeight * 0.5 - box.top) / Math.max(300, box.height - innerHeight * 0.4)
        : (innerHeight * 0.8 - box.top) / Math.max(300, box.height)
    }
    const aim = () => medalTurn(Math.min(states - 1, Math.max(0, progress() * states - 0.5)))

    let turn = 0
    let target = 0
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = 0
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const diff = target - turn
      turn = Math.abs(diff) < 0.001 ? target : turn + diff * (1 - Math.exp(-dt * 14))
      paint(turn)
      if (turn !== target) raf = requestAnimationFrame(tick)
    }
    const onScroll = () => {
      target = aim()
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) }
    }
    // 手機網址列收合只改高度：不重新量（避免釘住位置跟著跳）
    const onResize = () => { if (wideNow || innerWidth !== lastWidth) measure(); onScroll() }
    measure()
    turn = target = aim()
    paint(turn, true)
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onResize)
    // 字型、沿革換行讓高度變了就重量（觀察左右頁本身，釘住多出來的那一列不會再觸發）
    const resized = new ResizeObserver(() => { measure(); onScroll() })
    resized.observe(left)
    resized.observe(right)
    cleanups.push(() => {
      resized.disconnect()
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      track.classList.remove('is-pinned')
      story.classList.remove('is-pinned')
    })
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
