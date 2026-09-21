export type BookingMode = 'inquiry' | 'slots' | 'line' | 'phone' | 'external' | 'paused'

export interface BookingConfig {
  mode: BookingMode
  version: number
  message?: string | null
  line_url?: string | null
  phone?: string | null
  external_url?: string | null
}

export type BookingActionKind = 'choose_campus' | 'form' | 'line' | 'phone' | 'external' | 'paused'

export interface BookingAction {
  kind: BookingActionKind
  href: string | null
  label: string
  message: string | null
}

const DEFAULT_PAUSED_MESSAGE = '目前暫停參觀預約，請關注最新消息。'
const SLOTS_NOT_READY_MESSAGE = '此校區尚未開放線上預約，請改用其他聯絡方式。'

/**
 * 純函式：依校區與其目前預約設定，決定預約 CTA 該長什麼樣子。
 * 不寫死任何校的聯絡方式——所有 line/phone/external 的值都來自傳入的
 * config，不在這裡內建預設值。
 */
export function resolveBookingAction(
  campusKey: string | null,
  config: BookingConfig | null
): BookingAction {
  if (!campusKey || !config) {
    return { kind: 'choose_campus', href: `/visit`, label: '請先選擇校區', message: null }
  }

  switch (config.mode) {
    case 'inquiry':
      return {
        kind: 'form',
        href: `/visit/${campusKey}`,
        label: '填寫預約表單',
        message: config.message ?? null
      }

    case 'slots':
      // 階段 C 尚未開放；不產生可送出表單連結。
      return {
        kind: 'paused',
        href: null,
        label: '尚未開放線上預約',
        message: config.message ?? SLOTS_NOT_READY_MESSAGE
      }

    case 'line':
      return {
        kind: 'line',
        href: config.line_url ?? null,
        label: '透過 LINE 聯絡',
        message: config.message ?? null
      }

    case 'phone':
      return {
        kind: 'phone',
        href: config.phone ? `tel:${config.phone}` : null,
        label: '致電洽詢',
        message: config.message ?? null
      }

    case 'external':
      return {
        kind: 'external',
        href: config.external_url ?? null,
        label: '前往預約網站',
        message: config.message ?? null
      }

    case 'paused':
    default:
      return {
        kind: 'paused',
        href: null,
        label: '目前暫停預約',
        message: config.message ?? DEFAULT_PAUSED_MESSAGE
      }
  }
}
