import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-11-17：iPhone 上預約表單的「寶貝出生年月日」比上面的「寶貝姓名」寬 34px，還把整頁往右推。
// iOS Safari 的原生日期欄（appearance:auto）只要寬度不是固定 px，WebKit 就會強制 box-sizing:content-box
// 並設最小寬度（RenderThemeIOS.mm adjustInputElementButtonStyle）：width:100% 再加上左右 padding 與邊框，
// 欄位就超出容器。桌機 Chrome／Safari 不走這段，所以只在手機上看得到。
// 拿掉原生外觀（appearance:none）才會照我們的 border-box；iOS 預設把日期置中，也要改回靠左。
// 這裡守住兩張表單的日期欄：預約表單（visit-booking.css）與家長修改預約（visit/manage.vue）。
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

/** 選擇器含 `input[type=date]` 的規則內容（不含巢狀；兩個檔案都是平的規則）。 */
function dateRules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body: body.replace(/\s+/g, '') }))
    .filter(({ selector }) => /input\[type=["']?date["']?\]/.test(selector))
}

const forms = [
  { name: '預約表單', path: 'app/assets/css/visit-booking.css', scope: '.visit-field' },
  { name: '家長修改預約', path: 'app/pages/visit/manage.vue', scope: '.parent-visit-fields' }
]

describe.each(forms)('$name 的日期欄在 iOS 不比其他欄位寬', ({ path, scope }) => {
  const rules = dateRules(read(path)).filter(({ selector }) => selector.includes(scope))

  it('拿掉原生外觀（含 -webkit- 前綴，iOS 15 也吃得到）', () => {
    const own = rules.filter(({ selector }) => !selector.includes('::'))
    expect(own.some(({ body }) => body.includes('-webkit-appearance:none') && /(^|;)appearance:none/.test(body))).toBe(true)
  })

  it('日期文字靠左，和其他欄位對齊', () => {
    const value = rules.filter(({ selector }) => selector.includes('::-webkit-date-and-time-value'))
    expect(value.some(({ body }) => /text-align:(start|left)/.test(body))).toBe(true)
  })
})
