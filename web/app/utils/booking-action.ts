import type { PrivacyNotice } from '../types/site-content'

export type BookingMode = 'slots' | 'line' | 'phone' | 'external' | 'paused'

export interface BookingConfig {
  mode: BookingMode
  version: number
  message?: string | null
  line_url?: string | null
  phone?: string | null
  external_url?: string | null
  /** 預約文案發布中的隱私說明；沒有正式說明時為 null（2026-10-02 起官網預約不用勾選同意） */
  privacy_notice?: PrivacyNotice | null
  /** 部署啟用 Cloudflare Turnstile 時的 site key；null 表示送單不需要機器人驗證 */
  turnstile_site_key?: string | null
  /** 部署有開寄信時為 true：結果頁才能說「確認信已寄出」 */
  parent_email_enabled?: boolean
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

export interface CampusVisitCta {
  kind: 'visit' | 'phone' | 'line' | 'external'
  href: string
  label: string
  note: string | null
}

/**
 * 首頁五校卡的參觀入口（2026-10-24 質感審查）：原本五校一律寫「預約參觀Ｘ校」連到預約頁，
 * 但只有開放線上選場次的校區約得到，其他校點進第二步才看到「歡迎來電洽詢」。
 * 只有可線上預約（或還沒讀到設定、讀取失敗）時維持預約頁；暫停或來電的校區改成致電，
 * LINE／外部網站照園方設定。號碼優先用預約設定裡的，沒有才用五校介紹的電話；都沒有就退回預約頁。
 */
export function campusVisitCta(
  campus: { key: string; name: string; phone?: string | null },
  action: BookingAction | null | undefined
): CampusVisitCta {
  const visit: CampusVisitCta = { kind: 'visit', href: `/visit/${campus.key}`, label: `預約參觀${campus.name}`, note: null }
  if (!action || action.kind === 'form' || action.kind === 'choose_campus' || action.kind === 'unavailable') return visit
  if ((action.kind === 'line' || action.kind === 'external') && action.href) {
    return {
      kind: action.kind,
      href: action.href,
      label: action.kind === 'line' ? `LINE 洽詢${campus.name}` : `前往${campus.name}預約網站`,
      note: action.message
    }
  }
  const phone = (action.kind === 'phone' && action.href ? action.href.replace(/^tel:/, '') : '') || campus.phone?.trim()
  if (phone) return { kind: 'phone', href: `tel:${phone}`, label: `致電${campus.name}預約參觀`, note: action.message }
  return visit
}
