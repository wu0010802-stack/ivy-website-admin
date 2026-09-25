import { describe, expect, it } from 'vitest'
import { normalizeVisitPhone, validateVisitContact, taipeiDate, isValidDate, REFERRAL_OPTIONS, changeDeadlineRule, slotUnavailableMessage } from '../app/utils/visit-form'

describe('visit contact input', () => {
  it('accepts phone autofill spacing without changing the API format', () => {
    expect(normalizeVisitPhone(' 0912-345-678 ')).toBe('0912345678')
    expect(validateVisitContact({ parentName: '陳媽媽', phone: '0912 345 678', consent: true })).toEqual({})
  })

  it.each(['－', '‐', '‑', '‒', '–', '—', '―', '−'])('accepts pasted phone separator %s supported by the API', separator => {
    const phone = `0999${separator}000${separator}001`
    expect(normalizeVisitPhone(phone)).toBe('0999000001')
    expect(validateVisitContact({ parentName: '測試家長', phone, consent: true })).toEqual({})
  })

  it('rejects an empty or whitespace-only name, malformed phone, and missing consent together', () => {
    expect(Object.keys(validateVisitContact({ parentName: '　 ', phone: '12345678', consent: false }))).toEqual(['parentName', 'phone', 'consent'])
  })

  it.each(['091234567', '09123456789', '0812345678', '09abcdefgh', '0912345678x'])('does not silently truncate invalid phone %s', phone => {
    expect(validateVisitContact({ parentName: '測試家長', phone, consent: true }).phone).toBeTruthy()
  })

  it('accepts a single name and validates its length', () => {
    expect(validateVisitContact({ parentName: '林', phone: '0912345678', consent: true })).toEqual({})
    expect(validateVisitContact({ parentName: '陳'.repeat(41), phone: '0912345678', consent: true }).parentName).toBeTruthy()
  })

  it('validates child identity and birthday without rejecting legacy input', () => {
    const parent = { parentName: '陳媽媽', phone: '0912345678', consent: true }
    expect(validateVisitContact({ ...parent, childName: '  ', childBirthdate: '' }, '2026-09-22')).toHaveProperty('childName')
    expect(validateVisitContact({ ...parent, childName: '測試孩子', childBirthdate: '2027-01-01' }, '2026-09-22')).toHaveProperty('childBirthdate')
    expect(validateVisitContact({ ...parent, childName: '測試孩子', childBirthdate: '2024-02-29', email: 'parent@example.com' }, '2026-09-22')).toEqual({})
    expect(validateVisitContact({ ...parent, email: 'not-an-email' })).toHaveProperty('email')
  })

  it('rejects impossible calendar dates and uses the Taiwan date at midnight', () => {
    expect(isValidDate('2023-02-29')).toBe(false)
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2024-13-01')).toBe(false)
    expect(taipeiDate(new Date('2026-09-21T16:01:00Z'))).toBe('2026-09-22')
  })

  it('uses stable values for the requested referral channels', () => {
    expect(REFERRAL_OPTIONS.map(source => source.value)).toEqual(['facebook', 'google_reviews', 'parent_community', 'friends_family', 'other'])
  })
})

describe('parent change deadline copy', () => {
  it('follows the campus setting instead of a fixed 24 hours', () => {
    expect(changeDeadlineRule(24)).toBe('參觀前 24 小時')
    expect(changeDeadlineRule(36)).toBe('參觀前 36 小時')
    expect(changeDeadlineRule(72)).toBe('參觀前 3 天')
    // 舊版 API 沒回這個欄位時不顯示規則，只顯示截止時間本身。
    expect(changeDeadlineRule(undefined)).toBe('')
  })
})

describe('slot unavailable messages', () => {
  it('tells parents a closed slot is closed rather than full', () => {
    expect(slotUnavailableMessage('SLOT_CLOSED')).toContain('關閉')
    expect(slotUnavailableMessage('SLOT_FULL')).toContain('滿')
    expect(slotUnavailableMessage('SLOT_NOT_FOUND')).toContain('不存在')
    expect(slotUnavailableMessage('SLOT_NOT_BOOKABLE')).toContain('無法預約')
  })

  it('leaves other codes to the caller', () => {
    expect(slotUnavailableMessage('RATE_LIMITED')).toBeNull()
    expect(slotUnavailableMessage(null)).toBeNull()
  })
})
