import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// 2026-11-13：iOS 15 的訪客整站看到「500 網站暫時無法顯示」。
// 原因有兩個，都出在打包設定（nuxt.config.ts），這裡守住設定不被改回去：
// 1. Nuxt 預設用 import map 把 chunk 裡的 `#entry` 對到進入點；Safari 16.4 以前沒有 import map，
//    每個 chunk 都載入失敗（Module specifier, '#entry' does not start with "/"…），頁面被換成錯誤頁。
// 2. Vite 預設目標是 Safari 16.4：CSS 的 `@media (max-width:760px)` 會被縮寫成 `(width<=760px)`，
//    Safari 16.4 以前不認得，手機版樣式整批不套用。
// 目標定在 15.4 而不是 15.0：15.4 起才有 oklch()、svh、:has()，全站色票都是 oklch，
// 降到 15.0 會讓每個顏色多出一份 rgb 後備，其他瀏覽器跟著變大；停在 iOS 15 的機種都能更新到 15.8。
interface Config { experimental?: { entryImportMap?: boolean }; vite?: { build?: { target?: string[]; cssTarget?: string[] } } }

describe('打包目標涵蓋 iOS 15（Safari 15.4 以上）', () => {
  let config: Config
  beforeAll(async () => {
    ;(globalThis as { defineNuxtConfig?: unknown }).defineNuxtConfig = (value: unknown) => value
    config = (await import('../nuxt.config')).default as Config
  })
  it('不用 import map（#entry）', () => {
    expect(config.experimental?.entryImportMap).toBe(false)
  })
  it('JS 與 CSS 的目標都含 safari15.4／ios15.4，其餘照 Vite 預設', () => {
    const expected = ['chrome111', 'edge111', 'firefox114', 'safari15.4', 'ios15.4']
    expect(config.vite?.build?.target).toEqual(expected)
    // cssTarget 沒寫就跟著 target；寫了就得一樣，不然 CSS 又會縮寫成舊 Safari 看不懂的寫法。
    expect(config.vite?.build?.cssTarget ?? config.vite?.build?.target).toEqual(expected)
  })
})

// 打包目標管得到語法（class static block、CSS 的範圍寫法），管不到「字串裡的東西」與正規式的功能：
// 這兩種在 Safari 16.4 以前不是載入失敗就是靜靜地不成立，要在原始碼擋。
describe('原始碼不用 Safari 16.4 以前沒有的寫法', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path)
    return /\.(?:ts|vue|js|mjs)$/.test(entry.name) ? [path] : []
  })
  const files = [...sources(join(__dirname, '../app')), ...sources(join(__dirname, '../shared'))].map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  const offenders = (pattern: RegExp) => files.filter(({ text }) => pattern.test(text)).map(({ path }) => path.slice(path.indexOf('/web/') + 5))

  it('正規式不用 lookbehind：(?<= 與 (?<!（整個頁面的程式會在執行到那一行時丟 SyntaxError）', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(offenders(/\(\?<[=!]/)).toEqual([])
  })
  it('matchMedia 不用範圍寫法 (width <= 900px)，要寫 (max-width: 900px)（舊 Safari 會當成永遠不成立）', () => {
    expect(offenders(/matchMedia\(\s*[`'"][^`'"]*[<>]/)).toEqual([])
  })
})
