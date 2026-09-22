import type { Campus, SiteContent } from '~/types/site-content'
import { normalizeSiteOrigin, pageSeo, serializeJsonLd } from '~/utils/seo'
import { responsiveImage } from '~/utils/responsive-image'

export function usePageSeo(site: Ref<SiteContent | undefined>, campus?: Ref<Campus | undefined>) {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  const indexable = config.public.indexingEnabled && Boolean(origin)
  const seo = computed(() => site.value ? pageSeo(site.value, origin, campus?.value) : undefined)
  const hero = computed(() => site.value ? responsiveImage(campus?.value?.image ?? site.value.home.hero.heroImage) : undefined)
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
