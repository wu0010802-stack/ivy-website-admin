// 長編輯頁的段落目錄（2026-10-03 第八輪，稽核 09-28「超長編輯頁沒有段落導覽」）。
// 頁面把每一段的標題元素放上 id、data-section-anchor、tabindex="-1"，再把
// sections 傳給 ContentEditor。目錄點一下就捲到那個標題、焦點移過去，鍵盤與
// 報讀軟體跟著到那一段；捲動時留給頁首的空間在 style.css 的 [data-section-anchor]。

export interface EditorSection {
  /** 標題元素的 id（同一頁唯一） */
  id: string
  /** 目錄上的字，和標題同一句 */
  label: string
  /** 目錄項目後面的小字，例如「12 則」；沒有就不顯示 */
  note?: string
}

/** 至少兩段才值得放目錄。 */
export const MIN_NAV_SECTIONS = 2

export function jumpToSection(id: string): boolean {
  const target = document.getElementById(id)
  if (!target) return false
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  return true
}
