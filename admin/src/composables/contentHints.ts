// 內容編輯頁的建議長度與圖片比例（規格 L94）。後端只擋 2000 字的上限，這裡是
// 依官網版面抓的「超過就容易在手機上換成很多行、或被卡片截斷」的建議值，
// 不會擋存檔；要調整時只改這張表。

/** 建議字數上限與超過時的後果（顯示在欄位下方） */
export interface LengthHintRule {
  max: number
  why: string
}

export const LENGTH_HINTS = {
  heroEyebrow: { max: 20, why: '手機上會換成兩行' },
  aboutTitle: { max: 16, why: '標題在手機上會超過兩行' },
  aboutBody: { max: 300, why: '段落太長，家長不容易讀完' },
  aboutCaption: { max: 30, why: '照片說明會換成多行' },
  footerTagline: { max: 30, why: '頁尾標語會換成多行' },
  boardTitle: { max: 12, why: '標題在手機上會換行' },
  campusDescription: { max: 200, why: '分校頁開頭的介紹太長' },
  faqQuestion: { max: 30, why: '問題在手機上會超過兩行' },
  faqAnswer: { max: 200, why: '回答太長，建議拆成兩題' },
  newsTitle: { max: 24, why: '卡片標題會被截斷' },
  newsDescription: { max: 120, why: '卡片摘要會被截斷，完整內文只在展開後看得到' },
  eventTitle: { max: 20, why: '活動名稱在手機上會換行' },
  momentTitle: { max: 14, why: '拍立得標題會換成兩行' },
  momentStory: { max: 120, why: '翻面後的卡片放不下，要捲動才看得完' },
  tourIntro: { max: 80, why: '場景說明會蓋住照片' },
  tourSpotText: { max: 80, why: '熱點說明框會超出照片' },
  bookingCta: { max: 6, why: '頁首按鈕放不下' },
} as const satisfies Record<string, LengthHintRule>

export type LengthHintKey = keyof typeof LENGTH_HINTS

/** 字數以字元計（全形、半形、表情符號都算一個）。 */
export function textLength(value: string | null | undefined): number {
  return value ? Array.from(value).length : 0
}

export function lengthHintText(value: string | null | undefined, rule: LengthHintRule): { text: string; over: boolean } {
  const count = textLength(value)
  if (count === 0) return { text: `建議 ${rule.max} 字內`, over: false }
  if (count <= rule.max) return { text: `${count} 字・建議 ${rule.max} 字內`, over: false }
  return { text: `${count} 字，超過建議的 ${rule.max} 字：${rule.why}`, over: true }
}

// 官網實際裁切的比例（web 的 CSS aspect-ratio）；照片都以 object-fit: cover
// 裁切，重點位置在素材庫設定。
export const IMAGE_HINTS = {
  news: '建議橫式、寬 1200px 以上。官網桌機裁成約 7:4、手機與首頁卡片裁成約 4:3，重要的人物放在中間，或到素材庫設定重點位置。',
  tour: '建議橫式 16:10（例如 1600×1000）。照片會整張放進 16:10 的框裡，熱點位置以整張照片計算，換照片後要重新確認熱點。',
} as const

// 孩子的一天的時刻卡時間：官網用開頭的「時:分」決定背景影片的光線（web
// utils/dayLight.ts），打「早上」之類的字光線就不會跟著變。後端不擋格式，這裡提示。
const MOMENT_TIME = /^([01]?\d|2[0-3]):[0-5]\d$/

/** 全形數字與冒號轉半形、補零：「８：０５」「8:05」「0805」都變成「08:05」；看不懂的原樣留著。 */
export function normalizeMomentTime(value: string): string {
  const text = value.trim().replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const compact = /^(\d{1,2})(\d{2})$/.exec(text)
  const candidate = compact ? `${compact[1]}:${compact[2]}` : text
  if (!MOMENT_TIME.test(candidate)) return value
  const [h, m] = candidate.split(':')
  return `${h!.padStart(2, '0')}:${m}`
}

/** 時間格式有問題時回傳說明；空白（還沒填）與 24 小時制的「時:分」回空字串。 */
export function momentTimeError(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (!text || MOMENT_TIME.test(text)) return ''
  // 錯誤訊息在半欄寬的欄位下方，只放得下一行；為什麼要這樣填寫在時刻卡清單的說明裡。
  return '請用「時:分」，例如 08:05、13:30'
}
