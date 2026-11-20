import { publicPage } from './telemetry'

// 搜尋引擎與 AI 爬蟲（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §7）：官網伺服器看 User-Agent 認是哪一家，
// 每分鐘彙總送給 API（server/plugins/crawler-hits.ts）。User-Agent 是自稱的，沒有反查 DNS，數字當參考。
// 代碼要和後端 backend/app/operations/crawler_service.py 的 CRAWLER_GROUPS 一致（測試會比對），
// 後台 admin/src/api/crawlerLabels.ts 也要有名稱。比對照順序，先比較具體的（ChatGPT-User 要在 GPTBot 前面）。
export const CRAWLERS: ReadonlyArray<readonly [code: string, pattern: RegExp]> = [
  ['chatgpt-user', /ChatGPT-User/i],
  ['oai-searchbot', /OAI-SearchBot/i],
  ['gptbot', /GPTBot/i],
  ['claude-user', /Claude-User/i],
  ['claude-searchbot', /Claude-SearchBot/i],
  ['claudebot', /ClaudeBot|anthropic-ai/i],
  ['perplexity-user', /Perplexity-User/i],
  ['perplexitybot', /PerplexityBot/i],
  ['mistralai-user', /MistralAI-User/i],
  ['duckassistbot', /DuckAssistBot/i],
  ['meta-externalagent', /meta-externalagent/i],
  ['ccbot', /CCBot/i],
  ['bytespider', /Bytespider/i],
  ['amazonbot', /Amazonbot/i],
  ['google-other', /GoogleOther|Google-InspectionTool|AdsBot-Google|Google-Extended|Storebot-Google|Mediapartners-Google/i],
  ['googlebot', /Googlebot/i],
  ['bingbot', /bingbot|BingPreview/i],
  ['applebot', /Applebot/i],
  ['duckduckbot', /DuckDuckBot/i],
  ['yandexbot', /YandexBot|YandexAccessibilityBot/i],
  ['baiduspider', /Baiduspider/i],
  ['petalbot', /PetalBot/i],
  ['facebookexternalhit', /facebookexternalhit|meta-externalfetcher|facebookcatalog/i],
  ['twitterbot', /Twitterbot/i],
  ['linkedinbot', /LinkedInBot/i],
  ['slackbot', /Slackbot/i],
  ['discordbot', /Discordbot/i],
  ['telegrambot', /TelegramBot/i],
  ['whatsapp', /WhatsApp/i],
  ['ahrefsbot', /AhrefsBot/i],
  ['semrushbot', /SemrushBot/i],
  ['mj12bot', /MJ12bot/i],
  ['dotbot', /DotBot/i],
  ['dataforseobot', /DataForSeoBot/i],
  ['uptimerobot', /UptimeRobot/i],
]
// 其他自稱爬蟲的（同 client-error.ts 的判斷，但不含無畫面瀏覽器與 Lighthouse：那些是我們自己的自動化）。
const OTHER_BOT = /bot(?:[/;)-]|$)|spider|crawl/i

/** User-Agent → 爬蟲代碼；一般瀏覽器回 null。 */
export function crawlerOf(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  for (const [code, pattern] of CRAWLERS) if (pattern.test(userAgent)) return code
  return OTHER_BOT.test(userAgent) ? 'other' : null
}

/** 爬蟲抓的網址 → 頁面代碼（同瀏覽統計），robots／sitemap／llms 三個檔案各一類；靜態資源、API 不算（回 null），其他算 other。 */
export function crawlerPageOf(path: string): string | null {
  const clean = path.split(/[?#]/)[0] ?? '/'
  if (clean === '/robots.txt') return 'robots'
  if (clean === '/sitemap.xml') return 'sitemap'
  if (clean === '/llms.txt') return 'llms'
  // /__nuxt_error 這類 Nuxt 內部請求（錯誤頁是另外渲染的）也不算，不然一次 404 會記兩次。
  if (/^\/(?:__|(?:_nuxt|_ipx|api|assets|admin)(?:\/|$))/.test(clean) || /\.[a-z0-9]{2,5}$/i.test(clean)) return null
  return publicPage(clean)?.page ?? 'other'
}

export function statusClass(status: number): '2xx' | '3xx' | '4xx' | '5xx' | null {
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  if (status >= 500 && status < 600) return '5xx'
  return null
}

/** 搜尋引擎與 AI 爬蟲抓到 404 時把路徑也記下來（社群預覽、SEO 工具、監測不記）。 */
export const NOT_FOUND_CRAWLERS = new Set([
  'chatgpt-user', 'oai-searchbot', 'gptbot', 'claude-user', 'claude-searchbot', 'claudebot', 'perplexity-user', 'perplexitybot',
  'googlebot', 'bingbot', 'applebot', 'duckduckbot', 'yandexbot', 'baiduspider',
])

export type CrawlerBatch = {
  hits: Array<{ bot: string; page: string; status: string; hits: number }>
  not_found: Array<{ path: string; hits: number }>
}

/** 一分鐘內的計數。超過上限的新組合直接丟掉（被大量亂打時不無限長）。 */
export function createCrawlerTally(maxHitKeys = 500, maxPaths = 200) {
  let hits = new Map<string, number>()
  let paths = new Map<string, number>()
  return {
    add(bot: string, page: string, status: string, notFoundPath: string | null) {
      const key = `${bot}\t${page}\t${status}`
      if (hits.has(key) || hits.size < maxHitKeys) hits.set(key, (hits.get(key) ?? 0) + 1)
      if (notFoundPath && (paths.has(notFoundPath) || paths.size < maxPaths)) paths.set(notFoundPath, (paths.get(notFoundPath) ?? 0) + 1)
    },
    /** 取出目前的計數並清空；沒有東西回 null。 */
    drain(): CrawlerBatch | null {
      if (!hits.size && !paths.size) return null
      const batch: CrawlerBatch = {
        hits: [...hits].map(([key, count]) => {
          const [bot, page, status] = key.split('\t') as [string, string, string]
          return { bot, page, status, hits: count }
        }),
        not_found: [...paths].map(([path, count]) => ({ path, hits: count })),
      }
      hits = new Map()
      paths = new Map()
      return batch
    },
  }
}
