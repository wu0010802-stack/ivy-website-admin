import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifySource } from '../shared/engagement-source'
import { CRAWLERS, createCrawlerTally, crawlerOf, crawlerPageOf, NOT_FOUND_CRAWLERS, statusClass } from '../shared/crawlers'
import { NOT_FOUND_PATH_MAX, NOT_FOUND_REFS, notFoundPath, notFoundRef, validateNotFound } from '../shared/not-found'

// 成效統計補強（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）：AI 助理來源、找不到的網址、爬蟲。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const ORIGIN = 'https://www.ivykidschool.com'

describe('AI 助理來源', () => {
  it.each([
    ['https://chatgpt.com/', ''],
    ['https://chat.openai.com/c/abc', ''],
    ['https://www.perplexity.ai/search?q=x', ''],
    ['https://gemini.google.com/app', ''],
    ['https://copilot.microsoft.com/', ''],
    ['https://claude.ai/chat/1', ''],
    ['', '?utm_source=chatgpt.com'],
    ['', '?utm_source=perplexity'],
  ])('%s %s → ai', (referrer, search) => {
    expect(classifySource(referrer, search, ORIGIN)).toBe('ai')
  })

  it('廣告仍算廣告；一般 Google 仍算搜尋', () => {
    expect(classifySource('https://chatgpt.com/', '?utm_source=chatgpt&utm_medium=cpc', ORIGIN)).toBe('ads')
    expect(classifySource('https://chatgpt.com/', '?oppref=abc', ORIGIN)).toBe('ads')
    expect(classifySource('https://www.google.com.tw/', '', ORIGIN)).toBe('search')
  })
})

describe('找不到的網址', () => {
  it('路徑：解碼、小寫、去掉結尾斜線與查詢字串之外的東西、截到上限', () => {
    expect(notFoundPath('/Blank-1/')).toBe('/blank-1')
    expect(notFoundPath('/%E9%97%9C%E6%96%BC%E6%88%91%E5%80%91')).toBe('/關於我們')
    expect(notFoundPath('/')).toBe('/')
    expect(notFoundPath('/%E0%A4%A')).toBeNull()
    expect(notFoundPath('/a%00b')).toBeNull()
    expect([...notFoundPath(`/${'字'.repeat(300)}`)!].length).toBe(NOT_FOUND_PATH_MAX)
  })

  it('從哪裡來', () => {
    expect(notFoundRef('', ORIGIN)).toBe('none')
    expect(notFoundRef(`${ORIGIN}/about`, ORIGIN)).toBe('internal')
    expect(notFoundRef('https://www.google.com.tw/', ORIGIN)).toBe('search')
    expect(notFoundRef('https://www.facebook.com/', ORIGIN)).toBe('external')
    expect(notFoundRef('not a url', ORIGIN)).toBe('none')
  })

  it('驗證規則和後端一致', () => {
    expect(validateNotFound({ event: 'not_found', path: '/blank-1', ref: 'search' })).toEqual({ event: 'not_found', path: '/blank-1', ref: 'search' })
    expect(validateNotFound({ event: 'not_found', path: 'blank', ref: 'none' })).toBeNull()
    expect(validateNotFound({ event: 'not_found', path: '/a?b=1', ref: 'none' })).toBeNull()
    expect(validateNotFound({ event: 'not_found', path: '/a', ref: 'crawler' })).toBeNull()
    expect(validateNotFound({ event: 'not_found', path: '/a', ref: 'none', extra: 1 })).toBeNull()
    const routes = read('../../backend/app/operations/analytics_more_routes.py')
    expect(routes).toContain(`ref: Literal[${NOT_FOUND_REFS.map((ref) => `"${ref}"`).join(', ')}]`)
    const models = read('../../backend/app/operations/models.py')
    expect(models).toContain(`NOT_FOUND_PATH_MAX = ${NOT_FOUND_PATH_MAX}`)
  })
})

describe('爬蟲', () => {
  it('代碼和後端的 CRAWLER_GROUPS 一致（other 是兜底）', () => {
    const service = read('../../backend/app/operations/crawler_service.py')
    const block = service.slice(service.indexOf('CRAWLER_GROUPS'), service.indexOf('}', service.indexOf('CRAWLER_GROUPS')))
    const backend = [...block.matchAll(/"([a-z0-9-]+)": "/g)].map((m) => m[1])
    expect(new Set(backend)).toEqual(new Set([...CRAWLERS.map(([code]) => code), 'other']))
    for (const code of NOT_FOUND_CRAWLERS) expect(backend).toContain(code)
  })

  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'chatgpt-user'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'gptbot'],
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'oai-searchbot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'claudebot'],
    ['Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'claude-user'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'perplexitybot'],
    ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'googlebot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'facebookexternalhit'],
    ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'ahrefsbot'],
    ['Mozilla/5.0 (compatible; SomeNewBot/1.0)', 'other'],
  ])('%s → %s', (ua, code) => {
    expect(crawlerOf(ua)).toBe(code)
  })

  it('一般瀏覽器、App 內建瀏覽器不算', () => {
    expect(crawlerOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0')).toBeNull()
    expect(crawlerOf('Mozilla/5.0 (Linux; Android 14; CUBOT KingKong) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBeNull()
    expect(crawlerOf(undefined)).toBeNull()
  })

  it('頁面分類', () => {
    expect(crawlerPageOf('/')).toBe('home')
    expect(crawlerPageOf('/about?x=1')).toBe('about')
    expect(crawlerPageOf('/visit/yihua')).toBe('visit')
    expect(crawlerPageOf('/robots.txt')).toBe('robots')
    expect(crawlerPageOf('/sitemap.xml')).toBe('sitemap')
    expect(crawlerPageOf('/llms.txt')).toBe('llms')
    expect(crawlerPageOf('/blank-1')).toBe('other')
    expect(crawlerPageOf('/_nuxt/entry.js')).toBeNull()
    expect(crawlerPageOf('/__nuxt_error')).toBeNull()
    expect(crawlerPageOf('/assets/photo.webp')).toBeNull()
    expect(crawlerPageOf('/api/website/v1/public/site')).toBeNull()
    expect(crawlerPageOf('/admin/login')).toBeNull()
    const pages = read('../../backend/app/operations/crawler_service.py')
    for (const page of ['home', 'robots', 'sitemap', 'llms', 'other']) expect(pages).toContain(`"${page}"`)
  })

  it('回應類別', () => {
    expect([200, 301, 404, 503, 100].map(statusClass)).toEqual(['2xx', '3xx', '4xx', '5xx', null])
  })

  it('一分鐘的計數：累加、取出就清空、超過上限的新組合丟掉', () => {
    const tally = createCrawlerTally(2, 1)
    tally.add('googlebot', 'home', '2xx', null)
    tally.add('googlebot', 'home', '2xx', null)
    tally.add('gptbot', 'other', '4xx', '/blank-1')
    tally.add('bingbot', 'home', '2xx', '/x')
    expect(tally.drain()).toEqual({
      hits: [{ bot: 'googlebot', page: 'home', status: '2xx', hits: 2 }, { bot: 'gptbot', page: 'other', status: '4xx', hits: 1 }],
      not_found: [{ path: '/blank-1', hits: 1 }],
    })
    expect(tally.drain()).toBeNull()
  })
})
