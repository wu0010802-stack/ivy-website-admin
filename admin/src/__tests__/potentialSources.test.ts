// 招生潛力：每年還能多招的三個來源（2026-10-20 第二、三波）：來源表三種列狀態、區間條、
// 「怎麼算」展開後的參數與逐年／逐里／逐案小表。
import { afterEach, describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import PotentialSources from '../components/admissions/potential/PotentialSources.vue'
import { cleanup, closureSource, mountWith, noDataSources, presaleSource, villageSource } from './admissionsTestKit'

afterEach(cleanup)

async function mountSources(sources = [closureSource(), villageSource(), presaleSource()]) {
  return mountWith(PotentialSources, { props: { sources } })
}
const rowOf = (wrapper: VueWrapper, key: string) => wrapper.get(`tbody[data-source="${key}"] .source__row`)
const cells = (wrapper: VueWrapper, selector: string) => wrapper.findAll(`${selector} tbody tr`).map((row) => row.findAll('th, td').map((cell) => cell.text()))
const barOf = (wrapper: VueWrapper, key: string) => {
  const bar = rowOf(wrapper, key).get('.source__bar')
  const percent = (selector: string, property: 'left' | 'width') => Number.parseFloat((bar.get(selector).element as HTMLElement).style[property])
  return { bar, left: percent('.source__span', 'left'), width: percent('.source__span', 'width'), mid: percent('.source__mid-mark', 'left') }
}

describe('來源表：有數字的列', () => {
  it('三列依序是停辦、里、新建案；名稱與低／中／高都是整數', async () => {
    const { wrapper } = await mountSources()
    expect(wrapper.findAll('tbody[data-source]').map((body) => body.attributes('data-source'))).toEqual(['closures', 'villages', 'presale'])
    expect(wrapper.findAll('.source__row').map((row) => row.findAll('th, td').slice(0, 4).map((cell) => cell.text()))).toEqual([
      ['附近園所停辦釋出', '4', '9', '15'],
      ['現有的里還沒招到', '1', '3', '6'],
      ['新建案搬進來', '1', '1', '3'],
    ])
  })

  it('表頭：來源、每年可多招（低／中／高）、區間', async () => {
    const { wrapper } = await mountSources()
    expect(wrapper.findAll('.source-table > thead tr').map((row) => row.findAll('th').map((cell) => cell.text()))).toEqual([
      ['來源', '每年可多招（位）', '區間'],
      ['低', '中', '高'],
    ])
  })

  it('每格都有欄名（手機版把表格排成一列一張卡時用）', async () => {
    const { wrapper } = await mountSources()
    expect(rowOf(wrapper, 'villages').findAll('td').map((cell) => cell.attributes('data-label'))).toEqual(['低', '中', '高', '區間'])
  })

  it('區間條：刻度上限是三個來源最大的 high（14.8）；low–high 一段、mid 一條線', async () => {
    const { wrapper } = await mountSources()
    const closures = barOf(wrapper, 'closures')
    expect(closures.left).toBeCloseTo((3.9 / 14.8) * 100, 1)
    expect(closures.width).toBeCloseTo(((14.8 - 3.9) / 14.8) * 100, 1)
    expect(closures.mid).toBeCloseTo((8.6 / 14.8) * 100, 1)
    const presale = barOf(wrapper, 'presale')
    expect(presale.left).toBeCloseTo((0.6 / 14.8) * 100, 1)
    expect(presale.mid).toBeCloseTo((1.4 / 14.8) * 100, 1)
    expect(closures.bar.attributes('role')).toBe('img')
    expect(closures.bar.attributes('aria-label')).toBe('附近園所停辦釋出：約 9 位，4～15 位')
  })

  it('三個來源的 high 都是 0：區間條不除以 0，也不出現 NaN', async () => {
    const zero = { low: 0, mid: 0, high: 0 }
    const { wrapper } = await mountSources([closureSource(zero), villageSource(zero), presaleSource(zero)])
    expect(wrapper.html()).not.toContain('NaN')
    expect(barOf(wrapper, 'closures').width).toBe(0)
  })
})

describe('來源表：沒有資料的列', () => {
  it('寫「沒有資料」加 API 給的原因；沒有數字也沒有區間條', async () => {
    const { wrapper } = await mountSources(noDataSources())
    expect(wrapper.findAll('.source__row').map((row) => row.findAll('th, td').map((cell) => cell.text()))).toEqual([
      ['附近園所停辦釋出', '沒有資料（沒有停辦紀錄）'],
      ['現有的里還沒招到', '沒有資料（沒有在籍清冊）'],
      ['新建案搬進來', '沒有資料（沒有預售資料）'],
    ])
    expect(wrapper.find('.source__bar').exists()).toBe(false)
  })

  it('原因直接用 API 的字串，不另寫', async () => {
    const [closures, villages, presale] = noDataSources()
    const { wrapper } = await mountSources([closures!, { ...villages!, reason: '附近有孩子的里太少' }, presale!])
    expect(rowOf(wrapper, 'villages').text()).toContain('沒有資料（附近有孩子的里太少）')
  })

  it('有的有、有的沒有：沒有資料的列不影響刻度', async () => {
    const [closures] = noDataSources()
    const { wrapper } = await mountSources([closures!, villageSource(), presaleSource()])
    expect(rowOf(wrapper, 'closures').text()).toContain('沒有資料')
    expect(barOf(wrapper, 'villages').mid).toBeCloseTo((3.4 / 6.1) * 100, 1)
  })

  it('沒有資料的列也能展開「怎麼算」看參數，沒有小表', async () => {
    const { wrapper } = await mountSources(noDataSources())
    const how = wrapper.get('tbody[data-source="villages"] .source__how')
    expect(how.find('details').attributes('open')).toBeUndefined()
    expect(how.text()).toContain('每年新生')
    expect(how.find('table').exists()).toBe(false)
  })
})

describe('怎麼算', () => {
  it('每列一個，預設收起，摘要是「怎麼算」', async () => {
    const { wrapper } = await mountSources()
    const details = wrapper.findAll('.source__how details')
    expect(details).toHaveLength(3)
    expect(details.every((item) => item.attributes('open') === undefined)).toBe(true)
    expect(details.map((item) => item.get('summary').text())).toEqual(['怎麼算', '怎麼算', '怎麼算'])
  })

  it('參數照列 assumptions（名稱：內容）', async () => {
    const { wrapper } = await mountSources()
    const items = wrapper.findAll('tbody[data-source="closures"] .source__assumptions > div').map((item) => [item.get('dt').text(), item.get('dd').text()])
    expect(items).toEqual([
      ['承接率', '中 13.8%、高 17.3%（童年綠地、愛爾蘭回測）'],
      ['實收率', '0.67（全市 114 學年核定與幼生比）'],
      ['沒有計入', '園所是否連鎖（類型係數）與老師帶班：公開資料看不出來，也無法預期'],
      ['核定名額沒填', '1 所（算不出來，略過）'],
    ])
  })

  it('停辦：各學年窗口的值與事件清單（日期、園名、核定、距離 km）', async () => {
    const { wrapper } = await mountSources()
    expect(cells(wrapper, '.source__years')).toEqual([
      ['2022 年 10 月～2023 年 9 月', '1', '7.4'],
      ['2023 年 10 月～2024 年 9 月', '2', '9.8'],
    ])
    expect(cells(wrapper, '.source__events')).toEqual([
      ['2023-07-31', '高雄市私立甲幼兒園', '60', '0.9 km', '7.4'],
      ['2024-08-10', '高雄市私立乙幼兒園', '90', '1.5 km', '6.1'],
      ['2024-09-30', '高雄市私立丙幼兒園', '45', '2.1 km', '3.7'],
    ])
    expect(wrapper.findAll('.source__years thead th, .source__events thead th').map((cell) => cell.text())).toEqual([
      '統計窗口', '所數', '每年可多招（位）', '日期', '園名', '核定', '距離', '每年可多招（位）',
    ])
  })

  it('現有的里：距離帶表（里數、孩子數、在籍、照附近應有、缺口）', async () => {
    const { wrapper } = await mountSources()
    expect(cells(wrapper, '.source__bands')).toEqual([
      ['0–1 km', '6', '1,300', '60', '48.2', '12.4'],
      ['1–2 km', '10', '3,500', '80', '90.5', '3.1'],
      ['2–3 km', '12', '5,000', '40', '60.0', '20.0'],
    ])
  })

  it('距離帶的在籍是 null（里太少，不給彙總）：只顯示里數與孩子數，其餘「—」', async () => {
    const bands = villageSource().details.bands.map((band) => ({ ...band, enrolled: null, expected: null, gap: null }))
    const { wrapper } = await mountSources([closureSource(), villageSource({ details: { bands, model: null } }), presaleSource()])
    expect(cells(wrapper, '.source__bands')[0]).toEqual(['0–1 km', '6', '1,300', '—', '—', '—'])
  })

  it('新建案：案名、戶數、預計交屋、距離、每年可多招；已過預計時間寫「已過預計時間（尚未登記）」', async () => {
    const { wrapper } = await mountSources()
    expect(cells(wrapper, '.source__deliveries')).toEqual([
      ['某某大院', '240', '已過預計時間（尚未登記）', '0.6 km', '0.9'],
      ['某某花園', '180', '約 2027 下半年', '1.2 km', '0.5'],
    ])
  })

  it('每案 mid 是 null（距離帶被隱藏）：該欄「—」', async () => {
    const deliveries = presaleSource().details.deliveries.map((delivery) => ({ ...delivery, mid: null }))
    const { wrapper } = await mountSources([closureSource(), villageSource(), presaleSource({ details: { deliveries } })])
    expect(cells(wrapper, '.source__deliveries').map((row) => row.at(-1))).toEqual(['—', '—'])
  })

  it('來源 ok 但沒有事件／案子（0 位）：不畫空的小表', async () => {
    const empty = { low: 0, mid: 0, high: 0 }
    const { wrapper } = await mountSources([
      closureSource({ ...empty, details: { years: [], skipped: { no_capacity: 0, outside_windows: 0 }, price_unknown: 0, events: [] } }),
      villageSource(),
      presaleSource({ ...empty, details: { deliveries: [] } }),
    ])
    expect(wrapper.find('.source__years').exists()).toBe(false)
    expect(wrapper.find('.source__events').exists()).toBe(false)
    expect(wrapper.find('.source__deliveries').exists()).toBe(false)
    expect(wrapper.find('.source__bands').exists()).toBe(true)
  })

  it('沒有參數也沒有小表就不放「怎麼算」', async () => {
    const [closures, villages, presale] = noDataSources()
    const { wrapper } = await mountSources([{ ...closures!, assumptions: [] }, villages!, presale!])
    expect(wrapper.find('tbody[data-source="closures"] .source__how').exists()).toBe(false)
    expect(wrapper.find('tbody[data-source="villages"] .source__how').exists()).toBe(true)
  })
})
