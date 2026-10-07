import { afterEach, describe, expect, it, vi } from 'vitest'
import VisitDetailView from '../views/VisitDetailView.vue'
import { cleanup, mockGet } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.useRealTimers() })
const today = { id: 's-today', slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }

async function mountDetail(data: Record<string, unknown>) {
  mockGet(caseRoutes(data))
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })).wrapper
}

describe('案件頁首（2026-10-06 方向 C）', () => {
  it('寫家長・孩子、參觀時間，旁邊是台北時間的「結束了 2 小時」（暖黃）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z')) // 台北 13:00
    const wrapper = await mountDetail(visitCase({ slot: today, slot_id: today.id, display_status: 'past' }))
    expect(wrapper.get('h2.detail__title').text()).toBe('林小姐・小安')
    const relative = wrapper.get('.case-hero__relative')
    expect(relative.text()).toBe('結束了 2 小時')
    expect(relative.attributes('data-tone')).toBe('ended')
    expect(wrapper.get('.detail__when').text()).toContain('10:00–11:00')
  })

  it('還沒開始寫「還有 N 天」；已取消不寫相對時間', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T02:00:00Z')) // 台北 10/3 10:00
    const upcoming = await mountDetail(visitCase({ slot: today, slot_id: today.id }))
    expect(upcoming.get('.case-hero__relative').text()).toBe('還有 3 天')
    cleanup()
    const cancelled = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', slot: today, slot_id: today.id, cancelled_at: '2026-10-02T02:00:00Z' }))
    expect(cancelled.find('.case-hero__relative').exists()).toBe(false)
  })

  it('送出時間與參觀時間都沒有前綴，參觀時間那行給報讀軟體一個看不見的標籤', async () => {
    const wrapper = await mountDetail(visitCase())
    expect(wrapper.get('.case-hero__sub').text()).not.toContain('參觀時間')
    const label = wrapper.get('.detail__when .visually-hidden')
    expect(label.text()).toBe('參觀時間：')
    expect(label.element.nextElementSibling?.classList.contains('num')).toBe(true)
  })

  it('撥號在頁首（桌機也有）；沒有孩子姓名時標題只有家長', async () => {
    const wrapper = await mountDetail(visitCase({ child_name: null }))
    const call = wrapper.get('a.detail__call')
    expect(call.attributes('href')).toBe('tel:0912000001')
    expect(call.text()).toBe('撥號')
    expect(call.attributes('aria-label')).toBe('撥號給家長 0912000001')
    expect(wrapper.get('h2.detail__title').text()).toBe('林小姐')
  })
})
