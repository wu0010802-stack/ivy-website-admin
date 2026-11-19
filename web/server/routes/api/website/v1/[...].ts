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
import { apiProxyTarget, escapesApiPrefix, isMediaUploadPath, proxyBodyLimit } from '../../../../../shared/request-guard'
import { boundariesGzip, isBoundariesRequest, jsonGzip } from '../../../../utils/gzip-boundaries'
import { assertApiProxyMethod, proxyApiRequest } from '../../../../utils/api-proxy'
import { streamProxy } from '../../../../utils/stream-proxy'

const CLIENT_IP_HEADER = 'x-website-client-ip'
const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// 素材原檔與衍生檔（含後台）：GET／HEAD 走有背壓的串流，見 utils/stream-proxy.ts。
const MEDIA_PATH = /^\/(?:public|admin)\/media\//
// 只給 web 伺服器內部轉送的公開端點（伺服器對伺服器，不經過這裡）：
// telemetry 與 engagement 只由 web/server/api/telemetry.post.ts 打，前端錯誤回報只由
// web/server/api/client-errors.post.ts 打。從這裡直接打會繞過那兩支的 Origin／Sec-Fetch-Site
// 檢查、4 KB 本文上限與每來源配額（稽核 public-telemetry-analytics-storage-flood；
// engagement 2026-11-12 補上）。
const SERVER_ONLY_PATH = /^\/+public\/+(?:telemetry|engagement|client-errors)\/*$/

export default defineEventHandler(async (event) => {
  // 方法白名單放最前面：不支援的方法（TRACE…）回 405，不進路徑判斷、不送上游。
  assertApiProxyMethod(event)
  const config = useRuntimeConfig()
  const path = event.path.replace(/^\/api\/website\/v1/, '')

  // 點區段、編碼斜線與控制字元一律 404，後端收不到：fetch 會把 `..`／`%2e%2e`
  // 正規化，組出的網址可能跳出 /api/website/v1（例如 FastAPI 的 /openapi.json），
  // 或在前綴內繞過下面的路徑判斷。h3 已解過一次碼，原始網址也查一次。
  const rawPath = (event.node.req.url ?? '').replace(/^\/api\/website\/v1/, '')
  if (escapesApiPrefix(path) || escapesApiPrefix(rawPath)) throw createError({ statusCode: 404 })
  const target = apiProxyTarget(config.websiteApiInternalBase, path)
  if (!target || SERVER_ONLY_PATH.test(target.apiPath)) throw createError({ statusCode: 404 })

  // 一定要顯式帶：x-website-client-ip 不在轉送白名單裡，訪客自己帶的會被丟掉，
  // 只有這裡算出來的值會到 API（API 只信這個 header 來限流與記稽核 IP）。
  // 空字串代表「這一跳問不出訪客 IP」，api 端會退回 peer。
  const clientIpHeader = { [CLIENT_IP_HEADER]: trustedClientIp(event) }

  if ((event.method === 'GET' || event.method === 'HEAD') && MEDIA_PATH.test(target.apiPath)) {
    return streamProxy(event, target.url.href, clientIpHeader, {
      upstreamTimeoutSeconds: Number(config.apiProxyTimeoutSeconds),
      idleTimeoutSeconds: Number(config.mediaIdleTimeoutSeconds)
    })
  }

  // 本文上限要在讀取之前擋：代理會把整個本文讀進記憶體再
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

  // 請求標頭只轉白名單、上游逾時回 504、拿掉 server 標頭（2026-11-12，見 utils/api-proxy.ts）。
  return proxyApiRequest(event, target.url.href, {
    streamRequest,
    overrides: clientIpHeader,
    timeoutSeconds: Number(config.apiProxyTimeoutSeconds),
    // h3 代理不轉 accept-encoding，上游壓不了，由這一層對收 gzip 的客戶端壓縮（見 utils/gzip-boundaries.ts）：
    // 後台區域分析的里界 GeoJSON（約 600 KB）依 ETag 快取壓好的結果；其他 JSON 回應每次壓（1 KB 以下不壓）。
    onResponse: isBoundariesRequest(event.method, target.apiPath) ? boundariesGzip : jsonGzip
  })
})
