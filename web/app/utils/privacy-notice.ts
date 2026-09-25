import type { PrivacyNotice } from '../types/site-content'

export const DEFAULT_PRIVACY_TITLE = '個資使用說明'

/**
 * 後台「預約文案」的隱私說明（privacy_title／privacy_sections）轉成官網用的形狀。
 * 沒有段落＝園方還沒提供正式說明，回 null，頁尾與表單都不顯示入口。
 */
export function privacyNotice(
  title: string | null | undefined,
  sections: { heading?: string | null; body?: string | null }[] | null | undefined
): PrivacyNotice | null {
  const kept = (sections ?? [])
    .map((section) => ({ heading: (section.heading ?? '').trim(), body: (section.body ?? '').trim() }))
    .filter((section) => section.body)
  if (!kept.length) return null
  return { title: (title ?? '').trim() || DEFAULT_PRIVACY_TITLE, sections: kept }
}

/** 段落內文照換行分成幾個 <p>，空行不留。 */
export function privacyParagraphs(body: string): string[] {
  return body.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}
