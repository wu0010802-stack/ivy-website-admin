import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, api, setCsrfToken } from '../api/client'
import type { UserOut } from '../api/types'
import { resetVisitStaff } from '../composables/useVisitStaff'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserOut | null>(null)
  const csrfToken = ref<string | null>(null)
  const isLoading = ref(false)
  /**
   * 按下登出時先換到登入頁、不先打 API：頁面有未儲存的修改時，離頁攔截會先問
   * 「放棄修改？」。選留在這頁就什麼都不做，仍是登入狀態；答應了，router 的
   * beforeEach 看到這個旗標才真的呼叫 logout()。原本先登出再換頁，選留在這頁
   * 會卡在已登出、側欄帳號區消失、之後每次儲存都 401 的頁面。
   */
  const logoutPending = ref(false)

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
    resetVisitStaff()
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

  /**
   * 用 cookie 裡的 session 恢復登入。只有 401 代表真的沒登入；斷線、API 重啟
   * （代理回 502／503）時把錯誤丟出去，讓 router 說「連不上伺服器」，不要當成
   * 已登出——session 其實還有效，重新整理就能回到原本的頁面。
   */
  async function restoreSession(): Promise<void> {
    isLoading.value = true
    try {
      const result = await api.get<{ csrf_token: string; user: UserOut }>('/auth/me')
      user.value = result.user
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
    } catch (error) {
      user.value = null
      csrfToken.value = null
      setCsrfToken(null)
      if (!(error instanceof ApiError && error.status === 401)) throw error
    } finally {
      isLoading.value = false
    }
  }

  return { user, csrfToken, isLoading, logoutPending, login, logout, restoreSession, clearSession }
})
