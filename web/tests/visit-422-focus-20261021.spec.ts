// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { focusFirstInvalidField } from '../app/utils/visit-form'

// 2026-10-21 預約表單送出後伺服器回 422 指出欄位：焦點要交給第一個出錯的欄位，
// 和前端驗證不過時一致；原本只落在表單頂端那行摘要，欄位在一千多 px 以下。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const visitForm = read('../app/components/VisitForm.vue')

describe('focusFirstInvalidField', () => {
  afterEach(() => { document.body.innerHTML = '' })
  it('焦點交給 DOM 順序上第一個 aria-invalid="true" 的欄位', () => {
    document.body.innerHTML = '<form><input id="ok" aria-invalid="false"><input id="first" aria-invalid="true"><input id="second" aria-invalid="true"></form>'
    const form = document.querySelector('form')!
    expect(focusFirstInvalidField(form)).toBe(true)
    expect(document.activeElement).toBe(form.querySelector('#first'))
  })
  it('沒有出錯的欄位（或沒有表單）時回 false、不動焦點', () => {
    document.body.innerHTML = '<form><input id="ok" aria-invalid="false"><input id="plain"></form>'
    const form = document.querySelector('form')!
    ;(form.querySelector('#plain') as HTMLInputElement).focus()
    expect(focusFirstInvalidField(form)).toBe(false)
    expect(document.activeElement).toBe(form.querySelector('#plain'))
    expect(focusFirstInvalidField(null)).toBe(false)
  })
})

describe('預約表單 422 欄位錯誤的焦點', () => {
  const submit = visitForm.slice(visitForm.indexOf('async function onSubmit()'), visitForm.indexOf('</script>'))
  const branch422 = submit.slice(submit.indexOf('status === 422'), submit.indexOf('} else {\n      submitError.value = `送出失敗'))
  it('422 帶得出欄位時標記要聚焦欄位，不先跳到頂端摘要', () => {
    expect(branch422).toContain('focusInvalidField = true')
    expect(submit).toContain('if (!submitRetryHint.value && !focusInvalidField) await focusError()')
  })
  it('等送出中的 fieldset 解除 disabled 才聚焦，找不到欄位再退回頂端摘要', () => {
    expect(submit).toMatch(/\} finally \{\n\s+submitting\.value = false\n\s+\}\n[\s\S]*if \(focusInvalidField\) \{\n\s+await nextTick\(\)\n\s+if \(!focusFirstInvalidField\(formRef\.value\)\) await focusError\(\)/)
  })
  it('前端驗證不過沿用同一個聚焦函式', () => {
    expect(submit).toContain('focusFirstInvalidField(formRef.value)')
    expect(submit).not.toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')")
  })
})
