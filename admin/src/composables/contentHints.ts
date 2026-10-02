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
  aboutCaption: { max: 30, why: '照片下方文字會換成多行' },
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
  // 分校頁底部的預約橫幅：手機標題 24px、一行約 14 字；內文 14px、一行約 25 字。
  // 標題以換成校名之後的字數計（見 bannerTitlePreview）。
  bannerTitle: { max: 24, why: '標題在手機上會超過兩行' },
  bannerBody: { max: 50, why: '內文在手機上會超過兩行' },
  bannerButton: { max: 10, why: '按鈕太寬，桌機上旁邊的標題會被擠窄' },
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

// 分校頁底部的預約橫幅（預約文案）：標題裡的 {campusNameOrIvy} 是校名的位置，官網每個
// 分校頁換成自己的校名（園方手打的 {campus} 也算）；欄位留空時官網沿用原本的三句話。
// 規則跟官網分校頁的橫幅一致，後台用來預覽，不讓園方自己打大括號。
export const BANNER_CAMPUS_TOKEN = '{campusNameOrIvy}'
const BANNER_CAMPUS_PATTERN = /\{(?:campusNameOrIvy|campus)\}/g
export const BANNER_DEFAULTS = {
  title: `親自走一趟，感受${BANNER_CAMPUS_TOKEN}的日常。`,
  body: '帶著孩子，也帶著你想了解的事。我們期待與你相遇。',
  button: '預約校園參觀',
} as const

/** 某一校的分校頁實際顯示的橫幅標題；留空時是原本的標題。 */
export function bannerTitlePreview(template: string | null | undefined, campusName: string): string {
  const text = template?.trim() || BANNER_DEFAULTS.title
  // 用函式替換：校名裡若有 `$&` 之類的字，字串替換會當成特殊樣式。
  return text.replace(BANNER_CAMPUS_PATTERN, () => campusName)
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

// 原型留下的示範文字：官網（web/app/utils/public-copy.ts 的 publicCopy）遇到「一字不差」
// 的原文時換成正式文案，後台看到的仍是原文。這裡只認那幾段原文，不用「示意」這類
// 關鍵字（消息的示意說明、時刻卡的「情境示意」是刻意保留的標示，DESIGN.md 286／302）。
// 原文要和 public-copy.ts 保持一致；那邊改了這裡也要改。
export const LEGACY_SITE_DESCRIPTION = '走進常春藤，認識五校的環境與孩子的校園生活。官網設計互動提案。'
export const LEGACY_FOOTER_NOTE = '官網設計提案 · 預約為操作示範，不會送出資料'
export const LEGACY_FAQ_BOOKING = '先選擇想參觀的校區，再留下家長稱呼、電話與方便聯絡的時段。這份 prototype 僅示範流程，不會送出資料；實際參觀請直接致電園所。'
const LEGACY_FAQ_FEE = /^招生年齡、名額與費用依校區與學年度而異。請向.+確認；這份提案不提供即時招生名額或費用報價。$/

/**
 * 欄位值是原型原文（官網目前顯示替換後的正式文案）時的提示；不是就回空字串。
 * 分校 FAQ 只有在這一校還留著原型的預約回答時才整組替換（public-copy.ts），所以
 * faqAnswer 要帶同一校全部的回答（answers）；沒帶時當作還留著。
 */
export function legacyCopyHint(field: 'siteDescription' | 'footerNote' | 'faqAnswer', value: string | null | undefined, answers?: readonly string[]): string {
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
    case 'faqAnswer': {
      if (answers && !answers.includes(LEGACY_FAQ_BOOKING)) return ''
      if (text === LEGACY_FAQ_BOOKING) {
        return '這是原型留下的回答，官網目前顯示替換後的正式回答，並在最後多一題「在哪裡？如何聯絡？」；改了這一題之後，這一校的回答都照這裡顯示，那一題也不再加上。'
      }
      return LEGACY_FAQ_FEE.test(text)
        ? '這是原型留下的回答，官網目前顯示替換後的正式回答；預約那一題改掉之後就不再替換，官網會照這裡顯示。'
        : ''
    }
  }
}
