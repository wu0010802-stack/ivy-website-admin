import { describe, expect, it } from 'vitest'
import { formatVital, trafficPageLabel } from '../api/traffic'

describe('官網瀏覽與速度', () => {
  it('頁面名稱用園方看得懂的字', () => {
    expect(trafficPageLabel({ page: 'home', campus_key: null })).toBe('首頁')
    expect(trafficPageLabel({ page: 'campus', campus_key: 'renwu' })).toBe('仁武校介紹頁')
    expect(trafficPageLabel({ page: 'visit', campus_key: 'yihua' })).toBe('義華校預約頁')
    expect(trafficPageLabel({ page: 'visit', campus_key: null })).toBe('預約參觀（選校）')
  })

  it('指標單位：LCP 秒、INP 毫秒、CLS 無單位', () => {
    expect(formatVital('LCP', 2345)).toBe('2.3 秒')
    expect(formatVital('INP', 187.6)).toBe('188 毫秒')
    expect(formatVital('CLS', 0.1234)).toBe('0.12')
  })
})
