import type { SiteContent } from '~/types/site-content'
import type { ContentOverlay } from '~/utils/content-overlay'
import { applyContentOverlay } from '~/utils/content-overlay'

export interface PublishedSite {
  schemaVersion: string
  releaseId: string
  content: SiteContent
}

interface LivePublicSite {
  schema_version: string
  release_id: string
  content: ContentOverlay
}

/**
 * 階段 B 展示用的最小接線：內容主要仍讀 fixture，但下列已搬進 typed
 * content 系統的欄位改讀後端目前已發布版本，用來證明「後台改文案→
 * 發布→Nuxt 看得到」這條路徑真的走得通：
 *   - home_about：首頁「關於常春藤」文字
 *   - home_hero：首頁 hero 的 eyebrow／文案兩行／CTA 按鈕文字
 *   - site_footer：頁尾標語
 *
 * 這不是 Task 8 要求的完整 CMS 接線（其餘內容仍是靜態的），Task 8 會把
 * 其餘內容逐項換成同一套機制。
 *
 * `contentMode === 'fixture'`（本機示範／視覺驗證用）才會單純只讀
 * fixture、完全不打後端。其他模式（正式的 `live`）視後端為唯一真相
 * 來源：後端說「尚無可用內容」（503）或直接連不上，這裡都不吞掉改用
 * fixture 頂替——那等於用假資料偽裝成 HTTP 200 的正常頁面。呼叫端
 * （頁面元件）要檢查 `error.value` 並丟出對應狀態碼的 `createError`。
 *
 * 疊資料的邏輯抽在 `applyContentOverlay`（純函式，見 utils/content-
 * overlay.ts），跟 `useDraftPreview` 共用，也讓這段邏輯能離開 Nuxt
 * runtime 直接單元測試（`web/tests/content.spec.ts`）。
 */
export function usePublishedSite() {
  const config = useRuntimeConfig()
  const route = useRoute()

  return useAsyncData<PublishedSite>(
    'published-site',
    async () => {
      const fixture = await $fetch<SiteContent>('/api/site-fixture')

      if (config.public.contentMode === 'fixture') {
        return { schemaVersion: fixture.schemaVersion, releaseId: 'fixture-1', content: fixture }
      }

      try {
        const live = await $fetch<LivePublicSite>('/api/public-site')
        return {
          schemaVersion: fixture.schemaVersion,
          releaseId: live.release_id,
          content: applyContentOverlay(fixture, live.content)
        }
      } catch (err: any) {
        const statusCode = err?.response?.status ?? err?.statusCode ?? 503
        // 用 createError 而不是自訂 Error class：這個錯誤要跨 SSR/hydrate
        // 邊界正確序列化，頁面才讀得到 statusCode 再丟出對應狀態碼。
        throw createError({ statusCode, statusMessage: '網站內容服務暫時無法使用' })
      }
    },
    // 目前沒有任何快取層（第一版刻意不開 SWR/ISR，見計畫 Task 8）：同一頁
    // 多元件共用這個 key 不會重複打 API，但每次站內換頁都要看到最新發布
    // 的內容，所以用 route.fullPath 當觸發訊號，換頁就重新抓一次。
    { watch: [() => route.fullPath] }
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
