import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'
import { PANE_META } from '../components/analytics/metaContext'

// 每張卡的註腳：沒有所在分頁的 context（成效統計等其他頁面）照舊全寫；在「預約成效」分頁裡期間與更新時間已寫在頂端，只留單位。
const props = { period: '開站至今', unit: '事件次數', asOf: '2026-10-03T06:05:00Z', coverage: '含停用校區' }
const mountMeta = (pane?: string) =>
  mount(AnalyticsMeta, { props, global: pane === undefined ? {} : { provide: { [PANE_META as symbol]: { period: computed(() => pane) } } } })
const parts = (wrapper: ReturnType<typeof mountMeta>) => wrapper.findAll('span').map((item) => item.text())

describe('AnalyticsMeta', () => {
  it('沒有 PANE_META（其他頁面）：期間、單位、更新時間、涵蓋範圍全寫', () => {
    expect(parts(mountMeta())).toEqual(['期間 開站至今', '單位：事件次數', '更新 10/03 14:05', '含停用校區'])
  })

  it('在分頁裡且期間和分頁頂端相同：不寫期間、不寫更新，只留單位與涵蓋範圍', () => {
    expect(parts(mountMeta('開站至今'))).toEqual(['單位：事件次數', '含停用校區'])
  })

  it('在分頁裡但期間和分頁頂端不同（例如每日變化寫實際起訖日）：期間照寫，更新時間仍不寫', () => {
    expect(parts(mountMeta('2026/09/01–2026/09/30'))).toEqual(['期間 開站至今', '單位：事件次數', '含停用校區'])
  })

  it('沒有更新時間也沒有涵蓋範圍時只有期間與單位', () => {
    const wrapper = mount(AnalyticsMeta, { props: { period: '近 7 天', unit: '人次' } })
    expect(parts(wrapper as never)).toEqual(['期間 近 7 天', '單位：人次'])
  })
})
