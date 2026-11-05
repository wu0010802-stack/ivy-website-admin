// 後台的 Service worker（public/sw.js，scope /admin/）：只處理手機推播，沒有 fetch handler、不快取。
// 入口（main.ts）只在正式建置註冊；「我的帳號」開啟通知時（composables/usePushNotifications.ts）
// 沒有註冊也會補註冊。這個檔案刻意不 import vue 或 api，不增加入口體積。
export const PUSH_WORKER_URL = '/admin/sw.js'
export const PUSH_WORKER_SCOPE = '/admin/'

/** 註冊失敗（不支援、舊瀏覽器、無痕模式）一律吞掉：後台本身不能因為它壞掉。 */
export function registerPushWorker(): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register(PUSH_WORKER_URL, { scope: PUSH_WORKER_SCOPE }).catch(() => {})
  } catch {
    // 不支援就算了
  }
}
