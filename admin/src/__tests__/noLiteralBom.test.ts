/// <reference types="node" />
// 原始碼裡不放實體 U+FEFF（BOM）：它是看不見的字元，貼進字串字面值後沒人看得出來，
// 刪掉或複製時也容易出事。要寫就用跳脫。直接比對位元組（EF BB BF），含 __tests__；
// 用 readdirSync 掃整個 src，新檔自動納入，不維護固定檔名清單。
// 後端有同樣的守門：backend/tests/test_csv_export.py。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe('原始碼不含實體 BOM', () => {
  it('admin/src 底下所有 .ts／.vue 都沒有 EF BB BF', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const offenders = files.filter((file) => readFileSync(file).includes(bom)).map((file) => relative(SRC, file))
    expect(offenders).toEqual([])
  })
})
