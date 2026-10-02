import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-02 預約頁 UI／UX 優化：比照 ux-critique-20260929 鎖住原始碼裡的關鍵寫法，避免改版時悄悄退回。
// 互動行為（翻月、選日、送出）由 tests/stack/booking-flow、schedule-flow 在真瀏覽器裡跑。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const form = read('../app/components/VisitForm.vue')
const picker = read('../app/components/VisitDatePicker.vue')
const css = read('../app/assets/css/visit-booking.css')
const manage = read('../app/pages/visit/manage.vue')

describe('預約日期改用月曆', () => {
  it('不再是 40 多個選項的原生下拉，改用每天一個 radio 的月曆', () => {
    expect(form).not.toContain('<select id="visit-date"')
    expect(form).toContain('<VisitDatePicker v-model="selectedVisitDate" :counts="slotCounts"')
    expect(picker).toContain('type="radio" name="visitDate"')
    // 沒開放的日子只是數字，不能點、也不給讀螢幕當選項。
    expect(picker).toMatch(/<span v-else class="visit-day" aria-hidden="true">/)
  })

  it('右欄夠寬時月曆與當天場次並排（container query 掛在外層 section）', () => {
    expect(form).toContain('class="visit-form-section visit-schedule-section"')
    expect(css).toContain('.visit-schedule-section {container-type:inline-size}')
    expect(css).toMatch(/@container \(min-width:600px\)[^@]*\.visit-schedule-fields:has\(\.visit-date-field\) \{display:grid/)
  })

  it('管理頁改場次也用同一個月曆，先選日再選場次', () => {
    expect(manage).not.toContain('id="parent-new-slot"')
    expect(manage).toContain('<VisitDatePicker v-model="selectedDate" :counts="slotCounts"')
    expect(manage).toContain('<legend>新的場次</legend>')
    // 管理頁不在 .visit-page 裡，月曆要的 --visit-* 色票在這裡補。
    expect(manage).toMatch(/\.parent-visit-reschedule \{ --visit-ink: var\(--green\);/)
  })

  it('參觀人數屬於這次參觀的安排，排在場次後、孩子資料前', () => {
    const party = form.indexOf('id="party-size"')
    expect(party).toBeGreaterThan(form.indexOf('class="visit-slot-list"'))
    expect(party).toBeLessThan(form.indexOf('id="visit-child-title"'))
  })
})

describe('送出前確認', () => {
  it('送出鈕寫「確認預約」，旁邊寫出所選日期、場次與人數', () => {
    expect(form).not.toContain('送出參觀需求')
    expect(form).toContain("{{ submitting ? '正在預約…' : '確認預約' }}")
    expect(form).toContain('<p class="visit-summary-what"><strong>{{ selectedCampus.name }}</strong>')
  })

  it('沒開寄信時，Email 說明不承諾確認信', () => {
    expect(form).toMatch(/const emailHint = computed\(\(\) => bookingConfig\.value\?\.parent_email_enabled\s*\? '確認信與修改連結會寄到這裡。'/)
    expect(form).toContain('<p id="visit-email-hint" class="visit-field-hint">{{ emailHint }}</p>')
  })
})

describe('選校與迎賓區', () => {
  it('選校卡標出各校參觀方式，讀到前先保留一行高度', () => {
    expect(form).toContain("if (kind === 'form') return '可線上預約'")
    expect(form).toContain('class="visit-campus-mode"')
    expect(css).toMatch(/\.visit-campus-mode \{[^}]*min-height:24px/)
  })

  it('眉標用中文，不再是英文寬字距', () => {
    expect(form).not.toContain('VISIT IVY')
    expect(css).toMatch(/\.visit-eyebrow \{[^}]*letter-spacing:\.06em/)
  })

  it('手機的「下一步」黏在畫面底部', () => {
    const mobile = css.slice(css.indexOf('@media(max-width:760px)'))
    expect(mobile).toMatch(/\.visit-next-row \{position:sticky;bottom:0/)
  })
})
