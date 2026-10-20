import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  campusLabel,
  campusLabels,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatShortDateTime,
  formatShortSlotWhen,
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
    expect(visitStatus('new')).toEqual({ label: '待處理', tone: 'primary' })
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
    // 沒有結束時間（官網預約清單）只寫開始時間。
    expect(formatSlotWhen({ slot_date: '2026-09-26', start_time: '10:00:00' })).toBe('2026/09/26（週六）10:00')
    expect(formatSlotWhen(null)).toBe('—')
    expect(formatSlotWhen(undefined)).toBe('—')
  })

  it('檔案大小換算', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(20480)).toBe('20 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3 MB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })

  describe('列表的短寫法：「今年」每次呼叫時才算（分頁開過跨年）', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('跨年前省略 2026、跨年後改省略 2027，2026 的場次改照寫年份', () => {
      vi.useFakeTimers()
      // 台灣時間 2026-12-31 23:59（UTC 15:59）
      vi.setSystemTime(new Date('2026-12-31T15:59:00Z'))
      const slot2026 = { slot_date: '2026-12-31', start_time: '10:00:00', end_time: '11:00:00' }
      const slot2027 = { slot_date: '2027-01-02', start_time: '10:00:00', end_time: '11:00:00' }
      expect(formatShortSlotWhen(slot2026)).toBe('12/31（週四）10:00–11:00')
      expect(formatShortSlotWhen(slot2027)).toBe('2027/01/02（週六）10:00–11:00')
      expect(formatShortDateTime('2026-12-31T01:00:00Z')).toBe('12/31 09:00')

      // 同一個模組、不重新載入：台灣時間過了跨年夜（UTC 16:01 已是 2027-01-01 00:01）。
      vi.setSystemTime(new Date('2026-12-31T16:01:00Z'))
      expect(formatShortSlotWhen(slot2026)).toBe('2026/12/31（週四）10:00–11:00')
      expect(formatShortSlotWhen(slot2027)).toBe('01/02（週六）10:00–11:00')
      expect(formatShortDateTime('2026-12-31T01:00:00Z')).toBe('2026/12/31 09:00')
    })
  })
})
