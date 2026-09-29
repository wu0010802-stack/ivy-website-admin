// 入學資訊頁（/admission）明體字型切片：scripts/subset-admission-fonts.py 產生，流程比照
// scripts/subset-environment-fonts.py（見 web/tests/environment.spec.ts 對應測試）。差異只在來源是靜態 CFF
// OTF（Noto Serif TC SemiBold 600／Black 900，沒有 glyf、不做 instancer）與只有 critical＋900 的其餘分片
// （600 小標是寫死文案，沒有其餘分片）。
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fontManifest from '../app/generated/admission-font-manifest.json'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const publicFile = (url: string) => fileURLToPath(new URL(`../public${url}`, import.meta.url))

describe('入學資訊頁明體字型（Ivy Passport Serif，Noto Serif TC 靜態子集）', () => {
  const faces = fontManifest.faces as Record<string, { family: string; weight: number; critical: { src: string; bytes: number; characters: number } }>
  const inline = read('../app/assets/css/admission-fonts.css')

  it('900（印章）／600（小標）各有 critical 分片，900 那片預載，檔案都在 public', () => {
    expect(Object.keys(faces).sort()).toEqual(['serif-600', 'serif-900'])
    expect(fontManifest.preload).toEqual([faces['serif-900']!.critical.src])
    for (const [key, face] of Object.entries(faces)) {
      expect(existsSync(publicFile(face.critical.src)), key).toBe(true)
      expect(inline).toContain(`src:url(${face.critical.src})`)
      expect(face.family).toBe('Ivy Passport Serif')
    }
  })

  it('CSS family 一律叫 Ivy Passport Serif（避免跟系統可能裝的 Noto Serif TC 混用），字重 600／900 都有宣告', () => {
    for (const weight of [600, 900]) expect(inline).toContain(`font-family:'Ivy Passport Serif';font-weight:${weight};`)
    expect(inline).not.toContain("font-family:'Noto Serif TC'")
  })

  it('其餘分片樣式表存在（只有 900 印章字有，600 小標只切 critical）', () => {
    expect(existsSync(publicFile(fontManifest.stylesheet.src))).toBe(true)
    const extended = readFileSync(publicFile(fontManifest.stylesheet.src), 'utf8')
    expect(extended).toContain("font-family:'Ivy Passport Serif';font-weight:900;")
    expect(extended).not.toContain('font-weight:600;')
  })

  it('授權全文在 public，是沒有 Reserved Font Name 的 OFL 1.1', () => {
    const licensePath = publicFile('/assets/fonts/admission/noto-serif-tc-OFL.txt')
    expect(existsSync(licensePath)).toBe(true)
    const license = readFileSync(licensePath, 'utf8')
    const flat = license.split(/\s+/).join(' ')
    expect(flat).toContain('SIL Open Font License, Version 1.1')
    expect(flat).not.toContain('Reserved Font Name "')
  })

  it('來源記錄 SemiBold 600／Black 900 的 sha256（64 碼十六進位）', () => {
    const sources = fontManifest.sources as Array<{ weight: number; style: string; sha256: string }>
    expect(sources.map((s) => s.weight).sort()).toEqual([600, 900])
    for (const source of sources) expect(source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sources.find((s) => s.weight === 600)?.style).toBe('SemiBold')
    expect(sources.find((s) => s.weight === 900)?.style).toBe('Black')
  })

  it('同一字重內 unicode-range 互斥（critical 與其餘分片不重疊）', () => {
    const extended = readFileSync(publicFile(fontManifest.stylesheet.src), 'utf8')
    const ranges = (css: string, weight: number) => css.split('\n')
      .filter((line) => line.includes(`font-family:'Ivy Passport Serif';font-weight:${weight};`))
      .flatMap((line) => (line.match(/unicode-range:([^}]+)/)?.[1] ?? '').split(',').filter(Boolean))
      .flatMap((range) => {
        const [a, b = a] = range.replace('U+', '').split('-').map((hex) => parseInt(hex, 16))
        const codepoints: number[] = []
        for (let cp = a!; cp <= b!; cp++) codepoints.push(cp)
        return codepoints
      })
    const critical900 = new Set(ranges(inline, 900))
    const rest900 = ranges(extended, 900)
    for (const cp of rest900) expect(critical900.has(cp), `U+${cp.toString(16)}`).toBe(false)
    expect(new Set(rest900).size).toBe(rest900.length)
  })

  it('一開始畫得到的字都在 critical（admission-font-chars.json；900 印章字、600 小標）', () => {
    const chars = JSON.parse(read('../app/generated/admission-font-chars.json')).groups as Record<string, string>
    const covered = (weight: number) => {
      const rule = inline.split('\n').find((line) => line.includes(`font-family:'Ivy Passport Serif';font-weight:${weight};`))
      const ranges = (rule?.match(/unicode-range:([^}]+)/)?.[1] ?? '').split(',').filter(Boolean)
      return (cp: number) => ranges.some((range) => {
        const [a, b = a] = range.replace('U+', '').split('-').map((hex) => parseInt(hex, 16))
        return cp >= a! && cp <= b!
      })
    }
    for (const [key, text] of Object.entries(chars)) {
      const weight = Number(key.split('-')[1])
      const inCritical = covered(weight)
      for (const char of new Set(text)) expect(inCritical(char.codePointAt(0)!), `${key} ${char}`).toBe(true)
    }
  })
})
