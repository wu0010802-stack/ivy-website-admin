import { describe, expect, it } from 'vitest'
import {
  childrenShade, childrenStops, resolveStop, retiredNote, stopKey, stopLabel, yearChangeText,
} from '../components/admissions/area/childrenHistory'
import { areaChildrenHistory } from './admissionsTestKit'

const data = areaChildrenHistory()
const [benYang, baoYe, dingJin] = data.villages
const stops = childrenStops(data)

describe('歷年 2–5 歲滑桿的純函式（2026-11-16 規格 §5.3）', () => {
  it('格子：九月年份加最新；沒有最新就不加', () => {
    expect(stops).toEqual([107, 108, 114, 115, 'latest'])
    expect(childrenStops(areaChildrenHistory({ latest: null }))).toEqual([107, 108, 114, 115])
  })

  it('標籤：年份寫民國年，最新寫月份', () => {
    expect(stopLabel(107, data)).toBe('107')
    expect(stopLabel('latest', data)).toBe('最新 115.10')
    expect(stopKey(108)).toBe('108')
    expect(stopKey('latest')).toBe('latest')
  })

  it('色階：所有年份共用最大值，沒有資料的里保留 null', () => {
    const shade = childrenShade(data, 107)
    expect(shade.max).toBe(520)
    expect(shade.byCode.get('64000050015')).toBe(360)
    expect(shade.byCode.get('64000050025')).toBeNull()
    expect(childrenShade(data, 'latest').byCode.get('64000050025')).toBe(200)
  })

  it('比前一年：一般寫正負數', () => {
    expect(yearChangeText(benYang, 108, stops, '115-10')).toBe('比前一年 +20')
    expect(yearChangeText(dingJin, 108, stops, '115-10')).toBe('比前一年 +20')
    expect(yearChangeText({ ...benYang, counts: { ...benYang.counts, '108': 350 } }, 108, stops, '115-10')).toBe('比前一年 −10')
  })

  it('比前一年：第一格、前一格沒有資料都不寫', () => {
    expect(yearChangeText(benYang, 107, stops, '115-10')).toBe('')
    expect(yearChangeText(baoYe, 115, stops, '115-10')).toBe('')
    expect(yearChangeText(baoYe, 'latest', stops, '115-10')).toBe('比前一年 +4')
  })

  it('比前一年：兩點之間有界線調整的月份就寫調整，不寫增減', () => {
    expect(yearChangeText(dingJin, 115, stops, '115-10')).toBe('界線 115-07 調整')
    // 115-09 → 115-10 之間沒有 115-07：照常寫
    expect(yearChangeText(dingJin, 'latest', stops, '115-10')).toBe('比前一年 +10')
    // 114 之前的比較不受 115-07 影響
    expect(yearChangeText(dingJin, 114, stops, '115-10')).toBe('比前一年 +20')
  })

  it('已廢止的里：這一年有資料的才提，名稱最多列三個', () => {
    expect(retiredNote(data, 107)).toBe('同區另有 2 個已廢止的里（廍北里、廍南里）有這年的資料，地圖上畫不出來。')
    expect(retiredNote(data, 108)).toBe('同區另有 1 個已廢止的里（廍北里）有這年的資料，地圖上畫不出來。')
    expect(retiredNote(data, 114)).toBe('')
    expect(retiredNote(data, 'latest')).toBe('')
    const many = areaChildrenHistory({
      retired: ['甲', '乙', '丙', '丁'].map((name, i) => ({ village_code: `6400005099${i}`, district: '三民區', village: name, years: [107] })),
    })
    expect(retiredNote(many, 107)).toBe('同區另有 4 個已廢止的里（甲、乙、丙等）有這年的資料，地圖上畫不出來。')
  })

  it('網址年份不在格子裡一律退回最新', () => {
    expect(resolveStop(108, stops)).toBe(108)
    expect(resolveStop(999, stops)).toBe('latest')
    expect(resolveStop(106, stops)).toBe('latest')
    expect(resolveStop(null, stops)).toBe('latest')
    expect(resolveStop(999, [107, 108])).toBe(108)
    expect(resolveStop(null, [])).toBe('latest')
  })
})
