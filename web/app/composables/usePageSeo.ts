import type { NewsArticle, SiteContent } from '~/types/site-content'
import { aboutSeo, admissionSeo, newsArticleSeo, newsListSeo, privacySeo, crawlerIndexable, curriculumSeo, environmentSeo, normalizeSiteOrigin, pageSeo, serializeJsonLd, type StaticPage } from '~/utils/seo'
import { admissionHeroImage, environmentHeroImage } from '~/utils/responsive-image'
import { aboutHeroAttrs, curriculumHeroAttrs, heroImageAttrs } from '~/utils/media-image'
import { isSampleNews } from '~/utils/news-content'
import { responsiveTourImage } from '~/utils/tour-image'

/** article：單篇消息頁（page 為 'news'）；示意消息照常顯示，但一律 noindex。 */
export function usePageSeo(site: Ref<SiteContent | undefined>, page?: StaticPage, article?: Ref<NewsArticle | undefined>) {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  // 後台「允許搜尋引擎收錄」只能收緊：部署沒開索引時一律 noindex。
  const sampleArticle = computed(() => Boolean(site.value && article?.value && isSampleNews(article.value, site.value.news.sampleNote)))
  const indexable = computed(() => crawlerIndexable(config.public.indexingEnabled, origin, site.value?.siteMeta) && !sampleArticle.value)
  const seo = computed(() => {
    if (!site.value) return undefined
    if (page === 'admission') return admissionSeo(site.value, origin)
    if (page === 'privacy') return privacySeo(site.value, origin)
    if (page === 'environment') return environmentSeo(site.value, origin)
    if (page === 'curriculum') return curriculumSeo(site.value, origin)
    if (page === 'about') return aboutSeo(site.value, origin)
    if (page === 'news' && article?.value) {
      const cover = responsiveTourImage(article.value.image, '', true, article.value.imageMedia).src
      return newsArticleSeo(site.value, origin, article.value, sampleArticle.value, cover)
    }
    if (page === 'news') return newsListSeo(site.value, origin)
    return pageSeo(site.value, origin)
  })
  // 預載的 imagesizes 要跟頁面上 <img sizes> 一致（首頁 HeroVideo.vue）。
  const hero = computed(() => {
    if (!site.value) return undefined
    if (page === 'admission') return admissionHeroImage()
    if (page === 'environment') return environmentHeroImage()
    if (page === 'curriculum') return curriculumHeroAttrs(site.value.curriculumPage)
    if (page === 'about') return aboutHeroAttrs(site.value.aboutPage)
    // 消息頁沒有滿版 hero，不預載。
    if (page === 'news' || page === 'privacy') return undefined
    return heroImageAttrs(site.value.home.hero)
  })
  useSeoMeta({
    title: () => seo.value?.title,
    description: () => seo.value?.description,
    ogTitle: () => seo.value?.title,
    ogDescription: () => seo.value?.description,
    ogUrl: () => seo.value?.canonical,
    ogImage: () => seo.value?.image,
    ogImageAlt: () => seo.value?.imageAlt,
    ogType: 'website', ogLocale: 'zh_TW',
    twitterCard: 'summary_large_image',
    twitterTitle: () => seo.value?.title,
    twitterDescription: () => seo.value?.description,
    twitterImage: () => seo.value?.image,
    robots: () => (indexable.value ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
  })
  useHead(() => ({
    link: [
      ...(seo.value?.canonical ? [{ rel: 'canonical' as const, href: seo.value.canonical }] : []),
      ...(hero.value ? [{ rel: 'preload' as const, as: 'image' as const, href: hero.value.src, imagesrcset: hero.value.srcset, imagesizes: hero.value.sizes, fetchpriority: 'high' as const }] : [])
    ],
    script: seo.value?.graph.length ? [{ key: 'public-structured-data', type: 'application/ld+json', innerHTML: serializeJsonLd({ '@context': 'https://schema.org', '@graph': seo.value.graph }) }] : []
  }))
}
