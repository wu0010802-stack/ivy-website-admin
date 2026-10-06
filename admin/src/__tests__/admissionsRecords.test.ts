import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, button, cleanup, deferred, hasButton, mockDelete, mockGet, mountWith,
  pathsTo, queryOf, reception, visit, VR_ID,
} from './admissionsTestKit'

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

type Spy = Parameters<typeof pathsTo>[0]
const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '', ...changes })
const listPaths = (get: Spy) => pathsTo(get, '/admin/admissions/records?')
const lastQuery = (get: Spy) => queryOf(listPaths(get).at(-1)!)
const rowTexts = (wrapper: VueWrapper) => wrapper.findAll('.records-table .el-table__body tr.el-table__row').map((row) => row.text())
const selectByPlaceholder = (wrapper: VueWrapper, placeholder: string) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === placeholder)!
const stageTags = (wrapper: VueWrapper) =>
  wrapper.findAll('.records-table .el-table__body tr.el-table__row').map((row) => row.findAll('td')[3]!.text())

// 列的「更多」選單掛在 body 底下，每一列有自己的 popper-class，打開後從 document 找選項。
async function moreItems(wrapper: VueWrapper, id: string): Promise<HTMLElement[]> {
  await wrapper.get(`[data-more="${id}"]`).trigger('click')
  await vi.waitFor(() => expect(document.body.querySelector(`.records-more-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)]
}
const labelsOf = (items: HTMLElement[]) => items.map((item) => item.textContent?.trim() ?? '')
async function chooseMore(wrapper: VueWrapper, id: string, label: string) {
  const item = (await moreItems(wrapper, id)).find((element) => element.textContent?.trim() === label)
  expect(item, `更多選單裡要有「${label}」`).toBeDefined()
  item!.click()
  await flushPromises()
}

function stubNarrow() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

describe('訪視明細：載入、空資料、錯誤（規格第 10 節）', () => {
  it('以校區、入學學年學期、月份查詢，每頁 50 筆；列出民國參觀日期、入學學期、階段與官網預約', async () => {
    const get = mockGet({
      '/admin/admissions/records': [
        visit({ visit_request_id: VR_ID, has_visit_request: true }),
        visit({ id: 'v-2', child_name: '李小樂', has_deposit: true, stage: 'deposited', target_semester: 2 }),
        visit({ id: 'v-3', child_name: '張小晴', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'deposited', stage: 'withdrawn' }),
        visit({ id: 'v-4', child_name: '（未填姓名）' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ semester: 1, month: '115.09' }) })
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', month: '115.09', target_school_year: '115', target_semester: '1', page: '1', page_size: '50',
    })
    const rows = rowTexts(wrapper)
    for (const text of ['115.09.08', '王小安', '小班', '115 上學期', '官網預約', '已訪視']) expect(rows[0]).toContain(text)
    expect(rows[1]).toContain('115 下學期')
    expect(rows[1]).toContain('已預繳')
    expect(rows[2]).toContain('已退預繳')
    expect(rows[3]).toContain('待補')
    // 2026-10-05 家庭頁：點姓名就開預約明細，不再另放「查看預約」連結。
    expect(wrapper.text()).not.toContain('查看預約')
  })

  it('沒有資料時說明原因；有篩選時改說篩選下沒有', async () => {
    mockGet({ '/admin/admissions/records': [] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.text()).toContain('義華在 115 學年還沒有招生訪視。')
    expect(wrapper.text()).not.toContain('0 筆')
    await wrapper.setProps({ month: '115.09' })
    await flushPromises()
    expect(wrapper.text()).toContain('目前篩選條件下沒有訪視紀錄。')
  })

  it('讀取失敗顯示錯誤，按重新載入再讀一次', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/records': () => {
        if (fail) throw new Error('offline')
        return [visit()]
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.text()).toContain('載入明細失敗')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(listPaths(get)).toHaveLength(2)
    expect(rowTexts(wrapper)[0]).toContain('王小安')
  })

  it('快速切換校區：先送出的義華較晚回來，也只顯示仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/records': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : [visit({ id: 'v-r', campus_key: 'renwu', child_name: '林小美' })],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve([visit()])
    await flushPromises()
    const rows = rowTexts(wrapper)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('林小美')
  })
})

describe('欄位（2026-10-05：1280 寬不橫捲）', () => {
  it('預設欄位只留追蹤要看的；「階段」取代預繳與已註冊兩欄，退出寫從哪一段退', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-v' }),
        visit({ id: 'v-d', has_deposit: true, stage: 'deposited' }),
        visit({ id: 'v-e', has_deposit: true, enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-wd', stage: 'withdrawn', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'deposited' }),
        visit({ id: 'v-we', stage: 'withdrawn', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'enrolled' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const headers = wrapper.findAll('.records-table .el-table__header th').map((th) => th.text())
    expect(headers).toEqual(['', '參觀日期', '姓名', '階段', '班別', '入學學期', '下次聯絡', '負責人', '來源', '操作'])
    expect(stageTags(wrapper)).toEqual(['已訪視', '已預繳', '已註冊', '已退預繳', '已退註冊'])
  })

  it('下次聯絡：到期用危險色，沒排寫「—」；負責人寫名字或「未指派」', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-a', follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: 'desk' }),
        visit({ id: 'v-b' }),
      ],
      '/admin/admissions/staff': [{ id: 'desk', display_name: '櫃台小美', email: 'desk@example.invalid' }],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const [first, second] = wrapper.findAll('.records-table .el-table__body tr.el-table__row')
    const due = first!.get('.records__due')
    expect(due.text()).toMatch(/^逾 \d+ 天$/)
    expect(first!.text()).toContain('櫃台小美')
    expect(second!.findAll('td')[6]!.text()).toBe('—')
    expect(second!.find('.records__due').exists()).toBe(false)
    expect(second!.text()).toContain('未指派')
  })

  it('地址、家長介紹、備註等收進展開列（兩欄、空值不列）；沒有其他資料的列不能展開', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ address: '高雄市示範路 1 號', referrer: '林老師', notes: '外婆接送', no_deposit_reason: '費用考量', parent_response: null }),
        visit({ id: 'v-2', child_name: '李小樂' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.find('.records-table .el-table__body').text()).not.toContain('高雄市示範路')
    const [expandable, empty] = wrapper.findAll('.records-table .el-table__expand-icon')
    expect(expandable!.attributes('aria-label')).toBe('展開其他資料')
    expect(empty!.attributes('disabled')).toBeDefined()
    await expandable!.trigger('click')
    await flushPromises()
    const info = wrapper.get('.records__info')
    expect(info.findAll('dt').map((dt) => dt.text())).toEqual(['地址', '家長介紹', '未預繳原因', '備註'])
    expect(info.text()).toContain('高雄市示範路 1 號')
    expect(info.text()).not.toContain('電訪回應')
  })

  it('照紙本補的欄位也在展開列：英文名字、父母職業、來源分類（中文）、帶參觀老師、搭娃娃車', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({
          english_name: 'Celeste', father_occupation: '軍', mother_occupation: '教師', source_category: 'sibling_current',
          referrer: '林老師', tour_guide_name: 'Marvyna', rides_bus: true,
        }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await wrapper.get('.records-table .el-table__expand-icon').trigger('click')
    await flushPromises()
    const info = wrapper.get('.records__info')
    expect(info.findAll('dt').map((dt) => dt.text())).toEqual(['英文名字', '父親職業', '母親職業', '來源分類', '家長介紹', '帶參觀老師', '搭娃娃車'])
    expect(info.findAll('dd').map((dd) => dd.text())).toEqual(['Celeste', '軍', '教師', '在校生弟妹（兄姊老師）', '林老師', 'Marvyna', '要搭'])
  })
})

describe('篩選收合（比照第九輪案件列表）', () => {
  it('常駐搜尋、月份、預繳、追蹤；其餘收進「更多篩選」，按了才展開', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const toggle = wrapper.get('button.more-filters')
    expect(toggle.text()).toBe('更多篩選')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    const fieldLabels = (selector: string) => wrapper.findAll(`${selector} .filter-field > span:first-child`).map((label) => label.text())
    expect(fieldLabels('#records-more-filters')).toEqual(['班別', '來源', '家長介紹', '未預繳原因', '負責人'])
    expect(fieldLabels('.records-filters')).toEqual(['搜尋', '月份', '預繳', '追蹤', '班別', '來源', '家長介紹', '未預繳原因', '負責人'])
    expect(wrapper.get('.records-filters').classes()).not.toContain('is-open')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.records-filters').classes()).toContain('is-open')
  })

  it('收起時把收進去的條件列成標籤（按鈕帶數字），可以逐一拿掉；清除篩選在標籤列最後；展開時不重複列', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    selectByPlaceholder(wrapper, '全部班別').vm.$emit('update:modelValue', '小班')
    selectByPlaceholder(wrapper, '全部原因').vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
    expect(wrapper.get('button.more-filters .filter-count').text()).toContain('2')
    const chips = () => wrapper.findAll('.filter-chips li')
    expect(chips().map((chip) => chip.text())).toEqual(['班別：小班×，拿掉這個條件', '未預繳原因：費用考量×，拿掉這個條件', '清除篩選'])
    // 清除篩選只出現在標籤列，不在工具列重複。
    expect(wrapper.findAll('button').filter((b) => b.text() === '清除篩選')).toHaveLength(1)

    await chips()[0]!.get('button').trigger('click')
    await flushPromises()
    expect(lastQuery(get).has('grade')).toBe(false)
    expect(lastQuery(get).get('no_deposit_reason')).toBe('費用考量')

    await wrapper.get('button.more-filters').trigger('click')
    expect(wrapper.find('.filter-chips').exists()).toBe(false)
    expect(wrapper.findAll('button').filter((b) => b.text() === '清除篩選')).toHaveLength(1)
  })

  it('負責人標籤寫名字；月份、預繳、追蹤在桌機常駐，不列成標籤', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ month: '115.09' }) })
    selectByPlaceholder(wrapper, '不限').vm.$emit('update:modelValue', 'yes')
    const owner = wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('ariaLabel') === '追蹤負責人')!
    owner.vm.$emit('update:modelValue', 'me')
    await flushPromises()
    expect(wrapper.findAll('.filter-chip').map((chip) => chip.text())).toEqual(['負責人：我負責的×，拿掉這個條件'])
  })
})

describe('篩選、分頁與權限', () => {
  it('第 2 頁以後拿到空列表：說「這一頁沒有訪視紀錄」並可回到第 1 頁，不說校區還沒有訪視', async () => {
    const full = Array.from({ length: 50 }, (_, index) => visit({ id: `v-${index}` }))
    const get = mockGet({ '/admin/admissions/records': (path: string) => (queryOf(path).get('page') === '1' ? full : []) })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await button(wrapper, '下一頁')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('2')
    expect(wrapper.text()).toContain('這一頁沒有訪視紀錄。')
    expect(wrapper.text()).not.toContain('還沒有招生訪視')

    await button(wrapper, '回到第 1 頁')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('1')
    expect(rowTexts(wrapper)).toHaveLength(50)
    expect(wrapper.text()).not.toContain('這一頁沒有訪視紀錄。')
  })

  it('班別、預繳「否」送到 API 並回第一頁；滿 50 筆才有下一頁', async () => {
    const full = Array.from({ length: 50 }, (_, index) => visit({ id: `v-${index}` }))
    const get = mockGet({
      '/admin/admissions/records': (path: string) => (queryOf(path).get('page') === '1' ? full : [visit({ id: 'v-last' })]),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await button(wrapper, '下一頁')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('2')
    expect(button(wrapper, '下一頁')!.attributes('disabled')).toBeDefined()

    selectByPlaceholder(wrapper, '全部班別').vm.$emit('update:modelValue', '小班')
    selectByPlaceholder(wrapper, '不限').vm.$emit('update:modelValue', 'no')
    await flushPromises()
    const query = lastQuery(get)
    expect(query.get('grade')).toBe('小班')
    expect(query.get('has_deposit')).toBe('false')
    expect(query.get('page')).toBe('1')
  })

  it('月份選項來自 options，選了就往上更新（由頁面寫進網址）', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const month = selectByPlaceholder(wrapper, '全部月份')
    expect(wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(expect.arrayContaining(['115.09', '115.08']))
    month.vm.$emit('update:modelValue', '115.08')
    expect(wrapper.emitted('update:month')).toEqual([['115.08']])
  })

  it('從預約明細連進來（vr）只看那一筆；「顯示全部」清掉', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ schoolYear: null, visitRequestId: VR_ID }) })
    expect(lastQuery(get).get('visit_request_id')).toBe(VR_ID)
    expect(lastQuery(get).has('target_school_year')).toBe(false)
    expect(wrapper.text()).toContain('只顯示這筆官網預約建立的招生訪視。')
    await button(wrapper, '顯示全部')!.trigger('click')
    expect(wrapper.emitted('update:visitRequestId')).toEqual([['']])
  })

  it('F1：換校時上一校的列立刻消失，不留在載入遮罩下', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/records': (path: string) => (queryOf(path).get('campus_key') === 'renwu' ? slow.promise : [visit()]),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(rowTexts(wrapper)[0]).toContain('王小安')
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('王小安')
    slow.resolve([visit({ id: 'v-r', child_name: '林小美' })])
    await flushPromises()
    expect(rowTexts(wrapper)[0]).toContain('林小美')
  })

  it('F4：搜尋框限制 100 字（後端 q 上限）', async () => {
    mockGet({ '/admin/admissions/records': [] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.get('input[aria-label="搜尋訪視"]').attributes('maxlength')).toBe('100')
  })

  it('只能看招生的帳號：沒有新增、標記與更多；點姓名仍可看歷程', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })] })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: admissionsViewer() })
    expect(hasButton(wrapper, '新增訪視')).toBe(false)
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
    expect(wrapper.find('[data-more]').exists()).toBe(false)
    await wrapper.get('button.records__name').trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-1', childName: '王小安' })
  })

  it('櫃台（沒有 admissions.convert）：已註冊的列只能編輯，不能退註冊或刪除；已預繳的列可以退預繳、沒有標記註冊', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-e', has_deposit: false, enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-d', has_deposit: true, stage: 'deposited' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: reception() })
    // 退註冊、刪除都要 convert。
    expect(labelsOf(await moreItems(wrapper, 'v-e'))).toEqual(['編輯'])
    expect(labelsOf(await moreItems(wrapper, 'v-d'))).toEqual(['編輯', '保留座位', '退預繳', '刪除'])
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
  })

  it('櫃台看「從已註冊退出」的列沒有刪除；總管理者看已註冊的列有刪除（admissions.convert）', async () => {
    const rows = [
      visit({ id: 'v-w', stage: 'withdrawn', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'enrolled' }),
      visit({ id: 'v-e', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
    ]
    mockGet({ '/admin/admissions/records': rows })
    const desk = await mountWith(RecordsTab, { props: props(), user: reception() })
    expect(labelsOf(await moreItems(desk.wrapper, 'v-w'))).not.toContain('刪除')
    cleanup()
    mockGet({ '/admin/admissions/records': rows })
    const admin = await mountWith(RecordsTab, { props: props() })
    expect(labelsOf(await moreItems(admin.wrapper, 'v-e'))).toEqual(['編輯', '退註冊', '刪除'])
  })

  it('已匿名化的列：有標籤、沒有編輯、標記與退出，點列不開表單；歷程與刪除照常', async () => {
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', anonymized_at: '2026-09-25T02:00:00Z' })],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(rowTexts(wrapper)[0]).toContain('已匿名化')
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
    await wrapper.get('.records-table .el-table__body tr').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(document.body.querySelector('.el-dialog')).toBeNull()
    expect(labelsOf(await moreItems(wrapper, 'v-1'))).toEqual(['刪除'])
    await wrapper.get('button.records__name').trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
  })

  it('新增、編輯都開同一個表單；編輯在「更多」裡，帶入那一列', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const dialog = wrapper.getComponent(RecordDialog)
    await button(wrapper, '新增訪視')!.trigger('click')
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'add', campusKey: 'yihua' })
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    await chooseMore(wrapper, 'v-1', '編輯')
    expect(dialog.props('mode')).toBe('edit')
    expect(dialog.props('record')).toMatchObject({ id: 'v-1', child_name: '王小安' })
  })
})

describe('標記預繳、標記註冊與退出（都走看板同一個確認框）', () => {
  it('已訪視的列「標記預繳」、已預繳的列「標記註冊」：開確認框並帶起訖階段，完成後重新整理', async () => {
    const get = mockGet({
      '/admin/admissions/records': [visit({ version: 4 }), visit({ id: 'v-2', child_name: '李小樂', has_deposit: true, stage: 'deposited' })],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const transitionDialog = wrapper.getComponent(TransitionDialog)
    await button(wrapper, '標記預繳')!.trigger('click')
    expect(transitionDialog.props('modelValue')).toBe(true)
    expect(transitionDialog.props('target')).toMatchObject({ card: { id: 'v-1', version: 4 }, from: 'visited', to: 'deposited' })
    transitionDialog.vm.$emit('done', visit({ stage: 'deposited' }))
    await flushPromises()
    expect(listPaths(get)).toHaveLength(2)

    await button(wrapper, '標記註冊')!.trigger('click')
    expect(transitionDialog.props('target')).toMatchObject({ card: { id: 'v-2' }, from: 'deposited', to: 'enrolled' })
    // 別人剛改過（確認框收到 409）：一樣重新整理。
    transitionDialog.vm.$emit('stale')
    await flushPromises()
    expect(listPaths(get)).toHaveLength(3)
  })

  it('「更多 → 退預繳／退註冊」改用同一個確認框（不再跳 prompt），起點依階段', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt')
    mockGet({
      '/admin/admissions/records': [
        visit({ has_deposit: true, stage: 'deposited', version: 3 }),
        visit({ id: 'v-e', child_name: '李小樂', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const transitionDialog = wrapper.getComponent(TransitionDialog)
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(transitionDialog.props('target')).toMatchObject({ card: { id: 'v-1', version: 3 }, from: 'deposited', to: 'withdrawn' })
    expect(transitionDialog.props('modelValue')).toBe(true)
    transitionDialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    await chooseMore(wrapper, 'v-e', '退註冊')
    expect(transitionDialog.props('target')).toMatchObject({ card: { id: 'v-e' }, from: 'enrolled', to: 'withdrawn' })
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('刪除', () => {
  it('確認框寫出對象與後果、危險色、不預設聚焦、取消鍵「先不要」；帶版本，別人剛改過就提示並重新整理', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const info = vi.spyOn(ElMessage, 'info')
    const get = mockGet({ '/admin/admissions/records': [visit({ version: 2, visit_request_id: VR_ID, has_visit_request: true })] })
    const remove = mockDelete({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 3 })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    const [message, title, options] = confirm.mock.calls[0]!
    expect(title).toBe('刪除 王小安 的招生訪視？')
    expect(String(message)).toBe('歷程與參觀後的聯絡紀錄會一起刪除，統計也不再算這一筆。刪除後無法復原。官網預約的案件不受影響。')
    expect(options).toMatchObject({ confirmButtonText: '刪除', cancelButtonText: '先不要', confirmButtonClass: 'el-button--danger', autofocus: false })
    expect(remove).toHaveBeenCalledWith('/admin/admissions/records/v-1?expected_version=2')
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(listPaths(get)).toHaveLength(2)
  })

  it('已註冊的列講明統計不再算；沒填姓名的寫「這筆」', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-e', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-x', child_name: '（未填姓名）' }),
      ],
    })
    mockDelete()
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-e', '刪除')
    expect(String(confirm.mock.calls[0]![0])).toContain('統計也不再算這一筆')
    expect(String(confirm.mock.calls[0]![0])).not.toContain('名額')
    await chooseMore(wrapper, 'v-x', '刪除')
    expect(confirm.mock.calls[1]![1]).toBe('刪除這筆招生訪視？')
  })

  it('刪除成功提示並重新整理；按先不要不送出', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/records': [visit()] })
    const remove = mockDelete()
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).toHaveBeenCalledOnce()
    expect(success).toHaveBeenCalledWith('刪除成功')
  })

  it('刪除收到已匿名化的 409：用可關閉的警告提示並重新整理，不顯示錯誤', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/records': [visit()] })
    mockDelete({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已依保存政策匿名化，不能再變更', showClose: true }))
    expect(error).not.toHaveBeenCalled()
    expect(listPaths(get)).toHaveLength(2)
  })
})

describe('手機（390）：卡片清單', () => {
  it('不出表格；卡片第一行姓名＋階段，接著班別・入學學期・參觀日期、下次聯絡與負責人；按鈕列有歷程、主要動作、更多', async () => {
    stubNarrow()
    mockGet({
      '/admin/admissions/records': [
        visit({ follow_up_at: '2020-01-01T02:00:00Z', notes: '外婆接送' }),
        visit({ id: 'v-e', child_name: '李小樂', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-3', child_name: '張小晴' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.find('.records-table').exists()).toBe(false)
    const [first, second, third] = wrapper.findAll('.record-card')
    expect(first!.get('.record-card__top').text()).toContain('王小安')
    expect(first!.get('.record-card__stage').text()).toBe('已訪視')
    const meta = first!.findAll('.record-card__meta').map((line) => line.text())
    expect(meta[0]).toBe('小班・115 上學期・參觀 115.09.08')
    expect(meta[1]).toMatch(/^下次聯絡 逾 \d+ 天・負責人：未指派$/)
    expect(first!.find('.records__due').exists()).toBe(true)
    expect(first!.get('details.record-card__info').text()).toContain('外婆接送')
    expect(first!.findAll('.record-card__actions button').map((b) => b.text())).toEqual(['歷程', '標記預繳', '更多'])
    // 已註冊沒有下一步可標記，只有歷程與更多；註冊日期收在其他資料。沒有其他資料就不出「其他資料」。
    expect(second!.findAll('.record-card__actions button').map((b) => b.text())).toEqual(['歷程', '更多'])
    expect(second!.get('details').text()).toContain('註冊日期115.09.20')
    expect(third!.find('details').exists()).toBe(false)

    await first!.findAll('.record-card__actions button')[0]!.trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-1' })
    expect(labelsOf(await moreItems(wrapper, 'v-1'))).toEqual(['編輯', '刪除'])
  })

  it('篩選只常駐搜尋＋「篩選」鈕；月份、預繳、追蹤也收進去，收起時列成標籤', async () => {
    stubNarrow()
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ month: '115.09' }) })
    const toggle = wrapper.get('button.more-filters')
    expect(toggle.text()).toContain('篩選')
    expect(toggle.text()).not.toContain('更多篩選')
    const fieldLabels = (selector: string) => wrapper.findAll(`${selector} .filter-field > span:first-child`).map((label) => label.text())
    expect(fieldLabels('#records-more-filters')).toEqual(['月份', '預繳', '追蹤', '班別', '來源', '家長介紹', '未預繳原因', '負責人'])
    expect(fieldLabels('.records-filters')[0]).toBe('搜尋')
    expect(wrapper.findAll('.filter-chip').map((chip) => chip.text())).toEqual(['月份：115.09×，拿掉這個條件'])
    await wrapper.get('.filter-chip').trigger('click')
    expect(wrapper.emitted('update:month')).toEqual([['']])
  })
})

describe('月份篩選與網址（C3 統計分頁跳到明細的接縫，本檔調整第 15 條）', () => {
  const pageRoutes = () => ({
    '/admin/admissions/records': [visit()],
    '/admin/admissions/stats': () => {
      throw new Error('統計不在這支測試的範圍')
    },
  })

  it('網址帶 tab=records&month=115.09 時明細以該月份查詢', async () => {
    const get = mockGet(pageRoutes())
    const { router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=115.09' })
    expect(lastQuery(get).get('month')).toBe('115.09')
    expect(router.currentRoute.value.query.month).toBe('115.09')
  })

  it('網址上格式不對的月份不採用，也從網址拿掉', async () => {
    const get = mockGet(pageRoutes())
    const { router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=2026-09' })
    expect(lastQuery(get).has('month')).toBe(false)
    expect(router.currentRoute.value.query.month).toBeUndefined()
  })

  it('統計分頁用 router.push 帶 month 切過來（C3 的做法）；清除篩選連月份、學年學期一起清', async () => {
    const get = mockGet(pageRoutes())
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats&sem=1' })
    await router.push({ query: { ...router.currentRoute.value.query, tab: 'records', month: '115.08' } })
    await flushPromises()
    expect(lastQuery(get).get('month')).toBe('115.08')
    expect(lastQuery(get).get('target_semester')).toBe('1')
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'records', month: '115.08', sem: '1' })

    await button(wrapper, '清除篩選')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', tab: 'records' })
    const cleared = lastQuery(get)
    expect(cleared.has('month')).toBe(false)
    expect(cleared.has('target_school_year')).toBe(false)
    expect(cleared.has('target_semester')).toBe(false)
  })

  it('明細裡選月份會寫回網址', async () => {
    mockGet(pageRoutes())
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records' })
    selectByPlaceholder(wrapper, '全部月份').vm.$emit('update:modelValue', '115.09')
    await flushPromises()
    expect(router.currentRoute.value.query.month).toBe('115.09')
  })
})
