// 關於頁第三章「我們的期許」孩子的蠟筆畫（2026-10-19，比稿 design/about-hope-picturebook-directions-20261019/ 選 B）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readFileSync as readGenerated } from 'node:fs'
import { ABOUT_CRAYON as art } from '../app/generated/about-crayon'
// @ts-expect-error 產生器是純 JS 腳本（repo 根目錄 scripts/），沒有型別
import { buildAboutCrayon, moduleSource, OUTPUT } from '../../scripts/about-crayon/build.mjs'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../app/assets/css/about.css')
const component = read('../app/components/AboutContent.vue')
const crayon = read('../app/components/AboutCrayon.vue')
const popup = read('../app/utils/about-popup.ts')
const shared = read('../app/utils/about-content.ts')
const sheets = read('../app/components/AboutSheets.vue')
const sheetsCss = read('../app/assets/css/about-sheets.css')
const sheetsHouse = sheets.slice(sheets.indexOf('data-hope'), sheets.indexOf('<!-- 家長怎麼說'))
const hope = component.slice(component.indexOf('<section id="hope"'), component.indexOf('<!-- 第四章'))
const chapterCss = css.slice(css.indexOf('/* ---------- 第三章'), css.indexOf('/* ---------- 第四章'))
// 蠟筆線的顏色與動畫在 AboutCrayon 自己的 scoped 樣式（about.css 是 AboutContent 的 scoped 樣式，管不到子元件裡的 path）
const crayonCss = crayon.slice(crayon.indexOf('<style scoped>'))
type Stroke = { k?: string, c?: string, d: string, a?: string }
const strokes = Object.values(art).flat() as Stroke[]

describe('蠟筆畫路徑：建置時算好', () => {
  it('generated/about-crayon.ts 和產生器的輸出一致（改了 build.mjs 要重跑）', () => {
    expect(readGenerated(OUTPUT, 'utf8')).toBe(moduleSource())
    expect(JSON.parse(JSON.stringify(buildAboutCrayon()))).toEqual(art)
  })
  it('路徑資料不超過 32KB（伺服器端兩頁各印一次色帶與草地）', () => {
    expect(JSON.stringify(art).length).toBeLessThan(32_000)
  })
  it('元件直接讀 JSON、不在瀏覽器裡算（各瀏覽器 Math.sin 尾數不同會讓 hydration 對不上）', () => {
    expect(crayon).toContain("from '../generated/about-crayon'")
    expect(crayon).not.toMatch(/Math\.(sin|cos|random)/)
  })
})

describe('蠟筆畫顏色都走 token', () => {
  it('每一個顏色代號在 AboutCrayon 的樣式都有 .abk-crayon .is-<代號>', () => {
    const colors = [...new Set(strokes.filter((s) => s.k !== 'cut').map((s) => s.c))]
    expect(colors.length).toBeGreaterThan(10)
    for (const c of colors) expect(crayonCss).toMatch(new RegExp(`\\.abk-crayon \\.is-${c}[,{]`))
  })
  it('第三章樣式不寫色碼（括號遮罩裡的 black 只是形狀）', () => {
    const body = (chapterCss + crayonCss).replace(/url\("data:[^"]*"\)/g, '')
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()|oklch\(/i)
    expect(chapterCss).toContain('.abk-quote::before,.abk-quote p:last-child::after{content:\'\';background:var(--studio-orange);')
  })
})

describe('跨頁與手機', () => {
  it('上緣色帶、下緣草地是同一張跨頁圖：左頁露左半（xMin）、右頁露右半（xMax）', () => {
    expect(hope.match(/name="sky" view-box="0 0 1240 260" align="xMinYMin slice"/g)).toHaveLength(1)
    expect(hope.match(/name="sky" view-box="0 0 1240 260" align="xMaxYMin slice"/g)).toHaveLength(1)
    expect(hope.match(/name="grass" view-box="0 0 1240 300" align="xMinYMax slice"/g)).toHaveLength(1)
    expect(hope.match(/name="grass" view-box="0 0 1240 300" align="xMaxYMax slice"/g)).toHaveLength(1)
    // 濾鏡只有一份，放在 main 底下、桌機立體書與手機卡紙疊外面（display:none 裡的濾鏡有的瀏覽器不套）
    expect(shared.match(/id="abk-wax"/g)).toHaveLength(1)
    expect(component.match(/v-html="WAX_FILTER"/g)).toHaveLength(1)
    expect(component.indexOf('v-html="WAX_FILTER"')).toBeLessThan(component.indexOf('<div ref="root" class="abk"'))
    expect(component.indexOf('v-html="WAX_FILTER"')).toBeLessThan(component.indexOf('<AboutSheets'))
  })
  it('手機（卡紙疊）蠟筆畫在期許那張卡紙底：色帶與草地置中（xMid）鋪滿，卡紙最多算到 480px 寬，同一組卡紙位置', () => {
    expect(sheetsHouse.match(/name="sky" view-box="0 0 1240 260" align="xMidYMin slice"/g)).toHaveLength(1)
    expect(sheetsHouse.match(/name="grass" view-box="0 0 1240 300" align="xMidYMax slice"/g)).toHaveLength(1)
    expect(sheetsCss).toContain('.ams-art{--v:calc(min(var(--ams-col),480px) / 620);')
    for (const key of ['treeL', 'treeR', 'smoke', 'house']) expect(sheetsHouse).toContain(`sceneStyle(SCENE.${key}`)
    expect(sheetsHouse.match(/class="ams-tape is-[lr]"/g)).toHaveLength(2)
  })
  it('左頁印刷層在字之下、封面照樣蓋得住左頁（左頁 z-index 1 < 右頁 2）', () => {
    expect(chapterCss).toContain('.abk-hope .abk-page.is-left{z-index:1;')
    expect(chapterCss).toContain('.abk-page.is-left>.abk-print{z-index:-1}')
  })
})

describe('動畫：沒有 JS 就是完成圖', () => {
  it('只有 is-live 之後、還沒翻開／房子還沒站好時才把線藏起來（手機卡紙疊同理：那張露出來才塗、停好才長藤）', () => {
    expect(crayonCss).toContain('.abk.is-live .abk-hope:not(.is-opened) .is-fill,.abk.is-live .abk-scene:not(.is-grown) .is-grow{stroke-dashoffset:1;transition:none}')
    expect(crayonCss).toContain('.ams.is-live .ams-hope:not(.is-opened) .is-fill,.ams.is-live .ams-hope:not(.is-grown) .is-grow{stroke-dashoffset:1;transition:none}')
    expect(crayonCss).toMatch(/\.abk-crayon \.is-fill,\.abk-crayon \.is-grow\{stroke-dasharray:1;stroke-dashoffset:0;/)
  })
  it('翻開時跨頁加 is-opened（色帶與草地塗上去），房子站好後 .abk-scene 加 is-grown（藤蔓與煙）', () => {
    expect(popup).toContain("spread.classList.add('is-opened')")
    expect(popup).toContain("scene.classList.add('is-grown')")
    expect(strokes.some((s) => s.a === 'fill')).toBe(true)
    expect([...art.ivy, ...art.smoke].every((s: Stroke) => s.a === 'grow')).toBe(true)
  })
  it('強制色彩模式藏起插畫，只留照片與文字', () => {
    const forced = css.slice(css.indexOf('@media (forced-colors:active)'))
    expect(forced).toContain('.abk-print,.abk-crayon{display:none}')
  })
})

describe('房子與照片', () => {
  it('照片還是後台的 hopePhoto、4:3 裁切，用紙膠帶貼在窗戶上', () => {
    expect(hope).toContain("pagePhotoAttrs('about-together', page.hopePhoto")
    expect(hope).toContain('pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)')
    expect(hope.match(/class="abk-tape is-[lr]"/g)).toHaveLength(2)
    expect(css).toContain('.abk-card img,.abk-blank{display:block;width:100%;height:auto;aspect-ratio:4/3;')
  })
  it('煙的框對準房子卡紙上的煙囪頂', () => {
    expect(shared).toContain('smoke: { x: 180 + 218 - 90, y: 102 + 340 - 46 + 6 - 8, w: 120, h: 180 }')
    expect(shared).toContain('house: { x: 180, y: 102, w: 300, h: 340 }')
  })
  it('房子與兩棵樹是會站起來的卡紙', () => {
    expect(hope.match(/data-pop/g)).toHaveLength(3)
  })
})
