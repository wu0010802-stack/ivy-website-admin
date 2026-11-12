import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { clientIpFromForwardedFor, rateLimitSource } from '../../shared/request-guard'
import { isCloudflareIp } from './cloudflare-ip'

/**
 * 給 API 限流與操作紀錄用的訪客來源。不用 `getRequestIP(event, { xForwardedFor: true })`：
 * 它取 X-Forwarded-For 的第一段，那是訪客自己能填的值，換一個就換一個限流桶。
 * IPv6 聚合到 /64 的網路位址（見 rateLimitSource）：同一段 /64 共用一個桶。
 *
 * 取「連線來源」（peer）的順序：
 * 1. NUXT_CLIENT_IP_HEADER（正式站設 x-real-ip，2026-11-12）：平台代理覆寫、訪客偽造不了的
 *    header。Railway edge 前面多了一層 CDN77，會把自己的節點接在 X-Forwarded-For 最後面
 *    （實測 `訪客, 79.127.228.17`），照層數從右邊取會拿到 CDN 節點，操作紀錄與限流桶都錯；
 *    X-Real-IP 由 Railway 覆寫成真正的連線來源，訪客自帶的 X-Real-IP／X-Forwarded-For 都被蓋掉
 *    （實測，見 deploy/README.md 同日「訪客 IP 改採信 X-Real-IP」）。
 * 2. 沒設或值不是 IP：照舊從 X-Forwarded-For 右邊數 NUXT_TRUSTED_PROXY_HOPS 層。
 * 3. 都沒有：socket 的對端位址。
 *
 * NUXT_CLOUDFLARE_CLIENT_IP=true（www 經過 Cloudflare 代理）：上面取到的連線來源是 Cloudflare
 * 節點時，改採信 CF-Connecting-IP。直接打 Railway 網域時訪客自帶的 CF-Connecting-IP 會被原樣
 * 轉進來（實測），所以一定要先確認上一跳真的是 Cloudflare。Railway 目前已經會把經 Cloudflare 的
 * 請求的 X-Real-IP 換成訪客本人，這道檢查是保險。
 */
export function trustedClientIp(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const peer = platformClientIp(event, String(config.clientIpHeader ?? ''))
    ?? clientIpFromForwardedFor(getHeader(event, 'x-forwarded-for'), proxyHops(config.trustedProxyHops))
    ?? event.node.req.socket.remoteAddress
    ?? ''
  // 執行期用環境變數覆寫時，Nuxt 會把 'true' 轉成布林；保險起見字串也認。
  if (String(config.cloudflareClientIp) === 'true') {
    const connecting = getHeader(event, 'cf-connecting-ip')?.trim()
    if (connecting && isIP(connecting) && isCloudflareIp(peer)) return rateLimitSource(connecting)
  }
  return rateLimitSource(peer)
}

function platformClientIp(event: H3Event, headerName: string): string | null {
  const name = headerName.trim().toLowerCase()
  if (!name) return null
  const value = getHeader(event, name)?.trim()
  return value && isIP(value) ? value : null
}

function proxyHops(value: unknown): number {
  const hops = Number(value)
  return Number.isFinite(hops) ? hops : 1
}
