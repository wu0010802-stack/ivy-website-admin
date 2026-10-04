import { pickImage, type MediaImage } from './media-image'

// 整頁內容（特色教學頁、關於常春藤頁）共用的小工具。後台的標題欄位用 \n 表示換行；
// 照片版位沒換過就用元件寫死的內建圖與內建說明。

/** 各清單固定的項目數（同後端 content/page_schemas.py）；已發布內容不符時官網退回內建內容。 */
export const PAGE_COUNTS = {
  curriculum: { chapters: 4, years: 4, directions: 7, gallery: 8, daily: 5, beliefs: 5 }
} as const

export function assertCounts(lists: Record<string, readonly unknown[] | undefined>, expected: Record<string, number>): void {
  for (const [name, count] of Object.entries(expected)) {
    const actual = lists[name]?.length ?? 0
    if (actual !== count) throw new Error(`${name} 應為 ${count} 項，實際 ${actual} 項`)
  }
}

export function pageTitleLines(text: string): string[] {
  return text.split('\n')
}

export interface MarkedLine {
  before: string
  mark: string
  after: string
}

/** 大標裡要畫顏料的字：只標第一次出現的那一行，其餘整行放 before。 */
export function pageMarkedLines(text: string, mark: string): MarkedLine[] {
  let marked = !mark
  return pageTitleLines(text).map((line) => {
    const at = marked ? -1 : line.indexOf(mark)
    if (at < 0) return { before: line, mark: '', after: '' }
    marked = true
    return { before: line.slice(0, at), mark, after: line.slice(at + mark.length) }
  })
}

export function pagePhotoAttrs(builtin: string, photo: MediaImage | undefined, sizes: string) {
  return pickImage(builtin, photo, sizes)
}

export function pagePhotoAlt(builtinAlt: string, photo: MediaImage | undefined, alt: string | undefined): string {
  return photo ? (alt || photo.alt) : builtinAlt
}

/**
 * 改版前沒有 :style 的 <img> 用：後台照片有焦點時才把 style 併進 v-bind 物件。
 * 不能直接加 :style——v-bind 物件＋:style 會經 mergeProps 正規化成 {}，SSR 輸出 style=""，畫面比對就不再相同。
 */
export function withPhotoStyle<T extends object>(attrs: T, photo: MediaImage | undefined): T | (T & { style: { objectPosition: string } }) {
  return photo?.position ? { ...attrs, style: { objectPosition: photo.position } } : attrs
}

/** 改版前就有 :style 的 <img> 用（課程方向）：後台照片用版位或素材的焦點（沒設就不寫），內建圖用元件寫的位置。 */
export function pagePhotoStyle(builtinPosition: string | undefined, photo: MediaImage | undefined): { objectPosition: string } | undefined {
  const position = photo ? photo.position : builtinPosition
  return position ? { objectPosition: position } : undefined
}

export function rocYear(year: number): number {
  return year - 1911
}
