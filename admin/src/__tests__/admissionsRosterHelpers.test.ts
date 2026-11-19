import { describe, expect, it } from 'vitest'
import type { RosterStudent, Tier } from '../api/roster'
import { GRADE_ORDER, gapText, markOf, planText, rocDate, sideParts, tierText } from '../admissions/roster'

function student(over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    id: 's-1', campus_key: 'yihua', school_year: 115, class_id: 'c-1', position: 0, grade: '小班', child_name: '測試甲',
    birthday: '2023-05-01', note: null, status: 'enrolled', enrollment_date: null, planned_entry_date: null, deposit_date: null,
    left_date: null, refunded_date: null, target_school_year: null, target_semester: null, is_special_education: false,
    is_indigenous: false, is_new_manual: false, underage_manual: false, next_year: 'continue', from_funnel: false, version: 1,
    is_new: false, is_underage: null, board_notice: null, ...over,
  }
}

const TODAY = '2026-11-15'

describe('編班表的顯示用純函式', () => {
  it('年級順序是大中小幼', () => {
    expect([...GRADE_ORDER]).toEqual(['大班', '中班', '小班', '幼幼班'])
  })

  it('字色優先順序：不足齡 > 特教生 > 原住民 > 新生', () => {
    const all = student({ is_underage: true, is_special_education: true, is_indigenous: true, is_new: true })
    expect(markOf(all)).toBe('underage')
    expect(markOf({ ...all, is_underage: false })).toBe('sped')
    expect(markOf({ ...all, is_underage: null, is_special_education: false })).toBe('indigenous')
    expect(markOf({ ...all, is_underage: null, is_special_education: false, is_indigenous: false })).toBe('new')
    expect(markOf(student())).toBeNull()
  })

  it('planText：同年 12/1、跨年 116/2/1', () => {
    expect(planText('2026-12-01', TODAY)).toBe('12/1')
    expect(planText('2027-02-01', TODAY)).toBe('116/2/1')
  })

  it('rocDate：民國年、補零', () => {
    expect(rocDate('2026-11-05')).toBe('115.11.05')
  })

  it('sideParts：預繳沒日期用備註，都沒有是未定', () => {
    const dated = student({ status: 'pending', planned_entry_date: '2026-12-01', note: '12或2' })
    expect(sideParts(dated, '小班', TODAY, 115).text).toBe('12/1')
    expect(sideParts(student({ status: 'pending', note: '12或2' }), '小班', TODAY, 115).text).toBe('12或2')
    expect(sideParts(student({ status: 'pending' }), '小班', TODAY, 115).text).toBe('未定')
  })

  it('sideParts：開學後才入園的在籍顯示入園日，8/3 入園的不顯示', () => {
    expect(sideParts(student({ enrollment_date: '2026-10-05' }), '小班', TODAY, 115).text).toBe('10/5')
    expect(sideParts(student({ enrollment_date: '2026-08-03' }), '小班', TODAY, 115).text).toBe('')
    expect(sideParts(student(), '小班', TODAY, 115).text).toBe('')
  })

  it('sideParts：幼幼班沒生日顯示缺生日，其他年級不顯示；不足齡優先', () => {
    const noBirthday = student({ grade: '幼幼班', birthday: null, is_underage: false })
    expect(sideParts(noBirthday, '幼幼班', TODAY, 115).labels).toEqual(['缺生日'])
    expect(sideParts({ ...noBirthday, grade: '小班' }, '小班', TODAY, 115).labels).toEqual([])
    expect(sideParts({ ...noBirthday, is_underage: true }, '幼幼班', TODAY, 115).labels).toEqual(['不足齡'])
    expect(sideParts({ ...noBirthday, birthday: '2023-05-01' }, '幼幼班', TODAY, 115).labels).toEqual([])
  })

  it('sideParts：特教、原民、不讀、重讀與看板提醒的順序', () => {
    const full = student({ is_special_education: true, is_indigenous: true, next_year: 'leave', board_notice: 'deposit_removed' })
    expect(sideParts(full, '中班', TODAY, 115).labels).toEqual(['特教', '原民', '不讀', '看板已退預繳'])
    expect(sideParts(student({ next_year: 'repeat', board_notice: 'enrolled' }), '大班', TODAY, 115).labels).toEqual(['重讀', '看板已註冊'])
  })

  it('sideParts：大班 leave 不顯示不讀、中班 repeat 不顯示重讀', () => {
    expect(sideParts(student({ next_year: 'leave' }), '大班', TODAY, 115).labels).toEqual([])
    expect(sideParts(student({ next_year: 'repeat' }), '中班', TODAY, 115).labels).toEqual([])
  })

  it('gapText：-6 → −6、0 → 額滿、1 → ＋1、null → —', () => {
    expect(gapText(-6)).toEqual({ kind: 'short', text: '−6' })
    expect(gapText(0)).toEqual({ kind: 'full', text: '額滿' })
    expect(gapText(1)).toEqual({ kind: 'over', text: '＋1' })
    expect(gapText(null)).toEqual({ kind: 'none', text: '—' })
  })

  it('tierText 三種情況', () => {
    const tier = (over: Partial<Tier>): Tier => ({ base: 220, boost: 230, top: 240, reached: null, next: null, short: null, ...over })
    expect(tierText(tier({ reached: 'boost', next: 'top', short: 4 }))).toBe('已達激勵目標，離超越目標還差 4 人')
    expect(tierText(tier({ reached: null, next: 'base', short: 12 }))).toBe('還沒到基礎目標，離基礎目標還差 12 人')
    expect(tierText(tier({ reached: 'top' }))).toBe('已達超越目標')
    expect(tierText(tier({ base: null, boost: null, top: null }))).toBe('')
  })
})
