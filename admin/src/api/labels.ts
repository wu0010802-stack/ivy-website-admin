// 後台顯示用的中文標籤與格式化。API 回傳的都是代碼（campus key、狀態、
// 角色），畫面上一律經過這裡轉成園方看得懂的字，不要在各頁面各自硬寫。
import type { Role } from './types'

export const CAMPUS_LABELS: Record<string, string> = {
  yihua: '義華',
  minghua: '明華',
  chongde: '崇德',
  international: '國際',
  renwu: '仁武',
}

export function campusLabel(key: string | null | undefined): string {
  if (!key) return '共用'
  return CAMPUS_LABELS[key] ?? key
}

export function campusLabels(keys: readonly string[]): string {
  return keys.map(campusLabel).join('、')
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: '總管理者',
  campus_admin: '校區管理者',
  editor: '編輯',
  reception: '櫃台',
  readonly: '唯讀',
}

// 新增帳號時給總管理者看的角色說明（規格 7 權限表，2026-09-25 業主裁定
// 接待人員可以處理案件）。要跟 backend/app/auth/permissions.py 一致。
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: '管理全部校區、使用者、全站內容與設定。',
  campus_admin: '處理指定校區的內容、預約設定、時段與參觀案件，並指派承辦人。匯出家長個資要另外授權。',
  editor: '編輯指定校區的內容與素材；不能發布，改好送審，由校區管理者發布。看不到家長個資。',
  reception: '處理指定校區的參觀案件：記聯絡紀錄、排入既有時段、補登、改期、取消與完成。不能新增時段、改預約設定或官網內容。',
  readonly: '查看指定校區的內容與去識別的成效統計；看不到家長個資。',
}

export const ROLE_ORDER: Role[] = ['campus_admin', 'editor', 'reception', 'readonly', 'super_admin']

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role
}

export type TagTone = 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface StatusMeta {
  label: string
  tone: TagTone
}

// 參觀案件狀態。語意沿用規格：inquiry 只是「已收到需求」，只有 confirmed
// 才叫「預約成立」，文字不能把 new 寫成「已預約」。
export const VISIT_STATUS: Record<string, StatusMeta> = {
  pending_confirmation: { label: '待園方確認', tone: 'warning' },
  // 新需求用操作色、待園方確認用暖黃（有期限），和總覽待辦的兩種數字底色一致。
  new: { label: '待處理', tone: 'primary' },
  contacting: { label: '聯絡中', tone: 'primary' },
  confirmed: { label: '已確認', tone: 'success' },
  completed: { label: '已完成', tone: 'info' },
  cancelled: { label: '已取消', tone: 'info' },
  no_show: { label: '未到場', tone: 'danger' },
}

export const VISIT_STATUS_ORDER = ['new', 'contacting', 'pending_confirmation', 'confirmed', 'completed', 'no_show', 'cancelled'] as const

export function visitStatus(status: string): StatusMeta {
  return VISIT_STATUS[status] ?? { label: status, tone: 'info' }
}

// 規格 190 固定選項。API 存代碼；更新前的舊案件可能還是中文原字，照原字顯示。
export const AGE_LABELS: Record<string, string> = {
  unknown: '尚未確定',
  under_2: '2 歲以下',
  '2-3': '2–3 歲',
  '3-4': '3–4 歲',
  '4-5': '4–5 歲',
  '5-6': '5–6 歲',
}

export const CONTACT_TIME_LABELS: Record<string, string> = {
  flexible: '時間彈性',
  weekday_morning: '平日上午',
  weekday_afternoon: '平日下午',
  other: '其他，另行確認',
}

export function ageLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return AGE_LABELS[value] ?? value
}

export function contactTimeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return CONTACT_TIME_LABELS[value] ?? value
}

// 案件來源。web 是官網表單，其他是園方在後台補登。
export const VISIT_SOURCE_LABELS: Record<string, string> = {
  web: '官網表單',
  phone: '電話',
  line: 'LINE',
  walk_in: '親自到園',
  external: '外部預約網站',
}

export const MANUAL_VISIT_SOURCES = ['phone', 'line', 'walk_in', 'external'] as const

export function visitSourceLabel(source: string | null | undefined): string {
  return VISIT_SOURCE_LABELS[source ?? 'web'] ?? source ?? ''
}

// 承辦人只存 id，畫面上顯示 email 的 @ 前面那段，表格裡才放得下。
export function staffLabel(
  staffId: string | null | undefined,
  staff: readonly { id: string; email: string }[],
): string {
  if (!staffId) return '未指派'
  const found = staff.find((s) => s.id === staffId)
  return found ? found.email.split('@')[0]! : '已移除的帳號'
}

export const MEDIA_STATUS: Record<string, StatusMeta> = {
  ready: { label: '可用', tone: 'success' },
  processing: { label: '處理中', tone: 'warning' },
  failed: { label: '失敗', tone: 'danger' },
}

export function mediaStatus(status: string): StatusMeta {
  return MEDIA_STATUS[status] ?? { label: status, tone: 'info' }
}

// 素材被引用的那一版是什麼（後端 media/references.py）。
export const MEDIA_REFERENCE_STATE: Record<string, StatusMeta> = {
  draft: { label: '最新草稿', tone: 'info' },
  live: { label: '官網上', tone: 'success' },
  scheduled: { label: '已排程', tone: 'warning' },
}

export function mediaReferenceState(state: string): StatusMeta {
  return MEDIA_REFERENCE_STATE[state] ?? { label: state, tone: 'info' }
}

/**
 * 引用的欄位路徑（後端 registry 的 extract_media_refs）→ 園方看得懂的位置。
 * 例：`articles[1].body[2].image` →「第 2 則消息內文第 3 段的圖片」。
 */
// 素材版位的欄位路徑（後端 registry 的 `…media_id`）→ 中文。
const MEDIA_SLOT_PATH_LABELS: Record<string, string> = {
  'video_desktop.media_id': '首屏影片（桌機）',
  'video_mobile.media_id': '首屏影片（手機）',
  'poster.media_id': '首屏影片 poster',
  'fallback_image.media_id': '首屏影片載入失敗替代圖',
  'photo.media_id': '關於常春藤照片',
  'film_desktop.media_id': '孩子的一天影片（桌機）',
  'film_mobile.media_id': '孩子的一天影片（手機）',
  'film_poster.media_id': '孩子的一天影片 poster',
  'cover.media_id': '封面照片',
  'line_art.media_id': '建築線稿',
  'line_art_colour.media_id': '建築線稿（上色）',
}

export function mediaFieldPathLabel(path: string): string {
  if (path === 'share_image') return '分享預覽圖'
  if (MEDIA_SLOT_PATH_LABELS[path]) return MEDIA_SLOT_PATH_LABELS[path]
  let slot = /^moments\[(\d+)\]\.photo\.media_id$/.exec(path)
  if (slot) return `孩子的一天第 ${Number(slot[1]) + 1} 張卡片的照片`
  slot = /^films\[(\d+)\]\.(video|poster)\.media_id$/.exec(path)
  if (slot) return `第 ${Number(slot[1]) + 1} 支活動影片的${slot[2] === 'video' ? '影片' : '封面'}`
  let m = /^scenes\[(\d+)\]\.image$/.exec(path)
  if (m) return `第 ${Number(m[1]) + 1} 個場景的照片`
  m = /^articles\[(\d+)\]\.image$/.exec(path)
  if (m) return `第 ${Number(m[1]) + 1} 則消息的封面`
  m = /^articles\[(\d+)\]\.body\[(\d+)\]\.image$/.exec(path)
  if (m) return `第 ${Number(m[1]) + 1} 則消息內文第 ${Number(m[2]) + 1} 段的圖片`
  return path
}

/** 影片長度（秒）→「1:05」；超過一小時「1:02:05」。 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const BOOKING_MODE_LABELS: Record<string, string> = {
  inquiry: '線上表單（收到需求後由園方聯絡）',
  slots: '時段預約（家長自選場次）',
  line: 'LINE 官方帳號',
  phone: '電話洽詢',
  external: '外部預約網站',
  paused: '暫停預約',
}

// 與後端 notifications/service.py 的 _KIND_LABELS 同一組（labels.test.ts 會比對）。
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  visit_request_created: '新的參觀需求',
  visit_request_pending_confirmation: '新的時段申請（待園方確認）',
  visit_request_confirmed: '參觀預約已確認',
  visit_request_cancelled: '參觀預約已取消',
  visit_request_rescheduled: '參觀預約已改期',
  visit_request_hold_expired: '時段占位已逾期，名額已釋放',
  visit_reschedule_requested: '家長申請改期（待園方核准）',
  // 定期工作產生的提醒（backend/app/notifications/reminders.py），門檻數字與後端常數一致。
  visit_upcoming: '即將參觀（24 小時內）',
  visit_request_overdue: '案件逾期未處理',
}

// 逾期未處理提醒的細分原因（payload.reason），與後端 reminders.REASON_LABELS 同一組。
export const NOTIFICATION_REASON_LABELS: Record<string, string> = {
  new_unhandled: '新的參觀需求超過 24 小時尚未處理',
  hold_expiring: '待確認的時段申請 6 小時內到期，逾期會自動釋出名額',
}

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind] ?? kind
}

/** 站內通知的標題：逾期未處理另外帶出是哪一種，和信件主旨同一個寫法。 */
export function notificationLabel(kind: string, payload?: Record<string, unknown> | null): string {
  const label = notificationKindLabel(kind)
  const reason = payload?.reason
  if (kind === 'visit_request_overdue' && typeof reason === 'string' && NOTIFICATION_REASON_LABELS[reason]) {
    return `${label}：${NOTIFICATION_REASON_LABELS[reason]}`
  }
  return label
}

// 寄送失敗的最後錯誤碼是後端例外的類別名稱，給園方看的是大概原因，代碼另外
// 小字附上，查問題時對得上伺服器紀錄。
export function outboxErrorLabel(code: string | null | undefined): string {
  if (!code) return '原因不明'
  if (code === 'LinePushError') return 'LINE 推播失敗'
  if (code === 'SMTPAuthenticationError') return '寄信伺服器帳號或密碼錯誤'
  if (code === 'SMTPRecipientsRefused') return '收件地址被寄信伺服器拒絕'
  if (code.startsWith('SMTP')) return '寄信伺服器錯誤'
  if (code === 'TimeoutError' || code === 'timeout') return '連線逾時'
  if (/^(Connection\w*Error|OSError|gaierror)$/.test(code)) return '連不上寄信或推播伺服器'
  return '其他錯誤'
}

// 與後端所有 audit_service.log_action 的 action 同一組（labels.test.ts 會掃後端原始碼比對）。
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'booking_config.update': '更新預約設定',
  'content.publish': '發布內容',
  'content.publish_scheduled': '排程發布內容',
  'content.submit_review': '內容送審',
  'content.approve': '核准並發布內容',
  'content.reject': '退回送審內容',
  'content.schedule': '設定排程發布',
  'content.schedule_cancel': '取消排程發布',
  'content.restore': '還原內容舊版',
  'content.schedule_failed': '排程發布未執行（檢查不通過）',
  'content.schedule_skipped': '排程發布略過（官網已是較新版本）',
  'release.restore': '整站還原到某次發布',
  'notification_outbox.retry': '重新寄送通知',
  'retention.run': '執行資料清理',
  'site_settings.update': '更新全站設定',
  'line.campus_target.update': '更新 LINE 通知群組',
  'line.test_push': '送出 LINE 測試訊息',
  'user.create': '新增帳號',
  'user.set_active': '變更帳號啟用狀態',
  'user.set_scope': '變更負責校區',
  'user.reset_password': '重設密碼',
  'user.change_password': '變更自己的密碼',
  'user.set_role': '變更角色與校區',
  'user.set_capabilities': '變更授權（全站內容／匯出個資）',
  'visit_request.export': '匯出家長個資',
  'visit_request.manual_create': '人工補登參觀案件',
  'visit_request.assign': '指派承辦人',
  'visit_request.create_access_link': '產生家長管理連結',
  'visit_request.revoke_access': '撤銷家長管理連結',
  'visit_request.contacting': '開始聯絡案件',
  'visit_request.add_contact_note': '新增聯絡紀錄',
  'visit_request.confirm': '確認預約',
  'visit_request.reschedule': '改期',
  'visit_request.cancel': '取消預約',
  'visit_request.no_show': '標記未到場',
  'visit_request.complete': '標記完成參觀',
  'visit_request.approve_reschedule': '核准家長改期申請',
  'visit_request.reject_reschedule': '退回家長改期申請',
  'visit_slot.create': '新增參觀時段',
  'visit_slot.update': '調整時段名額或開關',
  'retention_policy.update': '更新個資保存政策',
  'user.link_google': '綁定 Google 登入',
  'user.unlink_google': '解除 Google 登入綁定',
  'user.login_google': 'Google 登入',
  'user.login_google_failed': 'Google 登入失敗',
  'user.link_line': '綁定 LINE 登入',
  'user.unlink_line': '解除 LINE 登入綁定',
  'visit_schedule.update': '更新每週開放規則',
  'visit_slots.generate': '依規則產生時段',
  'visit_exception.create': '設定休假日',
  'visit_exception.delete': '取消休假日',
  'campus.activate': '重新啟用分校',
  'campus.deactivate': '停用分校',
  'media.upload': '上傳素材',
  'media.update': '修改素材說明',
  'media.replace': '上傳新檔替換素材',
  'media.delete': '刪除素材（移到待清理）',
  'media.restore': '復原刪除的素材',
  'media.archive': '封存素材',
  'media.unarchive': '取消封存素材',
  'media.purge': '清理刪除的素材檔案',
  'media.replace_references': '替換素材並產生草稿',
  'media.import_site_assets': '匯入官網內建素材',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

// 稽核紀錄 metadata 裡的 reason 代碼（目前是 Google 登入失敗的原因）。
export const AUDIT_REASON_LABELS: Record<string, string> = {
  cancelled: '使用者取消',
  provider_error: 'Google 回傳錯誤',
  failed: '驗證未完成或逾時',
  unverified_email: 'Google 帳號 Email 未驗證',
  unsupported_account: '不是 Gmail 或 Google Workspace 帳號',
  no_matching_account: '沒有相同 Email 的後台帳號',
  inactive: '帳號已停用',
  linked_to_other_google: '帳號已綁定其他 Google 帳號',
  not_allowed: '無法綁定',
  // 2026-09-25 migration：把仍在發布中的原型示範同意文字換成正式文字。
  formal_consent_migration: '系統把原型示範同意文字換成正式文字',
  // 定期清理時發現待清理的素材又被內容用到，改回一般素材。
  still_referenced: '仍被內容引用，取消清理',
}

export function auditReasonLabel(reason: string): string {
  return AUDIT_REASON_LABELS[reason] ?? reason
}

// 案件歷程（後端 visit_request_events.event_type）。
export const VISIT_EVENT_LABELS: Record<string, string> = {
  created: '建立案件',
  contacting: '開始聯絡',
  returned_to_contacting: '退回聯絡中，釋出場次',
  confirmed: '確認預約',
  rescheduled: '改期',
  cancelled: '取消預約',
  no_show: '標記未到場',
  completed: '完成參觀',
  hold_expired: '占位逾期，名額釋出',
  contact_logged: '新增聯絡紀錄',
  assigned: '指派承辦人',
  unassigned: '取消指派',
  linked_from_previous: '由先前的案件重新預約',
  rebooked_as_new: '另建新案重新預約',
  reschedule_requested: '家長申請改期',
  reschedule_rejected: '退回改期申請',
  reschedule_superseded: '家長的改期申請失效（園方已直接改期）',
  access_link_created: '產生家長管理連結',
  access_link_revoked: '撤銷家長管理連結',
}

export function visitEventLabel(eventType: string): string {
  return VISIT_EVENT_LABELS[eventType] ?? eventType
}

// 歷程是誰做的：後台人員另外顯示帳號；家長沒有帳號、系統是定期工作。
export const VISIT_EVENT_SOURCE_LABELS: Record<string, string> = {
  staff: '園方人員',
  parent: '家長',
  system: '系統自動',
}

// 與後端 log_action 的 target_type 同一組（labels.test.ts 會比對）。
export const AUDIT_TARGET_LABELS: Record<string, string> = {
  booking_config: '預約設定',
  campus: '分校',
  content_item: '內容',
  media_asset: '素材',
  notification_outbox: '通知寄送',
  site_settings: '全站設定',
  site_release: '發布紀錄',
  user: '使用者',
  visit_request: '參觀案件',
  visit_requests: '參觀案件（批次清理）',
  visit_schedule: '開放規則',
  visit_exception: '休假日',
  visit_slot: '參觀時段',
  retention_policy: '個資保存政策',
}

// 個資保存政策會清理的案件類別（後端 retention_service.CATEGORIES）。
export const RETENTION_CATEGORY_LABELS: Record<string, string> = {
  cancelled: '已取消',
  no_show: '未到場',
  completed: '已完成參觀',
}

export const RETENTION_TRIGGER_LABELS: Record<string, string> = {
  manual: '手動執行',
  scheduled: '定期工作',
}

export function auditTargetLabel(target: string): string {
  return AUDIT_TARGET_LABELS[target] ?? target
}

// 發布確認框列「哪些欄位會變」時用的欄位中文名；各 kind 的欄位名互不衝突，
// 所以用一張表就夠。沒列到的欄位退回原始鍵名，不會漏列。
export const CONTENT_FIELD_LABELS: Record<string, string> = {
  eyebrow: '小標',
  eyebrow_en: '英文小標',
  copy_lines: '標語',
  cta_label: '按鈕文字',
  cta_label_en: '英文按鈕文字',
  title: '標題',
  since_label: '創校標籤',
  body_text: '內文',
  caption: '照片說明',
  section_title: '區塊標題',
  note: '說明文字',
  campus_list_label: '校區清單標題',
  intro: '前言',
  description: '說明',
  source_note: '來源說明',
  bottom_note: '底部備註',
  moments: '時刻',
  sample_note: '示意說明',
  articles: '最新消息',
  events: '近期活動',
  notice: '頁面提醒',
  steps: '入學步驟',
  phases: '新生入園階段',
  uniform_week: '每週穿著',
  uniform_note: '穿著說明',
  pickup_notes: '接送安全',
  registration_notes: '註冊須知',
  fee_intro: '收退費說明',
  subsidies: '補助',
  allowance_title: '育兒津貼標題',
  allowance: '育兒津貼',
  allowance_note: '育兒津貼附註',
  refunds: '退費規定',
  scenes: '場景',
  items: '項目',
  name: '校名',
  tagline: '一句話介紹',
  district: '所在地區',
  address: '地址',
  phone: '電話',
  line: 'LINE',
  facebook: 'Facebook',
  fb_note: 'Facebook 備註',
  consent_text: '同意條款文字',
  privacy_title: '隱私說明標題',
  privacy_sections: '隱私說明段落',
  banner_title_template: '橫幅標題',
  banner_body: '橫幅內文',
  banner_button_label: '橫幅按鈕文字',
  copyright: '版權文字',
  header_phone_number: '頁首電話',
  header_phone_note: '頁首電話備註',
  home_display_count: '首頁顯示筆數',
  include_shared: '顯示共用題目',
  shared_position: '共用題目位置',
  primary_nav: '主選單',
  links: '頁尾連結',
  campus_order: '五校順序',
  default_campus: '預設顯示的校區',
  map_url: '地圖連結',
  video_desktop: '桌機影片',
  video_mobile: '手機影片',
  poster: '影片 poster',
  poster_alt: 'poster 替代文字',
  fallback_image: '影片載入失敗替代圖',
  photo: '照片',
  photo_alt: '照片替代文字',
  film_desktop: '背景影片（桌機）',
  film_mobile: '背景影片（手機）',
  film_poster: '背景影片 poster',
  film_caption_zh: '影片說明（中文）',
  film_caption_en: '影片說明（英文）',
  cover: '封面照片',
  card_focus: '首頁卡片焦點',
  hero_focus: '分校頁首屏焦點',
  line_art: '建築線稿',
  line_art_colour: '建築線稿（上色）',
  films: '手機版活動影片',
}

export function contentFieldLabel(key: string): string {
  return CONTENT_FIELD_LABELS[key] ?? key
}

// 發布成功後「查看官網」要開到那段內容所在的頁面，不是一律開首頁。
export function contentPublicPath(kind: string, campusKey?: string | null): string {
  if (kind === 'campus_profile' || kind === 'campus_faq' || kind === 'campus_tour') {
    return campusKey ? `/campuses/${campusKey}` : '/'
  }
  // 共用常見問題出現在每一校的分校頁，先開第一校（義華）。
  if (kind === 'shared_faq') return '/campuses/yihua#faq'
  if (kind === 'booking_content') return campusKey ? `/visit/${campusKey}` : '/visit'
  if (kind === 'admission_content') return '/admission'
  return '/'
}

// 私有草稿預覽（官網 /preview，登入後才看得到未發布內容）。預覽頁有首頁、
// 入學資訊、分校頁與預約頁（預約文案：同意文字、個資說明、頁首按鈕）。
export function contentPreviewPath(kind: string, campusKey?: string | null): string {
  if (kind === 'campus_profile' || kind === 'campus_faq' || kind === 'campus_tour') {
    return campusKey ? `/preview?page=campus&campus=${encodeURIComponent(campusKey)}` : ''
  }
  if (kind === 'shared_faq') return '/preview?page=campus&campus=yihua'
  if (kind === 'admission_content') return '/preview?page=admission'
  if (kind === 'booking_content') return '/preview?page=visit'
  return '/preview'
}

/** 內容編輯頁的路由；分校內容帶 ?campus= 讓編輯頁直接切到那一校。 */
export function contentEditorPath(kind: string, campusKey?: string | null): string {
  const path = kind === 'admission_content' ? '/content/admission' : `/content/${kind.replace(/_/g, '-')}`
  return campusKey ? `${path}?campus=${encodeURIComponent(campusKey)}` : path
}

/** 「首頁大圖標語」或「各校常見問題（義華校）」 */
export function contentItemLabel(kind: string | null | undefined, campusKey?: string | null): string {
  const name = kind ? (CONTENT_KIND_LABELS[kind] ?? kind) : '內容'
  return campusKey ? `${name}（${campusLabel(campusKey)}）` : name
}

// 內容版本的審核狀態（後端 content/models.py 的 REVIEW_STATUSES）。
export const REVIEW_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_review: '待審核',
  approved: '已核准',
  rejected: '已退回',
  superseded: '已被新版取代',
}

// 排程發布的狀態（後端 PublishJob.status）。
export const PUBLISH_JOB_STATUS: Record<string, StatusMeta> = {
  scheduled: { label: '等待發布', tone: 'warning' },
  done: { label: '已發布', tone: 'success' },
  failed: { label: '沒有發布', tone: 'danger' },
  skipped: { label: '已略過', tone: 'info' },
  cancelled: { label: '已取消', tone: 'info' },
}

export function publishJobStatus(status: string): StatusMeta {
  return PUBLISH_JOB_STATUS[status] ?? { label: status, tone: 'info' }
}

// 發布紀錄的來源（後端 content/models.py 的 ReleaseSource）；舊紀錄為 null。
export const RELEASE_SOURCE_LABELS: Record<string, string> = {
  publish: '發布',
  review: '核准送審並發布',
  scheduled: '排程發布',
  restore: '還原舊版並發布',
  release_restore: '整站還原',
  initialize: '初始化匯入',
}

export function releaseSourceLabel(source: string | null | undefined): string {
  return source ? (RELEASE_SOURCE_LABELS[source] ?? source) : '發布'
}

// 給個人的站內通知（後端 content/notices.py 的 KINDS）。
export const USER_NOTIFICATION_LABELS: Record<string, string> = {
  content_review_submitted: '有內容送審，等你核准',
  content_review_approved: '你送審的內容已核准並發布',
  content_review_rejected: '你送審的內容被退回',
  content_schedule_failed: '排程發布沒有執行',
  content_schedule_skipped: '排程發布已略過（官網已是較新版本）',
}

export function userNotificationLabel(kind: string): string {
  return USER_NOTIFICATION_LABELS[kind] ?? kind
}

// 內容 kind 的中文名，給編輯頁標題與總覽「待發布」清單用。
export const CONTENT_KIND_LABELS: Record<string, string> = {
  home_hero: '首頁大圖標語',
  home_about: '首頁「關於常春藤」',
  home_campus_board: '首頁五校區塊',
  day_experience: '孩子的一天',
  home_news: '最新消息與活動',
  admission_content: '入學資訊',
  campus_profile: '五校介紹',
  campus_faq: '各校常見問題',
  shared_faq: '共用常見問題',
  campus_news: '各校消息與活動',
  campus_tour: '校園探索',
  booking_content: '預約文案',
  site_footer: '頁尾文字',
  site_meta: '網站標題與電話',
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Taipei',
})

const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Taipei',
})

// ISO 字串 → 「2026/09/21 14:30」。無效或空值回「—」，不丟例外，表格裡
// 缺欄位不該讓整頁掛掉。
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return dateTimeFormatter.format(d).replace(/\s+/g, ' ')
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  // 純日期字串（YYYY-MM-DD）直接以本地日期解讀，避免時區往前退一天。
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+08:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return dateFormatter.format(d)
}

// 「HH:MM:SS」→「HH:MM」
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 5)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 星期幾，給時段列表用。
const weekdayFormatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short', timeZone: 'Asia/Taipei' })

export function formatWeekday(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return ''
  return weekdayFormatter.format(d)
}

// 案件上的「參觀時間」：09/26（週六）10:00–11:00。明細、列表與確認對話框
// 共用同一種寫法，家長在電話裡聽到的跟畫面上看到的才會一致。沒有排時段
// （inquiry 待處理）回破折號。
export function formatSlotWhen(
  slot: { slot_date: string; start_time: string; end_time: string } | null | undefined,
): string {
  if (!slot) return '—'
  return `${formatDate(slot.slot_date)}（${formatWeekday(slot.slot_date)}）${formatTime(slot.start_time)}–${formatTime(slot.end_time)}`
}


// 待園方確認的占位還剩多久會被釋出：「還剩 5 小時」「還剩 40 分鐘」。
// 無條件捨去，寧可講少不講多；過了期限 worker 還沒跑到時顯示「已逾期」。
export function formatHoldRemaining(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return ''
  const expires = new Date(value).getTime()
  if (Number.isNaN(expires)) return ''
  const minutes = Math.floor((expires - now) / 60000)
  if (minutes <= 0) return '已逾期'
  if (minutes < 60) return `還剩 ${minutes} 分鐘`
  return `還剩 ${Math.floor(minutes / 60)} 小時`
}

// 時段已經開始（或結束）：後台排入與改期都不能再選，後端也會拒絕。
// 日期與時間是台灣時間。
export function slotStarted(
  slot: { slot_date: string; start_time: string },
  now: number = Date.now(),
): boolean {
  const starts = new Date(`${slot.slot_date}T${slot.start_time.slice(0, 8)}+08:00`).getTime()
  return !Number.isNaN(starts) && starts <= now
}

// 剩不到 6 小時就該先處理，列表與總覽用暖色提醒。
export function holdIsUrgent(value: string | null | undefined, now: number = Date.now()): boolean {
  if (!value) return false
  const expires = new Date(value).getTime()
  return !Number.isNaN(expires) && expires - now < 6 * 3600 * 1000
}

// 家長線上取消／改期的截止（各校設定，預設參觀前 24 小時）。整天數且超過一天
// 時講「天」，家長與櫃台都比較好理解。
export function parentDeadlineLabel(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `參觀前 ${hours / 24} 天`
  return `參觀前 ${hours} 小時`
}

// 「待人工處理」：時段已關閉（含休假日）但家長仍要來，或分校已停用但尚未
// 結案的案件。關時段、設休假日、停用分校後的提示與總覽待辦都連到這裡。
export function attentionListPath(campusKey?: string | null): string {
  return campusKey ? `/visit-requests?attention=1&campus=${encodeURIComponent(campusKey)}` : '/visit-requests?attention=1'
}

// 規格 L194：參觀人數 1–10。舊案件與沒問到的補登沒有人數。
export const PARTY_SIZE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export function partySizeLabel(value: number | null | undefined): string {
  return value ? `${value} 位` : '未填'
}

// 案件的同意紀錄（規格 L196）：官網送單記錄家長看到的「預約文案」版本與伺服器
// 接受時間；補登是人員向家長說明後代勾；2026-09-25 以前的官網案件沒有版本。
export function consentRecordLabel(detail: {
  source?: string | null
  consent_given?: boolean
  consent_revision_id?: string | null
  consent_revision_version?: number | null
  consent_accepted_at?: string | null
}): string {
  if (detail.consent_given === false) return '未同意'
  const when = detail.consent_accepted_at ? `・${formatDateTime(detail.consent_accepted_at)}` : ''
  if (detail.consent_revision_id) {
    const version = detail.consent_revision_version ? `預約文案第 ${detail.consent_revision_version} 版` : '版本已無法查到'
    return `家長勾選同意（${version}）${when}`
  }
  if (detail.source && detail.source !== 'web') return `人員說明後代為勾選${when}`
  return `家長勾選同意（案件建立時尚未記錄版本）${when}`
}

// 預約設定的欄位名（稽核紀錄的修改前後、切換確認框用），與後端
// booking/service.py 的 CONFIG_AUDIT_FIELDS 同一組；另含開放規則的兩個欄位。
export const BOOKING_CONFIG_FIELD_LABELS: Record<string, string> = {
  mode: '預約方式',
  line_url: 'LINE 連結',
  phone: '洽詢電話',
  external_url: '外部預約網址',
  message: '給家長的說明',
  slots_auto_confirm: '送出後自動確認',
  parent_change_deadline_hours: '家長線上異動期限',
  min_lead_hours: '最短提前時數',
  max_advance_days: '最遠開放天數',
}

export function bookingConfigValueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空白）'
  if (field === 'mode') return BOOKING_MODE_LABELS[String(value)] ?? String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (field === 'parent_change_deadline_hours' && typeof value === 'number') return parentDeadlineLabel(value)
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

/** 修改前後不同的欄位：「預約方式：暫停預約 → 線上表單」。 */
export function configChangeLines(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  valueLabel: (field: string, value: unknown) => string = bookingConfigValueLabel,
): string[] {
  if (!before || !after) return []
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => `${AUDIT_FIELD_LABELS[key] ?? BOOKING_CONFIG_FIELD_LABELS[key] ?? key}：${valueLabel(key, before[key])} → ${valueLabel(key, after[key])}`)
}

// 總管理者逐人授予的授權（後端 GRANTABLE_CAPABILITIES）。
export const GRANT_LABELS: Record<string, string> = {
  'content.shared': '全站內容',
  'booking.export': '匯出個資',
}

export function grantLabels(codes: readonly unknown[]): string {
  return codes.length ? codes.map((code) => GRANT_LABELS[String(code)] ?? String(code)).join('、') : '無'
}

// 帳號類稽核（變更角色與校區、新增帳號）的欄位。
const AUDIT_FIELD_LABELS: Record<string, string> = { role: '角色', campus_keys: '負責校區', capabilities: '授權' }

function auditValueLabel(field: string, value: unknown): string {
  if (field === 'role' && typeof value === 'string') return roleLabel(value)
  if (Array.isArray(value)) {
    if (field === 'capabilities') return grantLabels(value)
    if (!value.length) return '（無）'
    return field === 'campus_keys' ? campusLabels(value.map(String)) : value.map(String).join('、')
  }
  return bookingConfigValueLabel(field, value)
}

/** 稽核紀錄 metadata 有 before／after 時列出改了什麼；沒有回空字串。
 * 授權清單（user.set_capabilities 的 before／after 是陣列）講清楚這次是授予
 * 還是收回哪一項，例如「授予：匯出個資」。 */
export function auditChangeSummary(metadata: Record<string, unknown> | null | undefined): string {
  const before = metadata?.before
  const after = metadata?.after
  if (Array.isArray(before) && Array.isArray(after)) {
    const was = new Set(before.map(String))
    const now = new Set(after.map(String))
    const granted = [...now].filter((code) => !was.has(code))
    const revoked = [...was].filter((code) => !now.has(code))
    const parts = [granted.length ? `授予：${grantLabels(granted)}` : '', revoked.length ? `收回：${grantLabels(revoked)}` : '']
    return parts.filter(Boolean).join('；') || `沒有變更（${grantLabels(after)}）`
  }
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return ''
  return configChangeLines(before as Record<string, unknown>, after as Record<string, unknown>, auditValueLabel).join('；')
}

/** 操作紀錄「細節」欄：純值列成「key=值」，帳號與授權相關的陣列轉成中文，
 * 有修改前後的再接「修改：…」。 */
export function auditMetadataSummary(metadata: Record<string, unknown> | null | undefined): string {
  // 物件與陣列形式的 before／after 交給 auditChangeSummary；其他物件不攤開。
  const isPlainList = (value: unknown): value is unknown[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')
  const plain = Object.entries(metadata ?? {})
    .filter(([key, value]) => {
      if (value === null || value === undefined) return false
      if (typeof value !== 'object') return true
      return isPlainList(value) && key !== 'before' && key !== 'after'
    })
    .map(([key, value]) => {
      if (key === 'reason') return `原因=${auditReasonLabel(String(value))}`
      // 改角色時一併收回的授權（例如分校管理者降為櫃台收回匯出個資）。
      if (key === 'capabilities_removed' && Array.isArray(value)) return `因改角色收回授權：${grantLabels(value)}`
      if (Array.isArray(value) || key === 'role') return `${AUDIT_FIELD_LABELS[key] ?? key}：${auditValueLabel(key, value)}`
      return `${key}=${String(value)}`
    })
    .join('，')
  const changes = auditChangeSummary(metadata)
  return [plain, changes ? `修改：${changes}` : ''].filter(Boolean).join('，')
}

export const REFERRAL_SOURCE_LABELS: Record<string, string> = { facebook: 'Facebook', google_reviews: 'Google 評論', parent_community: '媽媽社團', friends_family: '親友介紹', other: '其他' }

export function referralSourceLabels(sources: string[] | null | undefined): string {
  return sources?.length ? sources.map(source => REFERRAL_SOURCE_LABELS[source] || source).join('、') : '未填寫'
}

// 成效統計（/admin/analytics/funnel）。unknown 是 2026-09-25 以前沒有記錄
// 來源、原因或入口的舊事件。
export const ANALYTICS_UNKNOWN = 'unknown'

// 公開點擊的入口代碼：按鈕在官網哪個區塊。要和後端 operations/models.py 的
// CTA_ENTRIES 一致（labelCoverage 測試會比對）。
export const CTA_ENTRY_LABELS: Record<string, string> = {
  header: '頁首預約鈕',
  menu: '選單面板',
  footer: '頁尾',
  home_campus_board: '首頁五校卡',
  campus_hero: '分校頁首屏',
  campus_info: '分校頁「來認識」',
  campus_contact: '分校頁交通與聯絡',
  campus_banner: '分校頁底部預約橫幅',
  campus_tour: '分校頁校園照片',
  admission: '入學資訊頁',
  visit_page: '預約頁',
  visit_manage: '查詢／取消預約頁',
  other: '其他位置',
  unknown: '未記錄入口',
}

export function ctaEntryLabel(entry: string): string {
  return CTA_ENTRY_LABELS[entry] ?? entry
}

// visit_cancelled 的取消原因（後端 CANCEL_REASONS）。
export const CANCEL_REASON_LABELS: Record<string, string> = {
  parent: '家長自行取消',
  staff: '園方取消',
  hold_expired: '待確認逾期',
  unknown: '未記錄原因',
}

export function cancelReasonLabel(reason: string): string {
  return CANCEL_REASON_LABELS[reason] ?? reason
}

export function funnelSourceLabel(source: string): string {
  return source === ANALYTICS_UNKNOWN ? '未記錄來源' : visitSourceLabel(source)
}

export function funnelReferralLabel(referral: string): string {
  if (referral === ANALYTICS_UNKNOWN) return '未記錄'
  if (referral === 'none') return '未填寫'
  return REFERRAL_SOURCE_LABELS[referral] ?? referral
}
