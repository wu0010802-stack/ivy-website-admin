import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { getAreaPeerFees } from '../api/admissions'

afterEach(() => vi.restoreAllMocks())

it('getAreaPeerFees 帶校區、半徑與年齡', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
  await getAreaPeerFees('yihua', 3, 4)
  expect(get).toHaveBeenCalledWith('/admin/admissions/area/fees?campus_key=yihua&radius_km=3&age=4')
})
