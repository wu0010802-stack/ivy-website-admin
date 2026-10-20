import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { useCampusBooking } from '../app/composables/useCampusBooking'

afterEach(() => vi.unstubAllGlobals())

describe('booking config transport failures', () => {
  it('preserves a failed request as an error so the form can offer retry', async () => {
    const failure = new Error('API unavailable')
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(failure))
    let fetchConfig!: () => Promise<unknown>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<unknown>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    await expect(fetchConfig()).rejects.toBe(failure)
  })
})

describe('booking config shared cache (2026-10-20)', () => {
  const response = { campus_key: 'minghua', mode: 'form', version: 3, line_url: null, phone: null, external_url: null, message: null }

  it('選校卡讀過的設定放進同一個 key，useCampusBooking 選這校時直接沿用', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('computed', computed)
    const nuxtApp = { isHydrating: false, payload: { data: {} as Record<string, unknown> }, static: { data: {} } }
    const { loadCampusBooking, bookingConfigKey } = await import('../app/composables/useCampusBooking')
    const first = await loadCampusBooking(nuxtApp, 'minghua')
    expect(first.version).toBe(3)
    expect(await loadCampusBooking(nuxtApp, 'minghua')).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    let options!: { getCachedData: (key: string, app: unknown, ctx: { cause: string }) => unknown }
    vi.stubGlobal('useAsyncData', (_key: unknown, _handler: unknown, opts: typeof options) => {
      options = opts
      return {}
    })
    const { useCampusBooking } = await import('../app/composables/useCampusBooking')
    useCampusBooking('minghua')
    const key = bookingConfigKey('minghua')
    expect(options.getCachedData(key, nuxtApp, { cause: 'initial' })).toBe(first)
    // 重試、BOOKING_CONFIG_CHANGED 走手動 refresh，一律重抓
    expect(options.getCachedData(key, nuxtApp, { cause: 'refresh:manual' })).toBeUndefined()
  })

  it('超過新鮮期限就不沿用', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(response))
    const nuxtApp = { isHydrating: false, payload: { data: {} as Record<string, unknown> } }
    const { loadCampusBooking, cachedCampusBooking, bookingConfigKey } = await import('../app/composables/useCampusBooking')
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    await loadCampusBooking(nuxtApp, 'renwu')
    spy.mockReturnValue(now + 6 * 60_000)
    expect(cachedCampusBooking(nuxtApp, bookingConfigKey('renwu'))).toBeUndefined()
    spy.mockRestore()
  })
})
