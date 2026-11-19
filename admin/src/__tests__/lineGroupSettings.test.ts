// 每個 LINE 群組的通知開關（docs/specs/2026-11-17-line-group-interactions-design.md §4.4）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import { api } from '../api/client'
import type { LineGroupOut, LineSettingsOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const ALL_KINDS = ['visit_request_created', 'visit_request_confirmed', 'visit_request_rescheduled', 'visit_request_cancelled']

function group(overrides: Partial<LineGroupOut> = {}): LineGroupOut {
  return {
    target_id: 'C1',
    source_type: 'group',
    name: '義華員工群',
    first_seen_at: '2026-11-01T01:00:00Z',
    last_seen_at: '2026-11-01T01:00:00Z',
    left_at: null,
    verified_at: '2026-11-02T01:00:00Z',
    kinds: ALL_KINDS,
    digest_enabled: true,
    mention_all_same_day: true,
    is_hq: false,
    ...overrides,
  } as LineGroupOut
}

function settings(groups: LineGroupOut[]): LineSettingsOut {
  return { enabled: true, webhook_url: null, groups, targets: [], accounts: [], parent_campuses: [] } as unknown as LineSettingsOut
}

async function mountPage(data: LineSettingsOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/line-notifications')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue(data)
  const wrapper = mount(LineNotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('LINE 群組通知開關', () => {
  it('renders one switch per notification kind for each verified group', async () => {
    const wrapper = await mountPage(settings([group()]))
    const text = wrapper.get('[data-test="line-group-settings-C1"]').text()
    for (const label of ['新的參觀預約', '參觀預約已確認', '參觀預約已改期', '參觀預約已取消', '每日摘要', '當天異動 @所有人', '設為總部群組']) {
      expect(text).toContain(label)
    }
    expect(wrapper.findAll('[data-test="line-group-settings-C1"] .el-switch')).toHaveLength(7)
  })

  it('toggling a switch sends the full settings object', async () => {
    const wrapper = await mountPage(settings([group()]))
    const put = vi.spyOn(api, 'put').mockResolvedValue(settings([group({ digest_enabled: false })]) as never)
    await wrapper.get('[data-test="line-group-C1-digest"] .el-switch__input').trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/groups/C1', {
      kinds: ALL_KINDS,
      digest_enabled: false,
      mention_all_same_day: true,
      is_hq: false,
    })
  })

  it('unverified groups show no switches', async () => {
    const wrapper = await mountPage(settings([group({ verified_at: null })]))
    expect(wrapper.find('[data-test="line-group-settings-C1"]').exists()).toBe(false)
    expect(wrapper.findAll('.el-switch')).toHaveLength(0)
  })
})
