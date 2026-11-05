// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { AdmissionContent as Admission, Campus, SiteContent } from '../app/types/site-content'
import { ADMISSION_FAQ } from '../app/utils/admission-faq'
import AdmissionContent from '../app/components/AdmissionContent.vue'

// 2026-11-03 入學頁「收退費辦法」整章收進「常見問題」：補助那題預設打開、退費收成一題。
// 用伺服器渲染（同官網 SSR）畫出 AdmissionContent；Nuxt 的自動匯入在單元測試裡沒有，這裡補上，印章換成空元件。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', () => undefined)

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

async function render(admission: Admission, campuses?: Campus[]): Promise<string> {
  const app = createSSRApp({ render: () => h(AdmissionContent as Component, { admission, campuses }) })
  app.component('NuxtLink', NuxtLink)
  app.component('PassportStamp', defineComponent({ render: () => null }))
  return renderToString(app)
}
const questionCount = (html: string) => (html.match(/class="ap-faq-q"/g) ?? []).length

describe('常見問題資料（utils/admission-faq.ts）', () => {
  const items = ADMISSION_FAQ.flatMap((group) => group.items)

  it('錨點不重複；補助那題沿用舊章節的 #fees、預設打開', () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    const fees = items.find((item) => item.id === 'fees')
    expect(fees).toMatchObject({ slot: 'allowance', open: true })
    // 2026-11-04 TA 檢視：轉園與學期中入學合成第一題、預設打開，題目下列各校電話
    expect(items.filter((item) => item.open).map((item) => item.id)).toEqual(['faq-transfer', 'fees'])
    expect(ADMISSION_FAQ[0]!.items[0]).toMatchObject({ id: 'faq-transfer', slot: 'phones', open: true })
  })

  it('滿 2 歲有名額就能入學，不寫死學期中入學的編班；不寫死哪幾校能線上預約（2026-11-04）', () => {
    const answer = (id: string) => items.find((item) => item.id === id)!.a.join('')
    expect(answer('faq-age')).toContain('滿 2 歲、有名額就可以入學')
    expect(answer('faq-age')).not.toContain('當年 9 月 1 日前滿 2 歲')
    expect(answer('faq-visit')).not.toMatch(/義華|明華|崇德|國際|仁武/)
    expect(answer('faq-pickup')).toContain('30 分鐘')
  })

  it('這頁不放預約參觀：延伸連結不連到 /visit；文案不用破折號', () => {
    expect(items.map((item) => item.link?.href).filter(Boolean).filter((href) => href!.startsWith('/visit'))).toEqual([])
    expect(JSON.stringify(ADMISSION_FAQ)).not.toMatch(/—|--/)
  })
})

describe('入學頁常見問題（AdmissionContent.vue）', () => {
  it('內建內容：收退費整章不在了，退費條款收在常見問題的一題裡、預設收合', async () => {
    const html = await render(site.admission, site.campuses)
    expect(html).toContain('<section id="faq"')
    expect(html).not.toContain('class="ap-refunds"')
    expect(html).not.toContain('・收退費辦法')
    expect(html).not.toContain('<b>收退費辦法</b>')
    expect(html).toMatch(/<details id="fees" open/)
    expect(html).toMatch(/<details id="faq-refund">/)
    const refund = html.slice(html.indexOf('id="faq-refund"'))
    for (const clause of site.admission.refunds) expect(refund).toContain(`<h4>${clause.title}</h4>`)
    expect(questionCount(html)).toBe(ADMISSION_FAQ.reduce((sum, group) => sum + group.items.length, 0))
  })

  it('轉園題排第一、預設打開，題目下就列各校電話（2026-11-04）', async () => {
    const html = await render(site.admission, site.campuses)
    expect(html).toMatch(/<details id="faq-transfer" open/)
    const transfer = html.slice(html.indexOf('id="faq-transfer"'), html.indexOf('id="faq-age"'))
    expect(transfer).toContain('ap-faq-phones')
    for (const campus of site.campuses) expect(transfer).toContain(`href="tel:${campus.phone}"`)
    expect(html.indexOf('id="faq-transfer"')).toBeLessThan(html.indexOf('id="faq-age"'))
    // 11-03 上線的 #faq-midterm 舊連結落到轉園題
    expect(read('../app/components/AdmissionContent.vue')).toContain("const FAQ_ALIASES: Record<string, string> = { 'faq-midterm': 'faq-transfer' }")
  })

  it('目錄最後一章是常見問題，小字寫題數', async () => {
    const html = await render(site.admission, site.campuses)
    expect(html).toContain('<b>常見問題</b>')
    expect(html).toContain(`轉園、補助、退費等 ${questionCount(html)} 題`)
  })

  it('「怎麼預約參觀」列各校電話（可直接撥），沒有往 /visit 的連結', async () => {
    const html = await render(site.admission, site.campuses)
    for (const campus of site.campuses) expect(html).toContain(`href="tel:${campus.phone}"`)
    expect(html).not.toMatch(/href="\/visit/)
    const bare = await render(site.admission)
    expect(bare).not.toContain('ap-faq-phones')
  })

  it('後台把津貼、補助、退費都清空時，那兩題拿掉，題數跟著變', async () => {
    const empty = { ...site.admission, allowance: [], subsidies: [], refunds: [] }
    const html = await render(empty, site.campuses)
    expect(html).not.toContain('id="fees"')
    expect(html).not.toContain('id="faq-refund"')
    expect(html).toContain(`轉園、補助、退費等 ${questionCount(html)} 題`)
    expect(questionCount(html)).toBe(ADMISSION_FAQ.reduce((sum, group) => sum + group.items.length, 0) - 2)
  })

  it('補助券（後台有填才出現）放在補助那題', async () => {
    const html = await render({ ...site.admission, subsidies: [{ by: '高雄市政府', amount: '1,000', unit: '元／月', who: '測試身分' }] }, site.campuses)
    const fees = html.slice(html.indexOf('id="fees"'), html.indexOf('id="faq-tuition"'))
    expect(fees).toContain('class="ap-coupon"')
    expect(fees).toContain('測試身分')
  })

  it('新生準備整章被清空時，「看新生準備」連結一起拿掉', async () => {
    const html = await render({ ...site.admission, phases: [], uniformWeek: [], pickupNotes: [], registrationNotes: [] }, site.campuses)
    expect(html).not.toContain('id="newcomer"')
    expect(html).not.toContain('href="#newcomer"')
  })

  it('手機還沒輸入生日不留空白章框', () => {
    const css = read('../app/assets/css/admission-passport.css')
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(mobile).toContain('.ap-stampzone:not(.stamped) { display: none; }')
  })
})
