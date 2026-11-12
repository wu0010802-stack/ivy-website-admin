import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-11 特色教學手機版只留一條橫滑（使用者裁定）。原本 02 課程方向、03 兒童美術館、04 五件事連著三條橫滑，
// 390 寬 20 張卡只露出 3 張、要滑 17 次才看完。現在課程方向沿用平板的兩欄、五件事一列一件，美術館留橫滑但每件等高。
// 都是版面，鎖住原始碼裡的關鍵寫法；實測數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../app/assets/css/curriculum.css')
const cur = read('../app/components/CurriculumContent.vue')
const watercolor = read('../app/composables/useWatercolor.ts')
const mobileAt = css.indexOf('@media (width <= 760px) {')
const mobile = css.slice(mobileAt, css.indexOf('\n}\n', mobileAt))
const rule = (selector: string) => new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(mobile)?.[1] ?? ''
const tag = (className: string) => new RegExp(`<[a-z]+ class="${className}"[^>]*>`).exec(cur)?.[0] ?? ''

describe('手機只有美術館橫滑', () => {
  it('找得到 760 以下的區塊', () => {
    expect(mobileAt).toBeGreaterThan(-1)
  })
  it('課程方向、五件事不再橫向捲動', () => {
    expect(mobile).not.toMatch(/\.cur-dir-grid[^{]*\{[^}]*overflow-x/)
    expect(mobile).not.toMatch(/\.cur-daily-list[^{]*\{[^}]*overflow-x/)
    expect(mobile).not.toMatch(/\.cur-(?:dir|thing)[^{]*\{[^}]*scroll-snap-align/)
    expect(mobile.match(/overflow-x: auto/g)).toHaveLength(1)
    expect(rule('.cur-art-wall')).toContain('overflow-x: auto')
  })
  it('只有美術館接捲動事件、有張數', () => {
    expect(cur.match(/@scroll\.passive=/g)).toHaveLength(1)
    expect(tag('cur-art-wall')).toContain('@scroll.passive="onGalleryScroll"')
    expect(cur.match(/class="cur-count"/g)).toHaveLength(1)
    expect(cur).toContain('<p class="cur-count" aria-hidden="true"><b>{{ galleryAt }}</b> / {{ gallery.length }}<span>左右滑動</span></p>')
  })
  it('整條清單鋪的那片顏料只留給還在橫滑的美術館（直排的清單每張照片畫自己的）', () => {
    expect(cur.match(/data-wash-mobile=/g)).toHaveLength(1)
    expect(tag('cur-art-wall')).toContain('data-wash-mobile=')
  })
  it('張數桌機不顯示，760 以下才顯示', () => {
    const base = css.indexOf('.cur-count { display: none; }')
    expect(base).toBeGreaterThan(-1)
    expect(base).toBeLessThan(mobileAt)
    expect(rule('.cur-count')).toContain('display: flex')
  })
})

describe('課程方向：沿用平板的兩欄', () => {
  it('760 以下不把兩欄改掉，只收間距', () => {
    expect(css).toContain('.cur-dir-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
    expect(rule('.cur-dir-grid')).not.toContain('display')
    expect(rule('.cur-dir-grid')).not.toContain('grid-template-columns')
    expect(rule('.cur-dir-grid')).toContain('column-gap: 16px')
  })
  it('「六歲定八十」五個字在半欄裡排一行：320 寬的欄是 132px', () => {
    const size = /font-size: min\(([\d.]+)rem, ([\d.]+)vw\)/.exec(rule('.cur-dir--quote .cur-dir-sub'))
    expect(size).not.toBeNull()
    const padding = Number(/padding: \d+px (\d+)px/.exec(rule('.cur-dir--quote'))?.[1])
    for (const width of [320, 360, 390, 430]) {
      const column = (width - 40 - 16) / 2 - padding * 2
      const font = Math.min(Number(size![1]) * 16, width * Number(size![2]) / 100)
      // 五個字＋四個字距 .04em（最後一個字後面的字距不佔可見寬度，保守算五個）
      expect(font * 5 * 1.04, `${width}px`).toBeLessThanOrEqual(column)
    }
  })
})

describe('美術館：橫滑的作品等高', () => {
  it('高度寫在清單上，直幅橫幅共用；橫幅（4:3）不超過 80vw，下一件露得出來', () => {
    const height = /--art-h: min\((\d+)px, (\d+)vw\)/.exec(rule('.cur-art-wall'))
    expect(height).not.toBeNull()
    expect(Number(height![2]) * 4 / 3).toBeLessThanOrEqual(80)
    expect(rule('.cur-art .cur-frame, .cur-art img')).toContain('height: var(--art-h)')
    expect(rule('.cur-art img')).toContain('width: auto')
    expect(rule('.cur-art')).toContain('flex: none')
  })
  it('吸附是鬆的，滑到底不帶動整頁', () => {
    expect(rule('.cur-art-wall')).toContain('scroll-snap-type: x proximity')
    expect(rule('.cur-art-wall')).toContain('overscroll-behavior-x: contain')
  })
})

describe('五件事：一列一件，左照片右文字', () => {
  it('蓋掉桌機與平板的欄位與錯落', () => {
    expect(rule('.cur-daily-list')).toContain('grid-template-columns: minmax(0, 1fr)')
    const thing = rule('.cur-thing:nth-child(n)')
    expect(thing).toContain('grid-column: 1 / -1')
    expect(thing).toContain('margin-top: 0')
    expect(thing).toMatch(/grid-template-columns: clamp\(\d+px, \d+vw, \d+px\) minmax\(0, 1fr\)/)
  })
  it('照片是方的，跨編號、標題、內文三列', () => {
    expect(rule('.cur-thing .cur-frame')).toContain('grid-row: 1 / span 3')
    expect(rule('.cur-thing .cur-frame')).toContain('aspect-ratio: 1')
  })
})

describe('照片的 sizes 跟著新版面', () => {
  it('課程方向手機半欄、藝術共創滿版；五件事是小圖；美術館直幅橫幅分開', () => {
    expect(cur).toContain("const DIRECTION_SIZES = '(max-width: 760px) 45vw, (max-width: 1100px) 50vw, 520px'")
    expect(cur).toContain("sizes: '(max-width: 1100px) 100vw, 800px'")
    expect(cur).toContain("'(max-width: 760px) 148px, (max-width: 1100px) 50vw, 400px'")
    expect(cur).toContain("art.tall ? GALLERY_SIZES_TALL : GALLERY_SIZES")
  })
})

describe('不捲動的清單不當成橫滑', () => {
  it('判斷橫滑要看 overflow-x，不能只看 scrollWidth（往外暈的顏料團會把它撐大）', () => {
    expect(watercolor).toContain("return (overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth + 2")
    expect(watercolor.match(/\.scrollWidth >/g)).toHaveLength(1)
    expect(watercolor).toContain('if (scrollsX(list)) list.tabIndex = 0')
    expect(watercolor).toContain('else if (group && scrollsX(group)) groups.add(group)')
  })
})
