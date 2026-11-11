// 後台「數據」頁的內容興趣統計（GET /admin/analytics/engagement，2026-11-11）：
// 各頁停留、區塊觸及、互動、單篇消息、造訪來源，以及看過哪些內容的造訪比較會預約。
// 後端：backend/app/operations/engagement_service.py；代碼由官網元件上的
// data-track-section／data-track-action 產生（web/app/utils/engagement.ts）。
import type { components } from '../../../contracts/generated/website-api'
import { campusLabel } from './labels'
import { trafficPageLabel, type TrafficPage } from './traffic'

type Schemas = components['schemas']
export type EngagementSummary = Schemas['EngagementSummaryOut']
export type EngagementSection = Schemas['EngagementSectionOut']
export type EngagementAction = Schemas['EngagementActionOut']
export type EngagementConversion = Schemas['EngagementConversionOut']

// 分母少於這個數時不下結論，只寫「樣本太少」。
export const MIN_ENGAGEMENT_SAMPLES = 20

export function engagementPageLabel(page: string, campusKey: string | null = null): string {
  return trafficPageLabel({ page: page as TrafficPage['page'], campus_key: campusKey })
}

// 區塊代碼 → 名稱（頁面／代碼）。沒有列在這裡的代碼不顯示：公開端點任何人都能送，
// 亂送的代碼不該出現在園方的畫面上。官網新增區塊時要在這裡補名稱。
export const SECTION_LABELS: Record<string, string> = {
  'home/hero': '首屏影片與標語',
  'home/about': '關於常春藤',
  'home/day': '孩子的一天',
  'home/campuses': '五校介紹',
  'home/news': '最新消息',
  'about/hero': '開頭',
  'about/story': '常春藤的故事',
  'about/whole-child': '全人教育',
  'about/hope': '我們的期許',
  'about/voices': '家長與老師的話',
  'admission/hero': '開頭與目錄',
  'admission/process': '入學流程',
  'admission/classes': '寶貝何時入學（班別試算）',
  'admission/newcomer': '新生入學二部曲',
  'admission/faq': '爸媽常問的事',
  'curriculum/hero': '開頭',
  'curriculum/years': '各年齡的學習',
  'curriculum/directions': '教學方向',
  'curriculum/gallery': '課堂照片',
  'curriculum/daily': '每日作息',
  'curriculum/belief': '教學理念',
  'environment/hero': '開頭',
  'environment/care': '照顧與安全',
  'environment/spaces': '校園空間',
  'environment/meals': '餐點',
  'environment/tour': '各校校園照片',
  'anniversary/hero': '開頭',
  'anniversary/timeline': '1997 到 2027 時間軸',
  'anniversary/art': '孩子的作品拼成的 30',
  'anniversary/draw': '換你畫一個 30',
  'anniversary/visit': '帶孩子來學校看看',
  'news/events': '近期活動',
  'news/articles': '消息列表',
  'news/article': '消息內文',
  'news/related': '其他消息',
}

export function sectionLabel(page: string, key: string): string | null {
  return SECTION_LABELS[`${page}/${key}`] ?? null
}

// 「孩子的一天」六張拍立得與入學資訊常見問題的預設名稱；後台改過文案時仍以代碼對應。
const POLAROID_LABELS: Record<string, string> = {
  hello: '早安入園', discover: '好奇探索', lunch: '一起用餐', rest: '安靜片刻', outside: '午後玩耍', home: '帶故事回家',
}
const FAQ_LABELS: Record<string, string> = {
  transfer: '現在轉園或插班可以嗎？',
  age: '寶貝幾歲可以入學？',
  visit: '怎麼預約參觀？',
  fees: '讀私立幼兒園有補助嗎？',
  tuition: '學費大概多少？',
  refund: '中途入園、離園或請假，費用怎麼算？',
  diaper: '還沒戒尿布，可以入學嗎？',
  cry: '剛上學一直哭，怎麼辦？',
  pickup: '阿公阿嬤或保母可以來接嗎？',
  meals: '每天吃什麼？寶貝會過敏怎麼辦？',
  english: '有美語課嗎？',
}
const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']

/** 互動代碼 → 名稱；認不得的代碼回 null（不顯示）。 */
export function actionLabel(key: string): string | null {
  if (key === 'hero_video') return '首頁影片：播放／暫停'
  if (key === 'story_open') return '首頁最新消息：點開一則'
  if (key === 'class_table') return '入學資訊：看完整班別對照表'
  const [, prefix, rest] = /^([a-z]+)_(.+)$/.exec(key) ?? []
  if (!prefix || !rest) return null
  if (prefix === 'polaroid') return `孩子的一天：翻開「${POLAROID_LABELS[rest] ?? rest}」`
  if (prefix === 'faq') return `常見問題：${FAQ_LABELS[rest] ?? rest}`
  if (prefix === 'campus' && CAMPUS_KEYS.includes(rest)) return `首頁五校：切到${campusLabel(rest)}校`
  if (prefix === 'map' && CAMPUS_KEYS.includes(rest)) return `首頁五校：點${campusLabel(rest)}校地址（開地圖）`
  return null
}

// 來源代碼要和後端 operations/models.py 的 ENGAGEMENT_SOURCES 一致（測試會比對）。
export const SOURCE_LABELS: Record<string, string> = {
  direct: '直接進站（輸入網址、書籤、看不出來源）',
  search: '搜尋引擎',
  facebook: 'Facebook',
  instagram: 'Instagram',
  line: 'LINE',
  youtube: 'YouTube',
  ads: '付費廣告',
  other: '其他網站',
}

/** 停留時間：不到 1 分鐘寫秒，其餘寫「幾分幾秒」。 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const rest = seconds % 60
  return rest ? `${Math.floor(seconds / 60)} 分 ${rest} 秒` : `${Math.floor(seconds / 60)} 分`
}

export function formatShare(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`
}

export interface SectionGroup {
  page: string
  label: string
  visits: number
  rows: (EngagementSection & { label: string })[]
}

/** 各頁的區塊，照看到的比例由高到低；只留認得的代碼，頁面照瀏覽次數排。 */
export function sectionGroups(sections: readonly EngagementSection[]): SectionGroup[] {
  const groups = new Map<string, SectionGroup>()
  for (const row of sections) {
    const label = sectionLabel(row.page, row.key)
    if (!label) continue
    const group = groups.get(row.page) ?? { page: row.page, label: engagementPageLabel(row.page), visits: row.visits, rows: [] }
    group.rows.push({ ...row, label })
    groups.set(row.page, group)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, rows: group.rows.sort((a, b) => b.reached - a.reached) }))
    .sort((a, b) => b.visits - a.visits)
}

export function conversionLabel(row: Pick<EngagementConversion, 'kind' | 'page' | 'key'>): string | null {
  if (row.kind === 'page') return engagementPageLabel(row.page)
  const label = row.key ? sectionLabel(row.page, row.key) : null
  return label ? `${engagementPageLabel(row.page)}：${label}` : null
}
