import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import ArrivalsTab from '../components/admissions/ArrivalsTab.vue'
import { ApiError } from '../api/client'
import { testUser } from './fixtures'
import {
  arrivalRow, arrivals as arrivalsResponse, button, cleanup, deferred, hasButton, mockGet, mockPost, mountWith, pathsTo, queryOf, VR_ID, VR_ID_2,
} from './admissionsTestKit'

afterEach(cleanup)

const rows = (wrapper: VueWrapper, table: string) => wrapper.findAll(`.${table} .el-table__body tr`).map((row) => row.text())
// 預設一筆待確認；形狀與 total 欄位交給 testkit 的 arrivals() 工廠。
const arrivals = (awaiting: unknown[] = [arrivalRow()], missing: unknown[] = [], totals = {}) => arrivalsResponse(awaiting, missing, totals)
const confirmOk = () => vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

describe('官網預約：待確認到場（規格 6.1 第 2 點）', () => {
  it('列出場次（上午場 10:00 格式）、家長、孩子、人數與查看預約', async () => {
    mockGet({
      '/admin/admissions/arrivals': arrivals(
        [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2, start_time: '14:00:00', child_name: null, party_size: null })],
        [arrivalRow({ visit_request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', parent_name: '林爸爸', status: 'completed' })],
      ),
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    const [first, second] = rows(wrapper, 'arrivals-table')
    for (const text of ['2026/09/26（週六）上午場 10:00', '陳媽媽', '陳小寶', '2 位']) expect(first).toContain(text)
    expect(second).toContain('下午場 14:00')
    expect(second).toContain('未填寫')
    expect(wrapper.find(`a[href="/visit-requests/${VR_ID}"]`).text()).toBe('查看預約')
    expect(rows(wrapper, 'missing-table')[0]).toContain('林爸爸')
    expect(wrapper.emitted('count')).toEqual([[2]])
  })

  it('沒有待確認時說明；沒有要補建的就不顯示下方區塊', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals([], []) })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('目前沒有待確認到場的預約。')
    expect(wrapper.text()).not.toContain('已到場但沒有招生訪視')
    expect(wrapper.emitted('count')).toEqual([[0]])
  })

  it('清單被截斷：筆數用 total，清單上方寫只列最近幾筆', async () => {
    const missingId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    mockGet({
      '/admin/admissions/arrivals': arrivals(
        [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })],
        [arrivalRow({ visit_request_id: missingId, status: 'completed' })],
        { awaiting_total: 250, missing_total: 3 },
      ),
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('只列最近 2 筆，共 250 筆')
    expect(wrapper.text()).toContain('只列最近 1 筆，共 3 筆')
    expect(wrapper.emitted('count')).toEqual([[250]])
  })

  it('沒被截斷時不顯示只列最近幾筆', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals() })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).not.toContain('只列最近')
  })

  it('沒有場次的舊預約顯示「沒有場次」', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals([arrivalRow({ slot_date: null, start_time: null })]) })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(rows(wrapper, 'arrivals-table')[0]).toContain('沒有場次')
  })

  it('讀取失敗顯示錯誤，可以重新載入', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/arrivals': () => {
        if (fail) throw new Error('offline')
        return arrivals()
      },
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('無法讀取官網預約，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
    expect(rows(wrapper, 'arrivals-table')[0]).toContain('陳媽媽')
  })

  it('已到場：先確認（同預約明細的文案），送既有 /complete，提示並重新整理；按先不要不送', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    let remaining = [arrivalRow()]
    const get = mockGet({ '/admin/admissions/arrivals': () => arrivals(remaining) })
    const post = mockPost({
      [`/admin/visit-requests/${VR_ID}/complete`]: () => {
        remaining = []
        return {}
      },
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]!.slice(0, 2)).toEqual(['會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？'])
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
    expect(wrapper.emitted('count')!.at(-1)).toEqual([0])
  })

  it('未到場：照預約明細的確認框，送既有 /no-show，不建立招生訪視', async () => {
    const confirm = confirmOk()
    const post = mockPost()
    mockGet({ '/admin/admissions/arrivals': arrivals() })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '未到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]![1]).toBe('標記為未到場？')
    expect(String(confirm.mock.calls[0]![0])).toContain('名額仍算已使用')
    expect(post.mock.calls.map((call) => call[0])).toEqual([`/admin/visit-requests/${VR_ID}/no-show`])
  })

  it('別人剛處理過這筆（409）：提示並重新整理，不顯示錯誤', async () => {
    confirmOk()
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals() })
    mockPost({ [`/admin/visit-requests/${VR_ID}/complete`]: () => { throw new ApiError(409, { code: 'INVALID_TRANSITION', message: '案件狀態已變更' }) } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(info).toHaveBeenCalledWith('這筆預約的狀態剛被其他人更新，已重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })
})

describe('官網預約：已到場但沒有招生訪視', () => {
  const missingId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('建立招生訪視：送補建，提示並重新整理', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals([], [arrivalRow({ visit_request_id: missingId, status: 'completed' })]) })
    const post = mockPost({ [`/admin/admissions/from-visit-request/${missingId}`]: { id: 'v-9' } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('已到場但沒有招生訪視')
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/admissions/from-visit-request/${missingId}`)
    expect(success).toHaveBeenCalledWith('已建立招生訪視')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })

  it('預約已不是「已到場」或已匿名化（409）：說明原因並重新整理', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals([], [arrivalRow({ visit_request_id: missingId, status: 'completed' })]) })
    mockPost({ [`/admin/admissions/from-visit-request/${missingId}`]: () => { throw new ApiError(409, { code: 'VISIT_REQUEST_ANONYMIZED' }) } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆預約已依保存政策匿名化，不能再建立招生訪視')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })
})

describe('官網預約：權限與切換校區', () => {
  it('只有 booking.read：看得到清單與查看預約，沒有已到場、未到場、建立招生訪視', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals([arrivalRow()], [arrivalRow({ visit_request_id: VR_ID_2, status: 'completed' })]) })
    const viewer = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' }, user: viewer })
    for (const text of ['已到場', '未到場', '建立招生訪視']) expect(hasButton(wrapper, text), text).toBe(false)
    expect(wrapper.findAll('a').filter((link) => link.text() === '查看預約')).toHaveLength(2)
    expect(wrapper.text()).toContain('你的帳號只能查看')
  })

  it('快速切換校區：義華較晚回來也只顯示仁武，筆數也只回報仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/arrivals': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : arrivals([arrivalRow({ parent_name: '林媽媽' })]),
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(arrivals([arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })]))
    await flushPromises()
    expect(rows(wrapper, 'arrivals-table')).toHaveLength(1)
    expect(rows(wrapper, 'arrivals-table')[0]).toContain('林媽媽')
    expect(wrapper.emitted('count')).toEqual([[1]])
  })

  it('頁面上的分頁標籤跟著更新筆數', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    let remaining = [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })]
    mockGet({ '/admin/admissions/arrivals': () => arrivals(remaining) })
    mockPost({
      [`/admin/visit-requests/${VR_ID}/complete`]: () => {
        remaining = [arrivalRow({ visit_request_id: VR_ID_2 })]
        return {}
      },
    })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?tab=arrivals' })
    expect(wrapper.get('.admissions__count').text()).toBe('2')
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admissions__count').text()).toBe('1')
  })
})
