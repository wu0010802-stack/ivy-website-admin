// 內容編輯頁的建議長度與圖片比例（規格 L94）。後端只擋 2000 字的上限，這裡是
// 依官網版面抓的「超過就容易在手機上換成很多行、或被卡片截斷」的建議值，
// 不會擋存檔；要調整時只改這張表。

/** 建議字數上限與超過時的後果（顯示在欄位下方） */
export interface LengthHintRule {
  /** 整個欄位的字數（標題的換行也算一個字）；陣列＝標題逐行的字數（第 i 行用第 i 個，超出的行用最後一個） */
  max: number | readonly number[]
  why: string
}

export const LENGTH_HINTS = {
  aboutTitle: { max: 16, why: '標題在手機上會超過兩行' },
  aboutBody: { max: 300, why: '段落太長，家長不容易讀完' },
  aboutCaption: { max: 30, why: '照片下方文字會換成多行' },
  footerTagline: { max: 30, why: '頁尾標語會換成多行' },
  boardTitle: { max: 12, why: '標題在手機上會換行' },
  newsTitle: { max: 24, why: '卡片標題會被截斷' },
  newsDescription: { max: 120, why: '卡片摘要會被截斷，完整內文只在展開後看得到' },
  eventTitle: { max: 20, why: '活動名稱在手機上會換行' },
  momentTitle: { max: 14, why: '拍立得標題會換成兩行' },
  momentStory: { max: 120, why: '翻面後的卡片放不下，要捲動才看得完' },
  tourIntro: { max: 80, why: '場景說明會蓋住照片' },
  bookingCta: { max: 6, why: '頁首按鈕放不下' },
  // 特色教學頁（2026-10 開放後台編輯）：建議值＝現在的字數再留一點；擋存檔的硬上限在後端
  // content/page_schemas.py（DESIGN.md「特色教學頁、關於常春藤頁開放後台編輯」有對照表）。
  curEyebrow: { max: 16, why: '手機上會換成兩行' },
  curHeroTitle: { max: 16, why: '大標在手機上會超過三行' },
  curHighlight: { max: 4, why: '顏料只畫在一小段字上，太長會蓋住整行' },
  curLede: { max: 45, why: '首屏介紹在手機上會變成很多行' },
  curNotice: { max: 30, why: '提醒會換成兩行' },
  curChapterLabel: { max: 6, why: '章節索引的顏料盤旁放不下' },
  curChapterHint: { max: 8, why: '章節索引的小字會換行' },
  curSectionTitle: { max: 18, why: '段落標題在手機上會超過三行' },
  curSectionText: { max: 32, why: '段落說明會換成很多行' },
  curSpiralLabel: { max: 6, why: '粗體標題太長，說明會被擠到下一行' },
  curSpiralText: { max: 30, why: '顏料框裡的說明會超過兩行' },
  curCaption: { max: 16, why: '照片下方文字會換成兩行' },
  curMotto: { max: 6, why: '年段標語會換行' },
  curYearText: { max: 50, why: '四個年段的卡片會高低不齊' },
  curDirTitle: { max: 6, why: '課程方向的標題會換行' },
  curDirSub: { max: 16, why: '副標會換成兩行' },
  curDirText: { max: 24, why: '說明會換成很多行' },
  // 品德培養印在顏料上：引言是大字（手機與桌機一行約 5 個字），硬上限 10；說明硬上限 20。
  curQuote: { max: 8, why: '大字引言一行只放得下約 5 個字，字越多越擠到顏料邊緣' },
  curQuoteText: { max: 12, why: '手機上會換成兩行，把引言往上推' },
  curSource: { max: 26, why: '出處的小字會換成兩行' },
  curArtLabel: { max: 6, why: '作品名稱會換行' },
  curDailyTitle: { max: 5, why: '五件事的名稱會換行' },
  curDailyText: { max: 90, why: '五件事的卡片會高低不齊' },
  curBelief: { max: 14, why: '教學理念的一項會換成兩行' },
  curBeliefTitle: { max: 22, why: '結尾大標在手機上會超過三行' },
  curClose: { max: 26, why: '結語會換成兩行' },
  // 關於常春藤頁（立體書）：左頁空間有限，建議值抓得比較緊。
  aboutPageTitle: { max: 16, why: '標題太長，立體書左頁會折成很多行' },
  aboutHopeTitle: { max: 18, why: '標題太長，立體書左頁會折成很多行' },
  // 一路走來的標題右上角是紀念章：逐行算，和後端硬上限一樣（page_schemas.py 的 STORY_TITLE_PER_LINE）。
  aboutStoryTitle: { max: [6, 7, 7], why: '會壓到右上角的紀念章，存不了' },
  aboutPageLede: { max: 70, why: '首屏介紹在手機上會變成很多行' },
  aboutPageCaption: { max: 12, why: '卡紙上的一句話會換行' },
  aboutChapter: { max: 5, why: '目次與章節封面放不下' },
  aboutPageText: { max: 70, why: '左頁的說明會擠到頁緣' },
  aboutMilestone: { max: 18, why: '沿革一列會換成兩行' },
  aboutFine: { max: 55, why: '補充說明會擠到頁緣' },
  aboutSource: { max: 16, why: '出處的小字會換成兩行' },
  aboutQuote: { max: 40, why: '引言會換成很多行' },
  aboutOutroTitle: { max: 6, why: '目次最後一格放不下' },
  aboutOutroText: { max: 45, why: '結尾說明會換成很多行' },
} as const satisfies Record<string, LengthHintRule>

export type LengthHintKey = keyof typeof LENGTH_HINTS

/** 字數以字元計（全形、半形、表情符號都算一個）。 */
export function textLength(value: string | null | undefined): number {
  return value ? Array.from(value).length : 0
}

export function lengthHintText(value: string | null | undefined, rule: LengthHintRule): { text: string; over: boolean } {
  if (typeof rule.max !== 'number') return lineHintText(value, rule.max, rule.why)
  const count = textLength(value)
  if (count === 0) return { text: `建議 ${rule.max} 字內`, over: false }
  if (count <= rule.max) return { text: `${count} 字・建議 ${rule.max} 字內`, over: false }
  return { text: `${count} 字，超過建議的 ${rule.max} 字：${rule.why}`, over: true }
}

/** 標題逐行的建議字數：哪一行超過就講第幾行。 */
function lineHintText(value: string | null | undefined, limits: readonly number[], why: string): { text: string; over: boolean } {
  const suggested = `建議 ${limits.join('／')} 字內`
  if (!value) return { text: `每行${suggested}`, over: false }
  const counts = value.split('\n').map(textLength)
  const index = counts.findIndex((count, i) => count > limits[Math.min(i, limits.length - 1)]!)
  if (index < 0) return { text: `每行 ${counts.join('／')} 字・${suggested}`, over: false }
  const limit = limits[Math.min(index, limits.length - 1)]
  return { text: `第 ${index + 1} 行 ${counts[index]} 字，超過建議的 ${limit} 字：${why}`, over: true }
}

// 官網實際裁切的比例（web 的 CSS aspect-ratio）；照片都以 object-fit: cover
// 裁切，重點位置在素材庫設定。
export const IMAGE_HINTS = {
  news: '建議橫式、寬 1200px 以上。官網桌機裁成約 7:4、手機與首頁卡片裁成約 4:3，重要的人物放在中間，或到素材庫設定重點位置。',
  tour: '建議橫式、寬 1600px 以上（例如 1600×1000）。官網照原比例整張顯示，不裁切。',
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

// 原型留下的示範文字：官網（web/app/utils/public-copy.ts 的 publicCopy）遇到「一字不差」
// 的原文時換成正式文案，後台看到的仍是原文。這裡只認那幾段原文，不用「示意」這類
// 關鍵字（消息的示意說明、時刻卡的「情境示意」是刻意保留的標示，DESIGN.md 286／302）。
// 原文要和 public-copy.ts 保持一致；那邊改了這裡也要改。
export const LEGACY_SITE_DESCRIPTION = '走進常春藤，認識五校的環境與孩子的校園生活。官網設計互動提案。'
export const LEGACY_FOOTER_NOTE = '官網設計提案 · 預約為操作示範，不會送出資料'

/**
 * 欄位值是原型原文（官網目前顯示替換後的正式文案）時的提示；不是就回空字串。
 */
export function legacyCopyHint(field: 'siteDescription' | 'footerNote', value: string | null | undefined): string {
  const text = value ?? ''
  switch (field) {
    case 'siteDescription':
      return text === LEGACY_SITE_DESCRIPTION
        ? '這是原型留下的文字，官網目前顯示替換後的正式描述；改了這段之後就不再自動替換，官網會照這裡顯示。'
        : ''
    case 'footerNote':
      return text === LEGACY_FOOTER_NOTE
        ? '這是原型留下的文字，官網目前不顯示這段；改了這段之後官網就會照這裡顯示。'
        : ''
  }
}
