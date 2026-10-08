import { describe, expect, it } from 'vitest'
import { areaApiParams, areaNotice, areaQuery, parseAreaQuery } from '../admissions/areaFilter'

describe('區域篩選（網址 area，2026-10-08）', () => {
  it('行政區、里、未定位到里三種寫法可以來回轉', () => {
    for (const value of ['三民區', '三民區/本揚里', 'no_village', '鼓山區/北美術館里', '那瑪夏區/達卡努瓦里']) {
      const filter = parseAreaQuery(value)
      expect(filter).not.toBeNull()
      expect(areaQuery(filter!)).toBe(value)
    }
    expect(parseAreaQuery('三民區/本揚里')).toEqual({ kind: 'place', district: '三民區', village: '本揚里' })
    expect(parseAreaQuery('no_village')).toEqual({ kind: 'no_village' })
  })

  it('手改的網址當成沒篩：不是「○○區」「○○區/○○里」也不是 no_village', () => {
    for (const value of ['', 'hack', '三民', '三民區/abc', '三民區/本揚里/x', '/本揚里', '三民區/', 'NO_VILLAGE', 42, null, undefined, ['三民區']]) {
      expect(parseAreaQuery(value)).toBeNull()
    }
  })

  it('提示句與 API 參數', () => {
    const village = parseAreaQuery('三民區/本揚里')!
    const district = parseAreaQuery('三民區')!
    const none = parseAreaQuery('no_village')!
    expect(areaNotice(village)).toBe('只顯示三民區本揚里的訪視。')
    expect(areaNotice(district)).toBe('只顯示三民區的訪視。')
    expect(areaNotice(none)).toBe('只顯示未定位到里的訪視（只到區、查無門牌、非高雄市地址或待比對）。')
    expect(areaApiParams(village)).toEqual({ district: '三民區', village: '本揚里', geo: null })
    expect(areaApiParams(district)).toEqual({ district: '三民區', village: null, geo: null })
    expect(areaApiParams(none)).toEqual({ district: null, village: null, geo: 'no_village' })
    expect(areaApiParams(null)).toEqual({ district: null, village: null, geo: null })
  })
})
