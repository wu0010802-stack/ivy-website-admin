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

  // 元件 scoped 樣式只走可快取的外部 CSS：預設會把首頁用到的 scoped 樣式 inline 進
  // HTML（約 15 KB），但同一份又以 <link rel=stylesheet> 連結一次，等於傳兩遍。
  features: { inlineStyles: false },

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
      // 一定會用到的小檔：h1 的 LINE Seed EB（14 KB）與兩個品牌子集
      // （合計 14 KB）；全站用字的 LINE Seed Bold（157 KB）交給 CSS 自
      // 己發現，不跟 LCP 圖片搶手機頻寬。
      link: [
        { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: '/favicon.ico?v=ivy-20260922' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png?v=ivy-20260922' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=ivy-20260922' },
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
