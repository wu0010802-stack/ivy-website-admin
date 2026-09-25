import type { MediaImage } from '../utils/media-image'

export type { MediaImage }

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
  // 以下由後台素材版位疊上（content-overlay.ts）；沒有＝沿用上面的內建素材。
  /** 首屏照片（影片載入前與不自動播放時） */
  heroImageMedia?: MediaImage
  /** 影片載入失敗時換上的照片；沒有就一直顯示 heroImageMedia／內建照片 */
  heroFallbackMedia?: MediaImage
  /** 手機（760px 以下）播的影片；沒有就用 heroVideoSrc 的手機版 */
  heroVideoSrcMobile?: string
  heroVideoPosition?: string | null
  heroVideoPositionMobile?: string | null
}

export interface AboutContent {
  anchorId: string
  sinceLabel: string
  title: string
  watermark: { top: string; bottom: string }
  bodyText: string
  photos: { image: string; alt: string; role: string; media?: MediaImage }[]
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
  /** 後台從素材庫選的照片；有它時不看 photo */
  photoMedia?: MediaImage
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
  filmPosterMedia?: MediaImage
  filmPosition?: string | null
  filmPositionMobile?: string | null
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
  imageMedia?: MediaImage
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
  /** 後台選的封面；panoramaPos／heroPhotoPos 會一起換成後台的焦點 */
  imageMedia?: MediaImage
  lineArtMedia?: MediaImage
  lineArtColourMedia?: MediaImage
  photoPos: string | null
  panoramaPos: string | null
  heroPhotoPos: string | null
  intro: string
  description: string
  instagram?: string | null
  youtube?: string | null
  line: string | null
  facebook: string
  fbNote: string
  _todo?: string | null
  mapQueryAddress: string
  /** 後台「分校介紹」填的 Google 地圖網址；沒有時用地址組成搜尋連結（utils/site-links.ts） */
  mapUrl?: string
  tourScenes: TourScene[] | GeneratedTourScenes
  faq: { template: string; items: FaqItem[] }
}

/** 消息結構化內文的一塊（後端 content/schemas.py 的 NewsBodyBlock），官網逐塊用固定元素顯示。 */
export type NewsBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'image'; image: string; alt?: string; caption?: string; imageMedia?: MediaImage }
  | { type: 'link'; label: string; url: string }

export interface NewsArticle {
  id: string
  date: string
  /** 顯示用的校區文字（「全校」「義華校」「義華校、明華校」） */
  campus: string
  /** 適用的校區 key；空陣列＝全校 */
  campusKeys?: string[]
  category: string
  title: string
  /** 摘要：卡片、清單與沒有內文時的詳細頁顯示 */
  description: string
  body?: NewsBlock[]
  /** 首頁推薦（只有全站消息有） */
  featured?: boolean
  /** 原型示意內容（見 NewsContent.sampleNote）；沒有這個欄位＝沿用整份的 sampleNote */
  sample?: boolean
  image: string
  alt: string
  imageMedia?: MediaImage
}

export interface NewsEvent {
  id: string
  date: string
  month: string
  campus: string
  campusKeys?: string[]
  title: string
  description: string
  /** 沒有這些欄位的舊資料視為全天、沒有地點與連結 */
  allDay?: boolean
  startTime?: string | null
  endTime?: string | null
  location?: string
  linkUrl?: string
  linkLabel?: string
  /** 同 NewsArticle.sample */
  sample?: boolean
}

/**
 * 首頁手機版「活動影片」的一支。標題不顯示，只當螢幕閱讀器的名稱。
 * 檔案影片播 start～end 秒（end 為 null＝播到結尾再循環）。
 */
export type HomeFilm =
  | { id: string; title: string; type: 'file'; src: string; start: number; end: number | null; poster: string }
  | { id: string; title: string; type: 'youtube'; youtubeId: string; poster: string }

export interface NewsContent {
  sectionId: string
  note: string
  /**
   * 原型示意內容的說明。示意與否逐則判斷（NewsArticle／NewsEvent 的 sample）：
   * 疊上後台內容時，全站消息看這段說明有沒有值，各校消息一律不是示意；
   * 純 fixture 的消息沒有逐則標記，這段有值就全部當示意。
   */
  sampleNote: string
  articles: NewsArticle[]
  events: NewsEvent[]
  /** 首頁最多輪播幾則；沒有值＝全部 */
  homeCount?: number | null
  /** 後台設定的手機版活動影片；沒有＝沿用 utils/campusFilms.ts 的內建清單 */
  films?: HomeFilm[]
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

/** 隱私／個資使用說明（後台「預約文案」維護）。段落是純文字。 */
export interface PrivacyNotice {
  title: string
  sections: { heading: string; body: string }[]
}

export interface BookingContent {
  isDemo: boolean
  demoNote: string
  consentText: string
  /** 已發布的隱私說明；沒有正式說明時為 null，頁尾與表單不顯示入口 */
  privacyNotice?: PrivacyNotice | null
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
  socialLinks?: { platform: 'facebook' | 'line'; label: string; url: string }[]
  /** 後台「全站設定」：社群分享圖（素材庫媒體 UUID），空值沿用首頁大圖 */
  shareImage?: string
  shareImageAlt?: string
  /** 入學資訊頁搜尋標題／描述；空值沿用內建文字 */
  admissionTitle?: string
  admissionDescription?: string
  /** false 時一律 noindex（只能收緊，部署沒開索引時不會因此變成可索引） */
  allowIndexing?: boolean
}

export interface AdmissionStep { when: string; title: string; text: string }
export interface AdmissionPhase { tag: string; title: string; items: string[]; tips: string[] }
export interface AdmissionUniformDay { day: string; wear: string }
export interface AdmissionSubsidy { amount: string; unit: string; who: string; by: string }
export interface AdmissionAllowance { order: string; amount: string }
export interface AdmissionRefundGroup { label: string; lines: string[] }
export interface AdmissionRefund { title: string; groups: AdmissionRefundGroup[]; note: string }

/** 入學資訊頁（/admission）。後台 kind：admission_content。 */
export interface AdmissionContent {
  notice: string
  intro: string
  steps: AdmissionStep[]
  phases: AdmissionPhase[]
  uniformWeek: AdmissionUniformDay[]
  uniformNote: string
  pickupNotes: string[]
  registrationNotes: string[]
  feeIntro: string
  subsidies: AdmissionSubsidy[]
  allowanceTitle: string
  allowance: AdmissionAllowance[]
  allowanceNote: string
  refunds: AdmissionRefund[]
}

export interface SiteContent {
  schemaVersion: string
  isDemo: boolean
  home: HomeContent
  dayExperience: DayExperienceContent
  campuses: Campus[]
  news: NewsContent
  admission: AdmissionContent
  booking: BookingContent
  footer: FooterContent
  siteMeta: SiteMetaContent
}

export function isGeneratedTourScenes(
  scenes: TourScene[] | GeneratedTourScenes
): scenes is GeneratedTourScenes {
  return !Array.isArray(scenes)
}
