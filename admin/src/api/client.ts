export const BASE_URL = '/api/website/v1'

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

// 401 的集中處理。client.ts 不直接 import stores/auth 與 router（會造成
// 循環相依），改成讓 main.ts 註冊一個回呼。原本完全沒有這一層：session
// 過期或帳號被停權之後，SPA 會卡在各頁自己的錯誤訊息，永遠不會回登入頁。
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

function handleUnauthorized(path: string): void {
  // 登入端點自己回 401 是「帳號密碼錯誤」，不是 session 過期，
  // 不能把使用者從登入頁再導回登入頁並清掉輸入。
  if (path.startsWith('/auth/login')) return
  unauthorizedHandler?.()
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
    this.status = status
    this.detail = detail
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

  let payload: unknown = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized(path)
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload
    throw new ApiError(response.status, detail)
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

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized(path)
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload
    throw new ApiError(response.status, detail)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options: { headers?: Record<string, string> } = {}) =>
    request<T>(path, { method: 'POST', body, mutating: true, headers: options.headers }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body, mutating: true }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body, mutating: true }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE', mutating: true }),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, 'POST', formData),
}

export function mediaFileUrl(id: string): string {
  return `${BASE_URL}/admin/media/${id}/file`
}

export type MediaVariantKind = 'thumbnail' | 'poster' | 'large'

export function mediaVariantUrl(id: string, kind: MediaVariantKind): string {
  return `${BASE_URL}/admin/media/${id}/variants/${kind}`
}

/**
 * 素材庫列表、選圖器、版位預覽用的小圖：圖片用縮圖、影片用自動抽的畫面；
 * 沒有衍生檔（舊素材處理失敗）的圖片退回原檔，影片回空字串（顯示佔位）。
 */
export function mediaPreviewUrl(asset: { id: string; kind: string; variants?: { kind: string }[] | null }): string {
  const variants = asset.variants ?? []
  if (asset.kind === 'video') return variants.some((v) => v.kind === 'poster') ? mediaVariantUrl(asset.id, 'poster') : ''
  return variants.some((v) => v.kind === 'thumbnail') ? mediaVariantUrl(asset.id, 'thumbnail') : mediaFileUrl(asset.id)
}
