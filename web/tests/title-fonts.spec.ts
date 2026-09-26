// @vitest-environment happy-dom
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fontManifest from '../app/generated/font-manifest.json'
import { attachTitleFontStylesheet } from '../app/utils/title-fonts'

// 標題字 LINE Seed TW 完整字型分片（scripts/subset-critical-fonts.py 產生）的交付規則。
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const read = (path: string) => readFileSync(local(path))
const readText = (path: string) => read(path).toString('utf8')
const publicFile = (url: string) => read(`../public${url}`)
const inlineCss = readText('../app/assets/css/font-subsets.css')
const extendedCss = publicFile(fontManifest.stylesheet.src).toString('utf8')
const codepointsOf = (text: string) => [...text].map((char) => char.codePointAt(0)!)
const siteChars = new Set(codepointsOf(readText('../../scripts/data/lineseed-site-chars.txt').replace(/\s/g, '')))
// 改版前預載的量：Bold critical 13,820 bytes＋ExtraBold 整包 14,040 bytes。
const PRELOAD_BUDGET = 13_820 + 14_040
const SLICE_LIMIT = 60_000

interface Face { family: string, weight: number, src: string, codepoints: number[] }

function parseFaces(css: string): Face[] {
  return [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => {
    const family = /font-family:'([^']+)'/.exec(body!)![1]!
    const weight = Number(/font-weight:(\d+)/.exec(body!)![1])
    const src = /src:url\(([^)]+)\) format\('woff2'\)/.exec(body!)![1]!
    const codepoints = /unicode-range:([^;]+)/.exec(body!)![1]!.split(',').flatMap((token) => {
      const [start, end = start] = token.replace('U+', '').split('-').map((hex) => Number.parseInt(hex, 16))
      return Array.from({ length: end! - start! + 1 }, (_, offset) => start! + offset)
    })
    return { family, weight, src, codepoints }
  })
}

const inlineFaces = parseFaces(inlineCss)
const extendedFaces = parseFaces(extendedCss)
const allFaces = [...inlineFaces, ...extendedFaces]
const sha12 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 12)

describe('LINE Seed TW 完整字型分片', () => {
  it.each([[700, 'chars-bd.txt'], [800, 'chars-eb.txt']])('%i 的 unicode-range 互斥，聯集就是完整字表 %s', (weight, charsFile) => {
    const faces = allFaces.filter((face) => face.weight === weight)
    const covered = faces.flatMap((face) => face.codepoints)
    expect(new Set(covered).size).toBe(covered.length)
    const chars = codepointsOf(readText(`../public/assets/fonts/${charsFile}`))
    // 空白不在字形裡，只有 critical 的 unicode-range 帶 U+20（first available font 決定行框高度）
    expect(new Set(covered)).toEqual(new Set([...chars, 0x20]))
    expect(faces.filter((face) => face.codepoints.includes(0x20)).map((face) => face.src)).toEqual([expect.stringMatching(/-critical-/)])
  })

  it('字表是完整字型：超過一萬字、依碼位排序、不含空白，涵蓋既有 737 字', () => {
    const text = readText('../public/assets/fonts/chars-bd.txt')
    const chars = codepointsOf(text)
    expect(chars.length).toBeGreaterThan(13_000)
    expect(chars).toEqual([...new Set(chars)].sort((a, b) => a - b))
    expect(/\s/.test(text)).toBe(false)
    expect(siteChars.size).toBe(737)
    for (const cp of siteChars) expect(chars).toContain(cp)
    expect(readText('../public/assets/fonts/chars-eb.txt')).toBe(text)
  })

  it('只預載首屏 critical，總量不超過改版前', () => {
    expect(fontManifest.preload.length).toBeGreaterThan(0)
    let total = 0
    for (const src of fontManifest.preload) {
      expect(src).toMatch(/-critical-[0-9a-f]{12}\.woff2$/)
      expect(inlineFaces.map((face) => face.src)).toContain(src)
      total += publicFile(src).length
    }
    expect(total).toBeLessThanOrEqual(PRELOAD_BUDGET)
  })

  it('官網既有用字仍由 inline 的 font-subsets.css 宣告，只有首屏字重在 inline', () => {
    expect(new Set(inlineFaces.map((face) => face.weight))).toEqual(new Set([700]))
    const inline = new Set(inlineFaces.flatMap((face) => face.codepoints))
    for (const cp of siteChars) expect(inline.has(cp)).toBe(true)
    expect(extendedFaces.length).toBeGreaterThan(inlineFaces.length)
  })

  it('LINE Seed TW 只由產生的兩支 CSS 宣告', () => {
    expect(allFaces.every((face) => face.family === 'LINE Seed TW')).toBe(true)
    for (const name of readdirSync(local('../app/assets/css/'))) {
      if (name === 'font-subsets.css' || !name.endsWith('.css')) continue
      expect(readText(`../app/assets/css/${name}`), name).not.toMatch(/@font-face\{[^}]*LINE Seed TW/)
    }
    const config = readText('../nuxt.config.ts')
    expect(config).toContain('fontManifest.preload')
    expect(config).not.toMatch(/lineseed-(bd|eb)\.woff/)
  })

  it('分片檔名帶內容雜湊、是 WOFF2、每片不超過 60 KB，目錄沒有殘留舊檔', () => {
    const referenced = new Set([fontManifest.stylesheet.src])
    for (const face of allFaces) {
      const bytes = publicFile(face.src)
      expect(bytes.subarray(0, 4).toString('latin1'), face.src).toBe('wOF2')
      expect(face.src).toContain(`-${sha12(bytes)}.woff2`)
      expect(bytes.length, face.src).toBeLessThanOrEqual(SLICE_LIMIT)
      referenced.add(face.src)
    }
    expect(fontManifest.stylesheet.src).toContain(`-${sha12(publicFile(fontManifest.stylesheet.src))}.css`)
    const files = readdirSync(local('../public/assets/fonts/subsets/')).map((name) => `/assets/fonts/subsets/${name}`)
    expect(new Set(files)).toEqual(referenced)
  })

  it('OFL 授權檔保留在字型旁', () => {
    const license = readText('../public/assets/fonts/lineseed-tw-OFL.txt')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('Reserved Font Name "LINE Seed TW"')
  })
})

describe('attachTitleFontStylesheet', () => {
  it('把其餘分片的樣式表掛到 <head>，重複呼叫只掛一次', () => {
    // happy-dom 預設會真的去抓 <link> 的 CSS，這裡只驗 DOM
    const { settings } = (window as unknown as { happyDOM: { settings: { disableCSSFileLoading: boolean, handleDisabledFileLoadingAsSuccess: boolean } } }).happyDOM
    settings.disableCSSFileLoading = true
    settings.handleDisabledFileLoadingAsSuccess = true
    const href = fontManifest.stylesheet.src
    const first = attachTitleFontStylesheet(document, href)
    const second = attachTitleFontStylesheet(document, href)
    expect(second).toBe(first)
    expect(first.rel).toBe('stylesheet')
    expect(first.getAttribute('href')).toBe(href)
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
  })
})
