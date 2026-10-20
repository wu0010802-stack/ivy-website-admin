import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { ApiError } from '../api/client'
import { cleanup, mockPost, mountWith, options, visit } from './admissionsTestKit'

afterEach(cleanup)

// 2026-10-20 稽核 #10：已 commit 但回應遺失時接待會再按一次儲存，同一張表單要帶同一把 Idempotency-Key。
const field = (selector: string) => document.body.querySelector<HTMLInputElement>(selector)!
function typeInto(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input'))
}
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

async function openAdd() {
  const mounted = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'renwu', options: options(), mode: 'add', record: null } })
  await mounted.wrapper.setProps({ modelValue: true })
  await flushPromises()
  return mounted
}

async function fill(wrapper: VueWrapper, name: string) {
  typeInto(field('input[aria-label="幼生姓名"]'), name)
  wrapper.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('placeholder') === '選擇生日')!.vm.$emit('update:modelValue', '2023-03-02')
  await flushPromises()
}

const keyOf = (call: unknown[]) => (call[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key']

describe('新增訪視帶 Idempotency-Key', () => {
  it('回應遺失後重按儲存帶同一把 key；改了內容換新 key', async () => {
    let fail = true
    const post = mockPost({
      '/admin/admissions/records': (_path: string, body?: unknown) => {
        if (fail) throw new ApiError(502, 'Bad Gateway')
        return visit({ ...(body as object), id: 'v-new' })
      },
    })
    const { wrapper } = await openAdd()
    await fill(wrapper, '陳小寶')

    bodyButton('儲存')!.click()
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    const first = keyOf(post.mock.calls[0]!)
    expect(first).toBeTruthy()
    expect(keyOf(post.mock.calls[1]!)).toBe(first)

    typeInto(field('input[aria-label="幼生姓名"]'), '陳小貝')
    await flushPromises()
    fail = false
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(keyOf(post.mock.calls[2]!)).toBeTruthy()
    expect(keyOf(post.mock.calls[2]!)).not.toBe(first)
  })

  it('儲存並新增下一筆後，下一筆用新的 key', async () => {
    const post = mockPost({ '/admin/admissions/records': (_path: string, body?: unknown) => visit({ ...(body as object), id: 'v-new' }) })
    const { wrapper } = await openAdd()
    await fill(wrapper, '陳小寶')
    bodyButton('儲存並新增下一筆')!.click()
    await flushPromises()
    await fill(wrapper, '陳小寶')
    bodyButton('儲存並新增下一筆')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(keyOf(post.mock.calls[0]!)).toBeTruthy()
    expect(keyOf(post.mock.calls[1]!)).not.toBe(keyOf(post.mock.calls[0]!))
  })
})
