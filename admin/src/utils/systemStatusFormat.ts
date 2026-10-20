// 系統狀態頁的文字（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md §3.3）。
// 後端只回 key、level 與結構化的 detail（鍵見 backend/app/operations/system_status.py），文案都在這裡；
// systemStatus.test.ts 會比對後端的步驟名、公開資料清單與列 key，新增了沒補中文會失敗。
import { formatDateTime } from '../api/labels'
import type { SystemStatusItem } from '../api/types'

export type StatusLevel = SystemStatusItem['level']
export type StatusSection = 'services' | 'background' | 'datasets' | 'notifications'
type Detail = Record<string, unknown>

export const LEVEL_LABELS: Record<StatusLevel, string> = { ok: '正常', attention: '要注意', info: '資訊', off: '關閉' }
export const LEVEL_TAG_TYPES: Record<StatusLevel, 'success' | 'danger' | 'info'> = { ok: 'success', attention: 'danger', info: 'info', off: 'info' }

export const ITEM_LABELS: Record<string, string> = {
  smtp: '寄信（SMTP）',
  line_messaging: 'LINE 群組推播',
  turnstile: '機器人驗證（Turnstile）',
  google_login: 'Google 登入',
  line_login: 'LINE 登入',
  media_storage: '素材儲存',
  admissions: '招生入學',
  geo_auto_sync: '公開資料自動同步',
  retention_auto_run: '個資自動清理',
  maintenance: '維護排程',
  media_jobs: '影片轉檔',
  geo_sync_loop: '公開資料同步程式',
  failed_outbox: '通知寄送失敗',
  failed_publish_jobs: '排程發布失敗',
}

// 與 backend/app/admissions/geo/models.py 的 DATASETS 同一組（campuses 是內部指紋，不列）。
export const DATASET_LABELS: Record<string, string> = {
  doorplates: '門牌',
  kindergartens: '幼兒園名單',
  babycare: '托嬰名單',
  population: '各里人口',
  births: '各里出生數',
  migration: '各里遷入遷出',
  income: '村里所得',
  new_homes: '新成屋交屋',
  kindergarten_fees: '幼兒園收費',
  presale_buildcases: '預售建案',
}

// 與 backend/app/workers/maintenance.py 的 failed_steps 同一組。
export const STEP_LABELS: Record<string, string> = {
  publish_jobs: '排程發布',
  extend_slots: '依規則補場次',
  reminders: '參觀提醒',
  outbox: '寄送通知',
  rate_limits: '清除限流計數',
  purge_media: '清除待刪素材',
  retention: '個資保存清理',
}

// 後端實際只會回前五種；not_configured 走 409 EMAIL_NOT_CONFIGURED，這裡留著當防呆，兩邊同一句。
export const TEST_EMAIL_ERROR_TEXT: Record<string, string> = {
  not_configured: '還沒設定寄信',
  auth_failed: '寄信伺服器帳號或密碼錯誤',
  connect_failed: '連不上寄信伺服器，請檢查主機、port 或加密設定',
  rejected: '寄信伺服器拒收（寄件或收件地址被擋）',
  timeout: '寄信伺服器太久沒有回應',
  other: '寄信伺服器回了其他錯誤',
}

const SECURITY_LABELS: Record<string, string> = { starttls: 'STARTTLS', ssl: 'SSL', none: '不加密' }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const count = (value: unknown): number => (typeof value === 'number' ? value : 0)
const when = (value: unknown): string => formatDateTime(typeof value === 'string' ? value : null)

// 頁首「資料時間 HH:MM」：台北時間，只有時分（hourCycle h23：午夜寫 00:05 不是 24:05）。
const clockFormatter = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' })
export function formatClock(value: string | null | undefined): string {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? clockFormatter.format(date) : '—'
}

export function itemLabel(item: SystemStatusItem, section: StatusSection): string {
  return (section === 'datasets' ? DATASET_LABELS[item.key] : ITEM_LABELS[item.key]) ?? item.key
}

function describeDataset(item: SystemStatusItem, d: Detail): string {
  // 正式站自動下載連不到門牌來源（計畫裁定 P4）：過期或失敗都請人手動匯入。
  if (item.key === 'doorplates' && item.level === 'attention') return '門牌超過 35 天沒換版，或自動下載失敗：請到電腦上用匯入指令更新門牌（每月一次）'
  if (!d.imported) return d.error ? `還沒匯入成功：${text(d.error)}` : '尚未匯入'
  if (d.error) return `最近一次同步失敗：${text(d.error)}`
  // auto_sync_off：這一列的更新不由自動同步負責（後端只在已匯入的非門牌列帶 true），過期只是資訊。
  if (d.stale) return `超過 ${count(d.stale_days)} 天沒有更新${d.auto_sync_off ? '（自動同步沒開，資料不會自己更新）' : ''}`
  const version = text(d.label) ? `版本 ${text(d.label)}・` : ''
  const checked = d.checked_at ? `・最後確認 ${when(d.checked_at)}` : ''
  return `${version}更新於 ${when(d.synced_at)}${checked}`
}

function describeMaintenance(item: SystemStatusItem, d: Detail): string {
  if (item.level === 'off') return '這個環境不跑背景排程'
  if (!d.running) return '背景排程沒有在跑'
  const steps = Array.isArray(d.failed_steps) ? (d.failed_steps as string[]).map((step) => STEP_LABELS[step] ?? step) : []
  const parts: string[] = []
  if (d.stalled) {
    parts.push(d.last_completed_at
      ? `超過 ${count(d.stale_minutes)} 分鐘沒有跑完一輪（上次 ${when(d.last_completed_at)}）`
      : `啟動超過 ${count(d.stale_minutes)} 分鐘還沒有跑完一輪`)
  }
  if (steps.length) parts.push(`最近一輪失敗的步驟：${steps.join('、')}`)
  if (parts.length) return parts.join('；')
  return d.last_completed_at ? `上次跑完 ${when(d.last_completed_at)}` : '剛啟動，還沒有跑完第一輪'
}

function describeMedia(d: Detail): string {
  if (d.mode === 'inline') return '影片在上傳時直接處理，沒有背景佇列'
  if (!d.loop_running) return '轉檔背景程式沒有在跑，新上傳的影片會一直停在處理中'
  const queue = `待處理 ${count(d.pending)}・處理中 ${count(d.running)}`
  return count(d.failed_assets) ? `${count(d.failed_assets)} 個素材處理失敗（${queue}）` : queue
}

function describeGeoLoop(item: SystemStatusItem, d: Detail): string {
  if (item.level === 'off') return '沒有開啟自動同步'
  if (!d.running) return '公開資料同步程式沒有在跑'
  if (d.stalled) {
    return d.last_run_at
      ? `超過 ${count(d.stale_hours)} 小時沒有同步（上次 ${when(d.last_run_at)}）`
      : `啟動超過 ${count(d.stale_hours)} 小時還沒有同步`
  }
  return d.last_run_at ? `上次同步 ${when(d.last_run_at)}` : '剛啟動，還沒有跑完第一輪'
}

export function describeItem(item: SystemStatusItem, section: StatusSection): string {
  const d = (item.detail ?? {}) as Detail
  if (section === 'datasets') return describeDataset(item, d)
  switch (item.key) {
    case 'smtp':
      if (item.level === 'ok') return `寄件地址 ${text(d.sender) || '（未設定）'}，主機 ${text(d.host)}:${count(d.port)}（${SECURITY_LABELS[text(d.security)] ?? text(d.security)}）`
      if (d.sink) return '寫入本機資料夾（測試用）'
      return '還沒設定寄信：家長確認信、參觀提醒、停課通知與重設密碼連結都寄不出去'
    case 'line_messaging':
      return d.configured ? '已設定，參觀通知會推到各校的 LINE 群組' : '未設定，參觀通知不會推到 LINE 群組'
    case 'turnstile':
      return d.configured ? '已設定，官網預約表單會做機器人驗證' : '未設定，官網預約表單沒有機器人驗證（送單次數上限照常）'
    case 'google_login':
    case 'line_login':
      return d.configured ? '已設定，同仁可以在「我的帳號」綁定後用它登入' : '未設定，登入頁不會出現這個選項'
    case 'media_storage':
      return d.storage === 's3' ? '素材存在 S3 相容的物件儲存' : '素材存在主機的磁碟（只能跑一個 API 副本）'
    case 'admissions':
      return d.enabled ? '開啟' : '關閉：後台沒有招生入學，標記到場也不會建立招生訪視'
    case 'geo_auto_sync':
      return d.enabled ? '開啟：每天檢查一次公開資料有沒有新版' : '關閉：公開資料只能手動匯入'
    case 'retention_auto_run':
      if (item.level === 'info') return '開啟：每天依個資保存政策清理一次'
      return d.env_allowed ? '關閉：「個資與搜尋設定」沒有開啟每日自動清理' : '關閉：部署設定不允許真的清理'
    case 'maintenance':
      return describeMaintenance(item, d)
    case 'media_jobs':
      return describeMedia(d)
    case 'geo_sync_loop':
      return describeGeoLoop(item, d)
    case 'failed_outbox':
      return count(d.count) ? `${count(d.count)} 則通知自動重試後仍沒有送出` : '沒有寄送失敗的通知'
    case 'failed_publish_jobs':
      return count(d.count) ? `${count(d.count)} 項排程發布時間到了沒有執行` : '沒有沒執行的排程發布'
    default:
      return ''
  }
}

export function itemLink(item: SystemStatusItem, section: StatusSection): { to: string; label: string } | null {
  const d = (item.detail ?? {}) as Detail
  if (section === 'datasets') return item.level === 'attention' ? { to: '/admissions-stats?sub=area', label: '看區域分析' } : null
  switch (item.key) {
    case 'line_messaging':
      return { to: '/line-notifications', label: '前往 LINE 通知' }
    case 'retention_auto_run':
      return { to: '/policies', label: '前往個資與搜尋設定' }
    case 'media_jobs':
      return count(d.failed_assets) ? { to: '/media', label: '前往素材庫' } : null
    case 'failed_outbox':
      return count(d.count) ? { to: '/notifications', label: '重新寄送' } : null
    case 'failed_publish_jobs':
      return count(d.count) ? { to: '/releases?tab=schedules', label: '查看排程' } : null
    default:
      return null
  }
}
