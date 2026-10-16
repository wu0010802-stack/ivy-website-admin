import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { api, ApiError } from '../api/client'
import { expectedStartLabel, expectedStartStaffOptions, VISIT_DETAIL_FIELD_LABELS } from '../api/labels'
import { visitEventChanges } from '../api/visitHistory'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import VisitDetailsDialog from '../components/visit/VisitDetailsDialog.vue'
import { privacySampleSections } from '../composables/privacyNotice'
import { privacyPolicyDraft } from '../composables/privacyPolicyDraft'
import VisitDetailView from '../views/VisitDetailView.vue'
import { bodyOf, cleanup, mockGet, mockPatch, mockPost } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

// 2026-10-15 預計入學時間：顯示文字與後端 app/booking/expected_start.py 讀同一份案例（計畫裁定 P2、P3）。
interface LabelCase { value: string; submitted_on: string; label: string }
interface ChoiceCase { name: string; today: string; values: string[] }
const cases = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/expected-start-cases.json'), 'utf8')) as { labels: LabelCase[]; choices: ChoiceCase[] }
const labelOf = (value: string, submittedOn: string) => cases.labels.find((c) => c.value === value && c.submitted_on === submittedOn)!.label

const dialogs: VueWrapper[] = []
afterEach(() => {
  dialogs.forEach((wrapper) => wrapper.unmount())
  dialogs.length = 0
  cleanup()
})

// 後台下拉的範圍依台北「今天」算，凍結成 2026-10-15（115 學年上學期）才能寫死預期值；cleanup 會還原計時器。
const OCT_15 = '2026-10-15T04:00:00Z'
const OCT_15_VALUES = ['asap', '114-1', '114-2', '115-1', '115-2', '116-1', '116-2', '117-1', '117-2', '118-1', 'unsure']
const freezeDate = () => vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date(OCT_15))
// 真的用滑鼠清除：hover 之後才出現清除鈕。Element Plus 清除後預設發出 undefined，元件靠 value-on-clear="" 換成空字串；
// 直接 emit('') 的測試看不出這一點。
async function clearByClick(select: VueWrapper) {
  await select.trigger('mouseenter')
  await flushPromises()
  await select.get('.el-select__clear').trigger('click')
  await flushPromises()
}
const optionValues = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))

describe('預計入學時間的文字', () => {
  it.each(cases.labels.map((c) => [`${c.value}@${c.submitted_on}`, c] as const))('%s', (_name, item) => {
    expect(expectedStartLabel(item.value, item.submitted_on)).toBe(item.label)
  })

  it('沒選是空字串；歷程的欄位名有中文', () => {
    expect(expectedStartLabel(null, '2026-10-15')).toBe('')
    expect(expectedStartLabel(undefined, '2026-10-15')).toBe('')
    expect(expectedStartLabel('unsure', '2026-10-15')).not.toBe('')
    expect(VISIT_DETAIL_FIELD_LABELS.expected_start).toBe('預計入學時間')
  })

  it('歷程記到改了這一題：欄位名寫中文「預計入學時間」，家長改與園方人員改都一樣，不寫內容', () => {
    const event = (extra: Record<string, unknown>) => ({ id: 'h1', event_type: 'details_updated', before: null, after: { fields: ['phone', 'expected_start'] }, ...extra }) as never
    expect(visitEventChanges(event({ source: 'parent' }))).toEqual(['家長改了 手機、預計入學時間'])
    expect(visitEventChanges(event({ source: 'staff', actor_user_id: 'u1', actor_display_name: '怡君' }))).toEqual(['怡君改了 手機、預計入學時間'])
  })

  it('後台選項：盡快、前兩個學期到之後六個學期、還不確定；目前的值不在範圍內也列出來', () => {
    const options = expectedStartStaffOptions('2026-10-15')
    expect(options.map((o) => o.value)).toEqual(OCT_15_VALUES)
    expect(options[4]!.label).toBe('2027 年 2 月（115 學年下學期）')
    expect(expectedStartStaffOptions('2026-10-15', '110-1')[1]).toEqual({ value: '110-1', label: '2021 年 9 月（110 學年上學期）' })
    // 在範圍內的值不會重複列。
    expect(expectedStartStaffOptions('2026-10-15', '115-2').map((o) => o.value)).toEqual(OCT_15_VALUES)
  })

  it.each(cases.choices.map((c) => [c.name, c] as const))('後台範圍涵蓋官網的選項，學期邊界一致：%s', (_name, item) => {
    const staff = expectedStartStaffOptions(item.today).map((o) => o.value)
    expect(staff).toEqual(expect.arrayContaining(item.values))
    // 後台從今天所在學期的前兩個學期起算：盡快之後依序是前兩個學期、今天所在學期，官網的第一個月份排第 5 個。
    // 1/31、2/1、7/31、8/1 任一邊界算錯一個學期，這個位置就會移動。
    expect(staff[0]).toBe('asap')
    expect(staff.indexOf(item.values[1]!)).toBe(4)
    expect(staff.at(-1)).toBe('unsure')
  })
})

describe('修改家長資料：預計入學時間', () => {
  const PATH = `/admin/visit-requests/${VISIT_ID}/details`
  const body = () => new DOMWrapper(document.body)
  const saved = (extra: Record<string, unknown> = {}) => ({
    ...visitCase({ details_version: 4 }), changed_fields: ['expected_start'], admissions_synced_fields: [], admissions_skipped_fields: [], email_notified: false, access_link_reset: false, ...extra,
  })

  async function openDialog(detail: Record<string, unknown>) {
    const wrapper = mount(VisitDetailsDialog, {
      props: { modelValue: true, detail } as never,
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    })
    dialogs.push(wrapper)
    await flushPromises()
    return wrapper
  }
  const select = (wrapper: VueWrapper) => wrapper.findComponent({ name: 'ElSelect' })
  const save = async () => {
    await body().findAll('button').find((b) => b.text() === '儲存')!.trigger('click')
    await flushPromises()
  }

  it('清空送 null（其他欄位沒動就不送）', async () => {
    const patch = mockPatch({ [PATH]: saved() })
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: 'asap' }))
    const field = body().findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '預計入學時間')
    expect(field).toBeTruthy()
    // 對話框裡只有這一個 el-select（生日是 el-date-picker）。
    await clearByClick(select(wrapper))
    expect(select(wrapper).props('modelValue')).toBe('')
    await save()
    expect(bodyOf(patch, PATH)).toEqual({ expected_version: 3, expected_start: null })
  })

  it('原本沒填，選了又清掉：視同沒動，不呼叫 API', async () => {
    const patch = mockPatch({ [PATH]: saved() })
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: null }))
    select(wrapper).vm.$emit('update:modelValue', 'asap')
    await flushPromises()
    expect(select(wrapper).props('modelValue')).toBe('asap')
    await clearByClick(select(wrapper))
    await save()
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('開啟時帶入現值；沒動任何欄位按儲存：不呼叫 API', async () => {
    const patch = mockPatch({ [PATH]: saved() })
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: '116-1' }))
    expect(select(wrapper).props('modelValue')).toBe('116-1')
    await save()
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('原本沒填：選一個學期就只送這一欄；沒填時選單是空的', async () => {
    const patch = mockPatch({ [PATH]: saved() })
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: null }))
    expect(select(wrapper).props('modelValue')).toBe('')
    select(wrapper).vm.$emit('update:modelValue', '116-1')
    await flushPromises()
    await save()
    expect(bodyOf(patch, PATH)).toEqual({ expected_version: 3, expected_start: '116-1' })
  })

  it('只改別的欄位：不送預計入學時間（現值照舊保留）', async () => {
    const patch = mockPatch({ [PATH]: saved({ changed_fields: ['email'] }) })
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: 'asap' }))
    expect(select(wrapper).props('modelValue')).toBe('asap')
    await body().findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === 'Email')!.get('input').setValue('new@example.com')
    await save()
    const sent = bodyOf(patch, PATH) as Record<string, unknown>
    expect(sent).toEqual({ expected_version: 3, email: 'new@example.com' })
    expect('expected_start' in sent).toBe(false)
  })

  it('選項是後台範圍：前兩個學期到之後六個學期，含盡快與還不確定', async () => {
    freezeDate()
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: null }))
    expect(optionValues(wrapper)).toEqual(OCT_15_VALUES)
    const labels = wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))
    expect(labels[0]).toBe('盡快')
    expect(labels[5]).toBe('2027 年 9 月（116 學年上學期）')
    expect(labels.at(-1)).toBe('還不確定')
  })

  it('現值已不在範圍內（很久以前選的學期）：照樣列在選單裡，打開表單不會弄丟', async () => {
    freezeDate()
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: '110-1' }))
    expect(optionValues(wrapper)).toEqual(['asap', '110-1', ...OCT_15_VALUES.slice(1)])
    expect(select(wrapper).props('modelValue')).toBe('110-1')
  })

  it('後端 422 指到預計入學時間：寫在這一欄下面，對話框不關', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(422, [{ loc: ['body', 'expected_start'], msg: '預計入學時間的格式不對', type: 'value_error' }]))
    const wrapper = await openDialog(visitCase({ details_version: 3, expected_start: null }))
    select(wrapper).vm.$emit('update:modelValue', 'asap')
    await flushPromises()
    await save()
    // el-form-item 的錯誤訊息晚 100ms 才出現（refDebounced）。
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    const field = body().findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '預計入學時間')!
    expect(field.text()).toContain('預計入學時間的格式不對')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('補登與重新預約：預計入學時間', () => {
  const SLOT = { id: 'slot-f', campus_key: 'yihua', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 1, closed: false }
  const created = { id: 'new-case', status: 'confirmed', slot: SLOT }
  const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!

  async function openManual(relatedFrom: Record<string, unknown> | null = null) {
    vi.spyOn(api, 'get').mockResolvedValue([SLOT] as never)
    const post = mockPost({ '/admin/visit-requests': created })
    const wrapper = mount(ManualVisitDialog, {
      props: { campusKeys: ['yihua'], modelValue: false, relatedFrom: relatedFrom as never },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    dialogs.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return { wrapper, post }
  }
  const startSelect = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => String(s.props('placeholder')).includes('預計什麼時候入學'))!

  async function submitFilled(wrapper: VueWrapper) {
    const fill = (placeholder: string, value: string) => {
      const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
    // 重新預約已帶入稱呼與手機，只有空白表單要補。
    if (!document.body.querySelector<HTMLInputElement>('input[placeholder="例如：王媽媽"]')!.value) fill('例如：王媽媽', '王媽媽')
    if (!document.body.querySelector<HTMLInputElement>('input[placeholder="0912345678"]')!.value) fill('0912345678', '0912345678')
    wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '選擇場次')!.vm.$emit('update:modelValue', 'slot-f')
    await flushPromises()
    button('補登案件').click()
    await flushPromises()
  }

  it('選項是後台範圍：前兩個學期到之後六個學期，含盡快與還不確定', async () => {
    freezeDate()
    const { wrapper } = await openManual()
    expect(startSelect(wrapper).findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(OCT_15_VALUES)
  })

  it('選了學期：補登送出帶這個值', async () => {
    const { wrapper, post } = await openManual()
    startSelect(wrapper).vm.$emit('update:modelValue', '116-2')
    await flushPromises()
    await submitFilled(wrapper)
    expect(bodyOf(post, '/admin/visit-requests')).toMatchObject({ parent_name: '王媽媽', expected_start: '116-2' })
  })

  it('沒選：補登送 null，不送空字串', async () => {
    const { wrapper, post } = await openManual()
    expect(startSelect(wrapper).props('modelValue')).toBe('')
    await submitFilled(wrapper)
    expect(bodyOf(post, '/admin/visit-requests')).toMatchObject({ parent_name: '王媽媽', expected_start: null })
  })

  it('選了又清空：補登送 null', async () => {
    const { wrapper, post } = await openManual()
    startSelect(wrapper).vm.$emit('update:modelValue', 'asap')
    await flushPromises()
    expect(startSelect(wrapper).props('modelValue')).toBe('asap')
    await clearByClick(startSelect(wrapper))
    expect(startSelect(wrapper).props('modelValue')).toBe('')
    await submitFilled(wrapper)
    expect(bodyOf(post, '/admin/visit-requests')).toMatchObject({ expected_start: null })
  })

  it('重新預約：帶入舊案的預計入學時間，送出時帶著', async () => {
    const { wrapper, post } = await openManual(visitCase({ expected_start: '116-1' }))
    expect(startSelect(wrapper).props('modelValue')).toBe('116-1')
    await submitFilled(wrapper)
    expect(bodyOf(post, '/admin/visit-requests')).toMatchObject({ related_request_id: VISIT_ID, expected_start: '116-1' })
  })

  it('重新預約：舊案沒填就留空，送 null', async () => {
    const { wrapper, post } = await openManual(visitCase({ expected_start: null }))
    expect(startSelect(wrapper).props('modelValue')).toBe('')
    await submitFilled(wrapper)
    expect(bodyOf(post, '/admin/visit-requests')).toMatchObject({ related_request_id: VISIT_ID, expected_start: null })
  })

  it('舊案的學期已過期：重新預約的選單仍列出它，不會被悄悄換掉', async () => {
    freezeDate()
    const { wrapper } = await openManual(visitCase({ expected_start: '110-2' }))
    const values = startSelect(wrapper).findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))
    expect(values).toEqual(['asap', '110-2', ...OCT_15_VALUES.slice(1)])
    expect(startSelect(wrapper).props('modelValue')).toBe('110-2')
  })
})

describe('案件明細的家長資料表', () => {
  const factLabels = (wrapper: VueWrapper) => wrapper.findAll('.case-facts dt').map((dt) => dt.text())
  const factText = (wrapper: VueWrapper, label: string) => wrapper.findAll('.case-facts dt').find((dt) => dt.text() === label)!.element.nextElementSibling!.textContent!.trim()
  // 確認時間和送單時間不同才多一列「確認時間」；兩個都設成送單當下，列數才固定。
  const submitted = (at: string, extra: Record<string, unknown>) => visitCase({ created_at: at, confirmed_at: at, ...extra })
  async function mountDetail(data: Record<string, unknown>) {
    mockGet(caseRoutes(data))
    return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })).wrapper
  }

  it('選了學期：多一列「預計入學」，寫月份與學期', async () => {
    const wrapper = await mountDetail(submitted('2026-10-15T08:00:00Z', { expected_start: '115-2' }))
    expect(factLabels(wrapper)).toEqual(['電話', '孩子', 'Email', '得知管道', '預計入學'])
    expect(factText(wrapper, '預計入學')).toBe(labelOf('115-2', '2026-10-15'))
  })

  it('選了盡快：寫明送單時是哪個學期', async () => {
    const wrapper = await mountDetail(submitted('2026-10-15T08:00:00Z', { expected_start: 'asap' }))
    expect(factText(wrapper, '預計入學')).toBe(labelOf('asap', '2026-10-15'))
  })

  it('「盡快」用送單的台北日期換算：UTC 還在 1/31 的晚上，台北已是 2/1，算下學期', async () => {
    // 2027-01-31 17:00Z ＝ 台北 2027-02-01 01:00，已過學期分界。
    const wrapper = await mountDetail(submitted('2027-01-31T17:00:00Z', { expected_start: 'asap' }))
    expect(factText(wrapper, '預計入學')).toBe(labelOf('asap', '2027-02-01'))
  })

  it('沒選預計入學時間：不列這一列（其他列照常）', async () => {
    const wrapper = await mountDetail(visitCase({ expected_start: null }))
    expect(factLabels(wrapper)).toEqual(['電話', '孩子', 'Email', '得知管道'])
  })
})

describe('隱私說明草稿', () => {
  it('官網內建的隱私說明與隱私權政策初稿都寫出預計入學時間（選填）', () => {
    const collected = privacySampleSections().find((section) => section.heading.includes('蒐集的資料'))!
    expect(collected.body).toContain('預計入學時間（選填）')
    expect(collected.body).toContain('孩子姓名與出生年月日')
    const policy = privacyPolicyDraft().sections.find((section) => section.heading.includes('我們蒐集的資料'))!
    expect(policy.body).toContain('- 預計入學時間（選填）')
    expect(policy.body).toContain('孩子的姓名與生日、預計入學時間，也可以取消或改期')
  })
})
