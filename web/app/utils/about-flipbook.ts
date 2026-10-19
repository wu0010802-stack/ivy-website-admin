// 關於常春藤頁手機版（900px 以下）的上翻畫冊（2026-10-19，比稿 design/about-mobile-directions-20261019/，使用者選 A 並做第二版）。
// 整本書頂端線圈裝訂、釘在畫面上；往下捲，最上面那頁往上掀過線圈（--lift 0→1，rotateX），下一頁露出來時卡紙才站起來。
// 一頁停一下（html scroll-snap proximity，一頁一個 --seg 的捲動距離）。這支只管動態，版面在 about-flipbook.css。
// - 放得下才釘：先加 is-pinned 量每一頁，放不下的頁先換緊湊排版（is-tight）再量，還是有一頁比頁高還長就拿掉
//   （整本上下排開、照常捲）；寬度變了、內容變了（後台預覽改字）重量。
//   沒有 JS、減少動態、forced-colors 都是上下排開（CSS 預設），卡紙站好、地圖畫好、紀念章不出現。
// - 第一章一頁一校：上一頁掀到一半，這一區浮起來上色（--rise）、虛線從上一校畫過來（.afb-route-draw 的 dashoffset）、
//   小房子冒出來（--pop）。紀念章夾在線圈右上角，第一章那幾頁才出現，一頁翻一年（正反交替同桌機 medalSequence）。
// - 全人教育：那一頁露出一半時對它發 abk-open（AboutWholePerson 收到才播六圈）；上下排開時一開始就發，它自己看可見才播。
// - 我們的期許：露出來時天空色帶與草地塗上（is-opened），停好後藤蔓和煙畫出來（is-grown），樣式在 AboutCrayon.vue。
import { medalFaces, medalSequence } from './about-popup'

export interface AboutFlipBook {
  /** 翻到第 page 頁（0 起算）；上下排開時捲到那一頁。 */
  goTo: (page: number, smooth?: boolean) => void
  destroy: () => void
}
export interface AboutFlipBookHooks {
  /** 最上面（正在看）的那一頁換了；上下排開時不會呼叫。 */
  onPage?: (page: number) => void
}

/** 一頁停住的比例：每一頁的捲動距離裡，前 38% 靜止讓人讀，後 62% 往上掀。 */
export const FLIP_REST = 0.38

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x) }

/** 捲到第 t 頁（可以是小數）時，第 i 頁掀起來多少（0 平放、1 掀過線圈）。最後一頁（封底）不掀。 */
export function liftAt(t: number, i: number, pages: number, rest = FLIP_REST) {
  if (i >= pages - 1) return 0
  return smooth((t - i - rest) / (1 - rest))
}

/** 卡紙站起來的彈簧：會超過 1 一點再回來（同桌機卡紙的感覺，但跟著捲動、不用 Motion）。 */
export function springUp(t: number) {
  const x = clamp(t)
  const c = 1.25
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2)
}

/** 桌機的章節錨點（#story…）在手機對應到哪一頁；沒有對應就是 null。 */
export function pageForHash(hash: string, anchors: Record<string, number>) {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  return id in anchors ? anchors[id]! : null
}

export function createAboutFlipBook(root: HTMLElement, { reducedMotion }: { reducedMotion: boolean }, hooks: AboutFlipBookHooks = {}): AboutFlipBook {
  const track = root.querySelector<HTMLElement>('[data-afb-track]')!
  const pages = [...root.querySelectorAll<HTMLElement>('[data-afb-page]')]
  const snaps = [...root.querySelectorAll<HTMLElement>('[data-afb-snap]')]
  const edge = root.querySelector<HTMLElement>('[data-afb-edge]')
  const medal = root.querySelector<HTMLElement>('[data-medal]')
  const pops = pages.map((page) => [...page.querySelectorAll<HTMLElement>('[data-pop]')])
  const n = pages.length
  const roleIndex = (role: string) => pages.findIndex((page) => page.dataset.afbPage === role)
  const msPages = pages.filter((page) => page.dataset.afbPage === 'ms')
  const opener = roleIndex('story')
  const whole = pages[roleIndex('whole')]
  const hope = pages[roleIndex('hope-art')]
  // 桌機章節錨點 → 手機頁（別頁連進來 /about#story 時翻到那裡）
  const anchors: Record<string, number> = {}
  pages.forEach((page, i) => { if (page.dataset.anchor) anchors[page.dataset.anchor] = i })
  // 疊放順序：前面的頁在上面（about-flipbook.css 用 --i 算 z-index）
  pages.forEach((page, i) => page.style.setProperty('--i', String(i)))

  let pinned = false
  let current = -1
  let wholeOpened = false
  let grownTimer = 0
  const html = document.documentElement
  const seg = () => (snaps[1] && snaps[0] ? snaps[1].offsetTop - snaps[0].offsetTop : innerHeight * 0.86)
  const trackTop = () => track.getBoundingClientRect().top + scrollY

  const openWhole = () => {
    if (wholeOpened || !whole) return
    wholeOpened = true
    whole.dispatchEvent(new CustomEvent('abk-open', { detail: { instant: false } }))
  }

  // 紀念章：每一面印哪一站（同桌機 about-popup 的 print）
  const sequence = medalSequence(msPages.length)
  const faces = medal ? [...medal.querySelectorAll<HTMLElement>('[data-face]')] : []
  const stops = msPages.map((page) => ({ name: page.dataset.name ?? '', year: page.dataset.year ?? '' }))
  const paintMedal = (turn: number) => {
    if (!medal) return
    const { a, b } = medalFaces(turn, sequence.length)
    for (const face of faces) {
      const k = face.dataset.face === 'a' ? a : b
      if (face.dataset.state === String(k)) continue
      face.dataset.state = String(k)
      const step = sequence[k]!
      face.dataset.look = step.look
      const stop = step.stop === null ? undefined : stops[step.stop]
      face.querySelector('.is-name')!.textContent = stop?.name ?? ''
      face.querySelector('.is-year')!.textContent = stop?.year ?? ''
    }
    const frac = turn - Math.floor(turn)
    medal.style.setProperty('--medal-turn', turn.toFixed(4))
    medal.style.setProperty('--medal-lift', Math.sin(frac * Math.PI).toFixed(3))
    medal.style.setProperty('--medal-frac', frac.toFixed(3))
  }

  const render = () => {
    if (!pinned) return
    const t = clamp((scrollY - trackTop()) / seg(), 0, n - 1)
    const lift = pages.map((_, i) => liftAt(t, i, n))
    pages.forEach((page, i) => {
      page.style.setProperty('--lift', lift[i]!.toFixed(4))
      // 掀過線圈就藏起來（背面不畫），也讓下面那頁可以點
      page.classList.toggle('is-gone', lift[i]! >= 0.999)
      const reveal = i === 0 ? 1 : lift[i - 1]!
      page.style.setProperty('--cast', (Math.sin(reveal * Math.PI) * 0.32).toFixed(3))
      pops[i]!.forEach((pop) => pop.style.setProperty('--up', springUp((reveal - 0.5 - (Number(pop.dataset.d) || 0) * 0.07) / 0.42).toFixed(4)))
      if (page.dataset.afbPage === 'ms') {
        page.style.setProperty('--rise', smooth((reveal - 0.45) / 0.35).toFixed(3))
        page.style.setProperty('--pop', Math.max(0, springUp((reveal - 0.72) / 0.28)).toFixed(3))
        page.style.setProperty('--pop-o', clamp((reveal - 0.75) / 0.2).toFixed(3))
        page.style.setProperty('--ring', Math.sin(clamp((reveal - 0.75) / 0.25) * Math.PI).toFixed(3))
        page.style.setProperty('--draw', (1 - smooth((reveal - 0.5) / 0.4)).toFixed(3))
      }
    })
    // 紀念章：第一章開頭那頁露出來才出現，最後一校那頁掀走就收起來；掀一頁轉半圈
    if (medal && opener >= 0 && msPages.length) {
      const last = opener + msPages.length
      // 最後一校那頁掀到七成就收完，不在下一頁留殘影
      medal.style.setProperty('--medal-o', ((opener ? lift[opener - 1]! : 1) * (1 - clamp(lift[last]! / 0.7))).toFixed(3))
      paintMedal(lift.slice(opener, last).reduce((sum, v) => sum + v, 0))
    }
    if (whole) { const i = pages.indexOf(whole); if ((i ? lift[i - 1]! : 1) > 0.5) openWhole() }
    if (hope) {
      const i = pages.indexOf(hope)
      const reveal = i ? lift[i - 1]! : 1
      hope.classList.toggle('is-opened', reveal > 0.3)
      if (reveal > 0.95 && !hope.classList.contains('is-grown') && !grownTimer) grownTimer = window.setTimeout(() => { grownTimer = 0; hope.classList.add('is-grown') }, 250)
    }
    if (edge) edge.style.setProperty('--th', `${Math.max(2, (n - 1 - Math.round(t)) * 2)}px`)
    const top = Math.min(n - 1, Math.floor(t + 0.5))
    if (top !== current) { current = top; hooks.onPage?.(top) }
  }

  // 放得下才釘：先釘上去量；放不下的頁先改緊湊排版（is-tight：字小一點、目錄拿掉小照片）再量，還是放不下就退回上下排開
  // 放不下：內容比頁高還長，或照片卡紙比它的舞台還高（卡紙貼舞台底，太高會往上蓋到字；offsetTop 不受站起來的 transform 影響）
  const overflowing = () => pages.filter((page) => page.scrollHeight > page.clientHeight + 1
    || [...page.querySelectorAll<HTMLElement>('.afb-stage > [data-pop], .afb-vis-card > [data-pop]')].some((pop) => pop.offsetTop < -1))
  const fit = () => {
    root.classList.add('is-pinned')
    pages.forEach((page) => page.classList.remove('is-tight'))
    overflowing().forEach((page) => page.classList.add('is-tight'))
    const over = overflowing()
    pinned = over.length === 0
    root.classList.toggle('is-pinned', pinned)
    root.classList.toggle('is-live', pinned)
    root.dataset.fit = pinned ? 'pinned' : `stacked:${over.map((page) => pages.indexOf(page) + 1).join(',')}`
    html.style.scrollSnapType = pinned ? 'y proximity' : ''
    if (!pinned) {
      // 上下排開：頁面跟著內容長，不需要緊湊排版；清掉動態寫的值，回到 CSS 預設（卡紙站好、地圖畫好）
      pages.forEach((page) => page.classList.remove('is-tight'))
      for (const page of pages) for (const prop of ['--lift', '--cast', '--rise', '--pop', '--pop-o', '--ring', '--draw']) page.style.removeProperty(prop)
      pops.flat().forEach((pop) => pop.style.removeProperty('--up'))
      pages.forEach((page) => page.classList.remove('is-gone'))
      hope?.classList.add('is-opened', 'is-grown')
      openWhole()
    }
    render()
  }

  let frame = 0
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render() }) }
  // 手機網址列收合只改高度（頁高用 svh 不會變）：寬度變了才重量
  let width = innerWidth
  let resizeTimer = 0
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => { if (innerWidth !== width) { width = innerWidth; fit() } else onScroll() }, 150)
  }
  const goTo = (page: number, smoothScroll = true) => {
    const target = pages[clamp(page, 0, n - 1)]
    if (!target) return
    const behavior = smoothScroll && !reducedMotion ? 'smooth' : 'auto'
    // 無條件進位：瀏覽器會把小數的捲動位置捨去，差一像素那頁就還沒停好（上一頁沒掀完）
    if (pinned) scrollTo({ top: Math.ceil(trackTop() + page * seg()), behavior })
    else target.scrollIntoView({ block: 'start', behavior })
  }
  // 書裡的「翻到第幾頁」連結（目次、第一章五校目錄）：釘住時捲到那一頁停住的位置；上下排開時照錨點跳
  // 鍵盤：Tab 到還沒翻到（被上面那頁蓋住）的頁面裡，就翻到那一頁，焦點不會被蓋住
  const onFocus = (event: FocusEvent) => {
    if (!pinned) return
    const page = (event.target as Element).closest<HTMLElement>('[data-afb-page]')
    const i = page ? pages.indexOf(page) : -1
    if (i >= 0 && i !== current) goTo(i, false)
  }
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('[data-afb-go]')
    if (!link || !pinned) return
    event.preventDefault()
    goTo(Number(link.dataset.afbGo))
  }

  // 內容變了（後台即時預覽改字、換家長影片）：重量放不放得下
  let mutateTimer = 0
  const mutations = new MutationObserver(() => { clearTimeout(mutateTimer); mutateTimer = window.setTimeout(fit, 200) })

  if (reducedMotion) {
    hope?.classList.add('is-opened', 'is-grown')
    openWhole()
  } else {
    fit()
    mutations.observe(root, { subtree: true, childList: true, characterData: true })
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onResize)
    // 字型載好、圖片撐開後高度會變：再量一次
    document.fonts?.ready.then(() => { if (frame !== -1) fit() })
  }
  root.addEventListener('click', onClick)
  root.addEventListener('focusin', onFocus)
  const fromHash = pageForHash(location.hash, anchors)
  if (fromHash !== null) requestAnimationFrame(() => goTo(fromHash, false))

  return {
    goTo,
    destroy() {
      cancelAnimationFrame(frame)
      frame = -1
      clearTimeout(resizeTimer)
      clearTimeout(grownTimer)
      clearTimeout(mutateTimer)
      mutations.disconnect()
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResize)
      root.removeEventListener('click', onClick)
      root.removeEventListener('focusin', onFocus)
      root.classList.remove('is-pinned', 'is-live')
      html.style.scrollSnapType = ''
    }
  }
}
