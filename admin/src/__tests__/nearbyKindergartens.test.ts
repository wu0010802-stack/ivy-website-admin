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

  it('半徑 1／3／6 公里：真的點選項（不是直接發事件），選了回報 update:radiusKm；目前的半徑是選取狀態', async () => {
    const wrapper = mountList()
    expect(wrapper.findAll('.el-radio-button').map((item) => item.text())).toEqual(['1 公里', '3 公里', '6 公里'])
    const radios = wrapper.findAll('input.el-radio-button__original-radio')
    expect(radios.map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([false, true, false])
    await radios[2]!.setValue()
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6]])
    await radios[0]!.setValue()
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6], [1]])
  })

  // 畫面上點不出這幾個值（選項只有 1／3／6），這條直接呼叫元件的 handler 保底：以後有人加了別的選項或從別處發事件，
  // 不合法的半徑不會往外送、更不會變成對後端的 radius_km 請求。
  it('半徑只接受 1／3／6，其他值不往外送（handler 的保底）', () => {
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

  it('幼兒園資料從未匯入（synced_at 為 null）：寫「尚未匯入」，不寫「沒有其他幼兒園」、沒有搜尋框與類型 chip、頁尾沒有「更新」', () => {
    const wrapper = mountList({ data: areaKindergartens([], { synced_at: null }), radiusKm: 3 })
    expect(wrapper.text()).toContain('幼兒園名單尚未匯入。')
    expect(wrapper.text()).not.toContain('沒有其他幼兒園')
    expect(wrapper.find('input[aria-label="搜尋幼兒園"]').exists()).toBe(false)
    expect(wrapper.find('.nearby__kind').exists()).toBe(false)
    expect(wrapper.find('.nearby__list').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('更新')
  })

  it('校區位置沒標出來時，仍是校區的原因（優先於「幼兒園名單尚未匯入」）', () => {
    const wrapper = mountList({ data: { ...unlocated('no_doorplate'), synced_at: null } })
    expect(wrapper.text()).toContain('本校地址比對不到門牌，無法列出附近幼兒園。')
    expect(wrapper.text()).not.toContain('幼兒園名單尚未匯入')
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

  describe('搜尋比對（2026-10-12）', () => {
    const search = (wrapper: VueWrapper, value: string) => wrapper.get('input[aria-label="搜尋幼兒園"]').setValue(value)

    it('比對的是列表上看到的短名與地址，不含「高雄市私立／市立」前綴：輸入「高雄市」「私立」不會全部命中', async () => {
      const wrapper = mountList()
      await search(wrapper, '高雄市')
      expect(names(wrapper)).toEqual([])
      expect(wrapper.text()).toContain('沒有符合條件的幼兒園。')
      await search(wrapper, '私立')
      expect(names(wrapper)).toEqual([])
      // 名稱本身有的字照常命中（短名保留「三民區」）。
      await search(wrapper, '三民區')
      expect(names(wrapper)).toEqual(['三民區小芽非營利幼兒園'])
      await search(wrapper, '小草')
      expect(names(wrapper)).toEqual(['小草幼兒園'])
    })

    it('全形半形、大小寫視為相同（NFKC＋小寫），地址也一樣', async () => {
      const mixed = [
        kindergarten({ source_id: 'kg-abc', name: '高雄市私立ABC雙語幼兒園', address: '義華路12號 Yihua Road' }),
        kindergarten({ source_id: 'kg-other', name: '高雄市私立小樹幼兒園', address: '大順路3號' }),
      ]
      const wrapper = mountList({ data: areaKindergartens(mixed) })
      for (const keyword of ['abc', 'ＡＢＣ', 'ａｂｃ', ' AbC ']) {
        await search(wrapper, keyword)
        expect(names(wrapper), keyword).toEqual(['ABC雙語幼兒園'])
      }
      for (const keyword of ['１２號', 'yihua road', 'ＹＩＨＵＡ']) {
        await search(wrapper, keyword)
        expect(names(wrapper), keyword).toEqual(['ABC雙語幼兒園'])
      }
      await search(wrapper, '大順')
      expect(names(wrapper)).toEqual(['小樹幼兒園'])
    })
  })

  it('搜尋或類型 chip 一變就收回「顯示更多」（不然篩過之後還停在展開的狀態）', async () => {
    const many = Array.from({ length: 25 }, (_, index) => kindergarten({
      source_id: `kg-${index}`, name: `高雄市私立第${index}幼兒園`, kind: index % 2 ? 'public' : 'private',
    }))
    const wrapper = mountList({ data: areaKindergartens(many) })
    const input = wrapper.get('input[aria-label="搜尋幼兒園"]')
    await button(wrapper, '顯示更多（還有 5 所）')!.trigger('click')
    expect(names(wrapper)).toHaveLength(25)
    await input.setValue('第')
    expect(names(wrapper)).toHaveLength(20)
    expect(button(wrapper, '顯示更多（還有 5 所）')).toBeDefined()
    await button(wrapper, '顯示更多（還有 5 所）')!.trigger('click')
    expect(names(wrapper)).toHaveLength(25)
    await wrapper.findAll('.nearby__kind').find((item) => item.text() === '私立')!.trigger('click')
    expect(names(wrapper)).toHaveLength(13)
    expect(wrapper.text()).not.toContain('顯示更多')
    await wrapper.findAll('.nearby__kind').find((item) => item.text() === '私立')!.trigger('click')
    expect(names(wrapper)).toHaveLength(20)
    expect(button(wrapper, '顯示更多（還有 5 所）')).toBeDefined()
  })

  it('新視窗連結：另開新視窗寫給讀屏聽，↗ 只是裝飾', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.nearby__row')[1]!.trigger('click')
    const link = wrapper.get('.nearby__detail a')
    expect(link.get('.visually-hidden').text()).toBe('（另開新視窗）')
    expect(link.get('[aria-hidden="true"]').text()).toBe('↗')
    expect(link.text()).toContain('全國教保資訊網查詢')
  })

  it('展開鈕 aria-controls 指到它展開的詳情（dl 的 id）；收合時沒有可指的對象就不寫；每一列的 id 不重複', async () => {
    const wrapper = mountList()
    const rows = wrapper.findAll('.nearby__row')
    expect(rows[1]!.attributes('aria-controls')).toBeUndefined()
    await rows[1]!.trigger('click')
    const id = rows[1]!.attributes('aria-controls')!
    expect(id).toBeTruthy()
    expect(wrapper.get(`#${id}`).element).toBe(wrapper.get('.nearby__detail').element)
    await rows[2]!.trigger('click')
    expect(rows[1]!.attributes('aria-controls')).toBeUndefined()
    const second = rows[2]!.attributes('aria-controls')!
    expect(second).toBeTruthy()
    expect(second).not.toBe(id)
    expect(wrapper.get(`#${second}`).element).toBe(wrapper.get('.nearby__detail').element)
    await rows[2]!.trigger('click')
    expect(rows[2]!.attributes('aria-controls')).toBeUndefined()
  })

  it('核定人數未知（null）：寫「—」，不寫 0', () => {
    const wrapper = mountList()
    const quasi = wrapper.findAll('.nearby__row')[2]!.text().replace(/\s+/g, '')
    expect(quasi).toContain('950m・核定—人・月費（估）9,800元')
    expect(quasi).not.toContain('核定0人')
  })

  it('除了本機構沒有別的園所：不顯示搜尋框與類型 chip（沒東西可篩），本機構仍列出', () => {
    const wrapper = mountList({ data: areaKindergartens([kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', is_own: true })]), radiusKm: 1 })
    expect(wrapper.text()).toContain('1 公里內沒有其他幼兒園。')
    expect(wrapper.find('input[aria-label="搜尋幼兒園"]').exists()).toBe(false)
    expect(wrapper.find('.nearby__kinds').exists()).toBe(false)
    expect(names(wrapper)).toEqual(['常春藤幼兒園'])
  })

  it('篩了「大樹」再換成沒有其他園所的半徑：搜尋框收起後舊的搜尋字與 chip 不再篩掉本機構', async () => {
    const wrapper = mountList()
    await wrapper.get('input[aria-label="搜尋幼兒園"]').setValue('大樹')
    await wrapper.findAll('.nearby__kind').find((item) => item.text() === '公立')!.trigger('click')
    expect(names(wrapper)).toEqual(['大樹幼兒園'])
    await wrapper.setProps({ data: areaKindergartens([kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', is_own: true })], { radius_km: 1 }), radiusKm: 1 })
    expect(wrapper.find('input[aria-label="搜尋幼兒園"]').exists()).toBe(false)
    expect(names(wrapper)).toEqual(['常春藤幼兒園'])
    expect(wrapper.text()).toContain('1 公里內沒有其他幼兒園。')
    expect(wrapper.text()).not.toContain('沒有符合條件的幼兒園。')
  })

  it('樣式只用 token：沒有 rgba／oklch／hex 色碼', () => {
    const style = source.slice(source.indexOf('<style'))
    expect(style).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })
})
