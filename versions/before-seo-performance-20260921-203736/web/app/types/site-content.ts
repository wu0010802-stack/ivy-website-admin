export interface HeroContent {
  eyebrow: string
  titleParts: {
    before: string
    punctAfterBefore: string
    middle: string
    growingWord: string
    punctAfterGrowingWord: string
  }
  copyLines: string[]
  ctaLabel: string
  ctaHref: string
  heroImage: string
  heroImageAlt: string
  heroVideoSrc: string
  heroVideoPoster: string
}

export interface AboutContent {
  anchorId: string
  sinceLabel: string
  title: string
  watermark: { top: string; bottom: string }
  bodyText: string
  photos: { image: string; alt: string; role: string }[]
  caption: string
}

export interface CampusBoardContent {
  sectionTitle: string
  eyebrow: string
  note: string
  defaultCampus: string
  campusOrder: string[]
}

export interface HomeContent {
  hero: HeroContent
  about: AboutContent
  campusBoard: CampusBoardContent
}

export interface DayMoment {
  key: string
  time: string
  label: string
  tint: string
  photo: string
  alt: string
  caption: string
  title: string
  story: string
  question: string
  answer: string
  _todo?: string
}

export interface DayExperienceContent {
  sectionId: string
  eyebrow: string
  eyebrowEn: string
  titleParts: { ivy: string; day: string }
  filmCaption: { zh: string; en: string }
  filmSrc: string
  filmSrcMobile: string
  filmPoster: string
  note: string
  sourceNote: string
  moments: DayMoment[]
}

export interface TourSpot {
  name: string
  x: number
  y: number
  text: string
  question: string
}

export interface TourScene {
  key: string
  name: string
  image: string
  intro: string
  spots: TourSpot[]
}

export interface GeneratedTourScenes {
  _generated: true
  note: string
  template: {
    key: string
    name: string
    image: string
    introTemplate: string
    spot: {
      name: string
      x: number
      y: number
      textTemplate: string
      question: string
    }
  }
}

export interface FaqItem {
  q: string
  a: string
}

export interface Campus {
  key: string
  name: string
  district: string
  address: string
  phone: string
  image: string
  photoPos: string | null
  panoramaPos: string | null
  heroPhotoPos: string | null
  intro: string
  description: string
  line: string | null
  facebook: string
  fbNote: string
  _todo?: string | null
  mapQueryAddress: string
  tourScenes: TourScene[] | GeneratedTourScenes
  faq: { template: string; items: FaqItem[] }
}

export interface NewsArticle {
  id: string
  date: string
  campus: string
  category: string
  title: string
  description: string
  image: string
  alt: string
}

export interface NewsEvent {
  id: string
  date: string
  month: string
  campus: string
  title: string
  description: string
}

export interface NewsContent {
  sectionId: string
  note: string
  sampleNote: string
  articles: NewsArticle[]
  events: NewsEvent[]
}

export interface BookingField {
  name: string
  label: string
  type: string
  required: boolean
  maxlength?: number
  pattern?: string
  hint?: string
  placeholder?: string
  options?: string[]
  optionsFrom?: string
}

export interface BookingContent {
  isDemo: boolean
  demoNote: string
  consentText: string
  ctaLabel: string
  ctaLabelEn: string
  bannerTitleTemplate: string
  bannerBody: string
  bannerButtonLabel: string
  steps: { step: number; id: string; title: string; description?: string }[]
  fields: BookingField[]
}

export interface FooterContent {
  brandName: string
  brandNameEn: string
  tagline: string
  links: { label: string; href: string }[]
  campusListLabel: string
  copyright: string
  bottomNote: string
  titleFontCredit: { label: string; href: string }
  orgSiteLink: { label: string; href: string }
}

export interface SiteMetaContent {
  title: string
  description: string
  lang: string
  themeColor: string
  brandName: string
  brandNameEn: string
  logo: string
  primaryNav: { label: string; labelEn: string; href: string }[]
  headerPhone: { number: string; note: string; _todo?: string }
}

export interface SiteContent {
  schemaVersion: string
  isDemo: boolean
  home: HomeContent
  dayExperience: DayExperienceContent
  campuses: Campus[]
  news: NewsContent
  booking: BookingContent
  footer: FooterContent
  siteMeta: SiteMetaContent
}

export function isGeneratedTourScenes(
  scenes: TourScene[] | GeneratedTourScenes
): scenes is GeneratedTourScenes {
  return !Array.isArray(scenes)
}
