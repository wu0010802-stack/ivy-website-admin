// 中文短句的斷行（2026-11-13 環境頁精修）：瀏覽器替中文換行是「哪個字都能斷」，窄欄裡的短句常從詞中間斷開
// （「提升孩／子的健康」「每日定／時測量體溫」）。Chrome 的 word-break: auto-phrase 目前只認日文，中文沒有作用（實測 Chrome 157）。
// 這裡用 Intl.Segmenter 把句子切成詞，再併成「不該從中間斷」的小段；元件在小段之間放 <wbr>，外層加 word-break: keep-all，
// 換行就只會落在小段之間。只給兩三行的短說明用：長段落每行長短差一兩個字反而顯得不齊，照舊交給瀏覽器。
//
// 併段規則：
// - 句讀與後引號、後括號跟著前一段（行首不會出現標點）；前引號、前括號跟著後一段（行尾不會留開頭的括號）。
// - 單字詞（的、與、式、力…）併到前一段；前面是標點或句首時（「，讓／寶貝」）改併到後一段。
// - 修飾後面的單字詞（最、很、好、更、大、小…）併到後一段（「跳跳／好開心」「明亮的／大廣場」）。
// - 連著兩個疊字詞（「唱唱／跳跳」）併成一段。
// - 一段最多 MAX 個字（不算標點）：一長串單字詞（「厚／軟／墊／防／撞」）不會併成一整塊斷不開的字。

const CLOSING = /^[，。、；：！？）」』》〉】…—～％%,.;:!?)\]]+$/u
const OPENING = /^[（「『《〈【([]+$/u
const ENDS_WITH_BREAK = /[，。、；：！？…—～\s]$/u
const SPACE = /^\s+$/u
const PREFIX = new Set(Array.from('最很好更太都也就才不再沒大小新老每各'))
const REDUPLICATED = /^(\p{Script=Han})\1$/u
const ENDS_REDUPLICATED = /(\p{Script=Han})\1$/u
const MAX = 6

type Segment = (text: string) => string[]

let segmenter: Intl.Segmenter | null | undefined
/**
 * 平台的斷詞（Node 與現在的瀏覽器都有）。沒有 Intl.Segmenter，或執行環境的 ICU 沒帶中文詞典（會把每個字各切一段）時回傳 null，
 * 呼叫端就整句不切、照瀏覽器原本的方式換行——寧可不處理，也不要照錯的詞界斷。
 */
function words(text: string): string[] | null {
  if (segmenter === undefined) {
    segmenter = null
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const candidate = new Intl.Segmenter('zh-Hant', { granularity: 'word' })
      if (Array.from(candidate.segment('孩子的健康'), (part) => part.segment).join('|') === '孩子|的|健康') segmenter = candidate
    }
  }
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : null
}

const letters = (chunk: string) => Array.from(chunk.replace(/[\p{P}\p{S}\s]/gu, '')).length

/** 把句子切成不該從中間斷行的小段；接起來和原文一字不差。segment 可換成別的斷詞（測試用）。 */
export function phraseChunks(text: string, segment: Segment | null = null): string[] {
  const parts = segment ? segment(text) : words(text)
  if (!parts || parts.length < 2) return text ? [text] : []
  const chunks: string[] = []
  /** 等著併到下一段開頭的字（前引號、句首或標點後的單字詞） */
  let lead = ''
  for (const part of parts) {
    const last = chunks.length - 1
    if (CLOSING.test(part) || SPACE.test(part)) {
      // 標點、空白跟著前一段（空白本身就是可以換行的地方）
      if (lead) { chunks.push(lead + part); lead = '' } else if (last >= 0) chunks[last] += part
      else chunks.push(part)
      continue
    }
    if (OPENING.test(part)) { lead += part; continue }
    if (!lead && last >= 0 && REDUPLICATED.test(part) && ENDS_REDUPLICATED.test(chunks[last]!) && letters(chunks[last]!) <= MAX - 2) { chunks[last] += part; continue }
    const single = Array.from(part).length === 1
    if (single && PREFIX.has(part) && letters(lead) < 2) { lead += part; continue }
    if (single && !lead && last >= 0 && !ENDS_WITH_BREAK.test(chunks[last]!) && letters(chunks[last]!) < MAX) { chunks[last] += part; continue }
    if (single && letters(lead) < 2) { lead += part; continue }
    chunks.push(lead + part)
    lead = ''
  }
  if (lead) { if (chunks.length && letters(chunks.at(-1)!) < MAX) chunks[chunks.length - 1] += lead; else chunks.push(lead) }
  return chunks
}
