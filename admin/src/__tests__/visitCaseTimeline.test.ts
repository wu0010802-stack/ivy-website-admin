import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitCaseTimeline from '../components/visit/VisitCaseTimeline.vue'
import { provideVisitCase, useVisitCase } from '../composables/useVisitCase'
import { admissionsViewer, button, cleanup, mockGet, mountWith, pathsTo, visit as admissionsVisit } from './admissionsTestKit'
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

  // 預覽面板只列最新幾筆（limit），其餘請打開完整案件頁（fullPath）。
  describe('limit／fullPath（預覽面板用）', () => {
    const noteAt = (n: number) => ({ id: `n${n}`, note: `紀錄${n}`, created_at: `2026-10-0${n}T01:00:00Z`, created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君' })
    const notes = [1, 2, 3, 4].map(noteAt)

    // 一個 host 提供同一筆案件，下面放幾個時間線（各自的 props）。
    async function mountTimelines(props: Record<string, unknown>[], list = notes) {
      mockGet(caseRoutes(visitCase(), list))
      const Host = defineComponent({
        setup() {
          provideVisitCase(useVisitCase(ref(VISIT_ID)))
          return () => h('div', props.map((p) => h(VisitCaseTimeline, p)))
        },
      })
      const { wrapper } = await mountWith(Host, { path: '/visit-requests' })
      return wrapper.findAll('.case-timeline')
    }

    it('limit 只留最新幾筆（新的在上），有 fullPath 就給連到完整案件頁的連結', async () => {
      const [timeline] = await mountTimelines([{ limit: 3, fullPath: '/visit-requests/case-a?list=view%3Dupcoming' }])
      const shown = timeline!.findAll('.timeline__item')
      expect(shown.map((li) => li.get('.timeline__text').text())).toEqual(['紀錄4', '紀錄3', '紀錄2'])
      const more = timeline!.get('.case-timeline__more')
      expect(more.text()).toBe('還有 1 筆，打開完整案件頁')
      expect(more.get('a').attributes('href')).toBe('/visit-requests/case-a?list=view%3Dupcoming')
    })

    it('limit 沒給 fullPath：仍寫出還有幾筆沒列（只是沒有連結），不悄悄少掉紀錄', async () => {
      const [timeline] = await mountTimelines([{ limit: 3 }])
      expect(timeline!.findAll('.timeline__item')).toHaveLength(3)
      const more = timeline!.get('.case-timeline__more')
      expect(more.text()).toBe('還有 1 筆')
      expect(more.find('a').exists()).toBe(false)
    })

    it('紀錄不超過 limit、或沒給 limit：全列，沒有「還有 N 筆」', async () => {
      const [capped, uncapped] = await mountTimelines([{ limit: 4, fullPath: '/visit-requests/case-a' }, {}])
      expect(capped!.findAll('.timeline__item')).toHaveLength(4)
      expect(capped!.find('.case-timeline__more').exists()).toBe(false)
      expect(uncapped!.findAll('.timeline__item')).toHaveLength(4)
      expect(uncapped!.find('.case-timeline__more').exists()).toBe(false)
    })

    it('標題的 id 每個實例各一個：兩份時間線同時存在，區塊名稱不會指到別人的標題', async () => {
      const [first, second] = await mountTimelines([{}, { limit: 3 }])
      const ids = [first!, second!].map((timeline) => {
        const labelledby = timeline.attributes('aria-labelledby')!
        const heading = timeline.get('h2.visually-hidden')
        expect(heading.attributes('id')).toBe(labelledby)
        expect(document.getElementById(labelledby)).toBe(heading.element)
        return labelledby
      })
      expect(new Set(ids).size).toBe(2)
    })
  })
})
