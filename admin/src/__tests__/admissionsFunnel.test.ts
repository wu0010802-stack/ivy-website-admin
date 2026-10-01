import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, board, bodyOf, button, card, cleanup, deferred, hasButton, mockGet, mockPost, mountWith, options, pathsTo,
  queryOf, reception, visit,
} from './admissionsTestKit'

afterEach(cleanup)

const boardProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, ...changes })
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)
const column = (wrapper: VueWrapper, stage: string) => wrapper.get(`.funnel__column[data-stage="${stage}"]`)

async function drag(wrapper: VueWrapper, id: string, to: string) {
  await wrapper.get(`.funnel-card[data-id="${id}"]`).trigger('dragstart')
  await column(wrapper, to).trigger('dragover')
  await column(wrapper, to).trigger('drop')
  await flushPromises()
}

// 卡片的「移到…」選單掛在 body 底下，每張卡有自己的 popper-class。
async function moveItems(wrapper: VueWrapper, id: string): Promise<HTMLElement[]> {
  await wrapper.get(`[data-move="${id}"]`).trigger('click')
  await vi.waitFor(() => expect(document.body.querySelector(`.funnel-move-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>(`.funnel-move-menu--${id} .el-dropdown-menu__item`)]
}
async function moveTo(wrapper: VueWrapper, id: string, label: string) {
  const item = (await moveItems(wrapper, id)).find((element) => element.textContent?.trim() === label)
  expect(item, `移到…選單裡要有「${label}」`).toBeDefined()
  item!.click()
  await flushPromises()
}

describe('看板：四欄、摘要列、卡片（規格第 10 節）', () => {
  it('四欄標題與張數；摘要比率用各欄目前張數相除，分母 0 顯示「—」', async () => {
    mockGet({
      '/admin/admissions/board': board({
        visited: [card(), card({ id: 'v-2', child_name: '李小樂', has_visit_request: true })],
        deposited: [card({ id: 'v-3', child_name: '張小晴', provisional_grade: '中班' })],
      }),
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(wrapper.findAll('.funnel__column h3').map((title) => title.text())).toEqual(['已訪視', '已預繳', '已註冊', '退預繳／退註冊'])
    expect(column(wrapper, 'visited').get('.funnel__count').text()).toBe('2')
    const rates = wrapper.get('.funnel__rates').text()
    expect(rates).toContain('50.0% 預繳率')
    expect(rates).toContain('0.0% 註冊率')
    expect(rates).toContain('— 退費率')
    // 空欄寫園務原文，不是空白。
    expect(column(wrapper, 'enrolled').text()).toContain('家長完成註冊後，把「已預繳」的卡片拖到這一欄。')
    const second = wrapper.get('.funnel-card[data-id="v-2"]').text()
    for (const text of ['李小樂', '小班', '115上', '官網預約', '115.09.08']) expect(second).toContain(text)
    expect(wrapper.get('.funnel-card[data-id="v-3"]').text()).toContain('保留 中班')
  })

  it('退出欄的卡片標出退預繳或退註冊', async () => {
    mockGet({ '/admin/admissions/board': board({ withdrawn: [card({ withdrawn_from: 'enrolled' })] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(column(wrapper, 'withdrawn').text()).toContain('退註冊')
  })

  it('讀不到看板顯示錯誤，可以重新載入', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/board': () => {
        if (fail) throw new Error('offline')
        return board({ visited: [card()] })
      },
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(wrapper.text()).toContain('無法讀取看板，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(column(wrapper, 'visited').text()).toContain('王小安')
  })

  it('頁首選「不限學年」：看板用目前學年並說明；學期不選就不帶', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/board': board() })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps({ schoolYear: null }) })
    expect(pathsTo(get, '/admin/admissions/board')).toEqual(['/admin/admissions/board?campus_key=yihua&school_year=115'])
    expect(wrapper.text()).toContain('頁首選了「不限學年」，這裡先顯示 115 學年')
  })

  it('快速切換校區：義華的看板較晚回來也不蓋掉仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/board': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : board({ visited: [card({ id: 'v-r', child_name: '林小美' })] }),
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(board({ visited: [card()] }))
    await flushPromises()
    expect(column(wrapper, 'visited').text()).toContain('林小美')
    expect(column(wrapper, 'visited').text()).not.toContain('王小安')
  })

  it('點卡片（或用鍵盤按卡片裡的姓名按鈕）開歷程抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    // 卡片外層不是 role=button：鍵盤走卡片裡真正的 <button>（原生 Enter／空白鍵會觸發 click）。
    const el = wrapper.get('.funnel-card[data-id="v-1"]')
    expect(el.attributes('role')).toBeUndefined()
    expect(el.attributes('tabindex')).toBeUndefined()
    await el.get('button.funnel-card__open').trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-1', childName: '王小安' })
  })
})

describe('換欄：拖曳與確認框（規格 6.3）', () => {
  it('已訪視拖到已預繳：確認框記收預繳人員，確認後送轉換並重讀看板', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/board': board({ visited: [card({ version: 2 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'deposited' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    expect(bodyText()).toContain('已訪視 → 已預繳')
    expect(bodyText()).toContain('幼生：王小安')
    expect(bodyText()).toContain('實際收款與收據照園內原本的方式處理')
    expect(bodyText()).not.toContain('學費管理')
    const collector = document.body.querySelector<HTMLInputElement>('input[aria-label="收預繳人員"]')!
    collector.value = ' 林老師 '
    collector.dispatchEvent(new Event('input'))
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'deposited', expected_version: 2, reason: null, deposit_collector: '林老師',
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    expect(success).toHaveBeenCalledWith('已更新階段')
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
  })

  it('409 時重載並還原卡片：兩人同時拖同一張卡，後送者提示並重讀看板，卡片落在伺服器的欄（Review Focus 3）', async () => {
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    let serverBoard = board({ visited: [card()] })
    const get = mockGet({ '/admin/admissions/board': () => serverBoard })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        // 另一個人剛把這張卡推到已註冊。
        serverBoard = board({ enrolled: [card({ version: 3 })] })
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 3 })
      },
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(info).toHaveBeenCalledWith('狀態已被其他人變更，已自動重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(column(wrapper, 'enrolled').text()).toContain('王小安')
    expect(column(wrapper, 'deposited').text()).not.toContain('王小安')
    expect(column(wrapper, 'visited').text()).not.toContain('王小安')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('不允許的轉換不開確認框，說明原因（已訪視拖到退出欄用園務原文）', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const post = mockPost()
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'withdrawn')
    expect(warning).toHaveBeenCalledWith('已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('鍵盤「移到…」：櫃台只列有權限的目的欄；退預繳要填原因才能確認', async () => {
    mockGet({ '/admin/admissions/board': board({ deposited: [card({ version: 4 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: reception() })
    expect((await moveItems(wrapper, 'v-1')).map((item) => item.textContent?.trim())).toEqual(['已訪視', '退預繳／退註冊'])
    await moveTo(wrapper, 'v-1', '退預繳／退註冊')
    expect(bodyText()).toContain('已預繳 → 退預繳／退註冊')
    expect(bodyText()).toContain('將標記退預繳。若已實際收款，退款要另外處理')
    expect(bodyButton('確認')!.disabled).toBe(true)
    const reason = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="原因"]')!
    reason.value = '家長決定不讀'
    reason.dispatchEvent(new Event('input'))
    await flushPromises()
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toMatchObject({ to_stage: 'withdrawn', expected_version: 4, reason: '家長決定不讀' })
  })

  it('標記註冊：預設今天、卡片的保留年級與入學學期，可改', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    mockGet({ '/admin/admissions/board': board({ deposited: [card({ provisional_grade: '中班', target_semester: 2, version: 5 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'enrolled' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await moveTo(wrapper, 'v-1', '已註冊')
    expect(bodyText()).toContain('已預繳 → 已註冊')
    expect(bodyText()).not.toContain('學生檔案')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'enrolled', expected_version: 5, reason: null, deposit_collector: null,
      enrolled_on: '2026-10-01', grade: '中班', target_school_year: 115, target_semester: 2,
    })
  })
})

describe('看板權限與提示', () => {
  it('只能看招生的帳號：沒有新增訪視、卡片不能拖、沒有「移到…」', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: admissionsViewer() })
    expect(hasButton(wrapper, '新增訪視')).toBe(false)
    expect(wrapper.get('.funnel-card[data-id="v-1"]').attributes('draggable')).toBe('false')
    expect(wrapper.find('[data-move="v-1"]').exists()).toBe(false)
  })

  it('櫃台不能拖已註冊的卡（要 admissions.convert），拖了也不開確認框', async () => {
    mockGet({ '/admin/admissions/board': board({ enrolled: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: reception() })
    expect(wrapper.get('.funnel-card[data-id="v-1"]').attributes('draggable')).toBe('false')
    await drag(wrapper, 'v-1', 'deposited')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('「另有 N 筆沒有填入學學期」：按「到訪視明細處理」切到明細並清掉入學學年學期', async () => {
    mockGet({
      '/admin/admissions/arrivals': { awaiting: [], missing: [] },
      '/admin/admissions/board': board({}, { unscoped_count: 3 }),
      '/admin/admissions/records': [],
      '/admin/admissions/options': options(),
    })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?sem=1' })
    expect(wrapper.text()).toContain('另有 3 筆訪視沒有填入學學期，不會出現在任何學年的看板。')
    await button(wrapper, '到訪視明細處理')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', tab: 'records' })
  })
})

describe('明細的「標記註冊」（本檔調整第 12 條）', () => {
  const recordsProps = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }

  it('有 admissions.convert 且已預繳未註冊才顯示；開註冊確認框，完成後重新整理明細', async () => {
    const get = mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', provisional_grade: '中班', version: 2 }), visit({ id: 'v-2', child_name: '李小樂' })],
      '/admin/admissions/options': options(),
    })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'enrolled' }) })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(wrapper.findAll('button').filter((element) => element.text() === '標記註冊')).toHaveLength(1)
    await button(wrapper, '標記註冊')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('已預繳 → 已註冊')
    bodyButton('確認')!.click()
    await flushPromises()
    const body = bodyOf(post, '/admin/admissions/records/v-1/transition') as Record<string, unknown>
    expect(body).toMatchObject({ to_stage: 'enrolled', expected_version: 2, grade: '中班', target_school_year: 115, target_semester: 1 })
    expect(String(body.enrolled_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('櫃台（沒有 admissions.convert）看不到標記註冊', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps, user: reception() })
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
  })
})

describe('裁定補充（R4、R5、R10、R12）', () => {
  it('R5：拖曳確認時收到「已匿名化」409，提示匿名化原因並重讀看板，不用一般的衝突訊息', async () => {
    const info = vi.spyOn(ElMessage, 'info')
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' })
      },
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視已依保存政策匿名化，不能再變更')
    expect(info).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('F2：拖曳確認時收到 404（別人剛刪掉）：提示、關閉確認框並重讀看板，不顯示錯誤', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    mockPost({ '/admin/admissions/records/v-1/transition': () => { throw new ApiError(404, { detail: 'not found' }) } })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視已被刪除，已重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('R10：未填姓名的卡片標「待補」，有姓名的不標', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card({ child_name: '（未填姓名）' }), card({ id: 'v-2' })] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(wrapper.get('.funnel-card[data-id="v-1"]').text()).toContain('待補')
    expect(wrapper.get('.funnel-card[data-id="v-2"]').text()).not.toContain('待補')
  })

  it('R12：註冊日期選擇器限制在民國 100–200 年', async () => {
    mockGet({ '/admin/admissions/board': board({ deposited: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await moveTo(wrapper, 'v-1', '已註冊')
    const picker = wrapper.getComponent(TransitionDialog).findComponent({ name: 'ElDatePicker' })
    const disabled = picker.props('disabledDate') as (date: Date) => boolean
    expect(disabled(new Date(2010, 11, 31))).toBe(true)
    expect(disabled(new Date(2026, 9, 1))).toBe(false)
    expect(disabled(new Date(2112, 0, 1))).toBe(true)
  })

  it('R4：已匿名化的列不顯示標記註冊', async () => {
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', anonymized_at: '2026-09-30T00:00:00Z' })],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' } })
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
  })
})
