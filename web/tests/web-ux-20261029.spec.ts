// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, ref, watch, type App } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import { publicCopy } from '../app/utils/public-copy'
import { visitSeo } from '../app/utils/seo'

// 2026-10-29 前台評析修正：預約步驟進網址、來電校區卡片直接撥號、選單五校連到首頁、
// 原型來源說明換成署名、月曆錯誤只標一顆、手機選日期後捲到場次、關於頁分頁字級、預約頁 SEO。
// happy-dom 換掉了全域 URL，路徑用 node:path 解析。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const site = fixture as unknown as SiteContent

for (const [name, fn] of Object.entries({ computed, ref, watch })) vi.stubGlobal(name, fn)
const { default: VisitDatePicker } = await import('../app/components/VisitDatePicker.vue')

let app: App | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

async function mountPicker(props: { modelValue: string; invalid: boolean }) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(VisitDatePicker, { counts: { '2026-11-02': 2, '2026-11-03': 1, '2026-11-09': 2 }, describedby: 'err', ...props }) })
  app.mount(host)
  await nextTick()
  return host
}

describe('預約月曆：沒選日期就送出只標一顆', () => {
  it('沒選日期：只有這個月第一個開放日帶 aria-invalid，紅框畫在整個月曆', async () => {
    const host = await mountPicker({ modelValue: '', invalid: true })
    const invalid = host.querySelectorAll('input[aria-invalid="true"]')
    expect(invalid).toHaveLength(1)
    expect((invalid[0] as HTMLInputElement).value).toBe('2026-11-02')
    expect(host.querySelector('fieldset')!.classList.contains('is-invalid')).toBe(true)
  })

  it('已選的日子在這個月：標它；沒有錯誤時一顆都不標', async () => {
    let host = await mountPicker({ modelValue: '2026-11-09', invalid: true })
    expect([...host.querySelectorAll<HTMLInputElement>('input[aria-invalid="true"]')].map((input) => input.value)).toEqual(['2026-11-09'])
    app!.unmount(); app = null; document.body.innerHTML = ''
    host = await mountPicker({ modelValue: '', invalid: false })
    expect(host.querySelectorAll('input[aria-invalid]')).toHaveLength(0)
    expect(host.querySelector('fieldset')!.classList.contains('is-invalid')).toBe(false)
  })

  it('不再逐格描紅', () => {
    expect(read('../app/components/VisitDatePicker.vue')).not.toMatch(/\.visit-day[^{]*input\[aria-invalid=true\]/)
  })
})

describe('預約步驟跟著網址走', () => {
  const page = read('../app/pages/visit/[[key]].vue')
  const form = read('../app/components/VisitForm.vue')

  it('/visit 與 /visit/<校> 是同一個頁面元件（換網址不重掛），頁內換步驟不讓路由捲到頁首', () => {
    expect(existsSync(resolve(here, '../app/pages/visit/index.vue'))).toBe(false)
    expect(existsSync(resolve(here, '../app/pages/visit/[key].vue'))).toBe(false)
    expect(page).toContain("key: 'visit'")
    expect(page).toContain('scrollToTop: (to, from) => to.name !== from.name')
    expect(page).toContain(':route-campus="campus?.key ?? \'\'"')
    // 頁內換到不存在的校區也回 404（setup 只跑一次）。
    expect(page).toMatch(/watch\(campusKey, \(key\) => \{ if \(key && !campus\.value\) showError\(NOT_FOUND\) \}\)/)
  })

  it('下一步換到 /visit/<校>、更換校區回 /visit，第幾步由網址決定', () => {
    expect(form).toContain("const step = computed<1 | 2>(() => props.routeCampus ? 2 : 1)")
    expect(form).toContain('await router.push(`/visit/${key}`)')
    expect(form).toContain("await router.push('/visit')")
    expect(form).not.toMatch(/step\.value = [12]/)
    // 同一校的結果頁「重新選擇場次」是按鈕：連到目前網址點了不會動。
    expect(form).toContain('<button v-if="selectedCampus" type="button" class="visit-inline-link" @click="bookAgain">重新選擇場次</button>')
  })

  it('填到一半的資料暫存在分頁，預約成功就清掉', () => {
    expect(form).toContain("const DRAFT_KEY = 'ivy-visit-draft'")
    expect(form).toContain('sessionStorage.setItem(DRAFT_KEY')
    expect(form).toMatch(/submitted\.value = true\n\s*clearDraft\(\)/)
    expect(form).toContain('watch([form, selectedVisitDate, selectedSlotId], saveDraft, { deep: true })')
  })

  it('選好日期後把場次捲進畫面（已經看得到就不動）', () => {
    expect(form).toContain('@update:model-value="revealSlots"')
    expect(form).toContain('ref="slotListRef" class="visit-slot-list"')
    expect(form).toContain("first.getBoundingClientRect().bottom <= window.innerHeight")
  })

  it('來電校區的選校卡直接給撥號連結，號碼取法同首頁五校卡', () => {
    expect(form).toContain('const cta = campusVisitCta(campus, action)')
    expect(form).toMatch(/<a v-if="campusCall\(campus\)" class="visit-campus-mode is-call" :href="campusCall\(campus\)!\.href" :data-campus-key="campus\.key"/)
    expect(read('../app/assets/css/visit-booking.css')).toMatch(/\.visit-campus-mode\.is-call::before \{content:'';position:absolute;inset:-10px -6px\}/)
  })
})

describe('選單「找到你的校園」', () => {
  const header = read('../app/components/SiteHeader.vue')
  const template = header.replace(/<!--[\s\S]*?-->/g, '')

  it('五校是連到首頁五校區塊那一校的連結，滑過與聚焦仍預覽參觀專線', () => {
    expect(header).toContain(':href="`/?campus=${c.key}#campuses`"')
    expect(header).toContain('@pointerenter="onCampusPointerEnter($event, c.key)"')
    expect(header).toContain('@focus="menuCampusKey = c.key"')
    expect(header).not.toContain('@click="menuCampusKey = c.key"')
  })

  it('沒有的社群帳號與電話不出現，不寫「待提供」', () => {
    expect(template).not.toContain('待提供')
    expect(template).not.toContain('待園方提供')
    expect(read('../app/assets/css/studio.css')).not.toContain('#menu-campuses button')
  })
})

describe('原型的來源說明拿掉', () => {
  // 10-29 先換成署名，10-30 使用者要版面乾淨，署名也拿掉，只留孩子的一天的作息提醒
  it('一字不差的原文才換；園方改過的照園方的', () => {
    const out = publicCopy(site)
    const texts = [out.curriculumPage.heroNotice, out.curriculumPage.gallerySource, out.curriculumPage.dailySource, out.curriculumPage.beliefSource, out.environmentPage.heroNotice]
    for (const text of texts) expect(text).toBe('')
    expect(out.dayExperience.note).toBe('各校、各班作息略有不同，以園所安排為準。')
    const custom = publicCopy({ ...site, environmentPage: { ...site.environmentPage, heroNotice: '園方自訂的提醒，取自某處。' } })
    expect(custom.environmentPage.heroNotice).toBe('園方自訂的提醒，取自某處。')
  })
})

describe('預約頁 SEO', () => {
  const origin = 'https://ivy.example'
  const yihua = site.campuses.find((campus) => campus.key === 'yihua') as Campus

  it('/visit：站名結尾、有描述與 canonical，描述不寫「線上預約」', () => {
    const seo = visitSeo(site, origin)
    expect(seo.title).toBe(`預約校園參觀｜${site.siteMeta.brandName}`)
    expect(seo.canonical).toBe(`${origin}/visit`)
    expect(seo.description).toContain('義華、明華')
    expect(seo.description).not.toContain('線上預約')
    expect(seo.image).toMatch(/^https:\/\/ivy\.example\//)
  })

  it('/visit/<校>：標題帶校名，描述有地址與電話，canonical 不帶網址參數', () => {
    const seo = visitSeo(site, origin, yihua)
    expect(seo.title).toBe(`預約參觀義華校｜${site.siteMeta.brandName}`)
    expect(seo.description).toContain(yihua.address)
    expect(seo.description).toContain(yihua.phone)
    expect(seo.canonical).toBe(`${origin}/visit/yihua`)
  })

  it('預約頁照舊 noindex，不經過收錄開關', () => {
    expect(read('../app/pages/visit/[[key]].vue')).toContain("robots: 'noindex, nofollow'")
  })
})

describe('關於頁手機卡紙的分頁字級', () => {
  const css = read('../app/assets/css/about-sheets.css')

  it('字級 12–13px，不再隨寬度縮到 12px 以下', () => {
    expect(css).toContain('font:700 clamp(.75rem,calc((var(--ams-slot) - 6px) / 5),.8125rem)/1 var(--font-head)')
    expect(css).not.toContain('/ 5.2')
  })

  it('352px 以下五字章名折兩行', () => {
    expect(css).toMatch(/@media \(max-width:351px\)\{\n\s*\.ams-tab\{white-space:normal;text-align:center;text-wrap:balance;line-height:1\.05\}/)
  })
})
