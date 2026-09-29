import { api, ApiError } from './client'
import type { LineLinkStart } from './types'

const LINE_AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize?'

/** 整頁跳轉包成物件，測試才能替換（jsdom 不允許 spy window.location）。 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url)
  },
}

/** 變更自己的登入方式前的重新驗證：登入超過 10 分鐘時要帶目前的密碼。 */
export interface ReauthBody {
  current_password: string
}

/** 後端建立握手 cookie 後回傳授權網址；只接受 LINE 官方授權端點才離開後台。
 * 登入超過 10 分鐘時後端回 403 REAUTH_REQUIRED，要帶目前的密碼重送。 */
export async function startLineLink(body?: ReauthBody): Promise<void> {
  const path = '/auth/line/link'
  const { authorize_url: url } = await (body ? api.post<LineLinkStart>(path, body) : api.post<LineLinkStart>(path))
  if (typeof url !== 'string' || !url.startsWith(LINE_AUTHORIZE)) {
    throw new Error('unexpected LINE authorize url')
  }
  browser.assign(url)
}

/** 403 {code: 'REAUTH_REQUIRED', message} 的 message；不是這種錯誤回 null。 */
export function reauthRequiredMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null
  const detail = err.detail as { code?: unknown; message?: unknown } | null
  if (!detail || typeof detail !== 'object' || detail.code !== 'REAUTH_REQUIRED') return null
  return typeof detail.message === 'string' && detail.message ? detail.message : '請輸入目前的密碼再繼續。'
}
