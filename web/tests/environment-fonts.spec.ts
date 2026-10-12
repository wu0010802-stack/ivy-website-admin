import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fontManifest from '../app/generated/environment-font-manifest.json'

// 環境頁字型（scripts/subset-environment-fonts.py 產生）的交付規則：圓體 400／700／800 與手寫芫荽四個字重
// 都有 critical 分片，也都有「其餘」分片（2026-10-12 起 700、800 也補，後台改的字才不會退回系統字）；
// manifest 的數字、樣式表、字表 chars-environment.txt 與實際檔案一致。
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const readText = (path: string) => readFileSync(local(path), 'utf8')
const publicPath = (url: string) => local(`../public${url}`)
const inlineCss = readText('../app/assets/css/environment-fonts.css')
const extendedCss = readFileSync(publicPath(fontManifest.stylesheet.src), 'utf8')
const SLICE_LIMIT = 60_000

interface Rule { family: string, weight: number, src: string, codepoints: number[], kind: 'inline' | 'extended' }

function parseRules(css: string, kind: Rule['kind']): Rule[] {
  return [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => {
    const family = /font-family:'([^']+)'/.exec(body!)![1]!
    const weight = Number(/font-weight:(\d+)/.exec(body!)![1])
    const src = /src:url\(([^)]+)\) format\('woff2'\)/.exec(body!)![1]!
    const codepoints = /unicode-range:([^;}]+)/.exec(body!)![1]!.split(',').flatMap((token) => {
      const [start, end = start] = token.replace('U+', '').split('-').map((hex) => Number.parseInt(hex, 16))
      return Array.from({ length: end! - start! + 1 }, (_, offset) => start! + offset)
    })
    return { family, weight, src, codepoints, kind }
  })
}

const rules = [...parseRules(inlineCss, 'inline'), ...parseRules(extendedCss, 'extended')]
const FAMILY = { round: 'Chiron GoRound TC', hand: 'Iansui' } as const
type Entry = { family: string, weight: number, characters: number, slices: number, bytes: number, largest: number, critical: { src: string, bytes: number, characters: number } }
const faces = fontManifest.faces as Record<string, Entry>
const rulesOf = (key: string) => {
  const [code, weight] = key.split('-') as [keyof typeof FAMILY, string]
  return rules.filter((rule) => rule.family === FAMILY[code] && rule.weight === Number(weight))
}

describe('環境頁字型分片', () => {
  it('四個字重都有 critical 與其餘分片：圓體 700、800 也不只首屏那一片', () => {
    expect(Object.keys(faces).sort()).toEqual(['hand-400', 'round-400', 'round-700', 'round-800'])
    for (const key of Object.keys(faces)) {
      const own = rulesOf(key)
      expect(own.filter((rule) => rule.kind === 'inline').length, `${key} inline`).toBeGreaterThanOrEqual(1)
      expect(own.filter((rule) => rule.kind === 'extended').length, `${key} extended`).toBeGreaterThanOrEqual(1)
      expect(faces[key]!.slices, key).toBe(own.length)
    }
    // 常用字頻表有一萬多字，每片約 40 KB：700 補到全部（一百多片），800 只補最常用的幾千字（二十幾片），不是只補幾百字
    expect(rulesOf('round-700').filter((rule) => rule.kind === 'extended').length).toBeGreaterThan(100)
    expect(rulesOf('round-800').filter((rule) => rule.kind === 'extended').length).toBeGreaterThan(20)
  })

  it('manifest 的字數、片數、大小與樣式表、實際檔案一致；每片不超過 60 KB', () => {
    for (const [key, face] of Object.entries(faces)) {
      const own = rulesOf(key)
      const sizes = own.map((rule) => {
        const file = publicPath(rule.src)
        expect(existsSync(file), `${key} ${rule.src}`).toBe(true)
        return statSync(file).size
      })
      expect(sizes.reduce((sum, size) => sum + size, 0), `${key} bytes`).toBe(face.bytes)
      expect(Math.max(...sizes), `${key} largest`).toBe(face.largest)
      // 上限只管其餘分片；critical 是本頁實際用字，圓體 400 的英數標點加進去後 118 KB
      const extendedSizes = own.flatMap((rule, i) => (rule.kind === 'extended' ? [sizes[i]!] : []))
      expect(Math.max(...extendedSizes), `${key} 其餘分片每片上限`).toBeLessThanOrEqual(SLICE_LIMIT)
      const covered = own.flatMap((rule) => rule.codepoints)
      expect(new Set(covered).size, `${key} unicode-range 互斥`).toBe(covered.length)
      expect(covered.length, `${key} characters`).toBe(face.characters)
      expect(face.critical.src).toBe(own.find((rule) => rule.kind === 'inline' && rule.src === face.critical.src)!.src)
      expect(statSync(publicPath(face.critical.src)).size).toBe(face.critical.bytes)
    }
  })

  it('輸出目錄裡沒有沒人用的舊檔：只有分片、樣式表與兩份授權', () => {
    const referenced = new Set([
      ...rules.map((rule) => rule.src.split('/').pop()!),
      fontManifest.stylesheet.src.split('/').pop()!,
      'chiron-goround-tc-OFL.txt',
      'iansui-OFL.txt',
    ])
    expect(new Set(readdirSync(local('../public/assets/fonts/environment')))).toEqual(referenced)
    expect(statSync(publicPath(fontManifest.stylesheet.src)).size).toBe(fontManifest.stylesheet.bytes)
  })

  it('整個輸出目錄不超過 15 MB（規格第 11 節風險）：圓體 800 只補最常用的字，700 補到字頻表全部', () => {
    const dir = local('../public/assets/fonts/environment')
    const total = readdirSync(dir).reduce((sum, name) => sum + statSync(`${dir}/${name}`).size, 0)
    expect(total).toBeLessThanOrEqual(15_000_000)
    expect(faces['round-800']!.characters).toBeLessThan(faces['round-700']!.characters)
    expect(faces['round-800']!.characters).toBeGreaterThan(3000)
    expect(faces['round-700']!.characters).toBe(faces['round-400']!.characters)
  })

  it('預載只有大標那一片（圓體 800 critical）', () => {
    expect(fontManifest.preload).toEqual([faces['round-800']!.critical.src])
  })
})

describe('後台缺字提示讀的字表', () => {
  const sets = (keys: string[]) => keys.map((key) => new Set(rulesOf(key).flatMap((rule) => rule.codepoints)))
  const shared = (keys: string[]) => {
    const [first, ...rest] = sets(keys)
    return [...first!].filter((cp) => rest.every((set) => set.has(cp)) && !/\s/.test(String.fromCodePoint(cp))).sort((a, b) => a - b)
  }
  const strict = readText('../public/assets/fonts/chars-environment.txt')
  const text = readText('../public/assets/fonts/chars-environment-text.txt')
  const codepoints = (value: string) => [...value].map((char) => char.codePointAt(0)!)

  it('chars-environment.txt 等於四個字重都有的字：依碼位排序、不含空白，格式同 chars-bd.txt（用在圓體 800 的大標）', () => {
    expect(codepoints(strict)).toEqual(shared(Object.keys(faces)))
    expect(/\s/.test(strict)).toBe(false)
  })

  it('chars-environment-text.txt 等於圓體 400、700 與芫荽都有的字（用在小標、內文、便條；800 只補常用字，所以比上一份多）', () => {
    expect(codepoints(text)).toEqual(shared(['round-400', 'round-700', 'hand-400']))
    expect(/\s/.test(text)).toBe(false)
    expect(codepoints(text).length).toBeGreaterThan(codepoints(strict).length)
    for (const char of strict) expect(text, char).toContain(char)
  })

  it('常用字在表內、罕用字不在；800 沒補到的字（例如「敞」）只在內文那份', () => {
    for (const file of [strict, text]) {
      for (const char of '孩子每一天都在這裡開心長大，。') expect(file, char).toContain(char)
      expect(file).not.toContain('𠮷')
    }
    expect(codepoints(strict).length).toBeGreaterThan(3000)
    expect(strict).not.toContain('敞')
    expect(text).toContain('敞')
  })
})
