// 2026-09-28 系統頁 UX（操作紀錄）：細節欄翻成中文、識別碼不顯示、未知欄位收進
// 「其他細節」；依日期分段、校區欄沒有校區時寫「全站」、筆數寫已載入幾筆（10-02 起可載入更早的紀錄，見 auditUx.test.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AuditView from '../views/AuditView.vue'
import { api } from '../api/client'
import { auditMetadataDetails, auditMetadataSummary } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/
const slot = (date: string, start: string, end: string) => ({ id: 'dce2bd7c-1111-4222-8333-944455556666', date, start, end })

describe('操作紀錄細節翻成園方看得懂的中文', () => {
  it('狀態、時段、內容種類、時間與布林都翻成中文，不出現識別碼與內部版本號', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['content.publish', { kind: 'home_news', revision_version: 2 }, '內容：最新消息與活動'],
      ['visit_request.no_show', { from_status: 'confirmed', to_status: 'no_show' }, '狀態：預約正常 → 未到場'],
      ['visit_request.confirm', { from_status: 'contacting', slot: slot('2026-10-02', '09:30', '10:30') }, '原本狀態：聯絡中，場次：10/02 09:30–10:30'],
      ['visit_slot.create', { slot: slot('2026-10-02', '09:30', '10:30') }, '場次：10/02 09:30–10:30'],
      ['visit_request.add_contact_note', { note_id: 'dce2bd7c-aaaa-4bbb-8ccc-dddddddddddd', follow_up_set: true }, '設定了下次聯絡時間'],
      ['visit_request.create_access_link', { expires_at: '2026-10-12T13:41:57.541646+00:00', replaced_previous: false }, '連結到期：2026/10/12 21:41'],
      ['user.set_active', { is_active: false }, '帳號改為停用'],
      ['user.reset_password', { revoked_sessions: 2 }, '同時登出 2 個已登入的裝置'],
      ['visit_request.reschedule', { from_slot: slot('2026-10-02', '09:30', '10:30'), to_slot: slot('2026-10-03', '10:00', '11:00'), has_reason: true }, '場次：10/02 09:30–10:30 → 10/03 10:00–11:00，有填寫原因'],
      ['visit_request.export', { row_count: 12, status: 'confirmed', has_search: true }, '匯出 12 筆，篩選狀態：預約正常，有用搜尋字篩選'],
      ['campus.deactivate', { before: true, after: false, reason: '暑假整修', open_requests: 2 }, '分校：啟用 → 停用，原因：暑假整修，尚未結案的案件 2 筆'],
      ['media.upload', { kind: 'image', content_type: 'image/jpeg', size_bytes: 204800, status: 'ready' }, '類型：圖片，檔案大小：200 KB，素材狀態：可用'],
      ['visit_slot.update', { slot: slot('2026-10-02', '09:30', '10:30'), before: { capacity: 3, closed: false }, after: { capacity: 5, closed: false } }, '場次：10/02 09:30–10:30，修改：名額：3 位 → 5 位'],
      ['visit_slot.update', { slot: slot('2026-10-08', '10:00', '11:00'), before: { capacity: 3, closed: false }, after: { capacity: 3, closed: true } }, '場次：10/08 10:00–11:00，修改：場次狀態：開放 → 已關閉'],
      ['visit_request.add_contact_note', { note_id: 'dce2bd7c-aaaa-4bbb-8ccc-dddddddddddd', follow_up_set: false }, '沒有設定下次聯絡時間'],
      ['retention_policy.update', { before: { cancelled_days: 365, completed_days: 365, open_overdue_days: 180, auto_run_enabled: false }, after: { cancelled_days: 180, completed_days: 365, open_overdue_days: 180, auto_run_enabled: true } }, '修改：已取消、未到場保留：365 天 → 180 天；每天自動清理：關閉 → 開啟'],
      ['content.reject', { kind: 'home_hero', revision_version: 3, note: '標語太長' }, '內容：首頁大圖標語，退回理由：標語太長'],
      ['notification_outbox.retry', { kind: 'visit_request_created', visit_request_id: 'dce2bd7c-aaaa-4bbb-8ccc-dddddddddddd', previous_attempts: 3, previous_error_code: 'TimeoutError', source: 'admin' }, '通知：新的參觀預約，先前嘗試 3 次，上次失敗原因：連線逾時，在後台手動重寄'],
    ]
    for (const [action, metadata, expected] of cases) {
      const summary = auditMetadataSummary(metadata, action)
      expect(summary, action).toBe(expected)
      expect(summary, action).not.toMatch(UUID)
      expect(summary, action).not.toMatch(/[a-z_]+=/)
      expect(auditMetadataDetails(metadata, action).others, action).toEqual([])
    }
  })

  it('個資清理的紀錄：方式、天數與各類筆數，不列 run_id', () => {
    const summary = auditMetadataSummary({
      trigger: 'scheduled',
      days: { cancelled_days: 365, completed_days: 730, open_overdue_days: 180 },
      counts: { cancelled: 2, no_show: 0, completed: 1 },
      total: 3,
      open_overdue_count: 0,
      run_id: 'dce2bd7c-aaaa-4bbb-8ccc-dddddddddddd',
    }, 'retention.run')
    expect(summary).toBe('方式：每天自動清理，保留天數：取消／未到場 365 天、完成 730 天，已取消 2 筆、未到場 0 筆、已完成參觀 1 筆，共匿名化 3 筆')
  })

  it('預約設定：只列翻好的修改前後，不再重複 mode=、version=、changed：', () => {
    const summary = auditMetadataSummary({
      mode: 'slots',
      version: 1,
      parent_change_deadline_hours: 24,
      changed: ['mode', 'phone'],
      before: { mode: 'paused', line_url: null, phone: null, parent_change_deadline_hours: 24 },
      after: { mode: 'slots', line_url: null, phone: '07-1234567', parent_change_deadline_hours: 24 },
    }, 'booking_config.update')
    expect(summary).toBe('修改：預約方式：暫停預約 → 自選場次（家長線上預約）；洽詢電話：（空白） → 07-1234567')
    expect(summary.match(/預約方式/g)).toHaveLength(1)
  })

  it('整站還原與替換素材列出內容名稱', () => {
    expect(auditMetadataSummary({
      restored_from_release_id: 'dce2bd7c-aaaa-4bbb-8ccc-dddddddddddd',
      changed: [{ kind: 'home_hero', campus_key: null, revision_version: 2 }, { kind: 'campus_profile', campus_key: 'yihua', revision_version: 5 }],
      kept_count: 3,
    }, 'release.restore')).toBe('還原的內容：首頁大圖標語、五校介紹（義華），3 項維持不變')
  })

  it('還沒有中文寫法的新欄位收進其他細節，不直接攤成 key=value', () => {
    const details = auditMetadataDetails({ kind: 'home_hero', brand_new_key: 'abc', nested_thing: { a: 1 } }, 'content.publish')
    expect(details.lines).toEqual(['內容：首頁大圖標語'])
    expect(details.others).toEqual(['brand_new_key：abc', 'nested_thing：{"a":1}'])
  })
})

async function mountAudit(entries: unknown[]) {
  vi.spyOn(api, 'get').mockResolvedValue(entries as never)
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

const entries = [
  { id: 'a1', actor_user_id: 'me', action: 'visit_request.no_show', target_type: 'visit_request', target_id: 'v1', campus_key: 'yihua', metadata: { from_status: 'confirmed', to_status: 'no_show' }, created_at: '2026-09-28T06:30:00Z' },
  { id: 'a2', actor_user_id: 'me', action: 'content.publish', target_type: 'content_item', target_id: 'c1', campus_key: null, metadata: { kind: 'home_news', revision_version: 2, brand_new_key: 'abc' }, created_at: '2026-09-28T01:00:00Z' },
  { id: 'a3', actor_user_id: 'me', action: 'user.set_active', target_type: 'user', target_id: 'u1', campus_key: null, metadata: { is_active: false }, created_at: '2026-09-26T15:30:00Z' },
]

describe('操作紀錄頁', () => {
  it('依台灣日期分段、日期標題固定在上方；筆數寫已載入幾筆', async () => {
    const wrapper = await mountAudit(entries)
    const days = wrapper.findAll('.audit-day')
    expect(days).toHaveLength(2)
    expect(days[0]!.get('.audit-day__head').text()).toContain('9月28日')
    expect(days[0]!.get('.audit-day__head').text()).toContain('2 筆')
    // 2026-09-26T15:30Z 是台灣 9/26 23:30。
    expect(days[1]!.get('.audit-day__head').text()).toContain('9月26日')
    expect(days[1]!.text()).toContain('23:30')
    expect(wrapper.get('.list-summary').text()).toContain('已載入 3 筆')
    // 不到 100 筆就是全部了，不給「載入更早的紀錄」。
    expect(wrapper.find('[data-test="audit-load-more"]').exists()).toBe(false)
  })

  it('桌機表格的校區欄沒有校區時寫「全站」，細節不用等寬字、不截斷', async () => {
    const wrapper = await mountAudit(entries)
    const cells = wrapper.findAll('.data-table .el-table__body tr').map(row => row.findAll('td').map(td => td.text()))
    // 第二欄是 2026-09-28 業主裁定加的「操作者」，校區在第四欄。
    expect(cells.map(row => row[3])).toEqual(['義華', '全站', '全站'])
    expect(wrapper.find('.data-table .mono').exists()).toBe(false)
    expect(wrapper.find('.data-table .el-tooltip').exists()).toBe(false)
    const text = wrapper.text()
    expect(text).toContain('狀態：預約正常 → 未到場')
    expect(text).toContain('內容：最新消息與活動')
    expect(text).toContain('帳號改為停用')
    expect(text).not.toContain('revision_version')
    expect(text).not.toContain('is_active')
  })

  it('未知欄位收在可展開的「其他細節」', async () => {
    const wrapper = await mountAudit(entries)
    const others = wrapper.findAll('.data-table details.audit-others')
    expect(others).toHaveLength(1)
    expect(others[0]!.get('summary').text()).toBe('其他細節')
    expect(others[0]!.text()).toContain('brand_new_key：abc')
  })

  it('搜尋比對翻好的中文', async () => {
    const wrapper = await mountAudit(entries)
    await wrapper.get('.filter-search input').setValue('未到場')
    await flushPromises()
    expect(wrapper.findAll('.data-table .el-table__body tr')).toHaveLength(1)
    await wrapper.get('.filter-search input').setValue('全站')
    await flushPromises()
    expect(wrapper.findAll('.data-table .el-table__body tr')).toHaveLength(2)
    await wrapper.get('.filter-search input').setValue('from_status')
    await flushPromises()
    expect(wrapper.text()).toContain('找不到符合條件的紀錄')
  })
})
