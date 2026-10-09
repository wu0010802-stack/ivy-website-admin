// 附近幼兒園清單（2026-10-08 規格 9.4、9.5）。
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import source from '../components/admissions/area/NearbyKindergartens.vue?raw'
import { areaKindergartens, areaStats, button, kindergarten } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
})
function mountList(props: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(NearbyKindergartens, {
    props: { data: areaKindergartens(), failed: false, radiusKm: 3, ...props } as never,
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const names = (wrapper: VueWrapper) => wrapper.findAll('.nearby__name').map((item) => item.text())
const unlocated = (locate_error: string) =>
  areaKindergartens([], { campus: { ...areaStats().campus, lat: null, lng: null, locate_error } })

describe('附近幼兒園清單', () => {
  it('依後端順序列出：去掉「高雄市私立／市立」前綴、類型、距離、核定人數、月費（估）、裁罰、本機構', () => {
    const wrapper = mountList()
    expect(names(wrapper)).toEqual(['常春藤幼兒園', '大樹幼兒園', '小草幼兒園', '三民區小芽非營利幼兒園'])
    const rows = wrapper.findAll('.nearby__row').map((row) => row.text().replace(/\s+/g, ''))
    expect(rows[0]).toContain('本機構')
    expect(rows[0]).not.toContain('私立')
    expect(rows[1]).toContain('公立')
    expect(rows[1]).toContain('380m・核定90人・月費（估）2,500元')
    expect(rows[2]).toContain('準公共')
    expect(rows[2]).toContain('有裁罰紀錄')
    expect(rows[3]).toContain('1.8km・核定120人・月費（估）—')
    expect(wrapper.text()).toContain('資料來源：全國教保資訊網（kiang 整理），月費為估計值・10/08 更新')
  })

  it('搜尋名稱與地址；類型 chip 可複選，選了就不列本機構', async () => {
    const wrapper = mountList()
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('大樹')
    expect(names(wrapper)).toEqual(['大樹幼兒園'])
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('義華路')
    expect(names(wrapper)).toHaveLength(4)
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('')
    const chip = (label: string) => wrapper.findAll('.nearby__kind').find((item) => item.text() === label)!
    await chip('公立').trigger('click')
    expect(chip('公立').attributes('aria-pressed')).toBe('true')
    await chip('非營利').trigger('click')
    expect(names(wrapper)).toEqual(['大樹幼兒園', '三民區小芽非營利幼兒園'])
    await chip('公立').trigger('click')
    expect(names(wrapper)).toEqual(['三民區小芽非營利幼兒園'])
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('不存在')
    expect(wrapper.text()).toContain('沒有符合條件的幼兒園。')
  })

  it('本機構登記為私立，選「私立」chip 也不會把它當成競爭的私立園所列出來', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.nearby__kind').find((item) => item.text() === '私立')!.trigger('click')
    expect(names(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('沒有符合條件的幼兒園。')
  })

  it('先列 20 所，其餘按「顯示更多」；換資料（半徑變了）收回', async () => {
    const many = Array.from({ length: 25 }, (_, index) => kindergarten({ source_id: `kg-${index}`, name: `高雄市私立第${index}幼兒園` }))
    const wrapper = mountList({ data: areaKindergartens(many) })
    expect(names(wrapper)).toHaveLength(20)
    await button(wrapper, '顯示更多（還有 5 所）')!.trigger('click')
    expect(names(wrapper)).toHaveLength(25)
    expect(button(wrapper, '顯示更多（還有 5 所）')).toBeUndefined()
    await wrapper.setProps({ data: areaKindergartens(many, { radius_km: 6 }) })
    expect(names(wrapper)).toHaveLength(20)
  })

  it('剛好 20 所不出現「顯示更多」', () => {
    const exact = Array.from({ length: 20 }, (_, index) => kindergarten({ source_id: `kg-${index}`, name: `高雄市私立第${index}幼兒園` }))
    const wrapper = mountList({ data: areaKindergartens(exact) })
    expect(names(wrapper)).toHaveLength(20)
    expect(wrapper.text()).not.toContain('顯示更多')
  })

  it('點一列：回報 select、展開地址電話與準公共期間；教保資訊網連結開新視窗', async () => {
    const wrapper = mountList()
    const row = wrapper.findAll('.nearby__row')[2]!
    expect(row.attributes('aria-expanded')).toBe('false')
    await row.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['kg-quasi']])
    expect(row.attributes('aria-expanded')).toBe('true')
    const detail = wrapper.get('.nearby__detail')
    expect(detail.text()).toContain('義華路12號')
    expect(detail.text()).not.toContain('[807]')
    expect(detail.text()).toContain('(07)3800000')
    expect(detail.text()).toContain('114-116 學年')
    const link = detail.get('a')
    expect(link.attributes('href')).toBe('https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    await row.trigger('click')
    expect(wrapper.find('.nearby__detail').exists()).toBe(false)
    expect(wrapper.emitted('select')).toEqual([['kg-quasi']])
  })

  it('收合時不回報 select（只有展開才請地圖定位）；再展開同一列才再回報', async () => {
    const wrapper = mountList()
    const row = wrapper.findAll('.nearby__row')[1]!
    await row.trigger('click')
    await row.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['kg-public']])
    await row.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['kg-public'], ['kg-public']])
  })

  it('沒有電話、不是準公共的園所，詳情不列空行', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.nearby__row')[1]!.trigger('click')
    const detail = wrapper.get('.nearby__detail')
    expect(detail.text()).toContain('義華路12號')
    expect(detail.text()).not.toContain('電話')
    expect(detail.text()).not.toContain('準公共')
  })

  it('半徑 1／3／6 公里：選了回報 update:radiusKm', async () => {
    const wrapper = mountList()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 6)
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6]])
    expect(wrapper.findAll('.el-radio-button').map((item) => item.text())).toEqual(['1 公里', '3 公里', '6 公里'])
  })

  it('半徑只接受 1／3／6，其他值不往外送', () => {
    const wrapper = mountList()
    const group = wrapper.findComponent({ name: 'ElRadioGroup' })
    group.vm.$emit('update:modelValue', 2)
    group.vm.$emit('update:modelValue', 'abc')
    expect(wrapper.emitted('update:radiusKm')).toBeUndefined()
  })

  it('狀態：讀取中骨架、失敗可重試、只有本機構、校址比對不到', async () => {
    expect(mountList({ data: null }).find('.el-skeleton').exists()).toBe(true)
    const failed = mountList({ data: null, failed: true })
    expect(failed.text()).toContain('無法讀取附近幼兒園。')
    await button(failed, '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toEqual([[]])
    const onlyOwn = mountList({ data: areaKindergartens([kindergarten({ source_id: 'kg-own', is_own: true })]), radiusKm: 1 })
    expect(onlyOwn.text()).toContain('1 公里內沒有其他幼兒園。')
    const lost = mountList({ data: unlocated('no_doorplate') })
    expect(lost.text()).toContain('本校地址比對不到門牌，無法列出附近幼兒園。')
    expect(lost.find('input[aria-label="搜尋幼兒園"]').exists()).toBe(false)
  })

  it('半徑內一所都沒有：寫「沒有其他幼兒園」，不是空白列表', () => {
    const wrapper = mountList({ data: areaKindergartens([], { radius_km: 6 }), radiusKm: 6 })
    expect(wrapper.text()).toContain('6 公里內沒有其他幼兒園。')
    expect(wrapper.find('.nearby__list').exists()).toBe(false)
  })

  it('本機構不算競爭園所：只有本機構時寫沒有其他幼兒園，列表仍標出本機構', () => {
    const wrapper = mountList({
      data: areaKindergartens([kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', is_own: true })]),
      radiusKm: 3,
    })
    expect(wrapper.text()).toContain('3 公里內沒有其他幼兒園。')
    expect(names(wrapper)).toEqual(['常春藤幼兒園'])
    expect(wrapper.text()).toContain('本機構')
  })

  it('本校位置沒標出來時依原因寫（找不到地址／門牌尚未匯入／比對不到門牌）', () => {
    expect(mountList({ data: unlocated('no_address') }).text()).toContain('找不到本校地址，無法列出附近幼兒園。')
    expect(mountList({ data: unlocated('pending') }).text()).toContain('門牌資料尚未匯入，無法列出附近幼兒園。')
    expect(mountList({ data: unlocated('no_doorplate') }).text()).toContain('本校地址比對不到門牌，無法列出附近幼兒園。')
  })

  it('園名與地址是文字，不當 HTML 解析；沒有 v-html', async () => {
    const hostile = kindergarten({ source_id: 'kg-x', name: '高雄市私立<img src=x onerror=alert(1)>幼兒園', address: '<b>義華路</b>1號' })
    const wrapper = mountList({ data: areaKindergartens([hostile]) })
    expect(names(wrapper)).toEqual(['<img src=x onerror=alert(1)>幼兒園'])
    await wrapper.get('.nearby__row').trigger('click')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.nearby__detail').text()).toContain('<b>義華路</b>1號')
    expect(source).not.toContain('v-html')
  })

  it('樣式只用 token：沒有 rgba／oklch／hex 色碼', () => {
    const style = source.slice(source.indexOf('<style'))
    expect(style).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })
})
