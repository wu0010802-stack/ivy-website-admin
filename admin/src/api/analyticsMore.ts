// 成效統計補強（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）：每月比較、統計健康檢查、
// 找不到的網址、爬蟲、電話與 LINE 的點擊時段。後端 backend/app/operations/analytics_more_routes.py。
import type { components } from '../../../contracts/generated/website-api'
import { api } from './client'
import { engagementPageLabel } from './engagement'

type Schemas = components['schemas']
export type MonthlySummary = Schemas['MonthlySummaryOut']
export type MonthlyItem = Schemas['MonthlyOut']
export type MonthlyRow = Schemas['MonthlyRowOut']
export type StatsHealth = Schemas['StatsHealthOut']
export type NotFoundSummary = Schemas['NotFoundSummaryOut']
export type NotFoundPath = Schemas['NotFoundPathOut']
export type CrawlerSummary = Schemas['CrawlerSummaryOut']
export type CrawlerGroup = Schemas['CrawlerGroupOut']
export type CrawlerBot = Schemas['CrawlerBotOut']
export type ContactHours = Schemas['ContactHoursOut']
export type SearchQueryGroup = Schemas['SearchQueryGroupOut']

export const getMonthly = () => api.get<MonthlySummary>('/admin/analytics/monthly')
export const getStatsHealth = () => api.get<StatsHealth>('/admin/analytics/health')
export const getNotFound = (days: number) => api.get<NotFoundSummary>(`/admin/analytics/not-found?days=${days}`)
export const getCrawlers = (days: number) => api.get<CrawlerSummary>(`/admin/analytics/crawlers?days=${days}`)
export const getContactHours = (days: number) => api.get<ContactHours>(`/admin/analytics/contact-hours?days=${days}`)

// ---- 爬蟲 ----
// 代碼要和 web/shared/crawlers.ts、backend/app/operations/crawler_service.py 一致（測試會比對）。
export const CRAWLER_LABELS: Record<string, string> = {
  'chatgpt-user': 'ChatGPT（有人在問）',
  'oai-searchbot': 'ChatGPT 搜尋',
  gptbot: 'OpenAI 訓練',
  'claude-user': 'Claude（有人在問）',
  'claude-searchbot': 'Claude 搜尋',
  claudebot: 'Anthropic 訓練',
  'perplexity-user': 'Perplexity（有人在問）',
  perplexitybot: 'Perplexity 搜尋',
  'mistralai-user': 'Mistral（有人在問）',
  duckassistbot: 'DuckDuckGo AI',
  'meta-externalagent': 'Meta AI 訓練',
  ccbot: 'Common Crawl',
  bytespider: 'ByteDance（抖音）',
  amazonbot: 'Amazon',
  googlebot: 'Google',
  'google-other': 'Google 其他（廣告、檢測）',
  bingbot: 'Bing',
  applebot: 'Apple（Siri、Spotlight）',
  duckduckbot: 'DuckDuckGo',
  yandexbot: 'Yandex',
  baiduspider: '百度',
  petalbot: '華為 Petal',
  facebookexternalhit: 'Facebook／Instagram 預覽',
  twitterbot: 'X（Twitter）預覽',
  linkedinbot: 'LinkedIn 預覽',
  slackbot: 'Slack 預覽',
  discordbot: 'Discord 預覽',
  telegrambot: 'Telegram 預覽',
  whatsapp: 'WhatsApp 預覽',
  ahrefsbot: 'Ahrefs',
  semrushbot: 'Semrush',
  mj12bot: 'Majestic',
  dotbot: 'Moz',
  dataforseobot: 'DataForSEO',
  uptimerobot: 'UptimeRobot',
  other: '其他自稱爬蟲的',
}

export const CRAWLER_GROUP_LABELS: Record<CrawlerGroup['group'], { label: string; hint: string }> = {
  ai_user: { label: 'AI 助理即時來讀', hint: '有人在 ChatGPT、Claude、Perplexity 問問題，它當下來讀官網再回答' },
  ai_search: { label: 'AI 搜尋建索引', hint: 'AI 助理的搜尋功能先把官網收進索引，之後回答會引用' },
  ai_train: { label: 'AI 公司收集資料', hint: '拿去訓練模型，不會直接帶人來' },
  search: { label: '搜尋引擎', hint: 'Google、Bing 等收錄網頁；Google 的 AI 摘要也用這份' },
  social: { label: '貼連結時抓預覽', hint: '有人在 Facebook 或通訊軟體貼官網連結，抓標題與縮圖' },
  seo: { label: 'SEO 工具', hint: '別人用 SEO 工具查網站，對官網沒有直接影響' },
  monitor: { label: '網站監測', hint: '定時確認官網有沒有正常開' },
  other: { label: '其他', hint: '自稱是爬蟲、但認不出是哪一家' },
}

export function crawlerPageLabel(page: string): string {
  if (page === 'robots') return 'robots.txt（爬蟲規則）'
  if (page === 'sitemap') return 'sitemap.xml（網站地圖）'
  if (page === 'llms') return 'llms.txt（給 AI 的網站說明）'
  if (page === 'other') return '其他網址（含找不到的）'
  return engagementPageLabel(page)
}

// ---- 找不到的網址 ----
export const NOT_FOUND_REF_LABELS: Record<string, string> = {
  none: '沒有來源（書籤、打字、App 裡點開）',
  internal: '官網自己的連結',
  search: '搜尋引擎',
  external: '其他網站',
  crawler: '搜尋引擎或 AI 爬蟲自己來抓',
}

// ---- Google 搜尋字詞分群 ----
export const SEARCH_GROUP_LABELS: Record<SearchQueryGroup['group'], { label: string; hint: string }> = {
  brand: { label: '找我們', hint: '常春藤、ivy、校名' },
  local: { label: '帶高雄地名', hint: '高雄、各區名' },
  category: { label: '找園所（沒帶地名）', hint: '幼兒園、學費、補助' },
  other: { label: '其他', hint: '育兒問題等' },
}

// ---- 每月比較 ----
/** 2026-11 → 2026 年 11 月 */
export function monthLabel(month: string): string {
  const [year, value] = month.split('-')
  return `${year} 年 ${Number(value)} 月`
}

/** 去年同月（2026-11 → 2025-11）。 */
export function lastYearMonth(month: string): string {
  const [year, value] = month.split('-')
  return `${Number(year) - 1}-${value}`
}

/** 比上一個數字多或少幾 %；沒有可比的回空字串。 */
export function changeText(current: number | null | undefined, previous: number | null | undefined): string {
  if (current == null || previous == null) return ''
  if (previous === 0) return current > 0 ? '去年沒有' : '持平'
  const change = Math.round(((current - previous) / previous) * 100)
  return change === 0 ? '持平' : `${change > 0 ? '+' : '−'}${Math.abs(change)}%`
}

export function monthRow(rows: readonly MonthlyRow[], key: string): MonthlyRow | undefined {
  return rows.find((row) => row.key === key)
}

/** 星期 1–7（ISO）→ 星期一…星期日 */
export const ISO_WEEKDAY_LABELS = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'] as const
