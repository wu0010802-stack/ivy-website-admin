import { describe, expect, it } from 'vitest'
import { BROWSER_ID, decodeAttribution, encodeAttribution, isLandingRequest, isReturningVisit, newBrowserId, nextAttribution, sourceFromUserAgentOnly, taipeiDay, type AttributionCookie } from '../shared/attribution-cookie'

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
const FIXED_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const ID = () => FIXED_ID

it('跨日以台北日期分類，缺少、無效或未來的 cookie 日期列未知', () => {
  const cookie = (d: string) => encodeAttribution({ v: 1, f: { s: 'direct', d } })
  const midnight = new Date('2026-11-17T16:00:00Z')
  expect(isReturningVisit(cookie('2026-11-18'), midnight)).toBe(false)
  expect(isReturningVisit(cookie('2026-11-17'), midnight)).toBe(true)
  for (const value of [undefined, cookie('2026-11-19'), cookie('2026-02-30')]) {
    expect(isReturningVisit(value, midnight)).toBeNull()
  }
})

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
    const first = nextAttribution(null, landing(''), NOW, ID)
    expect(first).toEqual({ v: 1, i: FIXED_ID, f: { s: 'direct', d: '2026-11-16' } })
    const search = nextAttribution(first, landing('https://www.google.com/'), new Date('2026-11-18T03:00:00Z'))
    expect(search).toEqual({ v: 1, i: FIXED_ID, f: { s: 'direct', d: '2026-11-16' }, l: { s: 'search', d: '2026-11-18' } })
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
    expect(nextAttribution(null, landing('', '?oppref=a%3Bb&fbclid=x.y'), NOW, ID)).toEqual({ v: 1, i: FIXED_ID, f: { s: 'ads', p: 'openai', d: '2026-11-16' }, l: { s: 'ads', p: 'openai', d: '2026-11-16' } })
    // oppref 一出現就算 OpenAI 廣告進站（2026-11-16 起），只是格式怪的代碼本身不記
    expect(nextAttribution(null, landing('', '?fbclid=x.y'), NOW, ID)).toEqual({ v: 1, i: FIXED_ID, f: { s: 'facebook', d: '2026-11-16' }, l: { s: 'facebook', d: '2026-11-16' } })
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

// 2026-11-19（docs/specs/2026-11-19-cookie-stats-design.md §4～6、§9）
describe('同一瀏覽器的匿名代號', () => {
  it('第一次進站就產生，之後沿用；舊 cookie 沒有就補上', () => {
    const first = nextAttribution(null, landing(''), NOW)
    expect(first.i).toMatch(BROWSER_ID)
    expect(nextAttribution(first, landing('https://www.google.com/'), NOW).i).toBe(first.i)
    const legacy: AttributionCookie = { v: 1, f: { s: 'direct', d: '2026-11-10' } }
    expect(nextAttribution(legacy, landing(''), NOW, ID).i).toBe(FIXED_ID)
  })

  it('隨機碼是 22 字 base64url、每次不同', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newBrowserId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(BROWSER_ID)
  })

  it('解碼時格式不對的代號丟掉，其他欄位照留', () => {
    const raw = encodeAttribution({ ...SAMPLE, i: 'bad id' } as AttributionCookie)
    expect(decodeAttribution(raw)).toEqual(SAMPLE)
    expect(decodeAttribution(encodeAttribution({ ...SAMPLE, i: FIXED_ID }))?.i).toBe(FIXED_ID)
  })
})

describe('App 內建瀏覽器重新整理不蓋掉當天的廣告來源（§9）', () => {
  const LINE_UA = 'Mozilla/5.0 (iPhone) Line/14.0.0'
  const ad = nextAttribution(null, landing('', '?gclid=abc'), NOW, ID)

  it('只靠 User-Agent 認出的來源才算', () => {
    expect(sourceFromUserAgentOnly(landing('', '', LINE_UA))).toBe(true)
    expect(sourceFromUserAgentOnly(landing('', '?utm_source=line', LINE_UA))).toBe(false)
    expect(sourceFromUserAgentOnly(landing('https://line.me/', '', LINE_UA))).toBe(false)
    expect(sourceFromUserAgentOnly(landing('', '?fbclid=x', 'FBAN/FBIOS'))).toBe(false)
    expect(sourceFromUserAgentOnly(landing('', ''))).toBe(false)
  })

  it('同一天：保留廣告；隔天：照常改成 App 來源', () => {
    expect(nextAttribution(ad, landing('', '', LINE_UA), new Date('2026-11-16T09:00:00Z')).l).toEqual(ad.l)
    expect(nextAttribution(ad, landing('', '', LINE_UA), new Date('2026-11-17T09:00:00Z')).l).toEqual({ s: 'line', d: '2026-11-17' })
  })

  it('同一天從 LINE 連結（有 utm 或來源網址）進來照常更新', () => {
    expect(nextAttribution(ad, landing('', '?utm_source=line', LINE_UA), NOW).l).toEqual({ s: 'line', d: '2026-11-16' })
  })

  it('沒有舊的最後一次時照常記', () => {
    expect(nextAttribution(null, landing('', '', LINE_UA), NOW, ID).l).toEqual({ s: 'line', d: '2026-11-16' })
  })
})
