import { describe, expect, it } from 'vitest'
import type { AreaPoint } from '../api/types'
import { pointCampusHeader, pointFootnotes, pointPlace, pointRows, pointSources } from '../components/admissions/area/pointFormat'

import { point } from './pointTestKit'
const cell = (data: AreaPoint, label: string) => pointRows(data, '義華').find((row) => row.label === label)!

describe('pointFormat', () => {
  it('列順序與格子文字', () => {
    const rows = pointRows(point(), '義華')
    expect(rows.map((row) => row.label)).toEqual([
      '2–5 歲孩子', '0–1 歲', '這一年淨增', '幼兒園（私立／準公共／公立／非營利）', '托嬰', '私立一般 3 歲一學期中位',
      '在建預售（戶）', '近 12 個月園所異動', '房價中位數（萬元／坪）', '整戶月租中位數（元）', '常春藤在籍住在圈內',
    ])
    expect(cell(point(), '2–5 歲孩子').point).toBe('8,420')
    expect(cell(point(), '這一年淨增').point).toBe('+36')
    expect(cell(point(), '幼兒園（私立／準公共／公立／非營利）').point).toBe('9／6／2／1')
    expect(cell(point(), '房價中位數（萬元／坪）').point).toBe('29.9')
    expect(cell(point(), '整戶月租中位數（元）').point).toBe('18,500')
  })

  it('房價、月租不到 5 筆寫「—（N 筆）」，沒有筆數只寫「—」', () => {
    const data = point({ housing: { sale_median: null, sale_count: 3, rent_median: null, rent_count: 0 } })
    expect(cell(data, '房價中位數（萬元／坪）').point).toBe('—（3 筆）')
    expect(cell(data, '整戶月租中位數（元）').point).toBe('—')
    expect(cell(point({ housing: null }), '房價中位數（萬元／坪）').point).toBe('—')
  })

  it('在籍列：只列大於 0 的校、補「其他已匯入的校 0 位」、都沒匯入寫「尚未匯入清冊」', () => {
    expect(cell(point(), '常春藤在籍住在圈內').point).toBe('義華 40・明華 3')
    const withZero = point({ enrolled: [{ campus_key: 'yihua', count: 40 }, { campus_key: 'minghua', count: 0 }] })
    expect(cell(withZero, '常春藤在籍住在圈內').point).toBe('義華 40，其他已匯入的校 0 位')
    expect(cell(point({ enrolled: [] }), '常春藤在籍住在圈內').point).toBe('尚未匯入清冊')
  })

  it('本校沒座標：第二欄全「—」、欄頭註明原因', () => {
    const data = point({}, { unavailable: 'no_campus_point', locate_error: 'pending', children: null, enrolled: [] })
    expect(pointRows(data, '義華').every((row) => row.campus === '—')).toBe(true)
    expect(pointCampusHeader(data, '義華')).toBe('義華（位置未標示：門牌資料尚未匯入）')
    expect(pointCampusHeader(point(), '義華')).toBe('義華')
  })

  it('沒給校區時第二欄也是「—」', () => {
    expect(pointRows(point({}, null), '義華').every((row) => row.campus === '—')).toBe(true)
  })

  it('這一年淨增算不出來：格子「—」、原因只寫一次', () => {
    const data = point({ kids_net: null, kids_unavailable: 'no_year_ago' }, { kids_net: null, kids_unavailable: 'no_year_ago' })
    expect(cell(data, '這一年淨增').point).toBe('—')
    expect(pointFootnotes(data)).toEqual(['一年前的各里人口還沒匯入，這一年淨增先不算。'])
    expect(pointFootnotes(point())).toEqual([])
  })

  it('副標與來源', () => {
    expect(pointPlace(point())).toBe('三民區寶興里・最近的校區 義華 1.8 公里')
    expect(pointPlace(point({}, {}, { point: { lat: 1, lng: 1, district: null, village: null, village_code: null }, nearest_campus: null }))).toBe('不在任何里界內')
    expect(pointSources(point())).toBe('人口 115-10・收費 114 學年・實價 115S3（近 4 季）')
    const bare = point({}, {}, { sources: { population_version: null, fee_school_year: null, housing: { latest: null, seasons: [], note: '' } } })
    expect(pointSources(bare)).toBe('')
  })
})
