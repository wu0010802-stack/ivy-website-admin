import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PointCard from '../components/admissions/area/PointCard.vue'
import { point } from './pointTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  document.body.innerHTML = ''
})
function mountCard(props: Record<string, unknown>) {
  const wrapper = mount(PointCard as never, {
    props: { data: point(), loading: false, failed: false, campusName: '義華', radiusKm: 3, ...props },
    attachTo: document.body, global: { plugins: [ElementPlus] },
  } as never)
  wrappers.push(wrapper as never)
  return wrapper
}

describe('PointCard', () => {
  it('標題、副標、兩欄與來源', () => {
    const wrapper = mountCard({})
    expect(wrapper.find('h2').text()).toBe('這一點 3 公里內')
    expect(wrapper.text()).toContain('三民區寶興里・最近的校區 義華 1.8 公里')
    expect(wrapper.text()).toContain('義華 40・明華 3')
    expect(wrapper.text()).toContain('人口 115-10・收費 114 學年・實價 115S3（近 4 季）')
    expect(wrapper.findAll('thead th').map((th) => th.text())).toContain('義華')
  })

  it('房價不到 5 筆顯示「—（3 筆）」', () => {
    const data = point({ housing: { sale_median: null, sale_count: 3, rent_median: 18500, rent_count: 9 } })
    expect(mountCard({ data }).text()).toContain('—（3 筆）')
  })

  it('本校沒座標：欄頭有原因', () => {
    const data = point({}, { unavailable: 'no_campus_point', locate_error: 'no_address', enrolled: [] })
    expect(mountCard({ data }).text()).toContain('義華（位置未標示：找不到本校地址）')
  })

  it('這一點那一欄算失敗：欄頭註明「讀取失敗」', () => {
    const data = point({ unavailable: 'error', enrolled: [] })
    expect(mountCard({ data }).findAll('thead th').map((th) => th.text())).toContain('這一點（讀取失敗）')
    expect(mountCard({}).findAll('thead th').map((th) => th.text())).toContain('這一點')
  })

  it('讀取中畫骨架', () => {
    const wrapper = mountCard({ data: null, loading: true })
    expect(wrapper.find('.el-skeleton').exists()).toBe(true)
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('失敗顯示原因與重試，按下 emit retry；清除 emit clear', async () => {
    const wrapper = mountCard({ data: null, failed: true })
    expect(wrapper.text()).toContain('讀不到這一點的資料')
    const retry = wrapper.findAll('button').find((button) => button.text() === '重試')!
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    await wrapper.findAll('button').find((button) => button.text() === '清除')!.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('focusTitle 把焦點移到標題', () => {
    const wrapper = mountCard({})
    ;(wrapper.vm as unknown as { focusTitle: () => void }).focusTitle()
    expect(document.activeElement?.tagName).toBe('H2')
  })

  it('沒有卡片層級的 Esc 關閉（Esc 只屬於放點狀態）；表頭的螢幕閱讀文字用全域 visually-hidden', async () => {
    const wrapper = mountCard({})
    await wrapper.get('.point-card').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('clear')).toBeUndefined()
    expect(wrapper.get('thead th .visually-hidden').text()).toBe('項目')
    expect(wrapper.find('.point-card__sr').exists()).toBe(false)
  })
})
