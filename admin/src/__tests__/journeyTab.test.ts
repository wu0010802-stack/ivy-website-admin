// 預約全程（2026-10-15 規格 §3.3）：期間與來源控制、四塊表、空資料、讀取失敗、涵蓋說明、匯出。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import JourneyTab from '../components/admissions/JourneyTab.vue'
import { DEFAULT_JOURNEY_FILTER } from '../admissions/journeyFormat'
import { cleanup, journeyData, mockGet, mountWith, pathsTo, queryOf } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => {
  vi.mocked(downloadCsv).mockClear()
  cleanup()
})

const FROZEN = '2026-10-15T09:00:00+08:00'
type Dom = Omit<DOMWrapper<Element>, 'exists'>
const block = (wrapper: VueWrapper, title: string): Dom =>
  wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: Dom) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))

async function mountJourney(changes: Record<string, unknown> = {}, data: unknown = journeyData()) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(FROZEN))
  const get = mockGet({ '/admin/admissions/journey': data })
  const mounted = await mountWith(JourneyTab, {
    props: { campusKey: 'yihua', filter: { ...DEFAULT_JOURNEY_FILTER }, ...changes },
  })
  await flushPromises()
  return { ...mounted, get }
}

describe('預約全程', () => {
  it('依頁首校區與預設期間（最近 3 個月、全部來源）讀；期間含今天往回 90 天', async () => {
    const { get } = await mountJourney()
    const [path] = pathsTo(get, '/admin/admissions/journey')
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua', from: '2026-07-18', to: '2026-10-15', source: 'all' })
  })

  it('摘要句、四塊表的標題與欄位', async () => {
    const { wrapper } = await mountJourney()
    expect(wrapper.get('.journey-summary').text()).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 13 筆：到場 8（到場率 88.9%）、取消 3、沒來 1、時間已過未標記 1。' +
        '到場的 8 筆中 7 筆有招生紀錄，預繳 4、註冊 2、預繳後退出 2。',
    )
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).toEqual([
      '全程漏斗', '家庭在哪裡離開', '取消時點（距參觀日）', '各段要花多久',
    ])
    expect(block(wrapper, '全程漏斗').findAll('thead th').map((th) => th.text())).toEqual(['階段', '人數', '比率'])
    expect(block(wrapper, '家庭在哪裡離開').findAll('thead th').map((th) => th.text())).toEqual(['類別', '人數', '時點'])
    expect(block(wrapper, '取消時點（距參觀日）').findAll('thead th').map((th) => th.text())).toEqual(['距參觀日', '家長', '園方', '其他'])
    expect(block(wrapper, '各段要花多久').findAll('thead th').map((th) => th.text())).toEqual(['指標', '中位數', '筆數', '說明'])
  })

  it('全程漏斗與離開的列、各段天數', async () => {
    const { wrapper } = await mountJourney()
    expect(bodyRows(block(wrapper, '全程漏斗'))[0]).toEqual(['預約案件', '13', '取消率 23.1%（3／13）・樣本較少'])
    expect(bodyRows(block(wrapper, '全程漏斗')).map((row) => row[0])).toEqual(['預約案件', '已到場', '有招生訪視', '預繳過', '註冊過', '預繳後退出'])
    expect(bodyRows(block(wrapper, '家庭在哪裡離開')).map((row) => [row[0], row[1]])).toContainEqual(['參觀後未預繳・逾期', '1'])
    expect(bodyRows(block(wrapper, '各段要花多久'))[1]).toEqual(['參觀到預繳', '5 天', '3', '樣本較少；另有 1 筆沒有預繳日或日期倒置，不納入'])
  })

  it('涵蓋說明與改期數：沒有預約案件的訪視、已到場但沒有訪視、算不出參觀日的案件', async () => {
    const { wrapper } = await mountJourney()
    const text = wrapper.get('.journey-coverage').text()
    expect(text).toContain('另有 4 筆招生訪視沒有預約案件（現場參觀、舊名單補登），不在這個漏斗裡')
    expect(text).toContain('已到場但沒有招生訪視 1 筆')
    expect(text).toContain('預定參觀日算不出來而未納入的案件 2 筆')
    expect(text).toContain('改期過的案件 1／13')
  })

  it('沒有取消就不顯示取消時點表', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney({}, journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0 } } }))
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('取消時點（距參觀日）')
  })

  it('取消時點都有取消時間：表的說明不帶「不納入」，離開表下面也沒有多餘的說明', async () => {
    const { wrapper } = await mountJourney()
    expect(block(wrapper, '取消時點（距參觀日）').get('.stats-block__caption').text()).not.toContain('不納入')
    expect(wrapper.find('.journey-exits__note').exists()).toBe(false)
  })

  it('取消時點有缺取消時間的案件（n=2、excluded=1）：表在，不納入的筆數接在表的說明後面', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney({}, journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 2, excluded: 1 } } }))
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).toContain('取消時點（距參觀日）')
    expect(block(wrapper, '取消時點（距參觀日）').get('.stats-block__caption').text()).toMatch(/占位原因。 另有 1 筆沒有取消時間，不納入$/)
    expect(wrapper.find('.journey-exits__note').exists()).toBe(false)
  })

  it('取消都缺取消時間（n=0、excluded=1）：取消時點表隱藏，不納入的筆數改寫在離開表下面', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney({}, journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0, excluded: 1 } } }))
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('取消時點（距參觀日）')
    const note = wrapper.get('.journey-exits__note')
    expect(note.classes()).toContain('hint')
    expect(note.text()).toBe('另有 1 筆沒有取消時間，不納入')
    expect(note.element.previousElementSibling).toBe(block(wrapper, '家庭在哪裡離開').element)
    expect(bodyRows(block(wrapper, '家庭在哪裡離開'))[0]).toEqual(['已取消・家長', '1', '沒有取消時間可比對'])
  })

  it('完全沒有取消時間可看（n=0、excluded=0）：表隱藏、沒有說明，離開表的取消列寫「—」', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney({}, journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0, excluded: 0 } } }))
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('取消時點（距參觀日）')
    expect(wrapper.find('.journey-exits__note').exists()).toBe(false)
    expect(bodyRows(block(wrapper, '家庭在哪裡離開')).slice(0, 3).map((row) => row[2])).toEqual(['—', '—', '—'])
  })

  it('這段期間沒有預約案件：只寫一句、不畫表', async () => {
    const { wrapper } = await mountJourney({}, journeyData({ cases: { total: 0, by_source: {} } }))
    expect(wrapper.text()).toContain('這段期間沒有預約案件')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('讀取失敗：錯誤與重新載入，不畫舊數字', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FROZEN))
    mockGet({ '/admin/admissions/journey': () => { throw new Error('boom') } })
    const { wrapper } = await mountWith(JourneyTab, { props: { campusKey: 'yihua', filter: { ...DEFAULT_JOURNEY_FILTER } } })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取預約全程，請重新載入')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('換來源重讀並把新篩選交給父層', async () => {
    const { wrapper, get } = await mountJourney()
    await wrapper.findAll('.el-radio-button').find((button) => button.text() === '官網預約')!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:filter')!.at(-1)![0]).toEqual({ period: '90', from: '', to: '', source: 'web' })
    wrapper.setProps({ filter: { period: '90', from: '', to: '', source: 'web' } })
    await flushPromises()
    const paths = pathsTo(get, '/admin/admissions/journey')
    expect(Object.fromEntries(queryOf(paths.at(-1)!)).source).toBe('web')
  })

  it('自訂區間沒選好不讀；選好才讀', async () => {
    const { get } = await mountJourney({ filter: { period: 'custom', from: '', to: '', source: 'all' } })
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(0)
  })

  it('匯出 CSV：每張表一個檔名，只有聚合數字；檔名帶校區與資料涵蓋的起訖日，不帶入學學年學期', async () => {
    const { wrapper } = await mountJourney()
    await block(wrapper, '全程漏斗').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-預約全程-全程漏斗-義華-2026-07-17至2026-10-15.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('階段,人數,比率')
    await block(wrapper, '取消時點（距參觀日）').get('[data-test="stats-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toBe('招生統計-預約全程-取消時點（距參觀日）-義華-2026-07-17至2026-10-15.csv')
  })

  it('匯出 CSV：起訖日取回應的 filters（迄日被截到今天時以截過的為準）；來源不是全部時檔名最後加來源', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney(
      { filter: { period: '90', from: '', to: '', source: 'web' } },
      journeyData({ filters: { ...data.filters, date_to: '2026-10-14', source: 'web' } }),
    )
    await block(wrapper, '全程漏斗').get('[data-test="stats-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toBe('招生統計-預約全程-全程漏斗-義華-2026-07-17至2026-10-14-官網預約.csv')
  })
})
