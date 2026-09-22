import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, setCsrfToken } from '../api/client'
import type { UserOut } from '../api/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserOut | null>(null)
  const csrfToken = ref<string | null>(null)
  const isLoading = ref(false)

  async function login(email: string, password: string): Promise<void> {
    isLoading.value = true
    try {
      const result = await api.post<{ csrf_token: string; user: UserOut }>('/auth/login', {
        email,
        password,
      })
      user.value = result.user
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
    } finally {
      isLoading.value = false
    }
  }

  /** 清掉本地登入狀態（不打 API）。401 的集中處理會用到。 */
  function clearSession(): void {
    user.value = null
    csrfToken.value = null
    setCsrfToken(null)
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      user.value = null
      csrfToken.value = null
      setCsrfToken(null)
    }
  }

  async function restoreSession(): Promise<void> {
    isLoading.value = true
    try {
      const result = await api.get<{ csrf_token: string; user: UserOut }>('/auth/me')
      user.value = result.user
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
    } catch {
      user.value = null
      csrfToken.value = null
      setCsrfToken(null)
    } finally {
      isLoading.value = false
    }
  }

  return { user, csrfToken, isLoading, login, logout, restoreSession, clearSession }
})
