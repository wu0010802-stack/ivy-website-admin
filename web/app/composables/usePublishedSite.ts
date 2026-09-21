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
 * 其餘內容逐項換成同一套機制。失敗或後端未發布任何內容時，安靜地退回
 * fixture 原文，不讓公開頁面因此壞掉。
 *
 * 疊資料的邏輯抽在 `applyContentOverlay`（純函式，見 utils/content-
 * overlay.ts），跟 `useDraftPreview` 共用，也讓這段邏輯能離開 Nuxt
 * runtime 直接單元測試（`web/tests/content.spec.ts`）。
 */
export function usePublishedSite() {
  const config = useRuntimeConfig()
  if (config.public.contentMode !== 'fixture' && import.meta.dev) {
    console.warn(
      '[usePublishedSite] contentMode 不是 fixture，但目前仍以 fixture 為主要資料來源（完整 API 接線屬 Task 8）'
    )
  }

  const route = useRoute()

  return useAsyncData<PublishedSite>(
    'published-site',
    async () => {
      const fixture = await $fetch<SiteContent>('/api/site-fixture')
      let releaseId = 'fixture-1'
      let content = fixture

      const live = await $fetch<LivePublicSite | null>('/api/public-site').catch(() => null)
      if (live?.content) {
        content = applyContentOverlay(fixture, live.content)
        releaseId = live.release_id
      }

      return {
        schemaVersion: content.schemaVersion,
        releaseId,
        content
      }
    },
    // 目前沒有任何快取層（第一版刻意不開 SWR/ISR，見計畫 Task 8）：同一頁
    // 多元件共用這個 key 不會重複打 API，但每次站內換頁都要看到最新發布
    // 的內容，所以用 route.fullPath 當觸發訊號，換頁就重新抓一次。
    { watch: [() => route.fullPath] }
  )
}
