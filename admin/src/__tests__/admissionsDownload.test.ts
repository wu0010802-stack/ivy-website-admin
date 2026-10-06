// 招生名單匯出鈕（2026-10-03）：有「匯出個資」授權才顯示；送出和畫面相同的篩選、不帶分頁；
// 失敗時寫成中文提示，不產生檔案。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElCheckbox, ElSelect } from 'element-plus'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import NoDepositList from '../components/admissions/NoDepositList.vue'
import { ApiError } from '../api/client'
import { button, cleanup, deferred, hasButton, mockGet, mountWith, pathsTo, queryOf, reception, visit } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadServerCsv: vi.fn(() => Promise.resolve()) }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))
import { downloadServerCsv } from '../utils/csv'
import { notifyError } from '../composables/notify'

afterEach(() => {
  cleanup()
  vi.mocked(downloadServerCsv).mockReset()
  vi.mocked(downloadServerCsv).mockImplementation(() => Promise.resolve())
  vi.mocked(notifyError).mockClear()
})

const RECORDS = '/admin/admissions/records'
const NO_DEPOSIT = '/admin/admissions/no-deposit-records'
const recordProps = { campusKey: 'yihua', schoolYear: 115, semester: 1, month: '115.09', visitRequestId: '' }
const noDepositProps = { campusKey: 'yihua', schoolYear: 115, semester: 1 }
const noDeposit = { total: 0, page: 1, page_size: 50, summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0 }, records: [] }

/** 篩選條件（去掉分頁）轉成可以直接比對的物件。 */
const withoutPaging = (query: URLSearchParams) => {
  const entries = Object.fromEntries(query)
  delete entries.page
  delete entries.page_size
  return entries
}

describe('訪視明細匯出 CSV', () => {
  it('總管理者看得到；送出和列表相同的篩選、不帶分頁，檔名含校區與日期', async () => {
    mockGet({ [RECORDS]: [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const [path, filename] = vi.mocked(downloadServerCsv).mock.calls.at(-1)!
    expect(path.startsWith(`${RECORDS}/export?`)).toBe(true)
    const query = queryOf(path)
    expect(query.get('campus_key')).toBe('yihua')
    expect(query.get('month')).toBe('115.09')
    expect(query.get('target_school_year')).toBe('115')
    expect(query.get('target_semester')).toBe('1')
    expect(query.has('page')).toBe(false)
    expect(query.has('page_size')).toBe(false)
    expect(filename).toMatch(/^招生訪視明細-義華-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('設了追蹤與負責人篩選，匯出網址帶 follow_up 與 owner，而且和列表送的篩選完全一樣', async () => {
    const get = mockGet({ [RECORDS]: [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    const select = (label: string) => wrapper.findAllComponents(ElSelect).find((item) => item.props('ariaLabel') === label)!
    select('追蹤狀態').vm.$emit('update:modelValue', 'due')
    select('追蹤負責人').vm.$emit('update:modelValue', 'me')
    await flushPromises()

    const listQuery = queryOf(pathsTo(get, `${RECORDS}?`).at(-1)!)
    expect(listQuery.get('follow_up')).toBe('due')
    expect(listQuery.get('owner')).toBe('me')

    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const query = queryOf(vi.mocked(downloadServerCsv).mock.calls.at(-1)![0])
    expect(query.get('follow_up')).toBe('due')
    expect(query.get('owner')).toBe('me')
    expect(withoutPaging(query)).toEqual(withoutPaging(listQuery))
  })

  it('沒有匯出個資授權的櫃台看不到按鈕', async () => {
    mockGet({ [RECORDS]: [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps, user: reception() })
    expect(hasButton(wrapper, '匯出 CSV')).toBe(false)
  })

  it('筆數太多（422）時用後端的中文訊息提示', async () => {
    mockGet({ [RECORDS]: [visit()] })
    vi.mocked(downloadServerCsv).mockRejectedValueOnce(new ApiError(422, { code: 'EXPORT_TOO_LARGE', message: '符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。' }))
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。')
  })

  it('沒有權限（403）或連線失敗時也寫成中文提示；之後可以再按', async () => {
    mockGet({ [RECORDS]: [visit()] })
    vi.mocked(downloadServerCsv)
      .mockRejectedValueOnce(new ApiError(403, '沒有權限執行此操作'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('沒有權限執行此操作')
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('匯出失敗，請再試一次。')
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(downloadServerCsv)).toHaveBeenCalledTimes(3)
  })

  it('匯出進行中再按不會重複送出', async () => {
    mockGet({ [RECORDS]: [visit()] })
    const pending = deferred<void>()
    vi.mocked(downloadServerCsv).mockReturnValueOnce(pending.promise)
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await button(wrapper, '匯出 CSV')!.trigger('click')
    expect(vi.mocked(downloadServerCsv)).toHaveBeenCalledTimes(1)
    pending.resolve()
    await flushPromises()
  })
})

describe('未預繳名單匯出 CSV', () => {
  it('送出目前的潛力、原因、班別篩選（預設高潛力優先）', async () => {
    mockGet({ [NO_DEPOSIT]: noDeposit })
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const [path, filename] = vi.mocked(downloadServerCsv).mock.calls.at(-1)!
    expect(path.startsWith(`${NO_DEPOSIT}/export?`)).toBe(true)
    const query = queryOf(path)
    expect(query.get('campus_key')).toBe('yihua')
    expect(query.get('school_year')).toBe('115')
    expect(query.get('priority')).toBe('high')
    expect(query.has('page')).toBe(false)
    expect(filename).toMatch(/^未預繳名單-義華-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('改了原因、班別、逾 14 天、冷名單後，匯出的篩選和列表送的完全一樣', async () => {
    const get = mockGet({ [NO_DEPOSIT]: noDeposit })
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps })
    const [, reasonSelect, gradeSelect] = wrapper.findAllComponents(ElSelect)
    const [overdueBox, coldBox] = wrapper.findAllComponents(ElCheckbox)
    reasonSelect!.vm.$emit('update:modelValue', '費用考量')
    gradeSelect!.vm.$emit('update:modelValue', '小班')
    overdueBox!.vm.$emit('update:modelValue', true)
    coldBox!.vm.$emit('update:modelValue', true)
    await flushPromises()

    const listQuery = queryOf(pathsTo(get, `${NO_DEPOSIT}?`).at(-1)!)
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const query = queryOf(vi.mocked(downloadServerCsv).mock.calls.at(-1)![0])
    expect(Object.fromEntries(query)).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', reason: '費用考量', grade: '小班', priority: 'high', overdue_days: '14', cold_only: 'true',
    })
    expect(withoutPaging(query)).toEqual(withoutPaging(listQuery))
  })

  it('選「全部潛力」不帶 priority；後端回 422 時用中文訊息提示', async () => {
    mockGet({ [NO_DEPOSIT]: noDeposit })
    vi.mocked(downloadServerCsv).mockRejectedValueOnce(new ApiError(422, { code: 'EXPORT_TOO_LARGE', message: '符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。' }))
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps })
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 'all')
    await flushPromises()
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(queryOf(vi.mocked(downloadServerCsv).mock.calls.at(-1)![0]).has('priority')).toBe(false)
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。')
  })

  it('沒有匯出個資授權的櫃台看不到按鈕', async () => {
    mockGet({ [NO_DEPOSIT]: noDeposit })
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps, user: reception() })
    expect(hasButton(wrapper, '匯出 CSV')).toBe(false)
  })
})
