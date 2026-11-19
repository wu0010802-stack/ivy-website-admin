// 2026-11-13 首頁「孩子的一天」拍立得照片的 sizes（README 同日段落）。
// 原本整段寫 `(max-width: 760px) 100vw, 540px`，比相框實際寬度多估四到五成：正方形照片在 DPR 3 手機抓到 1200w、
// 素材庫照片抓到 1600 的大圖。相框是正方形、object-fit: cover，橫幅照片要畫的寬度是框寬 × 寬高比，所以 sizes 依每張照片的比例算。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, h, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import manifest from '../app/generated/image-manifest.json'
import type { DayExperienceContent } from '../app/types/site-content'
import { dayPrintSizes, responsiveImage } from '../app/utils/responsive-image'
import DayMomentCard from '../app/components/DayMomentCard.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onUnmounted', onUnmounted)

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const images = manifest as Record<string, { width: number; height: number; candidates: { width: number }[] }>

/** 瀏覽器怎麼讀 sizes：第一個成立的 media 條件，算出 CSS px。只支援這個檔用到的寫法。 */
function sizesPx(sizes: string, viewport: number): number {
  for (const entry of sizes.split(',').map((part) => part.trim())) {
    const media = entry.match(/^\(max-width: (\d+)px\) (.+)$/)
    if (media && viewport > Number(media[1])) continue
    const value = media ? media[2]! : entry
    const calc = value.match(/^calc\(\(100vw - (\d+)px\) \* ([\d.]+)\)$/)
    if (calc) return (viewport - Number(calc[1])) * Number(calc[2])
    if (value === '100vw') return viewport
    const px = value.match(/^(\d+)px$/)
    if (px) return Number(px[1])
    throw new Error(`看不懂的 sizes：${value}`)
  }
  throw new Error('sizes 沒有預設值')
}

/** 瀏覽器挑 srcset：密度夠的最小一張，都不夠就最大那張。 */
function picked(widths: number[], sizes: string, viewport: number, dpr: number): number {
  const need = sizesPx(sizes, viewport) * dpr
  return widths.find((width) => width >= need) ?? widths[widths.length - 1]!
}

// 2026-11-13 Playwright 在 dev server 量到的相框寬度（img.print-photo 的 offsetWidth，CSS px）。
const MEASURED_FRAME: [viewport: number, frame: number][] = [
  [320, 202], [360, 231], [375, 242], [390, 253], [393, 255], [402, 262], [412, 269], [430, 282], [600, 405], [760, 520],
  [761, 276], [900, 334], [1100, 418], [1440, 386], [1920, 386]
]

describe('拍立得照片的 sizes', () => {
  it('正方形與直幅照片：就是相框寬', () => {
    const square = '(max-width: 760px) calc((100vw - 40px) * 0.723), (max-width: 1100px) calc((100vw - 104px) * 0.42), 387px'
    expect(dayPrintSizes(1536, 1536)).toBe(square)
    expect(dayPrintSizes(1200, 1600)).toBe(square)
    // 沒有尺寸（素材庫舊資料）當正方形
    expect(dayPrintSizes(undefined, undefined)).toBe(square)
  })

  it('橫幅照片：照框高畫滿，寬度乘上寬高比', () => {
    expect(dayPrintSizes(1600, 1200)).toBe('(max-width: 760px) calc((100vw - 40px) * 0.964), (max-width: 1100px) calc((100vw - 104px) * 0.56), 516px')
  })

  it('各寬度都不低估實際相框（低估會抓到小一級的圖而糊），也不多估超過 1%', () => {
    for (const aspect of [1, 4 / 3]) {
      const sizes = dayPrintSizes(1600 * aspect, 1600)
      for (const [viewport, frame] of MEASURED_FRAME) {
        const need = frame * aspect
        const got = sizesPx(sizes, viewport)
        // 量到的是四捨五入後的整數，留 0.5px
        expect(got, `${viewport}px、比例 ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(need - 0.5 * aspect)
        // 1101–1375 寬的桌機卡片還沒到 460px，寫死最寬值會多估一點，其餘誤差在 1% 內
        expect(got, `${viewport}px、比例 ${aspect.toFixed(2)}`).toBeLessThanOrEqual(need * 1.01 + 1)
      }
    }
  })

  it('正方形照片在 DPR 3 手機與 Retina 桌機降一級；4:3 的照片不會被降到不夠用', () => {
    const builtin = images['day-lunch']!.candidates.map((candidate) => candidate.width)
    expect(builtin).toEqual([160, 480, 800, 1200, 1536])
    const before = '(max-width: 760px) 100vw, 540px'
    const square = dayPrintSizes(1536, 1536)
    expect(picked([160, 480, 800, 1200, 1600], before, 390, 3)).toBe(1200)
    for (const [viewport, dpr] of [[360, 3], [390, 3], [393, 3], [402, 3], [412, 2.625]] as const) expect(picked(builtin, square, viewport, dpr)).toBe(800)
    expect(picked(builtin, square, 1440, 2)).toBe(800)
    // 素材庫照片的衍生檔是 480／960／1600
    expect(picked([480, 960, 1600], before, 390, 3)).toBe(1600)
    expect(picked([480, 960, 1600], square, 390, 3)).toBe(960)

    // 4:3：390 寬 DPR 3 的相框是 759 實體像素高，800w 的檔只有 600 高，一定要 1200w
    const wide = dayPrintSizes(1600, 1200)
    const wideWidths = images['day-hello']!.candidates.map((candidate) => candidate.width)
    expect(wideWidths).toEqual([160, 480, 800, 1200, 1600])
    for (const [viewport, dpr] of [[360, 3], [390, 3], [393, 3], [412, 2.625]] as const) {
      const file = picked(wideWidths, wide, viewport, dpr)
      const frame = MEASURED_FRAME.find(([width]) => width === viewport)![1]
      expect(file).toBe(1200)
      expect(file * 0.75).toBeGreaterThanOrEqual(frame * dpr)
    }
  })

  it('算式跟著版面：這幾條 CSS 改了要重量相框寬度', () => {
    const css = read('../app/assets/css/styles.css')
    expect(css).toContain('.print-card{--card-tilt:-2.2deg;position:relative;width:min(460px,100%);rotate:var(--card-tilt)}')
    expect(css).toContain('@media(max-width:1100px){.day-prints{padding-inline:32px;grid-template-columns:minmax(0,1fr) 40px minmax(0,1fr)}')
    expect(css).toContain(' .day-prints{display:block;padding-inline:20px;')
    expect(css).toContain(' .day-print:nth-child(n) .print-card{width:84%;margin:0;--card-tilt:-1.5deg}')
    expect(css).toContain(' .print-front{padding:7% 7% 0}')
  })

  it('卡片上的 <img> 與 <source> 真的用依比例算出來的 sizes', async () => {
    const day = fixture.dayExperience as unknown as DayExperienceContent
    for (const moment of day.moments.filter((item) => item.photo && !item.photoMedia)) {
      const app = createSSRApp({ render: () => h(DayMomentCard as Component, { moment, index: 0, active: false }) })
      app.component('ResponsivePicture', ResponsivePicture)
      const html = (await renderToString(app)).replaceAll('&amp;', '&')
      const { width, height } = responsiveImage(moment.photo)
      const expected = dayPrintSizes(width, height)
      const found = [...html.matchAll(/ sizes="([^"]+)"/g)].map((match) => match[1])
      expect(found.length, moment.photo).toBeGreaterThanOrEqual(2)
      expect(new Set(found), moment.photo).toEqual(new Set([expected]))
      expect(html).not.toContain('100vw, 540px')
    }
  })
})
