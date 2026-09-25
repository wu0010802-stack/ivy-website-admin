import type { Campus, SiteContent } from '~/types/site-content'
import { admissionSeo, crawlerIndexable, normalizeSiteOrigin, pageSeo, serializeJsonLd, type StaticPage } from '~/utils/seo'
import { ADMISSION_HERO_IMAGE, responsiveImage } from '~/utils/responsive-image'
import { campusHeroAttrs, heroImageAttrs } from '~/utils/media-image'

export function usePageSeo(site: Ref<SiteContent | undefined>, campus?: Ref<Campus | undefined>, page?: StaticPage) {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  // 後台「允許搜尋引擎收錄」只能收緊：部署沒開索引時一律 noindex。
  const indexable = computed(() => crawlerIndexable(config.public.indexingEnabled, origin, site.value?.siteMeta))
  const seo = computed(() => {
    if (!site.value) return undefined
    return page === 'admission' ? admissionSeo(site.value, origin) : pageSeo(site.value, origin, campus?.value)
  })
  // 預載的 imagesizes 要跟頁面上 <img sizes> 一致（首頁 HeroVideo.vue／分校頁 hero-photo）。
  const hero = computed(() => {
    if (!site.value) return undefined
    if (page === 'admission') return responsiveImage(ADMISSION_HERO_IMAGE)
    return campus?.value ? campusHeroAttrs(campus.value) : heroImageAttrs(site.value.home.hero)
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
