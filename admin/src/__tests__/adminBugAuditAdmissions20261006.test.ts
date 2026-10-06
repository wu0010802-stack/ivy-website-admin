// 2026-10-06 後台 bug 稽核（前端）：招生入學（第 9–13 條）。後端同步改權限與 409，這裡對上。
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import FunnelCard from '../components/admissions/FunnelCard.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { canDragFrom, moveTargets, transitionCapability } from '../admissions/constants'
import { board, card, cleanup, deferred, mockGet, mountWith, options, reception, visit } from './admissionsTestKit'

afterEach(cleanup)

const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

// ------------------------------------------------------------------ 9
describe('9. 從已註冊退出的取消退出要 admissions.convert', () => {
  const receptionCan = (capability: string) => ['admissions.read', 'admissions.write'].includes(capability)
  const adminCan = () => true

  it('權限表：退註冊的取消退出要 convert；退預繳照舊 write；不帶 withdrawn_from 時同後端 _CAPABILITY', () => {
    expect(transitionCapability('withdrawn', 'visited', 'enrolled')).toBe('admissions.convert')
    expect(transitionCapability('withdrawn', 'deposited', 'enrolled')).toBe('admissions.convert')
    expect(transitionCapability('withdrawn', 'visited', 'deposited')).toBe('admissions.write')
    expect(transitionCapability('withdrawn', 'visited')).toBe('admissions.write')
    expect(transitionCapability('withdrawn', 'enrolled', 'enrolled')).toBeNull()
    expect(canDragFrom('withdrawn', receptionCan, 'enrolled')).toBe(false)
    expect(canDragFrom('withdrawn', receptionCan, 'deposited')).toBe(true)
    expect(moveTargets('withdrawn', receptionCan, 'enrolled')).toEqual([])
    expect(moveTargets('withdrawn', receptionCan, 'deposited')).toEqual(['visited', 'deposited'])
    expect(moveTargets('withdrawn', adminCan, 'enrolled')).toEqual(['visited', 'deposited'])
  })

  it('看板：沒有 convert 的人不能拖回、也沒有「移到…」從已註冊退出的卡片；退預繳的照常', async () => {
    mockGet({
      '/admin/admissions/board': board({
        withdrawn: [card({ id: 'w-e', child_name: '退註冊', withdrawn_from: 'enrolled' }), card({ id: 'w-d', child_name: '退預繳', withdrawn_from: 'deposited' })],
      }),
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null }, user: reception() })
    const cardOf = (id: string) => wrapper.findAllComponents(FunnelCard).find((item) => item.props('card').id === id)!
    expect(cardOf('w-e').props('draggable')).toBe(false)
    expect(cardOf('w-e').props('targets')).toEqual([])
    expect(cardOf('w-d').props('draggable')).toBe(true)
    expect(cardOf('w-d').props('targets')).toEqual(['visited', 'deposited'])

    // 硬拖過去也不開確認框。
    await wrapper.get('.funnel-card[data-id="w-e"]').trigger('dragstart')
    await wrapper.get('.funnel__column[data-stage="visited"]').trigger('dragover')
    await wrapper.get('.funnel__column[data-stage="visited"]').trigger('drop')
    await flushPromises()
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('歷程抽屜：沒有 convert 看不到「移到…」；有 convert 的看得到', async () => {
    const withdrawn = visit({ stage: 'withdrawn', withdrawn_from: 'enrolled', withdrawn_at: '2026-09-20T02:00:00Z' })
    mockGet({ '/admin/admissions/records/v-1': withdrawn, '/admin/admissions/records/v-1/events': [], '/admin/admissions/records/v-1/contact-logs': [] })
    const desk = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1' }, user: reception() })
    await desk.wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(document.body.querySelector('[aria-label="移到其他階段"]')).toBeNull()
    cleanup()

    mockGet({ '/admin/admissions/records/v-1': withdrawn, '/admin/admissions/records/v-1/events': [], '/admin/admissions/records/v-1/contact-logs': [] })
    const admin = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1' } })
    await admin.wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(document.body.querySelector('[aria-label="移到其他階段"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ 10
describe('10. 已註冊／保留座位的訪視在編輯表單鎖住入學學期', () => {
  async function openEdit(record: ReturnType<typeof visit>): Promise<VueWrapper> {
    const { wrapper } = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'yihua', options: options(), mode: 'edit', record } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }
  const select = (wrapper: VueWrapper, placeholder: string) =>
    wrapper.findAllComponents({ name: 'ElSelect' }).find((component) => component.props('placeholder') === placeholder)!
  const semester = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElRadioGroup' }).find((group) => group.attributes('aria-label') === '入學學期')!

  it('已註冊：學年、學期、適讀班級都停用，說明要先取消註冊；改生日也不自動換班級', async () => {
    const wrapper = await openEdit(visit({ stage: 'enrolled', enrolled: true, has_deposit: true, grade: null }))
    expect(select(wrapper, '學年').props('disabled')).toBe(true)
    expect(semester(wrapper).props('disabled')).toBe(true)
    expect(select(wrapper, '請選擇班別').props('disabled')).toBe(true)
    expect(bodyText()).toContain('要改入學學期請先取消註冊')
    wrapper.findAllComponents({ name: 'ElDatePicker' }).find((picker) => picker.props('placeholder') === '選擇生日')!.vm.$emit('update:modelValue', '2022-03-02')
    await flushPromises()
    expect(select(wrapper, '請選擇班別').props('modelValue')).toBeNull()
  })

  it('已註冊但有保留年級：只鎖學年學期，班級可改（後端只在沒有保留年級時鎖班級）', async () => {
    const wrapper = await openEdit(visit({ stage: 'enrolled', enrolled: true, has_deposit: true, provisional_grade: '中班' }))
    expect(select(wrapper, '學年').props('disabled')).toBe(true)
    expect(select(wrapper, '請選擇班別').props('disabled')).toBeFalsy()
  })

  it('保留座位（已預繳、有保留年級）：學年學期停用，說明要用保留座位調整；班級可改', async () => {
    const wrapper = await openEdit(visit({ stage: 'deposited', has_deposit: true, provisional_grade: '中班' }))
    expect(select(wrapper, '學年').props('disabled')).toBe(true)
    expect(semester(wrapper).props('disabled')).toBe(true)
    expect(select(wrapper, '請選擇班別').props('disabled')).toBeFalsy()
    expect(bodyText()).toContain('要改學期請用保留座位調整')
    expect(bodyText()).not.toContain('要改入學學期請先取消註冊')
  })

  it('一般訪視照常可改', async () => {
    const wrapper = await openEdit(visit())
    expect(select(wrapper, '學年').props('disabled')).toBeFalsy()
    expect(semester(wrapper).props('disabled')).toBeFalsy()
    expect(bodyText()).toContain('小孩預計入學的學期')
  })
})

// 11.（待追蹤分頁記錄聯絡遇到 409）：分頁 2026-10-06 拿掉，測試一起拿掉。

// ------------------------------------------------------------------ 12
describe('12. 歷程抽屜換開另一筆時不顯示上一筆、不能對它操作', () => {
  it('新的一筆還在讀：上一筆的摘要與按鈕先拿掉', async () => {
    const second = deferred<unknown>()
    mockGet({
      '/admin/admissions/records/v-1': visit({ contact_name: '第一筆家長' }),
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': [],
      '/admin/admissions/records/v-2': () => second.promise,
    })
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1', childName: '王小安' } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(bodyText()).toContain('第一筆家長')
    expect(bodyButton('記錄聯絡')).toBeDefined()

    await wrapper.setProps({ visitId: 'v-2', childName: '李小樂' })
    await flushPromises()
    expect(bodyText()).not.toContain('第一筆家長')
    expect(bodyButton('記錄聯絡')).toBeUndefined()
    expect(document.body.querySelector('.events__lead')?.textContent).toContain('李小樂')

    second.resolve(visit({ id: 'v-2', child_name: '李小樂', contact_name: '第二筆家長' }))
    await flushPromises()
    expect(bodyText()).toContain('第二筆家長')
  })
})

// ------------------------------------------------------------------ 13
describe('13. 來源備註的提示不引導填個資', () => {
  it('placeholder 不寫「姓名」', async () => {
    const { wrapper } = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'yihua', options: options(), mode: 'add', record: null } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const source = wrapper.findAllComponents({ name: 'ElAutocomplete' }).find((item) => item.attributes('aria-label') === '來源備註' || item.props('ariaLabel') === '來源備註')!
    const placeholder = String(source.props('placeholder') ?? source.attributes('placeholder'))
    expect(placeholder).not.toContain('姓名')
    expect(placeholder).toContain('例如')
  })
})
