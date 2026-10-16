import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apiFieldErrors, expectedStartOptions, expectedStartText } from '../app/utils/visit-form'

// 2026-10-15 預計入學時間：選項與後端 app/booking/expected_start.py 讀同一份案例（計畫裁定 P2）。
interface ChoiceCase { name: string; today: string; values: string[]; labels: string[] }
const casesPath = fileURLToPath(new URL('../../contracts/expected-start-cases.json', import.meta.url))
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as { choices: ChoiceCase[] }
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('預計入學時間的選項', () => {
  it.each(cases.choices.map(c => [c.name, c] as const))('%s', (_name, item) => {
    const options = expectedStartOptions(item.today)
    expect(options.map(o => o.value)).toEqual(item.values)
    expect(options.map(o => o.label)).toEqual(item.labels)
  })

  it('共用案例涵蓋四個學期邊界日（1/31、2/1、7/31、8/1），案例檔被刪減時這裡會紅', () => {
    const days = cases.choices.map(c => c.today)
    expect(days).toEqual(expect.arrayContaining(['2027-01-31', '2027-02-01', '2027-07-31', '2027-08-01']))
  })

  it('1/31 與 2/1 差一個學期、7/31 與 8/1 差一個學期，同學期內的日子選項相同', () => {
    const at = (day: string) => expectedStartOptions(day).map(o => o.value)
    expect(at('2027-01-31')).not.toEqual(at('2027-02-01'))
    expect(at('2027-07-31')).not.toEqual(at('2027-08-01'))
    expect(at('2026-08-01')).toEqual(at('2027-01-31'))
    expect(at('2027-02-01')).toEqual(at('2027-07-31'))
  })

  it('家長看的短文字：盡快、還不確定、學期換成月份；認不得的值原樣顯示', () => {
    expect(expectedStartText('asap')).toBe('盡快')
    expect(expectedStartText('unsure')).toBe('還不確定')
    expect(expectedStartText('115-2')).toBe('2027 年 2 月')
    expect(expectedStartText('116-1')).toBe('2027 年 9 月')
    expect(expectedStartText('x')).toBe('x')
  })

  it('後端 422 指到 expected_start 時寫在這一題下面', () => {
    expect(apiFieldErrors([{ loc: ['body', 'expected_start'], msg: 'x' }])).toEqual({ expectedStart: '這個入學時間已過期，請重新選擇。' })
  })
})

describe('預約表單放這一題的方式（規格 X3）', () => {
  const form = read('../app/components/VisitForm.vue')

  it('放在孩子資料區塊、生日之後，是單選膠囊、標選填', () => {
    const child = form.slice(form.indexOf('id="visit-child-title"'), form.indexOf('id="visit-parent-title"'))
    expect(child.indexOf('child-birthdate')).toBeLessThan(child.indexOf('visit-expected-start'))
    expect(child).toMatch(/<legend>預計入學時間<small>選填<\/small><\/legend>/)
    expect(child).toContain('type="radio" name="expectedStart"')
  })

  it('沒選就不帶 expected_start，選了才帶（不送空字串，後端會回 422）', () => {
    expect(form).toContain("...(form.expectedStart ? { expected_start: form.expectedStart } : {})")
    expect(form).not.toMatch(/expected_start:\s*form\.expectedStart\s*[,}]\s*$/m)
  })

  it('再點一次已選的那一個就取消選取', () => {
    expect(form).toMatch(/form\.expectedStart = form\.expectedStart === value \? '' : value/)
  })

  it('成功頁在有選時列出「預計入學」，沒選不列', () => {
    expect(form).toContain('<div v-if="form.expectedStart"><dt>預計入學</dt>')
  })
})
