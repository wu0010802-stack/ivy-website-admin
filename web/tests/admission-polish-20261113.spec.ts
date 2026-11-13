// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { academicYear, taipeiYmd } from '../app/utils/admission-classes'
import AdmissionContent from '../app/components/AdmissionContent.vue'

// 2026-11-13 入學頁細修：生日改年／月／日三個下拉、班別按鈕的名稱、標題括號、問答展開補間、列印。
// 規則見 DESIGN.md「入學頁細修（2026-11-13）」。章序、大標、首屏、文案都沒動（11-09 那輪的做法不再提）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const site = fixture as unknown as SiteContent
const source = read('../app/components/AdmissionContent.vue')
const css = read('../app/assets/css/admission-passport.css')
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

describe('入學頁細修 2026-11-13（AdmissionContent.vue）', () => {
  let app: App | null = null
  let host: HTMLElement
  beforeEach(async () => {
    // 減少動態：不載 gsap，印章直接出現（這裡換成空元件）
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(AdmissionContent as Component, { admission: site.admission, campuses: site.campuses }) })
    app.component('NuxtLink', NuxtLink)
    app.component('PassportStamp', defineComponent({ render: () => null }))
    app.config.warnHandler = () => {}
    app.mount(host)
    await nextTick()
  })
  afterEach(() => { app?.unmount(); app = null; host.remove() })

  const select = (id: string) => host.querySelector<HTMLSelectElement>(`#${id}`)!
  const options = (id: string) => [...select(id).options].filter((option) => !option.disabled)
  async function choose(id: string, value: number) {
    const el = select(id)
    const index = [...el.options].findIndex((option) => option.textContent!.trim().startsWith(String(value)))
    expect(index, `${id} 找不到 ${value}`).toBeGreaterThan(0)
    el.selectedIndex = index
    el.dispatchEvent(new Event('change'))
    await nextTick()
  }

  it('生日是年／月／日三個下拉，不是原生日期欄；年份民國在前、西元在括號，從明年列到已上小學', () => {
    expect(host.querySelector('input[type="date"]')).toBeNull()
    expect(host.querySelector('.ap-birth legend')!.textContent).toBe('寶貝的生日')
    for (const [id, name] of [['birthday-year', '出生年'], ['birthday-month', '出生月'], ['birthday-day', '出生日']] as const) {
      expect(select(id).getAttribute('aria-label')).toBe(name)
      // 不讓瀏覽器把家長自己的生日自動填進來
      expect(select(id).getAttribute('autocomplete')).toBe('off')
    }
    const today = taipeiYmd()
    const years = options('birthday-year').map((option) => option.textContent!.trim())
    expect(years[0]).toBe(`${today.year + 1 - 1911} 年（${today.year + 1}）`)
    const oldest = academicYear(today) + 1911 - 8
    expect(years.at(-1)).toBe(`${oldest - 1911} 年（${oldest}）`)
    expect(options('birthday-month')).toHaveLength(12)
    expect(options('birthday-day')).toHaveLength(31)
  })

  it('三格都選了才出答案；先選 31 日再換成小月，日那一格清掉重選', async () => {
    const answer = () => host.querySelector('.ap-answer')!
    const year = academicYear(taipeiYmd()) + 1911 - 3
    await choose('birthday-year', year - 1911)
    await choose('birthday-month', 5)
    expect(answer().classList.contains('empty')).toBe(true)
    await choose('birthday-day', 31)
    expect(answer().classList.contains('empty')).toBe(false)
    expect(answer().textContent).toContain('寶貝讀')

    await choose('birthday-month', 2)
    expect(options('birthday-day').length).toBeLessThanOrEqual(29)
    expect(select('birthday-day').selectedIndex).toBe(0)
    expect(answer().classList.contains('empty')).toBe(true)
  })

  it('班別按鈕的名稱就是按鈕裡的字（不另寫 aria-label），選了生日多報「寶貝」與「今年在這一格」', async () => {
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('.ap-slot button')]
    expect(buttons()).toHaveLength(5)
    for (const button of buttons()) expect(button.hasAttribute('aria-label')).toBe(false)
    // 還沒選生日：學年度那一行是空的，不報給報讀軟體
    expect(buttons()[0]!.querySelector('.ap-slot-year')!.getAttribute('aria-hidden')).toBe('true')

    const year = academicYear(taipeiYmd()) + 1911 - 3
    await choose('birthday-year', year - 1911)
    await choose('birthday-month', 5)
    await choose('birthday-day', 20)
    const current = buttons().find((button) => button.textContent!.includes('今年在這一格'))!
    expect(current.querySelector('.ap-slot-year')!.hasAttribute('aria-hidden')).toBe(false)
    expect(current.textContent!.replace(/\s+/g, '')).toMatch(/^\d{2}小班3歲寶貝\d{3}學年度（今年在這一格）$/)
    expect(buttons().filter((button) => button.textContent!.includes('今年在這一格'))).toHaveLength(1)
  })

  it('新生準備標題的括號各包一層（左右對稱），整段不換行；只有一點的須知不編號', () => {
    const title = host.querySelector('.ap-phase h3')!
    expect(title.textContent).toBe(site.admission.phases[0]!.title)
    const parens = [...title.querySelectorAll('.ap-keep > .ap-paren')].map((paren) => paren.textContent)
    expect(parens).toEqual(['（', '）'])
    expect(css).toContain('.ap-keep { text-spacing-trim: space-all; white-space: nowrap; }')
    expect(css).toContain('.ap-paren { margin-inline: -.25em; }')
    expect(css).toContain('.ap-clauses li:only-child .ap-clause-mark { display: none; }')
  })

  it('首屏那一句一句一段，字一個都沒少', () => {
    const phrases = [...host.querySelectorAll('.ap-notice .ap-phrase')].map((phrase) => phrase.textContent)
    expect(phrases.join('')).toBe(site.admission.notice)
    for (const phrase of phrases) expect(phrase).toMatch(/[；。！？]$/)
    // 線上那一句（白話版）切成三段
    expect('學費各校不同，歡迎直接問校區；育兒津貼依最新政策。學期中有名額也能轉園插班。'.match(/[^；。！？]+[；。！？]*/g)).toEqual([
      '學費各校不同，歡迎直接問校區；', '育兒津貼依最新政策。', '學期中有名額也能轉園插班。'
    ])
  })

  it('列印：印之前把收合的問答與對照表攤開，印完收回原狀', () => {
    const closed = () => host.querySelectorAll('details:not([open])').length
    const before = closed()
    expect(before).toBeGreaterThan(0)
    window.dispatchEvent(new Event('beforeprint'))
    expect(closed()).toBe(0)
    window.dispatchEvent(new Event('afterprint'))
    expect(closed()).toBe(before)
  })
})

describe('入學頁細修 2026-11-13（樣式）', () => {
  it('問答與對照表展開有高度補間，只在支援 ::details-content 的瀏覽器；減少動態時關掉', () => {
    const block = css.slice(css.indexOf('@supports selector(::details-content)'))
    expect(block).toContain('interpolate-size: allow-keywords')
    expect(block).toMatch(/details::details-content, \.ap-table::details-content \{ block-size: 0;[^}]*transition: block-size/)
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.ap-faq details::details-content, .ap-table::details-content { transition: none; }')
  })

  it('生日下拉 16px 以上（iOS 點了不放大）、焦點框葉綠、欄寬不夠時年份自己一列', () => {
    expect(css).toMatch(/\.ap-select select \{[^}]*min-height: 54px;[^}]*font: inherit;/)
    expect(css).toContain('.ap-select select:focus-visible { outline: 3px solid var(--leaf); outline-offset: 3px; }')
    expect(css).toMatch(/@container \(width < 330px\) \{\s*\.ap-birth-row \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}\s*\.ap-select-year \{ grid-column: 1 \/ -1; \}/)
  })

  it('列印樣式只收掉入學頁旁邊的頁首頁尾；裝飾、目錄、生日試算不印', () => {
    const print = css.slice(css.indexOf('@media print'), css.indexOf('@media (forced-colors: active)'))
    expect(print).toContain('.header:has(~ main.ap), main.ap ~ .footer { display: none; }')
    for (const hidden of ['.ap-band-host', '.ap-rosette-host', '.ap-toc', '.ap-stamp-host', '.ap-datapage']) expect(print).toContain(hidden)
    expect(print).toContain('.ap-faq-a, .ap-faq-body { display: block; }')
  })

  it('首屏那一句照句子折行、矮視窗首屏留白收一點；這一輪沒有動章序與大標', () => {
    expect(css).toMatch(/\.ap \.ap-notice \{[^}]*text-wrap: balance;/)
    expect(css).toContain('.ap-phrase { display: inline-block; max-width: 100%; }')
    expect(source).toContain("admission.value.notice.match(/[^；。！？]+[；。！？]*/g)")
    expect(css).toContain('@media (min-width: 761px) and (max-height: 640px)')
    const order = ['id="process"', 'id="classes"', 'id="newcomer"', 'id="faq"'].map((id) => source.indexOf(id))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    for (const heading of ['從參觀到開學<br>一步一步來', '每走一步<br>就蓋一個章', '寶貝何時入學？', '新生入學二部曲', '爸媽常問的事']) expect(source).toContain(heading)
  })
})
