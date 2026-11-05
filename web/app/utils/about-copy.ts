/**
 * 首頁「關於常春藤」內文（AboutSection.vue）：摘要沿用發布內容的第一個完整句子，不另寫一份會與 CMS 漂移的文案。
 * 2026-11-04 TA 檢視：內文可以用換行分段（原本約 300 字一整段）。第一段的第一句是摘要（lead），
 * 第一段其餘的字（rest）與之後的段落（more）在手機上收進「閱讀完整介紹」。沒有換行的舊內容照舊是一段。
 */
export interface AboutCopy {
  lead: string
  rest: string
  more: string[]
}

export function aboutCopy(bodyText: string): AboutCopy {
  const [first = '', ...more] = bodyText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const end = first.search(/[。！？]/)
  const lead = end < 0 ? first : first.slice(0, end + 1)
  return { lead, rest: first.slice(lead.length), more }
}
