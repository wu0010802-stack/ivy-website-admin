import { timingSafeEqual } from 'node:crypto'
import { trustedClientIp } from '../../utils/client-ip'

// 暫時的診斷端點（2026-11-12）：量 Railway edge 實際轉給 web 的訪客 IP 相關 header，
// 用來修正 trustedClientIp 取錯 IP（操作紀錄記到 CDN 節點）。量完連同這支檔案一起移除。
//
// 放在 /api/client-errors/ 底下是因為這個前綴在官網與後台兩個主機都會照常服務
// （server/utils/admin-host.ts 的 SHARED），才能分別量 www（Cloudflare 代理）與 admin（灰雲）。
// 只回這個請求自己的 header，不碰資料庫；沒設 NUXT_IP_DIAG_TOKEN 時一律 404。
const ECHO_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-railway-edge', 'x-railway-request-id', 'forwarded', 'true-client-ip', 'x-envoy-external-address'] as const

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const expected = String(useRuntimeConfig(event).ipDiagToken ?? '')
  const given = getHeader(event, 'x-ip-diag-token') ?? ''
  if (expected.length < 32 || !sameToken(given, expected)) throw createError({ statusCode: 404 })
  const headers: Record<string, string | null> = {}
  for (const name of ECHO_HEADERS) headers[name] = getHeader(event, name) ?? null
  return {
    host: getHeader(event, 'host') ?? null,
    socket_remote_address: event.node.req.socket.remoteAddress ?? null,
    headers,
    trusted_client_ip: trustedClientIp(event)
  }
})
