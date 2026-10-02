// 隱私權政策頁（/privacy）：內文是純文字，約定三種寫法——空行分段、一行開頭「- 」是條列、
// https:// 網址是連結。這裡只把文字切成 token，由元件產生元素；整條路徑不使用 v-html，
// 所以內文裡的 < > & " 一律照原文顯示。

export type PolicyInline =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

export type PolicyBlock =
  | { type: 'paragraph'; inlines: PolicyInline[] }
  | { type: 'list'; items: PolicyInline[][] }

// 網址在空白、角括號、引號與全形標點處結束；ASCII 括號也不算網址。
const URL_PATTERN = /https:\/\/[^\s<>"'）)」』，。、；：]+/g
const TRAILING_PUNCTUATION = /[.,;:!?\]]+$/

function validHttps(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.length > 0
  } catch {
    return false
  }
}

export function parseInlines(raw: string): PolicyInline[] {
  const inlines: PolicyInline[] = []
  let cursor = 0
  for (const match of raw.matchAll(URL_PATTERN)) {
    let url = match[0]
    const trail = url.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    if (trail) url = url.slice(0, -trail.length)
    const start = match.index ?? 0
    if (!validHttps(url)) continue
    if (start > cursor) inlines.push({ type: 'text', text: raw.slice(cursor, start) })
    inlines.push({ type: 'link', text: url, href: url })
    cursor = start + url.length
  }
  if (cursor < raw.length) inlines.push({ type: 'text', text: raw.slice(cursor) })
  return inlines
}

export function parsePolicyBody(body: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = []
  let paragraph: string[] = []
  let list: PolicyInline[][] = []

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inlines: parseInlines(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list })
    list = []
  }

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
    } else if (line.startsWith('- ')) {
      flushParagraph()
      const item = line.slice(2).trim()
      if (item) list.push(parseInlines(item))
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

/** 「2026 年 10 月 3 日」；沒填、格式不對或不存在的日期回空字串。 */
export function policyDateLabel(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!match) return ''
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? `${year} 年 ${month} 月 ${day} 日` : ''
}

export function policyAnchor(index: number): string {
  return `privacy-section-${index + 1}`
}

export type FooterPrivacyEntry = 'policy-link' | 'notice-dialog' | 'none'

/** 頁尾：政策已發布就放連結（取代「個資使用說明」對話框按鈕）；否則維持原本的對話框入口。 */
export function footerPrivacyEntry(hasPolicy: boolean, hasNotice: boolean): FooterPrivacyEntry {
  if (hasPolicy) return 'policy-link'
  return hasNotice ? 'notice-dialog' : 'none'
}

export type FormPrivacyEntry = 'dialog-with-policy' | 'dialog' | 'policy-link' | 'none'

/** 預約表單：個資使用說明對話框保留；政策已發布時對話框底部多一個完整政策連結，沒有說明就直接放連結。 */
export function formPrivacyEntry(hasPolicy: boolean, hasNotice: boolean): FormPrivacyEntry {
  if (hasNotice) return hasPolicy ? 'dialog-with-policy' : 'dialog'
  return hasPolicy ? 'policy-link' : 'none'
}
