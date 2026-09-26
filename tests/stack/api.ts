import { expect, request, type APIRequestContext } from '@playwright/test'
import { USERS, WEB_ORIGIN, type StackRole } from './stack-env'

// 以某個角色登入的 API 用戶端：走官網同源代理（和瀏覽器一樣），寫入請求自動帶 CSRF。
// 只用來準備資料與核對結果；要驗證的操作一律在畫面上做。
export interface AdminApi {
  context: APIRequestContext
  get<T = unknown>(path: string): Promise<T>
  send<T = unknown>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T>
  dispose(): Promise<void>
}

const API = '/api/website/v1'

export async function adminApi(role: StackRole): Promise<AdminApi> {
  const context = await request.newContext({ baseURL: WEB_ORIGIN })
  const login = await context.post(`${API}/auth/login`, { data: { email: USERS[role].email, password: USERS[role].password } })
  expect(login.status(), await login.text()).toBe(200)
  const { csrf_token: csrf } = (await login.json()) as { csrf_token: string }

  return {
    context,
    async get<T>(path: string) {
      const response = await context.get(`${API}${path}`)
      expect(response.ok(), `GET ${path}：${response.status()} ${await response.text()}`).toBe(true)
      return (await response.json()) as T
    },
    async send<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown) {
      const response = await context.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf } })
      expect(response.ok(), `${method} ${path}：${response.status()} ${await response.text()}`).toBe(true)
      return (response.status() === 204 ? undefined : await response.json()) as T
    },
    dispose: () => context.dispose(),
  }
}

/** 台北時區今天往後 n 天的日期（YYYY-MM-DD）。 */
export function taipeiDate(daysFromToday: number): string {
  const date = new Date(Date.now() + daysFromToday * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date)
}

export interface SlotOut {
  id: string
  campus_key: string
  slot_date: string
  start_time: string
  end_time: string
  capacity: number
  booked_count: number
}

export interface VisitSummary {
  id: string
  campus_key: string
  parent_name: string
  status: string
  slot: { id: string; slot_date: string; start_time: string } | null
}

/** 用家長稱呼找案件（每個測試用不重複的稱呼）。 */
export async function findVisit(api: AdminApi, parentName: string): Promise<VisitSummary> {
  const items = await api.get<VisitSummary[]>(`/admin/visit-requests?q=${encodeURIComponent(parentName)}`)
  expect(items, `找不到「${parentName}」的案件`).toHaveLength(1)
  return items[0]
}

/** 以家長身分從公開 API 送一筆需求（只用來準備資料；送單畫面由 booking-flow 驗證）。 */
export async function submitPublicRequest(campus: string, parentName: string, phone: string): Promise<void> {
  const context = await request.newContext({ baseURL: WEB_ORIGIN })
  const config = await (await context.get(`${API}/public/booking-config/${campus}`)).json()
  let slotId: string | undefined
  if (config.mode === 'slots') {
    const slots = await context.get(`${API}/public/slots?campus_key=${campus}&date_from=${taipeiDate(0)}&date_to=${taipeiDate(30)}`)
    expect(slots.ok(), await slots.text()).toBe(true)
    slotId = ((await slots.json()) as { id: string }[])[0]?.id
    expect(slotId, `${campus} 沒有可預約的場次`).toBeTruthy()
  }
  const response = await context.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-${campus}-${phone}` },
    data: {
      campus_key: campus,
      parent_name: parentName,
      phone,
      child_name: '測試寶貝',
      child_birthdate: '2022-05-01',
      party_size: 2,
      consent_given: true,
      consent_revision_id: config.consent_revision_id,
      config_version: config.version,
      slot_id: slotId,
    },
  })
  // 同一個 Idempotency-Key 重送（測試失敗後 beforeAll 重跑）回 200 與原案件。
  expect([200, 201], await response.text()).toContain(response.status())
  await context.dispose()
}
