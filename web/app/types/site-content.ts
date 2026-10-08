import type { MediaImage } from '../utils/media-image'

export type { MediaImage }

// 2026-10-04 拿掉官網不再顯示的欄位（首屏小標、五校區塊說明、孩子的一天出處說明、
// 分校頁的首屏焦點、校園探索熱點）；2026-10-05 再拿掉原型預約表單的示範說明、步驟
// 與欄位清單（booking 的 isDemo／demoNote／steps／fields）。fixture
// （server/data/site-fixture.json）仍留著這些值：小標等是後端初始化內容
// （app/content/initialize.py、app/media/site_import.py）要讀；預約示範資料兩邊都不讀，
// 只是原型抽取時原樣留下。公開輸出前由 utils/public-copy.ts 拿掉。
// 2026-10-08 常見問題（連同後端內容類型 shared_faq／campus_faq）、分校簡介／詳細介紹／
// 臉書備註、預約同意文字與橫幅（consentText／banner*）從 fixture 刪除，
// 後端那幾個欄位改選填、初始化不再讀。

export interface HeroContent {
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
  moments: DayMoment[]
}

export interface TourScene {
  key: string
  name: string
  image: string
  intro: string
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

export interface Campus {
  key: string
  name: string
  district: string
  address: string
  phone: string
  image: string
  /** 後台選的封面；panoramaPos 會一起換成後台的焦點 */
  imageMedia?: MediaImage
  lineArtMedia?: MediaImage
  lineArtColourMedia?: MediaImage
  photoPos: string | null
  panoramaPos: string | null
  instagram?: string | null
  youtube?: string | null
  line: string | null
  facebook: string
  _todo?: string | null
  mapQueryAddress: string
  /** 後台「分校介紹」填的 Google 地圖網址；沒有時用地址組成搜尋連結（utils/site-links.ts） */
  mapUrl?: string
  tourScenes: TourScene[] | GeneratedTourScenes
  /** 家長分享影片（2026-09-26，目前只有義華）；寫在 fixture，後台沒有這個欄位 */
  testimonials?: CampusTestimonial[]
}

/** 分校頁「家長分享」：YouTube 影片＋影片標題裡家長說的話。poster 是影片畫面（不用頻道封面）。 */
export interface CampusTestimonial {
  youtubeId: string
  quote: string
  speaker: string
  poster: string
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

/** 隱私／個資使用說明（後台「預約文案」維護）。段落是純文字。 */
export interface PrivacyNotice {
  title: string
  sections: { heading: string; body: string }[]
}

export interface BookingContent {
  /** 已發布的隱私說明；沒有正式說明時為 null，頁尾與表單不顯示入口 */
  privacyNotice?: PrivacyNotice | null
  ctaLabel: string
  ctaLabelEn: string
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

/** 隱私權政策頁（/privacy）。後台 kind：privacy_policy；沒發布過就沒有這個欄位。 */
export interface PrivacyPolicySection { heading: string; body: string }
export interface PrivacyPolicyContent {
  title: string
  /** YYYY-MM-DD；後台沒填為空字串 */
  updatedOn: string
  sections: PrivacyPolicySection[]
}

/** 整頁內容的照片版位：後台換過照片才有 photo（photoAlt 是說明）；沒有＝元件用內建圖與內建說明 */
export interface PagePhoto {
  photo?: MediaImage
  photoAlt?: string
}

/**
 * 特色教學頁（/curriculum）在後台改得到的文字與照片（後端 content/page_schemas.py 的
 * CurriculumPagePayload）。章節數量、英文小字、年段名稱、顏料與版面寫在 CurriculumContent.vue，
 * 清單照索引對應。標題用 \n 換行。
 */
export interface CurriculumPageContent {
  heroEyebrow: string
  heroTitle: string
  /** 大標裡畫顏料的字；空字串＝不畫 */
  heroHighlight: string
  heroLede: string
  /** 空字串＝不顯示 */
  heroNotice: string
  heroPhoto?: MediaImage
  heroPhotoAlt?: string
  chapters: { label: string; hint: string }[]
  yearsTitle: string
  yearsText: string
  spiralLabel: string
  spiralText: string
  yearsPhoto?: MediaImage
  yearsPhotoAlt?: string
  /** 空字串＝不顯示 */
  yearsCaption: string
  years: { motto: string; text: string }[]
  directionsTitle: string
  directionsText: string
  directions: ({ key: string; title: string; sub: string; text: string } & PagePhoto)[]
  galleryTitle: string
  galleryText: string
  gallerySource: string
  gallery: ({ label: string } & PagePhoto)[]
  dailyTitle: string
  dailyText: string
  dailySource: string
  daily: ({ title: string; text: string } & PagePhoto)[]
  beliefTitle: string
  beliefs: string[]
  beliefClose: string
  beliefSource: string
}

/**
 * 關於常春藤頁（/about，立體書）在後台改得到的文字與照片（後端 AboutPagePayload）。
 * 六大領域與核心素養、家長怎麼說、卡紙位置與顏色寫在 AboutContent.vue；沿革五站照索引對應。
 */
export interface AboutPageContent {
  heroTitle: string
  heroLede: string
  heroCaption: string
  heroPhoto?: MediaImage
  heroPhotoAlt?: string
  heroBackPhoto?: MediaImage
  heroBackPhotoAlt?: string
  /** 一路走來、全人教育、我們的期許、家長怎麼說 */
  chapterNames: string[]
  storyTitle: string
  storyText: string
  milestones: { key: string; year: number; text: string }[]
  wholeTitle: string
  wholeText: string
  wholeFine: string
  /** 空字串＝不顯示 */
  wholeFineSource: string
  hopeTitle: string
  hopeQuotes: string[]
  hopePhoto?: MediaImage
  hopePhotoAlt?: string
  /** 也是首屏目次的最後一格 */
  outroTitle: string
  outroText: string
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
  privacyPolicy?: PrivacyPolicyContent | null
  curriculumPage: CurriculumPageContent
  aboutPage: AboutPageContent
}

export function isGeneratedTourScenes(
  scenes: TourScene[] | GeneratedTourScenes
): scenes is GeneratedTourScenes {
  return !Array.isArray(scenes)
}
