// 家庭版面的聯絡紀錄與合併歷程（docs/specs/2026-10-05-visit-family-page-design.md 5.4、5.5）。
import { afterEach, describe, expect, it } from 'vitest'
import FamilyContactNotes from '../components/visit/FamilyContactNotes.vue'
import notesSource from '../components/visit/FamilyContactNotes.vue?raw'
import VisitHistoryTimeline from '../components/VisitHistoryTimeline.vue'
import type { FamilyNote } from '../admissions/family'
import { button, cleanup, mountWith } from './admissionsTestKit'

afterEach(cleanup)

const after: FamilyNote = {
  key: 'admissions-l1', kind: 'admissions', at: '2026-10-08T08:20:00Z', phase: 'after', author: '櫃台小美',
  note: '下週一前回覆', headline: '電話・聯絡到了', nextFollowUpAt: '2026-10-13T02:00:00Z',
}
const before: FamilyNote = {
  key: 'booking-n1', kind: 'booking', at: '2026-10-03T06:05:00Z', phase: 'before', author: '櫃台小美',
  note: '提醒參觀時間', headline: '', nextFollowUpAt: null,
}

describe('合併後的聯絡紀錄', () => {
  it('照傳進來的順序列；標參觀前／參觀後；參觀後有管道結果與排下次聯絡', async () => {
    const { wrapper } = await mountWith(FamilyContactNotes, { props: { notes: [after, before], logsFailed: false, canRecord: true } })
    const items = wrapper.findAll('.family-notes__item')
    expect(items.map((item) => item.attributes('data-phase'))).toEqual(['after', 'before'])
    expect(items[0]!.text()).toContain('參觀後')
    expect(items[0]!.text()).toContain('電話・聯絡到了')
    expect(items[0]!.text()).toContain('排下次聯絡 2026/10/13 10:00')
    expect(items[1]!.text()).toContain('參觀前')
    expect(items[1]!.text()).not.toContain('排下次聯絡')
    expect(wrapper.text()).toContain('參觀前記在預約、參觀後記在招生，這裡一起列')
  })

  it('沒有紀錄：能記錄的人看到說明，唯讀的人只看到一句', async () => {
    const writable = await mountWith(FamilyContactNotes, { props: { notes: [], logsFailed: false, canRecord: true } })
    expect(writable.wrapper.text()).toContain('每次致電或傳訊後用「記錄聯絡」記一筆')
    cleanup()
    const readonly = await mountWith(FamilyContactNotes, { props: { notes: [], logsFailed: false, canRecord: false } })
    expect(readonly.wrapper.text()).toContain('還沒有聯絡紀錄。')
    expect(readonly.wrapper.text()).not.toContain('記錄聯絡')
  })

  it('標題在窄螢幕可換行，不被右邊說明擠成「聯絡紀／錄」', () => {
    const css = notesSource.slice(notesSource.indexOf('<style scoped>'))
    expect(css).toMatch(/\.section__title\s*{[^}]*flex-wrap: wrap/)
    expect(css).toMatch(/\.section__title h2\s*{[^}]*flex: none/)
  })

  it('參觀後讀不到而且沒有任何紀錄：只顯示讀不到，不說還沒有紀錄；能重新載入', async () => {
    const { wrapper } = await mountWith(FamilyContactNotes, { props: { notes: [], logsFailed: true, canRecord: true } })
    expect(wrapper.text()).not.toContain('還沒有聯絡紀錄')
    expect(wrapper.text()).toContain('參觀後的聯絡紀錄讀不到')
    await button(wrapper, '重新載入')!.trigger('click')
    expect(wrapper.emitted('reload')).toHaveLength(1)
  })
})

describe('案件歷程合併招生事件', () => {
  const booking = [
    { id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-10-01T02:12:00Z' },
    { id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_email: 'desk@example.invalid', actor_display_name: '櫃台小美', before: null, after: null, reason: null, created_at: '2026-10-06T02:35:00Z' },
  ]
  const recruitment = [
    { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, actor_user_id: 'desk', actor_name: 'desk@example.invalid', created_at: '2026-10-06T02:35:00Z' },
    { id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-14T01:30:00Z' },
  ]

  it('沒傳招生事件：跟改版前一樣，沒有來源小標', async () => {
    const { wrapper } = await mountWith(VisitHistoryTimeline, { props: { events: booking, staff: [] } })
    expect(wrapper.findAll('.timeline__item strong').map((el) => el.text())).toEqual(['標記已到場', '家長從官網送出'])
    expect(wrapper.find('.timeline__source').exists()).toBe(false)
  })

  it('有傳：新的在上、同時間招生在上，標來源，招生事件寫階段變化與操作者', async () => {
    const { wrapper } = await mountWith(VisitHistoryTimeline, { props: { events: booking, staff: [], recruitmentEvents: recruitment } })
    const items = wrapper.findAll('.timeline__item')
    expect(items.map((item) => item.get('strong').text())).toEqual(['加上預繳', '建立訪視（官網預約到場）', '標記已到場', '家長從官網送出'])
    expect(items.map((item) => item.get('.timeline__source').text())).toEqual(['招生', '招生', '預約', '預約'])
    expect(items[0]!.text()).toContain('已訪視 → 已預繳')
    expect(items[0]!.get('.timeline__actor').text()).toBe('櫃台小美')
    expect(items[1]!.get('.timeline__actor').text()).toBe('desk')
  })
})
