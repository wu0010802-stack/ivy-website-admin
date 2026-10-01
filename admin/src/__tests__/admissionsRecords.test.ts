import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, arrivals, bodyOf, button, cleanup, deferred, hasButton, mockDelete, mockGet, mockPost, mountWith, options,
  pathsTo, queryOf, reception, visit, VR_ID,
} from './admissionsTestKit'

afterEach(cleanup)

type Spy = Parameters<typeof pathsTo>[0]
const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '', ...changes })
const listPaths = (get: Spy) => pathsTo(get, '/admin/admissions/records?')
const lastQuery = (get: Spy) => queryOf(listPaths(get).at(-1)!)
const rowTexts = (wrapper: VueWrapper) => wrapper.findAll('.records-table .el-table__body tr').map((row) => row.text())
const selectByPlaceholder = (wrapper: VueWrapper, placeholder: string) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === placeholder)!

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

describe('訪視明細：載入、空資料、錯誤（規格第 10 節）', () => {
  it('以校區、入學學年學期、月份查詢，每頁 50 筆；列出民國參觀日期、入學學期、預繳與官網預約', async () => {
    const get = mockGet({
      '/admin/admissions/records': [
        visit({ visit_request_id: VR_ID, has_visit_request: true }),
        visit({ id: 'v-2', child_name: '李小樂', has_deposit: true, stage: 'deposited', target_semester: 2 }),
        visit({ id: 'v-3', child_name: '張小晴', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'deposited', stage: 'withdrawn' }),
        visit({ id: 'v-4', child_name: '（未填姓名）' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ semester: 1, month: '115.09' }) })
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', month: '115.09', target_school_year: '115', target_semester: '1', page: '1', page_size: '50',
    })
    const rows = rowTexts(wrapper)
    for (const text of ['115.09.08', '王小安', '小班', '115 上學期', '官網預約', '否']) expect(rows[0]).toContain(text)
    expect(rows[1]).toContain('115 下學期')
    expect(rows[1]).toContain('是')
    expect(rows[2]).toContain('已退預繳')
    expect(rows[3]).toContain('待補')
    // 有 booking.read 才看得到預約明細的連結。
    expect(wrapper.find(`a[href="/visit-requests/${VR_ID}"]`).text()).toBe('查看預約')
  })

  it('沒有資料時說明原因；有篩選時改說篩選下沒有', async () => {
    mockGet({ '/admin/admissions/records': [], '/admin/admissions/options': options() })
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
      '/admin/admissions/options': options(),
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
      '/admin/admissions/options': options(),
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

describe('篩選、分頁與權限', () => {
  it('班別、預繳「否」送到 API 並回第一頁；滿 50 筆才有下一頁', async () => {
    const full = Array.from({ length: 50 }, (_, index) => visit({ id: `v-${index}` }))
    const get = mockGet({
      '/admin/admissions/records': (path: string) => (queryOf(path).get('page') === '1' ? full : [visit({ id: 'v-last' })]),
      '/admin/admissions/options': options(),
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
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const month = selectByPlaceholder(wrapper, '全部月份')
    expect(wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(expect.arrayContaining(['115.09', '115.08']))
    month.vm.$emit('update:modelValue', '115.08')
    expect(wrapper.emitted('update:month')).toEqual([['115.08']])
  })

  it('從預約明細連進來（vr）只看那一筆；「顯示全部」清掉', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ schoolYear: null, visitRequestId: VR_ID }) })
    expect(lastQuery(get).get('visit_request_id')).toBe(VR_ID)
    expect(lastQuery(get).has('target_school_year')).toBe(false)
    expect(wrapper.text()).toContain('只顯示這筆官網預約建立的招生訪視。')
    await button(wrapper, '顯示全部')!.trigger('click')
    expect(wrapper.emitted('update:visitRequestId')).toEqual([['']])
  })

  it('只能看招生的帳號：沒有新增、編輯、更多，仍可看歷程', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: admissionsViewer() })
    expect(hasButton(wrapper, '新增訪視')).toBe(false)
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(hasButton(wrapper, '更多')).toBe(false)
    expect(hasButton(wrapper, '歷程')).toBe(true)
  })

  it('櫃台（沒有 admissions.convert）：已註冊的列不能退註冊，已預繳的列可以退預繳', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-e', has_deposit: false, enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-d', has_deposit: true, stage: 'deposited' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: reception() })
    // 沒有可做的動作（退註冊、刪除都要 convert），整列不出現「更多」。
    expect(wrapper.find('[data-more="v-e"]').exists()).toBe(false)
    expect(labelsOf(await moreItems(wrapper, 'v-d'))).toContain('退預繳')
  })

  it('櫃台看「從已註冊退出」的列沒有刪除；總管理者看已註冊的列有刪除（admissions.convert）', async () => {
    const rows = [
      visit({ id: 'v-w', stage: 'withdrawn', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'enrolled' }),
      visit({ id: 'v-e', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
    ]
    mockGet({ '/admin/admissions/records': rows, '/admin/admissions/options': options() })
    const desk = await mountWith(RecordsTab, { props: props(), user: reception() })
    expect(desk.wrapper.find('[data-more="v-w"]').exists()).toBe(false)
    cleanup()
    mockGet({ '/admin/admissions/records': rows, '/admin/admissions/options': options() })
    const admin = await mountWith(RecordsTab, { props: props() })
    expect(labelsOf(await moreItems(admin.wrapper, 'v-e'))).toContain('刪除')
  })

  it('已匿名化的列：有標籤、沒有編輯與退出，點列不開表單；歷程與刪除照常', async () => {
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', anonymized_at: '2026-09-25T02:00:00Z' })],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(rowTexts(wrapper)[0]).toContain('已匿名化')
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(hasButton(wrapper, '歷程')).toBe(true)
    const labels = labelsOf(await moreItems(wrapper, 'v-1'))
    expect(labels).toContain('刪除')
    expect(labels).not.toContain('退預繳')
  })

  it('退出收到已匿名化的 409：提示並重新整理，不顯示錯誤', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '家長搬家', action: 'confirm' } as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(warning).toHaveBeenCalledWith('這筆招生訪視已依保存政策匿名化，不能再變更')
    expect(error).not.toHaveBeenCalled()
    expect(listPaths(get)).toHaveLength(2)
  })

  it('新增、編輯都開同一個表單；編輯帶入那一列', async () => {
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const dialog = wrapper.getComponent(RecordDialog)
    await button(wrapper, '新增訪視')!.trigger('click')
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'add', campusKey: 'yihua' })
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    await button(wrapper, '編輯')!.trigger('click')
    expect(dialog.props('mode')).toBe('edit')
    expect(dialog.props('record')).toMatchObject({ id: 'v-1', child_name: '王小安' })
  })
})

describe('退出與刪除', () => {
  it('已預繳的列「更多 → 退預繳」要填原因，送狀態轉換並重新整理', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '  家長搬家  ', action: 'confirm' } as never)
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', version: 3 })], '/admin/admissions/options': options() })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(prompt.mock.calls[0]![1]).toBe('退預繳')
    expect(String(prompt.mock.calls[0]![0])).toBe('將標記退預繳。若已實際收款，退款要另外處理。')
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'withdrawn', expected_version: 3, reason: '家長搬家', deposit_collector: null,
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    expect(success).toHaveBeenCalledWith('已退預繳')
    expect(listPaths(get)).toHaveLength(2)
  })

  it('退出時別人剛改過狀態：照園務提示並重新整理，不顯示錯誤', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '家長搬家', action: 'confirm' } as never)
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 2 })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(info).toHaveBeenCalledWith('狀態已被其他人變更，已自動重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(listPaths(get)).toHaveLength(2)
  })

  it('刪除先確認、帶版本；別人剛改過就提示並重新整理', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const info = vi.spyOn(ElMessage, 'info')
    const get = mockGet({ '/admin/admissions/records': [visit({ version: 2 })], '/admin/admissions/options': options() })
    const remove = mockDelete({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 3 })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(String(confirm.mock.calls[0]![0])).toContain('確定刪除此筆記錄？')
    expect(remove).toHaveBeenCalledWith('/admin/admissions/records/v-1?expected_version=2')
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(listPaths(get)).toHaveLength(2)
  })

  it('刪除成功提示並重新整理；按取消不送出', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const remove = mockDelete()
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).toHaveBeenCalledOnce()
    expect(success).toHaveBeenCalledWith('刪除成功')
  })
})

describe('月份篩選與網址（C3 統計分頁跳到明細的接縫，本檔調整第 15 條）', () => {
  const pageRoutes = () => ({
    '/admin/admissions/arrivals': arrivals(),
    '/admin/admissions/records': [visit()],
    '/admin/admissions/options': options(),
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
