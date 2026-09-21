// 同源 API 入口：瀏覽器一律打 `/api/website/v1/...`（同源，不用處理 CORS），
// 這支 nitro 路由在伺服器端把請求轉給 NUXT_WEBSITE_API_INTERNAL_BASE
// 指到的 FastAPI。`nitro.devProxy` 只在 `nuxt dev`生效，正式
// build/start 沒有這支路由的話，瀏覽器直接呼叫 `/api/website/v1/...`
// 會 404——這支路由讓開發與正式環境走同一套同源機制，不用另外裝
// nginx/Caddy。
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const path = event.path.replace(/^\/api\/website\/v1/, '')
  return proxyRequest(event, `${config.websiteApiInternalBase}/api/website/v1${path}`)
})
