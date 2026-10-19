// @vitest-environment node
// 關於頁手機版：上翻畫冊（2026-10-19，比稿 design/about-mobile-directions-20261019/，使用者選 A、第二版「五校改高雄立體地圖」）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import AboutContent from '../app/components/AboutContent.vue'
import AboutFlipBook from '../app/components/AboutFlipBook.vue'
import AboutFlipMap from '../app/components/AboutFlipMap.vue'
import AboutMedal from '../app/components/AboutMedal.vue'
import AboutCrayon from '../app/components/AboutCrayon.vue'
import { ABOUT_MAP } from '../app/generated/about-map'
import { ANNI_MAP } from '../app/utils/anniversary/map-data'
import { FLIP_REST, liftAt, pageForHash, springUp } from '../app/utils/about-flipbook'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useId', useId)

const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const controller = read('../app/utils/about-flipbook.ts')
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
})

async function render(campuses: Campus[] = site.campuses): Promise<string> {
  const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses, page: site.aboutPage }) })
  app.component('NuxtLink', NuxtLink)
  app.component('AboutFlipBook', AboutFlipBook as Component)
  app.component('AboutFlipMap', AboutFlipMap as Component)
  app.component('AboutMedal', AboutMedal as Component)
  app.component('AboutCrayon', AboutCrayon as Component)
  app.component('AboutWholePerson', defineComponent({ render: () => null }))
  return renderToString(app)
}
// 畫冊裡的一頁（從 data-afb-page 到下一頁之前）
const pagesOf = (html: string) => {
  const book = html.slice(html.indexOf('class="afb"'), html.indexOf('class="abk"'))
  return book.split('<section').slice(1).filter((chunk) => chunk.includes('data-afb-page="'))
}
const roleOf = (chunk: string) => chunk.match(/data-afb-page="([^"]+)"/)![1]
// class 屬性裡同時有這幾個 class 的元素有幾個（Vue 合併 class 時順序不一定）
const countClass = (chunk: string, ...names: string[]) => [...chunk.matchAll(/class="([^"]*)"/g)].filter((m) => names.every((name) => m[1]!.split(' ').includes(name))).length

describe('翻頁：捲動位置 → 每一頁掀起來多少', () => {
  it('每頁前 38% 靜止讓人讀，後 62% 掀過線圈；最後一頁（封底）不掀', () => {
    expect(FLIP_REST).toBe(0.38)
    expect(liftAt(0, 0, 14)).toBe(0)
    expect(liftAt(0.38, 0, 14)).toBe(0)
    expect(liftAt(0.69, 0, 14)).toBeCloseTo(0.5, 5)
    expect(liftAt(1, 0, 14)).toBe(1)
    expect(liftAt(1, 1, 14)).toBe(0)
    expect(liftAt(13, 13, 14)).toBe(0)
    let last = -1
    for (let t = 0; t <= 2; t += 0.05) { const v = liftAt(t, 1, 14); expect(v).toBeGreaterThanOrEqual(last); last = v }
  })
  it('卡紙站起來會超過 1 一點再回來（同桌機彈簧的感覺），頭尾是 0 與 1', () => {
    expect(springUp(0)).toBe(0)
    expect(springUp(-1)).toBe(0)
    expect(springUp(1)).toBe(1)
    expect(Math.max(...Array.from({ length: 21 }, (_, i) => springUp(i / 20)))).toBeGreaterThan(1)
  })
  it('別頁連到 /about#story 等桌機錨點時，手機翻到對應那一頁', () => {
    const anchors = { story: 2, 'whole-child': 8, campuses: 13 }
    expect(pageForHash('#story', anchors)).toBe(2)
    expect(pageForHash('#campuses', anchors)).toBe(13)
    expect(pageForHash('#main', anchors)).toBeNull()
    expect(pageForHash('', anchors)).toBeNull()
  })
})

describe('伺服器端輸出：畫冊與立體書都在，各看各的寬度', () => {
  it('14 頁：封面、目次、第一章開頭、一頁一校 ×5、六圈、核心素養、引言、蠟筆畫、家長、封底', async () => {
    const pages = pagesOf(await render())
    expect(pages.map(roleOf)).toEqual(['cover', 'toc', 'story', 'ms', 'ms', 'ms', 'ms', 'ms', 'whole', 'lits', 'hope', 'hope-art', 'voices', 'back'])
  })
  it('整頁 id 不重複（桌機立體書與手機畫冊同時輸出）', async () => {
    const ids = [...(await render()).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(20)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('目次頁碼跟著頁數算：一路走來 3、全人教育 9、我們的期許 11、家長怎麼說 13，最後一列翻到封底', async () => {
    const toc = pagesOf(await render())[1]!
    expect([...toc.matchAll(/data-afb-go="(\d+)"[^>]*><span[^>]*>([^<]+)<\/span><i[^>]*><\/i><b[^>]*>([^<]+)<\/b>/g)].map((m) => [m[2], m[3]]))
      .toEqual([['一路走來', '3'], ['全人教育', '9'], ['我們的期許', '11'], ['家長怎麼說', '13'], ['五所校園', '書籤']])
    expect(toc).toContain('data-afb-go="13"')
  })
  it('一頁一校：民國年、地址讀分校資料；地圖上房子一頁多一間，浮起來上色的區只在那一區第一所那頁是新的', async () => {
    const ms = pagesOf(await render()).filter((chunk) => roleOf(chunk) === 'ms')
    expect(ms.map((chunk) => chunk.match(/data-year="(\d+)"/)![1])).toEqual(['1997', '2001', '2005', '2020', '2021'])
    expect(ms.map((chunk) => countClass(chunk, 'afb-mp-house'))).toEqual([1, 2, 3, 4, 5])
    expect(ms.map((chunk) => countClass(chunk, 'afb-mp-house', 'is-new'))).toEqual([1, 1, 1, 1, 1])
    // 崇德和明華同在左營：2005 那頁沒有新浮起來的區
    expect(ms.map((chunk) => countClass(chunk, 'afb-mp-up', 'is-new'))).toEqual([1, 1, 0, 1, 1])
    // 第一校沒有虛線，之後每頁多一段、新的那段用遮罩畫出來
    expect(ms.map((chunk) => countClass(chunk, 'afb-mp-route'))).toEqual([0, 1, 2, 3, 4])
    expect(ms.map((chunk) => (chunk.match(/<mask /g) ?? []).length)).toEqual([0, 1, 1, 1, 1])
    for (const campus of site.campuses) expect(ms.join('')).toContain(campus.address)
    expect(ms[0]).toContain('民國 86 年')
    expect(ms.every((chunk) => chunk.includes('© OpenStreetMap 貢獻者・內政部國土測繪中心'))).toBe(true)
  })
  it('分校停用（沒有分校資料）：那一年仍在沿革，但不放照片、房子與地址', async () => {
    const ms = pagesOf(await render(site.campuses.filter((c) => c.key !== 'chongde'))).filter((chunk) => roleOf(chunk) === 'ms')
    expect(ms).toHaveLength(5)
    expect(ms[2]).not.toContain('afb-vis-card')
    expect(ms[2]).not.toContain('afb-addr')
    expect(countClass(ms[2]!, 'afb-mp-house')).toBe(2)
    expect(countClass(ms[4]!, 'afb-mp-house')).toBe(4)
    // 虛線跳過停用的那一校：明華直接接國際
    expect(countClass(ms[4]!, 'afb-mp-route')).toBe(3)
  })
  it('沒有家長影片：家長那一頁與目次那一列都不出現，封底往前一頁', async () => {
    const campuses = site.campuses.map((c) => ({ ...c, testimonials: [] }))
    const pages = pagesOf(await render(campuses))
    expect(pages.map(roleOf)).not.toContain('voices')
    expect(pages[1]).not.toContain('家長怎麼說')
    expect(pages[1]).toContain('data-afb-go="12"')
  })
  it('沒有 JS 時就是上下排開的完整內容：卡紙、地圖都是畫好的樣子（動態值沒寫時是 1）', () => {
    const css = read('../app/assets/css/about-flipbook.css')
    expect(css).toContain('.afb-card{position:relative;padding:7px 7px 9px;border-radius:3px;background:var(--c,var(--yellow));transform-origin:50% 100%;transform:rotateX(calc((1 - var(--up,1)) * 86deg))')
    expect(read('../app/components/AboutFlipMap.vue')).toContain('.afb-mp-up.is-new{opacity:var(--rise,1);')
    expect(css).toContain('.afb-book{position:relative;display:grid;')
    expect(css).toContain('.afb.is-pinned .afb-book{position:sticky;')
  })
})

describe('翻頁動態（utils/about-flipbook.ts）', () => {
  it('先釘上去量每一頁，有一頁放不下就整本上下排開；寬度變了才重量', () => {
    expect(controller).toContain("root.classList.add('is-pinned')")
    expect(controller).toContain('page.scrollHeight > page.clientHeight + 1')
    expect(controller).toContain('if (innerWidth !== width) { width = innerWidth; fit() }')
  })
  it('減少動態不釘住；拆掉時清掉 html 的 scroll-snap', () => {
    expect(controller).toMatch(/if \(reducedMotion\) \{[^}]*openWhole\(\)/)
    expect(controller).toContain("html.style.scrollSnapType = ''")
  })
  it('全人教育那一頁露出一半才發 abk-open（AboutWholePerson 收到才播六圈）', () => {
    expect(controller).toContain("whole.dispatchEvent(new CustomEvent('abk-open'")
    expect(read('../app/components/AboutFlipBook.vue')).toContain('data-afb-page="whole" data-anchor="whole-child" data-spread')
  })
})

describe('高雄立體地圖資料（scripts/build-about-map.mjs → generated/about-map.ts）', () => {
  it('五校座標、湖泊、愛河和 30 週年地圖同一份（同一個座標系）', () => {
    expect(ABOUT_MAP.campuses).toEqual(ANNI_MAP.campuses)
    expect(ABOUT_MAP.lakes.map((lake) => lake.d)).toEqual(ANNI_MAP.water.map((w) => w.shape))
    expect(ABOUT_MAP.river).toBe(ANNI_MAP.river)
  })
  it('有校園的四區都在、都有區名；區界路徑不超過 6KB', () => {
    for (const name of ['三民區', '左營區', '鳥松區', '仁武區']) {
      const district = ABOUT_MAP.districts.find((item) => item.name === name)
      expect(district?.label).not.toBeNull()
      expect(district?.d).toMatch(/^M[\d .L-]+Z/)
    }
    expect(ABOUT_MAP.districts.map((item) => item.d).join('').length).toBeLessThan(6000)
  })
  it('分校資料的區名對得到地圖上的區（上色靠 campus.district）', () => {
    const names = new Set(ABOUT_MAP.districts.map((item) => item.name))
    for (const campus of site.campuses) expect(names.has(campus.district)).toBe(true)
  })
})
