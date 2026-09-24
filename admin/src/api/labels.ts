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

// 新增帳號時給總管理者看的角色說明（規格 7 權限表）。
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: '管理全部校區、使用者、全站內容與設定。',
  campus_admin: '處理指定校區的內容、預約設定、時段與參觀案件。',
  editor: '編輯指定校區的內容與素材；不能發布，改好送審，由校區管理者發布。看不到家長個資。',
  reception: '處理指定校區的參觀案件、聯絡紀錄與接待日曆；只能查看、不能改狀態，也不能改官網。',
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
  new: { label: '待處理', tone: 'warning' },
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

// 案件來源。web 以外都是園方在後台人工補登的。
export const VISIT_SOURCE_LABELS: Record<string, string> = {
  web: '官網表單',
  phone: '電話',
  line: 'LINE',
  walk_in: '現場',
  external: '外部預約網站',
}

export const MANUAL_VISIT_SOURCES = ['phone', 'line', 'walk_in', 'external'] as const

export function visitSourceLabel(source: string | null | undefined): string {
  if (!source) return VISIT_SOURCE_LABELS.web!
  return VISIT_SOURCE_LABELS[source] ?? source
}

export const MEDIA_STATUS: Record<string, StatusMeta> = {
  ready: { label: '可用', tone: 'success' },
  processing: { label: '處理中', tone: 'warning' },
  failed: { label: '失敗', tone: 'danger' },
}

export function mediaStatus(status: string): StatusMeta {
  return MEDIA_STATUS[status] ?? { label: status, tone: 'info' }
}

export const BOOKING_MODE_LABELS: Record<string, string> = {
  inquiry: '線上表單（收到需求後由園方聯絡）',
  slots: '時段預約（家長自選場次）',
  line: 'LINE 官方帳號',
  phone: '電話洽詢',
  external: '外部預約網站',
  paused: '暫停預約',
}

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  visit_request_created: '新的參觀需求',
  visit_request_confirmed: '參觀預約已確認',
  visit_request_cancelled: '參觀預約已取消',
  visit_request_rescheduled: '參觀預約已改期',
}

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind] ?? kind
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'booking_config.update': '更新預約設定',
  'content.publish': '發布內容',
  'retention.run': '執行資料清理',
  'site_settings.update': '更新全站設定',
  'user.set_active': '變更帳號啟用狀態',
  'user.link_google': '綁定 Google 登入',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

export const AUDIT_TARGET_LABELS: Record<string, string> = {
  booking_config: '預約設定',
  content_item: '內容',
  site_settings: '全站設定',
  user: '使用者',
  visit_request: '參觀案件',
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
  banner_title_template: '橫幅標題',
  banner_body: '橫幅內文',
  banner_button_label: '橫幅按鈕文字',
  copyright: '版權文字',
  header_phone_number: '頁首電話',
  header_phone_note: '頁首電話備註',
}

export function contentFieldLabel(key: string): string {
  return CONTENT_FIELD_LABELS[key] ?? key
}

// 發布成功後「查看官網」要開到那段內容所在的頁面，不是一律開首頁。
export function contentPublicPath(kind: string, campusKey?: string | null): string {
  if (kind === 'campus_profile' || kind === 'campus_faq' || kind === 'campus_tour') {
    return campusKey ? `/campuses/${campusKey}` : '/'
  }
  if (kind === 'booking_content') return campusKey ? `/visit/${campusKey}` : '/visit'
  if (kind === 'admission_content') return '/admission'
  return '/'
}

// 私有草稿預覽（官網 /preview，登入後才看得到未發布內容）。預覽頁目前
// 有首頁、入學資訊、分校頁三種；預約文案在預約頁，預覽頁沒有，回空字串。
export function contentPreviewPath(kind: string, campusKey?: string | null): string {
  if (kind === 'campus_profile' || kind === 'campus_faq' || kind === 'campus_tour') {
    return campusKey ? `/preview?page=campus&campus=${encodeURIComponent(campusKey)}` : ''
  }
  if (kind === 'admission_content') return '/preview?page=admission'
  if (kind === 'booking_content') return ''
  return '/preview'
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

// 剩不到 6 小時就該先處理，列表與總覽用暖色提醒。
export function holdIsUrgent(value: string | null | undefined, now: number = Date.now()): boolean {
  if (!value) return false
  const expires = new Date(value).getTime()
  return !Number.isNaN(expires) && expires - now < 6 * 3600 * 1000
}

export function referralSourceLabels(sources: string[] | null | undefined): string {
  const labels: Record<string, string> = { facebook: 'Facebook', google_reviews: 'Google 評論', parent_community: '媽媽社團', friends_family: '親友介紹', other: '其他' }
  return sources?.length ? sources.map(source => labels[source] || source).join('、') : '未填寫'
}
