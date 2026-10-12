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
// 2026-10-12 沒人讀的欄位連同 fixture 一起刪除：首屏按鈕（home.hero 的 ctaLabel／ctaHref）、
// 頁尾的字型出處與機構原官網連結（titleFontCredit／orgSiteLink）、校園探索佔位樣板
// （GeneratedTourScenes）。booking.ctaLabel／ctaLabelEn 是頁首預約鈕在用，不在此列。

export interface HeroContent {
  titleParts: {
    before: string
    punctAfterBefore: string
    middle: string
    growingWord: string
    punctAfterGrowingWord: string
  }
  copyLines: string[]
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
  tourScenes: TourScene[]
  /**
   * 家長分享影片（關於頁第四章）。fixture 只有義華有內建清單；後台「分校資料」有發布
   * testimonials 陣列時整組取代（[]＝這校不放），沒有（或 null）就維持這份內建清單。
   */
  testimonials?: CampusTestimonial[]
}

/** 關於頁「家長怎麼說」：YouTube 影片＋影片標題裡家長說的話。poster 是影片畫面（不用頻道封面）。 */
export interface CampusTestimonial {
  youtubeId: string
  quote: string
  speaker: string
  /** 封面網址：後台選的素材 > 內建同一支影片的封面 > YouTube 縮圖 */
  poster: string
  /** 後台選了封面素材時才有：srcset 與焦點用它，poster 則是原檔網址 */
  posterMedia?: MediaImage
  /** 後台填的封面說明；沒填就不帶（素材庫說明在 posterMedia.alt） */
  posterAlt?: string
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
}

export type SocialPlatform = 'facebook' | 'line' | 'instagram' | 'youtube'
export interface SocialLink { platform: SocialPlatform; label: string; url: string }

/** 有獨立搜尋設定的七個公開頁（首頁用全站的標題與描述，不在內；預約頁不開放） */
export type PageSeoKey = 'admission' | 'about' | 'curriculum' | 'environment' | 'news' | 'anniversary' | 'privacy'
export interface PageSeoEntry { title?: string; description?: string; shareImage?: string; shareImageAlt?: string }

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
  /** 機構社群：沒有這個欄位＝沿用內建清單；後台設定過就整組取代（空陣列＝不顯示） */
  socialLinks?: SocialLink[]
  /** 後台「全站設定」：社群分享圖（素材庫媒體 UUID），空值沿用首頁大圖 */
  shareImage?: string
  shareImageAlt?: string
  /** 後台「各頁搜尋與分享」（2026-10-12）：七頁各自的標題、描述與分享圖；沒有或留空的欄位沿用內建 */
  pageSeo?: Partial<Record<PageSeoKey, PageSeoEntry>>
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

/**
 * 常春藤環境頁（/environment）前三章在後台改得到的文字與照片（後端 EnvironmentPagePayload）。
 * 第四章的場景照片與說明讀各校校園探索，這裡只有標題、段落與提示。便條位置與箭頭落點、太陽弧位置、
 * 結尾三張卡、營養餐點書連結與各章目次小字的計數寫在 EnvironmentContent.vue，清單照索引對應。
 * 標題用 \n 換行；照片沒換（沒有 photo）時用元件內建的圖與內建說明。
 */
export interface EnvironmentPageContent {
  heroTitle: string
  /** 大標裡畫螢光的字；空字串＝不畫 */
  heroHighlight: string
  heroLede: string
  /** 空字串＝不顯示 */
  heroNotice: string
  heroPhoto?: MediaImage
  heroPhotoAlt?: string
  heroCaption: string
  /** 幼兒保育、校園環境、幼兒餐點、五所校園 */
  chapterNames: string[]
  careTitle: string
  careLead: string
  /** 五顆心，一顆一個詞 */
  hearts: string[]
  careText: string
  carePhoto?: MediaImage
  carePhotoAlt?: string
  careCaption: string
  /** 照片上的便條 */
  carePhotoNote: string
  careItems: ({ title: string; text: string } & PagePhoto)[]
  spacesTitle: string
  spacesText: string
  /** 校園環境最上面的主打區（遊樂區） */
  feature: { tag: string; title: string; text: string; note: string } & PagePhoto
  trailHint: string
  /** campusLabel：照片上的校名，空字串＝不標 */
  spaces: ({ title: string; text: string; note: string; campusLabel: string } & PagePhoto)[]
  mealsTitle: string
  mealsText: string
  mealsDayTitle: string
  /** time 是 HH:MM，由早到晚 */
  meals: { time: string; name: string; note: string; text: string }[]
  tourTitle: string
  tourText: string
  tourHint: string
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
  environmentPage: EnvironmentPageContent
}
