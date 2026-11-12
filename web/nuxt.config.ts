import { MOTION_LAYOUT_SCRIPT } from './app/utils/inline-scripts'
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

  css: ['~/assets/css/tokens.css', '~/assets/css/styles.css', '~/assets/css/font-subsets.css', '~/assets/css/studio.css', '~/assets/css/performance.css', '~/assets/css/typography.css'],

  // 2026-09-22 曾改成 inlineStyles:false（去掉 scoped 樣式 inline 又 link 的重複），線上 simulate 卻
  // 變差：阻塞渲染的 CSS 從 2 支變 4 支（多了 entry／pages），Lighthouse 估多等 1.5 s。同機同碼 A/B
  // （字型重複修掉之後，各 3 次 median）：simulate Perf 82 vs 83、LCP 都 4054 ms；devtools LCP 2021 vs
  // 2269 ms；desktop LCP 765 vs 783 ms——分數打平，inline 只多 28 KB（brotli）HTML、少兩個阻塞的
  // 往返；線上是高延遲手機網路，往返比位元組貴，且早上 89–90 分的線上版本就是預設 true，因此維持 true。
  features: { inlineStyles: true },

  hooks: {
    // 錯誤頁（error-404／error-500，現為 app/error.vue）的 chunk 與 CSS 不要在首頁就 prefetch：inlineStyles:false 時
    // 會以 <link rel=prefetch as=style> 載進首頁，Lighthouse 直接算進傳輸量；錯誤頁用到時再載即可。
    // 首次進站布幕依工作階段與偏好決定是否播放，引擎（entranceCurtain.ts）也不進 SSR prefetch，
    // 符合條件的用戶端才明確 import。
    'build:manifest': (manifest) => {
      for (const [key, entry] of Object.entries(manifest)) {
        if (/error-(404|500)/.test(key) || /error-(404|500)/.test(entry.file ?? '')) entry.prefetch = false
        // 2026-09-29 起用自訂的 app/error.vue，同樣不要在首頁 prefetch。
        if (/(?:^|\/)error\.vue(?:\?.*)?$/.test(entry.src ?? key)) entry.prefetch = false
        if (/(?:^|\/)entranceCurtain\.ts(?:\?.*)?$/.test(entry.src ?? key)) entry.prefetch = false
        // 2026-09-30：three 本身（布幕引擎的靜態依賴、日常紙張的動態 import）也不進首屏 prefetch——父 chunk 關掉不會連帶
        // 排除依賴，略過布幕、減少動態、慢速連線照樣多下載 150 KB。布幕由 plugins/entrance-engine.client.ts 提早 import，
        // 紙張由 utils/paper-warm.ts 在整頁載完閒置或卡片接近時暖載。
        // 2026-10-20 兩邊改從 utils/three-lite.ts 具名匯入後，共用 chunk 的來源變成 three-lite，只比對 node_modules/three
        // 就漏掉了，首頁以外每頁又 prefetch 了 three（2026-10-21 正式站掃描發現），兩個來源都要排除。
        if (/(?:^|\/)(?:node_modules\/three\/|utils\/three-lite\.ts)/.test(entry.src ?? key)) entry.prefetch = false
      }
    }
  },

  routeRules: {
    '/campuses': { redirect: { to: '/', statusCode: 301 } },
    '/campuses/**': { redirect: { to: '/', statusCode: 301 } },
    // 沒有內容雜湊的檔名：字型子集很少變動，給一個月；圖片給一天並允許
    // 背景重新驗證，避免換圖後舊快取撐太久。有雜湊的衍生檔才能 immutable。
    '/assets/**': { headers: { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    '/assets/fonts/**': { headers: { 'cache-control': 'public, max-age=2592000, stale-while-revalidate=86400' } },
    '/assets/responsive/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/optimized/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    // 2026-10-20：以下目錄裡的檔名都帶內容雜湊（build-anniversary-media.py、subset-critical-fonts.py 產生），
    // 換內容就換網址，可以 immutable。只有授權說明 *-OFL.txt 沒有雜湊，逐檔退回字型目錄的一個月。
    // 新增沒有雜湊的檔案到這些目錄時，要在這裡補一條例外。
    '/assets/anniversary/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/fonts/subsets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
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
      // 手機瀏覽器網址列用頁面的米白底（tokens.css --paper：oklch(99% .008 95)）。<meta> 讀不到 CSS 變數，改色時兩邊一起改。
      // 2026-10-12 從 app.vue 的 useHead 搬來：錯誤頁（error.vue 取代 app.vue）原本沒有這一行。
      meta: [{ name: 'theme-color', content: '#fdfcf6' }],
      // 本文在 app/utils/inline-scripts.ts：公開頁 CSP 要登記它的 sha256（server/utils/script-csp.ts）。
      script: [{ key: 'motion-layout', tagPriority: 'critical', innerHTML: MOTION_LAYOUT_SCRIPT }],
      // 頁首品牌字（Noto Sans TC 600／Source Sans 3）的 @font-face 併進
      // styles.css，不再另載一支阻塞渲染的 brand-fonts.css。只預載首屏
      // 一定會用到的小檔：LINE Seed TW 首屏 critical 分片（Bold 約 14 KB；
      // scripts/subset-critical-fonts.py 產生，URL 取自 font-manifest.json 的
      // preload。ExtraBold 目前沒有首屏文字，不預載）與兩個品牌子集（woff2 合計 11 KB，2026-10-20 前是 woff 14 KB）；
      // 其餘 unicode-range 分片（font-subsets.css 與執行時才掛上的 lineseed-extended-*.css，
      // 見 plugins/title-font-slices.client.ts）等頁面用到那些字才下載，不跟 LCP 圖片搶手機頻寬。
      link: [
        { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: '/favicon.ico?v=ivy-20260922' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png?v=ivy-20260922' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=ivy-20260922' },
        ...fontManifest.preload.map((href) => ({ rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: 'anonymous' }) as const),
        // ?v= 必須與 styles.css 的 @font-face URL 完全相同（重切子集時兩邊一起改，值是 sha256 前 8 碼）。
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/assets/fonts/noto-sans-tc-600-brand.woff2?v=cf444611', crossorigin: 'anonymous' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/assets/fonts/source-sans-3-400-brand.woff2?v=1675fc92', crossorigin: 'anonymous' }
      ]
    }
  },

  runtimeConfig: {
    adminDistDir: process.env.NUXT_ADMIN_DIST_DIR ?? '',
    websiteApiInternalBase: apiInternalBase,
    // 訪客與這支 server 之間的可信代理層數（Railway edge 一層）；用來從
    // X-Forwarded-For 右邊取訪客 IP，見 server/utils/client-ip.ts。
    trustedProxyHops: Number(process.env.NUXT_TRUSTED_PROXY_HOPS ?? 1),
    // www 經過 Cloudflare 代理（橘雲）時設 true：上一跳是 Cloudflare 節點才採信 CF-Connecting-IP
    // （2026-11-12，server/utils/client-ip.ts）。預設關；灰雲時開著也無害（上一跳不是 Cloudflare）。
    cloudflareClientIp: parseBoolean(process.env.NUXT_CLOUDFLARE_CLIENT_IP, false),
    // 素材上傳代理的單檔上限（MB），要和 API 的 WEBSITE_MEDIA_MAX_IMAGE_MB／
    // WEBSITE_MEDIA_MAX_VIDEO_MB 較大者一致；見 shared/request-guard.ts。
    mediaMaxUploadMb: Number(process.env.NUXT_MEDIA_MAX_UPLOAD_MB ?? 150),
    // 代理到 API 的逾時（2026-11-12，server/utils/api-proxy.ts、stream-proxy.ts）：上游多久沒給
    // 回應標頭就回 504（串流上傳不套用）；素材下載的客戶端多久沒讀走資料就斷線。
    apiProxyTimeoutSeconds: Number(process.env.NUXT_API_PROXY_TIMEOUT_SECONDS ?? 120),
    mediaIdleTimeoutSeconds: Number(process.env.NUXT_MEDIA_IDLE_TIMEOUT_SECONDS ?? 120),
    websiteEnv,
    // 前端錯誤回報（2026-11-05，server/api/client-errors.post.ts）：關閉時伺服器直接回 204。預設只有 production 開；
    // NUXT_ERROR_REPORTS_ENABLED 在執行期也能改（Nuxt 依鍵名對應環境變數），可以不重建映像就關掉。
    errorReportsEnabled: parseBoolean(process.env.NUXT_ERROR_REPORTS_ENABLED, websiteEnv === 'production'),
    // 主網域轉址（2026-11-11，server/middleware/00.site-redirects.ts）：列在這裡的主機 301 到
    // NUXT_PUBLIC_SITE_ORIGIN，例如 "ivykidschool.com,web-production-04caa.up.railway.app"。
    // 預設空白＝不轉；正式網域接通、驗證過才設（執行期變數，改了重啟即可，不用重建映像）。
    redirectHosts: process.env.NUXT_REDIRECT_HOSTS ?? '',
    // 後台獨立子網域（2026-11-12，server/utils/admin-host.ts）：例如 "admin.ivykidschool.com"。
    // 預設空白＝後台照舊在官網同一個網域。啟用前要先照 deploy/README.md「後台獨立子網域」做完設定。
    adminHost: process.env.NUXT_ADMIN_HOST ?? '',
    // 暫時的訪客 IP 診斷端點 token（2026-11-12，server/api/client-errors/ip-diag.get.ts）；空白＝關閉。
    ipDiagToken: process.env.NUXT_IP_DIAG_TOKEN ?? '',
    public: {
      contentMode,
      siteOrigin: process.env.NUXT_PUBLIC_SITE_ORIGIN ?? '',
      indexingEnabled,
      telemetryEnabled: parseBoolean(process.env.NUXT_PUBLIC_TELEMETRY_ENABLED, websiteEnv === 'production'),
      // 前端外掛（plugins/error-report.client.ts）讀這個；預設同上，沒開就不掛 window 的錯誤監聽。
      errorReportsEnabled: parseBoolean(process.env.NUXT_ERROR_REPORTS_ENABLED, websiteEnv === 'production'),
      // GA4 與 Meta Pixel（2026-11-12，plugins/third-party-analytics.client.ts、server/utils/security-headers.ts 的 CSP）。
      // 預設空白＝全關：不載任何外部腳本、CSP 不變。刻意不讀 process.env：Nuxt 在執行期依鍵名對應
      // NUXT_PUBLIC_GA_MEASUREMENT_ID／NUXT_PUBLIC_META_PIXEL_ID，改了重啟即生效、刪掉變數重啟即關
      // （若在這裡讀 build 時的值，刪掉變數還要重建映像）。格式不符（G-XXXXXXXXXX／純數字）視同未設定。
      gaMeasurementId: '',
      metaPixelId: ''
    }
  }

  // 同源 `/api/website/v1/**` 由 web/server/routes/api/website/v1/[...].ts
  // 這支 nitro catch-all 路由處理，dev/build/start 都走同一套，不需要
  // 再靠 nitro.devProxy（那個只在 `nuxt dev` 生效，正式環境不會有效果）。
})
