// 關於常春藤頁手機版（900px 以下）：卡紙疊起來（2026-10-25，比稿 design/about-redesign-directions-20261025/，使用者選 A 並做第二版；
// 取代 10-19 的上翻畫冊）。一章一張卡紙，照一般網頁往下讀；一張讀到底，下一張滑上來疊住它，被蓋住的往後退一點。
// 這支只管動態，版面在 about-sheets.css：
// - 疊起來（is-stacked）：每張卡紙 sticky，停住的位置由 CSS 算（比畫面高的讀到底才停、比畫面矮的停在分頁列下方），
//   這裡只用 ResizeObserver 把卡紙高寫進 --h；--cover＝下一張蓋上來多少（被蓋的往後退、變暗）。
//   減少動態不疊（上下排開）；沒有 JS、forced-colors 也是上下排開（CSS 預設）。
// - 頂端分頁列（is-on）：讀進卡紙疊才出現，目前那一章凸出來；點分頁或目次捲到那一章開頭。
// - 第一章的紀念章：讀線（視窗 40%）經過哪一校就翻到哪一年，連續轉、正反交替（同桌機 medalSequence／medalTurn）。
// - 全人教育：一開始就對它發 abk-open（AboutWholePerson 自己看可見才播六圈）。
// - 我們的期許：卡紙露出來時天空色帶與草地塗上（is-opened），停好後藤蔓和煙畫出來（is-grown），樣式在 AboutCrayon.vue。
import { medalFaces, medalSequence, medalTurn } from './about-popup'

export interface AboutSheets {
  /** 捲到第 i 張卡紙的開頭（分頁列下方）。 */
  goTo: (i: number, smooth?: boolean) => void
  destroy: () => void
}
export interface AboutSheetsHooks {
  /** 正在讀的卡紙換了（-1＝還在封面）。 */
  onSheet?: (i: number) => void
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))

/** 下一張卡紙蓋上來多少（0＝還沒碰到、1＝停好、整張蓋住）：它的頂端從視窗底滑到停住的位置。 */
export function coverAt(nextTop: number, viewport: number, nextStick: number) {
  const span = viewport - nextStick
  return span > 0 ? clamp((viewport - nextTop) / span) : 1
}

/** 讀線經過第一章第幾校（可以是小數）：每一列頂端過了讀線，再往下 span px 算走完那一校。 */
export function medalProgress(rowTops: number[], line: number, span = 140) {
  return rowTops.reduce((sum, top) => sum + clamp((line - top) / span), 0)
}

/** 桌機的章節錨點（#story…）在手機對應到第幾張卡紙；沒有對應就是 null。 */
export function sheetForHash(hash: string, anchors: Record<string, number>) {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  return id in anchors ? anchors[id]! : null
}

export function createAboutSheets(root: HTMLElement, { reducedMotion }: { reducedMotion: boolean }, hooks: AboutSheetsHooks = {}): AboutSheets {
  const band = root.querySelector<HTMLElement>('[data-ams-band]')!
  const bandTabs = [...band.querySelectorAll<HTMLElement>('[data-ams-go]')]
  const stack = root.querySelector<HTMLElement>('[data-ams-stack]')!
  const sheets = [...root.querySelectorAll<HTMLElement>('[data-ams-sheet]')]
  const rows = [...root.querySelectorAll<HTMLElement>('[data-ams-row]')]
  const medal = root.querySelector<HTMLElement>('[data-medal]')
  const whole = root.querySelector<HTMLElement>('[data-ams-sheet][data-spread]')
  const hope = root.querySelector<HTMLElement>('[data-ams-sheet][data-hope]')
  const stacked = !reducedMotion
  // 桌機章節錨點 → 手機第幾張（別頁連進來 /about#story 時捲到那裡）
  const anchors: Record<string, number> = {}
  sheets.forEach((sheet, i) => { if (sheet.dataset.anchor) anchors[sheet.dataset.anchor] = i })

  let natural: number[] = []
  let current = -2
  let grownTimer = 0

  // 紀念章：每一面印哪一站（同桌機 about-popup 的 print 與手機畫冊）
  const sequence = medalSequence(rows.length)
  const faces = medal ? [...medal.querySelectorAll<HTMLElement>('[data-face]')] : []
  const stops = rows.map((row) => ({ name: row.dataset.name ?? '', year: row.dataset.year ?? '' }))
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

  // 卡紙在文件裡原本的位置（sticky 時 getBoundingClientRect 會跟著變，所以從卡紙疊頂端加上每張的高與間距）
  const measure = () => {
    let y = stack.getBoundingClientRect().top + scrollY
    natural = sheets.map((sheet, i) => {
      if (i) y += parseFloat(getComputedStyle(sheet).marginTop) || 0
      const top = y
      y += sheet.offsetHeight
      return top
    })
  }
  const bandBottom = () => band.getBoundingClientRect().bottom

  const render = () => {
    const vh = innerHeight
    if (stacked) {
      sheets.forEach((sheet, i) => {
        const next = sheets[i + 1]
        const cover = next ? coverAt(next.getBoundingClientRect().top, vh, parseFloat(getComputedStyle(next).top) || 0) : 0
        sheet.style.setProperty('--cover', cover.toFixed(3))
      })
    }
    // 分頁列：第一張卡紙碰到分頁列才出現；目前那一章＝原本位置已經過了讀線的最後一張
    band.classList.toggle('is-on', !!sheets[0] && sheets[0].getBoundingClientRect().top < bandBottom() + 10)
    let cur = -1
    natural.forEach((top, i) => { if (scrollY + vh * 0.4 > top) cur = i })
    if (cur !== current) {
      current = cur
      bandTabs.forEach((tab, i) => tab.classList.toggle('is-current', i === cur))
      hooks.onSheet?.(cur)
    }
    if (medal && !reducedMotion) paintMedal(medalTurn(medalProgress(rows.map((row) => row.getBoundingClientRect().top), vh * 0.4)))
    if (hope && !reducedMotion) {
      const top = hope.getBoundingClientRect().top
      if (top < vh * 0.75) hope.classList.add('is-opened')
      if (top < vh * 0.4 && !hope.classList.contains('is-grown') && !grownTimer) grownTimer = window.setTimeout(() => { grownTimer = 0; hope.classList.add('is-grown') }, 250)
    }
  }

  let frame = 0
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render() }) }
  // 卡紙高變了（字型載好、圖片撐開、後台即時預覽改字）：寫回 --h（CSS 用它算停住的位置）、重量原本位置
  const resized = new ResizeObserver(() => {
    sheets.forEach((sheet) => sheet.style.setProperty('--h', `${sheet.offsetHeight}px`))
    measure()
    onScroll()
  })

  const goTo = (i: number, smoothScroll = true) => {
    if (natural[i] === undefined) return
    // 分頁列在第一張卡紙碰到它之前不會出現：捲到第一張時只讓到頁首膠囊
    const offset = i === 0 ? parseFloat(getComputedStyle(root).getPropertyValue('--ams-head')) || 76 : band.offsetHeight
    scrollTo({ top: Math.ceil(natural[i]! - offset - 4), behavior: smoothScroll && !reducedMotion ? 'smooth' : 'auto' })
  }
  // 分頁列與目次：捲到那一章開頭（疊起來時錨點跳的位置不一定是開頭）
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLElement>('[data-ams-go]')
    if (!link) return
    event.preventDefault()
    goTo(Number(link.dataset.amsGo))
  }

  root.classList.add('is-live')
  root.classList.toggle('is-stacked', stacked)
  if (reducedMotion) hope?.classList.add('is-opened', 'is-grown')
  whole?.dispatchEvent(new CustomEvent('abk-open', { detail: { instant: false } }))
  sheets.forEach((sheet) => resized.observe(sheet))
  resized.observe(stack)
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onScroll)
  root.addEventListener('click', onClick)
  measure()
  render()
  const fromHash = sheetForHash(location.hash, anchors)
  if (fromHash !== null) requestAnimationFrame(() => { measure(); goTo(fromHash, false) })

  return {
    goTo,
    destroy() {
      cancelAnimationFrame(frame)
      clearTimeout(grownTimer)
      resized.disconnect()
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      root.removeEventListener('click', onClick)
      root.classList.remove('is-live', 'is-stacked')
      band.classList.remove('is-on')
      for (const sheet of sheets) for (const prop of ['--cover', '--h']) sheet.style.removeProperty(prop)
    }
  }
}
