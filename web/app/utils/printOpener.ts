/**
 * 「孩子的一天」F 第一張翻開進場（2026-09-24 定案，比稿 design/flip-hint-natural-20260924/ F；取代首張偷看）。
 *
 * 每次工作階段第一次來到這一區，第一張拍立得背面朝上貼著；讀者看得夠多、停留 0.8 秒後，
 * 它自己翻成照片、照片接著顯影。讀者親眼看到「相片會翻」，之後自然會去翻其他張。
 * 載入當下已在畫面內（錨點、回上一頁、捲動還原）就不做，免得正面一閃變背面；
 * 減少動態時停在背面等讀者自己點（DayMomentCard.vue 判斷）。
 */
export const OPENER_DELAY_MS = 800
/** 沿用舊首張偷看的 key：這個工作階段示範過（或已看過舊的偷看）就不再做。 */
export const OPENER_KEY = 'ivy-day-peek'
const SEEN_SHARE = 0.6

/** 看得夠多：可見高度達卡片與視窗較矮者的 60%（卡片比視窗高時也翻得到）。 */
export function seenEnough(top: number, bottom: number, viewHeight: number): boolean {
  const height = bottom - top
  if (height <= 0 || viewHeight <= 0) return false
  const visible = Math.min(bottom, viewHeight) - Math.max(top, 0)
  return visible >= SEEN_SHARE * Math.min(height, viewHeight)
}

/** 有任何一部分在畫面內。 */
export function onScreen(top: number, bottom: number, viewHeight: number): boolean {
  return bottom > 0 && top < viewHeight
}

/** 要不要背面朝上等讀者：只有第一張、這個工作階段還沒示範過、載入當下不在畫面內。 */
export function startsFaceDown(index: number, shownThisSession: boolean, visibleNow: boolean): boolean {
  return index === 0 && !shownThisSession && !visibleNow
}

export function openerShown(): boolean {
  try {
    return sessionStorage.getItem(OPENER_KEY) === '1'
  } catch {
    return false
  }
}

export function markOpenerShown() {
  try {
    sessionStorage.setItem(OPENER_KEY, '1')
  } catch {
    /* 無 sessionStorage 就每次載入都示範一次 */
  }
}
