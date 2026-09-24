import { normalizeSiteOrigin } from './app/utils/seo'
import fontManifest from './app/generated/font-manifest.json'

// https://nuxt.com/docs/api/configuration/nuxt-config
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === 'true'
}

const websiteEnv = process.env.NUXT_WEBSITE_ENV ?? 'production'
const apiInternalBase =
  process.env.NUXT_WEBSITE_API_INTERNAL_BASE ?? 'http://127.0.0.1:8000'
const contentMode = process.env.NUXT_PUBLIC_CONTENT_MODE ?? 'live'
const indexingEnabled = parseBoolean(
  process.env.NUXT_PUBLIC_INDEXING_ENABLED,
  false
)

if (websiteEnv === 'production' && contentMode === 'fixture') {
  throw new Error('production 環境禁止啟用 fixture 模式（NUXT_PUBLIC_CONTENT_MODE）')
}
if (indexingEnabled && !normalizeSiteOrigin(process.env.NUXT_PUBLIC_SITE_ORIGIN ?? '')) {
  throw new Error('啟用正式索引時必須設定有效 HTTPS origin（NUXT_PUBLIC_SITE_ORIGIN）')
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  css: ['~/assets/css/styles.css', '~/assets/css/font-subsets.css', '~/assets/css/studio.css', '~/assets/css/performance.css', '~/assets/css/typography.css'],

  // 2026-09-22 曾改成 inlineStyles:false（去掉 scoped 樣式 inline 又 link 的重複），線上 simulate 卻
  // 變差：阻塞渲染的 CSS 從 2 支變 4 支（多了 entry／pages），Lighthouse 估多等 1.5 s。同機同碼 A/B
  // （字型重複修掉之後，各 3 次 median）：simulate Perf 82 vs 83、LCP 都 4054 ms；devtools LCP 2021 vs
  // 2269 ms；desktop LCP 765 vs 783 ms——分數打平，inline 只多 28 KB（brotli）HTML、少兩個阻塞的
  // 往返；線上是高延遲手機網路，往返比位元組貴，且早上 89–90 分的線上版本就是預設 true，因此維持 true。
  features: { inlineStyles: true },

  hooks: {
    // 錯誤頁（error-404／error-500）的 chunk 與 CSS 不要在首頁就 prefetch：inlineStyles:false 時
    // 會以 <link rel=prefetch as=style> 載進首頁，Lighthouse 直接算進傳輸量；錯誤頁用到時再載即可。
    // 首次進站布幕依工作階段與偏好決定是否播放，引擎（entranceCurtain.ts）也不進 SSR prefetch，
    // 符合條件的用戶端才明確 import。
    'build:manifest': (manifest) => {
      for (const [key, entry] of Object.entries(manifest)) {
        if (/error-(404|500)/.test(key) || /error-(404|500)/.test(entry.file ?? '')) entry.prefetch = false
        if (/(?:^|\/)entranceCurtain\.ts(?:\?.*)?$/.test(entry.src ?? key)) entry.prefetch = false
      }
    }
  },

  routeRules: {
    // 沒有內容雜湊的檔名：字型子集很少變動，給一個月；圖片給一天並允許
    // 背景重新驗證，避免換圖後舊快取撐太久。有雜湊的衍生檔才能 immutable。
    '/assets/**': { headers: { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    '/assets/fonts/**': { headers: { 'cache-control': 'public, max-age=2592000, stale-while-revalidate=86400' } },
    '/assets/responsive/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/optimized/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/favicon.ico': { headers: { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' } }
  },

  nitro: {
    // Railway 的反向代理不壓縮回應；靜態資源在建置時先產 .br／.gz，
    // 由 nitro 依 Accept-Encoding 直接送出（HTML 由 server/plugins/compress-html.ts 處理）。
    compressPublicAssets: { brotli: true, gzip: true }
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant-TW' },
      script: [{ key: 'motion-layout', tagPriority: 'critical', innerHTML: "document.documentElement.dataset.ivyMotion='ready'" }],
      // 頁首品牌字（Noto Sans TC 600／Source Sans 3）的 @font-face 併進
      // styles.css，不再另載一支阻塞渲染的 brand-fonts.css。只預載首屏
      // 一定會用到的小檔：LINE Seed Bold 的首屏 critical 子集（約 14 KB，
      // scripts/subset-critical-fonts.py 產生、URL 取自 font-manifest.json）、
      // h1 的 LINE Seed EB（14 KB）與兩個品牌子集（合計 14 KB）；其餘用字的
      // remaining 子集（150 KB）交給 CSS 自己發現，不跟 LCP 圖片搶手機頻寬。
      link: [
        { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: '/favicon.ico?v=ivy-20260922' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png?v=ivy-20260922' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=ivy-20260922' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: fontManifest.critical.src, crossorigin: 'anonymous' },
        // ?v= 必須與 styles.css 的 @font-face URL 完全相同（重切子集時兩邊一起改，值是 sha256 前 8 碼）。
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/assets/fonts/lineseed-eb.woff2?v=50d2dfc8', crossorigin: 'anonymous' },
        { rel: 'preload', as: 'font', type: 'font/woff', href: '/assets/fonts/noto-sans-tc-600-brand.woff?v=d220f83c', crossorigin: 'anonymous' },
        { rel: 'preload', as: 'font', type: 'font/woff', href: '/assets/fonts/source-sans-3-400-brand.woff?v=c98aaee6', crossorigin: 'anonymous' }
      ]
    }
  },

  runtimeConfig: {
    adminDistDir: process.env.NUXT_ADMIN_DIST_DIR ?? '',
    websiteApiInternalBase: apiInternalBase,
    // 訪客與這支 server 之間的可信代理層數（Railway edge 一層）；用來從
    // X-Forwarded-For 右邊取訪客 IP，見 server/utils/client-ip.ts。
    trustedProxyHops: Number(process.env.NUXT_TRUSTED_PROXY_HOPS ?? 1),
    websiteEnv,
    public: {
      contentMode,
      siteOrigin: process.env.NUXT_PUBLIC_SITE_ORIGIN ?? '',
      indexingEnabled,
      telemetryEnabled: parseBoolean(process.env.NUXT_PUBLIC_TELEMETRY_ENABLED, websiteEnv === 'production')
    }
  }

  // 同源 `/api/website/v1/**` 由 web/server/routes/api/website/v1/[...].ts
  // 這支 nitro catch-all 路由處理，dev/build/start 都走同一套，不需要
  // 再靠 nitro.devProxy（那個只在 `nuxt dev` 生效，正式環境不會有效果）。
})
