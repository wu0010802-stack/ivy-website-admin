import { campusKeys, publicPage } from '../../shared/telemetry'

// 預約鈕與聯絡連結的點擊統計（POST /public/analytics-events）。只送事件類型、
// 校區、入口代碼與一個隨機 event id：不帶網址、query、hash 或任何家長資料。
// 點擊次數不等於預約數，LINE／電話之後有沒有真的預約官網無法得知。

// 入口代碼：按鈕在官網哪個區塊。要和後端 backend/app/operations/models.py 的
// CTA_ENTRIES 一致（tests/cta-analytics.spec.ts 會比對）。區塊外層標
// data-cta-entry，點擊時往上找最近的一個；找不到或不在白名單就記 other。
export const CTA_ENTRIES = [
  'header',
  'menu',
  'footer',
  'home_campus_board',
  'campus_hero',
  'campus_info',
  'campus_contact',
  'campus_banner',
  'campus_tour',
  'admission',
  'visit_page',
  'visit_manage',
  'other'
] as const
export type CtaEntry = (typeof CTA_ENTRIES)[number]
export type CtaEventType = 'booking_cta_clicked' | 'cta_click_line' | 'cta_click_phone' | 'cta_click_external'

export interface CtaEvent {
  event_id: string
  event_type: CtaEventType
  campus_key: string | null
  entry: CtaEntry
}

export function isCtaEntry(value: unknown): value is CtaEntry {
  return typeof value === 'string' && CTA_ENTRIES.some((entry) => entry === value)
}

export function ctaEntryOf(element: Element | null | undefined): CtaEntry {
  const value = element?.closest<HTMLElement>('[data-cta-entry]')?.dataset.ctaEntry
  return isCtaEntry(value) ? value : 'other'
}

/** 後台、草稿預覽不記點擊；其餘公開頁（含入學資訊、預約查詢頁）都記。 */
export function tracksClicks(path: string): boolean {
  return !/^\/(admin|preview)(\/|$)/.test(path)
}

/**
 * 連到官網預約表單（/visit 或 /visit/<校區>）的點擊算 booking_cta_clicked。
 * 目的地沒帶校區（頁首的預約鈕）時，在分校頁點的就算那一校。回傳 null
 * 表示不是往預約表單。
 */
export function bookingCtaCampus(target: URL, origin: string, currentPath: string): { campus: string | null } | null {
  if (target.origin !== origin) return null
  const destination = publicPage(target.pathname)
  if (destination?.page !== 'visit') return null
  return { campus: destination.campus ?? publicPage(currentPath)?.campus ?? null }
}

/** 分校聯絡連結：tel: 算電話，LINE 官方帳號網址算 LINE。 */
export function contactClickKind(target: URL): 'cta_click_phone' | 'cta_click_line' | null {
  if (target.protocol === 'tel:') return 'cta_click_phone'
  return ['lin.ee', 'line.me'].includes(target.hostname) ? 'cta_click_line' : null
}

export function isCampusKey(value: unknown): value is string {
  return campusKeys.some((key) => key === value)
}

export function ctaEvent(eventType: CtaEventType, campusKey: string | null, entry: CtaEntry, id: string = crypto.randomUUID()): CtaEvent {
  return { event_id: id, event_type: eventType, campus_key: isCampusKey(campusKey) ? campusKey : null, entry }
}

/** 和瀏覽統計同一道閘：部署關閉統計、瀏覽器要求不追蹤（DNT／GPC）就不送。 */
export function trackingAllowed(enabled: boolean, nav: Navigator & { globalPrivacyControl?: boolean }): boolean {
  return enabled && nav.doNotTrack !== '1' && !nav.globalPrivacyControl
}

// keepalive：點了外部連結或換頁後請求仍會送完。重送同一個 event_id 後端
// 只算一次；失敗就安靜略過，不影響家長原本要做的事。
export function sendCtaEvent(event: CtaEvent): void {
  void fetch('/api/website/v1/public/analytics-events', {
    method: 'POST',
    credentials: 'omit',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  }).catch(() => {})
}
