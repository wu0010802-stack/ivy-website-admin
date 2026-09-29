// 公開預約的機器人驗證（Cloudflare Turnstile，使用者 2026-09-29 裁定）。
// 預約設定帶了 turnstile_site_key 才載入：沒設定的部署完全不碰 Cloudflare。
// 腳本用 explicit render：由表單決定何時、在哪裡顯示元件。
export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileRenderOptions {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  'timeout-callback'?: () => void
  language?: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined
  reset(widgetId?: string): void
  remove(widgetId?: string): void
}

let loading: Promise<TurnstileApi> | null = null

/** 測試用：忘掉進行中的載入。 */
export function resetTurnstileLoader(): void {
  loading = null
}

/** 載入一次 Turnstile 腳本；失敗時移除腳本，下次呼叫可以重試。 */
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  const view = doc.defaultView as { turnstile?: TurnstileApi } | null
  if (view?.turnstile) return Promise.resolve(view.turnstile)
  if (loading) return loading
  const script = doc.createElement('script')
  script.src = TURNSTILE_SCRIPT_SRC
  script.async = true
  const pending = new Promise<TurnstileApi>((resolve, reject) => {
    script.addEventListener('load', () => {
      if (view?.turnstile) resolve(view.turnstile)
      else reject(new Error('Turnstile 腳本載入後沒有 turnstile 物件'))
    })
    script.addEventListener('error', () => reject(new Error('Turnstile 腳本載入失敗')))
  }).catch((error: unknown) => {
    script.remove()
    if (loading === pending) loading = null
    throw error
  })
  loading = pending
  doc.head.appendChild(script)
  return pending
}

/** API 錯誤回應 detail 裡的 message（例如 BOT_CHECK_FAILED）；沒有就用 fallback。 */
export function serverMessage(detail: unknown, fallback: string): string {
  const message = detail && typeof detail === 'object' ? (detail as { message?: unknown }).message : undefined
  return typeof message === 'string' && message.trim() ? message : fallback
}
