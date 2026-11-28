// 再接六個 LINE API（2026-11-28）後台用到的文案與整理函式：
// 檢查連線的結果句、圖文選單的模式名稱、好友輪廓的標籤對照。
import { ApiError } from './client'
import { apiErrorCode, apiErrorMessage, ERROR_CODE_MESSAGES } from './errors'
import type { LineDemographicEntry, LineRichMenuMode, LineWebhookCheckOut } from './types'

/** 429 與圖文選單的錯誤碼用固定說法，其他照共用規則。 */
export function lineToolError(err: unknown, fallback: string, rateLimited = '操作太頻繁，請稍後再試'): string {
  if (err instanceof ApiError && err.status === 429) return rateLimited
  const code = apiErrorCode(err)
  if (code === 'LINE_RICH_MENU_UNAVAILABLE' || code === 'LINE_RICH_MENU_FAILED') return ERROR_CODE_MESSAGES[code]!
  return apiErrorMessage(err, fallback)
}

// ---- 檢查連線（規格 §2）----

const WEBHOOK_REASON_LABELS: Record<string, string> = {
  COULD_NOT_CONNECT: '連不上',
  REQUEST_TIMEOUT: '逾時',
  UNCLASSIFIED: '其他',
}

export interface WebhookCheckResult {
  ok: boolean
  messages: string[]
}

/** 檢查結果翻成句子；有多個問題就全部列出，全部正常只有一句。 */
export function webhookCheckMessages(result: LineWebhookCheckOut): WebhookCheckResult {
  if (result.error_status !== null && result.error_status !== undefined) {
    const text = result.error_status === 401 ? '金鑰失效，請重新設定' : result.error_status === 0 ? '連不上 LINE' : `LINE 查詢失敗（狀態 ${result.error_status}）`
    return { ok: false, messages: [text] }
  }
  const messages: string[] = []
  if (!result.endpoint) {
    messages.push('LINE 後台還沒填 webhook 網址。')
  } else if (result.matches === false) {
    messages.push(`LINE 後台填的是另一個網址：${result.endpoint}`)
  }
  if (result.endpoint && result.active === false) {
    messages.push('LINE 後台的「使用 Webhook」沒有打開，收不到任何事件。')
  }
  if (result.test && !result.test.success) {
    const reason = result.test.reason === 'ERROR_STATUS_CODE'
      ? `回了錯誤 ${result.test.status_code ?? ''}`.trim()
      : (WEBHOOK_REASON_LABELS[result.test.reason] ?? '其他')
    messages.push(`LINE 連不到這個網址（${reason}）。`)
  }
  if (!messages.length) return { ok: true, messages: ['webhook 網址正確，LINE 連得到。'] }
  return { ok: false, messages }
}

// ---- 圖文選單（規格 §4）----

export const RICH_MENU_MODE_OPTIONS: { value: 'none' | 'booked' | 'all'; label: string }[] = [
  { value: 'none', label: '不使用' },
  { value: 'booked', label: '只給已預約的家長' },
  { value: 'all', label: '所有好友' },
]

export const RICH_MENU_MODE_LABELS: Record<string, string> = {
  none: '不使用',
  booked: '只給已預約的家長',
  all: '所有好友',
}

export function richMenuModeLabel(mode: LineRichMenuMode | null | undefined): string {
  return RICH_MENU_MODE_LABELS[mode ?? 'none'] ?? String(mode)
}

/** 改選項前的確認文字：講清楚後果。 */
export function richMenuConfirmText(mode: LineRichMenuMode | null): { title: string; body: string; confirm: string } {
  if (mode === 'all') {
    return {
      title: '圖文選單給所有好友？',
      body: '所有好友都會看到這份選單，已預約的家長另外換成「我的預約」版。這會蓋掉在 LINE Official Account Manager 設定的圖文選單。',
      confirm: '給所有好友',
    }
  }
  if (mode === 'booked') {
    return {
      title: '圖文選單只給已預約的家長？',
      body: '只有已預約的家長會看到「我的預約」選單，其他好友照舊看 LINE Official Account Manager 設定的選單。',
      confirm: '只給已預約的家長',
    }
  }
  return {
    title: '不使用圖文選單？',
    body: '已預約的家長會換回原本的選單。',
    confirm: '不使用',
  }
}

// ---- 好友輪廓（規格 §6）----

export const DEMOGRAPHIC_GENDER_LABELS: Record<string, string> = { male: '男', female: '女', unknown: '不明' }

export const DEMOGRAPHIC_AGE_LABELS: Record<string, string> = {
  from0to14: '14 歲以下',
  from15to19: '15–19 歲',
  from20to24: '20–24 歲',
  from25to29: '25–29 歲',
  from30to34: '30–34 歲',
  from35to39: '35–39 歲',
  from40to44: '40–44 歲',
  from45to49: '45–49 歲',
  from50to54: '50–54 歲',
  from55to59: '55–59 歲',
  from60to64: '60–64 歲',
  from65to69: '65–69 歲',
  from50: '50 歲以上',
  from70: '70 歲以上',
  unknown: '不明',
}

export const DEMOGRAPHIC_PERIOD_LABELS: Record<string, string> = {
  within7days: '7 天內',
  within30days: '30 天內',
  within90days: '90 天內',
  within180days: '半年內',
  within365days: '一年內',
  over365days: '超過一年',
}

export interface DemographicBar {
  key: string
  label: string
  percentage: number
}

const AGE_ORDER = Object.keys(DEMOGRAPHIC_AGE_LABELS)
const PERIOD_ORDER = Object.keys(DEMOGRAPHIC_PERIOD_LABELS)
const GENDER_ORDER = Object.keys(DEMOGRAPHIC_GENDER_LABELS)

function orderedBars(entries: LineDemographicEntry[], labels: Record<string, string>, order: string[]): DemographicBar[] {
  return entries
    .map(entry => ({ key: entry.key, label: labels[entry.key] ?? entry.key, percentage: entry.percentage }))
    .sort((a, b) => {
      const ia = order.indexOf(a.key)
      const ib = order.indexOf(b.key)
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
    })
}

export function genderBars(entries: LineDemographicEntry[]): DemographicBar[] {
  return orderedBars(entries, DEMOGRAPHIC_GENDER_LABELS, GENDER_ORDER)
}

export function ageBars(entries: LineDemographicEntry[]): DemographicBar[] {
  return orderedBars(entries, DEMOGRAPHIC_AGE_LABELS, AGE_ORDER)
}

export function periodBars(entries: LineDemographicEntry[]): DemographicBar[] {
  return orderedBars(entries, DEMOGRAPHIC_PERIOD_LABELS, PERIOD_ORDER)
}

/** 地區：百分比由大到小取前 8 名，其餘（含「不明」以外多出來的）合成「其他」；「不明」照一般地區排序。 */
export function areaBars(entries: LineDemographicEntry[], top = 8): DemographicBar[] {
  const sorted = entries
    .map(entry => ({ key: entry.key, label: entry.key === 'unknown' ? '不明' : entry.key, percentage: entry.percentage }))
    .sort((a, b) => b.percentage - a.percentage)
  if (sorted.length <= top) return sorted
  const rest = sorted.slice(top)
  const other = Math.round(rest.reduce((sum, entry) => sum + entry.percentage, 0) * 100) / 100
  return [...sorted.slice(0, top), { key: 'other', label: '其他', percentage: other }]
}
