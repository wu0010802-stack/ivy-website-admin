// 編班與缺額分頁的顯示用純函式（2026-11-15；用字照規格 §8.4）。統計數字全由後端算，這裡只管怎麼寫出來。
import type { RosterStudent, Tier } from '../api/roster'

export const GRADE_ORDER = ['大班', '中班', '小班', '幼幼班'] as const

/** 姓名字色：一位幼生只有一種，優先順序 橘＝不足齡、紫＝特教生、藍＝原住民、綠＝新生，都不是就是黑字。 */
export type Mark = 'underage' | 'sped' | 'indigenous' | 'new' | null

export function markOf(student: RosterStudent): Mark {
  if (student.is_underage) return 'underage'
  if (student.is_special_education) return 'sped'
  if (student.is_indigenous) return 'indigenous'
  if (student.is_new) return 'new'
  return null
}

const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

/** 預定入園日：和今天同年寫「12/1」，跨年寫「116/2/1」。 */
export function planText(iso: string, today: string): string {
  const year = Number(iso.slice(0, 4))
  return year === Number(today.slice(0, 4)) ? monthDay(iso) : `${year - 1911}/${monthDay(iso)}`
}

/** 民國年日期「115.11.05」。 */
export function rocDate(iso: string): string {
  return `${Number(iso.slice(0, 4)) - 1911}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`
}

/**
 * 備註欄：text 是預繳未入園的預定入園日（沒有就備註，都沒有「未定」）或開學後才入園的入園日；
 * labels 是小標記，依序不足齡／缺生日、特教、原民、不讀／重讀、看板提醒。
 */
export function sideParts(student: RosterStudent, grade: string, today: string, schoolYear: number): { text: string; labels: string[] } {
  let text = ''
  if (student.status === 'pending') {
    text = student.planned_entry_date ? planText(student.planned_entry_date, today) : student.note || '未定'
  } else if (student.status === 'enrolled' && student.enrollment_date && student.enrollment_date > `${schoolYear + 1911}-08-31`) {
    text = monthDay(student.enrollment_date)
  }
  const labels: string[] = []
  if (grade === '幼幼班') {
    if (student.is_underage) labels.push('不足齡')
    else if (!student.birthday) labels.push('缺生日')
  }
  if (student.is_special_education) labels.push('特教')
  if (student.is_indigenous) labels.push('原民')
  if (student.next_year === 'leave' && grade !== '大班') labels.push('不讀')
  if (student.next_year === 'repeat' && grade === '大班') labels.push('重讀')
  if (student.board_notice === 'deposit_removed') labels.push('看板已退預繳')
  else if (student.board_notice === 'enrolled') labels.push('看板已註冊')
  return { text, labels }
}

/** 缺額／超額：負的是缺幾人（−6）、0 是額滿、正的是超額（＋1）、沒設定是「—」。 */
export function gapText(value: number | null): { kind: 'none' | 'short' | 'full' | 'over'; text: string } {
  if (value === null) return { kind: 'none', text: '—' }
  if (value < 0) return { kind: 'short', text: `−${-value}` }
  if (value === 0) return { kind: 'full', text: '額滿' }
  return { kind: 'over', text: `＋${value}` }
}

const TIER_NAMES = { base: '基礎', boost: '激勵', top: '超越' } as const

/** 全校三段目標的達成狀況；三段都沒設定回空字串。不算獎金。 */
export function tierText(tier: Tier): string {
  if (tier.base === null && tier.boost === null && tier.top === null) return ''
  const next = tier.next ? `離${TIER_NAMES[tier.next]}目標還差 ${tier.short} 人` : ''
  if (tier.reached) return next ? `已達${TIER_NAMES[tier.reached]}目標，${next}` : `已達${TIER_NAMES[tier.reached]}目標`
  return next ? `還沒到基礎目標，${next}` : ''
}
