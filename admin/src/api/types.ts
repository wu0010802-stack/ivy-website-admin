// UserOut/CampusOut/ContentItemOut/MediaAssetOut/MediaVariantOut 從後端
// 生成的 OpenAPI 型別重新匯出，避免手抄造成 drift；`npm run contract:check`
// 會偵測這份生成檔跟目前 API 是否一致。HomeAboutPayload 等各 kind 的
// payload 形狀後端目前收 dict、不是獨立 schema，暫時仍手抄維護（見下）。
import type { components } from '../../../contracts/generated/website-api'

export type Role = 'super_admin' | 'campus_admin' | 'editor' | 'reception' | 'readonly'
export type UserOut = components['schemas']['UserOut']
export type FeatureFlags = components['schemas']['FeatureFlags']
export type MeResponse = components['schemas']['MeResponse']
export type LoginResponse = components['schemas']['LoginResponse']
export type AuthProviders = components['schemas']['AuthProviders']
export type LineLinkStart = components['schemas']['LineLinkStart']
export type GoogleLinkStart = components['schemas']['GoogleLinkStart']
export type CampusOut = components['schemas']['CampusOut']
export type PasswordResetLinkOut = components['schemas']['PasswordResetLinkOut']
export type PasswordResetVerifyOut = components['schemas']['PasswordResetVerifyOut']
export type ContactPhrasesOut = components['schemas']['ContactPhrasesOut']
export type ContactPhrasesUpdate = components['schemas']['ContactPhrasesUpdate']

export const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const

/** 版位的裁切焦點（0–100，左上為 0），後端 FocusPointPayload。 */
export interface FocusPointPayload {
  x: number
  y: number
}

/**
 * 內容裡的素材版位（後端 MediaSlotPayload）：素材庫的素材＋這個版位自己的焦點。
 * 焦點留空（null）＝用素材本身的焦點；整個版位 null＝官網沿用內建素材。
 */
export interface MediaSlotPayload {
  media_id: string
  focus_x: number | null
  focus_y: number | null
}

export interface HomeAboutPayload {
  title: string
  since_label: string
  body_text: string
  caption: string
  photo?: MediaSlotPayload | null
  photo_alt?: string
}

/** 首屏標語與影片。按鈕文字（cta_label）2026-09-23 隨首屏按鈕拿掉，後端忽略舊值。 */
export interface HomeHeroPayload {
  /** 標語上方的小標：2026-09-30 起官網不顯示，2026-10-04 起後台不編；舊版本的值原樣保留 */
  eyebrow?: string
  copy_lines: string[]
  video_desktop?: MediaSlotPayload | null
  video_mobile?: MediaSlotPayload | null
  poster?: MediaSlotPayload | null
  poster_alt?: string
  fallback_image?: MediaSlotPayload | null
}

/** 頁尾連結：站內路徑（/ 開頭）或 https 外部網址 */
export interface SiteLinkPayload {
  label: string
  href: string
}

/** 主選單項目：中文與頁首英文小字 */
export interface NavLinkPayload extends SiteLinkPayload {
  label_en: string
}

export interface SiteFooterPayload {
  tagline: string
  copyright: string
  bottom_note: string
  campus_list_label: string
  /** null＝還沒設定過，官網沿用內建頁尾連結 */
  links?: SiteLinkPayload[] | null
}

/** 各頁搜尋與分享可以設定的七個頁面（後端 PAGE_SEO_KEYS） */
export type PageSeoKey = 'admission' | 'about' | 'curriculum' | 'environment' | 'news' | 'anniversary' | 'privacy'

/** 某一頁的搜尋結果與社群分享設定；每個欄位留空＝沿用官網內建（標題、描述）或全站分享圖 */
export interface PageSeoEntryPayload {
  /** 最多 120 字 */
  title: string
  /** 最多 300 字 */
  description: string
  /** 素材庫圖片 UUID；空字串沿用全站分享圖 */
  share_image: string
  /** 最多 200 字 */
  share_image_alt: string
}

export type SocialPlatform = 'facebook' | 'line' | 'instagram' | 'youtube'

/** 機構的社群連結（頁首選單面板）；網址只收 https */
export interface SocialLinkPayload {
  platform: SocialPlatform
  /** 1–20 字 */
  label: string
  /** https 開頭，最多 300 字 */
  url: string
}

export interface SiteMetaPayload {
  title: string
  description: string
  header_phone_number: string
  header_phone_note: string
  /** 素材庫媒體 UUID；空字串沿用首頁大圖 */
  share_image: string
  share_image_alt: string
  allow_indexing: boolean
  /** null＝還沒設定過，官網沿用內建主選單 */
  primary_nav?: NavLinkPayload[] | null
  /**
   * 各頁的搜尋標題、描述與分享圖。載入時一律補成七頁（見 composables/pageSeoDefaults 的 normalizePageSeo）；
   * 舊版本的 admission_title／admission_description 在那時搬進 page_seo.admission，不再存回。
   */
  page_seo: Record<PageSeoKey, PageSeoEntryPayload>
  /** null＝官網沿用內建清單；[]＝不顯示；最多 6 筆、網址不可重複 */
  social_links: SocialLinkPayload[] | null
}

export interface HomeCampusBoardPayload {
  section_title: string
  eyebrow: string
  note: string
  /** 首頁五校的排列（五校 key，不重複不缺漏） */
  campus_order: string[]
  default_campus: string
}

export interface PrivacySectionPayload {
  /** 小標，可留空 */
  heading: string
  body: string
}

export interface BookingContentPayload {
  cta_label: string
  cta_label_en: string
  /** 隱私／個資使用說明（2026-09-25 新增）；空清單＝官網不顯示說明入口 */
  privacy_title: string
  privacy_sections: PrivacySectionPayload[]
}

/** 隱私權政策（後端 content/schemas.py 的 PrivacyPolicyPayload）；內文純文字，空行分段、「- 」條列、https:// 連結 */
export interface PrivacyPolicySectionPayload {
  heading: string
  body: string
}

export interface PrivacyPolicyPayload {
  title: string
  /** YYYY-MM-DD；存草稿可為 null，發布必填 */
  updated_on: string | null
  sections: PrivacyPolicySectionPayload[]
}

/** 整頁內容清單項目的照片版位（後端 content/page_schemas.py 的 PagePhotoFields）；留空＝官網內建照片 */
export interface PagePhotoPayload {
  photo?: MediaSlotPayload | null
  photo_alt?: string
}

/** 特色教學頁（後端 content/page_schemas.py 的 CurriculumPagePayload）。標題用 \n 換行；清單項目數固定。 */
export interface CurriculumPagePayload {
  hero_eyebrow: string
  hero_title: string
  hero_highlight: string
  hero_lede: string
  hero_notice: string
  hero_photo?: MediaSlotPayload | null
  hero_photo_alt?: string
  chapters: { label: string; hint: string }[]
  years_title: string
  years_text: string
  spiral_label: string
  spiral_text: string
  years_photo?: MediaSlotPayload | null
  years_photo_alt?: string
  years_caption: string
  years: { motto: string; text: string }[]
  directions_title: string
  directions_text: string
  directions: ({ key: string; title: string; sub: string; text: string } & PagePhotoPayload)[]
  gallery_title: string
  gallery_text: string
  gallery_source: string
  gallery: ({ label: string } & PagePhotoPayload)[]
  daily_title: string
  daily_text: string
  daily_source: string
  daily: ({ title: string; text: string } & PagePhotoPayload)[]
  belief_title: string
  beliefs: string[]
  belief_close: string
  belief_source: string
}

/** 關於常春藤頁（後端 content/page_schemas.py 的 AboutPagePayload）。標題用 \n 換行；章名 4、沿革 5 站、期許 2 段固定。 */
export interface AboutPagePayload {
  hero_title: string
  hero_lede: string
  hero_caption: string
  hero_photo?: MediaSlotPayload | null
  hero_photo_alt?: string
  hero_back_photo?: MediaSlotPayload | null
  hero_back_photo_alt?: string
  chapter_names: string[]
  story_title: string
  story_text: string
  milestones: { key: string; year: number; text: string }[]
  whole_title: string
  whole_text: string
  whole_fine: string
  whole_fine_source: string
  hope_title: string
  hope_quotes: string[]
  hope_photo?: MediaSlotPayload | null
  hope_photo_alt?: string
  outro_title: string
  outro_text: string
}

/**
 * 常春藤環境頁前三章（後端 content/page_schemas.py 的 EnvironmentPagePayload）。標題用 \n 換行；
 * 章名 4、五顆心 5、照顧的小事 5、空間 6、餐點 5 固定；餐點時間 HH:MM 要由早到晚；
 * 照片版位留空＝官網內建照片，*_photo_alt 只在換了照片時生效。
 */
export interface EnvironmentPagePayload {
  hero_title: string
  hero_highlight: string
  hero_lede: string
  hero_notice: string
  hero_photo?: MediaSlotPayload | null
  hero_photo_alt?: string
  hero_caption: string
  chapter_names: string[]
  care_title: string
  care_lead: string
  hearts: string[]
  care_text: string
  care_photo?: MediaSlotPayload | null
  care_photo_alt?: string
  care_caption: string
  care_photo_note: string
  care_items: ({ title: string; text: string } & PagePhotoPayload)[]
  spaces_title: string
  spaces_text: string
  feature: { tag: string; title: string; text: string; note: string } & PagePhotoPayload
  trail_hint: string
  spaces: ({ title: string; text: string; note: string; campus_label: string } & PagePhotoPayload)[]
  meals_title: string
  meals_text: string
  meals_day_title: string
  meals: { time: string; name: string; note: string; text: string }[]
  tour_title: string
  tour_text: string
  tour_hint: string
}

/** 消息結構化內文的一塊（後端 content/schemas.py 的 NewsBodyBlock）；不收 HTML。 */
export type NewsBodyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'image'; image: string; alt: string; caption: string }
  | { type: 'link'; label: string; url: string }

/** 全站消息與活動的適用範圍：global＝全校；campus＝指定校區（至少一校） */
export type ContentScope = 'global' | 'campus'

export interface ScopedEntry {
  scope: ContentScope
  campus_keys: string[]
}

/** 各校消息（campus_news）的消息：屬於那一校，沒有適用範圍與首頁推薦 */
export interface CampusNewsArticlePayload {
  id: string
  /** YYYY-MM-DD */
  date: string
  category: string
  title: string
  /** 摘要：卡片、清單與沒有內文時的詳細頁顯示 */
  description: string
  body: NewsBodyBlock[]
  /** 素材庫媒體 UUID，或官網內建素材代號（舊的示意消息） */
  image: string
  alt: string
  /** 上架日期（台北時間，含當天）；留空＝發布後立即顯示 */
  show_from?: string | null
  /** 下架日期（台北時間，當天仍顯示）；留空＝不自動下架 */
  show_until?: string | null
}

export interface NewsArticlePayload extends CampusNewsArticlePayload, ScopedEntry {
  /** 首頁推薦：有任何推薦時首頁只輪播推薦的，依清單順序 */
  featured: boolean
}

export interface CampusNewsEventPayload {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  description: string
  all_day: boolean
  /** HH:MM；全天活動為 null */
  start_time: string | null
  end_time: string | null
  location: string
  /** 只收 http／https */
  link_url: string
  link_label: string
  show_from?: string | null
  show_until?: string | null
}

export type NewsEventPayload = CampusNewsEventPayload & ScopedEntry

/** 首頁手機版「活動影片」的一支（後端 HomeFilmPayload）。 */
export interface HomeFilmPayload {
  id: string
  /** 不顯示，給螢幕閱讀器念 */
  title: string
  source: 'file' | 'youtube'
  video: MediaSlotPayload | null
  /** 播放片段（秒）；end 為 null＝播到結尾 */
  start: number
  end: number | null
  poster: MediaSlotPayload | null
  youtube_url: string
}

export interface HomeNewsPayload {
  sample_note: string
  articles: NewsArticlePayload[]
  events: NewsEventPayload[]
  /** 首頁最多輪播幾則；null＝全部 */
  home_display_count: number | null
  /** 手機版活動影片；null＝官網沿用內建的五支（一段校園影片＋四支義華校 YouTube） */
  films?: HomeFilmPayload[] | null
}

export interface CampusNewsPayload {
  articles: CampusNewsArticlePayload[]
  events: CampusNewsEventPayload[]
}

export interface AdmissionStepPayload { when: string; title: string; text: string }
export interface AdmissionPhasePayload { tag: string; title: string; items: string[]; tips: string[] }
export interface AdmissionUniformDayPayload { day: string; wear: string }
export interface AdmissionSubsidyPayload { amount: string; unit: string; who: string; by: string }
export interface AdmissionAllowancePayload { order: string; amount: string }
export interface AdmissionRefundGroupPayload { label: string; lines: string[] }
export interface AdmissionRefundPayload { title: string; groups: AdmissionRefundGroupPayload[]; note: string }

/** 入學資訊頁（/admission），後端 AdmissionContentPayload。 */
export interface AdmissionContentPayload {
  notice: string
  intro: string
  steps: AdmissionStepPayload[]
  phases: AdmissionPhasePayload[]
  uniform_week: AdmissionUniformDayPayload[]
  uniform_note: string
  pickup_notes: string[]
  registration_notes: string[]
  fee_intro: string
  subsidies: AdmissionSubsidyPayload[]
  allowance_title: string
  allowance: AdmissionAllowancePayload[]
  allowance_note: string
  refunds: AdmissionRefundPayload[]
}

export interface DayMomentPayload {
  key: string
  time: string
  label: string
  caption: string
  title: string
  story: string
  question: string
  answer: string
  photo?: MediaSlotPayload | null
  alt?: string
  /** 官網既有色票；null＝沿用內建卡的色調 */
  tint?: DayMomentTint | null
}

export const DAY_MOMENT_TINTS = ['yellow', 'mint', 'peach', 'cream'] as const
export type DayMomentTint = (typeof DAY_MOMENT_TINTS)[number]

export interface DayExperiencePayload {
  eyebrow: string
  eyebrow_en: string
  note: string
  source_note: string
  moments: DayMomentPayload[]
  film_desktop?: MediaSlotPayload | null
  film_mobile?: MediaSlotPayload | null
  film_poster?: MediaSlotPayload | null
  /** null＝沿用官網內建的影片說明 */
  film_caption_zh?: string | null
  film_caption_en?: string | null
}

export interface CampusProfilePayload {
  name: string
  district: string
  address: string
  phone: string
  facebook: string
  line: string
  /** Google 地圖網址；空字串＝官網用地址搜尋 */
  map_url: string
  cover?: MediaSlotPayload | null
  /** 首頁五校卡片與預約頁的校區照片 */
  card_focus?: FocusPointPayload | null
  line_art?: MediaSlotPayload | null
  line_art_colour?: MediaSlotPayload | null
  /** 2026-09-25 新增；之前存的版本沒有這兩欄，表單載入時補空字串。 */
  instagram: string
  youtube: string
  /**
   * 2026-10-12 新增：關於頁「家長怎麼說」的家長分享影片。null（或舊版本沒有這欄）＝沿用官網內建清單
   * （目前只有義華）；[]＝這校不放；最多 4 支。官網五校輪流取（每校先取第 1 支）。
   */
  testimonials?: TestimonialPayload[] | null
}

/** 一支家長分享影片（後端 TestimonialPayload）。poster 空＝內建同一支影片的封面，再沒有就用 YouTube 縮圖。 */
export interface TestimonialPayload {
  /** YouTube 網址或 11 碼影片編號，最多 300 字，要解得出編號 */
  youtube_url: string
  /** 家長說的話，1–40 字 */
  quote: string
  /** 稱呼，1–20 字 */
  speaker: string
  poster?: MediaSlotPayload | null
  poster_alt?: string
}

/** 已拿掉的分校頁校園探索熱點：官網不顯示、後台不編，只為舊版本保留 */
export interface TourSpotPayload {
  name: string
  x: number
  y: number
  text: string
  question: string
}

export interface TourScenePayload {
  key: string
  name: string
  image: string
  intro: string
  /** 舊資料的熱點（2026-10-04 起新場景不帶） */
  spots?: TourSpotPayload[]
  /** 舊的「熱點待複核」旗標，2026-10-04 起不再更動也不擋發布 */
  spots_reviewed?: boolean
}

export interface CampusTourPayload {
  scenes: TourScenePayload[]
}

export type MediaKind = 'image' | 'video'
export type MediaStatus = 'processing' | 'ready' | 'failed'
export type VariantKind = components['schemas']['VariantKind']

export type MediaVariantOut = components['schemas']['MediaVariantOut']
export type MediaAssetOut = components['schemas']['MediaAssetOut']
export type MediaAssetPageOut = components['schemas']['MediaAssetPageOut']
export type MediaUsagesOut = components['schemas']['MediaUsagesOut']
export type MediaReferenceOut = components['schemas']['MediaReferenceOut']
export type MediaHistoryReferenceOut = components['schemas']['MediaHistoryReferenceOut']
export type MediaUploadLimitsOut = components['schemas']['MediaUploadLimitsOut']
export type MediaReplaceReferencesOut = components['schemas']['MediaReplaceReferencesOut']
export type MediaReplaceReferencesRequest = components['schemas']['MediaReplaceReferencesRequest']
export type ContentItemOut = components['schemas']['ContentItemOut']
export type ContentRevisionOut = components['schemas']['ContentRevisionOut']
export type BookingConfigOut = components['schemas']['BookingConfigOut']
export type BookingMode = components['schemas']['BookingMode']
export type BookingReadinessOut = components['schemas']['BookingReadinessOut']
export type BookingReadinessReason = components['schemas']['BookingReadinessReason']
export type BookingImpactOut = components['schemas']['BookingImpactOut']
export type VisitSlotOut = components['schemas']['VisitSlotOut']
export type PublicVisitSlotOut = components['schemas']['PublicVisitSlotOut']
export type VisitRequestDetailOut = components['schemas']['VisitRequestDetailOut']
export type VisitRequestFullOut = components['schemas']['VisitRequestFullOut']
export type VisitHistoryOut = components['schemas']['VisitHistoryOut']
export type AdminDetailsUpdate = components['schemas']['AdminDetailsUpdate']
export type AdminDetailsUpdateOut = components['schemas']['AdminDetailsUpdateOut']
export type NotificationOutboxOut = components['schemas']['NotificationOutboxOut']
export type NotificationOutboxPageOut = components['schemas']['NotificationOutboxPageOut']
export type NotificationRetryBatchOut = components['schemas']['NotificationRetryBatchOut']
export type NotificationInboxItemOut = components['schemas']['NotificationInboxItemOut']
export type NotificationReadAllOut = components['schemas']['NotificationReadAllOut']
export type ParentAccessLinkCreatedOut = components['schemas']['ParentAccessLinkCreatedOut']
export type VisitContactNoteOut = components['schemas']['VisitContactNoteOut']
export type VisitRequestManualCreate = components['schemas']['VisitRequestManualCreate']
export type VisitStaffOut = components['schemas']['VisitStaffOut']
export type LineSettingsOut = components['schemas']['LineSettingsOut']
export type LineGroupOut = components['schemas']['LineGroupOut']
export type LineVerificationCodeOut = components['schemas']['LineVerificationCodeOut']
export type PublishJobListOut = components['schemas']['PublishJobListOut']
export type ReleaseOut = components['schemas']['ReleaseOut']
export type ReleaseChangeOut = components['schemas']['ReleaseChangeOut']
export type ReleasePageOut = components['schemas']['ReleasePageOut']
export type ReleaseRestoreOut = components['schemas']['ReleaseRestoreOut']
export type UserNotificationOut = components['schemas']['UserNotificationOut']
export type ContentRevisionSummaryOut = components['schemas']['ContentRevisionSummaryOut']
export type AnalyticsFunnelOut = components['schemas']['AnalyticsFunnelOut']
export type BookingOutcomesOut = components['schemas']['BookingOutcomesOut']
export type CampusOutcomeOut = components['schemas']['CampusOutcomeOut']
export type OutcomeCountsOut = components['schemas']['OutcomeCountsOut']
export type PendingNowOut = components['schemas']['PendingNowOut']
export type EventTrendOut = components['schemas']['EventTrendOut']
export type EventTrendDayOut = components['schemas']['EventTrendDayOut']
export type ClassDistributionOut = components['schemas']['ClassDistributionOut']
export type GradeCountOut = components['schemas']['GradeCountOut']
export type RetentionPolicyOut = components['schemas']['RetentionPolicyOut']
export type RetentionReportOut = components['schemas']['RetentionReportOut']
export type RetentionRunOut = components['schemas']['RetentionRunOut']
export type AuditLogEntryOut = components['schemas']['AuditLogEntryOut']
export type DisplayNameUpdateRequest = components['schemas']['DisplayNameUpdateRequest']

// 招生入學（2026-10 規格 13）。名稱去掉 Out；B 階段的 api/admissions.ts 從這裡匯入。
export type RecruitmentVisit = components['schemas']['RecruitmentVisitOut']
export type RecruitmentVisitCreate = components['schemas']['RecruitmentVisitCreate']
export type RecruitmentVisitUpdate = components['schemas']['RecruitmentVisitUpdate']
export type RecruitmentEvent = components['schemas']['RecruitmentEventOut']
export type TransitionRequest = components['schemas']['TransitionRequest']
export type SeatRequest = components['schemas']['SeatRequest']
export type SeatResult = components['schemas']['SeatOut']
export type FunnelBoard = components['schemas']['FunnelBoardOut']
export type FunnelColumns = components['schemas']['FunnelColumnsOut']
export type FunnelCard = components['schemas']['FunnelCardOut']
export type AdmissionsOptions = components['schemas']['AdmissionsOptionsOut']
// 參觀後追蹤（2026-10-04 規格 9）。
export type ContactLog = components['schemas']['ContactLogOut']
export type ContactLogCreate = components['schemas']['ContactLogCreate']
export type ContactLogResult = components['schemas']['ContactLogResultOut']
export type FollowUpUpdate = components['schemas']['FollowUpUpdate']
export type AdmissionsStaff = components['schemas']['AdmissionsStaffOut']

// 統計（C3）。AdmissionsStatsOut 在 C1 才進 OpenAPI，所以沒有跟 A9 的別名放在一起。
export type AdmissionsStats = components['schemas']['AdmissionsStatsOut']
// 預繳速度與可能範圍（2026-10-12 規格 §9）。
export type AdmissionsRateRange = components['schemas']['AdmissionsRateRange']
export type AdmissionsDepositTiming = components['schemas']['AdmissionsDepositTiming']
export type AdmissionsDepositPace = components['schemas']['AdmissionsDepositPace']

// 區域分析（2026-10-08 規格 8）。
export type AdmissionsArea = components['schemas']['AdmissionsAreaOut']
export type AreaDistrictRow = components['schemas']['AreaDistrictRowOut']
export type AreaVillageRow = components['schemas']['AreaVillageRowOut']
export type AreaDistanceBand = components['schemas']['AreaDistanceBandOut']
export type AreaKindergartens = components['schemas']['AreaKindergartensOut']
export type AreaKindergarten = components['schemas']['AreaKindergartenOut']
export type VisitGeo = components['schemas']['VisitGeoOut']

// 五校比較（C4）。後端回 {as_of, school_year, semester, rows}；AdmissionsRate 是 {value, numerator, denominator}，畫面同時寫分子分母。
export type AdmissionsCompare = components['schemas']['AdmissionsCompareOut']
export type AdmissionsCompareRow = components['schemas']['AdmissionsCompareRow']
export type AdmissionsRate = components['schemas']['AdmissionsRate']

// 未預繳明細（C3b）。NoDepositRecordsOut 在 C2b 才進 OpenAPI。
export type NoDepositRecords = components['schemas']['NoDepositRecordsOut']
export type NoDepositRecord = components['schemas']['NoDepositRecordOut']
