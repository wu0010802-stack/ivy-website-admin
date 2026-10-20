import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { staffSlotsRange } from '../utils/visitSchedule'

// 2026-10-20 稽核：最遠開放可以設到 90 天以上，補登與改期寫死 60 天會讓 61 天以後的場次排不進去。
// 改成從台北今天查到一年後，伺服器截到該校設定的開放範圍。

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

describe('補登與改期讀場次的區間', () => {
  it('從台北今天查到一年後（UTC 還是前一天也一樣）', () => {
    expect(staffSlotsRange(Date.parse('2026-10-19T17:00:00Z'))).toEqual({ date_from: '2026-10-20', date_to: '2027-10-20' })
  })

  it('補登與改期都用這個區間，不再寫死 60 天', () => {
    for (const file of ['components/ManualVisitDialog.vue', 'composables/useVisitCase.ts']) {
      const source = read(file)
      expect(source).toContain('staffSlotsRange(')
      expect(source).not.toContain('60 * 24 * 60 * 60 * 1000')
    }
  })

  it('沒有場次的提示不寫「未來 60 天」', () => {
    expect(read('components/ManualVisitDialog.vue')).not.toContain('未來 60 天')
    expect(read('components/visit/VisitCaseSettings.vue')).not.toContain('未來 60 天')
  })
})
