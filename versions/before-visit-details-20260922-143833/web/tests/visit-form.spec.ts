import { describe, expect, it } from 'vitest'
import { normalizeVisitPhone, validateVisitContact } from '../app/utils/visit-form'

describe('visit contact input', () => {
  it('accepts phone autofill spacing without changing the API format', () => {
    expect(normalizeVisitPhone(' 0912-345-678 ')).toBe('0912345678')
    expect(validateVisitContact({ parentName: '陳媽媽', phone: '0912 345 678', consent: true })).toEqual({})
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
})
