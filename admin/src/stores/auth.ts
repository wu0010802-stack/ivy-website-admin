import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, api, setCsrfToken } from '../api/client'
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

  /**
   * 伺服器確認撤銷之後才清本地狀態。原本不論成敗都清：請求沒送到時畫面
   * 看起來已登出（登出鈕也消失），但 HttpOnly cookie 與伺服器 session 都
   * 還有效，共用電腦的下一個人重新整理就回到後台。失敗時丟出錯誤讓畫面
   * 提示重試；401 代表 session 本來就失效了，當作已登出。
   */
  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    clearSession()
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
