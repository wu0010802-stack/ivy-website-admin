export const BASE_URL = '/api/website/v1'

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

// 401 的集中處理。client.ts 不直接 import stores/auth 與 router（會造成
// 循環相依），改成讓 main.ts 註冊一個回呼。原本完全沒有這一層：session
// 過期或帳號被停權之後，SPA 會卡在各頁自己的錯誤訊息，永遠不會回登入頁。
// reason 決定登入頁與留在原頁的對話框怎麼說明：expired＝逾時（預設）、other-user＝這台
// 電腦已經換成別的帳號登入、session-changed＝CSRF token 對不上（多半也是換了帳號）。
export type UnauthorizedReason = 'expired' | 'other-user' | 'session-changed'
let unauthorizedHandler: ((reason?: UnauthorizedReason) => void) | null = null

export function setUnauthorizedHandler(handler: ((reason?: UnauthorizedReason) => void) | null): void {
  unauthorizedHandler = handler
}

/** 不是 API 回應而是前端自己發現登入已失效（例如 keepalive 發現換了帳號）時走同一條集中處理。 */
export function triggerUnauthorized(reason: UnauthorizedReason = 'expired'): void {
  unauthorizedHandler?.(reason)
}

// 後端對「CSRF token 對不上」回 403 與固定字串（backend/app/auth/deps.py 的
// check_csrf_and_origin），沒有機器可讀的 code，所以只能比對字串。同一台電腦在別的
// 分頁換了帳號後，舊分頁的 token 就屬於這種：視同登入失效，不能只印「CSRF token 無效」。
// 登出（stores/auth.ts 的 logout）也要認得這一種。
export const CSRF_INVALID_DETAIL = 'CSRF token 無效'

function handleAuthFailure(path: string, status: number, detail: unknown): void {
  if (status === 401) handleUnauthorized(path)
  else if (status === 403 && detail === CSRF_INVALID_DETAIL) handleUnauthorized(path, 'session-changed')
}

function handleUnauthorized(path: string, reason?: UnauthorizedReason): void {
  // 登入端點自己回 401 是「帳號密碼錯誤」，不是 session 過期，
  // 不能把使用者從登入頁再導回登入頁並清掉輸入。
  if (path.startsWith('/auth/login')) return
  // 登出端點回 401 代表 session 本來就失效了，logout() 自己當成已登出、接著
  // 換到登入頁；這裡再導一次會和那次換頁撞在一起，未儲存的提示也會多問一次。
  if (path.startsWith('/auth/logout')) return
  unauthorizedHandler?.(reason)
}

export class ApiError extends Error {
  status: number
  detail: unknown
  /**
   * 錯誤本文是不是 JSON。部署或重啟時代理（Nuxt／Railway）回的 502／503 是 HTML 或英文純文字，
   * 這時 detail 就是那段原文，不能直接顯示給員工（api/errors.ts 的 apiErrorMessage 改用 fallback）。
   */
  json: boolean

  constructor(status: number, detail: unknown, json = true) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
    this.status = status
    this.detail = detail
    this.json = json
  }
}

// 讀錯誤或成功的本文：能解析成 JSON 就用 JSON，不行就保留原文並記下不是 JSON。
function parseBody(text: string): { payload: unknown; json: boolean } {
  if (!text) return { payload: null, json: true }
  try {
    return { payload: JSON.parse(text), json: true }
  } catch {
    return { payload: text, json: false }
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; mutating?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const { method = 'GET', body, mutating = false } = options
  const headers: Record<string, string> = { ...options.headers }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (mutating && csrfToken) headers['X-CSRF-Token'] = csrfToken

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (response.status === 204) return undefined as T

  const { payload, json } = parseBody(await response.text())

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload
    handleAuthFailure(path, response.status, detail)
    throw new ApiError(response.status, detail, json)
  }

  return payload as T
}

async function upload<T>(path: string, method: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: formData,
  })

  const { payload, json } = parseBody(await response.text())

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload
    handleAuthFailure(path, response.status, detail)
    throw new ApiError(response.status, detail, json)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options: { headers?: Record<string, string> } = {}) =>
    request<T>(path, { method: 'POST', body, mutating: true, headers: options.headers }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body, mutating: true }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body, mutating: true }),
  // DELETE 也可以帶 JSON 本文（例如解除綁定時的 current_password）；Nuxt 代理會照轉。
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body, mutating: true }),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, 'POST', formData),
}

export function mediaFileUrl(id: string): string {
  return `${BASE_URL}/admin/media/${id}/file`
}

export type MediaVariantKind = 'thumbnail' | 'medium' | 'large' | 'poster' | 'video_desktop' | 'video_mobile'

/** version 是衍生檔記錄 id：重新產生衍生檔會換成新記錄，網址跟著換，瀏覽器不會沿用快取的舊縮圖。 */
export function mediaVariantUrl(id: string, kind: MediaVariantKind, version?: string): string {
  const url = `${BASE_URL}/admin/media/${id}/variants/${kind}`
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}

interface PreviewableAsset {
  id: string
  kind: string
  variants?: { id?: string; kind: string; width?: number | null }[] | null
}

/**
 * 素材庫列表、選圖器、版位預覽用的小圖：圖片用縮圖、影片用自動抽的畫面；
 * 沒有衍生檔（舊素材處理失敗）的圖片退回原檔，影片回空字串（顯示佔位）。
 */
export function mediaPreviewUrl(asset: PreviewableAsset): string {
  const variants = asset.variants ?? []
  const pick = (kind: MediaVariantKind) => variants.find((v) => v.kind === kind)
  if (asset.kind === 'video') {
    const poster = pick('poster')
    return poster ? mediaVariantUrl(asset.id, 'poster', poster.id) : ''
  }
  const thumbnail = pick('thumbnail')
  return thumbnail ? mediaVariantUrl(asset.id, 'thumbnail', thumbnail.id) : mediaFileUrl(asset.id)
}

/**
 * 點選裁切焦點用的照片。焦點座標要跟官網實際顯示的方向一致：寬度不明的縮圖
 * 還沒重新產生（2026-09-25 以前的縮圖沒依拍攝方向轉正，手機直拍的是躺著的），
 * 改用原檔——瀏覽器顯示原檔時會依拍攝方向轉正，跟官網一樣。
 */
export function mediaFocusUrl(asset: PreviewableAsset): string {
  const thumbnail = (asset.variants ?? []).find((v) => v.kind === 'thumbnail')
  return thumbnail?.width ? mediaVariantUrl(asset.id, 'thumbnail', thumbnail.id) : mediaFileUrl(asset.id)
}
