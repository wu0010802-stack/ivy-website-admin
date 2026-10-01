import { visitDateLabel } from './visit-form'

// 場次名稱由開始時間推導（2026-09-30 業主裁定）：12:00 以前上午場，其餘下午場。
export function sessionLabel(startTime: string): string {
  const hhmm = startTime.slice(0, 5)
  return `${Number(hhmm.slice(0, 2)) < 12 ? '上午場' : '下午場'} ${hhmm}`
}

export function slotRange(slot: { start_time: string; end_time: string }): string {
  return `${sessionLabel(slot.start_time)}–${slot.end_time.slice(0, 5)}`
}

export function slotWhen(slot: { slot_date: string; start_time: string; end_time: string }): string {
  return `${visitDateLabel(slot.slot_date)} ${slotRange(slot)}`
}
