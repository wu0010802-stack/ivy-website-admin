import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newBookingSlotsQuery, taipeiDate } from '../app/utils/visit-form'

// 2026-10-13 場次使用情況：只有「新預約表單」讀場次時帶 purpose=new_booking，伺服器才記一次「最早能約哪天」；
// 家長改期的管理頁（useParentVisit）讀同一支端點，不帶就不記。

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8')

describe('新預約表單讀場次的查詢', () => {
  it('帶校區、今天到一年後（伺服器截到該校開放範圍）與 purpose=new_booking', () => {
    const query = newBookingSlotsQuery('yihua', '2026-10-13')
    expect(query).toEqual({ campus_key: 'yihua', date_from: '2026-10-13', date_to: '2027-10-13', purpose: 'new_booking' })
  })

  it('可以指定天數', () => {
    expect(newBookingSlotsQuery('renwu', '2026-10-13', 10).date_to).toBe('2026-10-23')
  })

  it('預約表單用這個函式，不自己拼查詢', () => {
    const source = read('app/components/VisitForm.vue')
    expect(source).toContain('newBookingSlotsQuery(')
    expect(source).not.toMatch(/query:\s*\{\s*campus_key:\s*campusKey/)
  })

  it('改期管理頁不帶 purpose', () => {
    expect(read('app/composables/useParentVisit.ts')).not.toContain('purpose')
  })

  it('taipeiDate 仍是台北日期（日期加法不受時區影響）', () => {
    expect(taipeiDate(new Date('2026-10-12T16:30:00Z'))).toBe('2026-10-13')
  })
})
