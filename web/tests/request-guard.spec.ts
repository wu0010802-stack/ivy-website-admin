import { isIP } from 'node:net'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BODY_LIMIT, MEDIA_UPLOAD_BODY_LIMIT, apiProxyTarget, clientIpFromForwardedFor, escapesApiPrefix, isMediaUploadPath, mediaUploadBodyLimit, proxyBodyLimit, rateLimitSource } from '../shared/request-guard'

const BASE = 'http://api.railway.internal:8000'

describe('訪客 IP 只採信可信代理附加的那一段', () => {
  it('從右邊數可信代理層數，訪客自填的最左段無效', () => {
    expect(clientIpFromForwardedFor('6.6.6.6, 203.0.113.9', 1)).toBe('203.0.113.9')
    expect(clientIpFromForwardedFor('6.6.6.6, 203.0.113.9, 10.0.0.2', 2)).toBe('203.0.113.9')
    expect(clientIpFromForwardedFor('2001:db8::1', 1)).toBe('2001:db8::1')
  })
  it('層數不夠、不是 IP 或沒有 header 時交給 socket 位址', () => {
    expect(clientIpFromForwardedFor(undefined, 1)).toBeNull()
    expect(clientIpFromForwardedFor('203.0.113.9', 2)).toBeNull()
    expect(clientIpFromForwardedFor('not-an-ip', 1)).toBeNull()
    expect(clientIpFromForwardedFor('203.0.113.9', 0)).toBeNull()
  })
})

describe('代理本文上限', () => {
  it('只有素材上傳與替換路徑放寬', () => {
    expect(proxyBodyLimit('/admin/media')).toBe(MEDIA_UPLOAD_BODY_LIMIT)
    expect(proxyBodyLimit('/admin/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/replace')).toBe(MEDIA_UPLOAD_BODY_LIMIT)
    expect(isMediaUploadPath('/admin/media?x=1')).toBe(true)
    expect(proxyBodyLimit('/public/visit-requests')).toBe(DEFAULT_BODY_LIMIT)
    expect(proxyBodyLimit('/admin/media-evil')).toBe(DEFAULT_BODY_LIMIT)
    expect(proxyBodyLimit('/admin/content-items/campus_news/revisions')).toBe(DEFAULT_BODY_LIMIT)
  })
})

describe('素材上傳上限跟著部署設定', () => {
  it('預設影片 150 MB：本文上限 155 MB，與 API 的算法相同', () => {
    expect(MEDIA_UPLOAD_BODY_LIMIT).toBe(155 * 1024 * 1024)
    expect(mediaUploadBodyLimit(300)).toBe(305 * 1024 * 1024)
    expect(proxyBodyLimit('/admin/media', 20)).toBe(25 * 1024 * 1024)
    expect(proxyBodyLimit('/public/visit-requests', 300)).toBe(DEFAULT_BODY_LIMIT)
  })
  it('設定值無效時退回預設', () => {
    expect(mediaUploadBodyLimit(Number.NaN)).toBe(MEDIA_UPLOAD_BODY_LIMIT)
    expect(mediaUploadBodyLimit(0)).toBe(MEDIA_UPLOAD_BODY_LIMIT)
  })
})

describe('代理不能被 .. 帶出 API 前綴（稽核 proxy-dot-segment-*）', () => {
  it('擋下編碼或未編碼的上一層路徑', () => {
    expect(escapesApiPrefix('/%2e%2e/%2e%2e/%2e%2e/openapi.json')).toBe(true)
    expect(escapesApiPrefix('/../../../docs')).toBe(true)
    expect(escapesApiPrefix('/%2E%2E/%2e%2e/%2e%2e/health')).toBe(true)
  })

  it('正常路徑照常轉送', () => {
    expect(escapesApiPrefix('/public/site')).toBe(false)
    expect(escapesApiPrefix('/admin/visit-requests?q=0912345678')).toBe(false)
    expect(escapesApiPrefix('')).toBe(false)
  })

  // 瀏覽器送出前就會收掉點區段，正常請求不會帶；前綴內的 .. 也一律不轉送，
  // 免得繞過代理自己的路徑判斷（例如 /x/../public/telemetry）。
  it.each([
    '/public/../health',
    '/%2E%2e/docs',
    '/public/./telemetry',
    '/x/.%2e/public/telemetry',
    // 多層編碼：後端或之後加的任何一層再解一次碼就會變成 ..，一律擋
    '/%252e%252e/openapi.json',
    '/%25252e%25252e/openapi.json',
    '/%2525252525252e%2525252525252e/openapi.json',
    // 編碼斜線與反斜線：uvicorn 會把 %2f／%5c 解成路徑分隔，反斜線在 http 網址等同斜線
    '/public%2ftelemetry',
    '/public%2Ftelemetry',
    '/a/..%5c..%5cdocs',
    '/a/..\\..\\docs',
    // URL 解析器會刪掉 tab／換行、修掉結尾空白，'.\t.' 會變成 '..'
    '/x/.\t./public/telemetry',
    '/x/..\n/y',
    '/x/.. ',
  ])('%s → 不轉送', (path) => {
    expect(escapesApiPrefix(path)).toBe(true)
  })

  it.each([
    '/public/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file',
    '/admin/content-items/campus_news?campus_key=yihua',
    '/auth/google/callback?code=a/../b&state=%2e%2e',
    '/admin/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/variants/thumbnail',
    '/public/booking-config/yihua',
    '/admin/news/a.b.c',
    '/admin/files/...',
    '/admin/search?q=%25',
  ])('%s → 正常轉送', (path) => {
    expect(escapesApiPrefix(path)).toBe(false)
  })
})

describe('組出的後端網址', () => {
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

  it('base 設定壞掉時回 null', () => {
    expect(apiProxyTarget('not a url', '/public/site')).toBeNull()
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
