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
  boardNote: { max: 60, why: '說明會把五校卡片往下推' },
  campusDescription: { max: 200, why: '分校頁開頭的介紹太長' },
  faqQuestion: { max: 30, why: '問題在手機上會超過兩行' },
  faqAnswer: { max: 200, why: '回答太長，建議拆成兩題' },
  newsTitle: { max: 24, why: '卡片標題會被截斷' },
  newsDescription: { max: 120, why: '卡片摘要會被截斷，完整內文只在展開後看得到' },
  eventTitle: { max: 20, why: '活動名稱在手機上會換行' },
  momentTitle: { max: 14, why: '拍立得標題會換成兩行' },
  momentCaption: { max: 20, why: '拍立得下緣放不下' },
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
