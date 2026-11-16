// 2026-11-16 首頁拍立得「看得清楚」三項（使用者從提案裡選 2、3、4）：
// 1× 螢幕的貼圖最低 2×、背面字級放大一級、相紙加貼著紙緣的細影子。量測見 README 同日段落。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const paper = read('../app/utils/paperPrints.ts')
const css = read('../app/assets/css/styles.css')

describe('WebGL 紙在 1× 螢幕也照 2× 畫', () => {
  it('pixelRatio 最低 2、最高 3：1× 照 1× 畫時背面粗體小字的筆畫會黏在一起', () => {
    expect(paper).toContain('const pixelRatio = () => Math.min(Math.max(window.devicePixelRatio || 1, 2), 3)')
  })
})

describe('背面字級放大一級', () => {
  it('桌機故事 18、問答 16', () => {
    expect(css).toMatch(/\.print-story\{position:relative;font-size:var\(--fs-lg\);/)
    expect(css).toMatch(/\.print-question\{font-size:var\(--fs-md\);/)
    expect(css).toMatch(/\.print-answer\{font-size:var\(--fs-md\);/)
  })
  it('手機（≤760）故事也是 16，不再是 14', () => {
    const mobile = css.slice(css.indexOf('.print-back{position:relative;inset:auto;'))
    expect(mobile.slice(0, 200)).toContain('.print-story{font-size:var(--fs-md)}')
    expect(css).not.toMatch(/\.print-(story|question|answer)\{font-size:var\(--fs-sm\)/)
  })
  it('紙寬不到 400px 時故事退回 16、背面內距收窄：761–900px 背面是絕對定位，超出就裁', () => {
    expect(css).toContain('@container (max-width:400px){.print-story{font-size:var(--fs-md)}.print-back{padding:28px 24px 36px}}')
    // .print-wrap 要是 container，上面那條才有作用
    expect(css).toMatch(/\.print-wrap\{[^}]*container-type:inline-size/)
  })
})

describe('相紙貼著紙緣的細影子', () => {
  it('平放與懸停都多一道 0 1px 2px 的接觸影子', () => {
    expect(css).toMatch(/--print-shadow:[^;]*0 1px 2px rgb\(var\(--ink\) \/ \.3\)/)
    expect(css).toMatch(/\.print-wrap:hover \.print::after\{box-shadow:[^}]*0 1px 2px rgb\(var\(--ink\) \/ \.3\)/)
  })
  it('WebGL 版把細影子畫在 1× 的畫布上：半解析度放大後紙緣那條深線會變軟，手機換手時看得出來', () => {
    expect(paper).toContain('const TIGHT_SHADOW_BLUR = 4')
    expect(paper).toContain('prerenderShadows(softShadows.filter((shadow) => shadow.blur > TIGHT_SHADOW_BLUR), REST_SHADOW_SCALE)')
    expect(paper).toContain('prerenderShadows(softShadows.filter((shadow) => shadow.blur <= TIGHT_SHADOW_BLUR), 1)')
  })
})
