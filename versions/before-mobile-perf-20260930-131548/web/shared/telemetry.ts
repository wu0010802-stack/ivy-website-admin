export const campusKeys = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const
export type PublicPage = { page: 'home' | 'campus' | 'visit'; campus: string | null }
export type TelemetryEvent = PublicPage & {
  event: 'page_view' | 'visit_click' | 'LCP' | 'INP' | 'CLS'
  device: 'mobile' | 'desktop'
  value?: number
  id?: string
}

export function publicPage(path: string): PublicPage | null {
  const clean = path.split(/[?#]/)[0]?.replace(/\/$/, '') || '/'
  if (clean === '/') return { page: 'home', campus: null }
  if (clean === '/visit') return { page: 'visit', campus: null }
  const match = clean.match(/^\/(campuses|visit)\/([a-z]+)$/)
  if (!match || !campusKeys.some((key) => key === match[2])) return null
  return { page: match[1] === 'campuses' ? 'campus' : 'visit', campus: match[2]! }
}

export function validateTelemetry(input: unknown): TelemetryEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const item = input as Record<string, unknown>
  if (Object.keys(item).some((key) => !['event', 'page', 'campus', 'device', 'value', 'id'].includes(key))) return null
  if (typeof item.page !== 'string' || typeof item.device !== 'string' || typeof item.event !== 'string') return null
  if (!['home', 'campus', 'visit'].includes(item.page) || !['mobile', 'desktop'].includes(item.device)) return null
  if (item.campus !== null && !campusKeys.some((key) => key === item.campus)) return null
  if ((item.page === 'home' && item.campus !== null) || (item.page === 'campus' && item.campus === null)) return null
  if (['LCP', 'INP', 'CLS'].includes(item.event)) {
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0 || item.value > (item.event === 'CLS' ? 100 : 3_600_000)) return null
    if (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) return null
  } else if (!['page_view', 'visit_click'].includes(item.event) || item.value !== undefined || item.id !== undefined) return null
  return item as TelemetryEvent
}
