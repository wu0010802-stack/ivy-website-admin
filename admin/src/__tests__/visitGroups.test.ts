import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'
import { legacyStatusGroup, legacyStatusView, visitDisplay } from '../api/labels'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })

async function mountAt(component: unknown, path: string, user: UserOut = superAdmin()): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('案件狀態顯示（參考義華舊後台）', () => {
  it('四組各自的寫法', () => {
    expect(visitDisplay({ status: 'confirmed', display_status: 'upcoming' })).toMatchObject({ label: '預約正常', tone: 'success', sub: '' })
    expect(visitDisplay({ status: 'completed', display_status: 'past' })).toMatchObject({ label: '預約時間已過', sub: '已到場' })
    expect(visitDisplay({ status: 'no_show', display_status: 'past' }).sub).toBe('未到場')
    expect(visitDisplay({ status: 'confirmed', display_status: 'past' }).sub).toBe('尚未確認到場')
    // 2026-10-05：沒有「待處理」；舊狀態的案件也只依場次顯示成預約正常。
    for (const legacy of ['new', 'contacting', 'pending_confirmation']) {
      const shown = visitDisplay({ status: legacy, display_status: 'upcoming' })
      expect(shown).toMatchObject({ label: '預約正常', tone: 'success', sub: '' })
      expect(shown.label).not.toBe('待處理')
    }
  })

  it('取消寫出是誰、什麼時候', () => {
    const parent = visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: 'parent', cancelled_at: '2026-09-28T10:45:00Z' })
    expect(parent.label).toBe('預約已取消')
    expect(parent.tone).toBe('danger')
    expect(parent.sub).toMatch(/^家長取消：.*18:45/)
    expect(visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: 'hold_expired', cancelled_at: '2026-09-28T10:45:00Z' }).sub).toMatch(/^逾期未確認：/)
    expect(visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: null, cancelled_at: '2026-09-28T10:45:00Z' }).sub).toMatch(/^取消時間：/)
  })

  it('舊的 ?status= 書籤轉成分組', () => {
    // 舊流程的 new／contacting／pending_confirmation 不再有對應分組，落到「全部」。
    for (const legacy of ['new', 'contacting', 'pending_confirmation']) expect(legacyStatusGroup(legacy)).toBe('')
    expect(legacyStatusGroup('confirmed')).toBe('upcoming')
    expect(legacyStatusGroup('no_show')).toBe('past')
    expect(legacyStatusGroup('cancelled')).toBe('cancelled')
    expect(legacyStatusGroup('bogus')).toBe('')
  })
})

describe('案件列表分頁', () => {
  it('分頁數字來自 group-counts，只有全部＋三組；舊的 ?status=contacting 落到全部、不帶 group', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      (path.startsWith('/admin/visit-requests/group-counts') ? { upcoming: 5, past: 9, cancelled: 1 } : []) as never)
    const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests?status=contacting')

    const tabs = wrapper.findAll('.status-tab').map(tab => tab.text().replace(/\s+/g, ''))
    expect(tabs).toEqual(['全部', '預約正常5件', '時間已過9件', '已取消1件'])
    expect(wrapper.findAll('.status-tab')[0]!.attributes('aria-pressed')).toBe('true')
    expect(router.currentRoute.value.query.group).toBeUndefined()
    const lists = get.mock.calls.map(([path]) => String(path)).filter(path => path.startsWith('/admin/visit-requests?'))
    expect(lists.length).toBeGreaterThan(0)
    expect(lists.some(path => path.includes('group='))).toBe(false)
  })
})

describe('接待頁籤的舊狀態對照（2026-10-06 方向 B）', () => {
  it.each([
    ['confirmed', 'upcoming'], ['completed', 'arrived'], ['no_show', 'past'], ['cancelled', 'cancelled'],
    ['new', ''], ['contacting', ''], ['pending_confirmation', ''], ['', ''],
  ])('%s → %s', (status, view) => {
    expect(legacyStatusView(status)).toBe(view)
  })
})
