import { h } from 'vue'
import type { Router } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { setCsrfToken } from '../api/client'
import { notifyWarning } from '../composables/notify'
import { waitForSignIn } from '../composables/sessionChannel'
import { useAuthStore } from '../stores/auth'
import { hasUnsavedChanges, leaveWithoutAsking } from '../composables/useUnsavedChanges'

let recovering = false

/** 測試用：上一個測試若停在等待登入的對話框，recovering 會一直是 true，吞掉之後的 401。 */
export function resetUnauthorizedForTests(): void {
  recovering = false
}

/**
 * 導回登入頁時帶 reason=expired（跟 router/index.ts 的 signin／offline 同一組），
 * 登入頁據此說明是逾時、登入後會回到剛才的頁面。
 */
function loginRoute(router: Router) {
  const current = router.currentRoute.value
  return {
    name: 'login',
    query: { ...(current.fullPath !== '/' ? { redirect: current.fullPath } : {}), reason: 'expired' },
  }
}

/**
 * 任何 API 回 401（閒置逾時、登入滿 12 小時、帳號被停權或被登出）時：清掉
 * 登入狀態、導回登入頁，並記住原本要去的路徑。2026-09-29 起 session 閒置
 * 120 分鐘（WEBSITE_SESSION_IDLE_MINUTES）就失效，登入頁要講清楚為什麼
 * 被登出，不然看起來像系統壞掉。只在原本是登入狀態時觸發：第一次載入時
 * restoreSession 的 401 不算「被登出」。
 *
 * 目前頁面有未儲存的修改時不導頁（見 recoverInPlace）。
 */
export function redirectToLoginOnUnauthorized(router: Router): () => void {
  return () => {
    const authStore = useAuthStore()
    if (!authStore.user) return
    if (hasUnsavedChanges()) {
      void recoverInPlace(router)
      return
    }
    authStore.clearSession()
    if (router.currentRoute.value.name === 'login') return
    void router.replace(loginRoute(router))
  }
}

/**
 * 這一頁有還沒儲存的修改（例如寫長文寫到一半閒置逾時）：原本會清掉登入狀態
 * （連 CSRF token 一起）再導去登入頁，離頁保護只給「放棄／留下」，選留下也
 * 存不進去，修改只能自己複製出來（稽核 idle-timeout-loses-cms-edits）。
 *
 * 改成留在原頁：請本人在新分頁重新登入，回來按「我已重新登入」，這個分頁
 * 重新取得登入狀態與新的 CSRF token 後再按一次儲存。選「放棄修改並重新登入」
 * 才照原本的流程導去登入頁（不再問一次放棄修改）。
 * 別的分頁登入成功時（composables/sessionChannel.ts）自動接續；登入的不是同一個帳號就不接續。
 */
async function recoverInPlace(router: Router): Promise<void> {
  if (recovering) return
  recovering = true
  const authStore = useAuthStore()
  // 逾時前登入的是誰：別的分頁登入的若不是同一人，不能接續（修改會用別人的名義存）。
  const expectedUserId = authStore.user?.id ?? null
  let signIn = waitForSignIn()
  try {
    for (;;) {
      const loginHref = router.resolve({ name: 'login', query: { reason: 'expired' } }).href
      const dialog = ElMessageBox.confirm(
        h('div', null, [
          h('p', null, '登入已逾時，這一頁的修改還沒儲存。請在新分頁重新登入：登入後這裡會自動接續，再按一次儲存。'),
          h('p', null, [h('a', { href: loginHref, target: '_blank', rel: 'noopener' }, '在新分頁打開登入頁 ↗')]),
        ]),
        '登入已逾時',
        {
          confirmButtonText: '我已重新登入',
          cancelButtonText: '放棄修改並重新登入',
          type: 'warning',
          showClose: false,
          closeOnClickModal: false,
          closeOnPressEscape: false,
        },
      ).then(() => 'confirm' as const, () => 'cancel' as const)
      // 使用者按按鈕，或別的分頁登入成功（sessionChannel），哪個先到就照哪個走。
      const outcome = await Promise.race([dialog, signIn.promise.then(() => 'signed-in' as const)])
      if (outcome === 'cancel') {
        const route = loginRoute(router)
        authStore.clearSession()
        await leaveWithoutAsking(() => router.replace(route))
        return
      }
      if (outcome === 'signed-in') {
        // 對話框還開著：關掉它（之後它的 promise 結果已經沒人等，不影響）。
        ElMessageBox.close()
        signIn.cancel()
        signIn = waitForSignIn()
      }
      const previousUser = authStore.user
      if (await authStore.refreshSession()) {
        if (expectedUserId && authStore.user?.id !== expectedUserId) {
          // 這個瀏覽器現在登入的是別人：先把畫面上的登入者換回原本的人，繼續等。
          // 對方的 session 已經存在 cookie 裡，按儲存會被當成對方，所以不接續；
          // 也清掉剛拿到的對方 CSRF token，這一頁什麼都送不出去，直到原本的人登入。
          authStore.user = previousUser
          authStore.csrfToken = null
          setCsrfToken(null)
          notifyWarning('新分頁登入的是另一個帳號。這一頁的修改要用原本的帳號儲存，請先登出那個帳號，再用原本的帳號登入。')
          continue
        }
        ElMessage.success('已恢復登入，請再按一次儲存。')
        return
      }
      notifyWarning('還沒有重新登入：請先在新分頁登入後台，再回來按「我已重新登入」。')
    }
  } finally {
    signIn.cancel()
    recovering = false
  }
}
