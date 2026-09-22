import { describe, expect, it } from 'vitest'
import {
  campusLabel,
  campusLabels,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatSlotWhen,
  formatTime,
  roleLabel,
  visitStatus,
} from '../api/labels'

describe('labels', () => {
  it('校區代碼轉中文，未知代碼原樣回傳，空值視為共用', () => {
    expect(campusLabel('yihua')).toBe('義華')
    expect(campusLabel('unknown')).toBe('unknown')
    expect(campusLabel(null)).toBe('共用')
    expect(campusLabels(['yihua', 'renwu'])).toBe('義華、仁武')
  })

  it('角色與案件狀態有中文與色調', () => {
    expect(roleLabel('super_admin')).toBe('總管理者')
    expect(visitStatus('new')).toEqual({ label: '待處理', tone: 'warning' })
    expect(visitStatus('weird').label).toBe('weird')
  })

  it('時間格式化走台北時區，空值回破折號', () => {
    expect(formatDateTime('2026-09-21T06:05:00Z')).toBe('2026/09/21 14:05')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
    expect(formatDate('2026-09-21')).toBe('2026/09/21')
    expect(formatTime('10:30:00')).toBe('10:30')
  })

  it('參觀時間合成日期、星期與起訖，沒有時段回破折號', () => {
    expect(formatSlotWhen({ slot_date: '2026-09-26', start_time: '10:00:00', end_time: '11:00:00' })).toBe(
      '2026/09/26（週六）10:00–11:00',
    )
    expect(formatSlotWhen(null)).toBe('—')
    expect(formatSlotWhen(undefined)).toBe('—')
  })

  it('檔案大小換算', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(20480)).toBe('20 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
