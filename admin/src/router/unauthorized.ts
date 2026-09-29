import type { Router } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { hasUnsavedChanges, leaveWithoutAsking } from '../composables/useUnsavedChanges'

/** 導回登入頁時帶的查詢參數；登入頁看到它就說明「閒置過久，請重新登入」。 */
export const SESSION_EXPIRED_QUERY = 'expired'

let recovering = false

function loginRoute(router: Router) {
  const current = router.currentRoute.value
  return {
    name: 'login',
    query: { ...(current.fullPath !== '/' ? { redirect: current.fullPath } : {}), [SESSION_EXPIRED_QUERY]: '1' },
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
 */
async function recoverInPlace(router: Router): Promise<void> {
  if (recovering) return
  recovering = true
  const authStore = useAuthStore()
  try {
    for (;;) {
      const resumed = await ElMessageBox.confirm(
        '登入已逾時，這一頁的修改還沒儲存。請在新分頁打開後台重新登入，回到這裡按「我已重新登入」，再按一次儲存。',
        '登入已逾時',
        {
          confirmButtonText: '我已重新登入',
          cancelButtonText: '放棄修改並重新登入',
          type: 'warning',
          showClose: false,
          closeOnClickModal: false,
          closeOnPressEscape: false,
        },
      ).then(() => true, () => false)
      if (!resumed) {
        const route = loginRoute(router)
        authStore.clearSession()
        await leaveWithoutAsking(() => router.replace(route))
        return
      }
      if (await authStore.refreshSession()) {
        ElMessage.success('已恢復登入，請再按一次儲存。')
        return
      }
      ElMessage.warning('還沒有重新登入：請先在新分頁登入後台，再回來按「我已重新登入」。')
    }
  } finally {
    recovering = false
  }
}
