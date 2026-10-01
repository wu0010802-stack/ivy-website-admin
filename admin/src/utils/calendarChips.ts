import { formatDate } from '../api/labels'
import { sessionName } from './sessions'

export interface CalendarVisit { id: string; status: string; parent_name: string; child_name: string | null; phone: string; source: string; assigned_staff_id: string | null; party_size?: number | null }
export interface CalendarSlot { id: string; campus_key: string; slot_date: string; start_time: string; end_time: string; capacity: number; closed: boolean; closed_source?: string | null; version: number; booked_count: number; visits: CalendarVisit[] }
export type ChipKind = 'visit' | 'stopped' | 'open'
export interface Chip { key: string; kind: ChipKind; text: string; ended: boolean; status?: string }

const shortName = (start: string) => sessionName(start).split(' ')[0]!

export function slotEnded(slot: CalendarSlot, now = Date.now()): boolean {
  return new Date(`${slot.slot_date}T${slot.end_time.slice(0, 8)}+08:00`).getTime() <= now
}

export function dayChips(slots: CalendarSlot[], now = Date.now()): Chip[] {
  const chips: Chip[] = []
  for (const slot of [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    if (slot.closed && slot.closed_source === 'exception') continue
    const ended = slotEnded(slot, now)
    for (const v of slot.visits) chips.push({ key: v.id, kind: 'visit', text: `${shortName(slot.start_time)} ${v.parent_name}`, ended, status: v.status })
    if (slot.closed) chips.push({ key: `${slot.id}-stopped`, kind: 'stopped', text: `${shortName(slot.start_time)}停止申請`, ended })
    else if (!ended && !slot.visits.length && slot.capacity > slot.booked_count) {
      chips.push({ key: `${slot.id}-open`, kind: 'open', text: `${shortName(slot.start_time)} 可約 ${slot.capacity - slot.booked_count}`, ended })
    }
  }
  return chips
}

export function dayAriaLabel(day: string, slots: CalendarSlot[], holidayReason: string | null, now = Date.now()): string {
  const parts = [formatDate(day)]
  if (holidayReason !== null) parts.push(`休假：${holidayReason || '未填原因'}`)
  const booked = slots.reduce((sum, s) => sum + s.visits.length, 0)
  const seats = slots.filter(s => !s.closed && !slotEnded(s, now)).reduce((sum, s) => sum + Math.max(s.capacity - s.booked_count, 0), 0)
  const stopped = slots.filter(s => s.closed && s.closed_source !== 'exception').length
  parts.push(booked ? `排入 ${booked} 組` : '沒有排入的家長')
  if (seats) parts[parts.length - 1] += `，可約 ${seats} 組`
  if (stopped) parts.push(`${stopped} 場停止申請`)
  return parts.join('，')
}
