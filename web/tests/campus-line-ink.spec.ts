import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../app/generated/image-manifest.json'
import { lineArtBlends, lineArtInkImage, type MediaImage } from '../app/utils/media-image'

// 五校線稿小圖改用透明底墨線版（2026-10-02）：原本 filter＋mix-blend-mode:multiply 融紙底，
// iPhone 把圖或祖先移到獨立合成層時 multiply 碰不到底色，分校分頁露出整塊紙底方塊。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const images = manifest as Record<string, { width: number, height: number, candidates: { src: string, width: number }[] }>
/** WebP 延伸格式（VP8X）的 alpha 旗標 */
const hasAlpha = (file: string) => {
  const bytes = readFileSync(file)
  return bytes.toString('latin1', 12, 16) === 'VP8X' && (bytes[20]! & 0x10) !== 0
}
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector}{`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start) + 1)
}

describe('五校線稿墨線版', () => {
  it('五校都有 -ink 素材：manifest 有小到 160w 的候選，母檔與候選檔都在、帶 alpha', () => {
    for (const key of KEYS) {
      const info = images[`campus-line-art-${key}-ink`]
      expect(info, key).toBeDefined()
      expect(info!.width / info!.height).toBeCloseTo(1.5, 2)
      expect(info!.candidates[0]!.width).toBe(160)
      const master = resolve(here, `../public/assets/campus-line-art-${key}-ink.webp`)
      expect(existsSync(master)).toBe(true)
      expect(hasAlpha(master)).toBe(true)
      for (const candidate of info!.candidates) {
        const file = resolve(here, `../public${candidate.src}`)
        expect(existsSync(file), candidate.src).toBe(true)
        expect(hasAlpha(file), candidate.src).toBe(true)
      }
    }
  })

  it('內建線稿給墨線版；後台換過線稿才用原圖並走 multiply', () => {
    const builtIn = lineArtInkImage({ key: 'yihua' }, '60px')
    expect(builtIn.src).toBe('/assets/campus-line-art-yihua-ink.webp')
    expect(builtIn.srcset).toContain('campus-line-art-yihua-ink-')
    expect(lineArtBlends({})).toBe(false)
    const media: MediaImage = { src: '/api/website/v1/public/media/x/file', candidates: [], position: null, alt: '' }
    expect(lineArtInkImage({ key: 'yihua', lineArtMedia: media }, '60px').src).toBe(media.src)
    expect(lineArtBlends({ lineArtMedia: media })).toBe(true)
  })

  it('首頁分校分頁：線稿本身不用混合模式，只有 is-blend 才 filter＋multiply', () => {
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toContain(`lineArtInkImage(campus, '(max-width: 360px) 48px, (max-width: 700px) 60px, 160px')`)
    expect(rule(board, '.campus-tab-art')).not.toMatch(/mix-blend-mode|filter:/)
    expect(rule(board, '.campus-tab-art.is-blend')).toContain('mix-blend-mode:multiply')
    // 淡彩速寫要原線稿，不能拿分頁鈕的墨線版
    expect(board).toContain('responsiveImage(`campus-line-art-${campus.key}`)')
    expect(board).not.toContain('.campus-tab-art`)')
  })

  it('環境頁五校分頁與預約結果也用墨線版', () => {
    expect(read('../app/components/EnvironmentContent.vue')).toContain('responsiveImage(`campus-line-art-${tour.campus.key}-ink`')
    expect(rule(read('../app/assets/css/environment.css'), '.renv-tour-tab img')).not.toMatch(/mix-blend-mode|filter:/)
    const visit = read('../app/assets/css/visit-booking.css')
    expect(rule(visit, '.visit-result-art ')).not.toMatch(/mix-blend-mode|filter:/)
    expect(rule(visit, '.visit-result-art.is-blend ')).toContain('mix-blend-mode:multiply')
    expect(read('../app/components/VisitForm.vue')).toContain(`lineArtInkImage(selectedCampus, '220px')`)
  })
})
