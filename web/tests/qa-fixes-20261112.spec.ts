import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { googleCalendarUrl, icsContent, visitCalendarEvent } from '../app/utils/visit-calendar'

// 2026-11-12 前台 QA 輕度問題的修正。伺服器與純函式的行為測試在各自的 spec（url-canonical、admin-host、
// security-headers、client-error…）；這裡放只能鎖原始碼寫法的幾條。
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

describe('L1：頁面 404 的 HTTP 原因片語是 Not Found，不是 Server Error', () => {
  // HTTP 原因片語只能是 ASCII；畫面上的中文由 error.vue 自己寫，不讀 statusMessage。
  const pages: Array<[string, string]> = [
    ['app/pages/admission.vue', "createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面' })"],
    ['app/pages/anniversary.vue', "createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面' })"],
    ['app/pages/privacy.vue', "createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面' })"],
    ['app/pages/news/[id].vue', "createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這則消息' })"],
    ['app/pages/visit/[[key]].vue', "const NOT_FOUND = { statusCode: 404, statusMessage: 'Not Found', message: '找不到這個校區' }"]
  ]
  it.each(pages)('%s 的 404 帶 statusMessage', (path, snippet) => {
    expect(read(path)).toContain(snippet)
  })

  it('app/ 底下所有 404 的 createError／showError 都帶 statusMessage', () => {
    for (const [path] of pages) {
      const source = read(path)
      const notFounds = source.match(/statusCode: 404[^}]*/g) ?? []
      expect(notFounds.length, path).toBeGreaterThan(0)
      for (const found of notFounds) expect(found, path).toContain("statusMessage: 'Not Found'")
    }
  })

  it('錯誤頁的中文文案不讀 statusMessage（換成英文片語也不影響畫面）', () => {
    const error = read('app/error.vue')
    expect(error).not.toMatch(/error\.(statusMessage|message)/)
    expect(error).toContain("notFound ? '找不到這一頁' : '網站暫時無法顯示'")
  })
})

describe('L2：robots.txt、sitemap.xml、llms.txt 的 HEAD 和 GET 一樣回 200（只是沒有本文）', () => {
  // Nitro 的 *.get.ts 只配 GET，HEAD 會 404；監測與爬蟲常用 HEAD 探活。.head.ts 直接重新匯出 GET 的 handler，
  // 閘門與標頭只有一份（h3 對 HEAD 不送本文）。
  it.each(['robots.txt', 'sitemap.xml', 'llms.txt'])('%s.head.ts 重新匯出同名的 .get.ts', (name) => {
    expect(read(`server/routes/${name}.head.ts`)).toContain(`export { default } from './${name}.get'`)
  })
})

describe('L29：「前一天會提醒」只描述有 VALARM 的 .ics', () => {
  const campus = { name: '義華校', address: '高雄市三民區義華路68號', phone: '07-392-8366' }
  const slot = { slot_date: '2026-10-03', start_time: '09:30:00', end_time: '10:30:00' }

  it('事實：只有 .ics 帶前一天的提醒，Google 日曆的 render 連結沒有提醒參數', () => {
    const event = visitCalendarEvent(campus, slot)!
    expect(icsContent(event, 'uid-1')).toContain('TRIGGER:-P1D')
    expect(googleCalendarUrl(event)).not.toMatch(/alarm|remind|valarm|trigger/i)
  })

  it('說明文字點名「加入手機行事曆」那顆，不再對整排按鈕說前一天會提醒', () => {
    const component = read('app/components/VisitCalendarActions.vue')
    expect(component).toContain('<p class="visit-calendar-note">行程只寫分校、地址與電話，不含孩子與家長資料；用「加入手機行事曆」存的行程，前一天會提醒。</p>')
    expect(component).not.toContain('不含孩子與家長資料；前一天會提醒。')
    // 被點名的按鈕文字要真的存在
    expect(component).toContain('加入手機行事曆<small>iPhone、Outlook</small>')
  })
})

describe('L32：停用 JS 時，預約頁不停在「載入中」、首頁手機版關於段展得開', () => {
  // 預約頁只用 CSS 的 @media (scripting: none)：Chrome 實測（390／700 寬），head 裡 noscript 樣式把 [hidden] 的備援說明改成
  // display:block，在 container-type 底下算得出 display:block 卻沒有版面框（重新載入後才發生），備援說明整塊不出現。
  // 首頁關於段也只用媒體查詢：公開頁 CSP 只放行登記過的 inline 內容，head 的 noscript 樣式會被 script-csp.spec.ts 擋下。
  // 都不在 template 放含子元素的 <noscript>：JS 開啟時瀏覽器把 noscript 內容當文字解析，Vue SSR 的 hydration 會對不上。
  const visit = read('app/components/VisitForm.vue')
  const about = read('app/components/AboutSection.vue')
  const visitCss = read('app/assets/css/visit-booking.css')

  it('兩個元件的 template 裡都沒有 <noscript> 元素；預約頁不用 head noscript 樣式', () => {
    for (const source of [visit, about]) expect(source.split('<template>').slice(1).join('<template>')).not.toMatch(/<noscript[\s>]/)
    expect(visit).not.toContain('noscript:')
  })

  it('預約頁：停用 JS 時藏起「正在讀取可預約場次」，改顯示平常隱藏的備援說明（來電預約）', () => {
    expect(visitCss.replace(/\s+/g, '')).toContain('@media(scripting:none){.visit-slots-loading{display:none!important}.visit-slots-nojs[hidden]{display:block!important}}')
    // 備援區塊平常是 hidden（JS 開啟的人看不到），沿用「沒有場次」那塊的外觀與致電鈕
    expect(visit).toContain('<div class="visit-slots-empty visit-slots-nojs" hidden>')
    const block = visit.slice(visit.indexOf('<div class="visit-slots-empty visit-slots-nojs" hidden>'))
    const end = block.indexOf('</div>\n', block.indexOf('visit-contact-actions'))
    const fallback = block.slice(0, end)
    expect(fallback).toContain('目前無法在這個頁面選擇參觀場次，歡迎直接來電安排。')
    expect(fallback).toContain(':href="`tel:${selectedCampus.phone}`"')
    // 載入中那行本身不動：JS 開啟時照舊
    expect(visit).toContain('<p v-if="slotsPending" class="visit-status visit-slots-loading" role="status">正在讀取可預約場次…</p>')
  })

  it('首頁關於段：停用 JS 時內文全部展開、藏起沒有作用的「閱讀完整介紹」', () => {
    const rules = '.belief-more{display:inline!important}.belief-paras{display:grid!important}.belief-copy-toggle{display:none!important}'
    // 不用 head 的 noscript 樣式：公開頁 CSP 只放行登記過的 inline 內容（script-csp.spec.ts）。
    expect(about).not.toContain('noscript: [')
    expect(about).toContain(`@media (scripting:none){${rules}}`)
    // 和列印時展開的規則同一套（兩條規則的先後順序一樣：.belief-paras 在 .belief-more 之後才會是 grid）
    expect(about).toContain('@media print{.belief-more{display:inline!important}.belief-paras{display:grid!important}.belief-copy-toggle{display:none}}')
  })
})

// L26：單校消息結尾的入口原本一律寫「預約○○校參觀」，暫停線上預約（只能來電）的校區在首頁五校卡寫的是
// 「致電○○校預約參觀」。和五校卡用同一個判斷（campusVisitCta）：只在瀏覽器讀那一校的預約方式，讀到之前與
// 讀不到時照舊連預約頁。
describe('L26：單校消息的參觀入口跟著那一校的預約方式', () => {
  const article = read('app/components/NewsArticleContent.vue')

  it('字樣與連結取自 campusVisitCta（和首頁五校卡同一套）', async () => {
    const { campusVisitCta } = await import('../app/utils/booking-action')
    const campus = { key: 'minghua', name: '明華校', phone: '07-555-0000' }
    expect(campusVisitCta(campus, { kind: 'paused', href: null, message: null } as never)).toMatchObject({ kind: 'phone', href: 'tel:07-555-0000', label: '致電明華校預約參觀' })
    expect(campusVisitCta(campus, { kind: 'form', href: null, message: null } as never)).toMatchObject({ kind: 'visit', href: '/visit/minghua' })
    expect(campusVisitCta(campus, undefined)).toMatchObject({ kind: 'visit' })
    expect(article).toContain('campusVisitCta(campus.value, bookingAction.value)')
    expect(article).toContain('resolveBookingAction(key, await loadCampusBooking(nuxtApp, key))')
  })

  it('只在瀏覽器讀（不擋 SSR）；全校消息不讀', () => {
    expect(article).toMatch(/onMounted\(async \(\) => \{\s*const key = campus\.value\?\.key\s*if \(!key\) return/)
  })

  it('致電是 tel: 連結；LINE／外部網站另開分頁；其餘照舊連預約頁', () => {
    expect(article).toContain(`<a v-else-if="visitCta.kind === 'phone'" class="np-book" :href="visitCta.href">{{ visitCta.label }}`)
    expect(article).toContain(`<a v-else class="np-book" :href="visitCta.href" target="_blank" rel="noopener noreferrer">{{ visitCta.label }}`)
    expect(article).toContain(`<NuxtLink v-if="!visitCta || visitCta.kind === 'visit'" class="np-book" :to="campus ? \`/visit/\${campus.key}\` : '/visit'">預約{{ campus ? campus.name : '校園' }}參觀`)
  })
})
