import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-17 使用者要求：預約頁「歡迎與○○校聯絡」的 LINE 連結改成按鈕、拿掉 ↗；
// 預約成功畫面的行事曆與導航按鈕也拿掉 ↗（另開分頁只留給讀屏的說明）。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('預約頁聯絡步驟與成功畫面的按鈕不放箭頭', () => {
  const form = read('../app/components/VisitForm.vue')
  const contact = form.slice(form.indexOf('class="booking-alt-cta visit-contact-step"'), form.indexOf('<form v-else ref="formRef"'))

  it('LINE 聯絡是帶 LINE 圖示的外框鈕，不是底線小字', () => {
    const line = contact.split('\n').find(row => row.includes('LINE 聯絡{{ selectedCampus.name }}'))
    expect(line).toBeTruthy()
    expect(line).toContain('class="button outline"')
    expect(line).toContain('<use href="#i-line" />')
    expect(line).toContain('<span class="sr-only">（另開新視窗）</span>')
    expect(line).not.toContain('visit-inline-link')
  })

  it('聯絡步驟的按鈕都沒有 ↗', () => {
    expect(contact.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('↗')
  })

  it('成功畫面的行事曆與導航按鈕沒有 ↗，仍告訴讀屏會另開視窗', () => {
    const calendar = read('../app/components/VisitCalendarActions.vue')
    const template = calendar.slice(calendar.indexOf('<template>'), calendar.indexOf('</template>'))
    expect(template).not.toContain('↗')
    expect(template.match(/（另開新視窗）/g)).toHaveLength(2)
  })

  it('外框鈕有 hover 回饋，LINE 圖示比線條圖示大一級', () => {
    const css = read('../app/assets/css/visit-booking.css')
    expect(css).toContain('.visit-page .button.outline:hover:not(:disabled) {background:var(--visit-soft)}')
    expect(css).toContain('.visit-contact-actions .button .icon-line {width:1.35em;height:1.35em}')
  })
})
