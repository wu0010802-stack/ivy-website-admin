// 案件明細與列表（2026-10-06 方向 B／C）新測試共用：案件假資料、用真的路由掛 view。
// 檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { superAdmin, wrappers } from './admissionsTestKit'

export const VISIT_ID = 'case-a'
export const futureSlot = { id: 's-future', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
export const pastSlot = { id: 's-past', slot_date: '2026-01-05', start_time: '10:00:00', end_time: '11:00:00' }

/** GET /admin/visit-requests/{id} 的假資料：預設已確認、官網送出、場次在未來。 */
export function visitCase(extra: Record<string, unknown> = {}) {
  return {
    id: VISIT_ID, campus_key: 'yihua', status: 'confirmed', source: 'web', created_by: null,
    parent_name: '林小姐', phone: '0912000001', child_name: '小安', child_birthdate: '2022-05-01', email: 'p1@example.com',
    referral_sources: ['friends_family'], age: null, preferred_time: null, questions: null, party_size: null,
    consent_given: false, slot_id: futureSlot.id, slot: futureSlot, display_status: 'upcoming',
    confirmed_at: '2026-10-01T08:25:00Z', cancelled_at: null, cancel_reason: null, follow_up_at: null,
    related_request_id: null, created_at: '2026-10-01T08:25:00Z', version: 1,
    history: [], pending_reschedule: null, access_link: null, parent_change_deadline_hours: 24, ...extra,
  }
}

/** mockGet 用：案件本身與聯絡紀錄（前綴取最長，聯絡紀錄不會被案件吃掉）。 */
export function caseRoutes(data: { id?: unknown } & Record<string, unknown>, notes: unknown[] = []) {
  const id = String(data.id ?? VISIT_ID)
  return { [`/admin/visit-requests/${id}`]: data, [`/admin/visit-requests/${id}/contact-notes`]: notes }
}

/** 用真的路由（/visit-requests、/visit-requests/:id）掛 RouterView；route.params.id、onBeforeRouteLeave 都正常。 */
export async function mountRoutes(
  path: string,
  views: { list?: unknown; detail?: unknown },
  options: { user?: UserOut; admissions?: boolean } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = options.user ?? superAdmin()
  if (options.admissions) auth.features = { ...auth.features, admissions: true }
  const blank = defineComponent({ template: '<div />' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests', component: (views.list ?? blank) as never },
      { path: '/visit-requests/:id', component: (views.detail ?? blank) as never },
      { path: '/:pathMatch(.*)*', component: blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
