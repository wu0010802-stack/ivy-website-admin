// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { Campus, EnvironmentPageContent, SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'
import { MOTION_QUERY, PIN_QUERY, dayFrame, easeInOut, heartPath, heartsFrame, heartsGeometry, heroProgress, stopShapes, stopsFrame, titleRow } from '../app/utils/environment-windows'

// 環境頁 2026-11-17「拱窗打開」（比稿 design/environment-grand-directions-20261117/ 方向 B）的守門測試：
// 伺服器輸出的結構、第四章先開哪一校、地址與下一所、水果小盤的位置、關鍵 CSS 規則、捲動敘事的純函式。
// 規則記在 DESIGN.md「環境頁拱窗打開」。改版前就有、照舊要守的裁定在 tests/environment.spec.ts。

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../app/assets/css/environment.css')
const vue = read('../app/components/EnvironmentContent.vue')
const moduleSource = read('../app/utils/environment-windows.ts')
const site = fixture as unknown as SiteContent

let route: { path: string; query: Record<string, string> } = { path: '/environment', query: {} }
let recalled: string | null = null
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())
vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))
vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRememberedCampus', () => ({ recall: (allowed: readonly string[]) => (recalled && allowed.includes(recalled) ? recalled : null), remember: () => {} }))
const NuxtLink = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })

async function render(props: { campuses?: Campus[]; page?: EnvironmentPageContent; admission?: boolean } = {}): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T04:00:00Z'))
  try {
    const app = createSSRApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page: site.environmentPage, ...props }) })
    app.component('NuxtLink', NuxtLink)
    app.component('ResponsivePicture', ResponsivePicture)
    // 模板裡的說明註解在正式建置會拿掉，測試的編譯會留著：比對前先去掉
    return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
  } finally {
    vi.useRealTimers()
  }
}
const reset = () => { route = { path: '/environment', query: {} }; recalled = null }
const selectedTab = (html: string) => [...html.matchAll(/<button id="tour-tab-([a-z]+)"[^>]*aria-selected="true"[^>]*>/g)].map((m) => m[1])
const openPanels = (html: string) => [...html.matchAll(/<div id="tour-([a-z]+)" class="[^"]*renv-tour-panel"[^>]*>/g)].filter((m) => !/\shidden/.test(m[0])).map((m) => m[1])
const panelOf = (html: string, key: string) => html.slice(html.indexOf(`<div id="tour-${key}"`), html.indexOf('<div id="tour-', html.indexOf(`<div id="tour-${key}"`) + 10) === -1 ? undefined : html.indexOf('<div id="tour-', html.indexOf(`<div id="tour-${key}"`) + 10))

describe('伺服器輸出完整內容（沒有 JS 也讀得到）', () => {
  it('元件介面不變：main#main.renv、四章的 id 與 data-track-section、#environment-title 是 h1', async () => {
    reset()
    const html = await render()
    expect(html).toMatch(/^<main id="main" tabindex="-1" class="renv" data-cta-entry="environment">/)
    expect([...html.matchAll(/<section[^>]*>/g)].map((m) => [m[0].match(/ id="([^"]+)"/)?.[1] ?? '', m[0].match(/data-track-section="([^"]+)"/)?.[1] ?? ''])).toEqual([
      ['', 'hero'], ['care', 'care'], ['spaces', 'spaces'], ['meals', 'meals'], ['campuses', 'tour'], ['', '']
    ])
    expect(html).toMatch(/<h1 id="environment-title" class="renv-h-title"><span class="renv-h-line">孩子的每一天<\/span><span class="renv-h-line">都在這裡<mark class="renv-mark">安心<\/mark>長大<\/span><\/h1>/)
    expect([...html.matchAll(/<h2 id="([a-z-]+)"/g)].map((m) => m[1])).toEqual(['care-title', 'spaces-title', 'meals-title', 'tour-title', 'next-title'])
    // 首屏四塊章節積木：章名＋一句提示，連到各章
    expect([...html.matchAll(/<a class="c-([a-z]+) renv-hb" href="#([a-z]+)"><b class="renv-index-name">([^<]+)<\/b><span class="renv-index-hint">([^<]+)<\/span>/g)].map((m) => m.slice(1))).toEqual([
      ['pink', 'care', '幼兒保育', '五顆心的照顧'], ['sage', 'spaces', '校園環境', '7 個孩子的空間'], ['mustard', 'meals', '幼兒餐點', '11 月菜單'], ['mist', 'campuses', '五所校園', '15 個校園角落']
    ])
  })

  it('每一段的內容都在 HTML 裡、照片都有 src：五顆心、五件小事、遊樂區、六個空間、五餐、五校各三個角落', async () => {
    reset()
    const html = await render()
    expect([...html.matchAll(/<li class="c-[a-z]+"><svg class="renv-heart"[\s\S]*?<\/svg>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(site.environmentPage.hearts)
    expect(html.match(/<li class="renv-ci-\d renv-ci">/g)).toHaveLength(5)
    expect(html.match(/<li class="renv-stop" data-sh="(rect|circle|arch|u|dome|leaf)" data-color="[a-z]+">/g)).toHaveLength(6)
    expect(html).toContain('<p class="renv-stop-campus">明華校</p><h3>戶外廣場</h3>')
    expect(html.match(/<li class="[^"]*renv-day-i[^"]*">/g)).toHaveLength(5)
    expect(html.match(/<li class="renv-scene">/g)).toHaveLength(15)
    // 不靠腳本填內容：沒有 inline script，也沒有等腳本才有的空殼
    expect(html).not.toMatch(/<script/)
    const images = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0])
    expect(images.length).toBeGreaterThan(40)
    expect(images.every((img) => / src="\/[^"]+"/.test(img))).toBe(true)
    // 首屏照片不延遲載入，其餘都是 lazy
    expect(images.filter((img) => /loading="eager"/.test(img))).toHaveLength(1)
    expect(images[0]).toMatch(/alt="兩個孩子在教室裡緊緊抱在一起" loading="eager" fetchpriority="high"/)
    // 完成的畫面不帶「還沒打開」的狀態：沒有 is-shut、is-armed，也沒有寫死的進度變數
    expect(html).not.toMatch(/is-shut|is-armed|--q:|--qt:|--fp:|--dp:|--on:/)
  })

  it('這一頁不放預約；結尾三個站內連結，入學資訊分頁關掉時只剩兩個', async () => {
    reset()
    const html = await render()
    expect(html).not.toMatch(/預約|href="\/visit/)
    const links = (text: string) => [...text.matchAll(/<a href="([^"]+)" class="renv-next-link c-([a-z]+)"><b>([^<]+)<\/b>/g)].map((m) => m.slice(1))
    expect(links(html)).toEqual([['/#life', 'sage', '孩子的一天'], ['/curriculum', 'mist', '特色教學'], ['/admission', 'pink', '入學資訊']])
    expect(links(await render({ admission: false })).map((link) => link[0])).toEqual(['/#life', '/curriculum'])
  })

  it('五校都沒有校園探索：第四章與它的章節積木不出現', async () => {
    reset()
    const html = await render({ campuses: site.campuses.map((campus) => ({ ...campus, tourScenes: [] })) })
    expect(html).not.toContain('id="campuses"')
    expect([...html.matchAll(/<a class="c-[a-z]+ renv-hb" href="#([a-z]+)"/g)].map((m) => m[1])).toEqual(['care', 'spaces', 'meals'])
  })
})

describe('五所校園：五扇線稿拱窗分頁（WAI-ARIA tabs）', () => {
  it('分頁與面板一一對應：id、role、aria-controls、aria-labelledby；只有選中的面板不是 hidden、只有選中的分頁在 Tab 順序裡', async () => {
    reset()
    const html = await render()
    const tabs = [...html.matchAll(/<button id="tour-tab-([a-z]+)" type="button" role="tab" class="c-([a-z]+) renv-tour-tab" data-key="([a-z]+)" aria-controls="tour-([a-z]+)" aria-selected="(true|false)" tabindex="(-?\d)"/g)].map((m) => m.slice(1))
    expect(tabs).toEqual([
      ['yihua', 'terra', 'yihua', 'yihua', 'true', '0'], ['minghua', 'mustard', 'minghua', 'minghua', 'false', '-1'], ['chongde', 'sage', 'chongde', 'chongde', 'false', '-1'],
      ['international', 'mist', 'international', 'international', 'false', '-1'], ['renwu', 'pink', 'renwu', 'renwu', 'false', '-1']
    ])
    expect(html).toContain('<div class="renv-tour-tabs" role="tablist" aria-label="選一所校園"')
    const panels = [...html.matchAll(/<div id="tour-([a-z]+)" class="c-([a-z]+) renv-tour-panel" role="tabpanel" aria-labelledby="tour-tab-([a-z]+)" tabindex="0"( hidden)?>/g)].map((m) => [m[1], m[2], m[3], Boolean(m[4])])
    expect(panels).toEqual([['yihua', 'terra', 'yihua', false], ['minghua', 'mustard', 'minghua', true], ['chongde', 'sage', 'chongde', true], ['international', 'mist', 'international', true], ['renwu', 'pink', 'renwu', true]])
    // 分頁上是線稿（淡彩在下、墨線在上）＋校名＋行政區
    expect(html).toMatch(/<span class="renv-tour-art"><img class="renv-tour-wash"[^>]*campus-line-art-yihua-wash[^>]*><img[^>]*campus-line-art-yihua-ink[^>]*><\/span><b class="renv-tab-name">義華校<\/b><span class="renv-tab-meta">三民區<\/span>/)
  })

  it('左右鍵、Home、End 換校並把焦點移過去；點分頁與方向鍵會記住，「下一所」不記', () => {
    expect(vue).toContain("({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tours.value.length - 1 } as Record<string, number>)[event.key]")
    expect(vue).toContain('void selectTab(tours.value[(target + count) % count]!.campus.key, true)')
    expect(vue).toMatch(/async function selectTab\(key: string, focus = false, remember = true\)[\s\S]*?if \(remember\) remembered\.remember\(key, tourKeys\.value\)/)
    expect(vue).toContain('@click="selectTab(tour.campus.key)"')
    expect(vue).toContain('async function showNextTour(key: string) {\n  await selectTab(key, true, false)')
    // 焦點移過去時不讓瀏覽器自己捲（「下一所」要用平滑捲動回分頁列，避免兩段捲動）
    expect(vue).toContain('?.focus({ preventScroll: true })')
    expect(vue).toContain("bar.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })")
  })

  it('一開始打開哪一校：網址 ?campus= ＞ 記住的校區（cookie ivy_campus，SSR 就讀得到）＞ 第一校；分頁與面板一致', async () => {
    reset()
    expect([selectedTab(await render()), openPanels(await render())]).toEqual([['yihua'], ['yihua']])
    recalled = 'renwu'
    let html = await render()
    expect([selectedTab(html), openPanels(html)]).toEqual([['renwu'], ['renwu']])
    route = { path: '/environment', query: { campus: 'chongde' } }
    html = await render()
    expect([selectedTab(html), openPanels(html)]).toEqual([['chongde'], ['chongde']])
    // 不認得的校名照記住的走；記住的校也不認得（或那一校沒有場景）就第一校
    route = { path: '/environment', query: { campus: 'nowhere' } }
    expect(openPanels(await render())).toEqual(['renwu'])
    recalled = 'nowhere'
    expect(openPanels(await render())).toEqual(['yihua'])
    recalled = 'yihua'
    route = { path: '/environment', query: {} }
    expect(openPanels(await render({ campuses: site.campuses.map((campus) => (campus.key === 'yihua' ? { ...campus, tourScenes: [] } : campus)) }))).toEqual(['minghua'])
    reset()
  })

  it('每校面板：校名＋地址（連到 Google 地圖、另開分頁），不再寫「X區・N 個角落」', async () => {
    reset()
    const html = await render()
    for (const campus of site.campuses) {
      expect(html).toContain(`aria-label="${campus.address}，在 Google 地圖開啟（另開分頁）"`)
      expect(panelOf(html, campus.key)).toContain(`<h3>${campus.name}</h3><a class="renv-tour-map" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(campus.address)}" target="_blank" rel="noopener noreferrer"`)
    }
    expect(html).not.toMatch(/區・\d+ 個角落/)
    expect(vue).toContain(':href="campusMapUrl(tour.campus)"')
    // 沒填地址的校退回只寫行政區，不放連不出去的連結
    const noAddress = await render({ campuses: site.campuses.map((campus) => (campus.key === 'yihua' ? { ...campus, address: '' } : campus)) })
    expect(panelOf(noAddress, 'yihua')).toContain('<h3>義華校</h3><p class="renv-tour-district">三民區</p>')
  })

  it('下一所依分頁順序、最後一所接回第一所；小窗的框是下一所的分頁色；只有一所時不放', async () => {
    reset()
    const html = await render()
    const nexts = [...html.matchAll(/<button class="renv-panel-next" type="button" style="--nc:var\(--renv-([a-z]+\));">[\s\S]*?<small>下一所<\/small><b>([^<]+)<\/b>/g)].map((m) => [m[1], m[2]])
    expect(nexts).toEqual([['mustard)', '明華校'], ['sage)', '崇德校'], ['mist)', '國際校'], ['pink)', '仁武校'], ['terra)', '義華校']])
    const one = await render({ campuses: site.campuses.map((campus) => (campus.key === 'yihua' ? campus : { ...campus, tourScenes: [] })) })
    expect(one).not.toContain('renv-panel-next')
    expect(one.match(/role="tab"/g)).toHaveLength(1)
  })

  it('角落按鈕：每個角落一顆，第一個是按下的；按了那張換到大窗（其餘照原本的順序），各校各記各的', async () => {
    reset()
    const html = await render()
    const yihua = panelOf(html, 'yihua')
    expect([...yihua.matchAll(/<button class="renv-corner" type="button" aria-pressed="(true|false)">[\s\S]*?<span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]])).toEqual([['true', '戶外廣場'], ['false', '共創教室'], ['false', '生態花園']])
    expect([...yihua.matchAll(/<span class="renv-scene-n">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['戶外廣場', '共創教室', '生態花園'])
    // 角落的小照片是裝飾（名稱就在旁邊）
    expect(yihua.match(/<button class="renv-corner"[^>]*>(?:<picture[^>]*><source[^>]*>)?<img[^>]* alt(?:="")?[ >]/g)).toHaveLength(3)
    expect(vue).toContain('return [...tour.scenes.filter((scene) => scene.key === lead), ...tour.scenes.filter((scene) => scene.key !== lead)]')
    expect(vue).toContain('leads.value = { ...leads.value, [tour.campus.key]: key }')
  })

  it('角落數不是三個也排得下：1 個只有大窗、沒有角落按鈕；2 個、4 個以上右邊一排（--rows＝其餘的張數）', async () => {
    reset()
    const scenes = site.campuses[0]!.tourScenes
    const withCount = (count: number) => site.campuses.map((campus) => (campus.key === 'yihua' ? { ...campus, tourScenes: Array.from({ length: count }, (_, i) => ({ ...scenes[i % scenes.length]!, key: `scene-${i}` })) } : campus))
    const list = (html: string) => panelOf(html, 'yihua').match(/<ul class="renv-scenes" style="--rows:(\d+);" data-count="(\d)">/)?.slice(1)
    const one = await render({ campuses: withCount(1) })
    expect(list(one)).toEqual(['1', '1'])
    expect(panelOf(one, 'yihua')).not.toContain('renv-corners')
    expect(list(await render({ campuses: withCount(2) }))).toEqual(['1', '2'])
    expect(list(await render({ campuses: withCount(3) }))).toEqual(['2', '3'])
    expect(list(await render({ campuses: withCount(4) }))).toEqual(['3', '4'])
    const six = await render({ campuses: withCount(6) })
    expect(list(six)).toEqual(['5', '4'])
    expect(panelOf(six, 'yihua').match(/<li class="renv-scene">/g)).toHaveLength(6)
    expect(css).toContain('.renv-scenes{grid-area:scenes;display:grid;grid-template-columns:minmax(0,1fr) 240px;grid-template-rows:repeat(var(--rows,2),minmax(0,1fr));gap:18px;height:448px;padding-bottom:8px}')
    expect(css).toContain('.renv-scenes[data-count="1"]{grid-template-columns:minmax(0,1fr)}')
    expect(css).toContain('.renv-scenes[data-count="4"]{height:auto;min-height:448px;grid-template-rows:repeat(var(--rows,3),minmax(104px,1fr))}')
  })

  it('沒有腳本時分頁按了沒反應：五校的面板全部攤開', () => {
    expect(css).toContain('.renv-tour-panel[hidden]{display:none}')
    expect(css).toContain('@media (scripting:none){.renv-tour-panel[hidden]{display:grid}}')
  })
})

describe('一天五餐：圓點小路穿過盤子、盤子上是食物圖示', () => {
  it('水果是小盤：第 2、4 餐（照位置，不比對文字——後台改了餐名也一樣）', async () => {
    reset()
    const small = (html: string) => [...html.matchAll(/<li class="([^"]*renv-day-i[^"]*)">/g)].map((m) => /\bis-small\b/.test(m[1]!))
    expect(small(await render())).toEqual([false, true, false, true, false])
    const renamed = { ...site.environmentPage, meals: site.environmentPage.meals.map((meal, i) => ({ ...meal, name: `第 ${i + 1} 餐`, note: '改過的備註' })) }
    expect(small(await render({ page: renamed }))).toEqual([false, true, false, true, false])
    expect(vue).toContain('small: i === 1 || i === 3')
  })

  it('每一餐：時間、盤子（圖示照順序：吐司、香蕉、飯碗、蘋果、杯子）、餐名、備註；五餐五個積木色', async () => {
    reset()
    const html = await render()
    const items = [...html.matchAll(/<li class="c-([a-z]+)(?: is-small)? renv-day-i"><time class="renv-day-t" lang="en">([^<]*)<\/time><span class="renv-plate"><svg viewBox="0 0 30 30" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><\/span><b class="renv-day-name">([^<]+)<\/b><span class="renv-day-n">([^<]+)<\/span>/g)].map((m) => m.slice(1))
    expect(items).toEqual([['terra', '08:30', '早餐', '早餐美語'], ['mustard', '10:00', '香蕉', '每日兩蔬果之一'], ['sage', '11:40', '午餐', '廚房每天現煮'], ['pink', '12:00', '蘋果', '每日兩蔬果之二'], ['mist', '15:30', '點心', '西米露、玉米粥']])
    // 「看 N 月菜單」與封面都連到營養餐點書當月那一頁（mealBookLink），另開分頁
    expect(html).toMatch(/<a class="renv-btn c-mustard" href="https:\/\/online\.flipbuilder\.com\/[^"]+#p=21" target="_blank" rel="noopener">看 11 月菜單<svg/)
    expect(html).toMatch(/<a class="renv-book-c" href="https:\/\/online\.flipbuilder\.com\/[^"]+#p=21" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">/)
  })

  it('圓點小路是純 CSS：沒捲到就是全亮（--dp、--on 預設 1），盤子外圍一圈底色不讓圓點貼到盤緣', () => {
    expect(css).toContain('.renv-day-rail i{position:absolute;inset:0;color:var(--white);clip-path:inset(0 calc((1 - var(--dp,1)) * 100%) 0 0)}')
    expect(css).toMatch(/\.renv-day-i\{--on:1;/)
    expect(css).toMatch(/\.renv-plate\{[^}]*box-shadow:0 10px 0 var\(--cs\),0 0 0 10px var\(--renv-deep\),0 10px 0 10px var\(--renv-deep\);opacity:var\(--on\);/)
    expect(css).toContain('.renv-day-i.is-small .renv-plate{--ps:clamp(106px,12vw,124px)}')
    // 手機：小路改成直的
    expect(css).toMatch(/@media \(max-width:900px\)\{[\s\S]*\.renv-day-rail i\{clip-path:inset\(0 0 calc\(\(1 - var\(--dp,1\)\) \* 100%\) 0\)\}/)
  })
})

describe('版面規則（environment.css）', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('預設就是完成的畫面：首屏的進度變數預設 0（打開完成），桌機的起始畫面由媒體查詢直接成立、不等腳本', () => {
    expect(rules).toContain('.renv-hero-stage{--q:0;--qt:0;position:relative;display:flex;flex-direction:column;justify-content:center;width:var(--renv-cw);min-height:var(--renv-sh);margin-inline:auto;padding:26px 0}')
    // 釘住的條件：寬 ≥1100、高 ≥600、沒開減少動態（和腳本的 PIN_QUERY／MOTION_QUERY 同一組數字）
    const pin = rules.match(/@media \(min-width:1100px\) and \(min-height:600px\) and \(prefers-reduced-motion:no-preference\)\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(PIN_QUERY).toBe('(min-width: 1100px) and (min-height: 600px)')
    expect(MOTION_QUERY).toBe('(prefers-reduced-motion: no-preference)')
    expect(pin).toMatch(/\.renv:not\(\.renv-still\) \.renv-hero-stage\{\s*--q:1;--qt:1;/)
    expect(pin).toContain('position:sticky;top:var(--renv-hh);height:var(--renv-sh);min-height:0;')
    // 起始畫面的每一條規則都不靠腳本加的 class（html.renv-*）
    expect(pin).not.toMatch(/html\.renv-/)
    expect(pin.match(/\.renv:not\(\.renv-still\)/g)!.length).toBeGreaterThanOrEqual(10)
    // 拱窗＝大畫面裁出中間偏右的一段，整幅右移 --tx；--q 從 1 到 0 就是打開
    expect(pin).toContain('.renv:not(.renv-still) .renv-hw{transform:translateX(calc(var(--tx) * var(--q)))}')
    expect(pin).toMatch(/\.renv-hw-photo\{overflow:visible;border-radius:0;background:none;clip-path:inset\(0 calc\(var\(--fw\) \* \.16 \* var\(--q\)\) 0 calc\(var\(--fw\) \* \.5 \* var\(--q\)\) round /)
    // 標題收成一列的位移由腳本量（--lx／--ly／--ks），起始畫面（--qt:1）時整個 transform 是原地不動
    expect(pin).toContain('transform:translate(calc(var(--lx,0px) * (1 - var(--qt))),calc(var(--ly,0px) * (1 - var(--qt)))) scale(calc(1 - (1 - var(--ks,1)) * (1 - var(--qt))))')
  })

  it('腳本加的只有釘住的額外高度與舞台：每一段釘住不超過 1.5 個螢幕高', () => {
    expect(rules).toContain('html.renv-pin .renv-hero{height:calc(var(--renv-sh) + 105vh)}')
    expect(rules).toContain('html.renv-pin .renv-stops-sec{height:calc(var(--renv-sh) + 145vh);padding:0}')
    for (const [, extra] of rules.matchAll(/html\.renv-pin [^{]*\{height:calc\(var\(--renv-sh\) \+ (\d+)vh\)/g)) expect(Number(extra)).toBeLessThanOrEqual(150)
    expect(rules).toContain('html.renv-pin .renv-stops-stage{position:sticky;top:var(--renv-hh);display:grid;place-items:center;height:var(--renv-sh)}')
    // 六個空間沒有腳本時是三欄兩列的完整版面（不是只看得到一站的舞台）
    expect(rules).toContain('.renv-stops{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:64px 32px}')
    expect(rules).toContain('.renv-stops-side,.renv-stops-nav{display:none}')
  })

  it('「還沒打開」的狀態都掛在 html.renv-fx 底下，沒有腳本就不會出現', () => {
    expect(rules).toContain('html.renv-fx .renv-door.is-shut .renv-ph{clip-path:inset(0 46% 0 46%)}')
    expect(rules).toContain('html.renv-fx .renv-hearts.is-armed .renv-hlids{display:block}')
    expect(rules).toContain('.renv-hlids{display:none;')
    // 遊樂區的窗：--fp 沒寫就是 1（完成）
    expect(rules).toMatch(/html\.renv-fx \.renv-feat-win::before,html\.renv-fx \.renv-feat-win \.renv-ph\{border-radius:0;clip-path:inset\(0 calc\(20% \* \(1 - var\(--fp,1\)\)\) round /)
    for (const [selector] of rules.matchAll(/[^{}]*\.is-(?:shut|armed)[^{]*(?=\{)/g)) expect(selector.trim()).toMatch(/^html\.renv-fx /)
  })

  it('跳到章節的落點只靠 html 的 scroll-padding-top：.renv-section 不疊 scroll-margin-top', () => {
    expect(rules).toContain('.renv-section{position:relative}')
    expect(rules).not.toContain('scroll-margin')
  })

  it('只動 transform／opacity／clip-path；減少動態時沒有轉場；頁面自己不開 scroll-behavior', () => {
    const transitions = [...rules.matchAll(/transition:([^;}]+)/g)].map((m) => m[1]!).filter((value) => value !== 'none' && !value.startsWith('none '))
    expect(transitions.length).toBeGreaterThan(5)
    // 逐項看轉場的屬性（逗號在 var(…) 裡的不算分隔）：位移、透明度、裁切，加上按鈕的底色與陰影
    for (const value of transitions) for (const part of value.split(/,(?![^()]*\))/)) expect(part.trim().split(' ')[0]).toMatch(/^(transform|opacity|clip-path|background-color|box-shadow)$/)
    expect(rules).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*\.renv \*,\.renv \*::before,\.renv \*::after\{transition:none !important\}\s*\}/)
    expect(rules).not.toContain('scroll-behavior')
    expect(rules).not.toMatch(/@keyframes|animation:/)
  })

  it('900 以下是手機與平板的簡化版：不釘住、單欄；首屏是一扇拱窗（不做整張照片壓字），四塊章節積木兩列', () => {
    const narrow = rules.slice(rules.indexOf('@media (max-width:900px){'))
    expect(narrow).toContain('.renv-hero-stage{justify-content:flex-start;min-height:0;padding:22px 0 34px}')
    expect(narrow).toContain('.renv-h-slot{width:min(100%,460px);height:clamp(250px,calc(var(--renv-sh) - 326px),480px);margin:0 auto 26px}')
    expect(narrow).toContain('.renv-hw-photo{inset:10px;border-radius:999px 999px 0 0}')
    expect(narrow).toContain('.renv-index{grid-auto-flow:row;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 10px;padding-bottom:8px}')
    expect(narrow).toContain('.renv-stops{grid-template-columns:minmax(0,1fr);gap:54px}')
    // 手機的照片本來就直排：不放角落切換
    expect(narrow).toContain('.renv-corners{display:none}')
    // 觸控目標至少 44px
    expect(narrow).toContain('.renv-hb{min-height:66px;')
    expect(rules).toContain('.renv-sn{display:grid;place-items:center;width:48px;height:48px;')
    expect(rules).toMatch(/\.renv-tour-map\{display:inline-flex;align-items:center;gap:8px;min-height:44px;/)
    expect(rules).toMatch(/\.renv-corner\{[^}]*min-height:56px;/)
  })

  it('內文不小於 15px：字級沒有低於 .95rem 的', () => {
    const sizes = [...rules.matchAll(/font(?:-size)?:[^;}]*?(\d*\.?\d+)rem/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(30)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.95)
  })

  it('舊瀏覽器（iOS 15）：不用容器查詢與容器單位；color-mix、svh 先寫舊寫法再用 @supports 換；subgrid 有後備；媒體查詢不用範圍寫法', () => {
    expect(rules).not.toMatch(/@container|container-type|\dcq[whib]\b/)
    expect(rules).not.toMatch(/@media[^{]*[<>]/)
    // color-mix 只出現在 @supports 裡，外面先給了現成的色票
    expect(rules.match(/color-mix\(/g)).toHaveLength(2)
    expect(rules).toContain('@supports (color:color-mix(in oklch,red,blue)){.renv-tour-tab{background:color-mix(in oklch,var(--c) 34%,var(--renv-paper))}}')
    expect(rules).toMatch(/\.renv-tour-tab\{[^}]*background:var\(--ivy-env-tint-mist\);/)
    expect(rules).toContain('--renv-sh:calc(100vh - var(--renv-hh));')
    expect(rules).toContain('@supports (height:100svh){.renv{--renv-sh:calc(100svh - var(--renv-hh))}}')
    expect(rules).toMatch(/@supports not \(grid-template-rows:subgrid\)\{\s*\.renv-ci\{display:block\}\s*html:not\(\.renv-pin\) \.renv-stop\{display:block\}\s*\}/)
    // :has() 只有 body:has(.renv)（15.4 起支援）；clip-path:path() 由腳本判斷支援與否
    expect(rules.match(/:has\(/g)).toHaveLength(1)
    expect(moduleSource).toContain("CSS.supports?.('clip-path', \"path('M0 0L1 0L1 1Z')\")")
  })
})

describe('捲動敘事的模組（utils/environment-windows.ts）', () => {
  it('只在瀏覽器動態載入，載入失敗內容照常；後台即時預覽不釘住；卸載時拆掉', () => {
    expect(vue).not.toMatch(/^import (?!type )[^\n]*environment-windows/m)
    expect(vue).toContain("const loaded = await import('~/utils/environment-windows').catch(() => null)")
    expect(vue).toContain("const still = route.path === '/preview' && isLivePreview(route.query)")
    expect(vue).toContain('windows = loaded.createEnvironmentWindows(root.value, { pin: !still })')
    expect(vue).toContain('onBeforeUnmount(() => { disposed = true; windows?.destroy(); windowsModule?.endSmoothHashJump() })')
    expect(vue).toContain("watch([() => props.page, () => props.campuses], () => windows?.refresh(), { deep: true, flush: 'post' })")
  })

  it('後台即時預覽（/preview?embed=1&live=1）：根元素帶 renv-still，CSS 的桌機起始畫面不成立', async () => {
    route = { path: '/preview', query: { embed: '1', live: '1' } }
    expect(await render()).toMatch(/^<main id="main" tabindex="-1" class="(renv renv-still|renv-still renv)" data-cta-entry="environment">/)
    // 不是即時預覽的草稿預覽（整頁看）照常
    route = { path: '/preview', query: { page: 'environment' } }
    expect(await render()).toMatch(/^<main id="main" tabindex="-1" class="renv" /)
    reset()
  })

  it('不攔截捲動：scroll 監聽是 passive、用 requestAnimationFrame 寫樣式，沒有 wheel／touchmove 監聽也沒有 preventDefault', () => {
    expect(moduleSource).toContain("addEventListener('scroll', request, { passive: true })")
    expect(moduleSource).toContain('raf = requestAnimationFrame(tick)')
    expect(moduleSource).not.toMatch(/'wheel'|'touchmove'|preventDefault|overflow\s*=/)
    // matchMedia 不用範圍寫法（Safari 16.4 以前不認得）
    expect(moduleSource).not.toMatch(/matchMedia\(\s*[`'"][^`'"]*[<>]/)
  })

  it('IntersectionObserver 的 root 指定 document（在預覽的 iframe 裡不指定會量到外層視窗）', () => {
    expect(moduleSource).toContain('new IntersectionObserver(callback, { ...init, root: document })')
    expect(moduleSource.match(/new IntersectionObserver\(/g)).toHaveLength(2)
  })

  it('destroy 拆乾淨：監聽、observer、排程、<html> 上的 class；門全部打開', () => {
    const destroy = moduleSource.slice(moduleSource.indexOf('    destroy() {'))
    for (const expected of ["removeEventListener('scroll', request)", "removeEventListener('resize', onResize)", "removeEventListener('load', relayout)", "query.removeEventListener?.('change', onChange)", "root.removeEventListener('click', onStopsNav)", 'cancelAnimationFrame(raf)', 'cancelAnimationFrame(resizeFrame)', 'doors?.disconnect()', 'warm?.disconnect()', "html.classList.remove('renv-fx', 'renv-pin')", 'track.off?.()']) expect(destroy).toContain(expected)
  })

  it('「還沒打開」只套在啟動當下位於視窗下方的東西（已經在畫面裡的不動，hydrate 後第一個畫面不變）', () => {
    expect(moduleSource).toContain('if (!target || (frame.tops.get(target) ?? 0) < innerHeight) return false')
    expect(moduleSource).toContain('if (door.getBoundingClientRect().top < innerHeight) continue')
  })
})

describe('捲動敘事的純函式', () => {
  it('首屏：一開始標題是大字、拱窗關著；標題先收，收到六成以後窗才開始打開；捲到底完全打開', () => {
    expect(heroProgress(0, 0)).toEqual({ qt: 1, q: 1, open: 0 })
    // 標題還沒收（t=0）：不管捲多少窗都不開，兩者不會疊在一起
    expect(heroProgress(0, 0.9).q).toBe(1)
    expect(heroProgress(0.5, 0.9).q).toBe(1)
    // 標題收好、捲到 14% 以前窗不動，84% 以後完全打開
    expect(heroProgress(1, 0.14).q).toBe(1)
    expect(heroProgress(1, 0.49).q).toBeCloseTo(0.5, 5)
    expect(heroProgress(1, 0.84)).toEqual({ qt: 0, q: 0, open: 1 })
    expect(heroProgress(1, 1)).toEqual({ qt: 0, q: 0, open: 1 })
    // 單調：捲得越多開得越多
    const steps = Array.from({ length: 21 }, (_, i) => heroProgress(1, i / 20).q)
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!)
  })

  it('標題收成一列：每一行移到標題列、行與行之間空半個字；縮到收好之後的字級', () => {
    // 兩行：起始字級 80、收好 40；第一行寬 480（6 字）、第二行寬 640（8 字），疊在 y 200 與 293
    const two = titleRow([{ x: 0, y: 200, w: 480 }, { x: 0, y: 293, w: 640 }], 80, 40, 26, 1200)
    expect(two.scale).toBe(0.5)
    expect(two.moves).toEqual([{ x: 0, y: -174 }, { x: 260, y: -267 }])
    // 三行九個字：排成一列是 27 字＋兩個半字的間隔＝28 個字寬，比版心寬就再縮到剛好放得下
    const three = titleRow([0, 1, 2].map((i) => ({ x: 0, y: 100 + i * 93, w: 720 })), 80, 43, 26, 1139)
    expect(three.scale).toBeCloseTo(1139 / 28 / 80, 6)
    const last = three.moves[2]!
    expect(last.x + 720 * three.scale).toBeCloseTo(1139, 3)
    expect(three.moves.map((move) => move.y)).toEqual([-74, -167, -260])
    expect(titleRow([], 80, 40, 0, 1200)).toEqual({ scale: 1, moves: [] })
  })

  it('五顆心：一開始五顆大愛心蓋在照片上、心形窗比蓋子小；捲完蓋子落到照片下方變小愛心、照片整張露出', () => {
    const g = heartsGeometry(1200, 513)
    expect(g.count).toBe(5)
    expect(g.s).toBeCloseTo(180, 5)
    expect(g.small).toBe(30)
    expect(g.yEnd).toBe(555)
    const start = heartsFrame(g, 0)
    expect(start.names).toBe(1)
    expect(start.lids.map((lid) => Math.round(lid.x))).toEqual([120, 360, 600, 840, 1080])
    expect(start.lids.every((lid) => lid.k === g.s && Math.abs(lid.y - 0.38 * 513) < 1e-9)).toBe(true)
    // 心形窗一開始是蓋子的 0.96 倍：蓋子完全蓋住窗，照片露不出來
    expect(start.clip).toBe(`path('${[120, 360, 600, 840, 1080].map((x) => heartPath(x, 0.38 * 513, 0.96 * g.s)).join('')}')`)
    const end = heartsFrame(g, 1)
    expect(end).toEqual({ names: 0, lids: [120, 360, 600, 840, 1080].map((x) => ({ x, y: 555, k: 30 })), clip: 'none', tint: 0 })
    // 色片（2026-11-20）：蓋子落下去時窗裡還是那顆心的顏色（不露出照片的碎片），五扇窗相連之後才褪成照片
    expect(start.tint).toBe(1)
    expect(heartsFrame(g, 0.16).tint).toBe(1)
    expect(heartsFrame(g, 0.31).tint).toBeGreaterThan(0.4)
    expect(heartsFrame(g, 0.46).tint).toBe(0)
    // 最大的心形窗蓋得住整張照片：每顆心負責自己那一欄（寬 240），最遠的角是左右下角
    const reach = 0.457 * g.kmax * g.s
    expect(reach).toBeGreaterThanOrEqual(120 + 513 * (1 - 0.38))
    // 手機（窗窄於 600）：心大一點、蓋子小一點
    const narrow = heartsGeometry(347, 231)
    expect(narrow.s).toBeCloseTo(0.165 * 347, 5)
    expect([narrow.small, narrow.yEnd]).toEqual([24, 263])
    expect(heartPath(100, 50, 100)).toBe('M100.0 95.7L58.6 54.3A29.3 29.3 0 0 1 100.0 12.9A29.3 29.3 0 0 1 141.4 54.3Z')
  })

  it('六個空間的舞台：六種形狀都落在窗裡；相鄰兩站之間形狀內插、照片交疊、文字一出一進', () => {
    const table = stopShapes(800, 631)
    expect(Object.keys(table)).toEqual(['rect', 'circle', 'arch', 'u', 'dome', 'leaf'])
    for (const [top, right, bottom, left] of Object.values(table)) {
      for (const inset of [top, right, bottom, left]) expect(inset).toBeGreaterThanOrEqual(0)
      expect(left + right).toBeLessThan(800)
      expect(top + bottom).toBeLessThan(631)
    }
    expect(table.circle).toEqual([0, 84.5, 0, 84.5, 315.5, 315.5, 315.5, 315.5])
    // 半圓貼著底（2026-11-20）：六個形狀的底邊都在窗的底線上，換站時不會浮在半空
    expect(table.dome.slice(0, 4)).toEqual([231, 0, 0, 0])
    for (const shape of Object.values(table)) expect(shape[2]).toBe(0)
    const shapes = ['rect', 'circle', 'arch', 'u', 'dome', 'leaf'].map((name) => table[name]!)
    const first = stopsFrame(shapes, 0)
    expect(first.clip).toBe('inset(0.0px 0.0px 0.0px 0.0px round 32.0px 32.0px 32.0px 32.0px)')
    expect([first.from, first.to, first.mix, first.active]).toEqual([0, 1, 0, 0])
    expect(first.items.map((item) => [item.o, item.to])).toEqual([[1, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]])
    // 兩站正中間：形狀是兩者的一半、兩張照片交疊，兩邊的文字都不顯示（前一站已淡出、下一站還沒進來）
    const mid = stopsFrame(shapes, 0.5)
    expect(mid.clip).toBe('inset(0.0px 42.3px 0.0px 42.3px round 173.8px 173.8px 173.8px 173.8px)')
    expect(mid.mix).toBe(easeInOut(0.5))
    expect(mid.items.slice(0, 2)).toEqual([{ o: 1, to: 0, ty: -16 }, { o: 0.5, to: 0, ty: 16 }])
    expect(mid.active).toBe(1)
    // 最後一站：超出範圍也停在最後一站
    const end = stopsFrame(shapes, 9)
    expect([end.from, end.to, end.mix, end.active]).toEqual([4, 5, 1, 5])
    expect(end.items[5]).toEqual({ o: 1, to: 1, ty: 0 })
    expect(end.items[4]!.to).toBe(0)
    expect(stopsFrame([], 2).items).toEqual([])
    expect(stopsFrame([table.rect], 3).active).toBe(0)
  })

  it('一天五餐：圓點小路從左亮到右，盤子一盤一盤上桌；捲完全部到位', () => {
    expect(dayFrame(0, 5)).toEqual({ rail: 0, on: [0, 0, 0, 0, 0] })
    const mid = dayFrame(0.5, 5)
    expect(mid.rail).toBeCloseTo(0.46 / 0.86, 6)
    expect(mid.on.slice(0, 2)).toEqual([1, 1])
    expect(mid.on[2]!).toBeGreaterThan(0.9)
    expect(mid.on.slice(3)).toEqual([0, 0])
    expect(dayFrame(1, 5)).toEqual({ rail: 1, on: [1, 1, 1, 1, 1] })
  })
})
