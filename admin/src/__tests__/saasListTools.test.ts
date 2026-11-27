import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import { api } from '../api/client'
import { SEARCH_HEADER } from '../api/searchHeader'
import { peopleSearchTerm, recordHit, visitHit } from '../composables/usePeopleSearch'
import { readSavedViews, SAVED_VIEW_LIMIT, snapshotKey, useSavedViews } from '../composables/useSavedViews'
import { useColumnPrefs } from '../composables/useColumnPrefs'
import { useAuthStore } from '../stores/auth'
import type { RecruitmentVisit, VisitRequestDetailOut } from '../api/types'
import { testUser } from './fixtures'

// 2026-11-27：側欄搜尋找人、常用篩選、表格顯示欄位。

const wrappers: VueWrapper[] = []
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[style*="display: none"]') ? [] : [{}]) as unknown as DOMRectList
  })
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('找人的搜尋字', () => {
  it('姓名至少 2 個字、電話至少 4 碼才查', () => {
    expect(peopleSearchTerm('王')).toBe('')
    expect(peopleSearchTerm('王小')).toBe('王小')
    expect(peopleSearchTerm('09')).toBe('')
    expect(peopleSearchTerm('0912')).toBe('0912')
    expect(peopleSearchTerm('0912-345-678')).toBe('0912345678')
    expect(peopleSearchTerm('+88')).toBe('')
    expect(peopleSearchTerm('   ')).toBe('')
  })

  it('案件連到案件頁；招生紀錄連到那一校的明細並展開那一筆（不限學年）', () => {
    const visit = visitHit({ id: 'v1', parent_name: '王媽媽', child_name: '小明', campus_key: 'yihua', visited_on: null, slot: { id: 's', slot_date: '2026-12-03', start_time: '10:00', end_time: '11:00' }, display_status: '預約成功' } as unknown as VisitRequestDetailOut)
    expect(visit).toMatchObject({ title: '王媽媽・小明', to: { path: '/visit-requests/v1' } })
    expect(visit.detail).toContain('12/3 參觀')
    const record = recordHit({ id: 'r1', child_name: '小明', contact_name: null, campus_key: 'chongde', month: '115.11' } as unknown as RecruitmentVisit)
    expect(record.to).toEqual({ path: '/admissions', query: { campus: 'chongde', sy: 'all', tab: 'records', open: 'r1' } })
  })
})

async function mountSidebar(role: Parameters<typeof testUser>[0] = 'super_admin') {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser(role, { id: 'local-test', email: 'test@example.invalid' })
  auth.features = { password_reset_email: false, admissions: true }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const global = { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } }
  const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth }
}

describe('側欄搜尋順便找人', () => {
  it('打姓名列出參觀案件與招生紀錄；搜尋字走 header 不進網址；點了到那一筆並清掉搜尋', async () => {
    vi.useFakeTimers()
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-requests?')) return [{ id: 'v1', parent_name: '王媽媽', child_name: '小明', campus_key: 'yihua', display_status: '預約成功' }] as never
      if (path.startsWith('/admin/admissions/records?') && path.includes('campus_key=yihua')) return [{ id: 'r1', child_name: '王小明', contact_name: '王媽媽', campus_key: 'yihua', month: '115.11' }] as never
      return [] as never
    })
    const { wrapper, router } = await mountSidebar()
    const input = wrapper.get('input[aria-label="搜尋後台功能"]')
    await input.setValue('王')
    await vi.advanceTimersByTimeAsync(400)
    expect(get).not.toHaveBeenCalled()

    await input.setValue('王小明')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    const visitCall = get.mock.calls.find(([path]) => String(path).startsWith('/admin/visit-requests?'))!
    expect(String(visitCall[0])).not.toContain(encodeURIComponent('王小明'))
    expect((visitCall[1] as { headers: Record<string, string> }).headers[SEARCH_HEADER]).toBe(encodeURIComponent(JSON.stringify({ q: '王小明' })))
    const people = wrapper.findAll('.sidebar__person')
    expect(people.map(link => link.text())).toEqual([expect.stringContaining('王媽媽・小明'), expect.stringContaining('王小明・王媽媽')])
    expect(wrapper.find('.sidebar__empty').exists()).toBe(false)

    await people[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/v1')
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('看不到參觀與招生的角色不查', async () => {
    vi.useFakeTimers()
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountSidebar('editor')
    await wrapper.get('input[aria-label="搜尋後台功能"]').setValue('王小明')
    await vi.advanceTimersByTimeAsync(400)
    expect(get.mock.calls.filter(([path]) => /visit-requests|admissions/.test(String(path)))).toEqual([])
  })
})

describe('常用篩選', () => {
  it('依帳號存在瀏覽器；同名覆蓋、可刪、有上限', () => {
    const user = ref<string | null>('u1')
    const store = useSavedViews('visit-requests', user)
    expect(store.save('  本週待追蹤 ', { due: '1', group: 'all' })).toBe(true)
    expect(store.save('本週待追蹤', { due: '1', group: 'past' })).toBe(true)
    expect(store.views.value).toHaveLength(1)
    expect(readSavedViews('visit-requests', 'u1')[0]).toMatchObject({ name: '本週待追蹤', snapshot: { due: '1', group: 'past' } })
    expect(readSavedViews('visit-requests', 'u2')).toEqual([])
    expect(readSavedViews('admissions-records', 'u1')).toEqual([])
    for (let i = 0; i < SAVED_VIEW_LIMIT + 3; i += 1) store.save(`第 ${i} 組`, { campus: `c${i}` })
    expect(store.views.value).toHaveLength(SAVED_VIEW_LIMIT)
    expect(store.full.value).toBe(true)
    store.remove(store.views.value[0]!.id)
    expect(readSavedViews('visit-requests', 'u1')).toHaveLength(SAVED_VIEW_LIMIT - 1)
  })

  it('條件順序不同也算同一組；壞掉的儲存內容當作沒存過', () => {
    expect(snapshotKey({ a: '1', b: '2' })).toBe(snapshotKey({ b: '2', a: '1', c: '' }))
    localStorage.setItem('ivy-admin-saved-views:visit-requests:u1', '{壞掉')
    expect(readSavedViews('visit-requests', 'u1')).toEqual([])
    localStorage.setItem('ivy-admin-saved-views:visit-requests:u1', JSON.stringify([{ id: 'x', name: 'ok', snapshot: { a: '1' } }, { id: 1 }, null]))
    expect(readSavedViews('visit-requests', 'u1')).toHaveLength(1)
  })
})

describe('表格顯示欄位', () => {
  const options = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]
  it('只記藏起來的欄，依帳號分開；全部顯示時清掉紀錄', async () => {
    const user = ref<string | null>('u1')
    const prefs = useColumnPrefs('admissions-records', user, options)
    expect(prefs.visible.value).toEqual(['a', 'b', 'c'])
    prefs.visible.value = ['a', 'c']
    expect(prefs.shows('b')).toBe(false)
    expect(prefs.customized.value).toBe(true)
    expect(JSON.parse(localStorage.getItem('ivy-admin-columns:admissions-records:u1')!)).toEqual(['b'])
    user.value = 'u2'
    await nextTick()
    expect(prefs.shows('b')).toBe(true)
    user.value = 'u1'
    await nextTick()
    expect(prefs.shows('b')).toBe(false)
    prefs.reset()
    expect(localStorage.getItem('ivy-admin-columns:admissions-records:u1')).toBeNull()
  })

  it('認不得的欄名（表格改版後留下的）不理', () => {
    localStorage.setItem('ivy-admin-columns:admissions-records:u1', JSON.stringify(['gone', 'b', 3]))
    const prefs = useColumnPrefs('admissions-records', ref('u1'), options)
    expect(prefs.visible.value).toEqual(['a', 'c'])
  })
})
