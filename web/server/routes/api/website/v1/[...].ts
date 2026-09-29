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
import { apiProxyTarget, isMediaUploadPath, proxyBodyLimit, unsafeProxyPath } from '../../../../../shared/request-guard'
import { abortOnClientClose, streamProxy } from '../../../../utils/stream-proxy'

const CLIENT_IP_HEADER = 'x-website-client-ip'
const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// 素材原檔與衍生檔（含後台）：GET／HEAD 走有背壓的串流，見 utils/stream-proxy.ts。
const MEDIA_PATH = /^\/(?:public|admin)\/media\//
// 只有 web/server/api/telemetry.post.ts 會打這支（伺服器對伺服器，不經過這裡）；
// 從這裡直接打會繞過那邊的來源檢查、本文上限與配額（稽核
// public-telemetry-analytics-storage-flood）。
const TELEMETRY_PATH = /^\/+public\/+telemetry\/*$/

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const path = event.path.replace(/^\/api\/website\/v1/, '')

  // 點區段、編碼斜線與控制字元一律 400：fetch 會把 `..`／`%2e%2e` 正規化，
  // 組出的網址可能跳出 /api/website/v1（例如 FastAPI 的 /openapi.json），
  // 或在前綴內繞過下面的路徑判斷。h3 已解過一次碼，原始網址也查一次。
  if (unsafeProxyPath(path) || unsafeProxyPath(event.node.req.url ?? '')) throw createError({ statusCode: 400 })
  const target = apiProxyTarget(config.websiteApiInternalBase, path)
  if (!target) throw createError({ statusCode: 400 })
  if (TELEMETRY_PATH.test(target.apiPath)) throw createError({ statusCode: 404 })

  // 一定要顯式覆寫：proxyRequest 預設會把使用者送來的 header 一併轉發，
  // 不覆寫的話任何人都能自己帶一個 x-website-client-ip 來偽造訪客身分、
  // 繞過限流。空字串代表「這一跳問不出訪客 IP」，api 端會退回 peer。
  const clientIpHeader = { [CLIENT_IP_HEADER]: trustedClientIp(event) }

  if ((event.method === 'GET' || event.method === 'HEAD') && MEDIA_PATH.test(target.apiPath)) {
    return streamProxy(event, target.url.href, clientIpHeader)
  }

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

  // 客戶端斷線就中止上游（含串流上傳），不讓 API 為沒人等的請求做完整份工作。
  const controller = abortOnClientClose(event)
  try {
    return await proxyRequest(event, target.url.href, {
      streamRequest,
      // OAuth 302/303 必須交給瀏覽器，否則伺服器會跟到 Google／LINE 並遺失握手 cookie。
      fetchOptions: { redirect: 'manual', signal: controller.signal },
      headers: clientIpHeader,
    })
  } catch (error) {
    if (controller.signal.aborted) return
    throw error
  }
})
