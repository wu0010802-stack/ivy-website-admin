import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { directionsUrl, googleCalendarUrl, icsContent, icsFileName, visitCalendarEvent } from '../app/utils/visit-calendar'

const campus = { name: '義華校', address: '高雄市三民區義華路68號', phone: '07-392-8366' }
const slot = { slot_date: '2026-10-03', start_time: '09:30:00', end_time: '10:30:00' }

describe('visitCalendarEvent', () => {
  it('台北時間換成 UTC', () => {
    const event = visitCalendarEvent(campus, slot)!
    expect(event.start.toISOString()).toBe('2026-10-03T01:30:00.000Z')
    expect(event.end.toISOString()).toBe('2026-10-03T02:30:00.000Z')
    expect(event.title).toBe('參觀常春藤義華校')
    expect(event.location).toBe('常春藤幼兒園義華校，高雄市三民區義華路68號')
    expect(event.details).toContain('07-392-8366')
  })

  it('接受沒有秒數的時間', () => {
    expect(visitCalendarEvent(campus, { ...slot, start_time: '09:30', end_time: '10:00' })!.end.toISOString()).toBe('2026-10-03T02:00:00.000Z')
  })

  it('時間不合理時不產生行程', () => {
    expect(visitCalendarEvent(campus, { ...slot, end_time: '09:00:00' })).toBeNull()
    expect(visitCalendarEvent(campus, { ...slot, slot_date: 'bad' })).toBeNull()
  })

  it('沒有地址時地點只寫校名', () => {
    expect(visitCalendarEvent({ name: '仁武校' }, slot)!.location).toBe('常春藤幼兒園仁武校')
  })
})

describe('googleCalendarUrl', () => {
  it('帶 UTC 起訖、台北時區與地點', () => {
    const url = new URL(googleCalendarUrl(visitCalendarEvent(campus, slot)!))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20261003T013000Z/20261003T023000Z')
    expect(url.searchParams.get('ctz')).toBe('Asia/Taipei')
    expect(url.searchParams.get('location')).toContain('義華路68號')
  })
})

describe('directionsUrl', () => {
  it('用地址當目的地；沒有地址就不給導航', () => {
    const url = new URL(directionsUrl(campus)!)
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('destination')).toBe('常春藤幼兒園義華校 高雄市三民區義華路68號')
    expect(directionsUrl({ name: '仁武校' })).toBeNull()
  })
})

describe('icsContent', () => {
  const ics = icsContent(visitCalendarEvent({ ...campus, address: '高雄市, 三民區; 義華路\\68號' }, slot)!, 'visit-abc@ivy-website', new Date('2026-09-26T00:00:00Z'))

  it('CRLF 換行、必要欄位齊全、前一天提醒', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').filter(line => line && !line.startsWith(' ')).every(line => /^[A-Z-]+[:;]/.test(line))).toBe(true)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('UID:visit-abc@ivy-website')
    expect(unfolded).toContain('DTSTAMP:20260926T000000Z')
    expect(unfolded).toContain('DTSTART:20261003T013000Z')
    expect(unfolded).toContain('DTEND:20261003T023000Z')
    expect(unfolded).toContain('TRIGGER:-P1D')
  })

  it('跳脫逗號、分號、反斜線與換行', () => {
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('LOCATION:常春藤幼兒園義華校，高雄市\\, 三民區\\; 義華路\\\\68號')
    expect(unfolded).toMatch(/DESCRIPTION:常春藤幼兒園義華校參觀\\n地址：/)
  })

  it('每行不超過 75 位元組（中文是 3 位元組）', () => {
    const encoder = new TextEncoder()
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
  })

  it('不放孩子或家長資料', () => {
    expect(ics).not.toMatch(/孩子姓名|家長/)
  })
})

describe('icsFileName', () => {
  it('含校名與日期', () => {
    expect(icsFileName(campus, slot)).toBe('常春藤義華校參觀-2026-10-03.ics')
  })
})

describe('只在預約成立時出現', () => {
  it('預約完成畫面與家長管理頁都以 confirmed 為條件', () => {
    const form = readFileSync(new URL('../app/components/VisitForm.vue', import.meta.url), 'utf8')
    const manage = readFileSync(new URL('../app/pages/visit/manage.vue', import.meta.url), 'utf8')
    expect(form).toMatch(/<VisitCalendarActions\s+v-if="resultKind === 'booked'/)
    expect(manage).toMatch(/status !== 'confirmed'[^\n]*return null/)
  })
})
