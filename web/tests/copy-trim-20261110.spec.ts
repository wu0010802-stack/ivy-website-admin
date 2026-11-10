import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-10 使用者要拿掉：首頁孩子的一天的作息提醒、特色教學頁四個年段下的兩個延伸連結。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('首頁孩子的一天不留作息提醒', () => {
  it('說明是空的就整行不畫（園方在後台另外寫的才畫）', () => {
    const day = read('../app/components/DayExperience.vue')
    expect(day).toContain('<p v-if="day.note" class="day-note">{{ day.note }}</p>')
  })
  it('說明拿掉後，最後一排卡片下面補回原本的收尾留白', () => {
    const styles = read('../app/assets/css/styles.css')
    expect(styles).toMatch(/\.day-prints:last-child\{padding-bottom:[^}]+\}/)
  })
})

describe('特色教學頁四個年段不放延伸連結', () => {
  const page = read('../app/components/CurriculumContent.vue')
  const css = read('../app/assets/css/curriculum.css')
  it('拿掉「用生日查孩子讀哪一班」「課綱六大領域與核心素養」', () => {
    expect(page).not.toContain('用生日查孩子讀哪一班')
    expect(page).not.toContain('課綱六大領域與核心素養')
    expect(page).not.toContain('cur-link')
  })
  it('連結的樣式一起清掉', () => {
    expect(css).not.toContain('cur-link')
  })
})
