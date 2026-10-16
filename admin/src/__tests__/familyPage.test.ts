// 預約明細當家庭頁的純函式（docs/specs/2026-10-05-visit-family-page-design.md 5.2、5.4、5.5、6）。
import { describe, expect, it } from 'vitest'
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from '../api/types'
import { stageMeta } from '../admissions/constants'
import {
  arrivedAt, arrivedLabel, detailOrigin, familyHistory, familyLastHandled, familyNotes, latestContact, personLabel,
  recruitmentEventChanges, visitRequestPath,
} from '../admissions/family'

const history = (changes: Partial<VisitHistoryOut> = {}): VisitHistoryOut => ({
  id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null,
  before: null, after: null, reason: null, created_at: '2026-10-01T02:12:00Z', ...changes,
})
const recruitmentEvent = (changes: Partial<RecruitmentEvent> = {}): RecruitmentEvent => ({
  id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' },
  actor_user_id: 'desk', actor_name: 'desk@example.invalid', created_at: '2026-10-06T02:35:00Z', ...changes,
})
const note = (changes: Partial<VisitContactNoteOut> = {}): VisitContactNoteOut => ({
  id: 'n1', note: '提醒參觀時間', created_at: '2026-10-03T06:05:00Z', created_by: 'desk',
  created_by_display_name: '櫃台小美', created_by_email: 'desk@example.invalid', ...changes,
})
const log = (changes: Partial<ContactLog> = {}): ContactLog => ({
  id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true,
  note: '下週一前回覆', next_follow_up_at: '2026-10-13T02:00:00Z', created_by: 'desk', created_by_name: '櫃台小美',
  created_at: '2026-10-08T08:21:00Z', ...changes,
})

describe('stageMeta（訪視明細與家庭版面共用）', () => {
  it('階段文字與色調；退出寫從哪一段退', () => {
    expect(stageMeta({ stage: 'visited' })).toEqual({ label: '已訪視', tone: 'info' })
    expect(stageMeta({ stage: 'deposited' })).toEqual({ label: '已預繳', tone: 'warning' })
    expect(stageMeta({ stage: 'enrolled' })).toEqual({ label: '已註冊', tone: 'success' })
    expect(stageMeta({ stage: 'withdrawn', withdrawn_from: 'enrolled', withdrawn_at: '2026-10-09T00:00:00Z' })).toEqual({ label: '已退註冊', tone: 'danger' })
  })
})

describe('到場時間與頁首', () => {
  it('取最後一次標記已到場；沒有就是 null', () => {
    expect(arrivedAt([history(), history({ id: 'h2', event_type: 'completed', created_at: '2026-10-06T02:35:00Z' })])).toBe('2026-10-06T02:35:00Z')
    expect(arrivedAt([history()])).toBeNull()
  })
  it('到場日寫 MM/DD', () => {
    expect(arrivedLabel('2026-10-06')).toBe('10/06 到場')
  })
})

describe('聯絡紀錄合併（5.4）', () => {
  it('新的在上；依到場時間標參觀前／參觀後；參觀後聯絡有管道與結果', () => {
    const rows = familyNotes([note(), note({ id: 'n2', note: '到場後補記', created_at: '2026-10-07T01:00:00Z' })], [log()], '2026-10-06T02:35:00Z')
    expect(rows.map((row) => [row.key, row.phase])).toEqual([
      ['admissions-l1', 'after'], ['booking-n2', 'after'], ['booking-n1', 'before'],
    ])
    expect(rows[0]).toMatchObject({ headline: '電話・聯絡到了', author: '櫃台小美', note: '下週一前回覆', nextFollowUpAt: '2026-10-13T02:00:00Z' })
    expect(rows[2]).toMatchObject({ headline: '', author: '櫃台小美', note: '提醒參觀時間', nextFollowUpAt: null })
  })
  it('同一時間參觀後排前面；沒有到場時間時預約紀錄都算參觀前', () => {
    const at = '2026-10-08T08:20:00Z'
    expect(familyNotes([note({ created_at: at })], [log({ contacted_at: at })], null).map((row) => [row.kind, row.phase])).toEqual([
      ['admissions', 'after'], ['booking', 'before'],
    ])
  })
})

describe('案件歷程合併（5.5）', () => {
  it('新的在上；同一時間招生事件在預約事件上面', () => {
    const rows = familyHistory(
      [history(), history({ id: 'h2', event_type: 'completed', source: 'staff', created_at: '2026-10-06T02:35:00Z' })],
      [recruitmentEvent(), recruitmentEvent({ id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', created_at: '2026-10-14T01:30:00Z' })],
    )
    expect(rows.map((row) => row.key)).toEqual(['admissions-e2', 'admissions-e1', 'booking-h2', 'booking-h1'])
  })
  it('招生事件的變更行：階段變化與保留座位', () => {
    expect(recruitmentEventChanges(recruitmentEvent({ event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited' }))).toEqual(['已訪視 → 已預繳'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'seat_reserved', from_stage: 'deposited', to_stage: 'deposited', metadata_json: { grade: '小班', school_year: 115, semester: 1 },
    }))).toEqual(['小班・115 上學期'])
    expect(recruitmentEventChanges(recruitmentEvent())).toEqual([])
  })

  it('退出事件寫出分類；沒有分類（改版前退出）就不多一行（2026-10-15）', () => {
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'withdrawn', from_stage: 'deposited', to_stage: 'withdrawn', metadata_json: { withdraw_reason_category: '費用考量' },
    }))).toEqual(['已預繳 → 退預繳／退註冊', '原因：費用考量'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'withdrawn', from_stage: 'deposited', to_stage: 'withdrawn', metadata_json: null,
    }))).toEqual(['已預繳 → 退預繳／退註冊'])
  })

  it('招生事件的變更行：修改招生資料只列欄位中文、排下次聯絡寫時間或不用再追（2026-10-15）', () => {
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'details_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { fields: ['phone', 'tour_guide_name', 'tour_guide_user_id', 'mystery'] },
    }))).toEqual(['改了：電話、帶參觀老師、mystery'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'follow_up_updated', from_stage: 'deposited', to_stage: 'deposited',
      metadata_json: { follow_up_at: '2026-10-20T02:00:00Z', previous_follow_up_at: null, owner_changed: true },
    }))).toEqual(['下次聯絡：2026/10/20 10:00', '負責人已變更'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'follow_up_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { follow_up_at: null, previous_follow_up_at: '2026-10-20T02:00:00Z', owner_changed: false },
    }))).toEqual(['改為不用再追'])
  })

  it('排下次聯絡：只換負責人（前後時間相同）時不寫下次聯絡那一行；時間真的改了才寫（W2-12）', () => {
    const followUp = (metadata: Record<string, unknown>) => recruitmentEvent({
      event_type: 'follow_up_updated', from_stage: 'visited', to_stage: 'visited', metadata_json: metadata,
    })
    // 只換負責人：兩個時間相同，只有「負責人已變更」。
    expect(recruitmentEventChanges(followUp({
      follow_up_at: '2026-10-20T02:00:00Z', previous_follow_up_at: '2026-10-20T02:00:00Z', owner_changed: true,
    }))).toEqual(['負責人已變更'])
    // 本來就沒排、只換負責人：兩個都是 null，一樣只有「負責人已變更」，不會寫成「改為不用再追」。
    expect(recruitmentEventChanges(followUp({
      follow_up_at: null, previous_follow_up_at: null, owner_changed: true,
    }))).toEqual(['負責人已變更'])
    // 正向對照：同一個時間欄位只要前後不同就會寫出來，舊值有值、新值也有值時寫新值。
    expect(recruitmentEventChanges(followUp({
      follow_up_at: '2026-10-22T02:00:00Z', previous_follow_up_at: '2026-10-20T02:00:00Z', owner_changed: false,
    }))).toEqual(['下次聯絡：2026/10/22 10:00'])
    expect(recruitmentEventChanges(followUp({
      follow_up_at: '2026-10-22T02:00:00Z', previous_follow_up_at: '2026-10-20T02:00:00Z', owner_changed: true,
    }))).toEqual(['下次聯絡：2026/10/22 10:00', '負責人已變更'])
  })

  it('修改招生資料也算家庭頁的「最後處理」（H8）', () => {
    const edited = recruitmentEvent({
      id: 'e9', event_type: 'details_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { fields: ['phone'] }, created_at: '2026-10-15T03:00:00Z',
    })
    expect(familyLastHandled([], [recruitmentEvent(), edited], [], null)).toMatchObject({ what: '修改招生資料', at: '2026-10-15T03:00:00Z' })
  })
})

describe('最後處理與最近聯絡', () => {
  it('取預約歷程、招生事件、參觀後聯絡裡最新的一筆園方操作；自己寫「你」', () => {
    const handled = familyLastHandled(
      [history({ id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_display_name: '櫃台小美', created_at: '2026-10-06T02:35:00Z' })],
      [recruitmentEvent()],
      [log()],
      'desk',
    )
    expect(handled).toEqual({ who: '你', at: '2026-10-08T08:21:00Z', what: '記錄聯絡', self: true })
    const other = familyLastHandled([], [recruitmentEvent({ actor_user_id: 'ca', actor_name: 'ca@example.invalid' })], [], 'desk')
    expect(other).toMatchObject({ who: 'ca', what: '建立訪視（官網預約到場）', self: false })
  })
  it('到場與建立訪視同一時間時，維持預約的「標記已到場」', () => {
    const at = '2026-10-06T02:35:00Z'
    const handled = familyLastHandled(
      [history({ event_type: 'completed', source: 'staff', actor_user_id: 'desk', created_at: at })], [recruitmentEvent({ created_at: at })], [], null,
    )
    expect(handled?.what).toBe('標記已到場')
  })
  it('最近聯絡取聯絡時間最新的一筆', () => {
    expect(latestContact([log({ id: 'old', contacted_at: '2026-10-01T00:00:00Z' }), log()])?.id).toBe('l1')
    expect(latestContact([])).toBeNull()
  })
  it('名字是 Email 時只寫 @ 前面', () => {
    expect(personLabel('amy@ivy.example')).toBe('amy')
    expect(personLabel('林老師')).toBe('林老師')
    expect(personLabel(null)).toBe('')
  })
})

describe('招生入口與返回（第 6 節）', () => {
  const canAll = () => true
  const noBooking = (capability: string) => capability !== 'booking.read'
  it('有預約且看得到預約：開預約明細；否則 null（開抽屜）', () => {
    expect(visitRequestPath('vr-1', canAll)).toBe('/visit-requests/vr-1')
    expect(visitRequestPath(null, canAll)).toBeNull()
    expect(visitRequestPath('vr-1', noBooking)).toBeNull()
  })
  it('上一頁是招生入學、案件列表或其他', () => {
    expect(detailOrigin('/admissions?campus=yihua&tab=funnel')).toBe('admissions')
    expect(detailOrigin('/visit-requests?group=past')).toBe('visit-list')
    expect(detailOrigin('/visit-requests/abc')).toBe('other')
    expect(detailOrigin(undefined)).toBe('other')
  })
})
