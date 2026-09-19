import type { SiteContent } from '~/types/site-content'

export interface PublishedSite {
  schemaVersion: string
  releaseId: string
  content: SiteContent
}

interface LiveHomeAbout {
  title: string
  since_label: string
  body_text: string
  caption: string
}

interface LiveHomeHero {
  eyebrow: string
  copy_lines: string[]
  cta_label: string
}

interface LiveSiteFooter {
  tagline: string
}

interface LivePublicSite {
  schema_version: string
  release_id: string
  content: {
    home_about?: LiveHomeAbout
    home_hero?: LiveHomeHero
    site_footer?: LiveSiteFooter
  }
}

/**
 * 階段 B 展示用的最小接線：內容主要仍讀 fixture，但下列已搬進 typed
 * content 系統的欄位改讀後端目前已發布版本，用來證明「後台改文案→
 * 發布→Nuxt 看得到」這條路徑真的走得通：
 *   - home_about：首頁「關於常春藤」文字
 *   - home_hero：首頁 hero 的 eyebrow／文案兩行／CTA 按鈕文字
 *   - site_footer：頁尾標語
 *
 * 這不是 Task 8 要求的完整 CMS 接線（沒有 SSR 新鮮度測試、沒有換頁
 * 即時更新驗證、其餘內容仍是靜態的），Task 8 會把其餘內容逐項換成
 * 同一套機制。失敗或後端未發布任何內容時，安靜地退回 fixture 原文，
 * 不讓公開頁面因此壞掉。
 */
export function usePublishedSite() {
  const config = useRuntimeConfig()
  if (config.public.contentMode !== 'fixture' && import.meta.dev) {
    console.warn(
      '[usePublishedSite] contentMode 不是 fixture，但目前仍以 fixture 為主要資料來源（完整 API 接線屬 Task 8）'
    )
  }

  return useAsyncData<PublishedSite>('published-site', async () => {
    const content = await $fetch<SiteContent>('/api/site-fixture')
    let releaseId = 'fixture-1'

    const live = await $fetch<LivePublicSite | null>('/api/public-site').catch(() => null)
    if (live?.content) {
      if (live.content.home_about) {
        const about = live.content.home_about
        content.home.about = {
          ...content.home.about,
          title: about.title,
          sinceLabel: about.since_label,
          bodyText: about.body_text,
          caption: about.caption
        }
      }
      if (live.content.home_hero) {
        const hero = live.content.home_hero
        content.home.hero = {
          ...content.home.hero,
          eyebrow: hero.eyebrow,
          copyLines: hero.copy_lines,
          ctaLabel: hero.cta_label
        }
      }
      if (live.content.site_footer) {
        content.footer = {
          ...content.footer,
          tagline: live.content.site_footer.tagline
        }
      }
      releaseId = live.release_id
    }

    return {
      schemaVersion: content.schemaVersion,
      releaseId,
      content
    }
  })
}
