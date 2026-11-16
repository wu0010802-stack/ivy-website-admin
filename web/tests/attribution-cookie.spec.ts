import { describe, expect, it } from 'vitest'
import { decodeAttribution, encodeAttribution, isLandingRequest, nextAttribution, taipeiDay, type AttributionCookie } from '../shared/attribution-cookie'

// 跨次造訪的網站來源 cookie（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §1）。
// SAMPLE 與 backend/tests/test_cookie_features_20261116.py 同一組：後端解得開官網寫的 cookie。
const SAMPLE: AttributionCookie = {
  v: 1,
  f: { s: 'facebook', d: '2026-11-10' },
  l: { s: 'ads', d: '2026-11-16', c: 'chatgpt-five-campuses' },
  o: { v: 'opp_AbC.123-x', t: 1_794_787_200_000 },
  b: { v: 'IwAR0abc_DEF-123', t: 1_794_787_200_000 }
}
const SAMPLE_COOKIE =
  'eyJ2IjoxLCJmIjp7InMiOiJmYWNlYm9vayIsImQiOiIyMDI2LTExLTEwIn0sImwiOnsicyI6ImFkcyIsImQiOiIyMDI2LTExLTE2IiwiYyI6' +
  'ImNoYXRncHQtZml2ZS1jYW1wdXNlcyJ9LCJvIjp7InYiOiJvcHBfQWJDLjEyMy14IiwidCI6MTc5NDc4NzIwMDAwMH0sImIiOnsidiI6Ikl3' +
  'QVIwYWJjX0RFRi0xMjMiLCJ0IjoxNzk0Nzg3MjAwMDAwfX0'

// 廣告平台（p）樣本：Task 2 後端測試用同一個字串
const SAMPLE_ADS: AttributionCookie = {
  v: 1,
  f: { s: 'search', d: '2026-11-10' },
  l: { s: 'ads', p: 'google', d: '2026-11-16' }
}
const SAMPLE_ADS_COOKIE = 'eyJ2IjoxLCJmIjp7InMiOiJzZWFyY2giLCJkIjoiMjAyNi0xMS0xMCJ9LCJsIjp7InMiOiJhZHMiLCJwIjoiZ29vZ2xlIiwiZCI6IjIwMjYtMTEtMTYifX0'

const NOW = new Date('2026-11-16T02:00:00Z')
const landing = (referrer: string, search = '', userAgent = 'Mozilla/5.0') => ({ referrer, search, userAgent })

describe('cookie 編碼', () => {
  it('和後端用同一個字串', () => {
    expect(encodeAttribution(SAMPLE)).toBe(SAMPLE_COOKIE)
    expect(decodeAttribution(SAMPLE_COOKIE)).toEqual(SAMPLE)
  })

  it('廣告平台 p 編碼與讀回', () => {
    expect(encodeAttribution(SAMPLE_ADS)).toBe(SAMPLE_ADS_COOKIE)
    expect(decodeAttribution(SAMPLE_ADS_COOKIE)).toEqual(SAMPLE_ADS)
  })

  it('壞的 p 丟掉那一欄，非廣告來源不收 p', () => {
    const enc = (l: unknown) => btoa(JSON.stringify({ v: 1, f: { s: 'search', d: '2026-11-10' }, l })).replace(/=+$/, '')
    expect(decodeAttribution(enc({ s: 'ads', p: 'tiktok', d: '2026-11-16' }))?.l).toEqual({ s: 'ads', d: '2026-11-16' })
    expect(decodeAttribution(enc({ s: 'search', p: 'google', d: '2026-11-16' }))?.l).toEqual({ s: 'search', d: '2026-11-16' })
  })

  it('格式不對整個當沒有，欄位不合規則就丟掉那一欄', () => {
    for (const raw of [undefined, '', '!!!', 'e30', btoa('{"v":2}'), 'a'.repeat(4000)]) expect(decodeAttribution(raw)).toBeNull()
    const bad = btoa(JSON.stringify({ v: 1, f: { s: 'search', d: '2026-11-12', c: 'Bad!' }, l: { s: 'evil', d: '2026-11-12' }, o: { v: 'x;y', t: 1 } }))
      .replace(/=+$/, '')
    expect(decodeAttribution(bad)).toEqual({ v: 1, f: { s: 'search', d: '2026-11-12' } })
  })
})

describe('進站更新', () => {
  it('第一次直接進站只記第一次；之後從搜尋進來記最後一次；再直接進站不蓋掉', () => {
    const first = nextAttribution(null, landing(''), NOW)
    expect(first).toEqual({ v: 1, f: { s: 'direct', d: '2026-11-16' } })
    const search = nextAttribution(first, landing('https://www.google.com/'), new Date('2026-11-18T03:00:00Z'))
    expect(search).toEqual({ v: 1, f: { s: 'direct', d: '2026-11-16' }, l: { s: 'search', d: '2026-11-18' } })
    expect(nextAttribution(search, landing(''), new Date('2026-11-20T03:00:00Z'))).toEqual(search)
  })

  it('廣告進站記平台，非廣告進站沒有 p', () => {
    expect(nextAttribution(null, { referrer: '', search: '?gclid=a', userAgent: '' }, NOW).f).toEqual({ s: 'ads', p: 'google', d: '2026-11-16' })
    const organic = nextAttribution(null, landing('https://www.google.com/'), NOW)
    expect(organic.f).not.toHaveProperty('p')
  })

  it('廣告點擊記活動代碼與點擊代碼', () => {
    const next = nextAttribution(null, landing('', '?utm_source=chatgpt&utm_medium=cpc&utm_campaign=chatgpt-five-campuses&oppref=opp_1'), NOW)
    expect(next.f).toEqual({ s: 'ads', p: 'openai', d: '2026-11-16', c: 'chatgpt-five-campuses' })
    expect(next.l).toEqual(next.f)
    expect(next.o).toEqual({ v: 'opp_1', t: NOW.getTime() })
    const fb = nextAttribution(next, landing('https://l.facebook.com/', '?fbclid=IwAR_x-1'), NOW)
    expect(fb.l).toEqual({ s: 'facebook', d: '2026-11-16' })
    expect(fb.b).toEqual({ v: 'IwAR_x-1', t: NOW.getTime() })
    expect(fb.o).toEqual(next.o)
  })

  it('LINE 廣告的 ldtag_cl 記成 n，讀回來也保留（2026-11-16）', () => {
    const line = nextAttribution(null, landing('', '?utm_source=line&utm_medium=cpc&ldtag_cl=CL.abc-123_x'), NOW)
    expect(line.n).toEqual({ v: 'CL.abc-123_x', t: NOW.getTime() })
    expect(decodeAttribution(encodeAttribution(line))?.n).toEqual(line.n)
    expect(nextAttribution(null, landing('', '?ldtag_cl=a%3Bb'), NOW).n).toBeUndefined()
  })

  it('格式怪的點擊代碼不記', () => {
    expect(nextAttribution(null, landing('', '?oppref=a%3Bb&fbclid=x.y'), NOW)).toEqual({ v: 1, f: { s: 'ads', p: 'openai', d: '2026-11-16' }, l: { s: 'ads', p: 'openai', d: '2026-11-16' } })
    // oppref 一出現就算 OpenAI 廣告進站（2026-11-16 起），只是格式怪的代碼本身不記
    expect(nextAttribution(null, landing('', '?fbclid=x.y'), NOW)).toEqual({ v: 1, f: { s: 'facebook', d: '2026-11-16' }, l: { s: 'facebook', d: '2026-11-16' } })
  })

  it('台北日期', () => {
    expect(taipeiDay(new Date('2026-11-15T16:30:00Z'))).toBe('2026-11-16')
    expect(taipeiDay(new Date('2026-11-15T15:59:00Z'))).toBe('2026-11-15')
  })
})

describe('哪些請求算進站', () => {
  const base = { method: 'GET', isPublicPage: true }
  it('整頁載入公開頁才算', () => {
    expect(isLandingRequest({ ...base, secFetchDest: 'document' })).toBe(true)
    expect(isLandingRequest({ ...base, accept: 'text/html,application/xhtml+xml' })).toBe(true)
    expect(isLandingRequest({ ...base, secFetchDest: 'empty', accept: 'text/html' })).toBe(false)
    expect(isLandingRequest({ ...base, method: 'HEAD', secFetchDest: 'document' })).toBe(false)
    expect(isLandingRequest({ ...base, isPublicPage: false, secFetchDest: 'document' })).toBe(false)
    expect(isLandingRequest({ ...base, secFetchDest: 'document', purpose: 'prefetch' })).toBe(false)
  })
})
