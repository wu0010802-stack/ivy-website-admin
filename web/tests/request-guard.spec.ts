import { describe, expect, it } from 'vitest'
import { DEFAULT_BODY_LIMIT, MEDIA_UPLOAD_BODY_LIMIT, clientIpFromForwardedFor, isMediaUploadPath, proxyBodyLimit } from '../shared/request-guard'

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
    expect(proxyBodyLimit('/admin/content-items/campus_faq/revisions')).toBe(DEFAULT_BODY_LIMIT)
  })
})
