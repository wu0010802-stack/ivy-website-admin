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
if (indexingEnabled && !process.env.NUXT_PUBLIC_SITE_ORIGIN) {
  throw new Error('啟用正式索引時必須設定 NUXT_PUBLIC_SITE_ORIGIN')
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  css: ['~/assets/css/styles.css', '~/assets/css/studio.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant-TW' },
      link: [
        { rel: 'stylesheet', href: '/assets/fonts/brand-fonts.css' },
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff',
          href: '/assets/fonts/lineseed-eb.woff',
          crossorigin: 'anonymous'
        },
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff',
          href: '/assets/fonts/lineseed-bd.woff',
          crossorigin: 'anonymous'
        },
        {
          rel: 'preload',
          as: 'image',
          href: '/assets/hero-campus-still.webp',
          fetchpriority: 'high'
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
      indexingEnabled
    }
  }

  // 同源 `/api/website/v1/**` 由 web/server/routes/api/website/v1/[...].ts
  // 這支 nitro catch-all 路由處理，dev/build/start 都走同一套，不需要
  // 再靠 nitro.devProxy（那個只在 `nuxt dev` 生效，正式環境不會有效果）。
})
