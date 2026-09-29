import { useAuthStore } from '../stores/auth'

/**
 * 後台 session 閒置 120 分鐘就失效（WEBSITE_SESSION_IDLE_MINUTES），只有打 API
 * 才會延長；在編輯器裡打字不會送出任何請求，寫長文寫到一半就可能被登出（稽核
 * idle-timeout-loses-cms-edits）。有鍵盤、滑鼠／觸控或輸入時，最多每 10 分鐘
 * 打一次 /auth/me 延長（後端能往後推至少 5 分鐘才寫 DB，成本很低）。真的離開
 * 的人不會有輸入，照樣逾時，符合「閒置」的語意。
 */
export const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'input'] as const

export function startSessionKeepAlive(
  options: { now?: () => number; target?: Pick<Window, 'addEventListener' | 'removeEventListener'> } = {},
): () => void {
  const now = options.now ?? Date.now
  const target = options.target ?? window
  let lastPing = now()
  let inflight = false

  function onActivity() {
    if (inflight || now() - lastPing < KEEPALIVE_INTERVAL_MS) return
    const authStore = useAuthStore()
    if (!authStore.user) return
    lastPing = now()
    inflight = true
    // 401 時 client.ts 的集中處理會接手（有未儲存修改時不導頁）。
    void authStore.refreshSession().finally(() => {
      inflight = false
    })
  }

  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity, { capture: true, passive: true })
  return () => {
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity, { capture: true })
  }
}
