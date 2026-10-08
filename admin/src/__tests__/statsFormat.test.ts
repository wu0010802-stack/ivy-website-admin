import { describe, expect, it } from 'vitest'
import {
  alertLevelLabel, barWidth, formatPoints, formatRate, gradeColumns, priorityLabel, rateCsvCell, rateLevel, ratio, trendOf, TREND_MARK,
} from '../admissions/statsFormat'

describe('統計顯示格式（規格 9.2：分母 0 是 null，畫面寫「—」不寫 0）', () => {
  it('比率', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(undefined)).toBe('—')
    expect(formatRate(0)).toBe('0.0%')
    expect(formatRate(55.6)).toBe('55.6%')
    expect(formatRate(100)).toBe('100.0%')
  })

  it('匯出 CSV 的比率格：有值同畫面、沒有值寫空白（不寫「—」）；label 有給就寫 label', () => {
    expect(rateCsvCell(55.6)).toBe('55.6%')
    expect(rateCsvCell(0)).toBe('0.0%')
    expect(rateCsvCell(null)).toBe('')
    expect(rateCsvCell(undefined)).toBe('')
    expect(rateCsvCell(75, '75.0%（3/4）')).toBe('75.0%（3/4）')
    // 沒有值時 label 不寫：畫面的「—（0/0）」不進檔案。
    expect(rateCsvCell(null, '—（0/0）')).toBe('')
  })

  it('前端自己算的比率（接待人員 × 年級）：一位小數、分母 0 為 null', () => {
    expect(ratio(2, 3)).toBe(66.7)
    expect(ratio(0, 4)).toBe(0)
    expect(ratio(1, 0)).toBeNull()
  })

  it('月比百分點與方向', () => {
    expect(formatPoints(-80)).toBe('-80.0 個百分點')
    expect(formatPoints(3.25)).toBe('+3.3 個百分點')
    expect(formatPoints(0)).toBe('0.0 個百分點')
    expect(formatPoints(null)).toBe('—')
    expect([trendOf(2), trendOf(-0.1), trendOf(0), trendOf(null)]).toEqual(['up', 'down', 'flat', 'none'])
    expect(TREND_MARK.up + TREND_MARK.down + TREND_MARK.flat).toBe('▲▼–')
  })

  it('決策摘要上色門檻同園務：>= 60 高、>= 30 中、其餘低；沒有比率不上色', () => {
    expect([rateLevel(60), rateLevel(59.9), rateLevel(30), rateLevel(29.9), rateLevel(null)]).toEqual(['high', 'mid', 'mid', 'low', 'none'])
  })

  it('長條寬度：以該欄最大值為 100%，最大值 0 時都是 0%', () => {
    expect(barWidth(5, 5)).toBe('100%')
    expect(barWidth(1, 3)).toBe('33%')
    expect(barWidth(0, 3)).toBe('0%')
    expect(barWidth(2, 0)).toBe('0%')
  })

  it('警示等級與轉換潛力的中文（園務原文）', () => {
    expect([alertLevelLabel('danger'), alertLevelLabel('warning'), alertLevelLabel('info'), alertLevelLabel('other')]).toEqual(['高', '中', '低', '提示'])
    expect([priorityLabel('high'), priorityLabel('medium'), priorityLabel('low'), priorityLabel(null)]).toEqual(['高', '中', '低', '—'])
  })

  it('年級欄：四個年級固定在前，其他標籤（未填寫）有出現才加在後面，「合計」不算年級', () => {
    expect(gradeColumns(['小班', '合計'])).toEqual(['幼幼班', '小班', '中班', '大班'])
    expect(gradeColumns(['未填寫', '小班', '合計'])).toEqual(['幼幼班', '小班', '中班', '大班', '未填寫'])
  })
})
