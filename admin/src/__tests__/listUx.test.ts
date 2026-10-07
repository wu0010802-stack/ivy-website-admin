import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers() })

async function mountView(component: object, path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return { wrapper, pinia }
}

describe('案件列表的接待頁籤', () => {
  const countsMock = (counts: Record<string, number>) => vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-requests/view-counts') ? counts : []) as never)

  it('一鍵切換頁籤並帶給後端，數字來自 view-counts', async () => {
    const get = countsMock({ upcoming: 3, past_unmarked: 2 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    await flushPromises()
    const tabs = wrapper.findAll('.status-tab')
    expect(tabs.map(tab => tab.text().replace(/\s+/g, ''))).toEqual(['接下來3件', '時間已過2件還沒標記到場', '已到場', '已取消', '全部'])
    // 2026-10-05：沒有「待處理」頁籤；2026-10-06 預設落在「接下來」。
    expect(tabs.map(tab => tab.text()).join('')).not.toContain('待處理')
    expect(tabs[0]!.attributes('aria-pressed')).toBe('true')
    await tabs[1]!.trigger('click')
    await flushPromises()
    const lists = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))
    expect(lists.at(-1)).toContain('view=past')
    expect(wrapper.findAll('.status-tab')[1]!.attributes('aria-pressed')).toBe('true')
  })

  it('縮小到單一校區時，數字也跟著帶校區條件重算，但不帶頁籤', async () => {
    const get = countsMock({ upcoming: 3, past_unmarked: 0 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    const counts = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests/view-counts'))
    expect(counts.at(-1)).toContain('campus_key=yihua')
    expect(counts.at(-1)).not.toContain('view=')
  })
})

describe('案件列表：排序與頁籤的說明文字', () => {
  const listCalls = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))

  it('預設依參觀時間：接下來由近到遠，換到其他頁籤往回；選了送出時間就照送出時間，標籤列看得到', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    await flushPromises()
    expect(new URLSearchParams(listCalls(get).at(-1)!.split('?')[1]).get('order')).toBe('visit_asc')
    await wrapper.get('.status-tab[data-group="arrived"]').trigger('click')
    await flushPromises()
    expect(new URLSearchParams(listCalls(get).at(-1)!.split('?')[1]).get('order')).toBe('visit_desc')

    const picked = await mountView(VisitRequestsView, '/visit-requests?group=upcoming&order=newest')
    await flushPromises()
    expect(new URLSearchParams(listCalls(get).at(-1)!.split('?')[1]).get('order')).toBe('newest')
    expect(picked.wrapper.get('.filter-chips').text()).toContain('最新送出在前')
  })

  it('清除篩選只清條件、不換頁籤：空狀態講清楚清完看到的是哪個範圍（2026-10-06 預檢 P6）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const hint = async (path: string) => {
      const { wrapper } = await mountView(VisitRequestsView, path)
      await flushPromises()
      return wrapper.get('.requests-empty').text()
    }
    const inTab = await hint('/visit-requests?group=cancelled&q=zzz')
    expect(inTab).toContain('清除篩選查看「已取消」的全部案件')
    expect(inTab).not.toContain('清除篩選查看全部案件')
    const inAll = await hint('/visit-requests?group=all&q=zzz')
    expect(inAll).toContain('清除篩選查看全部案件')
    // 沒有任何條件、只是這個頁籤沒有案件：不說「家長送出需求後會顯示在這裡」，提醒換頁籤。
    const bare = await hint('/visit-requests?group=cancelled')
    expect(bare).toContain('沒有「已取消」的案件')
    expect(bare).toContain('切換上方的頁籤')
    expect(bare).not.toContain('家長送出需求')
    expect(await hint('/visit-requests')).toContain('接下來沒有參觀')
    expect(await hint('/visit-requests?group=all')).toContain('家長送出需求後')
  })
})
