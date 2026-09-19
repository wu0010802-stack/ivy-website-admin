import type { SiteContent } from '~/types/site-content'

export interface PublishedSite {
  schemaVersion: string
  releaseId: string
  content: SiteContent
}

/**
 * Task 8 will swap this to call FastAPI `/api/website/v1/public/site`.
 * For now it reads the static fixture via a server route so SSR and client
 * hydration see identical data.
 */
export function usePublishedSite() {
  const config = useRuntimeConfig()
  if (config.public.contentMode !== 'fixture' && import.meta.dev) {
    console.warn(
      '[usePublishedSite] contentMode 不是 fixture，但目前仍讀取 fixture 資料（Task 8 才會接上真正的 API）'
    )
  }

  return useAsyncData<PublishedSite>('published-site', async () => {
    const content = await $fetch<SiteContent>('/api/site-fixture')
    return {
      schemaVersion: content.schemaVersion,
      releaseId: 'fixture-1',
      content
    }
  })
}
