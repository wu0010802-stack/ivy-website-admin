import type { PrivacyNotice } from '../types/site-content'

export type BookingMode = 'inquiry' | 'slots' | 'line' | 'phone' | 'external' | 'paused'

export interface BookingConfig {
  mode: BookingMode
  version: number
  message?: string | null
  line_url?: string | null
  phone?: string | null
  external_url?: string | null
  /** 目前發布中的同意文字與版本（規格 L196）；送單時帶版本，伺服器確認仍是這一版才收 */
  consent_revision_id?: string | null
  consent_text?: string | null
  /** 同一版的隱私說明；沒有正式說明時為 null */
  privacy_notice?: PrivacyNotice | null
}

export type BookingActionKind = 'choose_campus' | 'form' | 'line' | 'phone' | 'external' | 'paused' | 'unavailable'

export interface BookingAction {
  kind: BookingActionKind
  href: string | null
  label: string
  message: string | null
}

const DEFAULT_PAUSED_MESSAGE = '目前暫停參觀預約，請關注最新消息。'

/**
 * 純函式：依校區與其目前預約設定，決定預約 CTA 該長什麼樣子。
 * 不寫死任何校的聯絡方式——所有 line/phone/external 的值都來自傳入的
 * config，不在這裡內建預設值。
 */
export function resolveBookingAction(
  campusKey: string | null,
  config: BookingConfig | null,
  loadFailed = false
): BookingAction {
  if (campusKey && loadFailed) {
    return { kind: 'unavailable', href: null, label: '重新確認參觀方式', message: '暫時無法載入參觀方式，請重試，或直接聯絡園所。' }
  }
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
      // 2026-09-22 園方要求日期／場次：只有校方已設定 slots 才開放選時段。
      return {
        kind: 'form',
        href: `/visit/${campusKey}`,
        label: '選擇參觀日期與場次',
        message: config.message ?? null
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
