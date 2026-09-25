// UserOut/CampusOut/ContentItemOut/MediaAssetOut/MediaVariantOut 從後端
// 生成的 OpenAPI 型別重新匯出，避免手抄造成 drift；`npm run contract:check`
// 會偵測這份生成檔跟目前 API 是否一致。HomeAboutPayload 等各 kind 的
// payload 形狀後端目前收 dict、不是獨立 schema，暫時仍手抄維護（見下）。
import type { components } from '../../../contracts/generated/website-api'

export type Role = 'super_admin' | 'campus_admin' | 'editor' | 'reception' | 'readonly'
export type UserOut = components['schemas']['UserOut']
export type AuthProviders = components['schemas']['AuthProviders']
export type LineLinkStart = components['schemas']['LineLinkStart']
export type CampusOut = components['schemas']['CampusOut']

export const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const

export interface HomeAboutPayload {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface HomeHeroPayload {
  eyebrow: string
  copy_lines: string[]
  cta_label: string
}

export interface SiteFooterPayload {
  tagline: string
  copyright: string
  bottom_note: string
  campus_list_label: string
}

export interface SiteMetaPayload {
  title: string
  description: string
  header_phone_number: string
  header_phone_note: string
  /** 素材庫媒體 UUID；空字串沿用首頁大圖 */
  share_image: string
  share_image_alt: string
  admission_title: string
  admission_description: string
  allow_indexing: boolean
}

export interface HomeCampusBoardPayload {
  section_title: string
  eyebrow: string
  note: string
}

export interface PrivacySectionPayload {
  /** 小標，可留空 */
  heading: string
  body: string
}

export interface BookingContentPayload {
  cta_label: string
  cta_label_en: string
  consent_text: string
  banner_title_template: string
  banner_body: string
  banner_button_label: string
  /** 隱私／個資使用說明（2026-09-25 新增）；空清單＝官網不顯示說明入口 */
  privacy_title: string
  privacy_sections: PrivacySectionPayload[]
}

/** 消息結構化內文的一塊（後端 content/schemas.py 的 NewsBodyBlock）；不收 HTML。 */
export type NewsBodyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'image'; image: string; alt: string; caption: string }
  | { type: 'link'; label: string; url: string }

/** 全站消息、活動與共用常見問題的適用範圍：global＝全校；campus＝指定校區（至少一校） */
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

export interface HomeNewsPayload {
  sample_note: string
  articles: NewsArticlePayload[]
  events: NewsEventPayload[]
  /** 首頁最多輪播幾則；null＝全部 */
  home_display_count: number | null
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
}

export interface DayExperiencePayload {
  eyebrow: string
  eyebrow_en: string
  note: string
  source_note: string
  moments: DayMomentPayload[]
}

export interface CampusProfilePayload {
  name: string
  district: string
  address: string
  phone: string
  intro: string
  description: string
  facebook: string
  fb_note: string
  line: string
}

export interface CampusFaqItemPayload {
  q: string
  a: string
  /** 停用＝留在後台、官網不顯示；和共用題目同一題時等於這校不顯示那一題 */
  enabled: boolean
}

export interface CampusFaqPayload {
  items: CampusFaqItemPayload[]
  include_shared: boolean
  shared_position: 'before' | 'after'
}

export interface SharedFaqItemPayload extends ScopedEntry {
  id: string
  q: string
  a: string
  enabled: boolean
}

export interface SharedFaqPayload {
  items: SharedFaqItemPayload[]
}

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
  spots: TourSpotPayload[]
  /** 換照片後伺服器改成 false；園方確認熱點位置後改回 true 才能發布 */
  spots_reviewed?: boolean
}

export interface CampusTourPayload {
  scenes: TourScenePayload[]
}

export type MediaKind = 'image' | 'video'
export type MediaStatus = 'processing' | 'ready' | 'failed'
export type VariantKind = 'thumbnail' | 'poster'

export type MediaVariantOut = components['schemas']['MediaVariantOut']
export type MediaAssetOut = components['schemas']['MediaAssetOut']
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
export type RescheduleRequestOut = components['schemas']['RescheduleRequestOut']
export type NotificationOutboxOut = components['schemas']['NotificationOutboxOut']
export type NotificationRetryBatchOut = components['schemas']['NotificationRetryBatchOut']
export type ParentAccessLinkCreatedOut = components['schemas']['ParentAccessLinkCreatedOut']
export type VisitContactNoteOut = components['schemas']['VisitContactNoteOut']
export type VisitRequestManualCreate = components['schemas']['VisitRequestManualCreate']
export type VisitStaffOut = components['schemas']['VisitStaffOut']
export type LineSettingsOut = components['schemas']['LineSettingsOut']
export type LineGroupOut = components['schemas']['LineGroupOut']
export type PublishJobListOut = components['schemas']['PublishJobListOut']
export type ReleaseOut = components['schemas']['ReleaseOut']
export type ReleaseChangeOut = components['schemas']['ReleaseChangeOut']
export type ReleasePageOut = components['schemas']['ReleasePageOut']
export type ReleaseRestoreOut = components['schemas']['ReleaseRestoreOut']
export type UserNotificationOut = components['schemas']['UserNotificationOut']
export type ContentRevisionSummaryOut = components['schemas']['ContentRevisionSummaryOut']
