// 首頁章節指示的判斷，抽出來方便測試。
// 首頁的簾幕讓下一段先疊在上一段底下（幾何上已經到了、畫面上還看不到），用各章節的 getBoundingClientRect
// 會提早跳章；改看「視窗讀線上實際看得到的元素」屬於哪一章：由那個元素往上找，第一個是章節的祖先就是答案。
// 章節元件有巢狀（HeroVideo > About > Day > News > 五校），最近的祖先才是讀者正在看的那一章。

/** 讀線：視窗高度的 45%。 */
export const READ_LINE = 0.45

export function chapterAt(ancestorIds: readonly string[], chapterIds: readonly string[]): number {
  for (const id of ancestorIds) {
    const index = chapterIds.indexOf(id)
    if (index >= 0) return index
  }
  return -1
}

export function ancestorIds(element: Element | null): string[] {
  const ids: string[] = []
  for (let node = element; node; node = node.parentElement) if (node.id) ids.push(node.id)
  return ids
}

export interface ChapterAnchor { id: string; after?: string }

/**
 * 首頁網址是否指向需要跳過簾幕的章節：只認同源、路徑是首頁的 #hash。
 * 回傳那個章節；其他連結交給瀏覽器與路由照常處理。
 */
export function chapterForHref(href: string, origin: string, chapters: readonly ChapterAnchor[]): ChapterAnchor | null {
  let url: URL
  try { url = new URL(href, origin) } catch { return null }
  if (url.origin !== origin || url.pathname.replace(/\/+$/, '') !== '' || !url.hash) return null
  const id = decodeURIComponent(url.hash.slice(1))
  return chapters.find(chapter => chapter.id === id && chapter.after) ?? null
}
