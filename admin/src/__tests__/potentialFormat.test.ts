// 招生潛力與市佔率（2026-10-20）：市佔率、分子分母、歷年最高與國小對帳的句子。
import { describe, expect, it } from 'vitest'
import {
  WARN_SENTENCE, bestSentence, elementarySentence, formatShare, shareSentence, yearTitle,
} from '../components/admissions/potential/potentialFormat'
import { potentialData, shareYear } from './admissionsTestKit'

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
