import { pickImage, type MediaImage } from './media-image'

// 整頁內容（特色教學頁、關於常春藤頁、常春藤環境頁）共用的小工具。後台的標題欄位用 \n 表示換行；
// 照片版位沒換過就用元件寫死的內建圖與內建說明。

/** 各清單固定的項目數（同後端 content/page_schemas.py）；已發布內容不符時官網退回內建內容。 */
export const PAGE_COUNTS = {
  curriculum: { chapters: 4, years: 4, directions: 7, gallery: 8, daily: 5, beliefs: 5 },
  about: { chapterNames: 4, milestones: 5, hopeQuotes: 2 },
  environment: { chapterNames: 4, hearts: 5, careItems: 5, spaces: 6, meals: 5 }
} as const

export function assertCounts(lists: Record<string, unknown>, expected: Record<string, number>): void {
  for (const [name, count] of Object.entries(expected)) {
    const list = lists[name]
    if (!Array.isArray(list)) throw new Error(`${name} 應為清單`)
    if (list.length !== count) throw new Error(`${name} 應為 ${count} 項，實際 ${list.length} 項`)
  }
}

/** 欄位必須是字串（可為空字串）；source 不是物件或欄位型別不符就丟錯。 */
export function assertStrings(source: unknown, fields: readonly string[], label: string): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${label} 應為物件`)
  for (const field of fields) {
    if (typeof (source as Record<string, unknown>)[field] !== 'string') throw new Error(`${label}.${field} 應為字串`)
  }
}

/** 清單每一項都是物件且指定欄位為字串（beliefs 這類字串清單由呼叫端逐項檢查 typeof）。 */
export function assertItems(list: unknown, fields: readonly string[], label: string): void {
  ;(list as unknown[]).forEach((item, index) => assertStrings(item, fields, `${label}[${index}]`))
}

/**
 * 2026-11-03：標題大字不放逗號、句號（比照首屏「在常春藤⏎每一天都有新發現」）。
 * 行尾的「，」「。」拿掉（換行就是停頓；收在引號、括號裡的也拿掉，只留括號）；行中間的換成一個空格，
 * 保留停頓，也讓窄螢幕在 keep-all 下有地方換行。問號、驚嘆號、頓號、引號照留。
 * 後台內容照原樣存，官網輸出時才處理，所以後台打了標點也會自動拿掉。
 */
export function plainTitleLine(line: string): string {
  return line
    .replace(/[，。]+(?=[」』）]*\s*$)/u, '')
    .replace(/\s*[，。]+\s*/gu, ' ')
    .trim()
}

/** 不分行輸出的標題（首頁理念大標、環境頁「一天吃這些」）：每一行都去掉逗號、句號。 */
export function plainTitle(text: string): string {
  return text.split('\n').map(plainTitleLine).filter(Boolean).join('\n')
}

export function pageTitleLines(text: string): string[] {
  return text.split('\n').map(plainTitleLine).filter((line) => line !== '')
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

/**
 * 照片被 object-fit: cover 裁進比它「瘦」的框（拱、圓、四分之一圓）時，瀏覽器實際要畫的寬度＝框寬 × (照片寬高比 ÷ 框寬高比)。
 * sizes 只寫框寬的話，橫幅照片會挑到太小的候選檔：環境頁「健康把關」2.1:1 的照片放在 0.78 的拱裡，
 * 2026-11-13 前 Retina 桌機只拿到需要的 0.67 倍。frameAspect＝框的寬 ÷ 高；sizes 收到倍率（至少 1）後回傳完整的 sizes 字串。
 * 後台換了照片就照新照片的寬高比算。
 */
export function pageCoverPhotoAttrs(builtin: string, photo: MediaImage | undefined, frameAspect: number, sizes: (factor: number) => string) {
  const { width, height } = pickImage(builtin, photo)
  const factor = width && height && frameAspect > 0 ? Number(Math.max(1, width / height / frameAspect).toFixed(2)) : 1
  return pickImage(builtin, photo, sizes(factor))
}

export function pagePhotoAlt(builtinAlt: string, photo: MediaImage | undefined, alt: string | undefined): string {
  return photo ? (alt || photo.alt) : builtinAlt
}

/**
 * 後台照片的 object-position：版位焦點，其次素材預設焦點，都沒設就置中——和後台焦點預覽一樣
 * （FocusPicker：版位焦點 ?? 素材焦點 ?? 正中央）。不能留給 CSS：首屏的 80% 45%、課程方向的
 * 40% 50% 是為內建照片調的，套到新照片上會和後台預覽對不上。
 */
export const PAGE_PHOTO_DEFAULT_POSITION = '50% 50%'

function pagePhotoPosition(photo: MediaImage): string {
  return photo.position ?? PAGE_PHOTO_DEFAULT_POSITION
}

/**
 * 改版前沒有 :style 的 <img> 用：後台照片才把 style 併進 v-bind 物件，內建圖不帶（沿用 CSS）。
 * 不能直接加 :style——v-bind 物件＋:style 會經 mergeProps 正規化成 {}，SSR 輸出 style=""，畫面比對就不再相同。
 */
export function withPhotoStyle<T extends object>(attrs: T, photo: MediaImage | undefined): T | (T & { style: { objectPosition: string } }) {
  return photo ? { ...attrs, style: { objectPosition: pagePhotoPosition(photo) } } : attrs
}

/** 改版前就有 :style 的 <img> 用（課程方向）：後台照片用 pagePhotoPosition，內建圖用元件寫的位置（沒寫就不帶）。 */
export function pagePhotoStyle(builtinPosition: string | undefined, photo: MediaImage | undefined): { objectPosition: string } | undefined {
  const position = photo ? pagePhotoPosition(photo) : builtinPosition
  return position ? { objectPosition: position } : undefined
}

export function rocYear(year: number): number {
  return year - 1911
}
