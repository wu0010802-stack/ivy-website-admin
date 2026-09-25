import type { BookingConfig } from './booking-action'

// 原型 fixture 的示範同意文字，與官網一直顯示的正式文字（和後端
// backend/app/content/schemas.py 的 LEGACY_DEMO_CONSENT_TEXT／FORMAL_CONSENT_TEXT 相同）。
export const LEGACY_DEMO_CONSENT_TEXT = '我了解這是操作示範，資料不會傳送給學校，不代表預約成立。'
export const FORMAL_CONSENT_TEXT = '我同意園方使用本次填寫的資料聯絡與安排參觀；送出需求後，仍須由園方確認參觀時間。'

/**
 * 勾選框顯示的同意文字（規格 L196）：公開預約設定回傳的那一版。
 * 設定沒有帶版本（還沒升級的 API）才退回站台內容的文字；這時伺服器也不比對
 * 版本，但原型示範文字（「資料不會傳送給學校」）不能出現在正式站，換成正式文字。
 */
export function displayedConsentText(config: BookingConfig | null | undefined, siteText: string): string {
  if (config?.consent_revision_id && config.consent_text) return config.consent_text
  return siteText === LEGACY_DEMO_CONSENT_TEXT ? FORMAL_CONSENT_TEXT : siteText
}

/**
 * 家長看到的同意說明（勾選框文字＋個資使用說明）。只改預約按鈕、橫幅文字的
 * 重新發布不會改變它；預約設定還沒讀到時為 null。
 */
export function consentView(config: BookingConfig | null | undefined, siteText: string): string | null {
  if (!config) return null
  return JSON.stringify([displayedConsentText(config, siteText), config.privacy_notice ?? null])
}

/** 家長勾選同意當下看到的版本與內容。 */
export interface ConsentSeen {
  revisionId: string | null
  view: string | null
}

export function consentSeenNow(config: BookingConfig | null | undefined, siteText: string): ConsentSeen {
  return { revisionId: config?.consent_revision_id ?? null, view: consentView(config, siteText) }
}

/**
 * 勾選之後重新載入設定（例如預約設定剛更新、重試讀取），拿到內容不同的同意
 * 說明：原本的勾選不算數，要請家長重新閱讀、勾選。設定讀取中（null）不算改變。
 */
export function consentOutdated(seen: ConsentSeen | null, view: string | null): boolean {
  return seen !== null && view !== null && view !== seen.view
}

/**
 * 送單帶的同意說明版本：家長勾選當下看到的那一版（規格 L130「提交綁定當時
 * 顯示的說明版本」），不是設定目前的值——版本換了但內容相同時伺服器照收並記下
 * 家長看到的那一版；內容不同時回 CONSENT_VERSION_CHANGED，請家長重新勾選。
 */
export function submittedConsentRevision(seen: ConsentSeen | null, config: BookingConfig | null | undefined): string | null {
  return seen ? seen.revisionId : config?.consent_revision_id ?? null
}
