// 補登對話框帶入廣告名單（2026-11-26）：預填、送出帶 meta_lead_id、409 提示、沒傳名單時不變。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { api, ApiError } from '../api/client'
import type { MetaLeadOut } from '../api/types'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const slot = { id: 'slot-f', campus_key: 'yihua', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 1, closed: false }
const lead: MetaLeadOut = {
  id: 'lead-1',
  campus_key: 'yihua',
  form_name: '義華參觀表單',
  platform: 'ig',
  is_organic: false,
  created_at: '2026-11-26T02:30:00Z',
  parent_name: '王媽媽',
  phone: '0912345678',
  answers: [
    { question: 'email', answer: 'mom@example.invalid' },
    { question: '孩子幾歲', answer: '3 歲' },
  ],
  status: 'new',
  visit_request_id: null,
  handled_at: null,
}

async function openDialog(metaLead?: MetaLeadOut | null) {
  vi.spyOn(api, 'get').mockResolvedValue([slot] as never)
  const wrapper = mount(ManualVisitDialog, {
    props: { campusKeys: ['yihua', 'minghua'], modelValue: false, metaLead },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

const input = (selector: string) => document.body.querySelector<HTMLInputElement>(selector)!
const submitButton = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '補登案件')!
async function pickSlot(wrapper: VueWrapper) {
  wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '選擇場次')!.vm.$emit('update:modelValue', 'slot-f')
  await flushPromises()
}

describe('補登對話框：帶入廣告名單', () => {
  it('帶入校區、家長、電話、Email，聯絡紀錄預填表單名稱與每一題（不重複 Email）', async () => {
    await openDialog(lead)
    expect(input('input[placeholder="例如：王媽媽"]').value).toBe('王媽媽')
    expect(input('input[placeholder="0912345678"]').value).toBe('0912345678')
    expect(input('input[type="email"]').value).toBe('mom@example.invalid')
    const note = document.body.querySelector<HTMLTextAreaElement>('textarea[placeholder^="例如：家長來電"]')!
    expect(note.value).toBe('Meta 廣告名單（表單：義華參觀表單）\n孩子幾歲：3 歲')
    expect(document.body.textContent).toContain('廣告名單轉成參觀案件')
  })

  it('校區只能是名單所屬那一校；送出時帶 meta_lead_id 與預填的聯絡紀錄', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'v1', status: 'confirmed', slot } as never)
    const wrapper = await openDialog(lead)
    const campusSelect = wrapper.findComponent({ name: 'CampusSelect' })
    expect(campusSelect.props('keys')).toEqual(['yihua'])
    await pickSlot(wrapper)
    submitButton().click()
    await flushPromises()
    expect(post.mock.calls[0]![0]).toBe('/admin/visit-requests')
    expect(post.mock.calls[0]![1]).toMatchObject({
      meta_lead_id: 'lead-1',
      campus_key: 'yihua',
      parent_name: '王媽媽',
      phone: '0912345678',
      email: 'mom@example.invalid',
      note: 'Meta 廣告名單（表單：義華參觀表單）\n孩子幾歲：3 歲',
    })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it.each([
    ['META_LEAD_STATUS', '已經轉成案件'],
    ['META_LEAD_CAMPUS', '不是這一校'],
  ])('%s 409：顯示提示，對話框留著', async (code, text) => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code }))
    const wrapper = await openDialog(lead)
    await pickSlot(wrapper)
    submitButton().click()
    await flushPromises()
    expect(document.body.textContent).toContain(text)
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('後端有給訊息就用後端的說法', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'META_LEAD_STATUS', message: '這筆廣告名單已經轉成案件了，請重新整理' }))
    const wrapper = await openDialog(lead)
    await pickSlot(wrapper)
    submitButton().click()
    await flushPromises()
    expect(document.body.textContent).toContain('這筆廣告名單已經轉成案件了，請重新整理')
  })

  it('沒傳名單：標題、欄位全空、送出不帶 meta_lead_id、校區照原本的清單', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'v1', status: 'confirmed', slot } as never)
    const wrapper = await openDialog()
    expect(document.body.textContent).toContain('補登參觀案件')
    expect(input('input[placeholder="例如：王媽媽"]').value).toBe('')
    expect(wrapper.findComponent({ name: 'CampusSelect' }).props('keys')).toEqual(['yihua', 'minghua'])
    input('input[placeholder="例如：王媽媽"]').value = '李先生'
    input('input[placeholder="例如：王媽媽"]').dispatchEvent(new Event('input'))
    input('input[placeholder="0912345678"]').value = '0922333444'
    input('input[placeholder="0912345678"]').dispatchEvent(new Event('input'))
    await pickSlot(wrapper)
    submitButton().click()
    await flushPromises()
    expect(post.mock.calls[0]![1]).not.toHaveProperty('meta_lead_id')
  })
})
