import type { PublishedSite } from '~/utils/published-content'

export function usePublishedSite() {
  const route = useRoute()
  // SSR payload 與 hydrate 共用一份 release，瀏覽器接手時不再讀（stack hydration.spec 驗）。站內 NuxtLink
  // 換頁同 key 沿用資料，DESIGN「效能第四輪」與 10-16 stack 實測都是 0 次請求。
  return useAsyncData<PublishedSite>(
    'published-site',
    () => $fetch<PublishedSite>('/api/published-site'),
    { watch: [() => route.path] }
  )
}

/**
 * 頁面元件呼叫 `usePublishedSite()` 後接這支：有錯就丟出對應狀態碼的
 * fatal error（Nuxt 顯示錯誤頁、SSR 回真的 503/其他狀態碼），不是安靜
 * 吃掉錯誤繼續渲染一個看起來正常但內容是假的頁面。
 */
export function assertPublishedSite(error: Ref<unknown>): void {
  if (!error.value) return
  const nuxtError = error.value as { statusCode?: number; statusMessage?: string }
  throw createError({
    statusCode: nuxtError.statusCode ?? 503,
    statusMessage: nuxtError.statusMessage ?? '網站內容服務暫時無法使用',
    fatal: true
  })
}
