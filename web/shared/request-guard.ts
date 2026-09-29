import { isIP } from 'node:net'

/**
 * 從 X-Forwarded-For 取訪客 IP：由右往左數 `trustedHops` 層。
 *
 * 最左段是訪客自己可以隨便填的；每經過一層可信代理，那層會在最右邊
 * 附上「它看到的連線來源」。所以只有從右邊數過可信代理層數的那一段
 * 才可信（Railway 前面只有一層 edge，預設 1）。header 不存在、層數不夠
 * 或內容不是 IP 時回 null，呼叫端退回 socket 位址。
 */
export function clientIpFromForwardedFor(header: string | undefined, trustedHops: number): string | null {
  if (!header || trustedHops < 1) return null
  const parts = header.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < trustedHops) return null
  const candidate = parts[parts.length - trustedHops]
  return candidate !== undefined && isIP(candidate) ? candidate : null
}

function ipv6Hextets(ip: string): number[] | null {
  let address = ip.toLowerCase()
  const zone = address.indexOf('%')
  if (zone >= 0) address = address.slice(0, zone)
  // 結尾內嵌的 IPv4（::ffff:203.0.113.9）先換成兩組十六進位。
  const lastColon = address.lastIndexOf(':')
  const tail = address.slice(lastColon + 1)
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number)
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', rest] = address.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = rest ? rest.split(':') : []
  const parts = rest === undefined
    ? headParts
    : [...headParts, ...Array<string>(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
  if (parts.length !== 8) return null
  const hextets = parts.map(part => Number.parseInt(part, 16))
  return hextets.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff) ? hextets : null
}

/**
 * 限流用的訪客來源：IPv6 聚合到 /64。一般家用與雲端主機都分到一整段
 * /64，以完整位址當鍵的話，換一個位址就換一個桶（稽核
 * client-ip-no-ipv6-prefix-aggregation）。回傳 /64 的網路位址（仍是合法
 * IP，API 端的 Turnstile remoteip 照樣能解析）；IPv4-mapped 位址當 IPv4。
 * 不是 IPv6 的值原樣回傳。
 */
export function rateLimitSource(ip: string): string {
  if (isIP(ip) !== 6) return ip
  const hextets = ipv6Hextets(ip)
  if (!hextets) return ip
  const [h0, h1, h2, h3, h4, h5, h6 = 0, h7 = 0] = hextets
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return `${h6 >> 8}.${h6 & 0xff}.${h7 >> 8}.${h7 & 0xff}`
  }
  return `${hextets.slice(0, 4).map(value => value.toString(16)).join(':')}::`
}

export const API_PREFIX = '/api/website/v1'

const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i
// 反斜線在 http 網址等同斜線；%2f／%5c 會被 uvicorn 解成路徑分隔。
const ENCODED_SEPARATOR = /\\|%2f|%5c/i
// URL 解析器會刪掉 tab／換行、修掉結尾空白（'.\t.' 會變成 '..'）。
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000- \u007f]/

/**
 * 同源代理轉送前的路徑檢查；path 是去掉 `/api/website/v1` 前綴後的路徑
 * （h3 已解過一次碼，可含 query）。點區段、編碼斜線、反斜線與控制字元都
 * 拒絕：fetch 用 WHATWG URL 解析會把 `..`／`%2e%2e` 收掉，組出的網址可能
 * 跳出前綴（稽核 proxy-dot-segment-escape），或在前綴內繞過代理自己的
 * 路徑判斷。每層 %25 都拆開再查一次，雙重編碼也擋得到。
 */
export function unsafeProxyPath(path: string): boolean {
  let current = path.split(/[?#]/)[0] ?? ''
  for (let round = 0; round < 4; round++) {
    if (ENCODED_SEPARATOR.test(current) || CONTROL_OR_SPACE.test(current)) return true
    if (current.split('/').some(segment => DOT_SEGMENT.test(segment))) return true
    const next = current.replace(/%25/gi, '%')
    if (next === current) return false
    current = next
  }
  // 疊了四層以上的 %25 不是正常請求。
  return true
}

export interface ApiProxyTarget {
  /** 交給 fetch 的網址（已正規化） */
  url: URL
  /** 後端實際會看到的 API 路徑（去掉前綴、再解一次百分比編碼，同 uvicorn） */
  apiPath: string
}

/**
 * 組出代理目標。正規化後不在 `/api/website/v1/` 之下、或主機不是 base 的
 * 主機時回 null（呼叫端回 400）。
 */
export function apiProxyTarget(base: string, path: string): ApiProxyTarget | null {
  let url: URL
  let origin: string
  try {
    url = new URL(`${base}${API_PREFIX}${path}`)
    origin = new URL(base).origin
  } catch {
    return null
  }
  if (url.origin !== origin || !url.pathname.startsWith(`${API_PREFIX}/`)) return null
  url.hash = ''
  const apiPath = url.pathname
    .slice(API_PREFIX.length)
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  return { url, apiPath }
}

// 素材上傳以外的 API 本文都是小 JSON。素材單檔上限是部署設定：API 端是
// WEBSITE_MEDIA_MAX_IMAGE_MB／WEBSITE_MEDIA_MAX_VIDEO_MB（預設 15／150），這裡用
// NUXT_MEDIA_MAX_UPLOAD_MB（取兩者較大的那個，預設 150），本文上限的算法與 API
// 相同：最大單檔再加 5 MB 給 multipart 欄位與邊界。
export const DEFAULT_MEDIA_MAX_UPLOAD_MB = 150
export const DEFAULT_BODY_LIMIT = 1024 * 1024

export function mediaUploadBodyLimit(maxUploadMb: number = DEFAULT_MEDIA_MAX_UPLOAD_MB): number {
  const mb = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : DEFAULT_MEDIA_MAX_UPLOAD_MB
  return (mb + 5) * 1024 * 1024
}

export const MEDIA_UPLOAD_BODY_LIMIT = mediaUploadBodyLimit()

const MEDIA_UPLOAD_PATH = /^\/admin\/media(?:\/[0-9a-f-]{36}\/replace)?\/?(?:\?|$)/i

/** 代理轉送前允許的請求本文上限；path 是去掉 `/api/website/v1` 前綴後的路徑。 */
export function proxyBodyLimit(path: string, maxUploadMb: number = DEFAULT_MEDIA_MAX_UPLOAD_MB): number {
  return MEDIA_UPLOAD_PATH.test(path) ? mediaUploadBodyLimit(maxUploadMb) : DEFAULT_BODY_LIMIT
}

export function isMediaUploadPath(path: string): boolean {
  return MEDIA_UPLOAD_PATH.test(path)
}
