// 2026-10-02 操作紀錄 UX：載入更早的紀錄（游標分頁）、可不列登入登出、案件類
// 紀錄連到案件（後端讀取時查案件還在不在）、手機一筆壓成兩三行。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AuditView from '../views/AuditView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, actor_user_id: 'me', actor_email: 'amy@ivy.example', actor_display_name: '王小美',
    action: 'site_settings.update', target_type: 'site', target_id: 'x', target_label: null, target_exists: null,
    campus_key: null, metadata: {}, created_at: '2026-09-28T06:30:00Z', ...extra,
  }
}

async function mountAudit() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/audit')
  await router.isReady()
  const wrapper = mount(AuditView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('操作紀錄載入更早的紀錄', () => {
  it('回滿 100 筆時可以接著讀，用最後一筆當游標、接在後面', async () => {
    const first = Array.from({ length: 100 }, (_, i) => entry(`a${i}`))
    const last = first[99]!
    const get = vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('before=') ? [entry('older', { created_at: '2026-09-20T01:00:00Z' })] : first) as Promise<never>)
    const wrapper = await mountAudit()
    expect(wrapper.get('.list-summary').text()).toContain('已載入 100 筆')
    await wrapper.get('[data-test="audit-load-more"]').trigger('click')
    await flushPromises()
    const url = String(get.mock.calls.at(-1)![0])
    const params = new URL(url, 'http://x').searchParams
    expect(params.get('before')).toBe(last.created_at)
    expect(params.get('before_id')).toBe(last.id)
    expect(wrapper.get('.list-summary').text()).toContain('已載入 101 筆')
    // 這次不到 100 筆，已經是最早的了。
    expect(wrapper.find('[data-test="audit-load-more"]').exists()).toBe(false)
  })

  it('勾「不列登入登出」時重新讀取並帶 exclude_login；預設不帶', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const wrapper = await mountAudit()
    expect(String(get.mock.calls[0]![0])).not.toContain('exclude_login')
    await wrapper.get('[data-test="audit-hide-logins"] input').setValue(true)
    await flushPromises()
    expect(String(get.mock.calls.at(-1)![0])).toContain('exclude_login=true')
  })
})

describe('案件類紀錄連到案件', () => {
  it('案件還在才給「查看案件」，已清除寫明；匯出這類沒有單一案件的不給', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      entry('a1', { action: 'visit_request.assign', target_type: 'visit_request', target_id: 'case-1', target_exists: true, campus_key: 'yihua' }),
      entry('a2', { action: 'visit_request.assign', target_type: 'visit_request', target_id: 'case-2', target_exists: false, campus_key: 'yihua', created_at: '2026-09-28T06:00:00Z' }),
      entry('a3', { action: 'visit_request.export', target_type: 'visit_request', target_id: 'yihua', target_exists: null, campus_key: 'yihua', created_at: '2026-09-28T05:00:00Z' }),
      entry('a4', { action: 'content.publish', target_type: 'content_item', target_id: 'item-uuid', metadata: { kind: 'campus_news' }, campus_key: 'renwu', created_at: '2026-09-28T04:00:00Z' }),
    ] as never)
    const wrapper = await mountAudit()
    const rows = wrapper.findAll('.data-table .el-table__body tr')
    expect(rows[0]!.get('[data-test="audit-case-link"]').attributes('href')).toBe('/visit-requests/case-1')
    expect(rows[1]!.text()).toContain('案件已清除')
    expect(rows[1]!.find('a').exists()).toBe(false)
    expect(rows[2]!.find('a').exists()).toBe(false)
    expect(rows[3]!.get('a').attributes('href')).toBe('/content/campus-news?campus=renwu')
    // 不顯示案件編號。
    expect(wrapper.text()).not.toContain('case-1')
  })
})

describe('手機版操作紀錄', () => {
  it('一筆壓成動作＋對象、時間・操作者，細節只有有內容時才寫，不再印「—」', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      entry('a1', { action: 'user.login_password', target_type: 'user', target_id: 'u1', target_label: 'ux' }),
      entry('a2', { action: 'user.set_active', target_type: 'user', target_id: 'u2', metadata: { is_active: false }, created_at: '2026-09-28T06:00:00Z' }),
    ] as never)
    const wrapper = await mountAudit()
    const cards = wrapper.findAll('.mobile-records .mobile-record')
    expect(cards[0]!.find('dl').exists()).toBe(false)
    expect(cards[0]!.text()).toContain('使用者「ux」')
    expect(cards[0]!.get('.audit-record__meta').text()).toContain('14:30 · 王小美')
    expect(cards[0]!.find('[data-test="audit-detail-mobile"]').exists()).toBe(false)
    expect(cards[0]!.text()).not.toContain('—')
    expect(cards[1]!.get('[data-test="audit-detail-mobile"]').text()).toBe('帳號改為停用')
  })
})
