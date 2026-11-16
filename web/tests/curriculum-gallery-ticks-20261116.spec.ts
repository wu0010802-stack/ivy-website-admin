import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-16 特色教學 03 兒童美術館手機橫滑（使用者看比稿 design/curriculum-gallery-mobile-20261116/ 選 A）：
// 1. 「1 / 8　左右滑動」換成一件一段的進度條（「左右滑動」是操作說明字），每段是按鈕、點了捲到那一件；
// 2. 清單尾端補一段留白，最後一件也停得到起點，左邊不再露出上一件約 60px 的殘邊。
// 實際停點在 tests/e2e/curriculum-gallery.spec.ts 量。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
const css = read('../app/assets/css/curriculum.css')
const cur = read('../app/components/CurriculumContent.vue')
const mobileAt = css.indexOf('@media (width <= 760px) {')
const mobile = css.slice(mobileAt, css.indexOf('\n}\n', mobileAt))
const rule = (selector: string) => new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(mobile)?.[1] ?? ''

describe('美術館進度條取代張數', () => {
  it('不再有「左右滑動」與張數', () => {
    expect(strip(cur)).not.toContain('左右滑動')
    expect(strip(cur)).not.toContain('cur-count')
    expect(strip(css)).not.toContain('.cur-count')
  })
  it('一件一段，每段是有名稱的按鈕，目前這件標 aria-current，點了捲過去', () => {
    expect(cur).toContain('<ol class="cur-ticks" aria-label="跳到某一件作品">')
    expect(cur).toMatch(/<li v-for="\(art, i\) in gallery" :key="art\.image"><button type="button" :aria-label="`第 \$\{i \+ 1\} 件：\$\{art\.label\}`" :aria-current="galleryAt === i \+ 1 \? 'true' : undefined" @click="showArt\(i\)" \/><\/li>/)
    expect(cur).toContain('function showArt(index: number)')
    // 減少動態時直接跳過去，不平滑捲動
    expect(cur).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
  })
  it('看得到的線 4px、點擊高 32px；目前這件深綠、其餘淡線，顏色走 token', () => {
    expect(rule('.cur-ticks button')).toContain('height: 32px')
    expect(rule('.cur-ticks button::before')).toContain('height: 4px')
    expect(rule('.cur-ticks button::before')).toContain('background: var(--line)')
    expect(rule('.cur-ticks button[aria-current="true"]::before')).toContain('background: var(--green)')
  })
  it('減少動態不做顏色過場；強制色彩改用系統色', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced.slice(0, reduced.indexOf('\n}\n'))).toContain('.cur-ticks button::before')
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
    expect(forced).toContain('.cur-ticks button[aria-current="true"]::before { background: Highlight; }')
  })
})

describe('美術館尾端留白：最後一件也停在起點', () => {
  it('留白是清單的 ::after，寬度＝內容寬 − 間距 − 最後一件寬', () => {
    expect(rule('.cur-art-wall')).toContain('--art-gap: 14px')
    expect(rule('.cur-art-wall')).toContain('gap: var(--art-gap)')
    const tail = rule('.cur-art-wall::after')
    expect(tail).toContain('flex: none')
    expect(tail).toContain('width: max(0px, 100% - var(--art-gap) - var(--art-h) * var(--art-last-ratio, 1.3333))')
  })
  it('最後一件的寬高比由元件給，後台換照片照新照片算', () => {
    expect(cur).toMatch(/<ul class="cur-art-wall" ref="galleryRail" [^>]*:style="galleryTail"/)
    expect(cur).toContain("const { width, height } = pagePhotoAttrs(last.image, last.photo, GALLERY_SIZES)")
    expect(cur).toContain("'--art-last-ratio'")
  })
  it('留白算式：任何寬度、最後一件直幅或橫幅，捲到底時最後一件的左緣剛好在起點', () => {
    const gutter = 20, gap = 14
    for (const width of [320, 360, 375, 390, 430, 760]) {
      const artH = Math.min(240, width * 0.6)
      for (const ratios of [[0.75, 4 / 3, 0.75, 4 / 3], [4 / 3, 0.75, 4 / 3, 0.75], [4 / 3, 4 / 3, 4 / 3]]) {
        const widths = ratios.map((r) => artH * r)
        const content = width - gutter * 2
        const tail = Math.max(0, content - gap - widths.at(-1)!)
        const lastLeft = gutter + widths.slice(0, -1).reduce((a, b) => a + b + gap, 0)
        const scrollWidth = lastLeft + widths.at(-1)! + gap + tail + gutter
        expect(scrollWidth - width, `${width}px ${ratios.join('/')}`).toBeCloseTo(lastLeft - gutter, 6)
      }
    }
  })
})
