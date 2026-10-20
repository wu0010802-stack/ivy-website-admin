// 後台顯示用的中文標籤與格式化。API 回傳的都是代碼（campus key、狀態、
// 角色），畫面上一律經過這裡轉成園方看得懂的字，不要在各頁面各自硬寫。
import type { Role } from './types'
import { formatWeekday, slotStart } from '../utils/visitSchedule'
import { pageSeoPageLabel } from '../composables/pageSeoDefaults'

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
  editor: '內容編輯',
  reception: '櫃台',
  readonly: '唯讀',
}

// 新增帳號時給總管理者看的角色說明（規格 7 權限表，2026-09-25 業主裁定
// 接待人員可以處理案件）。要跟 backend/app/auth/permissions.py 一致。
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: '管理全部校區、使用者、全站內容與設定。',
  campus_admin: '處理指定校區的內容、預約設定、時段與參觀案件。匯出家長個資要另外授權。',
  editor: '編輯指定校區的內容與素材；不能發布，改好送審，由校區管理者發布。看不到家長個資。',
  reception: '處理指定校區的參觀案件：記聯絡紀錄、排入既有時段、補登、改期、取消與完成。不能新增時段、改預約設定或官網內容。',
  readonly: '查看指定校區的內容與官網瀏覽、速度統計；看不到家長個資。',
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

// 參觀案件狀態。歷程與操作紀錄寫「A → B」時用；列表、明細與參觀場次的狀態標籤
// 用下方 visitDisplay 的分組說法。兩邊用同一組詞：confirmed 叫「預約正常」、
// completed 叫「已到場」（2026-09-30 自選場次裁定、明細按鈕「標記已到場」）。
export const VISIT_STATUS: Record<string, StatusMeta> = {
  confirmed: { label: '預約正常', tone: 'success' },
  completed: { label: '已到場', tone: 'info' },
  cancelled: { label: '已取消', tone: 'info' },
  no_show: { label: '未到場', tone: 'danger' },
  // 舊流程的狀態（2026-10-06 拿掉）只出現在以前的歷程與操作紀錄，例如補登先建 new
  // 再排入場次、舊案聯絡中後取消。new 只是「已收到需求」，文字不能寫成「已預約」。
  new: { label: '待處理', tone: 'primary' },
  contacting: { label: '聯絡中', tone: 'primary' },
  pending_confirmation: { label: '待園方確認', tone: 'warning' },
}

// 列表分組（2026-09-30 業主裁定，參考義華舊後台）：資料庫狀態不變，只在顯示上歸組。
// 原本的「待處理」只剩自選場次上線前的舊案，2026-10-05 拿掉分組、舊案已刪除。
export const VISIT_GROUPS = ['upcoming', 'past', 'cancelled'] as const
export type VisitGroup = typeof VISIT_GROUPS[number]
export const VISIT_GROUP_LABELS: Record<VisitGroup, string> = { upcoming: '預約正常', past: '時間已過', cancelled: '已取消' }

// 案件列表的接待頁籤（2026-10-06 方向 B）：後端 status_groups.view_condition。和上面的分組（group）不同，
// 接下來以台北「今天」為界、今天整天都在，頁籤可以重疊；分組留給總覽、成效統計與舊連結。
export const VISIT_VIEWS = ['upcoming', 'past', 'arrived', 'cancelled'] as const
export type VisitView = typeof VISIT_VIEWS[number]
export const VISIT_VIEW_LABELS: Record<VisitView, string> = { upcoming: '接下來', past: '時間已過', arrived: '已到場', cancelled: '已取消' }

// 舊書籤的 ?status=：對到接待頁籤；舊流程的 new／contacting／pending_confirmation 回空字串（落到「全部」）。
const LEGACY_STATUS_VIEW: Record<string, VisitView> = { confirmed: 'upcoming', completed: 'arrived', no_show: 'past', cancelled: 'cancelled' }
export function legacyStatusView(status: string): VisitView | '' {
  return LEGACY_STATUS_VIEW[status] ?? ''
}

const CANCELLED_BY_LABELS: Record<string, string> = { parent: '家長取消', staff: '園方取消', hold_expired: '逾期未確認' }
// confirmed 且時間已過＝還沒標記到場；之後招生入學靠「標記已到場」建立招生訪視，所以要看得出來。
const PAST_SUB: Record<string, string> = { completed: '已到場', no_show: '未到場', confirmed: '尚未確認到場' }

// 與官網結果頁同規則：w***@domain。
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  if (!name || !domain) return email
  return `${name.slice(0, 1)}***@${domain}`
}

// 時間已過但還沒標記到場的是接待要處理的事，用暖黃和已到場、未到場（灰）分開。
export function visitDisplay(row: { status: string; display_status: string; cancel_reason?: string | null; cancelled_at?: string | null }): { label: string; tone: TagTone; sub: string } {
  switch (row.display_status) {
    case 'past':
      return { label: '預約時間已過', tone: row.status === 'confirmed' ? 'warning' : 'info', sub: PAST_SUB[row.status] ?? '' }
    case 'cancelled': {
      const who = (row.cancel_reason && CANCELLED_BY_LABELS[row.cancel_reason]) || '取消時間'
      return { label: '預約已取消', tone: 'danger', sub: row.cancelled_at ? `${who}：${formatShortDateTime(row.cancelled_at)}` : '' }
    }
    default:
      return { label: '預約正常', tone: 'success', sub: '' }
  }
}

export function visitStatus(status: string): StatusMeta {
  return VISIT_STATUS[status] ?? { label: status, tone: 'info' }
}

// 前端自己算分組，和後端 status_groups.display_status 同一個判準：場次開始的那一刻起
// 算「時間已過」。參觀場次的當天清單沒有 display_status；案件明細開著等家長來時，
// 也要跟著時鐘從「預約正常」換成「預約時間已過」。
export function visitDisplayStatus(status: string, slot: { slot_date: string; start_time: string } | null | undefined, now: number = Date.now()): string {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed' || status === 'no_show') return 'past'
  if (!slot) return 'upcoming'
  return slotStarted(slot, now) ? 'past' : 'upcoming'
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

// 沒填時寫「未填寫」，和明細其他選填欄位一致，不會讓人以為是資料缺漏。
export function contactTimeLabel(value: string | null | undefined): string {
  if (!value) return '未填寫'
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

// ---- 同事的名字（2026-09-28 業主裁定加「顯示名稱」）----
// 登錄的人、聯絡紀錄、歷程、操作紀錄、發布與排程、素材上傳者……凡是畫面上
// 寫「誰」的地方都走這裡：有顯示名稱用顯示名稱，沒填就用 Email @ 前面那段
// （表格放得下）。完整 Email 只放在 title，滑過去看得到，同前綴的同事靠它分辨。

/** 同事顯示名字需要的兩個欄位；API 的 created_by_*／actor_* 等用 staffOf 轉成這個形狀。 */
export interface StaffPerson {
  display_name?: string | null
  email?: string | null
}

/** 顯示名稱的長度上限，和後端 DISPLAY_NAME_MAX_LENGTH 一致（算字數，不是位元組）。 */
export const DISPLAY_NAME_MAX_LENGTH = 12

/** 同事在畫面上的名字。兩個欄位都沒有（系統動作、帳號已刪除）時回 fallback。 */
export function staffLabel(person: StaffPerson | null | undefined, fallback = '已移除的帳號'): string {
  const name = person?.display_name?.trim()
  if (name) return name
  const email = person?.email?.trim()
  if (email) return email.split('@')[0] || email
  return fallback
}

/** 名字旁邊 title／tooltip 用的完整 Email；沒有時回空字串（不掛 title）。 */
export function staffEmail(person: StaffPerson | null | undefined): string {
  return person?.email?.trim() ?? ''
}

/** 要確定是哪一個帳號的地方（確認框標題、帳號管理的提示）：「王小美（amy@ivy.tw）」；
 * 沒有顯示名稱時就是 Email 本身。 */
export function staffWithEmail(person: StaffPerson | null | undefined): string {
  const name = person?.display_name?.trim()
  const email = staffEmail(person)
  return name && email ? `${name}（${email}）` : name || email
}

type StaffFieldPrefix = 'actor' | 'created_by' | 'updated_by' | 'submitted_by'
type StaffFields<P extends StaffFieldPrefix> = { [K in `${P}_display_name` | `${P}_email`]?: string | null }

/** API 回傳的 `<prefix>_display_name`／`<prefix>_email` 兩欄取成 StaffPerson。 */
export function staffOf<P extends StaffFieldPrefix>(row: StaffFields<P>, prefix: P): StaffPerson {
  const fields = row as Record<string, string | null | undefined>
  return { display_name: fields[`${prefix}_display_name`], email: fields[`${prefix}_email`] }
}

/** 只存 id 的欄位（登錄的人、舊歷程裡的承辦人異動）：從同事名單找名字。 */
export function staffLabelById(
  staffId: string | null | undefined,
  staff: readonly (StaffPerson & { id: string })[],
): string {
  if (!staffId) return '未指派'
  const found = staff.find((s) => s.id === staffId)
  return found ? staffLabel(found) : '已移除的帳號'
}

/** staffLabelById 的 title：找得到就是完整 Email，找不到回空字串。 */
export function staffEmailById(
  staffId: string | null | undefined,
  staff: readonly (StaffPerson & { id: string })[],
): string {
  return staffId ? staffEmail(staff.find((s) => s.id === staffId)) : ''
}

// 看不見的字元：控制字元（Cc）、格式字元（Cf）、行／段落分隔（Zl、Zp）。表情
// 符號組合用的零寬連接字（U+200D）與旗幟的標籤字元（U+E0020–E007F）是正常字，不擋。
const HIDDEN_CHARACTER = /(?![\u200d\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** 顯示名稱算幾個字：去掉前後空白後逐字算，和後端 len() 一樣（不是 UTF-16 長度）。 */
export function displayNameLength(value: string): number {
  return Array.from(value.trim()).length
}

/**
 * 顯示名稱的前端檢查，規則和後端 normalize_display_name 相同：前後空白不算、
 * 留空＝不設定（畫面改用 Email）、最多 12 個字、不能有換行或看不見的字元。
 * 回傳錯誤訊息，沒問題回空字串。
 */
export function displayNameError(value: string): string {
  const name = value.trim()
  if (!name) return ''
  if (HIDDEN_CHARACTER.test(name)) return '顯示名稱不能有換行或看不見的特殊字元'
  if (displayNameLength(name) > DISPLAY_NAME_MAX_LENGTH) return `顯示名稱最多 ${DISPLAY_NAME_MAX_LENGTH} 個字`
  return ''
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
  'poster.media_id': '首屏影片封面',
  'fallback_image.media_id': '首屏影片載入失敗替代圖',
  'photo.media_id': '關於常春藤照片',
  'film_desktop.media_id': '孩子的一天影片（桌機）',
  'film_mobile.media_id': '孩子的一天影片（手機）',
  'film_poster.media_id': '孩子的一天影片封面',
  'cover.media_id': '封面照片',
  'line_art.media_id': '建築線稿',
  'line_art_colour.media_id': '建築線稿（上色）',
  // 整頁內容（特色教學頁；關於常春藤頁也有 hero_photo）：抽屜與替換對話框的標題已經寫了頁名，這裡不再帶。
  'hero_photo.media_id': '首屏照片',
  'years_photo.media_id': '四個年段的照片',
  'hero_back_photo.media_id': '首屏後排照片',
  'hope_photo.media_id': '紙房子窗戶的照片',
  // 常春藤環境頁（hero_photo 同上）；主打區的照片在巢狀物件裡。
  'care_photo.media_id': '幼兒保育照片',
  'feature.photo.media_id': '校園環境主打區的照片',
}

export function mediaFieldPathLabel(path: string): string {
  if (path === 'share_image') return '分享預覽圖'
  const seo = /^page_seo\.([a-z]+)\.share_image$/.exec(path)
  if (seo) return `${pageSeoPageLabel(seo[1]!) ?? seo[1]}的分享圖`
  if (MEDIA_SLOT_PATH_LABELS[path]) return MEDIA_SLOT_PATH_LABELS[path]
  let slot = /^moments\[(\d+)\]\.photo\.media_id$/.exec(path)
  if (slot) return `孩子的一天第 ${Number(slot[1]) + 1} 張卡片的照片`
  slot = /^(directions|gallery|daily)\[(\d+)\]\.photo\.media_id$/.exec(path)
  if (slot) {
    const n = Number(slot[2]) + 1
    if (slot[1] === 'directions') return `課程方向第 ${n} 項的照片`
    if (slot[1] === 'gallery') return `兒童美術館第 ${n} 件作品的照片`
    return `五件事第 ${n} 件的照片`
  }
  slot = /^(care_items|spaces)\[(\d+)\]\.photo\.media_id$/.exec(path)
  if (slot) return slot[1] === 'care_items' ? `照顧的小事第 ${Number(slot[2]) + 1} 件的照片` : `校園環境第 ${Number(slot[2]) + 1} 個空間的照片`
  slot = /^films\[(\d+)\]\.(video|poster)\.media_id$/.exec(path)
  if (slot) return `第 ${Number(slot[1]) + 1} 支活動影片的${slot[2] === 'video' ? '影片' : '封面'}`
  slot = /^testimonials\[(\d+)\]\.poster\.media_id$/.exec(path)
  if (slot) return `第 ${Number(slot[1]) + 1} 支家長分享影片的封面`
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
  slots: '自選場次（家長線上預約）',
  line: 'LINE 官方帳號',
  phone: '電話洽詢',
  external: '外部預約網站',
  paused: '暫停預約',
  // 2026-10-06 拿掉的預約方式，只剩操作紀錄的修改前後值會出現。
  inquiry: '線上表單（已停用）',
}

// 與後端 notifications/service.py 的 _KIND_LABELS 同一組（labels.test.ts 會比對）。
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  visit_request_created: '新的參觀預約',
  visit_request_confirmed: '參觀預約已確認',
  visit_request_cancelled: '參觀預約已取消',
  visit_request_rescheduled: '參觀預約已改期',
  parent_visit_booked: '家長確認信（預約成功）',
  parent_visit_changed: '家長確認信（預約已變更）',
  parent_visit_cancelled: '家長確認信（預約已取消）',
  // 停班停課（2026-10-14）：請家長用修改連結改約或取消。
  parent_visit_day_closed: '家長停課通知（請改約）',
  // 參觀前 24 小時提醒家長（2026-10-15）。
  parent_visit_reminder: '參觀提醒（家長）',
  // 家長改期申請功能已於 2026-10-08 刪除，保留給舊的站內通知列與寄送失敗重寄。
  visit_reschedule_requested: '家長申請改期（待園方核准）',
  // 定期工作產生的提醒（backend/app/notifications/reminders.py），門檻數字與後端常數一致。
  visit_upcoming: '即將參觀（24 小時內）',
  // 舊流程（2026-10-06 拿掉）留下的通知，站內通知與寄送失敗清單仍要有標題。
  visit_request_hold_expired: '時段占位已逾期，名額已釋放',
  visit_request_overdue: '案件逾期未處理',
}

// 舊流程逾期未處理提醒的細分原因（payload.reason）。後端 2026-10-06 已不再產生，
// 只剩以前的通知會帶這個欄位。
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

// 逾時與連不上：寄信走 smtplib（socket 的例外），LINE 推播走 httpx（httpx 自己的
// 例外類別，LinePushError 只包 HTTP 狀態碼，網路錯誤是原樣的 httpx 類別名稱）。
const OUTBOX_TIMEOUT_CODES = /^(TimeoutError|timeout|ConnectTimeout|ReadTimeout|WriteTimeout|PoolTimeout)$/
const OUTBOX_CONNECTION_CODES =
  /^(Connection\w*Error|OSError|gaierror|ConnectError|ReadError|WriteError|CloseError|NetworkError|RemoteProtocolError|ProxyError)$/

// 寄送失敗的最後錯誤碼是後端例外的類別名稱，給園方看的是大概原因，代碼另外
// 小字附上，查問題時對得上伺服器紀錄。
export function outboxErrorLabel(code: string | null | undefined): string {
  if (!code) return '原因不明'
  if (code === 'LinePushError') return 'LINE 推播失敗'
  if (code === 'SMTPAuthenticationError') return '寄信伺服器帳號或密碼錯誤'
  if (code === 'SMTPRecipientsRefused') return '收件地址被寄信伺服器拒絕'
  if (code.startsWith('SMTP')) return '寄信伺服器錯誤'
  if (OUTBOX_TIMEOUT_CODES.test(code)) return '連線逾時'
  if (/^SSL\w*Error$/.test(code)) return '加密連線失敗，請檢查伺服器位址與憑證'
  if (OUTBOX_CONNECTION_CODES.test(code)) return '連不上寄信或推播伺服器'
  return '其他錯誤'
}

// 與後端所有 audit_service.log_action 的 action 同一組（labels.test.ts 會掃後端原始碼比對）。
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'booking_config.update': '更新預約設定',
  'content.publish': '發布內容',
  'content.publish_scheduled': '排程時間到，已自動發布',
  'content.submit_review': '內容送審',
  'content.approve': '核准並發布內容',
  'content.reject': '退回送審內容',
  'content.schedule': '設定排程發布',
  'content.schedule_cancel': '取消排程發布',
  'content.restore': '還原內容舊版',
  'content.schedule_failed': '排程發布未執行（檢查不通過）',
  'content.schedule_skipped': '排程發布略過（官網已是較新版本）',
  'content.schedule_acknowledge': '沒有發布的排程標成已處理',
  'release.restore': '整站還原到某次發布',
  'notification_outbox.retry': '重新寄送通知',
  'retention.run': '執行資料清理',
  'site_settings.update': '更新全站設定',
  'system.test_email': '寄測試信',
  'line.campus_target.update': '更新 LINE 通知群組',
  'line.test_push': '送出 LINE 測試訊息',
  'line.verification_code.create': '產生 LINE 群組驗證碼',
  'line.group.verify': 'LINE 群組完成驗證',
  'user.create': '新增帳號',
  'user.set_active': '變更帳號啟用狀態',
  'user.set_scope': '變更負責校區',
  'user.reset_password': '重設密碼',
  'user.change_password': '變更自己的密碼',
  'user.password_reset_link_sent': '寄出重設密碼連結',
  'user.password_reset_link_failed': '重設密碼連結沒有寄出',
  'user.password_reset_link_rejected': '重設密碼連結無效，沒有改密碼',
  'user.password_reset_completed': '用重設連結設定新密碼',
  'user.set_role': '變更角色與校區',
  'user.set_capabilities': '變更授權（全站內容／匯出個資）',
  'user.update_display_name': '變更顯示名稱',
  'visit_request.export': '匯出家長個資',
  'visit_request.manual_create': '人工補登參觀案件',
  // 承辦人 2026-10-06 拿掉，只剩舊紀錄。
  'visit_request.assign': '指派承辦人',
  'visit_request.create_access_link': '產生家長管理連結',
  'visit_request.resend_confirmation': '重寄家長確認信',
  'booking_config.migrate_self_booking': '改為家長自選場次（系統轉換）',
  'visit_request.revoke_access': '撤銷家長管理連結',
  'visit_request.contacting': '開始聯絡案件',
  'visit_request.add_contact_note': '新增聯絡紀錄',
  'visit_request.confirm': '確認預約',
  'visit_request.reschedule': '改期',
  'visit_request.cancel': '取消預約',
  'visit_request.no_show': '標記未到場',
  'visit_request.complete': '標記已到場',
  'visit_request.complete_early': '提早標記已到場',
  'visit_request.update_details': '修改家長資料',
  'visit_request.exclude': '標記為排除',
  'visit_request.include': '取消排除',
  // 家長改期申請功能已於 2026-10-08 刪除，保留給舊紀錄。
  'visit_request.approve_reschedule': '核准家長改期申請',
  'visit_request.reject_reschedule': '退回家長改期申請',
  'visit_slot.create': '新增參觀場次',
  'visit_slot.update': '調整場次名額或開關',
  'retention_policy.update': '更新個資保存政策',
  'contact_phrases.update': '修改聯絡片語',
  'user.link_google': '綁定 Google 登入',
  'user.unlink_google': '解除 Google 登入綁定',
  'user.login_google': 'Google 登入',
  'user.login_google_failed': 'Google 登入失敗',
  'user.link_line': '綁定 LINE 登入',
  'user.unlink_line': '解除 LINE 登入綁定',
  'user.login_password': '帳密登入',
  'user.login_password_failed': '帳密登入失敗',
  'user.login_locked': '帳號密碼登入暫停（連續錯誤）',
  'user.login_line': 'LINE 登入',
  'user.login_line_failed': 'LINE 登入失敗',
  'user.logout': '登出',
  'user.clear_external_logins': '解除外部登入綁定',
  'visit_schedule.update': '更新每週開放規則',
  'visit_slots.generate': '依規則產生場次',
  'visit_exception.create': '設定休假日',
  'visit_exception.delete': '取消休假日',
  'visit_exception.import_holidays': '匯入國定假日',
  'visit_closure.create': '停班停課',
  'campus.activate': '重新啟用分校',
  'campus.deactivate': '停用分校',
  'media.upload': '上傳素材',
  'media.update': '修改素材說明',
  'media.replace': '上傳新檔替換素材',
  'media.retry': '重新處理影片',
  'media.delete': '刪除素材（移到待清理）',
  'media.restore': '復原刪除的素材',
  'media.archive': '封存素材',
  'media.unarchive': '取消封存素材',
  'media.purge': '清理刪除的素材檔案',
  'media.replace_references': '替換素材並產生草稿',
  'media.import_site_assets': '匯入官網內建素材',
  'media.regenerate_variants': '重新產生素材縮圖、中圖與大圖',
  'media.strip_metadata': '去除素材原檔的拍攝資訊',
  'media.transcode_backfill': '既有影片補轉檔',
  // 招生入學（2026-10）
  'recruitment_visit.create': '新增招生訪視',
  'recruitment_visit.update': '修改招生訪視',
  'recruitment_visit.delete': '刪除招生訪視',
  'recruitment_visit.transition': '變更招生階段',
  'recruitment_visit.seat': '保留或釋放座位',
  'grade_intake_target.update': '設定計畫名額',
  'recruitment_visit.create_from_booking': '由官網預約建立招生訪視',
  'recruitment_visit.synced_from_visit_request': '預約資料修改後同步到招生訪視',
  // 參觀後追蹤（2026-10-04）
  'recruitment_visit.contact_logged': '記錄參觀後聯絡',
  'recruitment_visit.follow_up_update': '改下次聯絡或追蹤負責人',
  // 招生名單匯出（2026-10-03）
  'recruitment_visit.export': '匯出招生訪視明細',
  'recruitment_visit.export_no_deposit': '匯出未預繳名單',
}

// 參觀後聯絡的方式（後端 admissions/constants.py CONTACT_CHANNELS；admissionsFollowUp.test.ts 比對）。
export const CONTACT_CHANNEL_LABELS: Record<string, string> = {
  phone: '電話',
  line: 'LINE',
  in_person: '當面',
  revisit: '再參觀',
  other: '其他',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

// 稽核紀錄 metadata 裡的 reason 代碼（Google／LINE／帳密登入失敗的原因等）。
export const AUDIT_REASON_LABELS: Record<string, string> = {
  cancelled: '使用者取消',
  provider_error: '登入服務（Google／LINE）回傳錯誤',
  wrong_password: '密碼錯誤',
  not_linked: '沒有綁定這個 Google／LINE 帳號的後台帳號',
  failed: '驗證未完成或逾時',
  // 以下三個是 2026-10-06 以前 Google 用 Email 自動綁定時的原因，舊紀錄還會出現。
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
  // 重設密碼連結不能用的原因（user.password_reset_link_rejected，2026-10-03）。
  link_expired: '連結已過期',
  link_used: '連結已經用過',
  link_revoked: '連結已作廢（寄了新連結、密碼已變更或帳號停用）',
}

export function auditReasonLabel(reason: string): string {
  return AUDIT_REASON_LABELS[reason] ?? reason
}

// 帳密登入失敗發生在哪裡（user.login_password_failed 的 metadata.context）。
export const AUDIT_CONTEXT_LABELS: Record<string, string> = {
  login: '登入頁',
  reauth: '變更登入方式前確認密碼',
  change_password: '變更自己的密碼',
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
  completed: '標記已到場',
  hold_expired: '占位逾期，名額釋出',
  contact_logged: '新增聯絡紀錄',
  // 承辦人 2026-10-06 拿掉，只剩舊歷程。
  assigned: '指派承辦人',
  unassigned: '取消指派',
  linked_from_previous: '由先前的案件重新預約',
  rebooked_as_new: '另建新案重新預約',
  // 家長改期申請功能已於 2026-10-08 刪除，保留給舊歷程。
  reschedule_requested: '家長申請改期',
  reschedule_rejected: '退回改期申請',
  reschedule_superseded: '家長的改期申請失效（已直接改期）',
  access_link_created: '產生家長管理連結',
  access_link_revoked: '撤銷家長管理連結',
  details_updated: '家長修改資料',
  // 停班停課（2026-10-14）：排了一封停課通知，請家長改約或取消；原因在歷程的 reason。
  closure_notice: '寄停課通知',
  // 排除標記（2026-10-15）：測試或重複的案件不算進統計；原因類別在 after.reason，說明在歷程的 reason。
  excluded: '標記為排除',
  exclusion_removed: '取消排除',
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

// 家長資料被改的欄位名（歷程 details_updated 與稽核 visit_request.update_details 都只記欄位名，不記內容）。
export const VISIT_DETAIL_FIELD_LABELS: Record<string, string> = {
  parent_name: '家長稱呼', phone: '手機', email: 'Email', child_name: '孩子姓名',
  child_birthdate: '孩子出生年月日', party_size: '參觀人數', questions: '想了解的事', expected_start: '預計入學時間',
}

// 預約案件的排除原因（2026-10-15）；後端 booking/export_labels.py 的 EXCLUDE_REASON_LABELS 同一組字。
export const VISIT_EXCLUDE_REASON_LABELS: Record<string, string> = { test: '測試', duplicate: '重複', other: '其他' }

// 預計入學時間（2026-10-15）：和後端 app/booking/expected_start.py 的 display_label 同一套規則與案例
// （contracts/expected-start-cases.json 的 labels）。值是 asap、unsure 或「民國學年-學期」。
type Term = [number, number]
function termOfDay(day: string): Term {
  const [year, month] = day.split('-').map(Number) as [number, number]
  if (month >= 8) return [year - 1911, 1]
  if (month >= 2) return [year - 1912, 2]
  return [year - 1912, 1]
}
const termIndex = ([year, semester]: Term): number => year * 2 + semester - 1
const termAt = (index: number): Term => [Math.floor(index / 2), (index % 2) + 1]
const termText = ([year, semester]: Term): string => `${year} 學年${semester === 1 ? '上' : '下'}學期`
const termMonthText = ([year, semester]: Term): string => (semester === 1 ? `${year + 1911} 年 9 月` : `${year + 1912} 年 2 月`)
function parseTerm(value: string): Term | null {
  const match = /^(1\d{2})-([12])$/.exec(value)
  return match ? [Number(match[1]), Number(match[2])] : null
}

/** 明細的文字；submittedOn 是送單的台北日期（YYYY-MM-DD），「盡快」換算當時的學期。 */
export function expectedStartLabel(value: string | null | undefined, submittedOn: string): string {
  if (!value) return ''
  if (value === 'unsure') return '還不確定'
  if (value === 'asap') return `盡快（送單時是 ${termText(termOfDay(submittedOn))}）`
  const term = parseTerm(value)
  return term ? `${termMonthText(term)}（${termText(term)}）` : value
}

/** 後台補登與修改家長資料的下拉：盡快、前兩個學期到之後六個學期、還不確定（規格 X8：後台可填過去的學期）；
 * 目前的值不在範圍內時也列出來，打開表單不會把它弄丟。 */
export function expectedStartStaffOptions(today: string, current?: string | null): { value: string; label: string }[] {
  const now = termIndex(termOfDay(today))
  const terms = Array.from({ length: 9 }, (_, i) => termAt(now - 2 + i))
  const options = [
    { value: 'asap', label: '盡快' },
    ...terms.map((term) => ({ value: `${term[0]}-${term[1]}`, label: `${termMonthText(term)}（${termText(term)}）` })),
    { value: 'unsure', label: '還不確定' },
  ]
  const kept = current ? parseTerm(current) : null
  if (current && kept && !options.some((option) => option.value === current)) {
    options.splice(1, 0, { value: current, label: `${termMonthText(kept)}（${termText(kept)}）` })
  }
  return options
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
  visit_slot: '參觀場次',
  retention_policy: '個資保存政策',
  contact_phrases: '聯絡片語',
  line_group: 'LINE 群組',
  line_verification_code: 'LINE 群組驗證碼',
  recruitment_visit: '招生訪視',
  grade_intake_target: '計畫名額',
}

// 招生漏斗階段（後端 app/admissions/constants.py STAGE_LABELS，園務原文）。
export const RECRUITMENT_STAGE_LABELS: Record<string, string> = {
  visited: '已訪視',
  deposited: '已預繳',
  enrolled: '已註冊',
  withdrawn: '退預繳／退註冊',
}

// 招生訪視怎麼建立的（後端 constants.ORIGINS，created 事件與稽核的 origin）。
export const RECRUITMENT_ORIGIN_LABELS: Record<string, string> = {
  manual: '手動新增',
  visit_request: '官網預約到場',
}

// 招生訪視編輯了哪些欄位（recruitment_visit.update 的 fields；只記欄位名，不記內容）。
export const RECRUITMENT_FIELD_LABELS: Record<string, string> = {
  visit_date: '參觀日期',
  child_name: '幼生姓名',
  english_name: '英文名字',
  birthday: '生日',
  grade: '適讀班級',
  phone: '電話',
  contact_name: '聯絡人',
  father_occupation: '父親職業',
  mother_occupation: '母親職業',
  address: '地址',
  source: '來源備註',
  referrer: '家長介紹',
  deposit_collector: '收預繳人員',
  tour_guide_user_id: '帶參觀老師',
  tour_guide_name: '帶參觀老師',
  source_category: '來源分類',
  rides_bus: '娃娃車',
  transfer_term: '轉其他學期',
  notes: '備註',
  parent_response: '電訪回應',
  no_deposit_reason: '未預繳原因',
  no_deposit_reason_detail: '未預繳原因說明',
  target_school_year: '入學學年',
  target_semester: '入學學期',
  withdraw_reason_category: '退出原因分類',
}

// 個資保存政策會清理的類別（後端 retention_service.CATEGORIES 與 ADMISSIONS）。
// 招生訪視只在設定了天數時才出現在試算與清理紀錄裡。
export const RETENTION_CATEGORY_LABELS: Record<string, string> = {
  cancelled: '已取消',
  no_show: '未到場',
  completed: '已完成參觀',
  admissions: '招生訪視',
}

// 清理紀錄與操作紀錄（retention.run 的 trigger）共用；「定期工作」是工程說法，
// 園方看到的是「每天自動清理」這個開關。
export const RETENTION_TRIGGER_LABELS: Record<string, string> = {
  manual: '手動執行',
  scheduled: '每天自動清理',
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
  updated_on: '最後更新日期',
  since_label: '創校標籤',
  body_text: '內文',
  caption: '照片下方文字',
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
  // fb_note、consent_text、banner_* 2026-10-08 從表單與後端拿掉，留著只為版本歷程比較舊版本。
  fb_note: 'Facebook 備註',
  instagram: 'Instagram',
  youtube: 'YouTube',
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
  poster: '影片封面',
  poster_alt: '影片封面的圖片說明',
  fallback_image: '影片載入失敗替代圖',
  photo: '照片',
  photo_alt: '照片的圖片說明',
  film_desktop: '背景影片（桌機）',
  film_mobile: '背景影片（手機）',
  film_poster: '背景影片封面',
  film_caption_zh: '影片說明（中文）',
  film_caption_en: '影片說明（英文）',
  cover: '封面照片',
  card_focus: '首頁卡片焦點',
  line_art: '建築線稿',
  line_art_colour: '建築線稿（上色）',
  films: '手機版活動影片',
  testimonials: '家長分享影片',
}

export function contentFieldLabel(key: string): string {
  return CONTENT_FIELD_LABELS[key] ?? key
}

// 各校各一份、但由總部管理的內容種類（後端 registry 的 hq_managed）：編輯、發布、
// 核准都比照共用內容，要總管理者或有「全站共用內容」授權的人。2026-10-05 起
// 校園探索（官網環境頁「五所校園」）由總部帳號直接控制。
export const HQ_MANAGED_KINDS: ReadonlySet<string> = new Set(['campus_tour'])

// 發布成功後「查看官網」要開到那段內容所在的頁面，不是一律開首頁。
export function contentPublicPath(kind: string, campusKey?: string | null): string {
  // 校園探索只在常春藤環境頁「五所校園」一章顯示。
  if (kind === 'campus_tour') return '/environment#campuses'
  if (kind === 'campus_profile') {
    // 分校頁已移除；分校資訊只剩首頁的五校區塊。
    return '/#campuses'
  }
  if (kind === 'booking_content') return campusKey ? `/visit/${campusKey}` : '/visit'
  if (kind === 'admission_content') return '/admission'
  if (kind === 'privacy_policy') return '/privacy'
  if (kind === 'curriculum_page') return '/curriculum'
  if (kind === 'about_page') return '/about'
  if (kind === 'environment_page') return '/environment'
  return '/'
}

// 私有草稿預覽（官網 /preview，登入後才看得到未發布內容）。預覽頁有首頁、入學資訊、
// 預約頁（預約文案：個資說明、頁首按鈕）、隱私權政策、特色教學頁、關於常春藤頁
// 與常春藤環境頁（前三章的文字與照片、校園探索）。
export function contentPreviewPath(kind: string, _campusKey?: string | null): string {
  if (kind === 'campus_tour') return '/preview?page=environment'
  if (kind === 'campus_profile') {
    // 分校頁已移除，首頁預覽的五校區塊看得到分校的名稱、地址與電話。
    return '/preview'
  }
  if (kind === 'admission_content') return '/preview?page=admission'
  if (kind === 'booking_content') return '/preview?page=visit'
  if (kind === 'privacy_policy') return '/preview?page=privacy'
  if (kind === 'curriculum_page') return '/preview?page=curriculum'
  if (kind === 'about_page') return '/preview?page=about'
  if (kind === 'environment_page') return '/preview?page=environment'
  return '/preview'
}

/** 內容編輯頁的路由；分校內容帶 ?campus= 讓編輯頁直接切到那一校。 */
export function contentEditorPath(kind: string, campusKey?: string | null): string {
  const path = kind === 'admission_content' ? '/content/admission' : `/content/${kind.replace(/_/g, '-')}`
  return campusKey ? `${path}?campus=${encodeURIComponent(campusKey)}` : path
}

/** 「首頁大圖標語」或「五校介紹（義華校）」 */
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
  initialize: '網站初始內容',
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
  // 常見問題（campus_faq、shared_faq）功能已於 2026-10-08 刪除，保留給舊操作紀錄與舊發布紀錄。
  campus_faq: '各校常見問題',
  shared_faq: '共用常見問題',
  campus_news: '各校消息與活動',
  campus_tour: '校園探索',
  booking_content: '預約文案',
  privacy_policy: '隱私權政策',
  curriculum_page: '特色教學頁',
  about_page: '關於常春藤頁',
  environment_page: '常春藤環境頁',
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

// 列表欄位用：今年的省略年份（09/28 21:41），跨年的照寫年份（DESIGN.md 2026-09-28 案件表格）。
// 「今年」每次呼叫時才算（台灣時間）：後台分頁常開好幾天，模組載入時算一次的話跨年後還在省略舊年份。
const yearFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Asia/Taipei' })
function withoutThisYear(text: string): string {
  const thisYear = yearFormatter.format(new Date())
  return text.startsWith(`${thisYear}/`) ? text.slice(thisYear.length + 1) : text
}

export function formatShortDateTime(value: string | null | undefined): string {
  return withoutThisYear(formatDateTime(value))
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

// MB 留一位小數（1.5 MB 不四捨五入成 2 MB），整數時不寫多餘的「.0」。
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}

// 星期幾，給時段列表用。實作在 utils/visitSchedule（行程清單的日期標題也要，且那邊不能反向 import labels）。
export { formatWeekday }

// 案件上的「參觀時間」：09/26（週六）10:00–11:00。明細、列表與確認對話框
// 共用同一種寫法，家長在電話裡聽到的跟畫面上看到的才會一致。沒有場次
// （舊流程沒排時段就取消的案件）回破折號。
// end_time 選填：只有開始時間的來源只寫開始時間。
export function formatSlotWhen(
  slot: { slot_date: string; start_time: string; end_time?: string | null } | null | undefined,
): string {
  if (!slot) return '—'
  const range = slot.end_time ? `${formatTime(slot.start_time)}–${formatTime(slot.end_time)}` : formatTime(slot.start_time)
  return `${formatDate(slot.slot_date)}（${formatWeekday(slot.slot_date)}）${range}`
}

// 列表欄位用的短寫法：今年的場次省略年份（10/22（週四）09:30–10:30）。明細、確認框
// 與歷程照用 formatSlotWhen，跨年的案件才看得出是哪一年。
export function formatShortSlotWhen(slot: { slot_date: string; start_time: string; end_time?: string | null } | null | undefined): string {
  return withoutThisYear(formatSlotWhen(slot))
}


// 時段已經開始（或結束）：後台補登與改期都不能再選，後端也會拒絕。
// 日期與時間是台灣時間。
export function slotStarted(
  slot: { slot_date: string; start_time: string },
  now: number = Date.now(),
): boolean {
  const starts = slotStart(slot)
  return !Number.isNaN(starts) && starts <= now
}

// 家長線上取消／改期的截止（各校設定，預設參觀前 24 小時）。整天數且超過一天
// 時講「天」，家長與櫃台都比較好理解。
export function parentDeadlineLabel(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `參觀前 ${hours / 24} 天`
  return `參觀前 ${hours} 小時`
}

// 時段為什麼關閉（後端 SlotClosedSource）。舊資料沒有來源（null）一律當手動關閉。
export const SLOT_CLOSED_SOURCE_LABELS: Record<string, string> = {
  manual: '已關閉',
  exception: '休假日關閉',
  rule: '不在開放規則內',
}

export function slotClosedLabel(source: string | null | undefined): string {
  return SLOT_CLOSED_SOURCE_LABELS[source ?? 'manual'] ?? '已關閉'
}

// 存每週規則時，還沒被使用的舊規則時段跟著調整的結果（PUT visit-schedule 的
// slot_sync，稽核紀錄的 metadata 也是同一份）。移除與停用對園方來說都是「這一
// 場不再開放」，合在一起講。
export interface SlotSyncResult { created?: number; removed: number; closed: number; reopened: number; capacity_updated: number; kept_booked: number }

export const LEAD_OPTIONS = [2, 12, 24, 48, 72] as const
export const ADVANCE_OPTIONS = [14, 30, 60, 90] as const
export function leadLabel(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `參觀前 ${hours / 24} 天` : `參觀前 ${hours} 小時`
}
export function advanceLabel(days: number): string {
  if (days === 14) return '2 週內'
  if (days % 30 === 0) return `${days / 30} 個月內`
  return `${days} 天內`
}

export function slotSyncLines(sync: Partial<SlotSyncResult> | null | undefined): string[] {
  if (!sync) return []
  const retired = (sync.removed ?? 0) + (sync.closed ?? 0)
  return [
    sync.created ? `已排出 ${sync.created} 場` : '',
    retired ? `${retired} 場不符合新規則的場次不再開放` : '',
    sync.reopened ? `重新開放 ${sync.reopened} 場` : '',
    sync.capacity_updated ? `${sync.capacity_updated} 場名額改成新規則` : '',
    sync.kept_booked ? `${sync.kept_booked} 場已有家長排入，維持原樣` : '',
  ].filter(Boolean)
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

// 案件的同意紀錄（規格 L196）：2026-10-02 起官網預約不用勾選同意；在那之前的官網
// 送單記錄家長看到的「預約文案」版本與伺服器接受時間（2026-09-25 以前沒有版本）；
// 補登在 2026-10-02 以前是人員向家長說明後代勾，之後也不用勾。
export function consentRecordLabel(detail: {
  source?: string | null
  consent_given?: boolean
  consent_revision_id?: string | null
  consent_revision_version?: number | null
  consent_accepted_at?: string | null
}): string {
  if (detail.consent_given === false) return !detail.source || detail.source === 'web' ? '官網預約不需勾選同意' : '補登不需勾選同意'
  const when = detail.consent_accepted_at ? `・${formatDateTime(detail.consent_accepted_at)}` : ''
  if (detail.consent_revision_id) {
    const version = detail.consent_revision_version ? '當時的預約文案' : '當時的預約文案已無法查到'
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

// 稽核紀錄修改前後的欄位名：帳號（變更角色與校區、新增帳號）、時段、保存政策
// 與開放規則。預約設定的欄位沿用 BOOKING_CONFIG_FIELD_LABELS。
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  role: '角色',
  campus_keys: '負責校區',
  capabilities: '授權',
  capacity: '名額',
  closed: '場次狀態',
  cancelled_days: '已取消、未到場保留',
  completed_days: '已完成參觀保留',
  open_overdue_days: '未結案提醒',
  admissions_days: '招生訪視保留',
  auto_run_enabled: '每天自動清理',
}

// 官網問前六個（2026-10-03 起四個，2026-10-05 加兄姊、傳單）；後三個是舊選項，舊案件仍會有。
export const REFERRAL_SOURCE_LABELS: Record<string, string> = { friends_family: '親友介紹', sibling: '哥哥姊姊讀過或正在讀', nearby: '住附近／路過看到', flyer: '傳單／DM', online: '網路上看到', other: '其他', facebook: 'Facebook', google_reviews: 'Google 評論', parent_community: '媽媽社團' }

export function referralSourceLabels(sources: string[] | null | undefined): string {
  return sources?.length ? sources.map(source => REFERRAL_SOURCE_LABELS[source] || source).join('、') : '未填寫'
}
