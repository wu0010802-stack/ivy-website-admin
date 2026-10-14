// 附近托嬰中心、附近園所的變化、名單種類切換（2026-10-14 規格 7.1、7.3）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import NearbyBabycare from '../components/admissions/area/NearbyBabycare.vue'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import NearbyPanel from '../components/admissions/area/NearbyPanel.vue'
import ProviderChanges from '../components/admissions/area/ProviderChanges.vue'
import { areaBabycare, areaChanges, areaKindergartens, areaStats, babycareItem, providerChange } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.useRealTimers()
})
function mountIt(component: unknown, props: Record<string, unknown>): VueWrapper {
  const wrapper = mount(component as never, { props, attachTo: document.body, global: { plugins: [ElementPlus] } } as never)
  wrappers.push(wrapper)
  return wrapper
}

const babycareProps = (changes: Record<string, unknown> = {}) => ({ data: areaBabycare(), failed: false, radiusKm: 3, ...changes })

describe('附近托嬰中心', () => {
  it('標題、總結與清單：簡稱、類型標籤、距離・核定・實際收托；未知寫「—」不寫 0', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    expect(wrapper.get('.nearby__title').text()).toBe('附近托嬰中心')
    expect(wrapper.get('.nearby__summary').text()).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(wrapper.findAll('.nearby__name').map((name) => name.text())).toEqual(['三民公共托嬰中心', '小星星托嬰中心', '鳥松社區公共托育家園'])
    expect(wrapper.findAll('.nearby__line .el-tag').map((tag) => tag.text())).toEqual(['托嬰中心', '托嬰中心', '托育家園'])
    expect(wrapper.findAll('.nearby__meta').map((meta) => meta.text())).toEqual([
      '165 m・核定 52 人・實際收托 52 人',
      '520 m・核定 40 人・實際收托 32 人',
      '1.3 km・核定 — 人・實際收托 — 人',
    ])
    expect(wrapper.get('.nearby__source').text()).toBe('資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料・10/14 更新')
  })

  it('點一列：展開地址與電話並請地圖定位；再點一次只收合、不再定位；沒有電話就不列', async () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    const rows = wrapper.findAll('.nearby__row')
    await rows[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['bc-center']])
    expect(rows[1]!.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.nearby__detail').text()).toContain('高雄市三民區義華路20號')
    expect(wrapper.get('.nearby__detail').text()).toContain('07-3801000')
    await rows[1]!.trigger('click')
    expect(wrapper.find('.nearby__detail').exists()).toBe(false)
    expect(wrapper.emitted('select')).toHaveLength(1)
    await rows[2]!.trigger('click')
    expect(wrapper.get('.nearby__detail').text()).not.toContain('電話')
  })

  it('一次列 20 所，「顯示更多」展開其餘', async () => {
    const items = Array.from({ length: 25 }, (_, index) => babycareItem({ source_id: `bc-${index}`, name: `高雄市私立第${index}托嬰中心`, distance_m: 100 + index }))
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare(items) }))
    expect(wrapper.findAll('.nearby__item')).toHaveLength(20)
    await wrapper.findAll('button').find((button) => button.text().startsWith('顯示更多'))!.trigger('click')
    expect(wrapper.findAll('.nearby__item')).toHaveLength(25)
  })

  it('換半徑交給外面（update:radiusKm）；只收 1、3、6', async () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 6)
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 4)
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6]])
  })

  it('半徑內沒有托嬰中心：總結寫沒有，不列清單', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([]), radiusKm: 1 }))
    expect(wrapper.get('.nearby__summary').text()).toBe('1 公里內沒有托嬰中心。')
    expect(wrapper.find('.nearby__list').exists()).toBe(false)
  })

  it('讀取中是骨架；讀取失敗寫錯誤並可重試', async () => {
    expect(mountIt(NearbyBabycare, babycareProps({ data: null })).find('.el-skeleton').exists()).toBe(true)
    const failed = mountIt(NearbyBabycare, babycareProps({ data: null, failed: true }))
    expect(failed.text()).toContain('無法讀取附近托嬰中心。')
    await failed.findAll('button').find((button) => button.text() === '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('名單從未匯入：寫「尚未匯入」，不寫成附近沒有', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([], { synced_at: null }) }))
    expect(wrapper.get('.nearby__empty').text()).toBe('托嬰名單尚未匯入。')
    expect(wrapper.find('.nearby__summary').exists()).toBe(false)
  })

  it('本校沒有座標：寫原因', () => {
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'pending' }
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([], { campus }) }))
    expect(wrapper.get('.nearby__empty').text()).toBe('門牌資料尚未匯入，無法列出附近托嬰中心。')
  })
})

describe('附近園所的變化', () => {
  const changesProps = (changes: Record<string, unknown> = {}) => ({ data: areaChanges(), failed: false, radiusKm: 3, ...changes })

  it('標題、副標，與每列：日期依據、種類、對象、名稱、距離；類型變動多寫新舊類型', () => {
    const wrapper = mountIt(ProviderChanges, changesProps())
    expect(wrapper.get('.changes__title').text()).toBe('附近園所的變化')
    expect(wrapper.get('.changes__head .hint').text()).toBe('近 12 個月・3 公里內')
    const rows = wrapper.findAll('.changes__item').map((row) => ({
      when: row.get('.changes__when').text(),
      tags: row.findAll('.el-tag').map((tag) => tag.text()),
      name: row.get('.changes__name').text(),
      meta: row.get('.changes__meta').text(),
    }))
    expect(rows).toEqual([
      { when: '2026/10 起不在名單', tags: ['停辦', '托嬰'], name: '頂尖小子托嬰中心', meta: '435 m' },
      { when: '2026/10 起', tags: ['類型變動', '幼兒園'], name: '保羅幼兒園', meta: '513 m・私立 → 準公共' },
      { when: '設立日 2026/09', tags: ['新設', '幼兒園'], name: '三多哈波特幼兒園', meta: '780 m' },
    ])
  })

  it('沒有任何變化：寫沒有；基準日不到 12 個月前，底下小字說從哪天起記錄', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14))
    const wrapper = mountIt(ProviderChanges, changesProps({ data: areaChanges([]) }))
    expect(wrapper.get('.changes__empty').text()).toBe('近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。')
    expect(wrapper.get('.changes__note').text()).toBe('停辦與類型變動從 10 月 14 日起記錄；新設的幼兒園以設立日為準。')
  })

  it('還沒開始記錄：小字寫「尚未開始記錄。」；基準日已滿 12 個月：不寫小字', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14))
    const never = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { tracking_since: { kindergarten: null, babycare: null } }) }))
    expect(never.get('.changes__note').text()).toBe('尚未開始記錄。')
    const old = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { tracking_since: { kindergarten: '2025-01-01', babycare: '2025-01-01' } }) }))
    expect(old.find('.changes__note').exists()).toBe(false)
  })

  it('跟著半徑與 API 的視窗月數寫副標', () => {
    const wrapper = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { radius_km: 6, window_months: 12 }), radiusKm: 6 }))
    expect(wrapper.get('.changes__head .hint').text()).toBe('近 12 個月・6 公里內')
  })

  it('讀取中是骨架；讀取失敗寫錯誤並可重試；本校沒座標寫原因', async () => {
    expect(mountIt(ProviderChanges, changesProps({ data: null })).find('.el-skeleton').exists()).toBe(true)
    const failed = mountIt(ProviderChanges, changesProps({ data: null, failed: true }))
    expect(failed.text()).toContain('無法讀取附近園所的變化。')
    await failed.findAll('button').find((button) => button.text() === '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_address' }
    const unlocated = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { campus }) }))
    expect(unlocated.get('.changes__empty').text()).toBe('找不到本校地址，無法列出附近園所的變化。')
  })

  it('同一所同一天的兩種變化各自成列（key 不重複）', () => {
    const items = [providerChange({ change: 'opened' }), providerChange({ change: 'kind_changed', old_kind: 'private', new_kind: 'quasi_public' })]
    expect(mountIt(ProviderChanges, changesProps({ data: areaChanges(items) })).findAll('.changes__item')).toHaveLength(2)
  })
})

describe('名單種類切換', () => {
  const panelProps = (changes: Record<string, unknown> = {}) => ({
    kind: 'kindergarten', radiusKm: 3, kindergartens: areaKindergartens(), kindergartensFailed: false,
    babycare: areaBabycare(), babycareFailed: false, ...changes,
  })

  it('預設是幼兒園清單；切換鈕有名稱、幼兒園在前', () => {
    const wrapper = mountIt(NearbyPanel, panelProps())
    expect(wrapper.findComponent(NearbyKindergartens).exists()).toBe(true)
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(false)
    expect(wrapper.find('[aria-label="名單種類"]').exists()).toBe(true)
    expect(wrapper.findAll('.nearby-panel .el-radio-button').slice(0, 2).map((button) => button.text())).toEqual(['幼兒園', '托嬰中心'])
  })

  it('kind 是托嬰中心時顯示托嬰清單；切換只回報、不自己改', async () => {
    const wrapper = mountIt(NearbyPanel, panelProps({ kind: 'babycare' }))
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(true)
    expect(wrapper.findComponent(NearbyKindergartens).exists()).toBe(false)
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'kindergarten')
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'other')
    await flushPromises()
    expect(wrapper.emitted('update:kind')).toEqual([['kindergarten']])
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(true)
  })

  it('兩份清單的半徑、選取、重試都轉送出去', () => {
    const kindergarten = mountIt(NearbyPanel, panelProps())
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('select', 'kg-public')
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('retry')
    expect(kindergarten.emitted('update:radiusKm')).toEqual([[6]])
    expect(kindergarten.emitted('select-kindergarten')).toEqual([['kg-public']])
    expect(kindergarten.emitted('retry-kindergartens')).toHaveLength(1)
    const babycare = mountIt(NearbyPanel, panelProps({ kind: 'babycare' }))
    babycare.findComponent(NearbyBabycare).vm.$emit('update:radiusKm', 1)
    babycare.findComponent(NearbyBabycare).vm.$emit('select', 'bc-center')
    babycare.findComponent(NearbyBabycare).vm.$emit('retry')
    expect(babycare.emitted('update:radiusKm')).toEqual([[1]])
    expect(babycare.emitted('select-babycare')).toEqual([['bc-center']])
    expect(babycare.emitted('retry-babycare')).toHaveLength(1)
  })
})
