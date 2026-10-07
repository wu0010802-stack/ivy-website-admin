import { PREVIEW_BLOCKS, type HighlightHit, type LiveFocus } from './preview-live'

// 即時預覽的「改哪格亮哪格」（2026-10-06 方向 D）：後台送來改到的那段文字（probe），在目前分頁
// 對應的區塊裡找最深、畫得出來的元素框起來；找不到就框整塊（整頁內容不框）。只捲預覽頁自己的
// 視窗：Element.scrollIntoView 在同源 iframe 裡會連外層後台頁一起捲，打字時整個編輯頁會跳。
// 這支不呼叫 focus()（會搶走後台輸入框的焦點），也不動版面：框線只用 outline／box-shadow。

export const PREVIEW_HIT_CLASS = 'preview-live-hit'
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
/** 量不到預覽頁頁首實際高度時，捲過去留在上方的距離（桌機頁首約 92）。 */
const TOP_OFFSET = 88
const HEADER_SELECTOR = PREVIEW_BLOCKS['site-header'].selector
/** 首頁五校的播放鈕與它「正在自動播放」時的報讀名稱（components/CampusBoard.vue）；preview-highlight.spec 守住兩邊對得上，測試的假播放鈕也從這兩個常數組出來。 */
export const CAROUSEL_PLAYBACK_BUTTON = `${PREVIEW_BLOCKS['home-campuses'].selector} .campus-playback`
export const CAROUSEL_PLAYING_LABEL = '暫停分校自動播放'

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** 畫得出來（display: none、hidden 的元素沒有 client rect）。 */
export function isRenderedElement(el: Element): boolean {
  return el.getClientRects().length > 0
}

export function findProbeElement(root: Element, probe: string, isRendered: (el: Element) => boolean = isRenderedElement): Element | null {
  const needle = normalize(probe)
  if (needle.length < 2 || !isRendered(root) || !normalize(root.textContent).includes(needle)) return null
  let current: Element = root
  for (;;) {
    const next = Array.from(current.children).find(
      (child) => !SKIP.has(child.tagName) && isRendered(child) && normalize(child.textContent).includes(needle)
    )
    if (!next) return current
    current = next
  }
}

/**
 * 即時預覽不讓首頁五校自己轉走：正在自動播放就按一下它的暫停鈕。已經暫停（或減少動態、還沒開始播）
 * 就不動，所以重複呼叫不會又把它按回播放。不暫停的話，框選把五校捲進視窗後約 4 秒，
 * 剛切到的那一校就會被輪播換掉。回 true 表示這次按了暫停。
 *
 * 呼叫時機：必須在 Vue 把畫面更新完（await nextTick()）之後。播放鈕的報讀名稱是跟著 Vue 的狀態更新的，
 * 更新前讀到的是上一輪的名稱：剛按過暫停、畫面還沒更新就再呼叫，會看到「還在播放」又按一次，反而把它按回播放。
 */
export function pausePreviewCarousel(doc: Document): boolean {
  const button = doc.querySelector<HTMLElement>(CAROUSEL_PLAYBACK_BUTTON)
  if (!button || button.getAttribute('aria-label') !== CAROUSEL_PLAYING_LABEL) return false
  button.click()
  return true
}

/**
 * 首頁五校：先讓輪播停住，再把改的那一校切成目前那張（點它的分頁）。
 * 回 true 表示點了分頁，畫面會再更新一次，要等下一次更新才找得到那一校的文字。
 */
export function activatePreviewBlock(doc: Document, focus: LiveFocus): boolean {
  if (!PREVIEW_BLOCKS[focus.block].campusTab) return false
  pausePreviewCarousel(doc)
  if (!focus.campusKey) return false
  const tab = doc.getElementById(`campus-tab-${focus.campusKey}`)
  if (!tab || tab.getAttribute('aria-selected') === 'true') return false
  ;(tab as HTMLElement).click()
  return true
}

export interface HighlightOptions {
  isRendered?: (el: Element) => boolean
  reduceMotion?: boolean
}

export function highlightPreview(doc: Document, focus: LiveFocus, options: HighlightOptions = {}): HighlightHit {
  doc.querySelectorAll(`.${PREVIEW_HIT_CLASS}`).forEach((el) => el.classList.remove(PREVIEW_HIT_CLASS))
  const block = PREVIEW_BLOCKS[focus.block]
  const root = doc.querySelector(block.selector)
  if (!root || !focus.mark) return 'none'
  const found = focus.probe ? findProbeElement(root, focus.probe, options.isRendered) : null
  // 整頁區塊（outline: false，例如 page-top 的 #main）：文字只對得到整個區塊本身（跨好幾個元素、沒有哪一個單獨含有）
  // 就等於沒找到，不能把整個 #main 框起來還回報 text。
  const hit = found && found === root && !block.outline ? null : found
  const target = hit ?? (block.outline ? root : null)
  if (!target) return 'none'
  target.classList.add(PREVIEW_HIT_CLASS)
  revealInFrame(doc, target, hit ? 'center' : 'start', options.reduceMotion)
  return hit ? 'text' : 'block'
}

function isPinnedPosition(position: string | undefined): boolean {
  return position === 'fixed' || position === 'sticky'
}

function positionOf(view: Window, el: Element): string | undefined {
  try {
    return view.getComputedStyle(el).position
  } catch {
    return undefined
  }
}

/**
 * 目標本身固定／黏在畫面上（或在固定的頁首裡）：捲動不會改變它在畫面上的位置，不必捲。
 * 手機頁首固定在上方、只有 78px 高，不判斷的話它永遠被當成「看不到」，每改一次就往上捲一格。
 * 只認目標本身與頁首：往上找所有祖先會誤傷內部有黏住元素的區塊（框到那一塊就永遠不捲了）。
 */
export function isPinnedTarget(doc: Document, el: Element): boolean {
  const view = doc.defaultView
  if (!view) return false
  if (isPinnedPosition(positionOf(view, el))) return true
  const header = el.closest?.(HEADER_SELECTOR)
  return Boolean(header) && isPinnedPosition(positionOf(view, header!))
}

/**
 * 預覽頁固定（或黏）在上方的頁首實際蓋住的高度：手機約 78、桌機約 92，不是同一個數字。
 * 量不到（找不到頁首、頁首不固定、量出來不合理、脫離的文件）就退回 TOP_OFFSET。
 */
export function previewTopInset(doc: Document): number {
  try {
    const view = doc.defaultView
    const header = doc.querySelector(HEADER_SELECTOR)
    if (!view || !header || !isPinnedPosition(positionOf(view, header))) return TOP_OFFSET
    const bottom = header.getBoundingClientRect().bottom
    // 頁首展開的手機選單會蓋滿整個視窗：超過視窗一半就不是「頁首高度」。
    return Number.isFinite(bottom) && bottom > 0 && bottom <= view.innerHeight / 2 ? Math.round(bottom) : TOP_OFFSET
  } catch {
    return TOP_OFFSET
  }
}

/**
 * 只捲這份文件自己的視窗。reduceMotion 沒指定時看這個視窗的系統設定（prefers-reduced-motion），
 * 開了就直接跳、不用平滑捲動。頂端留的距離是預覽頁頁首實際的高度（previewTopInset）；
 * 目標本身固定／黏住（例如頁首）時不捲。
 */
export function revealInFrame(
  doc: Document,
  el: Element,
  align: 'center' | 'start',
  reduceMotion: boolean = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
): void {
  const view = doc.defaultView
  if (!view) return
  if (isPinnedTarget(doc, el)) return
  const inset = previewTopInset(doc)
  const rect = el.getBoundingClientRect()
  const height = view.innerHeight
  const visible = align === 'center'
    ? rect.top >= inset && rect.bottom <= height
    : rect.bottom > inset && rect.top < height
  if (visible) return
  const offset = align === 'center' ? Math.max(inset, (height - rect.height) / 2) : inset
  view.scrollTo({ top: Math.max(0, view.scrollY + rect.top - offset), behavior: reduceMotion ? 'auto' : 'smooth' })
}
