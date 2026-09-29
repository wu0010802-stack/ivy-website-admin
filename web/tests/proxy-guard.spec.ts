import { isIP } from 'node:net'
import { describe, expect, it } from 'vitest'
import { apiProxyTarget, rateLimitSource, unsafeProxyPath } from '../shared/request-guard'

const BASE = 'http://api.railway.internal:8000'

describe('代理路徑不接受點區段、編碼斜線與控制字元（稽核 proxy-dot-segment-*）', () => {
  it.each([
    '/../../../openapi.json',
    '/%2e%2e/%2e%2e/%2e%2e/openapi.json',
    '/%2E%2e/docs',
    '/public/./telemetry',
    '/x/.%2e/public/telemetry',
    // 多層編碼：後端或之後加的任何一層再解一次碼就會變成 ..，一律擋
    '/%252e%252e/openapi.json',
    '/%25252e%25252e/openapi.json',
    '/public%2ftelemetry',
    '/public%2Ftelemetry',
    '/a/..%5c..%5cdocs',
    '/a/..\\..\\docs',
    // URL 解析器會刪掉 tab／換行、修掉結尾空白，'.\t.' 會變成 '..'
    '/x/.\t./public/telemetry',
    '/x/..\n/y',
    '/x/.. ',
  ])('%s → 拒絕', (path) => {
    expect(unsafeProxyPath(path)).toBe(true)
  })

  it.each([
    '/public/site',
    '/public/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file',
    '/admin/content-items/campus_faq?campus_key=yihua',
    '/auth/google/callback?code=a/../b&state=%2e%2e',
    '/admin/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/variants/thumbnail',
    '/public/booking-config/yihua',
    '/admin/news/a.b.c',
    '/admin/files/...',
    '/admin/search?q=%25',
  ])('%s → 正常轉送', (path) => {
    expect(unsafeProxyPath(path)).toBe(false)
  })
})

describe('組出的後端網址一定留在 /api/website/v1 之下', () => {
  it('回傳正規化後的網址與後端實際看到的路徑', () => {
    const target = apiProxyTarget(BASE, '/public/media/abc/file?v=1')
    expect(target?.url.href).toBe(`${BASE}/api/website/v1/public/media/abc/file?v=1`)
    expect(target?.apiPath).toBe('/public/media/abc/file')
  })

  it('apiPath 是後端路由看到的樣子（uvicorn 會再解一次百分比編碼）', () => {
    expect(apiProxyTarget(BASE, '/public/%74elemetry')?.apiPath).toBe('/public/telemetry')
    // h3 保留 %25：%2574 到後端只解成 %74，不會變成 telemetry
    expect(apiProxyTarget(BASE, '/public/%2574elemetry')?.apiPath).toBe('/public/%74elemetry')
  })

  it('跳出前綴或換主機一律回 null', () => {
    expect(apiProxyTarget(BASE, '/../../../openapi.json')).toBeNull()
    expect(apiProxyTarget(BASE, '/%2e%2e/%2e%2e/%2e%2e/docs')).toBeNull()
    expect(apiProxyTarget(BASE, '')).toBeNull()
  })
})

describe('限流來源：IPv6 聚合到 /64（稽核 client-ip-no-ipv6-prefix-aggregation）', () => {
  it('同一個 /64 的不同位址落在同一個桶', () => {
    expect(rateLimitSource('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::')
    expect(rateLimitSource('2001:db8:1:2::9')).toBe('2001:db8:1:2::')
    expect(rateLimitSource('2001:DB8:0001:0002:ffff::1')).toBe('2001:db8:1:2::')
    expect(rateLimitSource('2001:db8:1:3::1')).toBe('2001:db8:1:3::')
    expect(rateLimitSource('fe80::1%eth0')).toBe('fe80:0:0:0::')
  })

  it('聚合結果仍是合法 IP，API 端（Turnstile remoteip）照常解析', () => {
    for (const ip of ['2001:db8:1:2:3:4:5:6', '::1', '2001:db8::', 'fe80::1%eth0']) {
      expect(isIP(rateLimitSource(ip))).toBe(6)
    }
  })

  it('IPv4 與 IPv4-mapped IPv6 都以 IPv4 為鍵', () => {
    expect(rateLimitSource('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitSource('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitSource('::ffff:cb00:7109')).toBe('203.0.113.9')
  })

  it('不是 IP 的值原樣回傳（呼叫端已先驗證）', () => {
    expect(rateLimitSource('')).toBe('')
    expect(rateLimitSource('unknown')).toBe('unknown')
  })
})
