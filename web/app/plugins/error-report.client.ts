import { createClientErrorReporter, postClientError } from '#shared/client-error'

// 官網的前端錯誤回報（2026-11-05，規則與流程見 shared/client-error.ts）：window 的 error 與 unhandledrejection、
// Vue 的 vue:error 與 Nuxt 的 app:error。每次頁面載入最多送 5 筆、同一個錯誤只送一次；瀏覽器擴充套件、
// ResizeObserver、AbortError、部署換檔名造成的 chunk 載入失敗不送。
// 不因 DNT／GPC 停用：回報裡沒有任何識別資訊（路徑只留 pathname、訊息與堆疊先遮蔽過），屬營運必要。
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  if (!config.public.errorReportsEnabled) return
  const reporter = createClientErrorReporter({
    source: 'web',
    origin: location.origin,
    get pathname() { return location.pathname },
    release: config.app.buildId,
    send: postClientError
  })
  window.addEventListener('error', (event) => {
    // 圖片、script 載入失敗是一般 Event（target 不是 window），不是程式錯誤。
    if (!(event instanceof ErrorEvent)) return
    reporter.capture(event.error ?? event.message, 'Error', event.filename)
  })
  window.addEventListener('unhandledrejection', (event) => { reporter.capture(event.reason, 'unhandledrejection') })
  // curriculum-enter.client.ts 也掛了 vue:error（收掉暈開轉場），兩邊各做各的。
  nuxtApp.hook('vue:error', (error) => { reporter.capture(error, 'VueError') })
  nuxtApp.hook('app:error', (error) => { reporter.capture(error, 'AppError') })
})
