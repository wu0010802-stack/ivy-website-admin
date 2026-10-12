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

  // 行政區最多 6 個漢字＋「區」、里最多 8 個漢字＋「里」（高雄 38 區、893 里實際最長 4 字與 6 字，留餘裕）；
  // 手改的網址帶超長值當成沒篩，不往後端送、也不拿來組提示句。
  it('過長的值當成沒篩：行政區超過 6 字、里超過 8 字、整串超長；剛好在上限內的照收', () => {
    const district6 = '一二三四五六區'
    const village8 = '一二三四五六七八里'
    expect(parseAreaQuery(district6)).toEqual({ kind: 'place', district: district6, village: null })
    expect(parseAreaQuery(`三民區/${village8}`)).toEqual({ kind: 'place', district: '三民區', village: village8 })
    expect(parseAreaQuery('一二三四五六七區')).toBeNull()
    expect(parseAreaQuery('三民區/一二三四五六七八九里')).toBeNull()
    expect(parseAreaQuery(`${'三'.repeat(5000)}區`)).toBeNull()
    expect(parseAreaQuery(`三民區/${'本'.repeat(5000)}里`)).toBeNull()
    expect(parseAreaQuery('x'.repeat(100000))).toBeNull()
    expect(parseAreaQuery(`no_village${'x'.repeat(50)}`)).toBeNull()
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
    // 後端只給 village 沒給 district 會回 422 VILLAGE_NEEDS_DISTRICT（避免跨區同名）：有里就一定同時送區。
    for (const value of ['三民區/本揚里', '鼓山區/北美術館里', '那瑪夏區/達卡努瓦里']) {
      const params = areaApiParams(parseAreaQuery(value))
      expect(params.district).not.toBeNull()
      expect(params.village).not.toBeNull()
    }
  })
})
