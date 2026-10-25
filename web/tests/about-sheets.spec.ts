// @vitest-environment node
// 關於頁手機版：卡紙疊起來（2026-10-25，比稿 design/about-redesign-directions-20261025/，使用者選手機 A、第二版；取代上翻畫冊）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import AboutContent from '../app/components/AboutContent.vue'
import AboutSheets from '../app/components/AboutSheets.vue'
import AboutMedal from '../app/components/AboutMedal.vue'
import AboutCrayon from '../app/components/AboutCrayon.vue'
import { coverAt, medalProgress, sheetForHash } from '../app/utils/about-sheets'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useId', useId)

const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const controller = read('../app/utils/about-sheets.ts')
const component = read('../app/components/AboutSheets.vue')
const css = read('../app/assets/css/about-sheets.css')
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
})

async function render(campuses: Campus[] = site.campuses): Promise<string> {
  const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses, page: site.aboutPage }) })
  app.component('NuxtLink', NuxtLink)
  app.component('AboutSheets', AboutSheets as Component)
  app.component('AboutMedal', AboutMedal as Component)
  app.component('AboutCrayon', AboutCrayon as Component)
  app.component('AboutWholePerson', defineComponent({ render: () => null }))
  return renderToString(app)
}
// 手機那一疊（.ams 到桌機 .abk 之前）
const mobileOf = (html: string) => html.slice(html.indexOf('class="ams"'), html.indexOf('class="abk"'))
const sheetsOf = (html: string) => mobileOf(html).split('<section').slice(1).filter((chunk) => chunk.includes('data-ams-sheet'))
const idOf = (chunk: string) => chunk.match(/id="([^"]+)"/)![1]
const deckOf = (html: string) => { const m = mobileOf(html); return m.slice(m.indexOf('class="ams-deck"'), m.indexOf('</nav>', m.indexOf('class="ams-deck"'))) }
const tabsOf = (chunk: string) => [...chunk.matchAll(/data-ams-go="(\d+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])

describe('疊起來：捲動位置 → 被蓋住多少、紀念章走到哪一校', () => {
  it('下一張的頂端從視窗底滑到它停住的位置：0 → 1；已經停好或更上面都是 1', () => {
    expect(coverAt(844, 844, 120)).toBe(0)
    expect(coverAt(900, 844, 120)).toBe(0)
    expect(coverAt(482, 844, 120)).toBeCloseTo(0.5, 5)
    expect(coverAt(120, 844, 120)).toBe(1)
    expect(coverAt(-300, 844, -300)).toBe(1)
  })
  it('讀線經過幾校（小數）：每一列頂端過了讀線再往下 140px 算走完', () => {
    expect(medalProgress([500, 700, 900], 338)).toBe(0)
    expect(medalProgress([268, 700], 338)).toBe(0.5)
    expect(medalProgress([-400, -100, 198, 900], 338)).toBe(3)
  })
  it('別頁連到 /about#story 等桌機錨點時，手機捲到對應那一張', () => {
    const anchors = { story: 0, 'whole-child': 1, campuses: 4 }
    expect(sheetForHash('#story', anchors)).toBe(0)
    expect(sheetForHash('#campuses', anchors)).toBe(4)
    expect(sheetForHash('#main', anchors)).toBeNull()
    expect(sheetForHash('', anchors)).toBeNull()
  })
})

describe('伺服器端輸出：卡紙疊與立體書都在，各看各的寬度', () => {
  it('五張卡紙：一路走來、全人教育、我們的期許、家長怎麼說、五所校園，各對到桌機錨點', async () => {
    const sheets = sheetsOf(await render())
    expect(sheets.map(idOf)).toEqual(['about-m-story', 'about-m-whole-child', 'about-m-hope', 'about-m-voices', 'about-m-campuses'])
    expect(sheets.map((chunk) => chunk.match(/data-anchor="([^"]+)"/)![1])).toEqual(['story', 'whole-child', 'hope', 'voices', 'campuses'])
  })
  it('整頁 id 不重複（桌機立體書與手機卡紙疊同時輸出）', async () => {
    const ids = [...(await render()).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(20)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('目次＝整疊的分頁（章名讀後台，結尾是五所校園）；頂端分頁列是同一組，報讀器與鍵盤不重複', async () => {
    const html = await render()
    expect(tabsOf(deckOf(html))).toEqual([['0', '一路走來'], ['1', '全人教育'], ['2', '我們的期許'], ['3', '家長怎麼說'], ['4', '五所校園']])
    const m = mobileOf(html)
    const band = m.slice(m.indexOf('data-ams-band'), m.indexOf('class="ams-cover"'))
    expect(band).toContain('aria-hidden="true"')
    expect(band.match(/tabindex="-1"/g)).toHaveLength(5)
    expect(m).toContain('--tabs:5')
  })
  it('一路走來：一列一校，民國年、地址讀分校資料；紀念章在第一張卡紙', async () => {
    const story = sheetsOf(await render())[0]!
    expect([...story.matchAll(/data-ams-row[^>]*data-year="(\d+)"/g)].map((m) => m[1])).toEqual(['1997', '2001', '2005', '2020', '2021'])
    expect(story).toContain('民國 86 年')
    for (const campus of site.campuses) expect(story).toContain(campus.address)
    expect(story).toContain('data-medal')
  })
  it('分校停用（沒有分校資料）：那一年仍在沿革，但不放照片與地址，結尾也少一條書籤', async () => {
    const sheets = sheetsOf(await render(site.campuses.filter((c) => c.key !== 'chongde')))
    const rows = sheets[0]!.split('data-ams-row').slice(1)
    expect(rows).toHaveLength(5)
    expect(rows[2]).toContain('ams-blank')
    expect(rows[2]).not.toContain('ams-addr')
    expect(rows[2]).toContain('2005 年')
    expect(sheets.at(-1)!.match(/<li[\s>]/g)).toHaveLength(4)
  })
  it('沒有家長影片：家長那張與那個分頁都不出現，五所校園往前一格', async () => {
    const html = await render(site.campuses.map((c) => ({ ...c, testimonials: [] })))
    expect(sheetsOf(html).map(idOf)).not.toContain('about-m-voices')
    expect(tabsOf(deckOf(html))).toEqual([['0', '一路走來'], ['1', '全人教育'], ['2', '我們的期許'], ['3', '五所校園']])
    expect(mobileOf(html)).toContain('--tabs:4')
  })
  it('全人教育那張帶 data-spread（AboutWholePerson 收 abk-open）；期許那張帶 data-hope（蠟筆畫塗上）', async () => {
    const sheets = sheetsOf(await render())
    expect(sheets[1]).toContain('data-spread')
    expect(sheets[2]).toContain('data-hope')
  })
})

describe('沒有 JS／減少動態：上下排開的完整內容', () => {
  it('sticky、每張至少一個畫面高、只裁下緣都只在 .ams.is-stacked 底下', () => {
    expect(css).toContain('.ams.is-stacked .ams-sheet{position:sticky;top:min(var(--ams-top),calc(100svh - var(--h,100svh)));')
    expect(css).toContain('min-height:calc(100svh - var(--ams-top));clip-path:inset(-60px -40px 0 -40px)')
    expect(css).toMatch(/\.ams-sheet\{position:relative;/)
  })
  it('頂端分頁列預設不出現（is-on 才出現），紀念章預設停在章名旁（疊起來才 sticky）', () => {
    expect(css).toMatch(/\.ams-band\{[^}]*visibility:hidden;opacity:0/)
    expect(css).toContain('.ams-dock{position:relative;z-index:3;height:0}')
    expect(css).toContain('.ams.is-stacked .ams-dock{position:sticky;')
  })
  it('901px 以上整疊隱藏（桌機是立體書）', () => {
    expect(css).toContain('@media (min-width:901px){.ams{display:none}}')
  })
  it('顏色走 token（括號遮罩裡的 black 只是形狀）', () => {
    const body = css.replace(/url\("data:[^"]*"\)/g, '')
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()|oklch\(/i)
  })
})

describe('動態（utils/about-sheets.ts）', () => {
  it('減少動態不疊（上下排開），蠟筆畫直接畫好；forced-colors 不啟動', () => {
    expect(controller).toContain('const stacked = !reducedMotion')
    expect(controller).toContain("root.classList.toggle('is-stacked', stacked)")
    expect(controller).toContain("if (reducedMotion) hope?.classList.add('is-opened', 'is-grown')")
    expect(component).toContain("if (matchMedia('(forced-colors: active)').matches) return")
  })
  it('卡紙高用 ResizeObserver 寫回 --h（後台即時預覽改字也會重量）', () => {
    expect(controller).toContain("sheet.style.setProperty('--h', `${sheet.offsetHeight}px`)")
  })
  it('全人教育一開始就發 abk-open（AboutWholePerson 自己看可見才播六圈）', () => {
    expect(controller).toContain("whole?.dispatchEvent(new CustomEvent('abk-open'")
  })
  it('讀到別章就停掉家長影片；平板跨過 900px 時建立或拆掉', () => {
    expect(component).toContain("onSheet: (i) => { if (i !== indexOf('voices')) playing.value = false }")
    expect(component).toContain("matchMedia('(max-width: 900px)')")
  })
})
