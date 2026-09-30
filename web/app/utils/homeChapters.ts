// 首頁章節錨點的判斷（useChapterAnchors 用），抽出來方便測試。

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
