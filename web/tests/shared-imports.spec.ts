import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// app/ 引用 shared/ 要寫 #shared/…：nuxt build 的 SSR bundle 會把 shared/ 外部化，
// 相對路徑放進 _nuxt/ 子目錄的 chunk 後少一層，production build 直接失敗
// （2026-09-26 cta-analytics 就是這樣，見 web/vitest.config.ts）。
const APP_DIR = resolve(__dirname, '../app')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe('app/ 引用 shared/ 的寫法', () => {
  it('一律用 #shared 別名，不用相對路徑', () => {
    const offenders = sourceFiles(APP_DIR)
      .filter((file) => /from\s+['"](\.\.\/)+shared\//.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP_DIR, file))
    expect(offenders).toEqual([])
  })
})
