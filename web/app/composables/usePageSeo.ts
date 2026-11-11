import type { NewsArticle, SiteContent } from '~/types/site-content'
import { aboutSeo, admissionSeo, anniversarySeo, newsArticleSeo, newsListSeo, privacySeo, crawlerIndexable, curriculumSeo, environmentSeo, normalizeSiteOrigin, pageSeo, serializeJsonLd, type StaticPage } from '~/utils/seo'
import { admissionHeroImage, heroPreloadLink } from '~/utils/responsive-image'
import { aboutHeroAttrs, curriculumHeroAttrs, environmentHeroAttrs, heroImageAttrs } from '~/utils/media-image'
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
    if (page === 'anniversary') return anniversarySeo(site.value, origin)
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
    if (page === 'environment') return environmentHeroAttrs(site.value.environmentPage)
    if (page === 'curriculum') return curriculumHeroAttrs(site.value.curriculumPage)
    if (page === 'about') return aboutHeroAttrs(site.value.aboutPage)
    // 消息頁沒有滿版 hero，不預載。
    // 30 週年首屏是紀念影片的封面，圖已設 fetchpriority=high，不另外預載。
    if (page === 'news' || page === 'privacy' || page === 'anniversary') return undefined
    return heroImageAttrs(site.value.home.hero)
  })
  // 只有單篇消息（newsArticleSeo）會回 ogType／publishedTime。
  const articleMeta = computed(() => seo.value as { ogType?: 'article'; publishedTime?: string } | undefined)
  useSeoMeta({
    title: () => seo.value?.title,
    description: () => seo.value?.description,
    ogTitle: () => seo.value?.title,
    ogDescription: () => seo.value?.description,
    ogUrl: () => seo.value?.canonical,
    ogImage: () => seo.value?.image,
    ogImageAlt: () => seo.value?.imageAlt,
    // 單篇消息標成文章並帶發布日期，其他頁是 website；站名給分享預覽與搜尋結果的網站名稱用。
    ogType: () => articleMeta.value?.ogType ?? 'website',
    articlePublishedTime: () => articleMeta.value?.publishedTime,
    ogSiteName: () => site.value?.siteMeta.brandName,
    ogLocale: 'zh_TW',
    twitterCard: 'summary_large_image',
    twitterTitle: () => seo.value?.title,
    twitterDescription: () => seo.value?.description,
    twitterImage: () => seo.value?.image,
    robots: () => (indexable.value ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
  })
  useHead(() => ({
    link: [
      ...(seo.value?.canonical ? [{ rel: 'canonical' as const, href: seo.value.canonical }] : []),
      ...(hero.value ? [heroPreloadLink(hero.value)] : [])
    ],
    script: seo.value?.graph.length ? [{ key: 'public-structured-data', type: 'application/ld+json', innerHTML: serializeJsonLd({ '@context': 'https://schema.org', '@graph': seo.value.graph }) }] : []
  }))
}
