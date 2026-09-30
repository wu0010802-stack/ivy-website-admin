// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { SKETCH_REGISTRATION, pickLineArt, sketchAlignment, sketchLayout, sketchRegistration } from '../app/utils/campusSketch'
import { createSeepEdge, seepOffsets } from '../app/composables/useWatercolorSeep'

// 首頁水彩（2026-09-29 定案 A＋B）：五校淡彩速寫、孩子的一天→五校水彩滲接。
// happy-dom 環境的 URL 不是 node 的，路徑用 import.meta.url 字串自己拼
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const fixture = JSON.parse(read('../server/data/site-fixture.json')) as {
  campuses: { key: string, image: string, panoramaPos: string | null }[]
}
const asset = (name: string) => resolve(here, `../public/assets/${name}.webp`)

describe('淡彩速寫的對位', () => {
  it('五校都有對位，且對的是現在首頁用的那張照片、素材檔都在', () => {
    expect(Object.keys(SKETCH_REGISTRATION).sort()).toEqual(fixture.campuses.map((c) => c.key).sort())
    for (const campus of fixture.campuses) {
      expect(sketchRegistration(campus)).not.toBeNull()
      expect(existsSync(asset(campus.image))).toBe(true)
      expect(existsSync(asset(`campus-line-art-${campus.key}`))).toBe(true)
      expect(existsSync(asset(`campus-line-art-${campus.key}-colour`))).toBe(true)
    }
  })
  it('後台換了照片、線稿或淡彩層就不畫（對位對不上）', () => {
    const yihua = { key: 'yihua', image: 'yihua-exterior-enhanced-v1' }
    expect(sketchRegistration({ ...yihua, image: 'yihua-exterior' })).toBeNull()
    expect(sketchRegistration({ ...yihua, imageMedia: { media_id: 'x' } })).toBeNull()
    expect(sketchRegistration({ ...yihua, lineArtMedia: { media_id: 'x' } })).toBeNull()
    expect(sketchRegistration({ ...yihua, lineArtColourMedia: { media_id: 'x' } })).toBeNull()
    expect(sketchRegistration({ key: 'nowhere', image: 'yihua-exterior-enhanced-v1' })).toBeNull()
  })
  it('object-position 換成對齊比例', () => {
    expect(sketchAlignment('center 12%')).toEqual([0.5, 0.12])
    expect(sketchAlignment('center 55%')).toEqual([0.5, 0.55])
    expect(sketchAlignment('left top')).toEqual([0, 0])
    expect(sketchAlignment('right bottom')).toEqual([1, 1])
    expect(sketchAlignment('')).toEqual([0.5, 0.5])
  })
  it('卡片跟照片一樣大時，線稿框就是對位表上的數字', () => {
    const reg = SKETCH_REGISTRATION.yihua!
    expect(sketchLayout(reg, reg.photo[0], reg.photo[1], 'center 12%')).toEqual({ x: reg.left, y: reg.top, width: reg.width, height: reg.height })
  })
  it('照片以 cover 放進較扁的卡片：線稿跟著一起縮放、依 object-position 上下裁切', () => {
    const reg = SKETCH_REGISTRATION.renwu!
    const cover = Math.max(1152 / reg.photo[0], 540 / reg.photo[1])
    const box = sketchLayout(reg, 1152, 540, 'center 55%')
    expect(box.width).toBeCloseTo(reg.width * cover, 6)
    expect(box.x).toBeCloseTo((1152 - reg.photo[0] * cover) * 0.5 + reg.left * cover, 6)
    expect(box.y).toBeCloseTo((540 - reg.photo[1] * cover) * 0.55 + reg.top * cover, 6)
  })
  it('從分頁鈕的 srcset 挑夠用的最小一張，太大就用最大的，沒有 srcset 用原圖', () => {
    const srcset = '/a-480.webp 480w, /a-800.webp 800w, /a-1200.webp 1200w, /a-1536.webp 1536w'
    expect(pickLineArt(srcset, '/a.webp', 450)).toBe('/a-480.webp')
    expect(pickLineArt(srcset, '/a.webp', 801)).toBe('/a-1200.webp')
    expect(pickLineArt(srcset, '/a.webp', 4000)).toBe('/a-1536.webp')
    expect(pickLineArt('', '/a.webp', 450)).toBe('/a.webp')
  })
})

describe('水彩滲接的位置', () => {
  it('progress 0 濕邊整條在 panel 底下（畫面照舊），1 整條離開看得到的範圍', () => {
    const own = 4983, screen = 900
    const start = seepOffsets(0, own, screen)
    expect(start.y + start.band * 0.3).toBeCloseTo(own, 6)
    const end = seepOffsets(1, own, screen)
    expect(end.y + end.band * 0.7).toBeLessThanOrEqual(own - screen)
  })
  it('捲越多濕邊越往上；帶高依視窗高度、夾在 200–340px', () => {
    const ys = [0, 0.25, 0.5, 0.75, 1].map((p) => seepOffsets(p, 4000, 844).y)
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
    expect(seepOffsets(0, 4000, 400).band).toBe(200)
    expect(seepOffsets(0, 4000, 844).band).toBe(270)
    expect(seepOffsets(0, 4000, 2000).band).toBe(340)
  })
})

describe('水彩滲接的擦除邊', () => {
  const panel = () => {
    document.body.innerHTML = '<section class="day-experience"></section>'
    return document.querySelector<HTMLElement>('.day-experience')!
  }
  it('只寫在 panel 上、不寫 <html>；接手這一幀（回傳 true，useCurtain 就不寫 clip-path）', () => {
    const el = panel()
    const edge = createSeepEdge('blob:a', 'blob:b')
    expect(edge(el, 0.5, 844)).toBe(true)
    expect(el.classList.contains('is-seep')).toBe(true)
    expect(el.style.getPropertyValue('--day-seep-y')).toMatch(/px$/)
    expect(el.style.getPropertyValue('--day-seep-a')).toBe('url(blob:a)')
    // 遮罩不擋點擊，濕邊以下要另外用 clip-path 裁掉，露出來的五校才點得到
    expect(el.style.getPropertyValue('clip-path')).toMatch(/^inset\(/)
    expect(document.documentElement.getAttribute('style') ?? '').toBe('')
  })
  it('值沒變就不重寫', () => {
    const el = panel()
    const edge = createSeepEdge('blob:a', 'blob:b')
    edge(el, 0.3, 844)
    const spy = vi.spyOn(el.style, 'setProperty')
    edge(el, 0.3, 844)
    expect(spy).not.toHaveBeenCalled()
  })
  it('簾幕停用時交回直線；再啟用時遮罩要重新掛上', () => {
    const el = panel()
    const edge = createSeepEdge('blob:a', 'blob:b')
    edge(el, 0.4, 844)
    expect(edge(el, null, 844)).toBe(false)
    expect(el.classList.contains('is-seep')).toBe(false)
    expect(edge(el, 0.4, 844)).toBe(true)
    expect(el.classList.contains('is-seep')).toBe(true)
    expect(el.style.getPropertyValue('--day-seep-y')).toMatch(/px$/)
  })
  it('中途開了減少動態或強制色彩：拿掉遮罩、交回直線 clip-path', () => {
    const el = panel()
    const reduce = { matches: false }
    const edge = createSeepEdge('blob:a', 'blob:b', [reduce])
    expect(edge(el, 0.4, 844)).toBe(true)
    reduce.matches = true
    expect(edge(el, 0.5, 844)).toBe(false)
    expect(el.classList.contains('is-seep')).toBe(false)
  })
})

describe('水彩滲接的樣式', () => {
  const css = read('../app/assets/css/studio.css')
  const block = css.slice(css.indexOf('@property --day-seep-y'), css.indexOf('.home-reveal[data-motion="native"]'))
  it('每幀寫的變數註冊成 inherits:false，名稱帶 day- 前綴（不註冊通用名稱）', () => {
    for (const name of ['--day-seep-y', '--day-seep-bx', '--day-seep-by']) {
      expect(block).toMatch(new RegExp(`@property ${name} \\{[^}]*inherits:false`))
    }
  })
  it('只在簾幕啟用時套遮罩；遮罩只看透明度，不出現顏色字面值（實心層用 #000，同分頁線稿遮罩）', () => {
    expect(block).toContain('.day-reveal[data-motion="on"] .day-experience.is-seep')
    expect(block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\b(rgba?|oklch|hsla?)\(\s*[\d.]/i)
  })
})
