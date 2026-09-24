// 全站共用的資安標頭（前台、/admin、同源 /api 代理都經過這裡）。
// 檔名前綴 0. 讓它排在 preview-headers.ts 之前：個別路徑（例如 /visit/manage
// 的 Referrer-Policy: no-referrer）可以在後面覆寫這裡的預設值。
//
// CSP 目前只收 frame-ancestors／base-uri／object-src 這三條不影響既有腳本的
// 規則；script-src／style-src 要等把 Nuxt payload、布幕 bootstrap、JSON-LD、
// YouTube 嵌入等 inline 與外部來源盤點完、實機驗證後再收緊。
// Permissions-Policy 不關 fullscreen／autoplay／picture-in-picture／
// encrypted-media：HomeFilms.vue 的 YouTube iframe 需要它們。
// 不送 Cross-Origin-Opener-Policy：後台 Google 登入若走彈出視窗會被它切斷。
const BASE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
}

export default defineEventHandler((event) => {
  for (const [name, value] of Object.entries(BASE_HEADERS)) setResponseHeader(event, name, value)
  // HSTS 只在正式環境送；本機是 http，瀏覽器本來就會忽略，但測試環境
  // 用自簽 https 時送了會讓 localhost 被鎖一年。不加 includeSubDomains：
  // 目前網域是 railway.app 的子網域，正式網域定案後再評估 preload。
  if (useRuntimeConfig(event).websiteEnv === 'production') {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000')
  }
})
