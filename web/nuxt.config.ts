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

  routeRules: {
    '/assets/responsive/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/optimized/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/fonts/subsets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant-TW' },
      script: [{ key: 'motion-layout', tagPriority: 'critical', innerHTML: "document.documentElement.dataset.ivyMotion='ready'" }],
      link: [
        { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: '/favicon.ico?v=ivy-20260922' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png?v=ivy-20260922' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=ivy-20260922' },
        { rel: 'stylesheet', href: '/assets/fonts/brand-fonts.css' },
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: fontManifest.critical.src,
          crossorigin: 'anonymous'
        }
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
