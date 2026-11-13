import { describe, expect, it } from 'vitest'
import { normalizeVisitPhone, validateVisitContact, taipeiDate, isValidDate, earliestChildBirthdate, REFERRAL_OPTIONS, changeDeadlineRule, slotUnavailableMessage, apiFieldErrors } from '../app/utils/visit-form'

describe('visit contact input', () => {
  it('accepts phone autofill spacing without changing the API format', () => {
    expect(normalizeVisitPhone(' 0912-345-678 ')).toBe('0912345678')
    expect(validateVisitContact({ parentName: '陳媽媽', phone: '0912 345 678' })).toEqual({})
  })

  it.each(['－', '‐', '‑', '‒', '–', '—', '―', '−'])('accepts pasted phone separator %s supported by the API', separator => {
    const phone = `0999${separator}000${separator}001`
    expect(normalizeVisitPhone(phone)).toBe('0999000001')
    expect(validateVisitContact({ parentName: '測試家長', phone })).toEqual({})
  })

  // 2026-11-12 QA L30：輸入法在全形狀態打的數字，要和全形破折號、空白一樣被轉成半形；backend/tests/test_visit_input_normalization.py 有同一組案例。
  it.each([
    ['０９１２３４５６７８', '0912345678'],
    ['０９１２－３４５－６７８', '0912345678'],
    ['０９１２　３４５　６７８', '0912345678'],
    ['09１２3４5６7８', '0912345678'],
  ])('converts fullwidth digits in phone %s', (phone, expected) => {
    expect(normalizeVisitPhone(phone)).toBe(expected)
    expect(validateVisitContact({ parentName: '陳媽媽', phone })).toEqual({})
  })

  it.each(['０８１２３４５６７８', '０９１２３４５６７', '０９１２３４５６７８９', '09１２３４５６７８x', '０９①２３４５６７８', '０９¹２３４５６７８', '٠٩١٢٣٤٥٦٧٨'])(
    'still rejects phone %s after converting fullwidth digits', phone => {
      expect(validateVisitContact({ parentName: '陳媽媽', phone }).phone).toBeTruthy()
    }
  )

  it('rejects an empty or whitespace-only name and malformed phone together (no consent to check since 2026-10-02)', () => {
    expect(Object.keys(validateVisitContact({ parentName: '　 ', phone: '12345678' }))).toEqual(['parentName', 'phone'])
  })

  it.each(['091234567', '09123456789', '0812345678', '09abcdefgh', '0912345678x'])('does not silently truncate invalid phone %s', phone => {
    expect(validateVisitContact({ parentName: '測試家長', phone }).phone).toBeTruthy()
  })

  it('accepts a single name and validates its length', () => {
    expect(validateVisitContact({ parentName: '林', phone: '0912345678' })).toEqual({})
    expect(validateVisitContact({ parentName: '陳'.repeat(41), phone: '0912345678' }).parentName).toBeTruthy()
  })

  it('validates child identity and birthday without rejecting legacy input', () => {
    const parent = { parentName: '陳媽媽', phone: '0912345678' }
    expect(validateVisitContact({ ...parent, childName: '  ', childBirthdate: '' }, '2026-09-22')).toHaveProperty('childName')
    expect(validateVisitContact({ ...parent, childName: '測試孩子', childBirthdate: '2027-01-01' }, '2026-09-22')).toHaveProperty('childBirthdate')
    expect(validateVisitContact({ ...parent, childName: '測試孩子', childBirthdate: '2024-02-29', email: 'parent@example.com' }, '2026-09-22')).toEqual({})
    expect(validateVisitContact({ ...parent, email: 'not-an-email' })).toHaveProperty('email')
  })

  // 2026-11-12 QA L31：下限是今天（台北）往前 18 年，與 backend 的 earliest_child_birthdate 同一個規則。
  it.each([
    ['2008-11-12', true],
    ['2008-11-11', false],
    ['1900-01-01', false],
    ['0001-01-01', false],
    ['2023-03-02', true],
    ['2026-11-12', true],
    ['2026-11-13', false]
  ])('child birthday %s within the window: %s', (childBirthdate, ok) => {
    const parent = { parentName: '陳媽媽', phone: '0912345678', childName: '測試孩子', email: 'parent@example.com' }
    const errors = validateVisitContact({ ...parent, childBirthdate }, '2026-11-12')
    expect(Boolean(errors.childBirthdate)).toBe(!ok)
  })

  it('asks the parent to check an implausibly old birthday instead of saying it is in the future', () => {
    const errors = validateVisitContact({ parentName: '陳媽媽', phone: '0912345678', childName: '測試孩子', childBirthdate: '1900-01-01' }, '2026-11-12')
    expect(errors.childBirthdate).toContain('請確認')
  })

  it('puts the lower bound on Feb 28 when today is Feb 29 and 18 years ago has no Feb 29', () => {
    expect(earliestChildBirthdate('2026-11-12')).toBe('2008-11-12')
    expect(earliestChildBirthdate('2028-02-29')).toBe('2010-02-28')
    expect(earliestChildBirthdate('2024-02-29')).toBe('2006-02-28')
    expect(earliestChildBirthdate('2036-02-29')).toBe('2018-02-28')
    const parent = { parentName: '陳媽媽', phone: '0912345678', childName: '測試孩子' }
    expect(validateVisitContact({ ...parent, childBirthdate: '2010-02-28' }, '2028-02-29')).toEqual({})
    expect(validateVisitContact({ ...parent, childBirthdate: '2010-02-27' }, '2028-02-29')).toHaveProperty('childBirthdate')
  })

  it('rejects impossible calendar dates and uses the Taiwan date at midnight', () => {
    expect(isValidDate('2023-02-29')).toBe(false)
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2024-13-01')).toBe(false)
    expect(taipeiDate(new Date('2026-09-21T16:01:00Z'))).toBe('2026-09-22')
  })

  it('uses stable values for the requested referral channels', () => {
    expect(REFERRAL_OPTIONS.map(source => source.value)).toEqual(['friends_family', 'sibling', 'nearby', 'flyer', 'online', 'other'])
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

describe('Email 選填與 422 欄位對應', () => {
  const base = { parentName: '王媽媽', phone: '0912345678', childName: '小安', childBirthdate: '2022-05-01' }

  it('Email 可以不填（2026-11-13 起選填），有填才驗格式', () => {
    expect(validateVisitContact({ ...base, email: '' }, '2026-09-30')).toEqual({})
    expect(validateVisitContact({ ...base, email: '   ' }, '2026-09-30')).toEqual({})
    expect(validateVisitContact({ ...base, email: 'a@b.co' }, '2026-09-30')).toEqual({})
    expect(validateVisitContact({ ...base, email: 'abc' }, '2026-09-30')).toHaveProperty('email')
    expect(validateVisitContact(base, '2026-09-30')).not.toHaveProperty('email')
  })

  it('後端 422 的欄位位置轉成表單欄位錯誤', () => {
    const errors = apiFieldErrors([
      { loc: ['body', 'slot_id'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'email'], msg: 'Field required', type: 'missing' }
    ])
    expect(Object.keys(errors).sort()).toEqual(['email', 'slotId'])
    expect(apiFieldErrors({ code: 'X' })).toEqual({})
  })
})
