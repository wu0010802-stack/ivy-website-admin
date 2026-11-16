import { notificationKindLabel } from '../api/labels'
import {
  babycareKindLabel, babycareShortName, formatDistance, kindLabel, shortName,
} from '../components/admissions/area/areaFormat'

// 站內通知裡「附近園所異動」與「附近幼兒園裁罰」的標題、內文與連結（2026-11-16 規格 §7.4）。純函式；payload 是後端
// geo/notices.py 寫的（欄位缺或型別不對時退回種類標題，不顯示 undefined）。

const AREA_KINDS = new Set(['area_provider_change', 'area_penalty'])
export const isAreaNotice = (kind: string): boolean => AREA_KINDS.has(kind)

type Payload = Record<string, unknown>
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const radius = (payload: Payload): number => num(payload.radius_km) ?? 3

const CHANGE_WORDS: Record<string, string> = { opened: '新設', closed: '停辦', kind_changed: '類型變動' }

// 「2026-10-02」→「115-10-02」。
function rocIso(iso: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return match ? `${Number(match[1]) - 1911}-${match[2]}-${match[3]}` : ''
}

function providerName(payload: Payload, name: string): string {
  return payload.provider === 'babycare' ? babycareShortName(name) : shortName(name)
}

export function areaNoticeTitle(kind: string, payload: Payload): string {
  const fallback = notificationKindLabel(kind)
  const name = str(payload.name)
  if (!name) return fallback
  if (kind === 'area_penalty') return `${radius(payload)} 公里內裁罰：${shortName(name)}`
  const word = CHANGE_WORDS[str(payload.change) ?? '']
  if (!word) return fallback
  const label = `${radius(payload)} 公里內${word}：${providerName(payload, name)}`
  if (payload.change !== 'kind_changed') return label
  const from = str(payload.old_kind)
  const to = str(payload.new_kind)
  return from && to ? `${label} ${kindLabel(from)} → ${kindLabel(to)}` : label
}

export function areaNoticeMeta(kind: string, payload: Payload): string {
  const distance = num(payload.distance_m)
  if (distance === null) return ''
  if (kind === 'area_penalty') {
    const laws = Array.isArray(payload.laws) ? payload.laws.filter((law): law is string => typeof law === 'string' && law !== '') : []
    const law = laws.length > 1 ? `${laws[0]}等 ${laws.length} 條` : (laws[0] ?? '')
    return [formatDistance(distance), rocIso(str(payload.occurred_on)), law].filter(Boolean).join('・')
  }
  const type = str(payload.kind)
  const typeText = type ? (payload.provider === 'babycare' ? babycareKindLabel(type) : kindLabel(type)) : ''
  return [formatDistance(distance), typeText, rocIso(str(payload.date))].filter(Boolean).join('・')
}

/** 連到該校區域分析的同業模式（附近園所與園所變化都在那裡）。 */
export const areaNoticeLink = (campusKey: string): string => `/admissions-stats?campus=${campusKey}&sub=area&map=peers`
