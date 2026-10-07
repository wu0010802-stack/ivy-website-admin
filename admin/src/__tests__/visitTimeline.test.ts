import { describe, expect, it } from 'vitest'
import { buildTimeline } from '../api/visitTimeline'

const note = (o: Record<string, unknown> = {}) => ({
  id: 'n1', note: '已致電，下週回覆', created_at: '2026-10-02T03:05:00Z',
  created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君', ...o,
}) as never
const event = (o: Record<string, unknown> = {}) => ({
  id: 'e1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null,
  before: null, after: { slot: { slot_date: '2026-10-05', start_time: '14:00:00', end_time: '15:00:00' } },
  reason: null, created_at: '2026-10-01T08:25:00Z', ...o,
}) as never
const logged = (o: Record<string, unknown> = {}) => event({
  id: 'e2', event_type: 'contact_logged', source: 'staff', actor_user_id: 'u1', actor_email: 'amy@ivy.example',
  actor_display_name: '怡君', before: { follow_up_at: null }, after: { follow_up_at: '2026-10-05T02:00:00Z' },
  created_at: '2026-10-02T03:05:02Z', ...o,
})

describe('buildTimeline（2026-10-06 方向 C）', () => {
  it('聯絡紀錄和同一個交易寫的 contact_logged 合成一筆，下次聯絡掛在那筆下面', () => {
    const rows = buildTimeline({ notes: [note()], history: [event(), logged()], staff: [] })
    expect(rows.map((r) => [r.kind, r.title])).toEqual([['note', '記了一筆'], ['event', '家長從官網送出']])
    expect(rows[0]).toMatchObject({ person: '怡君', personEmail: 'amy@ivy.example', body: '已致電，下週回覆', followUp: '下次聯絡 2026/10/05 10:00' })
    expect(rows[1]!.tone).toBe('parent')
  })

  it('清掉下次聯絡寫「不用再追」；不是同一個人或差太久的 contact_logged 照歷程列', () => {
    const cleared = buildTimeline({ notes: [note()], history: [logged({ after: { follow_up_at: null } })], staff: [] })
    expect(cleared[0]!.followUp).toBe('不用再追')
    const other = buildTimeline({ notes: [note()], history: [logged({ actor_user_id: 'u2' }), logged({ id: 'e3', created_at: '2026-10-02T03:10:00Z' })], staff: [] })
    expect(other.filter((r) => r.kind === 'event').map((r) => r.key)).toEqual(['event-e3', 'event-e2'])
    expect(other.find((r) => r.kind === 'note')!.followUp).toBeNull()
  })

  it('新的在上；同一時間聯絡紀錄排在事件前面', () => {
    const same = '2026-10-03T01:00:00Z'
    const rows = buildTimeline({ notes: [note({ created_at: same })], history: [event({ id: 'e9', event_type: 'rescheduled', source: 'staff', created_at: same }), event()], staff: [] })
    expect(rows.map((r) => r.key)).toEqual(['note-n1', 'event-e9', 'event-e1'])
  })

  it('家庭版面：參觀前／後、參觀後聯絡的標題與排下次聯絡、事件標「預約」「招生」', () => {
    const log = { id: 'l1', contacted_at: '2026-10-07T02:00:00Z', channel: 'phone', reached: true, note: '媽媽說會預繳', next_follow_up_at: '2026-10-10T02:00:00Z', created_by_name: '怡君', created_by: 'u1', created_at: '2026-10-07T02:00:00Z' } as never
    const admissions = { id: 'r1', event_type: 'deposit_paid', from_stage: 'visited', to_stage: 'deposited', metadata_json: null, actor_name: 'amy@ivy.example', actor_user_id: 'u1', reason: null, created_at: '2026-10-08T02:00:00Z' } as never
    const arrived = '2026-10-06T02:30:00Z'
    const rows = buildTimeline({
      notes: [note()], history: [event(), event({ id: 'e5', event_type: 'completed', source: 'staff', created_at: arrived })], staff: [],
      family: { logs: [log], events: [admissions], arrivedAt: arrived },
    })
    expect(rows.map((r) => [r.key, r.phase, r.source])).toEqual([
      ['admissions-r1', '', '招生'],
      ['log-l1', 'after', ''],
      ['event-e5', '', '預約'],
      ['note-n1', 'before', ''],
      ['event-e1', '', '預約'],
    ])
    expect(rows[1]).toMatchObject({ title: '電話・聯絡到了', followUp: '排下次聯絡 2026/10/10 10:00' })
    expect(rows[0]!.personEmail).toBe('amy@ivy.example')
  })
})
