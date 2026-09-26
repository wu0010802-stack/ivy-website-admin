// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CTA_ENTRIES,
  bookingActionClickKind,
  bookingCtaCampus,
  contactClickKind,
  ctaEntryOf,
  ctaEvent,
  isSamePage,
  reportBookingActionClick,
  sendCtaEvent,
  trackingAllowed,
  tracksClicks
} from '../app/utils/cta-analytics'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('預約鈕與聯絡連結點擊（B11 #63）', () => {
  it('入口代碼白名單和後端 CTA_ENTRIES 一致', () => {
    const models = read('../../backend/app/operations/models.py')
    const block = models.slice(models.indexOf('CTA_ENTRIES = ('), models.indexOf(')', models.indexOf('CTA_ENTRIES = (')))
    expect([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...CTA_ENTRIES])
  })

  it('官網標的入口都在白名單裡，點擊時取最近的區塊，不在白名單記 other', () => {
    const files = [
      'SiteHeader.vue', 'SiteFooter.vue', 'CampusBoard.vue', 'CampusPageMain.vue', 'CampusTour.vue', 'AdmissionContent.vue', 'EnvironmentContent.vue', 'CurriculumContent.vue', 'VisitForm.vue'
    ].map((name) => read(`../app/components/${name}`)).concat(read('../app/pages/visit/manage.vue'))
    const used = new Set(files.flatMap((text) => [...text.matchAll(/data-cta-entry="([a-z_]+)"/g)].map((m) => m[1]!)))
    expect([...used].filter((entry) => !(CTA_ENTRIES as readonly string[]).includes(entry))).toEqual([])
    expect(used.size).toBeGreaterThanOrEqual(13)

    document.body.innerHTML = `
      <header data-cta-entry="header"><div data-cta-entry="menu"><a id="menu" href="/visit">預約</a></div><a id="book" href="/visit">預約</a></header>
      <section data-cta-entry="bogus"><a id="bogus" href="/visit">預約</a></section>
      <a id="bare" href="/visit">預約</a>`
    expect(ctaEntryOf(document.getElementById('menu'))).toBe('menu')
    expect(ctaEntryOf(document.getElementById('book'))).toBe('header')
    expect(ctaEntryOf(document.getElementById('bogus'))).toBe('other')
    expect(ctaEntryOf(document.getElementById('bare'))).toBe('other')
  })

  it('往預約表單的站內連結記 booking_cta_clicked；頁首沒帶校區時在分校頁算那一校', () => {
    const origin = 'https://ivy.example'
    const url = (href: string) => new URL(href, origin)
    expect(bookingCtaCampus(url('/visit/renwu'), origin, '/')).toEqual({ campus: 'renwu' })
    expect(bookingCtaCampus(url('/visit'), origin, '/campuses/minghua')).toEqual({ campus: 'minghua' })
    expect(bookingCtaCampus(url('/visit'), origin, '/')).toEqual({ campus: null })
    expect(bookingCtaCampus(url('/visit/manage'), origin, '/')).toBeNull()
    expect(bookingCtaCampus(url('/campuses/renwu'), origin, '/')).toBeNull()
    expect(bookingCtaCampus(new URL('https://other.example/visit'), origin, '/')).toBeNull()
    // 連到目前這一頁（跳至主要內容的 #main、已在預約頁又點預約鈕）不算（B11-R2）。
    expect(bookingCtaCampus(url('/visit/renwu#main'), origin, '/visit/renwu')).toBeNull()
    expect(bookingCtaCampus(url('/visit#main'), origin, '/visit/')).toBeNull()
    expect(bookingCtaCampus(url('/visit'), origin, '/visit/renwu')).toEqual({ campus: 'renwu' })
    expect(isSamePage(url('/#main'), origin, '/')).toBe(true)
    expect(isSamePage(url('/visit/renwu/'), origin, '/visit/renwu')).toBe(true)
    expect(isSamePage(new URL('https://other.example/visit'), origin, '/visit')).toBe(false)
    expect(isSamePage(new URL('tel:07-000-0000'), origin, '/visit')).toBe(false)
    expect(contactClickKind(new URL('tel:07-000-0000'))).toBe('cta_click_phone')
    expect(contactClickKind(new URL('https://lin.ee/abc'))).toBe('cta_click_line')
    expect(contactClickKind(new URL('https://www.facebook.com/ivy'))).toBeNull()
  })

  it('後台與草稿預覽不記；DNT／GPC 或部署關閉統計也不記', () => {
    expect(tracksClicks('/admin/analytics')).toBe(false)
    expect(tracksClicks('/preview')).toBe(false)
    expect(tracksClicks('/admission')).toBe(true)
    expect(tracksClicks('/visit/manage')).toBe(true)
    expect(trackingAllowed(true, { doNotTrack: null } as Navigator)).toBe(true)
    expect(trackingAllowed(false, { doNotTrack: null } as Navigator)).toBe(false)
    expect(trackingAllowed(true, { doNotTrack: '1' } as Navigator)).toBe(false)
    expect(trackingAllowed(true, { doNotTrack: null, globalPrivacyControl: true } as Navigator & { globalPrivacyControl: boolean })).toBe(false)
  })

  it('每次點擊送一個隨機 event id，只帶事件、校區與入口；重送沿用同一個 id', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const first = ctaEvent('booking_cta_clicked', 'renwu', 'campus_hero')
    const second = ctaEvent('booking_cta_clicked', 'renwu', 'campus_hero')
    expect(first.event_id).toMatch(UUID)
    expect(first.event_id).not.toBe(second.event_id)
    expect(ctaEvent('cta_click_line', 'not-a-campus', 'other').campus_key).toBeNull()

    sendCtaEvent(first)
    sendCtaEvent(first)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/website/v1/public/analytics-events')
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' })
    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual(['campus_key', 'entry', 'event_id', 'event_type'])
    expect(JSON.parse(fetch.mock.calls[1]![1].body).event_id).toBe(body.event_id)
  })

  it('LINE／電話／外部網站預約鈕依預約方式記事件類型，表單與暫停不記（B11-R1）', () => {
    expect(bookingActionClickKind('line')).toBe('cta_click_line')
    expect(bookingActionClickKind('phone')).toBe('cta_click_phone')
    expect(bookingActionClickKind('external')).toBe('cta_click_external')
    for (const kind of ['form', 'paused', 'unavailable', 'choose_campus']) expect(bookingActionClickKind(kind)).toBeNull()
  })

  it('預約鈕自己回報時和全站點擊同一道閘：統計關閉、草稿預覽不送', () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    document.body.innerHTML = '<section data-cta-entry="visit_page"><a id="external" href="https://booking.example">前往預約網站</a></section>'
    const anchor = document.getElementById('external')
    try {
      history.replaceState(null, '', '/visit/renwu')
      reportBookingActionClick('external', 'renwu', anchor, true)
      reportBookingActionClick('form', 'renwu', anchor, true)
      reportBookingActionClick('external', 'renwu', anchor, false)
      history.replaceState(null, '', '/preview')
      reportBookingActionClick('line', 'renwu', anchor, true)
    } finally {
      history.replaceState(null, '', '/')
    }
    expect(fetch).toHaveBeenCalledOnce()
    const body = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(body).toMatchObject({ event_type: 'cta_click_external', campus_key: 'renwu', entry: 'visit_page' })
  })
})
