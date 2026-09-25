// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'
import { reportBookingActionClick } from '../app/utils/cta-analytics'

// 全站點擊攔截（plugins/telemetry.client.ts）掛在 document 上的判斷順序：
// data-booking-cta 先略過、往預約表單優先於聯絡連結、後台與草稿預覽不記、
// 只有 [data-campus-key] 底下的 tel／LINE 才送（B11-R5）。

vi.mock('web-vitals', () => ({ onLCP: () => {}, onINP: () => {}, onCLS: () => {} }))

type Plugin = (app: { hook: (name: string, fn: () => void) => void }) => void
let plugin: Plugin
const cleanups: (() => void)[] = []
const CTA_URL = '/api/website/v1/public/analytics-events'
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (setup: Plugin) => setup)
  plugin = (await import('../app/plugins/telemetry.client')).default as unknown as Plugin
  // 測試只看統計，不讓 happy-dom 真的跟著連結換頁或開新視窗。
  window.addEventListener('click', (event) => event.preventDefault(), true)
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** 在 path 這一頁掛上 plugin，回傳只記點擊之後的 fetch。 */
function mountAt(path: string, html: string): Mock {
  history.replaceState(null, '', path)
  document.body.innerHTML = html
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { telemetryEnabled: true } }))
  const hooks: Record<string, () => void> = {}
  const add = vi.spyOn(document, 'addEventListener')
  plugin({ hook: (name, fn) => { hooks[name] = fn } })
  hooks['app:mounted']!()
  const listener = add.mock.calls.find(([type]) => type === 'click')?.[1]
  add.mockRestore()
  expect(listener).toBeTypeOf('function')
  cleanups.push(() => document.removeEventListener('click', listener as EventListener))
  fetch.mockClear() // 掛上時的 page_view 不算
  return fetch
}

function click(selector: string) {
  const anchor = document.querySelector(selector)!
  // 點在連結裡面的文字上，plugin 要往上找到 <a>。
  const target = anchor.firstElementChild ?? anchor
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

const ctaBodies = (fetch: Mock) => fetch.mock.calls.filter(([url]) => url === CTA_URL).map(([, init]) => {
  const { event_type, campus_key, entry } = JSON.parse(init.body)
  return { event_type, campus_key, entry }
})
const telemetryBodies = (fetch: Mock) => fetch.mock.calls.filter(([url]) => url === '/api/telemetry').map(([, init]) => JSON.parse(init.body).event)

describe('全站點擊統計（plugins/telemetry.client.ts）', () => {
  it('頁首預約鈕記 booking_cta_clicked；在分校頁點的算那一校', () => {
    const header = '<header data-cta-entry="header"><a id="book" href="/visit"><span>預約參觀</span></a></header>'
    let fetch = mountAt('/', header)
    click('#book')
    expect(ctaBodies(fetch)).toEqual([{ event_type: 'booking_cta_clicked', campus_key: null, entry: 'header' }])
    expect(telemetryBodies(fetch)).toEqual(['visit_click'])
    cleanups.splice(0).forEach((cleanup) => cleanup())

    fetch = mountAt('/campuses/minghua', `<main data-campus-key="minghua">${header}</main>`)
    click('#book')
    // 往預約表單的判斷排在聯絡連結前面：在 [data-campus-key] 底下也只記一次。
    expect(ctaBodies(fetch)).toEqual([{ event_type: 'booking_cta_clicked', campus_key: 'minghua', entry: 'header' }])
  })

  it('BookingCta 與預約頁聯絡按鈕標 data-booking-cta，plugin 不重複記', () => {
    const fetch = mountAt('/campuses/yihua', `
      <main data-campus-key="yihua"><section data-cta-entry="campus_hero">
        <a id="line" data-booking-cta href="https://lin.ee/abc" target="_blank"><span>透過 LINE 聯絡</span></a>
        <a id="tel" data-booking-cta href="tel:07-000-0000"><span>致電洽詢</span></a>
      </section></main>`)
    click('#line')
    click('#tel')
    expect(ctaBodies(fetch)).toEqual([])
  })

  it('只有 [data-campus-key] 底下的電話與 LINE 才記，其他外部連結不記', () => {
    const fetch = mountAt('/campuses/renwu', `
      <main data-campus-key="renwu"><section data-cta-entry="campus_contact">
        <a id="tel" href="tel:07-000-0000"><span>07-000-0000</span></a>
        <a id="line" href="https://line.me/R/ti/p/@ivy"><span>LINE</span></a>
        <a id="fb" href="https://www.facebook.com/ivy"><span>Facebook</span></a>
      </section></main>
      <footer data-cta-entry="footer"><a id="footer-tel" href="tel:07-111-1111"><span>總機</span></a></footer>`)
    for (const id of ['tel', 'line', 'fb', 'footer-tel']) click(`#${id}`)
    expect(ctaBodies(fetch)).toEqual([
      { event_type: 'cta_click_phone', campus_key: 'renwu', entry: 'campus_contact' },
      { event_type: 'cta_click_line', campus_key: 'renwu', entry: 'campus_contact' }
    ])
  })

  it('後台與草稿預覽的點擊都不記', () => {
    const html = '<main data-campus-key="yihua"><a id="book" href="/visit/yihua"><span>預約</span></a><a id="tel" href="tel:07-000-0000"><span>電話</span></a></main>'
    for (const path of ['/preview', '/admin/analytics']) {
      const fetch = mountAt(path, html)
      click('#book')
      click('#tel')
      expect(fetch).not.toHaveBeenCalled()
      cleanups.splice(0).forEach((cleanup) => cleanup())
    }
  })

  it('在預約頁點「跳至主要內容」或連到同一頁不算點了預約鈕（B11-R2）', () => {
    for (const path of ['/visit/renwu', '/visit']) {
      // 頁首預約鈕連到目前這一頁（多一個結尾斜線也算同一頁）。
      const fetch = mountAt(path, `
        <a id="skip" class="skip" href="#main"><span>跳至主要內容</span></a>
        <header data-cta-entry="header"><a id="book" href="${path}/"><span>預約</span></a></header>`)
      click('#skip')
      click('#book')
      expect(fetch).not.toHaveBeenCalled()
      cleanups.splice(0).forEach((cleanup) => cleanup())
    }
  })

  it('預約頁的外部網站按鈕記一次 cta_click_external（B11-R1）', () => {
    const fetch = mountAt('/visit/renwu', `
      <section data-cta-entry="visit_page" data-campus-key="renwu">
        <a id="external" data-booking-cta href="https://booking.example/renwu" target="_blank"><span>前往預約網站</span></a>
      </section>`)
    const anchor = document.getElementById('external')!
    anchor.addEventListener('click', (event) => reportBookingActionClick('external', 'renwu', event.currentTarget as Element, true))
    click('#external')
    expect(ctaBodies(fetch)).toEqual([{ event_type: 'cta_click_external', campus_key: 'renwu', entry: 'visit_page' }])

    // VisitForm 聯絡步驟的主要按鈕真的有標 data-booking-cta、點擊時自己回報。
    const source = read('../app/components/VisitForm.vue')
    const buttons = [...source.matchAll(/<a v-(?:else-)?if="action\.href[^"]*"[^>]*>/g)].map((m) => m[0])
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toContain('data-booking-cta')
      expect(button).toContain('@click="trackContactAction"')
    }
  })
})
