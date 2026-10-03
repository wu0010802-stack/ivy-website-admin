import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'
import DailyBars from '../components/analytics/DailyBars.vue'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0 })

function mountBars(props: Record<string, unknown>) {
  const wrapper = mount(DailyBars, { props: { title: '每日瀏覽', unit: '次', points: [], ...props }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('每日直條', () => {
  const points = [{ day: '2026-09-28', value: 2 }, { day: '2026-09-29', value: 0 }, { day: '2026-09-30', value: 4 }]

  it('每天一根，高度以最多的那天為 100%；數字寫在每日數字表（新到舊）', () => {
    const wrapper = mountBars({ points })
    const fills = wrapper.findAll('.daily-bars__fill').map((fill) => fill.attributes('style'))
    expect(fills).toEqual(['height: 50%;', 'height: 0%;', 'height: 100%;'])
    const rows = wrapper.findAll('.daily-bars__table tbody tr').map((row) => row.text())
    expect(rows[0]).toContain('09/30')
    expect(rows[0]).toContain('4')
    expect(rows).toHaveLength(3)
  })

  it('讀屏摘要寫期間、合計與最多的那天', () => {
    const label = mountBars({ points }).find('.daily-bars__plot').attributes('aria-label')
    expect(label).toBe('每日瀏覽：09/28–09/30 共 6 次，最多是 09/30 的 4 次')
  })

  it('只畫期間內的口徑標記', () => {
    const wrapper = mountBars({
      points,
      markers: [{ day: '2026-09-30', label: '內頁也開始計入' }, { day: '2026-10-05', label: '不在期間內' }],
    })
    expect(wrapper.findAll('.daily-bars__col')[2]!.classes()).toContain('is-marked')
    expect(wrapper.text()).toContain('09/30 起：內頁也開始計入')
    expect(wrapper.text()).not.toContain('不在期間內')
  })

  it('沒有資料時寫出來，不畫空圖', () => {
    const wrapper = mountBars({ points: [] })
    expect(wrapper.text()).toContain('這段期間沒有資料。')
    expect(wrapper.find('.daily-bars__plot').exists()).toBe(false)
  })
})

describe('圖表說明列', () => {
  it('寫期間、單位、更新時間與涵蓋範圍', () => {
    const wrapper = mount(AnalyticsMeta, {
      props: { period: '2026/09/01–2026/09/30', unit: '預約案件數', asOf: '2026-10-03T06:05:00Z', coverage: '只算授權校區' },
    })
    wrappers.push(wrapper)
    const text = wrapper.text()
    expect(text).toContain('期間 2026/09/01–2026/09/30')
    expect(text).toContain('單位：預約案件數')
    expect(text).toContain('10/03 14:05')
    expect(text).toContain('只算授權校區')
  })
})
