// 招生潛力與市佔率（2026-10-20）：市佔率、分子分母、歷年最高與國小對帳的句子。
import { describe, expect, it } from 'vitest'
import {
  WARN_SENTENCE, bestSentence, bandLabel, closureEventTitle, closureMarkers, deliveryText, detailSeats, distanceKm, elementarySentence,
  estimateHeadline, estimateRange, formatShare, includedNote, noDataText, openSeatsText, periodText, rangeBar, rangeScale, seats,
  shareSentence, sourceName, yearTitle,
} from '../components/admissions/potential/potentialFormat'
import type { PotentialCapacity, PotentialTotal } from '../api/types'
import { closureSource, noDataSources, potentialData, presaleSource, shareYear, villageSource } from './admissionsTestKit'

const check = () => potentialData().share.elementary_check!

describe('formatShare', () => {
  it('小數轉百分比、兩位小數；沒有值寫「—」', () => {
    expect(formatShare(0.0193)).toBe('1.93%')
    expect(formatShare(0.0194)).toBe('1.94%')
    expect(formatShare(0.0007)).toBe('0.07%')
    expect(formatShare(0)).toBe('0.00%')
    expect(formatShare(null)).toBe('—')
  })
})

describe('shareSentence', () => {
  it('分子 ÷ 分母，千分位', () => {
    expect(shareSentence({ registered: 189, children: 9788 })).toBe('189 ÷ 9,788 位')
    expect(shareSentence({ registered: 279, children: 14366 })).toBe('279 ÷ 14,366 位')
  })

  it('那一年沒有孩子數時分母寫「—」', () => {
    expect(shareSentence({ registered: 189, children: null })).toBe('189 ÷ — 位')
  })
})

describe('bestSentence', () => {
  const latest = shareYear()

  it('最高的是別的學年：寫出最高的市佔率與學年', () => {
    expect(bestSentence(shareYear({ school_year: 108, registered: 279, children: 14366 }), latest)).toBe('歷年最高 1.94%（108 學年）')
  })

  it('最新一年就是最高：寫「是歷年最高」', () => {
    expect(bestSentence(latest, latest)).toBe('是歷年最高')
  })

  it('沒有最高（沒有任何市佔率）回空字串', () => {
    expect(bestSentence(null, latest)).toBe('')
  })
})

describe('yearTitle', () => {
  it('點的提示：學年、分子 ÷ 分母、市佔率', () => {
    expect(yearTitle(shareYear({ school_year: 108, registered: 279, children: 14366 }))).toBe('108 學年：279 ÷ 14,366 位，1.94%')
  })
})

describe('elementarySentence', () => {
  it('一般：最新學年的校數、一年級人數、比值與歷年範圍（不含最新一年）', () => {
    expect(elementarySentence(check())).toBe(
      '國小一年級對帳：114 學年 3 公里內各里所屬的 6 所國小，一年級 2,000 位，是 6 歲戶籍的 0.82（歷年 0.80–0.85）。',
    )
  })

  it('範圍用 radius 參數；比值取兩位小數', () => {
    const wide = { ...check(), latest_ratio: 0.8234 }
    expect(elementarySentence(wide, 5)).toContain('5 公里內各里所屬的 6 所國小')
    expect(elementarySentence(wide, 5)).toContain('是 6 歲戶籍的 0.82（')
  })

  it('warn：句尾加上提醒', () => {
    expect(elementarySentence({ ...check(), warn: true })).toBe(
      `國小一年級對帳：114 學年 3 公里內各里所屬的 6 所國小，一年級 2,000 位，是 6 歲戶籍的 0.82（歷年 0.80–0.85）。${WARN_SENTENCE}`,
    )
    expect(WARN_SENTENCE).toBe('戶籍和實際就學差得比往年多，市佔率的分母可能偏高或偏低。')
  })

  it('只有一年資料時不寫歷年範圍', () => {
    const only = { ...check(), years: check().years.slice(-1) }
    expect(elementarySentence(only)).toBe('國小一年級對帳：114 學年 3 公里內各里所屬的 6 所國小，一年級 2,000 位，是 6 歲戶籍的 0.82。')
  })

  it('沒有任何學年回空字串', () => {
    expect(elementarySentence({ ...check(), years: [] })).toBe('')
  })
})

describe('seats：來源表的整數', () => {
  it('四捨五入成整數；沒有值寫「—」', () => {
    expect(seats(13.4)).toBe('13')
    expect(seats(13.5)).toBe('14')
    expect(seats(0.4)).toBe('0')
    expect(seats(1234.6)).toBe('1,235')
    expect(seats(null)).toBe('—')
  })
})

describe('detailSeats：怎麼算裡的逐項數字（小的也看得出來）', () => {
  it('一位小數；不是 0 卻四捨五入成 0.0 寫「不到 0.1」；0 寫 0；沒有值寫「—」', () => {
    expect(detailSeats(7.44)).toBe('7.4')
    expect(detailSeats(0.04)).toBe('不到 0.1')
    expect(detailSeats(0)).toBe('0')
    expect(detailSeats(null)).toBe('—')
  })
})

describe('每年還能多招的大數字卡', () => {
  const total: PotentialTotal = { low: 5.6, mid: 13.4, high: 23.4, included: ['closures', 'villages', 'presale'] }

  it('大字取整；區間低取下限、高取上限（區間不比實際窄）', () => {
    expect(estimateHeadline(total)).toBe('約 13 位')
    expect(estimateRange(total)).toBe('5～24 位')
    expect(estimateRange({ ...total, low: 0, high: 0.2 })).toBe('0～1 位')
    expect(estimateRange({ ...total, low: 1200.2, high: 1300 })).toBe('1,200～1,300 位')
  })

  it('目前空位', () => {
    const capacity = (changes: Partial<PotentialCapacity>): PotentialCapacity => ({ approved: 210, enrolled: 192, open: 18, ...changes })
    expect(openSeatsText(capacity({}))).toBe('目前空位 18 位')
    expect(openSeatsText(capacity({ enrolled: 230, open: 0 }))).toBe('目前空位 0 位')
  })

  it('三個來源都算進去不加註；少於三個寫「只含：…」', () => {
    expect(includedNote(total)).toBe('')
    expect(includedNote({ ...total, included: ['closures', 'presale'] })).toBe('只含：附近園所停辦釋出、新建案搬進來')
    expect(includedNote({ ...total, included: ['villages'] })).toBe('只含：現有的里還沒招到')
  })
})

describe('來源表', () => {
  it('來源名稱', () => {
    expect(sourceName('closures')).toBe('附近園所停辦釋出')
    expect(sourceName('villages')).toBe('現有的里還沒招到')
    expect(sourceName('presale')).toBe('新建案搬進來')
  })

  it('沒有資料：直接帶 API 的原因，沒有原因就只寫「沒有資料」', () => {
    expect(noDataText('沒有在籍清冊')).toBe('沒有資料（沒有在籍清冊）')
    expect(noDataText(null)).toBe('沒有資料')
  })

  it('刻度上限取有數字的來源最大的 high；都沒有數字是 0', () => {
    expect(rangeScale([closureSource(), villageSource(), presaleSource()])).toBe(14.8)
    expect(rangeScale([...noDataSources()])).toBe(0)
    expect(rangeScale([closureSource({ status: 'no_data', low: null, mid: null, high: null }), presaleSource()])).toBe(2.5)
  })

  it('區間條：low–high 的位置與寬度、mid 的位置（占刻度的百分比）', () => {
    expect(rangeBar(closureSource({ low: 2, mid: 5, high: 10 }), 20)).toEqual({ left: 10, width: 40, mid: 25 })
    // 刻度 0（全是 0）不除以 0
    expect(rangeBar(closureSource({ low: 0, mid: 0, high: 0 }), 0)).toEqual({ left: 0, width: 0, mid: 0 })
    // 超出刻度的值收在 0–100
    expect(rangeBar(closureSource({ low: 0, mid: 30, high: 30 }), 20)).toEqual({ left: 0, width: 100, mid: 100 })
  })

  it('距離與距離帶', () => {
    expect(distanceKm(850)).toBe('0.9 km')
    expect(distanceKm(1500)).toBe('1.5 km')
    expect(bandLabel('0-1')).toBe('0–1 km')
    expect(bandLabel('2-3')).toBe('2–3 km')
  })

  it('停辦窗口：10 月到隔年 9 月', () => {
    expect(periodText(111)).toBe('2022 年 10 月～2023 年 9 月')
    expect(periodText(114)).toBe('2025 年 10 月～2026 年 9 月')
  })

  it('預計交屋：約某年上／下半年；已過預計時間的另寫', () => {
    expect(deliveryText({ expected_year: 2027, expected_half: 2, overdue: false })).toBe('約 2027 下半年')
    expect(deliveryText({ expected_year: 2026, expected_half: 1, overdue: false })).toBe('約 2026 上半年')
    expect(deliveryText({ expected_year: 2026, expected_half: 1, overdue: true })).toBe('已過預計時間（尚未登記）')
  })
})

describe('停辦標記', () => {
  const event = (changes: Partial<ReturnType<typeof potentialData>['potential']['events'][number]> = {}) => ({
    occurred_on: '2026-09-15', name: '高雄市私立丁幼兒園', approved_capacity: 30, distance_m: 2600, school_year: 114, ...changes,
  })

  it('提示：日期、園名、核定；核定沒填另寫', () => {
    expect(closureEventTitle(event())).toBe('2026-09-15 高雄市私立丁幼兒園停辦（核定 30）')
    expect(closureEventTitle(event({ approved_capacity: null }))).toBe('2026-09-15 高雄市私立丁幼兒園停辦（核定名額未填）')
  })

  it('標在 school_year + 1：2026-09-15 停辦（窗口 114）標在 115', () => {
    expect(closureMarkers([event()], 107, 115)).toEqual([{ year: 115, title: '2026-09-15 高雄市私立丁幼兒園停辦（核定 30）' }])
  })

  it('同一學年多所合併成一個標記，提示每所一行（依日期）', () => {
    const markers = closureMarkers(
      [event({ occurred_on: '2024-09-30', name: '丙', school_year: 112 }), event({ occurred_on: '2024-08-10', name: '乙', school_year: 112, approved_capacity: 90 })],
      107, 115,
    )
    expect(markers).toEqual([{ year: 113, title: '2024-08-10 乙停辦（核定 90）\n2024-09-30 丙停辦（核定 30）' }])
  })

  it('落在圖上學年範圍以外的不畫（含剛好超過最新一年的）；結果依學年排序', () => {
    const markers = closureMarkers(
      [event({ school_year: 115 }), event({ school_year: 105, name: '甲' }), event({ school_year: 111, name: '乙' }), event({ school_year: 106, name: '丙' })],
      107, 115,
    )
    expect(markers.map((marker) => marker.year)).toEqual([107, 112])
  })

  it('沒有事件：空', () => {
    expect(closureMarkers([], 107, 115)).toEqual([])
  })
})
