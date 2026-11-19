// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHeader } from 'h3'
import { isCloudflareIp } from '../server/utils/cloudflare-ip'
import { trustedClientIp } from '../server/utils/client-ip'

// www 改走 Cloudflare 代理後的訪客 IP（2026-11-12，server/utils/client-ip.ts）：上一跳確實是
// Cloudflare 節點才採信 CF-Connecting-IP，繞過 Cloudflare 直接打 Railway 的人自己帶的不算。

function event(headers: Record<string, string>, remoteAddress = '10.0.0.5') {
  return { node: { req: { headers, socket: { remoteAddress } } } } as never
}

function withConfig(config: Record<string, unknown>) {
  vi.stubGlobal('useRuntimeConfig', () => ({ trustedProxyHops: 1, ...config }))
  vi.stubGlobal('getHeader', getHeader)
}

afterEach(() => vi.unstubAllGlobals())

describe('isCloudflareIp', () => {
  it.each(['173.245.48.1', '104.16.0.1', '172.71.255.254', '::ffff:162.158.1.1', '2400:cb00::1', '2a06:98c7:ffff::1'])('%s 是 Cloudflare', (ip) => {
    expect(isCloudflareIp(ip)).toBe(true)
  })
  it.each(['203.0.113.9', '104.32.0.1', '2001:db8::1', '2a06:98c8::1', 'not-an-ip', ''])('%s 不是', (ip) => {
    expect(isCloudflareIp(ip)).toBe(false)
  })
})

describe('trustedClientIp 與 Cloudflare', () => {
  it('預設（灰雲）：不看 CF-Connecting-IP，照舊從 X-Forwarded-For 右邊取', () => {
    withConfig({})
    expect(trustedClientIp(event({ 'x-forwarded-for': '198.51.100.7, 162.158.1.1', 'cf-connecting-ip': '198.51.100.7' }))).toBe('162.158.1.1')
  })

  it('開啟後：上一跳是 Cloudflare 就用 CF-Connecting-IP', () => {
    withConfig({ cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 162.158.1.1', 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('開啟後：IPv6 訪客照樣聚合到 /64', () => {
    withConfig({ cloudflareClientIp: 'true' })
    expect(trustedClientIp(event({ 'x-forwarded-for': '2606:4700:10::6816:1', 'cf-connecting-ip': '2001:db8:1:2:3:4:5:6' }))).toBe('2001:db8:1:2::')
  })

  it('開啟後：繞過 Cloudflare 直接連（上一跳不是 Cloudflare）自己帶的 header 不採信', () => {
    withConfig({ cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '198.51.100.7' }))).toBe('203.0.113.9')
  })

  it('開啟後：header 不是 IP 就退回上一跳', () => {
    withConfig({ cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-forwarded-for': '162.158.1.1', 'cf-connecting-ip': 'evil' }))).toBe('162.158.1.1')
  })
})

// Railway edge 前面多一層 CDN77 時（2026-11-12 實測）：X-Forwarded-For 是「訪客, CDN 節點」，
// X-Real-IP 由 Railway 覆寫成訪客本人。正式站設 NUXT_CLIENT_IP_HEADER=x-real-ip。
describe('trustedClientIp 與平台 header（X-Real-IP）', () => {
  it('沒設：照舊從 X-Forwarded-For 右邊取（會拿到 CDN 節點，這就是要修的情況）', () => {
    withConfig({})
    expect(trustedClientIp(event({ 'x-forwarded-for': '198.51.100.7, 79.127.228.17', 'x-real-ip': '198.51.100.7' }))).toBe('79.127.228.17')
  })

  it('設 x-real-ip：灰雲（admin）取到訪客本人', () => {
    withConfig({ clientIpHeader: 'x-real-ip' })
    expect(trustedClientIp(event({ 'x-forwarded-for': '198.51.100.7, 79.127.228.17', 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('設 x-real-ip：header 名稱大小寫與空白不影響', () => {
    withConfig({ clientIpHeader: ' X-Real-IP ' })
    expect(trustedClientIp(event({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('設 x-real-ip＋Cloudflare：Railway 已換成訪客本人時直接用', () => {
    withConfig({ clientIpHeader: 'x-real-ip', cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-forwarded-for': '104.22.20.90, 84.17.44.229', 'x-real-ip': '198.51.100.7', 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('設 x-real-ip＋Cloudflare：X-Real-IP 若是 Cloudflare 節點，改用 CF-Connecting-IP', () => {
    withConfig({ clientIpHeader: 'x-real-ip', cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-real-ip': '104.22.20.90', 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('設 x-real-ip＋Cloudflare：直連自帶的 CF-Connecting-IP 不採信', () => {
    withConfig({ clientIpHeader: 'x-real-ip', cloudflareClientIp: true })
    expect(trustedClientIp(event({ 'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '8.8.4.4' }))).toBe('203.0.113.9')
  })

  it('X-Real-IP 不是 IP 或沒有：退回 X-Forwarded-For', () => {
    withConfig({ clientIpHeader: 'x-real-ip' })
    expect(trustedClientIp(event({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': 'evil' }))).toBe('203.0.113.9')
    expect(trustedClientIp(event({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })
})
