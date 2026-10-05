import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import FunnelCard from '../components/admissions/FunnelCard.vue'
import ContactLogDialog from '../components/admissions/ContactLogDialog.vue'
import funnelCardSource from '../components/admissions/FunnelCard.vue?raw'
import { ApiError } from '../api/client'
import {
  admissionsViewer, board, bodyOf, button, card, cleanup, deferred, hasButton, mockGet, mockPost, mountWith, pathsTo,
  queryOf, reception, visit,
} from './admissionsTestKit'

afterEach(cleanup)

const boardProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, ...changes })
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)
// 確認框的按鈕（明細列也有一顆「標記註冊」，從確認框裡找才不會按錯）。
const dialogButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('.transition-dialog button')].find((element) => element.textContent?.trim() === text)
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
  it('四欄標題與張數；比率名稱在前、附分子分母，用各欄目前張數相除，分母 0 寫「預繳率 —」', async () => {
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
    expect(rates).toContain('預繳率 50.0%（1/2）')
    expect(rates).toContain('註冊率 0.0%（0/1）')
    expect(rates).toContain('退費率 —')
    expect(rates).not.toContain('退費率 —（')
    // 算法寫在畫面上（觸控看不到 title），公式照舊留在 title。
    expect(wrapper.get('.funnel__toolbar').text()).toContain('依各欄目前張數相除，和「統計分析」的轉換率算法不同。')
    expect(wrapper.get('.funnel__rate').attributes('title')).toBe('已預繳 ÷ 已訪視（各欄目前張數）')
    // 空欄寫園務原文，不是空白。
    expect(column(wrapper, 'enrolled').text()).toContain('家長完成註冊後，把「已預繳」的卡片拖到這一欄。')
    const second = wrapper.get('.funnel-card[data-id="v-2"]').text()
    for (const text of ['李小樂', '小班', '115上', '官網預約', '115.09.08']) expect(second).toContain(text)
    // 入學學期是中性色，不和「已預繳」欄的黃色撞。
    const termTag = wrapper.get('.funnel-card[data-id="v-2"]').findAll('.el-tag').find((tag) => tag.text() === '115上')!
    expect(termTag.classes()).toContain('el-tag--info')
    expect(wrapper.get('.funnel-card[data-id="v-2"]').find('.el-tag--warning').exists()).toBe(false)
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
  it('已訪視拖到已預繳：確認框記收預繳人員，按「移到已預繳」送轉換並重讀看板', async () => {
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
    expect(dialogButton('確認')).toBeUndefined()
    dialogButton('移到已預繳')!.click()
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
    dialogButton('移到已預繳')!.click()
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
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」' }))
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('鍵盤「移到…」：櫃台只列有權限的目的欄；標題寫「已預繳 → 退預繳」，要填原因才能標記退預繳', async () => {
    mockGet({ '/admin/admissions/board': board({ deposited: [card({ version: 4 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: reception() })
    expect((await moveItems(wrapper, 'v-1')).map((item) => item.textContent?.trim())).toEqual(['已訪視', '退預繳／退註冊'])
    await moveTo(wrapper, 'v-1', '退預繳／退註冊')
    expect(document.body.querySelector('.transition-dialog .el-dialog__title')?.textContent).toBe('已預繳 → 退預繳')
    expect(bodyText()).toContain('將標記退預繳。若已實際收款，退款要另外處理')
    expect(dialogButton('標記退預繳')!.disabled).toBe(true)
    expect(dialogButton('先不要')).toBeDefined()
    const reason = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="原因"]')!
    reason.value = '家長決定不讀'
    reason.dispatchEvent(new Event('input'))
    await flushPromises()
    dialogButton('標記退預繳')!.click()
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
    expect(bodyText()).not.toContain('併入園務')
    expect(bodyText()).toContain('學號與編班照園內原本的方式處理。')
    dialogButton('標記註冊')!.click()
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
    })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'enrolled' }) })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(wrapper.findAll('button').filter((element) => element.text() === '標記註冊')).toHaveLength(1)
    await button(wrapper, '標記註冊')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('已預繳 → 已註冊')
    dialogButton('標記註冊')!.click()
    await flushPromises()
    const body = bodyOf(post, '/admin/admissions/records/v-1/transition') as Record<string, unknown>
    expect(body).toMatchObject({ to_stage: 'enrolled', expected_version: 2, grade: '中班', target_school_year: 115, target_semester: 1 })
    expect(String(body.enrolled_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('櫃台（沒有 admissions.convert）看不到標記註冊', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })] })
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
    dialogButton('移到已預繳')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已依保存政策匿名化，不能再變更' }))
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
    dialogButton('移到已預繳')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已被刪除，已重新載入' }))
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
    })
    const { wrapper } = await mountWith(RecordsTab, { props: { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' } })
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
  })
})

describe('看板找幼生姓名（2026-10-05 招生入學評析）', () => {
  const searchBoard = () =>
    board({
      visited: [card(), card({ id: 'v-2', child_name: 'Amy 李' }), card({ id: 'v-3', child_name: '王小樂' })],
      deposited: [card({ id: 'v-4', child_name: '張小晴' })],
    })
  const ids = (wrapper: VueWrapper) => wrapper.findAll('.funnel-card').map((el) => el.attributes('data-id'))

  it('前端過濾（trim、不分大小寫）；欄標題寫符合數/總數，沒有符合的欄不寫園務空狀態；比率用全部張數', async () => {
    const get = mockGet({ '/admin/admissions/board': searchBoard() })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    const search = wrapper.get('input[aria-label="找幼生姓名"]')
    expect(search.attributes('placeholder')).toBe('找幼生姓名')

    await search.setValue('  amy ')
    expect(ids(wrapper)).toEqual(['v-2'])
    expect(column(wrapper, 'visited').get('.funnel__count').text()).toBe('1/3')
    expect(column(wrapper, 'visited').attributes('aria-label')).toBe('已訪視，符合「amy」的 1 張，共 3 張')
    expect(column(wrapper, 'deposited').text()).toContain('沒有符合「amy」的卡片')
    expect(column(wrapper, 'enrolled').text()).toContain('沒有符合「amy」的卡片')
    expect(column(wrapper, 'enrolled').text()).not.toContain('家長完成註冊後')
    expect(wrapper.get('.funnel__rates').text()).toContain('預繳率 33.3%（1/3）')
    expect(wrapper.text()).toContain('符合「amy」的卡片共 1 張')
    // 過濾只在前端，不重讀看板。
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(1)

    await search.setValue('王')
    expect(ids(wrapper)).toEqual(['v-1', 'v-3'])
    expect(column(wrapper, 'visited').get('.funnel__count').text()).toBe('2/3')

    await search.setValue('')
    expect(ids(wrapper)).toEqual(['v-1', 'v-2', 'v-3', 'v-4'])
    expect(column(wrapper, 'visited').get('.funnel__count').text()).toBe('3')
    expect(column(wrapper, 'visited').attributes('aria-label')).toBe('已訪視，3 張')
    expect(column(wrapper, 'enrolled').text()).toContain('家長完成註冊後，把「已預繳」的卡片拖到這一欄。')
  })

  it('過濾中照樣可以「移到…」與拖曳', async () => {
    mockGet({ '/admin/admissions/board': searchBoard() })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await wrapper.get('input[aria-label="找幼生姓名"]').setValue('張')
    await moveTo(wrapper, 'v-4', '已註冊')
    expect(wrapper.getComponent(TransitionDialog).props('target')).toMatchObject({ from: 'deposited', to: 'enrolled', card: { id: 'v-4' } })
    wrapper.getComponent(TransitionDialog).vm.$emit('update:modelValue', false)
    await flushPromises()
    await drag(wrapper, 'v-4', 'visited')
    expect(wrapper.getComponent(TransitionDialog).props('target')).toMatchObject({ from: 'deposited', to: 'visited', card: { id: 'v-4' } })
  })
})

describe('看板全空時導去確認到場（2026-10-05 招生入學評析）', () => {
  async function mountEmpty(changes: Record<string, unknown>, columns: Parameters<typeof board>[0] = {}) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00')) // 115 上學期
    mockGet({ '/admin/admissions/board': board(columns) })
    return (await mountWith(FunnelBoard, { props: boardProps(changes) })).wrapper
  }
  const HINT = '官網預約有 3 位家長等你確認到場，確認後會自動出現在「已訪視」。'

  it('四欄全空、官網預約有人等確認：提示並可以切去確認；欄內仍是園務原文', async () => {
    const wrapper = await mountEmpty({ pendingArrivals: 3 })
    expect(wrapper.text()).toContain(HINT)
    await button(wrapper, '去確認到場')!.trigger('click')
    expect(wrapper.emitted('open-arrivals')).toHaveLength(1)
    expect(column(wrapper, 'visited').text()).toContain('還沒有訪視紀錄，用右上角的「新增訪視」建立第一筆。')
  })

  it.each([
    ['看板有卡片', { pendingArrivals: 3 }, { withdrawn: [card()] }],
    ['沒有等確認的', { pendingArrivals: 0 }, {}],
    ['還不知道筆數', { pendingArrivals: null }, {}],
    ['看的是別的學年（確認到場建的訪視落在當天學期）', { pendingArrivals: 3, schoolYear: 116 }, {}],
    ['看的是別的學期', { pendingArrivals: 3, semester: 2 }, {}],
  ])('%s：不提示', async (_label, changes, columns) => {
    const wrapper = await mountEmpty(changes, columns)
    expect(wrapper.text()).not.toContain('等你確認到場')
  })
})

describe('看板卡片：中性學期、hover 與「移到…」（2026-10-05 招生入學評析）', () => {
  it('選單開著時卡片維持「指到」的樣子', async () => {
    const { wrapper } = await mountWith(FunnelCard, { props: { card: card(), stage: 'visited', draggable: true, targets: ['deposited'] } })
    const article = wrapper.get('.funnel-card')
    expect(article.classes()).not.toContain('is-menu-open')
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('visible-change', true)
    await flushPromises()
    expect(article.classes()).toContain('is-menu-open')
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('visible-change', false)
    await flushPromises()
    expect(article.classes()).not.toContain('is-menu-open')
  })

  it('滑鼠裝置平常收起「移到…」（不用 display:none，Tab 還走得到）；觸控一直顯示；整張卡游標是 pointer', () => {
    const css = funnelCardSource.slice(funnelCardSource.indexOf('<style scoped>'))
    const hoverBlock = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine)'), css.indexOf('@media (prefers-reduced-motion'))
    expect(hoverBlock).toMatch(/\.funnel-card__move \{\s*opacity: 0;\s*pointer-events: none;/)
    for (const selector of ['.funnel-card:hover .funnel-card__move', '.funnel-card:focus-within .funnel-card__move', '.funnel-card.is-menu-open .funnel-card__move']) {
      expect(hoverBlock).toContain(selector)
    }
    expect(css).not.toMatch(/funnel-card__move[^}]*display:\s*none/)
    expect(css).toMatch(/\.funnel-card \{[^}]*cursor: pointer;/)
    expect(css).toMatch(/\.funnel-card:hover,[^{]*\{\s*border-color: var\(--line-strong\);\s*box-shadow: var\(--shadow-md\);/)
    expect(css).toContain('.funnel-card:has(.funnel-card__open:focus-visible)')
  })
})

describe('歷程抽屜：聯絡人、電話與換階段（2026-10-05 招生入學評析）', () => {
  const drawerRoutes = (record: Record<string, unknown>) => ({
    '/admin/admissions/records/v-1/events': [],
    '/admin/admissions/records/v-1/contact-logs': [],
    '/admin/admissions/records/v-1': record,
    '/admin/admissions/staff': [{ id: 'desk', display_name: null, email: 'reception.yihua.long-address@ivy.example' }],
  })
  async function openDrawer(record: Record<string, unknown>, user?: ReturnType<typeof reception>) {
    const get = mockGet(drawerRoutes(record))
    const mounted = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1', childName: '王小安' }, user })
    await mounted.wrapper.setProps({ modelValue: true })
    await flushPromises()
    return { ...mounted, get }
  }
  const summary = () => document.body.querySelector('.events__summary')!
  const drawerMenuItems = async () => {
    document.body.querySelector<HTMLButtonElement>('.events__move')!.click()
    await vi.waitFor(() => expect(document.body.querySelector('.events-move-menu .el-dropdown-menu__item')).not.toBeNull())
    return [...document.body.querySelectorAll<HTMLElement>('.events-move-menu .el-dropdown-menu__item')]
  }

  it('摘要寫聯絡人與可撥號的電話；負責人自己一列、不從 email 中間斷', async () => {
    await openDrawer(visit({ follow_up_owner_id: 'desk' }))
    expect(summary().textContent).toContain('聯絡人王媽媽')
    const tel = summary().querySelector<HTMLAnchorElement>('a.events__tel')!
    expect(tel.getAttribute('href')).toBe('tel:0912345678')
    expect(tel.textContent).toBe('0912345678')
    const owner = summary().querySelector('.events__owner dd')!
    expect(owner.textContent).toBe('reception.yihua.long-address@ivy.example')
    expect(owner.getAttribute('title')).toBe('reception.yihua.long-address@ivy.example')
  })

  it('沒有電話不列；已匿名化不給撥號也不給「移到…」', async () => {
    await openDrawer(visit({ phone: null }))
    expect(summary().querySelector('a[href^="tel:"]')).toBeNull()
    cleanup()
    await openDrawer(visit({ anonymized_at: '2026-09-30T00:00:00Z', stage: 'deposited' }))
    expect(summary().querySelector('a[href^="tel:"]')).toBeNull()
    expect(document.body.querySelector('.events__move')).toBeNull()
  })

  it('記錄聯絡帶著聯絡人、電話、年級', async () => {
    const { wrapper } = await openDrawer(visit())
    bodyButton('記錄聯絡')!.click()
    await flushPromises()
    expect(wrapper.findComponent(ContactLogDialog).props('target')).toMatchObject({
      id: 'v-1', version: 1, child_name: '王小安', stage: 'visited', grade: '小班', contact_name: '王媽媽', phone: '0912345678',
    })
  })

  it('「移到…」只列有權限的目的欄；確認後重讀抽屜並通知父層', async () => {
    const { wrapper, get } = await openDrawer(visit({ stage: 'deposited', has_deposit: true, version: 4 }), reception())
    const items = await drawerMenuItems()
    expect(items.map((item) => item.textContent?.trim())).toEqual(['已訪視', '退預繳／退註冊'])
    const moved = visit({ stage: 'withdrawn', withdrawn_from: 'deposited', version: 5 })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': moved })
    items.find((item) => item.textContent?.trim() === '退預繳／退註冊')!.click()
    await flushPromises()
    expect(document.body.querySelector('.transition-dialog .el-dialog__title')?.textContent).toBe('已預繳 → 退預繳')
    const reason = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="原因"]')!
    reason.value = '家長決定不讀'
    reason.dispatchEvent(new Event('input'))
    await flushPromises()
    dialogButton('標記退預繳')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toMatchObject({ to_stage: 'withdrawn', expected_version: 4, reason: '家長決定不讀' })
    expect(wrapper.emitted('changed')?.[0]).toEqual([moved])
    expect(pathsTo(get, '/admin/admissions/records/v-1').filter((path) => path === '/admin/admissions/records/v-1')).toHaveLength(2)
  })

  it('換階段遇到 409：重讀抽屜，也讓父層重讀', async () => {
    const { wrapper, get } = await openDrawer(visit())
    mockPost({ '/admin/admissions/records/v-1/transition': () => { throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT' }) } })
    ;(await drawerMenuItems()).find((item) => item.textContent?.trim() === '已預繳')!.click()
    await flushPromises()
    dialogButton('移到已預繳')!.click()
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/records/v-1').filter((path) => path === '/admin/admissions/records/v-1')).toHaveLength(2)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})

describe('轉換確認框：確認鍵寫出動作、退出寫具體來源、開啟後的焦點（2026-10-05 招生入學評析）', () => {
  async function openDialog(from: string, to: string, changes: Record<string, unknown> = {}) {
    const target = { card: card(changes), from, to }
    const { wrapper } = await mountWith(TransitionDialog, { props: { modelValue: false, target } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }
  const title = () => document.body.querySelector('.transition-dialog .el-dialog__title')?.textContent
  const footer = () => [...document.body.querySelectorAll('.transition-dialog .el-dialog__footer button')].map((el) => el.textContent?.trim())

  it.each([
    ['visited', 'deposited', null, '已訪視 → 已預繳', '取消', '移到已預繳'],
    ['deposited', 'visited', null, '已預繳 → 已訪視', '取消', '退回已訪視'],
    ['deposited', 'enrolled', null, '已預繳 → 已註冊', '取消', '標記註冊'],
    ['enrolled', 'deposited', null, '已註冊 → 已預繳', '先不要', '退回已預繳'],
    ['enrolled', 'visited', null, '已註冊 → 已訪視', '先不要', '退回已訪視'],
    ['deposited', 'withdrawn', null, '已預繳 → 退預繳', '先不要', '標記退預繳'],
    ['enrolled', 'withdrawn', null, '已註冊 → 退註冊', '先不要', '標記退註冊'],
    ['withdrawn', 'visited', 'deposited', '退預繳 → 已訪視', '取消', '回到已訪視'],
    ['withdrawn', 'deposited', 'enrolled', '退註冊 → 已預繳', '取消', '回到已預繳'],
  ])('%s → %s（%s）：標題「%s」、按鈕「%s」「%s」', async (from, to, withdrawnFrom, expectedTitle, cancel, confirm) => {
    await openDialog(from, to, { withdrawn_from: withdrawnFrom })
    expect(title()).toBe(expectedTitle)
    expect(footer()).toEqual([cancel, confirm])
  })

  it.each([
    ['visited', 'deposited', 'input[aria-label="收預繳人員"]'],
    ['deposited', 'enrolled', 'input[aria-label="註冊日期"]'],
    ['deposited', 'withdrawn', 'textarea[aria-label="原因"]'],
    ['enrolled', 'deposited', 'textarea[aria-label="原因"]'],
  ])('%s → %s：開啟後焦點在第一個輸入框', async (from, to, selector) => {
    const wrapper = await openDialog(from, to)
    wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('opened')
    await flushPromises()
    expect(document.activeElement).toBe(document.body.querySelector(selector))
  })

  it('註冊日期聚焦時不自動彈出月曆（已預設今天）', async () => {
    const wrapper = await openDialog('deposited', 'enrolled')
    expect(wrapper.findComponent({ name: 'ElDatePicker' }).props('automaticDropdown')).toBe(false)
  })

  it('沒有輸入框（取消退出）：焦點在確認鍵', async () => {
    const wrapper = await openDialog('withdrawn', 'visited', { withdrawn_from: 'deposited' })
    wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('opened')
    await flushPromises()
    expect(document.activeElement).toBe(dialogButton('回到已訪視'))
  })
})
