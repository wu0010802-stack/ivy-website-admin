import type { H3Event } from 'h3'
import { clientIpFromForwardedFor, rateLimitSource } from '../../shared/request-guard'

/**
 * 給 API 限流用的訪客來源。不用 `getRequestIP(event, { xForwardedFor: true })`：
 * 它取 X-Forwarded-For 的第一段，那是訪客自己能填的值，換一個就換一個限流桶。
 * IPv6 聚合到 /64 的網路位址（見 rateLimitSource）：同一段 /64 共用一個桶。
 */
export function trustedClientIp(event: H3Event): string {
  const hops = Number(useRuntimeConfig(event).trustedProxyHops)
  const forwarded = clientIpFromForwardedFor(getHeader(event, 'x-forwarded-for'), Number.isFinite(hops) ? hops : 1)
  return rateLimitSource(forwarded ?? event.node.req.socket.remoteAddress ?? '')
}
