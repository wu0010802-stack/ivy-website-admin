import type { VNode } from 'vue'
import { ElMessage, type MessageOptions } from 'element-plus'
import { SESSION_CHANGED_MESSAGE } from '../api/errors'

type NotifyOptions = Omit<Partial<MessageOptions>, 'message' | 'type'> & { type?: 'error' | 'warning' }

// 錯誤與警告提示一律走這裡：留 8 秒、可以自己關、同一句連跳只顯示一則。
// 預設 3 秒、沒有關閉鈕的 toast 常常還沒讀完（或還沒抄下錯誤編號）就不見了。
// 成功提示不走這裡，維持 3 秒；要使用者自己動手處理的錯誤（例如要重新整理）
// 傳 { duration: 0 }，不自動消失。直接呼叫 ElMessage.error／warning 會被
// adminUx.test.ts（跨頁提示與確認框）擋下。
// 例外：「這台電腦的登入狀態已經改變」（別的分頁換了帳號，403 CSRF）client 已經交給登入頁的說明
// 或接續對話框，頁面的 catch 再 toast 同一件事就變成兩個提示，所以這一句不跳。
export function notifyError(message: string | VNode, options: NotifyOptions = {}) {
  if (message === SESSION_CHANGED_MESSAGE) return undefined
  const { type = 'error', ...rest } = options
  return ElMessage[type]({ message, duration: 8000, showClose: true, grouping: true, ...rest })
}

export function notifyWarning(message: string | VNode, options: Omit<NotifyOptions, 'type'> = {}) {
  return notifyError(message, { ...options, type: 'warning' })
}
