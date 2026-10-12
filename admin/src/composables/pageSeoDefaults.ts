// 全站設定「各頁搜尋與分享」（2026-10-12）：七個公開頁各自的搜尋標題、描述與分享圖。
// 內建標題與描述是官網 web/app/utils/seo.ts 各頁函式裡的文字（品牌名稱取 fixture 的
// siteMeta.brandName、創校年份取沿革第一站的內建 1997、隱私權政策標題取內建「隱私權政策」）。
// 後台只拿來當欄位的提示字（留空就是官網用這句）；__tests__/siteMetaSeo.test.ts 讀官網原始碼逐字比對，
// 官網那邊改了這裡也要改。api/labels 與 contentFieldLabels 會用到本檔，所以這裡只 import 型別（避免循環）。

import type { PageSeoEntryPayload, PageSeoKey } from '../api/types'

export type { PageSeoKey }

// 順序同後端 content/schemas.py 的 PageSeoKey，也是頁籤的順序。
export const PAGE_SEO_KEYS: readonly PageSeoKey[] = ['admission', 'about', 'curriculum', 'environment', 'news', 'anniversary', 'privacy']

export interface PageSeoPage {
  key: PageSeoKey
  /** 頁籤與錯誤位置上的頁名（不含「頁」字） */
  label: string
  /** 官網上的公開路徑 */
  path: string
  /** 內建文字有隨其他內容變動的部分時，欄位下方多說一句 */
  note?: string
}

export const PAGE_SEO_PAGES: readonly PageSeoPage[] = [
  { key: 'admission', label: '入學資訊', path: '/admission' },
  { key: 'about', label: '關於常春藤', path: '/about', note: '內建文字裡的創校年份，跟著「關於常春藤頁」沿革第一站的年份。' },
  { key: 'curriculum', label: '特色教學', path: '/curriculum' },
  { key: 'environment', label: '常春藤環境', path: '/environment' },
  { key: 'news', label: '最新消息', path: '/news' },
  { key: 'anniversary', label: '30 週年', path: '/anniversary' },
  { key: 'privacy', label: '隱私權政策', path: '/privacy', note: '內建標題的頭一段，跟著「隱私權政策」頁的標題。' },
]

const BRAND = '常春藤教育機構'

export const PAGE_SEO_DEFAULTS: Readonly<Record<PageSeoKey, { title: string; description: string }>> = {
  admission: {
    title: `入學資訊｜入學流程、新生須知、收退費與分班｜${BRAND}`,
    description: '常春藤幼兒園入學流程、新生入園須知、收退費辦法與補助，並可依寶貝生日查詢就讀班級。',
  },
  about: {
    title: `關於常春藤｜1997 年創立、五所校園與全人教育｜${BRAND}`,
    description: '常春藤幼兒園 1997 年在高雄三民區義華路創立，陸續成立明華、崇德、國際、仁武校。秉持全人教育，以課綱六大領域培養孩子六大核心素養。',
  },
  curriculum: {
    title: `特色教學｜四個年段、七個課程方向與每天的五件事｜${BRAND}`,
    description: '常春藤幼兒園的特色教學：幼幼班到大班四個年段，認知、統整、多元文化、品德、自主學習、課程活動與藝術共創七個課程方向，孩子作品的兒童美術館，以及靜心、教具操作、美術創作、閱讀與大肌肉時間。',
  },
  environment: {
    title: `常春藤環境｜幼兒保育、校園環境與幼兒餐點｜${BRAND}`,
    description: '常春藤幼兒園的保育照顧、校園空間與每日餐點：五顆心照顧孩子，教室、教具、衛廁到戶外廣場都以安全與探索為出發點，每月菜單收在營養餐點書。',
  },
  news: {
    title: `最新消息｜校園活動與各校公告｜${BRAND}`,
    description: '常春藤幼兒園義華、明華、崇德、國際、仁武五校的最新消息與近期活動。',
  },
  anniversary: {
    title: `常春藤 30 週年｜1997—2027｜${BRAND}`,
    description: '1997 年，第一間常春藤在高雄三民區義華路成立，到 2027 年滿 30 年。看義華、明華、崇德、國際、仁武五所校園一年一年長出來，也換你用蠟筆畫一個 30。',
  },
  privacy: {
    title: `隱私權政策｜${BRAND}`,
    description: '常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。',
  },
}

/** 欄位在表單上的名字；422 的位置與發布確認框共用。 */
export const PAGE_SEO_FIELD_LABELS = {
  title: '搜尋標題',
  description: '搜尋描述',
  share_image: '分享圖',
  share_image_alt: '分享圖說明',
} as const

export type PageSeoEntry = PageSeoEntryPayload
export type PageSeoMap = Record<PageSeoKey, PageSeoEntry>

export function emptyPageSeoEntry(): PageSeoEntry {
  return { title: '', description: '', share_image: '', share_image_alt: '' }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * 載入時把 page_seo 補成七頁都有、每頁四個欄位都有（沒設定過的是 null 或缺欄位）：
 * 表單才有東西可以綁，也不會因為補預設值而多出「未儲存的修改」。順序固定，
 * 不認得的頁（舊資料、手動打 API）丟掉。
 */
export function normalizePageSeo(raw: unknown): PageSeoMap {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(
    PAGE_SEO_KEYS.map((key) => {
      const entry = source[key] && typeof source[key] === 'object' ? (source[key] as Record<string, unknown>) : {}
      return [key, { title: text(entry.title), description: text(entry.description), share_image: text(entry.share_image), share_image_alt: text(entry.share_image_alt) }]
    }),
  ) as PageSeoMap
}

/** 這一頁有沒有任何一欄自訂過（空白不算）。 */
export function pageSeoCustomised(entry: PageSeoEntry | null | undefined): boolean {
  return Boolean(entry) && Object.values(entry!).some((value) => typeof value === 'string' && value.trim() !== '')
}

export function pageSeoPageLabel(key: string): string | undefined {
  const page = PAGE_SEO_PAGES.find((p) => p.key === key)
  return page ? `${page.label}頁` : undefined
}

/** 發布確認框的細項：page_seo 兩版之間改了哪幾頁。沒有差異回 undefined。 */
export function pageSeoChangeDetail(before: unknown, after: unknown): string | undefined {
  const a = normalizePageSeo(before)
  const b = normalizePageSeo(after)
  const changed = PAGE_SEO_KEYS.filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).map((key) => pageSeoPageLabel(key)!)
  return changed.length ? `修改 ${changed.join('、')}` : undefined
}
