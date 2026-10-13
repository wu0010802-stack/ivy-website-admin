import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, CSRF_INVALID_DETAIL, api, setCsrfToken } from '../api/client'
import type { FeatureFlags, LoginResponse, MeResponse, UserOut } from '../api/types'
import { announceSignedIn } from '../composables/sessionChannel'
import { resetVisitStaff } from '../composables/useVisitStaff'
import { clearVisitNoteDrafts } from '../composables/visitNoteDraft'
import { useOpenRequestsStore } from './openRequests'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserOut | null>(null)
  const csrfToken = ref<string | null>(null)
  // 部署開關；讀不到（尚未登入、舊後端）一律當關閉。
  const features = ref<FeatureFlags>({ admissions: false, password_reset_email: false })
  const isLoading = ref(false)
  // 這次登入最晚到什麼時候（登入滿 12 小時；/auth/me 的 session_max_expires_at）。
  // 密碼登入的回應沒有這個值，之後第一次 /auth/me（閒置延長最多 10 分鐘一次）才補上。
  const sessionMaxExpiresAt = ref<string | null>(null)
  /**
   * 按下登出時先換到登入頁、不先打 API：頁面有未儲存的修改時，離頁攔截會先問
   * 「放棄修改？」。選留在這頁就什麼都不做，仍是登入狀態；答應了，router 的
   * beforeEach 看到這個旗標才真的呼叫 logout()。原本先登出再換頁，選留在這頁
   * 會卡在已登出、側欄帳號區消失、之後每次儲存都 401 的頁面。
   */
  const logoutPending = ref(false)
  /**
   * 被登出（401、CSRF 對不上、換了帳號）之前登入的是誰。同一個瀏覽器在別的分頁換成另一個帳號時，
   * cookie 裡已經是對方的 session：登入頁恢復 session 前要先比對，不同人就不能自動登進去
   * （router/index.ts 的 authGuard 用 restoreSession({ expectUserId })）。只放記憶體：重新整理
   * 或從書籤開登入頁沒有這個值，照舊恢復 cookie 裡的 session。登入成功或恢復成功就清掉。
   */
  const previousUserId = ref<string | null>(null)

  async function login(email: string, password: string): Promise<void> {
    isLoading.value = true
    try {
      const result = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
      })
      user.value = result.user
      features.value = result.features ?? { admissions: false, password_reset_email: false }
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
      forgetPreviousUser(result.user.id)
      announceSignedIn()
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 登入或恢復成功之後清掉 previousUserId。被迫登出（逾時、別的分頁換了帳號）時案件草稿與頁首
   * 數字刻意留著，讓同一個人登回來接著寫；但登進來的是另一個人（櫃台共用電腦）時不能帶給他：
   * 上一位沒送出的聯絡紀錄會出現在對方的案件頁、以對方的名義送出（2026-10-13）。
   */
  function forgetPreviousUser(nextUserId: string): void {
    if (previousUserId.value && previousUserId.value !== nextUserId) {
      clearVisitNoteDrafts()
      useOpenRequestsStore().reset()
    }
    previousUserId.value = null
  }

  /** 清掉本地登入狀態（不打 API）。401 的集中處理會用到。 */
  function clearSession(): void {
    resetVisitStaff()
    user.value = null
    features.value = { admissions: false, password_reset_email: false }
    csrfToken.value = null
    setCsrfToken(null)
    sessionMaxExpiresAt.value = null
  }

  /**
   * 被登出（API 回 401／CSRF 對不上／發現換了帳號）：先記住原本是誰，再清掉本地登入狀態。
   * 導去登入頁之後 authGuard 靠 previousUserId 分辨「同一個人重新登入」與「cookie 已經是別人」。
   */
  function expireSession(): void {
    previousUserId.value = user.value?.id ?? previousUserId.value
    clearSession()
  }

  /**
   * 伺服器確認撤銷之後才清本地狀態。原本不論成敗都清：請求沒送到時畫面
   * 看起來已登出（登出鈕也消失），但 HttpOnly cookie 與伺服器 session 都
   * 還有效，共用電腦的下一個人重新整理就回到後台。失敗時丟出錯誤讓畫面
   * 提示重試；401 代表 session 本來就失效了，當作已登出。
   * 403「CSRF token 無效」是別的分頁重新登入過、cookie 已經換成新的 session：這個分頁原本的
   * session 早就不在了，再按幾次都是 403。也當作已登出，回 'session-changed' 讓 router 帶
   * reason 導到登入頁（api/client.ts 對其他請求遇到這種 403 也是同一個說法）。
   */
  async function logout(): Promise<'signed-out' | 'session-changed'> {
    let outcome: 'signed-out' | 'session-changed' = 'signed-out'
    try {
      await api.post('/auth/logout')
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.detail === CSRF_INVALID_DETAIL) outcome = 'session-changed'
      else if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    const signedInAs = user.value?.id ?? null
    clearSession()
    // 主動登出就不是「被換帳號」：沒有需要比對的人。例外是 session-changed（別的分頁已經換成別人
    // 登入）：記住是誰，之後按上一頁回後台時 authGuard 才不會拿 cookie 裡別人的 session 恢復成對方
    // （2026-10-13，9ac5fbf 只擋了被動登出那條路）。
    previousUserId.value = outcome === 'session-changed' ? signedInAs : null
    // 主動登出才清案件草稿；逾時被導回登入（只走 clearSession）要留著讓人接著寫。
    clearVisitNoteDrafts()
    return outcome
  }

  /**
   * 用 cookie 裡的 session 恢復登入。只有 401 代表真的沒登入；斷線、API 重啟
   * （代理回 502／503）時把錯誤丟出去，讓 router 說「連不上伺服器」，不要當成
   * 已登出——session 其實還有效，重新整理就能回到原本的頁面。
   *
   * 傳 expectUserId（有值）時，cookie 裡是別的帳號就什麼都不寫入、回 'other-user'：
   * 別的分頁換了帳號後，這個分頁不能直接變成對方（authGuard 的登入頁分支用）。
   * 回傳 'restored'＝已恢復、'none'＝cookie 裡沒有有效登入（401）。
   */
  async function restoreSession(options: { expectUserId?: string | null } = {}): Promise<'restored' | 'other-user' | 'none'> {
    isLoading.value = true
    try {
      const result = await api.get<MeResponse>('/auth/me')
      // 先比對再寫入：不能讓這個分頁拿到對方的身分與 CSRF token。
      if (options.expectUserId && result.user.id !== options.expectUserId) return 'other-user'
      user.value = result.user
      features.value = result.features ?? { admissions: false, password_reset_email: false }
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
      sessionMaxExpiresAt.value = result.session_max_expires_at ?? null
      forgetPreviousUser(result.user.id)
      announceSignedIn()
      return 'restored'
    } catch (error) {
      user.value = null
      sessionMaxExpiresAt.value = null
      features.value = { admissions: false, password_reset_email: false }
      csrfToken.value = null
      setCsrfToken(null)
      if (!(error instanceof ApiError && error.status === 401)) throw error
      return 'none'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重新取得登入狀態，但失敗時不清本地狀態（頁面上可能還有未儲存的修改）。
   * 閒置延長（sessionKeepAlive）與「登入已逾時、我已重新登入」用：成功時換上
   * 這個 session 的 CSRF token（在別的分頁重新登入後，新 session 的 token 不同）。
   * 傳 expectedUserId 時，回來的是別的帳號就什麼都不寫、回 'other-user'。
   */
  async function refreshSession(expectedUserId?: string): Promise<'ok' | 'other-user' | 'failed'> {
    try {
      const result = await api.get<MeResponse>('/auth/me')
      // 先比對再寫入：cookie 已換成別人時，這一頁（可能有原本帳號未儲存的修改）
      // 不能拿到對方的身分與 CSRF token。
      if (expectedUserId && result.user.id !== expectedUserId) return 'other-user'
      user.value = result.user
      features.value = result.features ?? { admissions: false, password_reset_email: false }
      csrfToken.value = result.csrf_token
      setCsrfToken(result.csrf_token)
      sessionMaxExpiresAt.value = result.session_max_expires_at ?? null
      return 'ok'
    } catch {
      return 'failed'
    }
  }

  return { user, features, csrfToken, isLoading, sessionMaxExpiresAt, logoutPending, previousUserId, login, logout, restoreSession, refreshSession, clearSession, expireSession }
})
