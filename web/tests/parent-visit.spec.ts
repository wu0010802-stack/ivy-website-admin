import { afterEach, describe, expect, it, vi } from 'vitest'
import { useParentVisit } from '../app/composables/useParentVisit'

const visit = {
  id: 'visit-1', campus_key: 'minghua', status: 'confirmed', phone_masked: '0999***001',
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
