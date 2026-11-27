import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-27：讀場次時的骨架照載入後的版面留高度。原本一律 400px，手機一欄（月曆在上、場次在下）載入後是
// 497px＋上緣間距 12px，下面的「寶貝資料」整塊被推下 109px（正式站 390 寬 CLS 0.015、430 寬 0.024）。
// 本機這個分支的 build 讀正式站場次：/visit/yihua 九種視窗 CLS 都是 0，「寶貝資料」標題載入前後同一個位置。
const css = readFileSync(fileURLToPath(new URL('../app/assets/css/visit-booking.css', import.meta.url)), 'utf8')

describe('預約第二步：場次骨架的高度與間距同載入後', () => {
  it('一欄 497px（月曆 408＋間距 22＋場次欄 67）；360 以下日期格 50px，467px；場次區 ≥600px 兩欄時只有月曆 408px', () => {
    expect(css).toContain('.visit-slots-loading {min-height:497px}')
    expect(css).toContain('@media(max-width:360px) {.visit-slots-loading {min-height:467px}}')
    expect(css).toContain('@container (min-width:600px) {.visit-slots-loading {min-height:408px}}')
    // 兩欄的條件要跟場次區的容器查詢同一個門檻
    expect(css).toMatch(/@container \(min-width:600px\) \{\s*\.visit-schedule-fields>\* \{min-width:0\}/)
    expect(css).not.toContain('.visit-slots-loading {min-height:400px}')
  })

  it('上緣間距跟 .visit-schedule-fields 一起寫（預設 18px、760 以下 12px），換間距時兩邊不會分家', () => {
    expect(css).toContain('.visit-form-section .visit-field-grid,.visit-schedule-fields,.visit-slots-loading {margin-top:18px}')
    expect(css).toContain('.visit-schedule-fields,.visit-slots-loading {margin-top:12px}')
  })

  it('數字的來源：日期格最小高度 54px（360 以下 50px）、場次欄上緣 22px；改這些要重量骨架', () => {
    const picker = readFileSync(fileURLToPath(new URL('../app/components/VisitDatePicker.vue', import.meta.url)), 'utf8')
    expect(picker).toMatch(/\.visit-day \{[^}]*min-height:54px/)
    expect(picker).toMatch(/@media\(max-width:360px\) \{\s*\.visit-month-grid \{gap:4px\}\s*\.visit-day \{min-height:50px/)
    expect(css).toContain('.visit-slot-list {margin-top:22px}')
  })
})
