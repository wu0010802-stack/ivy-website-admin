import { createCrawlerTally, crawlerOf, crawlerPageOf, NOT_FOUND_CRAWLERS, statusClass } from '../../shared/crawlers'
import { notFoundPath } from '../../shared/not-found'
import { normalizeHost } from '../utils/admin-host'

// 搜尋引擎與 AI 爬蟲抓了哪些頁（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §7）。
// 每個請求看 User-Agent，是爬蟲就在回應送完時記一筆（爬蟲、頁面、回應類別），每分鐘彙總送一次給 API；
// 搜尋引擎與 AI 爬蟲抓到 404 時另記路徑。不記 IP、不記一般訪客。重啟會丟掉最後不到一分鐘的計數，可以接受。
// 閘：和第一方統計同一個部署開關（NUXT_PUBLIC_TELEMETRY_ENABLED）。
const FLUSH_MS = 60_000

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  if (!config.public.telemetryEnabled || import.meta.dev) return
  const tally = createCrawlerTally()
  // 後台網域（admin.<網域>）上的請求不算：那裡只有登入頁，爬蟲抓到的都會被轉走或 404。
  const adminHost = normalizeHost(String(config.adminHost ?? ''))

  // 在 request 時掛回應的 finish：afterResponse 在錯誤回應（404 等，由錯誤處理器另外送出）時不會觸發，
  // 正式建置實測過；finish 不論成功或錯誤都在回應送完時發生，那時的狀態碼才是最後的。
  nitroApp.hooks.hook('request', (event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return
    const bot = crawlerOf(getRequestHeader(event, 'user-agent'))
    if (!bot || (adminHost && normalizeHost(getRequestHeader(event, 'host')) === adminHost)) return
    const page = crawlerPageOf(event.path)
    if (!page) return
    const path = event.path
    event.node.res.once('finish', () => {
      const code = event.node.res.statusCode
      const status = statusClass(code)
      if (!status) return
      const missing = code === 404 && page === 'other' && NOT_FOUND_CRAWLERS.has(bot) ? notFoundPath(path.split(/[?#]/)[0] ?? '/') : null
      tally.add(bot, page, status, missing)
    })
  })

  async function flush() {
    const batch = tally.drain()
    if (!batch) return
    await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/crawler-hits`, {
      method: 'POST', body: batch, timeout: 5000,
    }).catch((error: unknown) => {
      console.warn(JSON.stringify({ type: 'website_crawler_hits_failed', message: error instanceof Error ? error.message : String(error) }))
    })
  }
  const timer = setInterval(() => { void flush() }, FLUSH_MS)
  timer.unref?.()
  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    await flush()
  })
})
