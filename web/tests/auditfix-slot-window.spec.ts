import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newBookingSlotsQuery, slotsQueryWindow } from '../app/utils/visit-form'

// 2026-10-20 稽核：最遠開放可以設到 90 天以上，官網與改期頁寫死 60 天會讓 61 天以後的場次永遠看不到。
// 改成查到伺服器允許的最遠（一年），伺服器截到各校設定的開放範圍為止。

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8')

describe('查場次的區間', () => {
  it('從今天查到一年後，由伺服器截到該校的開放範圍', () => {
    expect(slotsQueryWindow('2026-10-13')).toEqual({ date_from: '2026-10-13', date_to: '2027-10-13' })
  })

  it('新預約表單用同一個區間', () => {
    expect(newBookingSlotsQuery('yihua', '2026-10-13')).toEqual({
      campus_key: 'yihua', date_from: '2026-10-13', date_to: '2027-10-13', purpose: 'new_booking',
    })
  })

  it('家長改期頁不再寫死 60 天', () => {
    const source = read('app/composables/useParentVisit.ts')
    expect(source).toContain('slotsQueryWindow(')
    expect(source).not.toContain('60 * 86400000')
  })
})
