import type { SiteContent } from '~/types/site-content'

export interface LiveHomeAbout {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface LiveHomeHero {
  eyebrow: string
  copy_lines: string[]
  cta_label: string
}

export interface LiveSiteFooter {
  tagline: string
}

export interface ContentOverlay {
  home_about?: LiveHomeAbout | null
  home_hero?: LiveHomeHero | null
  site_footer?: LiveSiteFooter | null
}

/**
 * 把後端已接上 CMS 的欄位（目前只有 home_about/home_hero/site_footer，
 * 見 CONTENT_KIND_REGISTRY）疊到 fixture 內容上，兩邊都不修改傳入的
 * 物件（回傳新物件），也不假設 overlay 一定齊全——缺哪個 kind 就保留
 * fixture 原文，不讓公開頁面因為某個 kind 還沒發布過就壞掉。
 *
 * `usePublishedSite`（讀已發布內容）跟 `useDraftPreview`（讀最新未發布
 * revision）共用這個函式，差別只在 overlay 資料是從哪支 API 拿的。
 */
export function applyContentOverlay(content: SiteContent, overlay: ContentOverlay): SiteContent {
  const next: SiteContent = {
    ...content,
    home: { ...content.home },
    footer: { ...content.footer }
  }

  if (overlay.home_about) {
    const about = overlay.home_about
    next.home.about = {
      ...next.home.about,
      title: about.title,
      sinceLabel: about.since_label,
      bodyText: about.body_text,
      caption: about.caption
    }
  }

  if (overlay.home_hero) {
    const hero = overlay.home_hero
    next.home.hero = {
      ...next.home.hero,
      eyebrow: hero.eyebrow,
      copyLines: hero.copy_lines,
      ctaLabel: hero.cta_label
    }
  }

  if (overlay.site_footer) {
    next.footer = { ...next.footer, tagline: overlay.site_footer.tagline }
  }

  return next
}
