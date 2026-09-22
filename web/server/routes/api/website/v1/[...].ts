// 同源 API 入口：瀏覽器一律打 `/api/website/v1/...`（同源，不用處理 CORS），
// 這支 nitro 路由在伺服器端把請求轉給 NUXT_WEBSITE_API_INTERNAL_BASE
// 指到的 FastAPI。`nitro.devProxy` 只在 `nuxt dev`生效，正式
// build/start 沒有這支路由的話，瀏覽器直接呼叫 `/api/website/v1/...`
// 會 404——這支路由讓開發與正式環境走同一套同源機制，不用另外裝
// nginx/Caddy。

// FastAPI 那端看到的 peer 永遠是這支代理，`request.client.host` 對它來說
// 毫無鑑別力；限流若綁那個值，全站訪客會共用同一個桶而互相擠掉。這裡把
// 真正的訪客 IP 放進一個自家 header，api 端以
// WEBSITE_TRUSTED_CLIENT_IP_HEADER 讀取（見 deploy/README.md）。
const CLIENT_IP_HEADER = 'x-website-client-ip'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const path = event.path.replace(/^\/api\/website\/v1/, '')
  const clientIp = getRequestIP(event, { xForwardedFor: true }) ?? ''

  return proxyRequest(event, `${config.websiteApiInternalBase}/api/website/v1${path}`, {
    // 一定要顯式覆寫：proxyRequest 預設會把使用者送來的 header 一併轉發，
    // 不覆寫的話任何人都能自己帶一個 x-website-client-ip 來偽造訪客身分、
    // 繞過限流。空字串代表「這一跳問不出訪客 IP」，api 端會退回 peer。
    headers: { [CLIENT_IP_HEADER]: clientIp },
  })
})
