import { describe, expect, it } from 'vitest'
import { AREA_COMPARE_NOTE, areaCompareCells } from '../admissions/areaCompareFormat'
import { areaCompare, areaCompareRow } from './admissionsTestKit'

const [yihua, minghua, chongde, international, renwu] = areaCompare().rows

describe('五校周邊環境表的格子文字（2026-11-16 規格 §6.2）', () => {
  it('一般列：各欄文字', () => {
    expect(areaCompareCells(yihua!)).toEqual({
      campus: '義華', children: '1,200', kids_net: '−412', kg_private: '14', kg_quasi_public: '9', kg_public: '3', kg_nonprofit: '2',
      babycare: '5', own_fee: '89,750 元', fee_median: '75,000 元', fee_rank: '第 2 高／共 15', changes_12m: '1',
    })
  })

  it('增減：正數有加號、0 就是 0、算不出來是破折號', () => {
    expect(areaCompareCells(areaCompareRow({ kids_net: 35 })).kids_net).toBe('+35')
    expect(areaCompareCells(renwu!).kids_net).toBe('0')
    expect(areaCompareCells(areaCompareRow({ kids_net: null, kids_unavailable: 'no_year_ago' })).kids_net).toBe('—')
  })

  it('本校不是私立一般：排名寫「本校準公共」，中位數照列', () => {
    const cells = areaCompareCells(minghua!)
    expect(cells.fee_rank).toBe('本校準公共')
    expect(cells.fee_median).toBe('75,000 元')
    expect(areaCompareCells(areaCompareRow({ own_kind: 'public', fee_rank: null })).fee_rank).toBe('本校公立')
  })

  it('本校沒有收費資料：收費與排名寫原因', () => {
    const cells = areaCompareCells(renwu!)
    expect(cells.own_fee).toBe('—')
    expect(cells.fee_rank).toBe('本校沒有公布收費')
    expect(areaCompareCells(areaCompareRow({ own_fee: null, own_kind: null, own_missing: 'not_found', fee_rank: null })).fee_rank).toBe('找不到本校')
  })

  it('沒有座標或計算失敗：校區後附原因，其餘全是破折號', () => {
    const noPoint = areaCompareCells(chongde!)
    expect(noPoint.campus).toContain('崇德')
    expect(noPoint.campus).toContain('位置未標示')
    expect(Object.entries(noPoint).filter(([key]) => key !== 'campus').every(([, value]) => value === '—')).toBe(true)
    const failed = areaCompareCells(international!)
    expect(failed.campus).toBe('國際（讀取失敗）')
    expect(failed.children).toBe('—')
  })

  it('表下說明', () => {
    expect(AREA_COMPARE_NOTE).toBe('人口為最新月份；收費為 3 歲、和私立一般園所比；幼兒園家數不含常春藤各校。')
  })
})
