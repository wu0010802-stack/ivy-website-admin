import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, api } from '../api/client'
import { useAuthStore } from '../stores/auth'

afterEach(() => vi.restoreAllMocks())

function loggedInStore() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = { id: 'u1', email: 'a@ivy.example', role: 'super_admin', is_active: true, campus_keys: [], line_linked: false } as never
  return auth
}

describe('登出要等伺服器確認', () => {
  it('請求失敗時保留登入狀態，讓使用者可以重試', async () => {
    const auth = loggedInStore()
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(auth.logout()).rejects.toThrow()
    expect(auth.user).not.toBeNull()
  })

  it('伺服器成功或回 401（session 早已失效）都清除本地狀態', async () => {
    const ok = loggedInStore()
    vi.spyOn(api, 'post').mockResolvedValue(undefined)
    await ok.logout()
    expect(ok.user).toBeNull()

    vi.restoreAllMocks()
    const expired = loggedInStore()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(401, '未登入'))
    await expired.logout()
    expect(expired.user).toBeNull()
  })
})
