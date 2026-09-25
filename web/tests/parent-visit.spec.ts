import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useParentVisit } from '../app/composables/useParentVisit'
import { parentVisitCampus } from '../app/utils/parent-visit'

const visit = {
  id: 'visit-1', campus_key: 'minghua', status: 'confirmed', phone_masked: '0999***001',
  campus_name: '明華校', campus_active: true, campus_phone: '07-3000000',
  slot: { id: 'slot-1', slot_date: '2026-10-10', start_time: '10:00:00', end_time: '11:00:00' },
  confirmed_at: null, cancelled_at: null, hold_expires_at: null, created_at: '2026-09-23T00:00:00Z',
  change_deadline: '2026-10-09T02:00:00Z', change_deadline_hours: 24, can_cancel: true, can_reschedule: true
}
const failure = (status: number, code = '') => ({ response: { status }, data: { detail: { code } } })
afterEach(() => vi.unstubAllGlobals())

describe('parent visit management', () => {
  it('retries a transient exchange failure using the token held only in memory', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(failure(502)).mockResolvedValueOnce(visit)
    vi.stubGlobal('$fetch', fetch)
    const state = useParentVisit()
    await state.initialize('test-link')
    expect(state.visit.value).toBeNull()
    expect(state.unavailable.value).toBe(false)
    expect(state.error.value).toContain('重新載入')
    await state.reload()
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: { token: 'test-link' }, headers: { 'X-Ivy-Parent': '1' } })
    expect(state.visit.value?.phone_masked).toBe('0999***001')
    await state.reload()
    expect(fetch.mock.calls[2]?.[0]).toMatch(/\/me$/)
  })

  it('does not fall back to a different existing session for an invalid explicit link', async () => {
    const fetch = vi.fn().mockRejectedValue(failure(401, 'TOKEN_INVALID'))
    vi.stubGlobal('$fetch', fetch)
    const state = useParentVisit()
    await state.initialize('expired-link')
    expect(state.unavailable.value).toBe(true)
    expect(state.visit.value).toBeNull()
    await state.reload()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the original confirmed slot after sending a reschedule request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(visit).mockResolvedValueOnce({ id: 'change-1', status: 'pending' })
    vi.stubGlobal('$fetch', fetch)
    const state = useParentVisit()
    await state.initialize()
    await state.requestReschedule('slot-2')
    expect(state.visit.value?.slot?.id).toBe('slot-1')
    expect(state.reschedulePending.value).toBe(true)
    expect(state.notice.value).toContain('原時段仍保留')
    await state.requestReschedule('slot-2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retains the cancellation receipt without reloading the revoked session', async () => {
    const cancelled = { ...visit, status: 'cancelled', can_cancel: false, can_reschedule: false }
    const fetch = vi.fn().mockResolvedValueOnce(visit).mockResolvedValueOnce(cancelled)
    vi.stubGlobal('$fetch', fetch)
    const state = useParentVisit()
    await state.initialize()
    await state.cancelVisit()
    expect(state.visit.value?.status).toBe('cancelled')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('restores pending reschedule status after reloading the page', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ...visit, reschedule_pending: true }))
    const state = useParentVisit()
    await state.initialize()
    expect(state.reschedulePending.value).toBe(true)
    expect(state.notice.value).toContain('原時段仍保留')
  })

  it('clears displayed private data when an operation discovers an expired session', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(visit).mockRejectedValueOnce(failure(401)))
    const state = useParentVisit()
    await state.initialize()
    await state.cancelVisit()
    expect(state.visit.value).toBeNull()
    expect(state.unavailable.value).toBe(true)
  })

  it('uses updated server permissions after the change deadline passes', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(visit).mockRejectedValueOnce(failure(409, 'CHANGE_DEADLINE_PASSED')).mockResolvedValueOnce({ ...visit, can_cancel: false, can_reschedule: false }))
    const state = useParentVisit()
    await state.initialize()
    await state.cancelVisit()
    expect(state.visit.value?.can_cancel).toBe(false)
    expect(state.error.value).toContain('聯絡園所')
  })

  it('ignores an exchange response arriving after leaving the page', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('$fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
    const state = useParentVisit()
    const loading = state.initialize('test-link')
    state.dispose()
    finish(visit)
    await loading
    expect(state.visit.value).toBeNull()
  })

  it('accepts a new link in the same page after an expired link', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValueOnce(failure(401)).mockResolvedValueOnce(visit))
    const state = useParentVisit()
    await state.initialize('expired-link')
    await state.initialize('new-link')
    expect(state.unavailable.value).toBe(false)
    expect(state.visit.value?.id).toBe('visit-1')
  })

  it('a late response from an older link cannot overwrite a newer link', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ ...visit, id: 'visit-2' })
    vi.stubGlobal('$fetch', fetch)
    const state = useParentVisit()
    const first = state.initialize('first-link')
    await state.initialize('second-link')
    finish(visit)
    await first
    expect(state.visit.value?.id).toBe('visit-2')
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true)
  })
})

// B08 審查：停用的分校不在公開內容裡，管理頁改用預約回應帶的校名與電話。
describe('parent visit campus', () => {
  const campuses = [
    { key: 'yihua', name: '義華校', phone: '07-3111111' },
    { key: 'minghua', name: '明華校', phone: '07-3222222' }
  ]

  it('uses the published campus while it is open', () => {
    expect(parentVisitCampus(visit, campuses)).toEqual({ key: 'minghua', name: '明華校', phone: '07-3222222', paused: false, listed: true })
  })

  it('shows a paused campus by the name and phone in the visit, without listing other campuses', () => {
    const paused = { ...visit, campus_key: 'renwu', campus_name: '仁武校', campus_active: false, campus_phone: '07-3733333' }
    expect(parentVisitCampus(paused, campuses)).toEqual({ key: 'renwu', name: '仁武校', phone: '07-3733333', paused: true, listed: false })
    // 官網快取還列著剛停用的分校：也不連到分校頁與預約頁。
    expect(parentVisitCampus({ ...visit, campus_active: false }, campuses)?.listed).toBe(false)
  })

  it('treats an older API response without campus fields as open', () => {
    expect(parentVisitCampus({ campus_key: 'renwu' }, campuses)).toEqual({ key: 'renwu', name: '', phone: null, paused: false, listed: false })
    expect(parentVisitCampus(null, campuses)).toBeNull()
  })

  it('offers rebooking only when the campus booking page exists', () => {
    const page = readFileSync(fileURLToPath(new URL('../app/pages/visit/manage.vue', import.meta.url)), 'utf8')
    const rebook = page.split('\n').find(line => line.includes('>重新預約</NuxtLink>'))
    expect(rebook).toContain("visitCampus?.listed")
  })

  it('does not suggest rebooking after cancelling at a paused campus', async () => {
    const paused = { ...visit, campus_active: false, can_reschedule: false }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(paused).mockResolvedValueOnce({ ...paused, status: 'cancelled', can_cancel: false }))
    const state = useParentVisit()
    await state.initialize()
    await state.cancelVisit()
    expect(state.notice.value).toContain('已取消')
    expect(state.notice.value).not.toContain('重新預約')
  })

  it('refreshes the visit when the campus is paused while the page is open', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(visit).mockRejectedValueOnce(failure(409, 'BOOKING_UNAVAILABLE'))
      .mockResolvedValueOnce({ ...visit, campus_active: false, can_reschedule: false }))
    const state = useParentVisit()
    await state.initialize()
    await state.requestReschedule('slot-2')
    expect(state.visit.value?.campus_active).toBe(false)
    expect(state.visit.value?.can_reschedule).toBe(false)
    expect(state.error.value).toContain('聯絡園所')
  })
})
