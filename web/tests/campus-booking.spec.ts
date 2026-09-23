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
