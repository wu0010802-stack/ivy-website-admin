import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import VisitDetailView from '../views/VisitDetailView.vue'
import { admissionsViewer, button, cleanup, mockGet, pathsTo, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

const created = { id: 'e1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-10-01T08:25:00Z' }
const note = { id: 'n1', note: '再次確認會來', created_at: '2026-10-02T01:40:00Z', created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君' }

describe('VisitCaseTimeline', () => {
  it('輸入框在最上面（頁面第一個 textarea、第一個日期選擇器），下面一條紀錄新的在上', async () => {
    mockGet(caseRoutes(visitCase({ history: [created] }), [note]))
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    const timeline = wrapper.get('.case-timeline')
    expect(wrapper.find('textarea').element.closest('.case-timeline')).not.toBeNull()
    expect(wrapper.findComponent({ name: 'ElDatePicker' }).element.closest('.notes__follow')).not.toBeNull()
    const items = timeline.findAll('ol[aria-label="聯絡紀錄與案件歷程"] > li')
    expect(items.map((li) => li.attributes('data-kind'))).toEqual(['note', 'event'])
    expect(items[0]!.get('.notes__author').text()).toBe('怡君')
    expect(items[0]!.get('.notes__author').attributes('title')).toBe('amy@ivy.example')
    expect(items[0]!.text()).toContain('記了一筆')
    expect(items[0]!.text()).toContain('再次確認會來')
  })

  it('家庭版面：沒有輸入框；標參觀前／後與預約／招生；參觀後聯絡讀不到可以重新載入', async () => {
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    let logCalls = 0
    const get = mockGet({
      ...caseRoutes(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past', history: [created] }), [note]),
      '/admin/admissions/records': [linked],
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': () => { logCalls += 1; throw new Error('boom') },
    })
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { admissions: true })
    expect(wrapper.find('textarea[aria-label="新增聯絡紀錄"]').exists()).toBe(false)
    expect(wrapper.get('.timeline__item[data-kind="note"]').attributes('data-phase')).toBe('before')
    expect(wrapper.get('.timeline__item[data-kind="event"] .timeline__source').text()).toBe('預約')
    expect(wrapper.get('.case-timeline').text()).toContain('參觀後的聯絡紀錄讀不到。')
    await button(wrapper.get('.case-timeline'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(logCalls).toBe(2)
    expect(pathsTo(get, '/admin/admissions/records/v-1/contact-logs')).toHaveLength(2)
  })

  // 以下兩個是舊 familyNotesHistory.test.ts 的情境，元件換成時間線後搬到這裡。
  it('參觀後讀不到而且沒有任何紀錄：只寫讀不到，不說還沒有紀錄；能重新載入', async () => {
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    let logCalls = 0
    mockGet({
      ...caseRoutes(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past', history: [] }), []),
      '/admin/admissions/records': [linked],
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': () => { logCalls += 1; throw new Error('boom') },
    })
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { admissions: true })
    const timeline = wrapper.get('.case-timeline')
    expect(timeline.find('ol').exists()).toBe(false)
    expect(timeline.text()).toContain('參觀後的聯絡紀錄讀不到。')
    expect(timeline.text()).not.toContain('還沒有聯絡紀錄')
    expect(timeline.text()).not.toContain('還沒有紀錄')
    await button(timeline, '重新載入')!.trigger('click')
    await flushPromises()
    expect(logCalls).toBe(2)
  })

  it('沒有紀錄：能記錄的人看到說明與輸入框，家庭版面的唯讀者只看到一句', async () => {
    mockGet(caseRoutes(visitCase(), []))
    const writable = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    expect(writable.wrapper.get('.case-timeline').text()).toContain('每次致電或傳訊後記一筆')
    cleanup()

    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    mockGet({
      ...caseRoutes(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past', history: [] }), []),
      '/admin/admissions/records': [linked],
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': [],
    })
    const readonly = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user: admissionsViewer(), admissions: true })
    const timeline = readonly.wrapper.get('.case-timeline')
    expect(timeline.find('textarea').exists()).toBe(false)
    expect(timeline.text()).toContain('還沒有紀錄。')
    expect(timeline.text()).not.toContain('記錄聯絡')
  })
})
