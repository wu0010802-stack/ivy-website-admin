import type { VNode } from 'vue'
import { ElMessage, type MessageOptions } from 'element-plus'

type NotifyOptions = Omit<Partial<MessageOptions>, 'message' | 'type'> & { type?: 'error' | 'warning' }

// 錯誤與警告提示一律走這裡：留 8 秒、可以自己關、同一句連跳只顯示一則。
// 預設 3 秒、沒有關閉鈕的 toast 常常還沒讀完（或還沒抄下錯誤編號）就不見了。
// 成功提示不走這裡，維持 3 秒；要使用者自己動手處理的錯誤（例如要重新整理）
// 傳 { duration: 0 }，不自動消失。直接呼叫 ElMessage.error／warning 會被
// crossUx20261002.test.ts 擋下。
export function notifyError(message: string | VNode, options: NotifyOptions = {}) {
  const { type = 'error', ...rest } = options
  return ElMessage[type]({ message, duration: 8000, showClose: true, grouping: true, ...rest })
}

export function notifyWarning(message: string | VNode, options: Omit<NotifyOptions, 'type'> = {}) {
  return notifyError(message, { ...options, type: 'warning' })
}
