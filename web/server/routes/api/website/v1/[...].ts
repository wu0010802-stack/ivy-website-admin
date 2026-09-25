// 同源 API 入口：瀏覽器一律打 `/api/website/v1/...`（同源，不用處理 CORS），
// 這支 nitro 路由在伺服器端把請求轉給 NUXT_WEBSITE_API_INTERNAL_BASE
// 指到的 FastAPI。`nitro.devProxy` 只在 `nuxt dev`生效，正式
// build/start 沒有這支路由的話，瀏覽器直接呼叫 `/api/website/v1/...`
// 會 404——這支路由讓開發與正式環境走同一套同源機制，不用另外裝
// nginx/Caddy。

// FastAPI 那端看到的 peer 永遠是這支代理，`request.client.host` 對它來說
// 毫無鑑別力；限流若綁那個值，全站訪客會共用同一個桶而互相擠掉。這裡把
// 真正的訪客 IP 放進一個自家 header，api 端以
// WEBSITE_TRUSTED_CLIENT_IP_HEADER 讀取（見 deploy/README.md）。訪客 IP 由
// trustedClientIp 從 X-Forwarded-For 右邊取，不採信訪客可自填的最左段。
import { isMediaUploadPath, proxyBodyLimit } from '../../../../../shared/request-guard'

const CLIENT_IP_HEADER = 'x-website-client-ip'
const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const path = event.path.replace(/^\/api\/website\/v1/, '')
  const clientIp = trustedClientIp(event)

  // 本文上限要在讀取之前擋：proxyRequest 預設會把整個本文讀進記憶體再
  // 轉送，匿名訪客送多大就吃多少 web 記憶體（後端的素材大小檢查要等
  // 本文整個到了 API 才執行）。只接受有 Content-Length 的本文——Node 的
  // HTTP parser 保證實際讀到的不會超過這個長度。
  let streamRequest = false
  if (PAYLOAD_METHODS.has(event.method)) {
    const declared = getHeader(event, 'content-length')
    if (declared === undefined) {
      if (getHeader(event, 'transfer-encoding')) throw createError({ statusCode: 411, statusMessage: 'Length Required' })
    } else {
      const length = Number(declared)
      if (!Number.isSafeInteger(length) || length < 0) throw createError({ statusCode: 400 })
      if (length > proxyBodyLimit(path, Number(config.mediaMaxUploadMb))) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
    }
    // 素材上傳改用串流轉送，不在 web 記憶體裡累積整個檔案。
    streamRequest = isMediaUploadPath(path)
  }

  return proxyRequest(event, `${config.websiteApiInternalBase}/api/website/v1${path}`, {
    streamRequest,
    // OAuth 302/303 必須交給瀏覽器，否則伺服器會跟到 Google／LINE 並遺失握手 cookie。
    fetchOptions: { redirect: 'manual' },
    // 一定要顯式覆寫：proxyRequest 預設會把使用者送來的 header 一併轉發，
    // 不覆寫的話任何人都能自己帶一個 x-website-client-ip 來偽造訪客身分、
    // 繞過限流。空字串代表「這一跳問不出訪客 IP」，api 端會退回 peer。
    headers: { [CLIENT_IP_HEADER]: clientIp },
  })
})
