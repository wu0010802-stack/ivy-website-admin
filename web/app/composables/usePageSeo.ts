import type { Campus, SiteContent } from '~/types/site-content'
import { normalizeSiteOrigin, pageSeo, serializeJsonLd } from '~/utils/seo'
import { HOME_HERO_SIZES, responsiveImage } from '~/utils/responsive-image'

export function usePageSeo(site: Ref<SiteContent | undefined>, campus?: Ref<Campus | undefined>) {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  const indexable = config.public.indexingEnabled && Boolean(origin)
  const seo = computed(() => site.value ? pageSeo(site.value, origin, campus?.value) : undefined)
  // 預載的 imagesizes 要跟頁面上 <img sizes> 一致（首頁 HeroVideo.vue／分校頁 hero-photo）。
  const hero = computed(() => site.value
    ? (campus?.value ? responsiveImage(campus.value.image) : responsiveImage(site.value.home.hero.heroImage, HOME_HERO_SIZES))
    : undefined)
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
    robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
  })
  useHead(() => ({
    link: [
      ...(seo.value?.canonical ? [{ rel: 'canonical' as const, href: seo.value.canonical }] : []),
      ...(hero.value ? [{ rel: 'preload' as const, as: 'image' as const, href: hero.value.src, imagesrcset: hero.value.srcset, imagesizes: hero.value.sizes, fetchpriority: 'high' as const }] : [])
    ],
    script: seo.value?.graph.length ? [{ key: 'public-structured-data', type: 'application/ld+json', innerHTML: serializeJsonLd({ '@context': 'https://schema.org', '@graph': seo.value.graph }) }] : []
  }))
}
