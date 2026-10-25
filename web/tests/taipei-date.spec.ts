import { describe, expect, it } from 'vitest'
import { taipeiIsoDate } from '../app/utils/taipei-date'

describe('taipeiIsoDate（固定 UTC+8，2026-10-25 取代 Intl timeZone）', () => {
  const intl = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

  it('換日、換月、換年、閏日前後都和 Intl 的 Asia/Taipei 一致', () => {
    const edges = ['2026-10-24T15:59:59.999Z', '2026-10-24T16:00:00Z', '2026-07-31T16:00:00Z', '2026-12-31T15:59:59Z', '2026-12-31T16:00:00Z', '2028-02-28T16:00:00Z', '2028-02-29T16:00:00Z']
    for (const iso of edges) expect(taipeiIsoDate(new Date(iso)), iso).toBe(intl(new Date(iso)))
  })

  it('一年內每小時都和 Intl 一致（台灣沒有日光節約時間）', () => {
    const start = Date.UTC(2026, 0, 1)
    for (let h = 0; h < 366 * 24; h++) {
      const d = new Date(start + h * 3_600_000)
      if (taipeiIsoDate(d) !== intl(d)) throw new Error(d.toISOString())
    }
  })
})
