// 操作紀錄（/admin/audit）專用的中文寫法：metadata 細節、修改前後與伺服器端搜尋字展開。
// 2026-10-20 從 labels.ts 拆出：labels.ts 跟著側欄進首次載入，這份只有操作紀錄頁（與它的
// utils/auditFormat.ts）用，跟著該頁的 chunk 晚載。共用的標籤表仍維護在 labels.ts。
import {
  CAMPUS_LABELS,
  campusLabels,
  ROLE_LABELS,
  roleLabel,
  VISIT_STATUS,
  VISIT_GROUP_LABELS,
  VISIT_VIEW_LABELS,
  visitStatus,
  VISIT_SOURCE_LABELS,
  visitSourceLabel,
  mediaStatus,
  BOOKING_MODE_LABELS,
  notificationKindLabel,
  outboxErrorLabel,
  AUDIT_ACTION_LABELS,
  CONTACT_CHANNEL_LABELS,
  AUDIT_REASON_LABELS,
  auditReasonLabel,
  AUDIT_CONTEXT_LABELS,
  VISIT_DETAIL_FIELD_LABELS,
  VISIT_EXCLUDE_REASON_LABELS,
  AUDIT_TARGET_LABELS,
  RECRUITMENT_STAGE_LABELS,
  RECRUITMENT_ORIGIN_LABELS,
  RECRUITMENT_FIELD_LABELS,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGER_LABELS,
  contentItemLabel,
  publishJobStatus,
  CONTENT_KIND_LABELS,
  formatDateTime,
  formatDate,
  formatFileSize,
  type SlotSyncResult,
  slotSyncLines,
  BOOKING_CONFIG_FIELD_LABELS,
  bookingConfigValueLabel,
  configChangeLines,
  GRANT_LABELS,
  grantLabels,
  AUDIT_FIELD_LABELS,
} from './labels'
import { CANCEL_REASON_LABELS } from './analyticsLabels'

// 數字欄位補上單位，不讓人猜「24」是小時還是天。
const AUDIT_FIELD_UNITS: Record<string, string> = {
  capacity: '位',
  cancelled_days: '天',
  completed_days: '天',
  open_overdue_days: '天',
  admissions_days: '天',
  min_lead_hours: '小時',
  max_advance_days: '天',
}

function auditValueLabel(field: string, value: unknown): string {
  if (field === 'admissions_days' && (value === null || value === undefined)) return '不自動清理'
  if (field === 'role' && typeof value === 'string') return roleLabel(value)
  if (field === 'closed' && typeof value === 'boolean') return value ? '已關閉' : '開放'
  if (field === 'auto_run_enabled' && typeof value === 'boolean') return value ? '開啟' : '關閉'
  if (typeof value === 'number' && AUDIT_FIELD_UNITS[field]) return `${value} ${AUDIT_FIELD_UNITS[field]}`
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

// ---- 操作紀錄「細節」欄（2026-09-28）----
// 後端 log_action 的 metadata 一律在這裡翻成園方看得懂的句子：
// 1. 已知的鍵翻成中文，狀態、內容種類、來源等代碼走既有標籤表；
// 2. 識別碼與內部版本號刻意不顯示（AUDIT_HIDDEN_METADATA_KEYS）；
// 3. 沒列到的新鍵不默默丟掉，收進「其他細節」（auditMetadataDetails 的 others）。
// labelCoverage 測試會掃後端所有 log_action 的 metadata 鍵，新鍵沒歸類就會失敗。

/** 刻意不顯示的鍵：UUID、內部版本號與舊 API 才有的欄位，對園方沒有意義。 */
export const AUDIT_HIDDEN_METADATA_KEYS = new Set([
  'note_id',
  'log_id',
  'run_id',
  'job_id',
  'revision_version',
  'version',
  'replaces_media_id',
  'replacement_id',
  'reschedule_request_id', // 舊的核准／退回改期申請紀錄才有（功能已於 2026-10-08 刪除）
  'from_slot_id',
  'to_slot_id',
  'requested_slot_id',
  'related_request_id',
  'visit_request_id',
  'restored_from_release_id',
  'content_type',
  'verification_code_id',
  // 舊的 /admin/site-settings（官網從來不讀，2026-10-08 已刪除）留在舊操作紀錄裡的欄位。
  'privacy_policy_version',
])

interface AuditSlot { date?: unknown; start?: unknown; end?: unknown }

/** 稽核紀錄裡的時段 {date, start, end} →「10/02 09:30–10:30」。 */
export function auditSlotLabel(slot: unknown): string {
  if (!slot || typeof slot !== 'object') return '—'
  const { date, start, end } = slot as AuditSlot
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : String(date ?? '')
  return `${day} ${String(start ?? '')}–${String(end ?? '')}`.trim()
}

function auditWhen(value: unknown): string {
  if (typeof value !== 'string') return String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : formatDateTime(value)
}

function countOf(value: unknown): number {
  if (Array.isArray(value)) return value.length
  return typeof value === 'number' ? value : Number(value) || 0
}

// 內容清單（整站還原、替換素材、匯入內建素材產生的草稿）：{kind, campus_key}。
function contentItemsLabel(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const names = value
    .filter((item): item is { kind?: unknown; campus_key?: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => contentItemLabel(typeof item.kind === 'string' ? item.kind : null, typeof item.campus_key === 'string' ? item.campus_key : null))
  return Array.from(new Set(names)).join('、')
}

// 素材說明被改了哪些欄位（media.update 的 fields）。
const MEDIA_FIELD_LABELS: Record<string, string> = {
  alt_text: '說明',
  caption: '內部備註',
  source_attribution: '來源標示',
  license_note: '授權說明',
  tags: '標籤',
  crop_focus_x: '預設裁切焦點',
  crop_focus_y: '預設裁切焦點',
}

const OUTBOX_RETRY_SOURCE_LABELS: Record<string, string> = { admin: '在後台手動重寄', cli: '技術人員批次重寄' }

// 帳號被改了哪些欄位（user.update_display_name 的 changed）。
const USER_FIELD_LABELS: Record<string, string> = { display_name: '顯示名稱' }

// 稽核紀錄裡「篩選值不在選項內」的固定寫法（後端 admissions/download.py 的 OTHER_FILTER_VALUE）。
const OTHER_FILTER_LABEL = '其他（不在選項內）'

type AuditFormatter = (value: unknown, action: string, metadata: Record<string, unknown>) => string | null

// 各鍵的寫法。回 null 表示這一項不值得寫（例如「沒有」的布林值）。
// kind、status、source 在不同動作代表不同東西，依 action 分開翻。
const AUDIT_METADATA_FORMATTERS: Record<string, AuditFormatter> = {
  // 帳號
  role: (v) => `角色：${auditValueLabel('role', v)}`,
  campus_keys: (v) => `負責校區：${auditValueLabel('campus_keys', v)}`,
  capabilities: (v) => `授權：${auditValueLabel('capabilities', v)}`,
  // 改角色時一併收回的授權（例如分校管理者降為櫃台收回匯出個資）。
  capabilities_removed: (v) => (Array.isArray(v) ? `因改角色收回授權：${grantLabels(v)}` : null),
  is_active: (v) => (v ? '帳號改為啟用' : '帳號改為停用'),
  revoked_sessions: (v) => (countOf(v) ? `同時登出 ${countOf(v)} 個已登入的裝置` : '對方原本沒有登入中的裝置'),
  // 重設密碼連結沒有寄出時的錯誤類別（SMTP 例外名稱），翻成大概原因。
  error_code: (v) => `寄送失敗原因：${outboxErrorLabel(String(v))}`,
  // 系統狀態頁的測試信（system.test_email）：寄出或沒寄出；沒寄出時另有 error_code 寫原因。
  result: (v, action) => (action === 'system.test_email' ? (v === 'sent' ? '測試信已寄出' : '測試信沒有寄出') : `結果：${String(v)}`),
  reason: (v) => `原因：${auditReasonLabel(String(v))}`,
  // 預約案件排除（2026-10-15）：只記原因類別，說明不進操作紀錄（計畫裁定 P6）。
  exclude_reason: (v) => (v ? `排除原因：${VISIT_EXCLUDE_REASON_LABELS[String(v)] ?? String(v)}` : null),
  // 案件匯出的「排除」篩選（2026-10-15）。
  excluded: (v) => (v === 'hide' ? '隱藏已排除' : v === 'only' ? '只看已排除' : null),
  // 帳密登入失敗發生在哪裡（user.login_password_failed：登入頁、重新驗證或改密碼）。
  context: (v) => `發生在：${AUDIT_CONTEXT_LABELS[String(v)] ?? String(v)}`,
  // 帳號鎖（user.login_locked）與停權／解除綁定並登出時解除了哪些外部登入（2026-09-29）。
  lock_minutes: (v) => `密碼登入暫停 ${countOf(v)} 分鐘`,
  failed_attempts: (v) => `密碼錯誤達 ${countOf(v)} 次`,
  line_unlinked: (v) => (v ? '解除 LINE 登入綁定' : null),
  google_unlinked: (v) => (v ? '解除 Google 登入綁定' : null),
  // 家長管理連結、改期
  expires_at: (v, action) => `${action.startsWith('line.') ? '驗證碼到期' : '連結到期'}：${auditWhen(v)}`,
  replaced_previous: (v) => (v ? '先前的連結同時失效' : null),
  has_reason: (v) => (v ? '有填寫原因' : '沒有填寫原因'),
  // 預約設定（mode／期限是存檔後的值；有修改前後時已經在「修改」裡，不重複）
  mode: (v) => `預約方式：${bookingConfigValueLabel('mode', v)}`,
  parent_change_deadline_hours: (v) => `${BOOKING_CONFIG_FIELD_LABELS.parent_change_deadline_hours}：${bookingConfigValueLabel('parent_change_deadline_hours', v)}`,
  changed: (v, action) => {
    if (!Array.isArray(v) || !v.length) return null
    if (action === 'release.restore' || typeof v[0] === 'object') return `還原的內容：${contentItemsLabel(v)}`
    return `修改：${v.map((field) => USER_FIELD_LABELS[String(field)] ?? BOOKING_CONFIG_FIELD_LABELS[String(field)] ?? String(field)).join('、')}`
  },
  // 顯示名稱是本人自己改的，還是總管理者替他改的。名字本身不記在紀錄裡
  // （後端刻意不存），改成什麼要看「使用者」頁。
  self: (v) => (v ? '本人自己修改' : '由總管理者修改'),
  // 時段與案件
  slot: (v) => `場次：${auditSlotLabel(v)}`,
  row_count: (v) => `匯出 ${countOf(v)} 筆`,
  // 聯絡片語（contact_phrases.update）：存檔後共有幾句；片語內容不進稽核。
  count: (v) => `共 ${countOf(v)} 句`,
  status: (v, action) => {
    if (action.startsWith('media.')) return `素材狀態：${mediaStatus(String(v)).label}`
    if (action.startsWith('content.')) return `排程狀態：${publishJobStatus(String(v)).label}`
    return `篩選狀態：${visitStatus(String(v)).label}`
  },
  source: (v, action) => {
    if (action === 'notification_outbox.retry') return OUTBOX_RETRY_SOURCE_LABELS[String(v)] ?? '重新寄送'
    return `${action === 'visit_request.export' ? '篩選來源' : '來源'}：${visitSourceLabel(String(v))}`
  },
  group: (v) => `篩選分組：${(VISIT_GROUP_LABELS as Record<string, string>)[String(v)] ?? String(v)}`,
  view: (v) => `篩選頁籤：${(VISIT_VIEW_LABELS as Record<string, string>)[String(v)] ?? String(v)}`,
  // 承辦人篩選 2026-10-06 拿掉，只剩舊的匯出紀錄。
  assignee: (v) => `篩選承辦人：${v === 'me' ? '匯出的人自己承辦的' : v === 'none' ? '尚未指派' : v === 'inactive' ? '承辦人已停用' : '指定的同事'}`,
  open: (v) => (v ? '只匯出還沒結案的案件' : null),
  follow_up_due: (v) => (v ? '只匯出到期待追蹤的案件' : null),
  needs_attention: (v) => (v ? '只匯出待人工處理的案件' : null),
  has_search: (v) => (v ? '有用搜尋字篩選' : null),
  with_slot: (v) => (v ? '同時排入場次' : '還沒排場次'),
  follow_up_set: (v) => (v ? '設定了下次聯絡時間' : '沒有設定下次聯絡時間'),
  follow_up_cleared: (v) => (v ? '清除下次聯絡時間' : null),
  // 開放規則、休假日、產生時段
  rule_count: (v) => `每週規則 ${countOf(v)} 條`,
  date: (v) => `日期：${auditWhen(v)}`,
  closed_slots: (v) => `關閉 ${countOf(v)} 場`,
  affected_requests: (v) => `影響 ${countOf(v)} 筆已排入的案件`,
  reopened_slots: (v) => `重新開放 ${countOf(v)} 場`,
  created_slots: (v) => `依規則補上 ${countOf(v)} 場`,
  // 依規則產生時段（visit_slots.generate，API 2026-10-08 已刪，保留給舊操作紀錄）是新增幾場；由官網預約建立招生訪視是有沒有新建。
  created: (v, action) => {
    if (action === 'recruitment_visit.create_from_booking') return v ? '建立招生訪視' : '這筆預約已有招生訪視，沒有重複建立'
    if (action === 'visit_exception.import_holidays') return `新增 ${countOf(v)} 天休假日`
    return `新增 ${countOf(v)} 場`
  },
  skipped_existing: (v, action) => {
    if (!countOf(v)) return null
    return action === 'visit_exception.import_holidays' ? `${countOf(v)} 天原本就是休假日` : `${countOf(v)} 場已經有了`
  },
  // 國定假日匯入、停班停課（2026-10-14）
  skipped_weekend: (v) => (countOf(v) ? `${countOf(v)} 個週末節日這校沒有場次，略過` : null),
  already_closed: (v) => (v ? '這天原本就是休假日' : null),
  notified: (v) => (countOf(v) ? `寄停課通知給 ${countOf(v)} 位家長` : '沒有寄停課通知'),
  no_email: (v) => (countOf(v) ? `${countOf(v)} 位家長沒有 Email，要來電` : null),
  skipped_exception_days: (v) => (countOf(v) ? `略過 ${countOf(v)} 個休假日` : null),
  // 分校
  open_requests: (v) => `尚未結案的案件 ${countOf(v)} 筆`,
  // 內容
  kind: (v, action) => {
    if (action.startsWith('media.')) return `類型：${v === 'video' ? '影片' : v === 'image' ? '圖片' : String(v)}`
    if (action === 'notification_outbox.retry') return `通知：${notificationKindLabel(String(v))}`
    return `內容：${contentItemLabel(String(v))}`
  },
  restored_from_version: (v) => `還原自第 ${String(v)} 版`,
  published: (v) => (v ? '同時發布到官網' : '存成草稿'),
  note: (v) => `退回理由：${String(v)}`,
  publish_at: (v) => `排程時間：${auditWhen(v)}`,
  error: (v) => `沒有發布的原因：${String(v)}`,
  kept_count: (v) => (countOf(v) ? `${countOf(v)} 項維持不變` : null),
  items: (v) => `產生草稿：${contentItemsLabel(v)}`,
  drafts: (v) => (Array.isArray(v) && v.length ? `產生草稿：${contentItemsLabel(v)}` : null),
  // 素材
  filename: (v) => `檔名：${String(v)}`,
  size_bytes: (v) => `檔案大小：${formatFileSize(countOf(v))}`,
  deleted_at: (v) => `刪除時間：${auditWhen(v)}`,
  // 素材說明（media.update）、招生訪視（recruitment_visit.*）或家長資料（visit_request.update_details）被改了哪些欄位。
  fields: (v, action) => {
    if (!Array.isArray(v)) return null
    const names = action.startsWith('recruitment_visit.')
      ? RECRUITMENT_FIELD_LABELS
      : action.startsWith('visit_request.') ? VISIT_DETAIL_FIELD_LABELS : MEDIA_FIELD_LABELS
    return `修改：${Array.from(new Set(v.map((field) => names[String(field)] ?? String(field)))).join('、')}`
  },
  imported: (v) => `匯入 ${countOf(v)} 個`,
  reused: (v) => (countOf(v) ? `${countOf(v)} 個已在素材庫` : null),
  failed: (v) => (countOf(v) ? `失敗 ${countOf(v)} 個` : null),
  regenerated: (v) => `重新產生 ${countOf(v)} 個`,
  all: (v) => (v ? '全部素材都重做' : null),
  // 部署後批次去除舊素材原檔的拍攝資訊（media.strip_metadata）。
  stripped: (v) => `去除拍攝資訊 ${countOf(v)} 個`,
  // 既有影片補轉檔（media.transcode_backfill）。
  queued: (v) => `排入 ${countOf(v)} 支`,
  // 通知重寄
  previous_attempts: (v) => `先前嘗試 ${countOf(v)} 次`,
  previous_error_code: (v) => `上次失敗原因：${outboxErrorLabel(String(v))}`,
  // LINE 群組完成驗證（line.group.verify）
  source_type: (v) => `類型：${v === 'room' ? '多人聊天室' : '群組'}`,
  // 舊的全站設定
  noindex: (v) => `搜尋引擎收錄：${v ? '不允許' : '允許'}`,
  // 個資清理
  trigger: (v) => `方式：${RETENTION_TRIGGER_LABELS[String(v)] ?? String(v)}`,
  days: (v) => {
    if (!v || typeof v !== 'object') return null
    const d = v as Record<string, unknown>
    const admissions = typeof d.admissions_days === 'number' ? `、招生訪視 ${d.admissions_days} 天` : ''
    return `保留天數：取消／未到場 ${String(d.cancelled_days)} 天、完成 ${String(d.completed_days)} 天${admissions}`
  },
  counts: (v) => {
    if (!v || typeof v !== 'object') return null
    const c = v as Record<string, unknown>
    // 招生訪視只有設定了天數的清理才有；舊紀錄與沒設定的不列，文字跟以前一樣。
    return Object.keys(RETENTION_CATEGORY_LABELS)
      .filter((key) => key !== 'admissions' || key in c)
      .map((key) => `${RETENTION_CATEGORY_LABELS[key]} ${countOf(c[key])} 筆`)
      .join('、')
  },
  total: (v) => `共匿名化 ${countOf(v)} 筆`,
  open_overdue_count: (v) => (countOf(v) ? `另有 ${countOf(v)} 筆超過天數仍未結案` : null),
  // 招生入學
  origin: (v) => `建立方式：${RECRUITMENT_ORIGIN_LABELS[String(v)] ?? String(v)}`,
  stage: (v) => `刪除時的階段：${RECRUITMENT_STAGE_LABELS[String(v)] ?? String(v)}`,
  grade_set: (v) => (v ? '保留座位' : '釋放保留座位'),
  capacity_warning: (v) => (v ? '超過計畫名額（只提醒，沒有擋下）' : null),
  school_year: (v) => `入學學年：${String(v)} 學年`,
  semester: (v) => `入學學期：${v === 1 ? '上學期' : v === 2 ? '下學期' : String(v)}`,
  grades: (v) => (Array.isArray(v) ? `調整的年級：${v.map(String).join('、')}` : null),
  // 招生名單匯出（2026-10-03）：只記套用了哪些篩選。來源、介紹者、搜尋字只記有沒有篩，負責人只記類別。
  month: (v) => `篩選月份：${String(v)}`,
  // 未預繳名單的原因、班別篩選收任意字串；不在選項內的後端只記 other，不把輸入原文寫進紀錄。
  grade: (v) => `篩選班別：${v === 'other' ? OTHER_FILTER_LABEL : String(v)}`,
  has_source: (v) => (v ? '有篩選來源' : null),
  has_referrer: (v) => (v ? '有篩選家長介紹' : null),
  has_deposit: (v) => `篩選預繳：${v ? '是' : '否'}`,
  no_deposit_reason: (v) => `篩選未預繳原因：${v === 'other' ? OTHER_FILTER_LABEL : String(v)}`,
  withdraw_reason_category: (v) => `篩選退出原因：${v === 'unclassified' ? '未分類' : String(v)}`,
  funnel_stage: (v) => `篩選階段：${RECRUITMENT_STAGE_LABELS[String(v)] ?? String(v)}`,
  has_visit_request: (v) => (v ? '只匯出由官網預約建立的訪視' : null),
  follow_up: (v) => `篩選追蹤狀態：${({ due: '已到期', upcoming: '7 天內', unscheduled: '未排定' } as Record<string, string>)[String(v)] ?? String(v)}`,
  owner: (v) => `篩選追蹤負責人：${({ me: '匯出的人自己', none: '未指派', staff: '指定某位同事' } as Record<string, string>)[String(v)] ?? String(v)}`,
  priority: (v) => `篩選轉換潛力：${({ high: '高', medium: '中', low: '低' } as Record<string, string>)[String(v)] ?? String(v)}`,
  overdue_days: (v) => `只匯出參觀滿 ${countOf(v)} 天仍未預繳`,
  cold_only: (v) => (v ? '只匯出冷名單' : null),
  // 後端用「+」串起同時套用的條件（district+village）；舊紀錄只有單一值。
  area: (v) => `篩選區域：${String(v).split('+').map((part) => ({ district: '指定行政區', village: '指定里', no_village: '未定位到里' } as Record<string, string>)[part] ?? part).join('、')}`,
  // 參觀後追蹤（不記聯絡內容，只記方式與結果）
  channel: (v) => `聯絡方式：${CONTACT_CHANNEL_LABELS[String(v)] ?? String(v)}`,
  reached: (v) => (v ? '聯絡到了' : '沒聯絡到'),
  parent_response_updated: (v) => (v ? '同時更新電訪回應' : null),
  owner_changed: (v) => (v ? '換了追蹤負責人' : null),
  // 後台資料匯入（2026-10-21）：在籍清冊的人數、有點人數、清冊日期與比對用的門牌版本（不記地址）。
  students: (v) => `共 ${countOf(v)} 位`,
  placed_students: (v) => `有點 ${countOf(v)} 位`,
  roster_date: (v) => `清冊日期：${auditWhen(v)}`,
  doorplate_version: (v) => `門牌版本：${String(v)}`,
  // 歷年註冊匯入：列數與最早、最新的學期（「104上」）。
  term_rows: (v) => `共 ${countOf(v)} 列`,
  first_term: (v) => `從 ${String(v)}`,
  last_term: (v) => `到 ${String(v)}`,
}

// 成對出現、要合在一起講的鍵（「狀態：已確認 → 未到場」）。
const AUDIT_PAIRED_KEYS = ['from_status', 'to_status', 'from_slot', 'to_slot', 'from_stage', 'to_stage', 'created_from', 'created_to', 'date_from', 'date_to', 'from', 'to'] as const

/** 後台看得懂的 metadata 鍵（有中文寫法，或成對、before／after 另外處理）。 */
export const AUDIT_METADATA_KEYS = new Set([...Object.keys(AUDIT_METADATA_FORMATTERS), ...AUDIT_PAIRED_KEYS, 'before', 'after', 'slot_sync'])

function pairedLines(m: Record<string, unknown>): string[] {
  const has = (key: string) => key in m
  const lines: string[] = []
  if (has('from_status') || has('to_status')) {
    const from = m.from_status ? visitStatus(String(m.from_status)).label : ''
    const to = m.to_status ? visitStatus(String(m.to_status)).label : ''
    lines.push(from && to ? `狀態：${from} → ${to}` : from ? `原本狀態：${from}` : `狀態改為：${to}`)
  }
  if (has('from_slot') || has('to_slot')) {
    lines.push(`場次：${m.from_slot ? auditSlotLabel(m.from_slot) : '未排場次'} → ${m.to_slot ? auditSlotLabel(m.to_slot) : '未排場次'}`)
  }
  if (has('from_stage') || has('to_stage')) {
    const stage = (value: unknown) => RECRUITMENT_STAGE_LABELS[String(value)] ?? String(value)
    lines.push(m.from_stage && m.to_stage ? `招生階段：${stage(m.from_stage)} → ${stage(m.to_stage)}` : `招生階段：${stage(m.from_stage ?? m.to_stage)}`)
  }
  if (m.created_from || m.created_to) {
    lines.push(`篩選送出日期：${m.created_from ? auditWhen(m.created_from) : '不限'} – ${m.created_to ? auditWhen(m.created_to) : '不限'}`)
  }
  if (m.date_from || m.date_to) lines.push(`日期：${auditWhen(m.date_from)} – ${auditWhen(m.date_to)}`)
  // 指派承辦人（2026-10-06 拿掉，只剩舊紀錄）：from／to 是使用者 id，不顯示 id，只講是指派、更換還是取消。
  if (has('from') || has('to')) lines.push(!m.to ? '取消指派' : m.from ? '更換承辦人' : '指派給同事')
  return lines
}

// before／after 不是物件或清單的情況：分校啟用狀態（布林）、LINE 通知群組（群組代碼）。
function scalarChangeLine(action: string, before: unknown, after: unknown): string {
  if (typeof before === 'boolean' || typeof after === 'boolean') {
    const word = (value: unknown) => (value ? '啟用' : '停用')
    return `${action.startsWith('campus.') ? '分校' : '狀態'}：${word(before)} → ${word(after)}`
  }
  if (action.startsWith('line.')) {
    if (!after) return 'LINE 通知群組：不再推播'
    return before ? 'LINE 通知群組：換成另一個群組' : 'LINE 通知群組：已設定'
  }
  return `修改：${String(before ?? '（空白）')} → ${String(after ?? '（空白）')}`
}

function otherDetail(key: string, value: unknown): string {
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `${key}：${text.length > 120 ? `${text.slice(0, 120)}…` : text}`
}

export interface AuditDetails {
  /** 翻好的中文細節，一項一句。 */
  lines: string[]
  /** 還沒有中文寫法的新鍵，收在「其他細節」裡，不直接攤在表格。 */
  others: string[]
}

/** 操作紀錄「細節」欄：已知鍵翻成中文、識別碼不顯示、未知鍵另外收起來。
 * 有修改前後的再接「修改：…」；before／after 已經講到的欄位，頂層同名鍵
 * （預約設定存檔後的 mode 等）不再重複。 */
export function auditMetadataDetails(metadata: Record<string, unknown> | null | undefined, action = ''): AuditDetails {
  const m = metadata ?? {}
  const lines: string[] = []
  const others: string[] = []
  const after = m.after && typeof m.after === 'object' && !Array.isArray(m.after) ? (m.after as Record<string, unknown>) : null
  const changes = auditChangeSummary(m)
  lines.push(...pairedLines(m))
  // 分校啟用、LINE 群組這類單一值的修改前後是這筆紀錄的重點，放最前面。
  if (!changes && 'before' in m && 'after' in m && (typeof m.before !== 'object' || typeof m.after !== 'object' || m.before === null || m.after === null)) {
    lines.push(scalarChangeLine(action, m.before, m.after))
  }
  for (const [key, value] of Object.entries(m)) {
    if (value === null || value === undefined) continue
    if (AUDIT_HIDDEN_METADATA_KEYS.has(key) || (AUDIT_PAIRED_KEYS as readonly string[]).includes(key)) continue
    if (key === 'before' || key === 'after' || key === 'slot_sync') continue
    if (after && key in after) continue
    // 預約設定的 changed 只是欄位名清單，已經有翻好的修改前後就不再列。
    if (key === 'changed' && changes && action !== 'release.restore') continue
    const format = AUDIT_METADATA_FORMATTERS[key]
    if (!format) {
      others.push(otherDetail(key, value))
      continue
    }
    const line = format(value, action, m)
    if (line) lines.push(line)
  }
  if (changes) lines.push(`修改：${changes}`)
  const slotSync = m.slot_sync && typeof m.slot_sync === 'object' ? slotSyncLines(m.slot_sync as Partial<SlotSyncResult>) : []
  if (slotSync.length) lines.push(`場次：${slotSync.join('、')}`)
  return { lines, others }
}

/** 細節的一行摘要（手機卡片、搜尋用）；只含翻好的中文，其他細節不算在內。 */
export function auditMetadataSummary(metadata: Record<string, unknown> | null | undefined, action = ''): string {
  return auditMetadataDetails(metadata, action).lines.join('，')
}

// ---- 操作紀錄的伺服器端搜尋（2026-10-14 規格 §4）----
// 後端比對動作、對象、校區、操作者、裝置與 metadata 原文（代碼與園方填的字）；中文名稱只存在這份檔案，
// 所以把搜尋字展開成「原字＋名稱含這個字的代碼」一起送，例如「休假」→ visit_exception.create…。
const AUDIT_SEARCH_TABLES: readonly Record<string, string>[] = [
  AUDIT_ACTION_LABELS,
  // 案件狀態（狀態：預約正常 → 未到場 這類修改前後值）：「未到場」→ no_show。
  Object.fromEntries(Object.entries(VISIT_STATUS).map(([code, meta]) => [code, meta.label])),
  AUDIT_TARGET_LABELS,
  CAMPUS_LABELS,
  ROLE_LABELS,
  CONTENT_KIND_LABELS,
  BOOKING_MODE_LABELS,
  GRANT_LABELS,
  AUDIT_FIELD_LABELS,
  BOOKING_CONFIG_FIELD_LABELS,
  AUDIT_REASON_LABELS,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGER_LABELS,
  VISIT_SOURCE_LABELS,
  CANCEL_REASON_LABELS,
  MEDIA_FIELD_LABELS,
]

/** 和後端 audit_service.MAX_SEARCH_TERMS 一致。 */
export const AUDIT_SEARCH_MAX_TERMS = 30

/** 搜尋字 → 送給後端的詞（原字在第一個，最多 30 個）。空白回空陣列。 */
export function auditSearchTerms(keyword: string): string[] {
  const word = keyword.trim().slice(0, 100)
  if (!word) return []
  const needle = word.toLocaleLowerCase()
  const terms = [word]
  for (const table of AUDIT_SEARCH_TABLES) {
    for (const [code, label] of Object.entries(table)) {
      if (terms.length >= AUDIT_SEARCH_MAX_TERMS) return terms
      if (label.toLocaleLowerCase().includes(needle) && !terms.includes(code)) terms.push(code)
    }
  }
  return terms
}
