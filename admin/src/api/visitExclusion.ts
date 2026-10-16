// 預約案件的排除標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md §3.2）。
import { api } from './client'
import type { VisitRequestDetailOut } from './types'

export type ExcludeReason = 'test' | 'duplicate' | 'other'
export const EXCLUDE_REASONS: readonly ExcludeReason[] = ['test', 'duplicate', 'other']

export function excludeVisit(id: string, body: { reason: ExcludeReason; note?: string | null }): Promise<VisitRequestDetailOut> {
  return api.post<VisitRequestDetailOut>(`/admin/visit-requests/${id}/exclude`, body)
}

export function includeVisit(id: string): Promise<VisitRequestDetailOut> {
  return api.post<VisitRequestDetailOut>(`/admin/visit-requests/${id}/include`)
}
