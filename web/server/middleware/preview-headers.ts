export default defineEventHandler((event) => {
  const path = event.path.split('?')[0] ?? '/'
  if (/^\/(preview|admin)(\/|$)/.test(path)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (/^\/visit(\/|$)/.test(path)) {
    // 預約頁只是不索引，不含個人資料（表單不送出、不存庫）；no-store 會讓
    // 瀏覽器無法放進 back/forward cache，返回上一頁要整頁重載。
    setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (path === '/' || path.startsWith('/campuses/')) {
    setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
    const config = useRuntimeConfig()
    if (!config.public.indexingEnabled) setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
