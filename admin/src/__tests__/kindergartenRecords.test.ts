// 附近幼兒園的裁罰與評鑑（2026-10-20 規格 C4、C11、C13）：列上的標籤與評鑑小字、展開讀明細、各種沒資料的文案。
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import {
  NO_RECORDS, RECORDS_NOTE, evaluationLine, evaluationResultText, penaltyBadge, punishmentText, slashDate, subjectText,
} from '../components/admissions/area/kindergartenRecordsFormat'
import type { AreaKindergartenRecords, AreaPenaltyRecord } from '../api/types'
import { areaKindergartens, button, cleanup, deferred, kindergarten, mockGet, pathsTo } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  cleanup()
})

const SYNCED = { penalties_synced_at: '2026-10-20T03:00:00Z', evaluations_synced_at: '2026-10-20T03:10:00Z' }
const RECORDS_PATH = '/admin/admissions/area/kindergartens/'

function mountList(props: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(NearbyKindergartens, {
    props: { data: areaKindergartens(undefined, SYNCED), failed: false, radiusKm: 3, ...props } as never,
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}

const penalty = (changes: Partial<AreaPenaltyRecord> = {}): AreaPenaltyRecord => ({
  occurred_on: '2026-01-27', doc_no: '高市教幼字第11530761100號', law: '幼兒教育及照顧法第58條', content: '第17條第7項幼兒園未依規定配置廚工。',
  kind: 'fine', amount: 6000, period_start: null, period_end: null, punishment_text: null, subject: 'operator', recent: true, ...changes,
})
const records = (changes: Partial<AreaKindergartenRecords> = {}): AreaKindergartenRecords => ({
  source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', ...SYNCED, source_note: '資料來源：全國教保資訊網（裁罰經 kiang 整理）',
  penalties: [penalty()], evaluations: [{ school_year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' }], ...changes,
})

describe('格式函式', () => {
  it('裁罰標籤：匯入後近 3 年 N 件（N=0 不顯示）、只有 3 年前的寫淡色標籤；還沒匯入沿用名單旗標', () => {
    const base = kindergarten()
    expect(penaltyBadge({ ...base, penalties_recent: 3 }, true)).toEqual({ text: '近 3 年裁罰 3 件', tone: 'recent' })
    expect(penaltyBadge({ ...base, penalties_recent: 0, has_older_penalty: true }, true)).toEqual({ text: '3 年前有裁罰', tone: 'older' })
    expect(penaltyBadge({ ...base, penalties_recent: 2, has_older_penalty: true }, true)?.text).toBe('近 3 年裁罰 2 件')
    expect(penaltyBadge({ ...base, has_penalty: true }, true)).toBeNull() // 匯入後以明細為準，名單旗標不再顯示
    expect(penaltyBadge(base, true)).toBeNull()
    expect(penaltyBadge({ ...base, has_penalty: true }, false)).toEqual({ text: '有裁罰紀錄', tone: 'legacy' })
    expect(penaltyBadge(base, false)).toBeNull()
  })

  it('評鑑小字：學年度在前，「全數指標通過追蹤評鑑」改寫成「追蹤評鑑 全數指標通過」；其他句型原文照放', () => {
    expect(evaluationLine({ year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' })).toBe('112 學年 追蹤評鑑 全數指標通過')
    expect(evaluationLine({ year: 114, completed_on: null, result: '部分指標通過基礎評鑑' })).toBe('114 學年 基礎評鑑 部分指標通過')
    expect(evaluationLine({ year: 104, completed_on: '2020-03-18', result: '全數指標改善完畢' })).toBe('104 學年 全數指標改善完畢')
    expect(evaluationResultText('全數指標通過基礎評鑑')).toBe('基礎評鑑 全數指標通過')
    expect(evaluationLine(null)).toBe('')
    expect(evaluationLine(undefined)).toBe('')
  })

  it('處分：罰鍰寫金額、三種期間處分寫起迄、其他寫原文；對象只有類別，沒有人名', () => {
    expect(punishmentText(penalty())).toBe('罰鍰 6,000 元')
    expect(punishmentText(penalty({ amount: null }))).toBe('罰鍰')
    expect(punishmentText(penalty({ kind: 'stop_enrollment', amount: null, period_start: '2025-04-01', period_end: '2025-06-30' }))).toBe('停止招生 2025/04/01–2025/06/30')
    expect(punishmentText(penalty({ kind: 'reduce_enrollment', amount: null, period_start: '2022-08-01', period_end: '2023-05-31' }))).toBe('減少招收人數 2022/08/01–2023/05/31')
    expect(punishmentText(penalty({ kind: 'closure', amount: null, period_start: null, period_end: null }))).toBe('停辦')
    expect(punishmentText(penalty({ kind: 'other', amount: null, punishment_text: '警告' }))).toBe('警告')
    expect(punishmentText(penalty({ kind: 'other', amount: null, punishment_text: null }))).toBe('其他處分')
    expect(subjectText('operator')).toBe('園方受罰')
    expect(subjectText('staff')).toBe('教保人員個人受罰')
    expect(subjectText(null)).toBe('—')
    expect(slashDate('2026-01-27')).toBe('2026/01/27')
    expect(slashDate(null)).toBe('—')
  })
})

describe('清單列', () => {
  const data = () =>
    areaKindergartens(
      [
        kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, is_own: true, penalties_recent: 2, penalty_latest_on: '2026-01-27', has_older_penalty: true, evaluation_latest: { year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' } }),
        kindergarten({ source_id: 'kg-old', name: '高雄市私立大樹幼兒園', distance_m: 300, penalties_recent: 0, penalty_latest_on: '2021-05-02', has_older_penalty: true }),
        kindergarten({ source_id: 'kg-clean', name: '高雄市私立小草幼兒園', distance_m: 500 }),
        kindergarten({ source_id: 'kg-flag', name: '高雄市私立舊旗標幼兒園', distance_m: 700, has_penalty: true }),
      ],
      SYNCED,
    )

  it('近 3 年裁罰（紅）、3 年前有裁罰（淡色）、沒有就不顯示；匯入後名單上的旗標不再顯示', () => {
    const wrapper = mountList({ data: data() })
    const rows = wrapper.findAll('.nearby__row')
    const tag = (index: number) => rows[index]!.findAll('.el-tag').map((item) => ({ text: item.text(), danger: item.classes('el-tag--danger'), info: item.classes('el-tag--info') }))
    expect(tag(0)).toContainEqual({ text: '近 3 年裁罰 2 件', danger: true, info: false })
    expect(tag(1)).toContainEqual({ text: '3 年前有裁罰', danger: false, info: true })
    expect(tag(2).map((item) => item.text)).toEqual(['私立'])
    expect(tag(3).map((item) => item.text)).toEqual(['私立'])
    expect(rows[0]!.text()).not.toContain('有裁罰紀錄')
  })

  it('最近一次評鑑小字；沒有評鑑就沒有這一行', () => {
    const wrapper = mountList({ data: data() })
    const lines = wrapper.findAll('.nearby__row').map((row) => row.find('.nearby__eval').exists() ? row.get('.nearby__eval').text() : null)
    expect(lines).toEqual(['112 學年 追蹤評鑑 全數指標通過', null, null, null])
  })

  it('裁罰明細還沒匯入：沿用名單上的「有裁罰紀錄」，沒有說明文字', () => {
    const wrapper = mountList({ data: areaKindergartens([kindergarten({ has_penalty: true })]) })
    expect(wrapper.get('.nearby__row').text()).toContain('有裁罰紀錄')
    expect(wrapper.text()).not.toContain(RECORDS_NOTE)
  })

  it('說明文字（C13）：匯入過任一種就顯示，且不出現人名', () => {
    const wrapper = mountList({ data: data() })
    expect(wrapper.text()).toContain('裁罰與評鑑是全國教保資訊網公開資料（裁罰經 kiang 整理）。裁罰對象為教保人員個人時，不代表園方受罰；人名一律不顯示。')
    const onlyEvaluations = mountList({ data: areaKindergartens([kindergarten()], { evaluations_synced_at: '2026-10-20T03:10:00Z' }) })
    expect(onlyEvaluations.text()).toContain(RECORDS_NOTE)
  })
})

describe('展開讀明細', () => {
  const list = () =>
    areaKindergartens(
      [
        kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, is_own: true, penalties_recent: 1, penalty_latest_on: '2026-01-27', evaluation_latest: { year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' } }),
        kindergarten({ source_id: 'kg-clean', name: '高雄市私立小草幼兒園', distance_m: 500 }),
      ],
      SYNCED,
    )

  it('展開才讀：帶校區與 source_id；列出裁罰（日期、處分、對象類別、違規內容）與評鑑（學年度、完成日、結果）', async () => {
    const get = mockGet({ [RECORDS_PATH]: records({
      penalties: [
        penalty({ subject: 'staff', occurred_on: '2026-01-27' }),
        penalty({ occurred_on: '2025-03-10', kind: 'stop_enrollment', amount: null, period_start: '2025-04-01', period_end: '2025-06-30', content: '第43條第3項-費用超收' }),
        penalty({ occurred_on: '2021-05-02', recent: false, content: '第38條第2項' }),
      ],
      evaluations: [
        { school_year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' },
        { school_year: 107, completed_on: null, result: '全數指標通過基礎評鑑' },
      ],
    }) })
    const wrapper = mountList({ data: list() })
    expect(pathsTo(get, RECORDS_PATH)).toEqual([])
    await wrapper.findAll('.nearby__row')[0]!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, RECORDS_PATH)).toEqual([`${RECORDS_PATH}kg-own/records?campus_key=yihua`])
    const items = wrapper.findAll('.records__item')
    expect(items).toHaveLength(5)
    expect(items[0]!.text()).toContain('2026/01/27')
    expect(items[0]!.text()).toContain('罰鍰 6,000 元')
    expect(items[0]!.text()).toContain('教保人員個人受罰')
    expect(items[0]!.text()).toContain('第17條第7項幼兒園未依規定配置廚工。')
    expect(items[1]!.text()).toContain('停止招生 2025/04/01–2025/06/30')
    expect(items[1]!.text()).toContain('園方受罰')
    expect(items[0]!.classes('is-old')).toBe(false)
    expect(items[2]!.classes('is-old')).toBe(true) // 3 年前的用淡色
    expect(items[3]!.text()).toContain('112 學年')
    expect(items[3]!.text()).toContain('2025/05/16')
    expect(items[3]!.text()).toContain('全數指標通過追蹤評鑑')
    expect(items[4]!.text()).toContain('107 學年')
    expect(items[4]!.text()).toContain('—')
    expect(wrapper.text()).not.toMatch(/負責人|行為人/)
  })

  it('讀取中顯示骨架；失敗可重試', async () => {
    const pending = deferred<AreaKindergartenRecords>()
    let calls = 0
    mockGet({ [RECORDS_PATH]: () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return calls === 2 ? pending.promise : records()
    } })
    const wrapper = mountList({ data: list() })
    await wrapper.findAll('.nearby__row')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.records').text()).toContain('無法讀取裁罰與評鑑。')
    expect(wrapper.findAll('.records .el-alert')).toHaveLength(1) // 提示只出現一次
    await button(wrapper, '重新載入')!.trigger('click')
    expect(wrapper.find('.records .el-skeleton').exists()).toBe(true)
    pending.resolve(records())
    await flushPromises()
    expect(wrapper.find('.records .el-skeleton').exists()).toBe(false)
    expect(wrapper.findAll('.records__item')).toHaveLength(2)
  })

  it('摘要說沒有裁罰也沒有評鑑：不打 API，兩邊都寫「無公開紀錄」', async () => {
    const get = mockGet({ [RECORDS_PATH]: records() })
    const wrapper = mountList({ data: list() })
    await wrapper.findAll('.nearby__row')[1]!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, RECORDS_PATH)).toEqual([])
    const sections = wrapper.findAll('.records__section').map((section) => section.text().replace(/\s+/g, ' '))
    expect(sections).toEqual([`裁罰${NO_RECORDS}`, `評鑑${NO_RECORDS}`])
  })

  it('只有一邊有紀錄：另一邊寫「無公開紀錄」', async () => {
    mockGet({ [RECORDS_PATH]: records({ evaluations: [] }) })
    const wrapper = mountList({ data: list() })
    await wrapper.findAll('.nearby__row')[0]!.trigger('click')
    await flushPromises()
    const [penalties, evaluations] = wrapper.findAll('.records__section')
    expect(penalties!.findAll('.records__item')).toHaveLength(1)
    expect(evaluations!.text()).toContain(NO_RECORDS)
  })

  it('其中一種資料還沒匯入：那一邊寫「尚未匯入」，不是「無公開紀錄」，也不為它讀明細', async () => {
    const get = mockGet({ [RECORDS_PATH]: records() })
    const data = areaKindergartens(
      [kindergarten({ source_id: 'kg-own', is_own: true, evaluation_latest: { year: 112, completed_on: '2025-05-16', result: '全數指標通過追蹤評鑑' } })],
      { penalties_synced_at: null, evaluations_synced_at: '2026-10-20T03:10:00Z' },
    )
    const wrapper = mountList({ data })
    await wrapper.get('.nearby__row').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.records__section')[0]!.text()).toContain('裁罰資料尚未匯入。')
    expect(wrapper.findAll('.records__section')[1]!.findAll('.records__item')).toHaveLength(1)
    expect(pathsTo(get, RECORDS_PATH)).toHaveLength(1)
  })

  it('兩種都沒匯入：不放明細區塊也不讀', async () => {
    const get = mockGet({ [RECORDS_PATH]: records() })
    const wrapper = mountList({ data: areaKindergartens([kindergarten({ source_id: 'kg-own' })]) })
    await wrapper.get('.nearby__row').trigger('click')
    await flushPromises()
    expect(wrapper.find('.records').exists()).toBe(false)
    expect(pathsTo(get, RECORDS_PATH)).toEqual([])
  })

  it('收合就不顯示；換資料（半徑、校區變了）收回展開', async () => {
    mockGet({ [RECORDS_PATH]: records() })
    const wrapper = mountList({ data: list() })
    const row = wrapper.findAll('.nearby__row')[0]!
    await row.trigger('click')
    await flushPromises()
    expect(wrapper.find('.records').exists()).toBe(true)
    await row.trigger('click')
    expect(wrapper.find('.records').exists()).toBe(false)
    await row.trigger('click')
    await flushPromises()
    await wrapper.setProps({ data: areaKindergartens(list().items, { ...SYNCED, radius_km: 6 }) })
    expect(wrapper.find('.records').exists()).toBe(false)
  })
})
