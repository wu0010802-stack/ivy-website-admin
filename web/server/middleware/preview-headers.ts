export default defineEventHandler((event) => {
  // Nuxt 路由不分大小寫（/Visit/Manage 也會渲染同一頁），標頭判斷也要一樣。
  const path = (event.path.split('?')[0] ?? '/').toLowerCase()
  if (path === '/visit/manage' || path === '/visit/manage/') {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  } else if (/^\/(preview|admin)(\/|$)/.test(path)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (/^\/visit(\/|$)/.test(path)) {
    // 預約頁不含個人資料（表單不送出、不存庫）；no-store 會讓瀏覽器無法放進
    // back/forward cache，返回上一頁要整頁重載。2026-11-11 起開放收錄：和首頁一樣，
    // 部署沒開索引才送 noindex（後台關掉收錄時由頁面的 robots meta 處理）。
    setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
    if (!useRuntimeConfig().public.indexingEnabled) setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (path === '/') {
    setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
    const config = useRuntimeConfig()
    if (!config.public.indexingEnabled) setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
