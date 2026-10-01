import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import IntakePlanTab from '../components/admissions/IntakePlanTab.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, bodyOf, button, cleanup, deferred, hasButton, intakePlan, intakeRow, mockGet, mockPost, mockPut, mountWith,
  options, pathsTo, queryOf, reception, visit,
} from './admissionsTestKit'

afterEach(cleanup)

const planProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, ...changes })
const cells = (wrapper: VueWrapper) =>
  wrapper.findAll('.intake-table .el-table__body tr').map((row) => row.findAll('td').map((cell) => cell.text().trim()))
const inputValues = (wrapper: VueWrapper) => wrapper.findAll('.intake-table input').map((input) => (input.element as HTMLInputElement).value)
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

// 小班設了 0 名額又有 1 個保留：要顯示 0 與超額；幼幼班、大班沒設：顯示「未設定」與「—」。
const mixedPlan = () => intakePlan(
  [
    intakeRow('幼幼班'),
    intakeRow('小班', { target_seats: 0, reserved: 1, remaining: -1, over_capacity: true }),
    intakeRow('中班', { target_seats: 20, reserved: 3, enrolled: 2, remaining: 15 }),
    intakeRow('大班'),
  ],
  { target_seats: 20, reserved: 4, enrolled: 2, remaining: 14 },
)

describe('名額規劃（規格第 8 節）', () => {
  it('未設定與 0 分開顯示；超額標出來；合計只算有設定的（Review Focus 5）', async () => {
    const get = mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(pathsTo(get, '/admin/admissions/intake-plan')).toEqual(['/admin/admissions/intake-plan?campus_key=yihua&school_year=115&semester=1'])
    const [baby, small, middle] = cells(wrapper)
    expect(baby![0]).toBe('幼幼班')
    expect(baby![1]).toBe('未設定')
    expect(baby![4]).toBe('—')
    expect(small![1]).toBe('0')
    expect(small![4]).toContain('-1')
    expect(small![4]).toContain('超過計畫名額')
    expect(middle!.slice(1)).toEqual(['20', '3', '2', '15'])
    expect(wrapper.findAll('.intake-table .el-table__body tr')[1]!.classes()).toContain('intake-row--over')
    expect(wrapper.get('.intake__totals').text()).toMatch(/計畫\s*20.*保留\s*4.*註冊\s*2.*剩餘\s*14/)
  })

  it('後端沒回的年級補成「未設定」列，四個年級都在', async () => {
    mockGet({ '/admin/admissions/intake-plan': intakePlan([intakeRow('中班', { target_seats: 10, remaining: 10 })], { target_seats: 10, remaining: 10 }) })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(cells(wrapper).map((row) => [row[0], row[1]])).toEqual([['幼幼班', '未設定'], ['小班', '未設定'], ['中班', '10'], ['大班', '未設定']])
  })

  it('一個年級都沒設定：說明還沒設定，合計也寫未設定', async () => {
    mockGet({ '/admin/admissions/intake-plan': intakePlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    expect(wrapper.text()).toContain('115 上學期還沒有設定計畫名額')
    expect(wrapper.get('.intake__totals').text()).toMatch(/計畫\s*未設定/)
    expect(wrapper.get('.intake__totals').text()).toMatch(/剩餘\s*—/)
  })

  it('可編輯的帳號：空白是未設定、0 照樣顯示 0；只送改過的年級，清空＝刪除計畫', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const put = mockPut({ '/admin/admissions/intake-targets': intakePlan([intakeRow('幼幼班', { target_seats: 12, remaining: 12 })], { target_seats: 12, remaining: 12 }) })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    const inputs = wrapper.findAll('.intake-table input')
    expect(inputs.map((input) => (input.element as HTMLInputElement).value)).toEqual(['', '0', '20', ''])
    expect(inputs[0]!.attributes('placeholder')).toBe('未設定')
    expect(button(wrapper, '儲存計畫名額')!.attributes('disabled')).toBeDefined()

    const numbers = wrapper.findAllComponents({ name: 'ElInputNumber' })
    numbers[0]!.vm.$emit('update:modelValue', 12)
    numbers[2]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(wrapper.text()).toContain('有修改還沒儲存')
    await button(wrapper, '儲存計畫名額')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/admissions/intake-targets?campus_key=yihua', {
      school_year: 115, semester: 1, targets: { 幼幼班: 12, 中班: null },
    })
    expect(success).toHaveBeenCalledWith('已儲存計畫名額')
    expect(cells(wrapper)[0]![4]).toBe('12')
    expect(wrapper.text()).not.toContain('有修改還沒儲存')
  })

  it('只能看的帳號沒有輸入框與儲存鈕', async () => {
    mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(wrapper.findAll('.intake-table input')).toHaveLength(0)
    expect(hasButton(wrapper, '儲存計畫名額')).toBe(false)
  })

  it('頁首沒選學期或選了不限學年：用目前學年、上學期，並說明', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/intake-plan': intakePlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps({ schoolYear: null, semester: null }) })
    expect(pathsTo(get, '/admin/admissions/intake-plan')).toEqual(['/admin/admissions/intake-plan?campus_key=yihua&school_year=115&semester=1'])
    expect(wrapper.text()).toContain('頁首選了「不限學年」，先顯示 115 學年')
    expect(wrapper.text()).toContain('頁首沒選入學學期，先顯示上學期')
  })

  it('讀取失敗顯示錯誤，可以重新載入；儲存失敗顯示後端原因', async () => {
    let fail = true
    mockGet({
      '/admin/admissions/intake-plan': () => {
        if (fail) throw new Error('offline')
        return mixedPlan()
      },
    })
    const error = vi.spyOn(ElMessage, 'error')
    mockPut({ '/admin/admissions/intake-targets': () => { throw new ApiError(422, { code: 'VALIDATION_ERROR', message: '計畫名額不能小於 0' }) } })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    expect(wrapper.text()).toContain('無法讀取名額規劃，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 3)
    await flushPromises()
    await button(wrapper, '儲存計畫名額')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('計畫名額不能小於 0')
  })

  it('快速切換校區只顯示最後一次的名額', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/intake-plan': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : intakePlan([intakeRow('小班', { target_seats: 8, remaining: 8 })], { target_seats: 8, remaining: 8 }),
    })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(mixedPlan())
    await flushPromises()
    expect(cells(wrapper)[1]![1]).toBe('8')
    expect(cells(wrapper)[2]![1]).toBe('未設定')
  })
})

describe('名額規劃：儲存回應晚到', () => {
  it('儲存中切校區，A 校的 PUT 後回來不覆寫 B 校畫面，成功訊息照常', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const slowPut = deferred<unknown>()
    mockGet({
      '/admin/admissions/intake-plan': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? mixedPlan() : intakePlan([intakeRow('小班', { target_seats: 8, remaining: 8 })], { target_seats: 8, remaining: 8 }),
    })
    mockPut({ '/admin/admissions/intake-targets': () => slowPut.promise })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 12)
    await flushPromises()
    await button(wrapper, '儲存計畫名額')!.trigger('click')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    expect(inputValues(wrapper)).toEqual(['', '8', '', ''])
    slowPut.resolve(intakePlan([intakeRow('幼幼班', { target_seats: 12, remaining: 12 })], { target_seats: 12, remaining: 12 }))
    await flushPromises()
    expect(inputValues(wrapper)).toEqual(['', '8', '', ''])
    expect(success).toHaveBeenCalledWith('已儲存計畫名額')
  })
})

describe('保留座位（規格 6.5，明細「更多」）', () => {
  const recordsProps = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }

  async function moreLabels(wrapper: VueWrapper, id: string): Promise<string[]> {
    await wrapper.get(`[data-more="${id}"]`).trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector(`.records-more-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
    return [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].map((item) => item.textContent?.trim() ?? '')
  }
  async function chooseMore(wrapper: VueWrapper, id: string, label: string) {
    await moreLabels(wrapper, id)
    const item = [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].find((element) => element.textContent?.trim() === label)
    expect(item, `更多選單裡要有「${label}」`).toBeDefined()
    item!.click()
    await flushPromises()
  }

  it('只有已預繳的列有；已保留過的寫「變更座位」', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-a' }),
        visit({ id: 'v-b', has_deposit: true, stage: 'deposited' }),
        visit({ id: 'v-c', has_deposit: true, stage: 'deposited', provisional_grade: '小班' }),
        visit({ id: 'v-d', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled', provisional_grade: '小班' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(await moreLabels(wrapper, 'v-a')).not.toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-b')).toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-c')).toContain('變更座位')
    // 已註冊不能清除保留，要改年級請先取消註冊（規格 6.5）。
    const enrolled = await moreLabels(wrapper, 'v-d')
    expect(enrolled).not.toContain('保留座位')
    expect(enrolled).not.toContain('變更座位')
  })

  it('保留：預設適讀班級與入學學期，送出帶版本；成功後重新整理', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', version: 6 })], '/admin/admissions/options': options() })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    expect(bodyText()).toContain('幼生：王小安')
    expect(bodyButton('釋放保留')).toBeUndefined()
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: '小班', target_school_year: 115, target_semester: 1, expected_version: 6 })
    expect(success).toHaveBeenCalledWith('已保留座位')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('超過計畫名額只提醒、不擋（後端回 capacity_warning）', async () => {
    const alert = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue('confirm' as never)
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: true, warning_code: 'SEAT_CAPACITY_WARNING' } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(alert).toHaveBeenCalledOnce()
    expect(alert.mock.calls[0]![1]).toBe('已保留，但超過計畫名額')
    expect(String(alert.mock.calls[0]![0])).toContain('小班（115 上學期）的已保留加已註冊超過計畫名額')
  })

  it('變更座位可以釋放保留（年級送 null，學年學期不動）', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', provisional_grade: '中班', target_semester: 2, version: 3 })],
      '/admin/admissions/options': options(),
    })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit(), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '變更座位')
    bodyButton('釋放保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: null, target_school_year: 115, target_semester: 2, expected_version: 3 })
    expect(success).toHaveBeenCalledWith('已釋放保留')
  })

  it('後端拒絕（例如未預繳）顯示原因；版本衝突提示並重新整理', async () => {
    const error = vi.spyOn(ElMessage, 'error')
    const info = vi.spyOn(ElMessage, 'info')
    let conflict = false
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({
      '/admin/admissions/records/v-1/seat': () => {
        if (conflict) throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 2 })
        throw new ApiError(422, { code: 'SEAT_NOT_ALLOWED', message: '未預繳的訪視不可保留座位' })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(error).toHaveBeenCalledWith('未預繳的訪視不可保留座位')
    conflict = true
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('R3：換掉 moreCommands 後刪除條件仍受 admissions.convert 限制', async () => {
    const routes = {
      '/admin/admissions/records': [
        visit({ id: 'v-e', enrolled: true, stage: 'enrolled', provisional_grade: '小班' }),
        visit({ id: 'v-w', stage: 'withdrawn', withdrawn_from: 'enrolled' }),
      ],
      '/admin/admissions/options': options(),
    }
    mockGet(routes)
    const desk = await mountWith(RecordsTab, { props: recordsProps, user: reception() })
    // 櫃台沒有 admissions.convert：已註冊、從已註冊退出的列沒有任何可做的動作，不出現「更多」。
    expect(desk.wrapper.find('[data-more="v-e"]').exists()).toBe(false)
    expect(desk.wrapper.find('[data-more="v-w"]').exists()).toBe(false)
    cleanup()
    mockGet(routes)
    const boss = await mountWith(RecordsTab, { props: recordsProps })
    expect(await moreLabels(boss.wrapper, 'v-e')).toContain('刪除')
    expect(await moreLabels(boss.wrapper, 'v-e')).not.toContain('保留座位')
  })

  it('R4：已匿名化的已預繳列沒有保留／變更座位；SeatDialog 收到匿名化 409 提示並要求重讀', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const info = vi.spyOn(ElMessage, 'info')
    const get = mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-x', has_deposit: true, stage: 'deposited', anonymized_at: '2026-09-25T02:00:00Z' }),
        visit({ id: 'v-1', has_deposit: true, stage: 'deposited' }),
      ],
      '/admin/admissions/options': options(),
    })
    mockPost({ '/admin/admissions/records/v-1/seat': () => { throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' }) } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    const labels = await moreLabels(wrapper, 'v-x')
    expect(labels).not.toContain('保留座位')
    expect(labels).not.toContain('變更座位')
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視已依保存政策匿名化，不能再變更')
    expect(info).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })
})
