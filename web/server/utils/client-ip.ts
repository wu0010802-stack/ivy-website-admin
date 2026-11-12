import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { clientIpFromForwardedFor, rateLimitSource } from '../../shared/request-guard'
import { isCloudflareIp } from './cloudflare-ip'

/**
 * 給 API 限流用的訪客來源。不用 `getRequestIP(event, { xForwardedFor: true })`：
 * 它取 X-Forwarded-For 的第一段，那是訪客自己能填的值，換一個就換一個限流桶。
 * IPv6 聚合到 /64 的網路位址（見 rateLimitSource）：同一段 /64 共用一個桶。
 *
 * NUXT_CLOUDFLARE_CLIENT_IP=true（www 經過 Cloudflare 代理時才開，2026-11-12）：從右邊數到的
 * 那一跳（Railway edge 看到的連線來源）是 Cloudflare 節點時，改採信 CF-Connecting-IP；
 * 不是 Cloudflare 來的（直接打 Railway 網域繞過 Cloudflare）一律不信那個 header。
 * NUXT_TRUSTED_PROXY_HOPS 維持 1，不要改成 2：改 2 等於相信 Cloudflare 那一層填的值，
 * 繞過 Cloudflare 的人可以自己填。
 */
export function trustedClientIp(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const hops = Number(config.trustedProxyHops)
  const forwarded = clientIpFromForwardedFor(getHeader(event, 'x-forwarded-for'), Number.isFinite(hops) ? hops : 1)
  const peer = forwarded ?? event.node.req.socket.remoteAddress ?? ''
  // 執行期用環境變數覆寫時，Nuxt 會把 'true' 轉成布林；保險起見字串也認。
  if (String(config.cloudflareClientIp) === 'true') {
    const connecting = getHeader(event, 'cf-connecting-ip')?.trim()
    if (connecting && isIP(connecting) && isCloudflareIp(peer)) return rateLimitSource(connecting)
  }
  return rateLimitSource(peer)
}
