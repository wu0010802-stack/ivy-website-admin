import { ENGAGEMENT_CAMPAIGN, type AdPlatform, type EngagementSource } from './engagement'

// 進站來源的判斷（2026-11-16 從 app/utils/engagement.ts 搬來）：瀏覽器端的內容興趣統計，與官網伺服器在進站時
// 寫跨次來源 cookie（server/middleware/01.attribution.ts）用同一套規則，兩邊才分得一樣。只用到 URL 與字串，
// 不碰 window／document，伺服器端也能跑。

/**
 * 進站連結上的活動代碼（utm_campaign）：園方貼連結時自己設的，用來分辨是哪一則貼文或廣告。
 * 只留小寫英數、底線、連字號，最長 32 字；其他字元換成連字號，整個不合格式就不記。
 */
export function campaignOf(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('utm_campaign') ?? ''
  const key = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 32).replace(/-+$/, '')
  return ENGAGEMENT_CAMPAIGN.test(key) ? key : undefined
}

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com)$/
const PAID_MEDIUM = /^(cpc|ppc|paid|paid_social|paidsocial|ads?|display|banner)$/i

/**
 * 落地網址是哪個廣告平台帶來的；不是廣告回 undefined。點擊代碼優先（gclid 系列 → oppref → ldtag_cl），
 * 再看 utm_medium 是付費：utm_source 屬 Meta 系算 meta、chatgpt／openai 開頭算 openai、line 開頭算 line，其他付費算 other。單獨的 fbclid 不算廣告。
 */
export function adPlatformOf(search: string): AdPlatform | undefined {
  const params = new URLSearchParams(search)
  if (['gclid', 'gbraid', 'wbraid'].some((key) => params.has(key))) return 'google'
  if (params.has('oppref')) return 'openai'
  if (params.has('ldtag_cl')) return 'line'
  if (!PAID_MEDIUM.test(params.get('utm_medium') ?? '')) return undefined
  const source = (params.get('utm_source') ?? '').toLowerCase()
  if (/^(facebook|fb|meta|instagram|ig)/.test(source)) return 'meta'
  // oppref 是平台自己附加、不保證每次都有，utm_source 也要認得 ChatGPT／LINE 廣告。
  if (/^(chatgpt|openai)/.test(source)) return 'openai'
  if (/^line/.test(source)) return 'line'
  return 'other'
}

/**
 * 這次造訪從哪裡來，只分成幾種代碼，不保留來源網址。順序：廣告參數 → utm_source → fbclid（Instagram 的線索先於它）→
 * 來源網站 → App 內建瀏覽器（LINE、Facebook、Instagram 常不帶來源網站，從 User-Agent 認）→ 直接進站。
 */
export function classifySource(referrer: string, search: string, origin: string, userAgent = ''): EngagementSource {
  const params = new URLSearchParams(search)
  if (adPlatformOf(search)) return 'ads'
  const named = bySourceName((params.get('utm_source') ?? '').toLowerCase())
  if (named) return named
  let host = ''
  try { if (referrer) { const url = new URL(referrer); host = url.origin === origin ? '' : url.hostname.toLowerCase() } } catch { /* 來源網址壞掉當作沒有 */ }
  // Meta 在 Instagram 的外連連結上也會加 fbclid：Instagram 的線索（來源網站、沒有來源網站時的 App 內建瀏覽器）要先於 fbclid。
  if (params.has('fbclid')) return /(^|\.)instagram\.com$/.test(host) || (!host && /Instagram/.test(userAgent)) ? 'instagram' : 'facebook'
  if (host) {
    if (SEARCH_HOSTS.test(host)) return 'search'
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return 'facebook'
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram'
    if (/(^|\.)(line\.me|lin\.ee|line\.naver\.jp)$/.test(host)) return 'line'
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube'
    return 'other'
  }
  if (/\bLine\//.test(userAgent)) return 'line'
  if (/Instagram/.test(userAgent)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/.test(userAgent)) return 'facebook'
  return 'direct'
}

function bySourceName(name: string): EngagementSource | null {
  if (!name) return null
  if (/^(facebook|fb|meta)/.test(name)) return 'facebook'
  if (/^(instagram|ig)/.test(name)) return 'instagram'
  if (/^line/.test(name)) return 'line'
  if (/^(youtube|yt)/.test(name)) return 'youtube'
  if (/^(google|bing|yahoo)/.test(name)) return 'search'
  return 'other'
}
