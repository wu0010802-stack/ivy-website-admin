// @vitest-environment happy-dom
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { birdPerch, createEnvironmentDoodles, DOODLE_NAMES, doodleArt, TOUR_PAINT, tourPaintSrc, type DoodleColor } from '../app/utils/environment-doodles'
import { clotheslineY } from '../app/utils/rough-sketch'

// 2026-10-19 使用者看過 design/environment-playful-directions-20261019/ 四個方向後選 A「蠟筆塗鴉」，
// 第二版（校舍照線稿輪廓塗色、校園環境加風箏與泡泡、塗鴉全是不可聚焦的裝飾）確認後上線。
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('../app/assets/css/environment.css')
const component = read('../app/components/EnvironmentContent.vue')
const template = component.slice(component.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')
const site = fixture as unknown as SiteContent
/** PNG 的寬高在 IHDR（第 16–23 位元組，大端序）。 */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })

describe('常春藤環境頁蠟筆塗鴉：畫法', () => {
  it('九張塗鴉都是固定種子：同一張畫兩次一模一樣', () => {
    for (const name of DOODLE_NAMES) expect(doodleArt(name)).toEqual(doodleArt(name))
  })

  it('座標都是有限數字，不會畫出 viewBox 太多（出界一點點是蠟筆筆觸）', () => {
    for (const name of DOODLE_NAMES) {
      const { w, h, marks } = doodleArt(name)
      expect(marks.length).toBeGreaterThan(0)
      for (const mark of [...marks.map((m) => m.d), ...marks.flatMap((m) => (m.clip ? [m.clip] : []))]) {
        const nums = mark.match(/-?\d+(\.\d+)?/g)!.map(Number)
        expect(nums.every(Number.isFinite), name).toBe(true)
        const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1)
        // 塗色的鋸齒線本來就比形狀大（靠 clip 剪掉），只檢查不是 clip 的線
        if (marks.some((m) => m.d === mark && m.clip)) continue
        expect(Math.min(...xs), name).toBeGreaterThan(-w * 0.15)
        expect(Math.max(...xs), name).toBeLessThan(w * 1.15)
        expect(Math.min(...ys), name).toBeGreaterThan(-h * 0.15)
        expect(Math.max(...ys), name).toBeLessThan(h * 1.15)
      }
    }
  })

  it('顏色只給名字，每個名字在 environment.css 都對到一個 token（不寫色彩字面值）', () => {
    const used = new Set<DoodleColor>([...DOODLE_NAMES.flatMap((name) => doodleArt(name).marks.map((m) => m.c)), ...Object.values(TOUR_PAINT).flat()])
    for (const color of used) {
      const rule = css.match(new RegExp(`\\.renv-doodle-art \\.is-${color}\\{--c:var\\((--[a-z-]+)\\)\\}`))
      expect(rule, color).not.toBeNull()
      expect(css, `${color} 用的 ${rule![1]} 要在 .renv 定義`).toMatch(new RegExp(`\\n  ${rule![1]}:`))
    }
  })

  it('小鳥站在第 2、3 張照片之間（手機橫滑時第 1、2 張之間），高度就是曬衣繩在那裡的高度', () => {
    const items = [0, 1, 2, 3, 4].map((i) => ({ left: i * 245, width: 217 }))
    expect(birdPerch(1200, items, true)).toEqual({ x: 476, y: clotheslineY(476, 1200) })
    expect(birdPerch(1200, items, false)).toEqual({ x: 231, y: clotheslineY(231, 1200) })
    expect(birdPerch(1200, items.slice(0, 1), true)).toBeNull()
  })
})

describe('常春藤環境頁蠟筆塗鴉：模板與資源', () => {
  it('塗鴉都是空的 aria-hidden 位置（沒有 JS 時什麼都沒有），名字都有對應的畫法', () => {
    const spots = [...template.matchAll(/<span[^>]*class="renv-doodle[^"]*"[^>]*\/>/g)].map(([tag]) => tag)
    expect(spots.length).toBe(6)
    for (const tag of spots) expect(tag).toContain('aria-hidden="true"')
    const fixed = [...template.matchAll(/data-doodle="(\w+)"/g)].map(([, name]) => name)
    expect(fixed).toEqual(['sun', 'bird', 'rainbow', 'hand'])
    // 校園環境三站與兩種蔬果的名字寫在常數裡
    expect(component).toMatch(/doodle: 'kite'/)
    expect(component).toMatch(/doodle: 'bubbles'/)
    expect(component).toMatch(/doodle: 'bunny'/)
    expect(component).toMatch(/MEAL_DOODLES = \['', 'banana', '', 'apple', ''\]/)
    expect([...fixed, 'kite', 'bubbles', 'bunny', 'banana', 'apple'].sort()).toEqual([...DOODLE_NAMES].sort())
  })

  it('塗鴉層只在瀏覽器動態載入：元件只 import 型別，手繪層畫完才建', () => {
    expect(component).toMatch(/import type \{ EnvironmentDoodles \} from '~\/utils\/environment-doodles'/)
    expect(component).not.toMatch(/import \{[^}]*\} from '~\/utils\/environment-doodles'/)
    const mounted = component.slice(component.indexOf('onMounted('))
    expect(mounted.indexOf('await sketch.ready')).toBeLessThan(mounted.indexOf('createDoodles(root.value'))
    expect(component).toMatch(/doodles\?\.destroy\(\)/)
  })

  it('有校園探索的每一所學校都有塗色與兩張遮罩（720×480，跟墨線線稿同比例）', () => {
    const keys = site.campuses.filter((campus) => campus.tourScenes.length).map((campus) => campus.key)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(TOUR_PAINT[key], key).toBeDefined()
      for (const part of ['', '-roof'] as const) {
        // happy-dom 的 URL 不是 Node 的 URL，fs 認不得；用路徑
        const file = join(dirname(fileURLToPath(import.meta.url)), '../public', tourPaintSrc(key, part))
        expect(statSync(file).size, `${key}${part}`).toBeLessThan(8 * 1024)
        expect(pngSize(readFileSync(file)), `${key}${part}`).toEqual({ width: 720, height: 480 })
      }
    }
  })

  it('牆的顏色避開選中時底卡的顏色（底卡依分頁順序輪流黃、藍、綠、桃）', () => {
    const family: Partial<Record<DoodleColor, string>> = { yellow: 'yellow', gold: 'yellow', sky: 'sky', blue: 'sky', leaf: 'leaf', green: 'leaf', peach: 'peach', orange: 'peach' }
    const cards = ['yellow', 'sky', 'leaf', 'peach']
    site.campuses.filter((campus) => campus.tourScenes.length).forEach((campus, i) => {
      const [wall] = TOUR_PAINT[campus.key]!
      expect(family[wall] ?? wall, campus.key).not.toBe(cards[i % cards.length])
    })
  })
})

describe('常春藤環境頁蠟筆塗鴉：掛到頁面上', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function page() {
    document.body.innerHTML = `
      <main class="renv">
        <section class="renv-hero"><span class="renv-doodle is-sun" data-doodle="sun" aria-hidden="true"></span></section>
        <div class="renv-hang"><ol class="renv-hang-track"><li></li><li></li><li></li></ol><span class="renv-doodle is-bird" data-doodle="bird" aria-hidden="true"></span></div>
        <span class="renv-doodle is-kite" data-doodle="kite" aria-hidden="true"></span>
        <span class="renv-doodle is-nope" data-doodle="nope" aria-hidden="true"></span>
        <div class="renv-tour-tabs">
          <button class="renv-tour-tab" aria-selected="true"><span class="renv-tour-art"><span class="renv-tour-paint" data-tour-paint data-campus="yihua" aria-hidden="true"></span></span></button>
          <button class="renv-tour-tab" aria-selected="false"><span class="renv-tour-art"><span class="renv-tour-paint" data-tour-paint data-campus="minghua" aria-hidden="true"></span></span></button>
        </div>
      </main>`
    return document.querySelector<HTMLElement>('main')!
  }

  it('畫好的塗鴉是一張 aria-hidden 的 svg，點得到但不可聚焦；不認得的名字不畫', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const root = page()
    const doodles = createEnvironmentDoodles(root, { reducedMotion: true })
    for (const name of ['sun', 'bird', 'kite']) {
      const spot = root.querySelector<HTMLElement>(`[data-doodle="${name}"]`)!
      const svg = spot.querySelector('svg.renv-doodle-art')!
      expect(svg.getAttribute('aria-hidden'), name).toBe('true')
      expect(svg.querySelectorAll('path').length, name).toBeGreaterThan(2)
      expect(spot.classList.contains('is-poke'), name).toBe(true)
      expect(spot.hasAttribute('tabindex'), name).toBe(false)
    }
    expect(root.querySelector('[data-doodle="nope"]')!.childElementCount).toBe(0)
    // 蠟筆濾鏡整頁只有一個
    expect(root.querySelectorAll('filter#renv-crayon').length).toBe(1)
    doodles.destroy()
    expect(root.querySelector('[data-doodle="sun"]')!.childElementCount).toBe(0)
    expect(root.querySelector('filter#renv-crayon')).toBeNull()
  })

  it('選到的學校才塗色（牆、屋頂兩層各自的遮罩）；換校後新的那所也塗，看過的留著', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const root = page()
    const doodles = createEnvironmentDoodles(root, { reducedMotion: true })
    const [yihua, minghua] = [...root.querySelectorAll<HTMLElement>('[data-tour-paint]')]
    const masks = (spot: HTMLElement) => [...spot.querySelectorAll<SVGElement>('svg')].map((svg) => svg.style.getPropertyValue('--paint-mask'))
    expect(masks(yihua!)).toEqual(['url(/assets/tour-paint-yihua.png)', 'url(/assets/tour-paint-yihua-roof.png)'])
    expect(minghua!.childElementCount).toBe(0)
    const [first, second] = [...root.querySelectorAll('.renv-tour-tab')]
    first!.setAttribute('aria-selected', 'false')
    second!.setAttribute('aria-selected', 'true')
    await vi.waitFor(() => expect(minghua!.childElementCount).toBe(2))
    expect(yihua!.childElementCount).toBe(2)
    doodles.destroy()
  })
})
