// 預約成立後的「加入行事曆」與「導航」。只給已確認的時段用（規格 197：只有已確認才叫預約成立），
// 呼叫端負責判斷狀態；這裡只把時段與分校組成行程。
// 行程只放分校名稱、地址、電話，不放孩子姓名與家長資料（行事曆常同步到雲端、分享給家人）。

export interface VisitCalendarCampus {
  name: string
  address?: string | null
  phone?: string | null
}

export interface VisitCalendarSlot {
  slot_date: string
  start_time: string
  end_time: string
}

export interface VisitCalendarEvent {
  title: string
  /** UTC */
  start: Date
  end: Date
  location: string
  details: string
}

const TAIPEI_OFFSET = '+08:00'

function taipeiInstant(date: string, time: string): Date {
  const [h = '00', m = '00', s = '00'] = time.split(':')
  return new Date(`${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.slice(0, 2).padStart(2, '0')}${TAIPEI_OFFSET}`)
}

export function visitCalendarEvent(campus: VisitCalendarCampus, slot: VisitCalendarSlot): VisitCalendarEvent | null {
  const start = taipeiInstant(slot.slot_date, slot.start_time)
  const end = taipeiInstant(slot.slot_date, slot.end_time)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null
  const lines = [`常春藤幼兒園${campus.name}參觀`]
  if (campus.address) lines.push(`地址：${campus.address}`)
  if (campus.phone) lines.push(`參觀專線：${campus.phone}`)
  lines.push('需要改期或取消，請直接聯絡園所。')
  return {
    title: `參觀常春藤${campus.name}`,
    start,
    end,
    location: campus.address ? `常春藤幼兒園${campus.name}，${campus.address}` : `常春藤幼兒園${campus.name}`,
    details: lines.join('\n')
  }
}

/** 20260930T013000Z */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function googleCalendarUrl(event: VisitCalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${utcStamp(event.start)}/${utcStamp(event.end)}`,
    ctz: 'Asia/Taipei',
    location: event.location,
    details: event.details
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

/** Google 地圖路線規劃，目的地用地址（分校自訂的地圖連結可能是地標頁，不一定能直接導航）。 */
export function directionsUrl(campus: VisitCalendarCampus): string | null {
  if (!campus.address) return null
  const params = new URLSearchParams({ api: '1', destination: `常春藤幼兒園${campus.name} ${campus.address}` })
  return `https://www.google.com/maps/dir/?${params}`
}

// RFC 5545：文字值跳脫 \ ; , 與換行；每行不超過 75 位元組（UTF-8），續行以一個空白開頭。
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = parts.length ? 74 : 75
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function icsContent(event: VisitCalendarEvent, uid: string, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ivy Education//Website Visit//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.details)}`,
    // 前一天提醒：參觀常要先請假、安排接送。
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`明天參觀常春藤${event.title.replace(/^參觀常春藤/, '')}`)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function icsFileName(campus: VisitCalendarCampus, slot: VisitCalendarSlot): string {
  return `常春藤${campus.name}參觀-${slot.slot_date}.ics`
}
