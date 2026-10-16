import { describe, expect, it } from 'vitest'
import { auditMetadataDetails, AUDIT_ACTION_LABELS } from '../api/labels'
import { visitEventTitle } from '../api/visitHistory'

describe('時間線與操作紀錄的中文', () => {
  it('excluded／exclusion_removed 有標題；操作紀錄動作與原因有中文', () => {
    const base = { id: 'e', source: 'staff', actor_user_id: null, actor_email: null, before: null, reason: null, created_at: '2026-10-15T02:00:00Z' }
    expect(visitEventTitle({ ...base, event_type: 'excluded', after: { reason: 'duplicate' } } as never)).toBe('標記為排除：重複')
    expect(visitEventTitle({ ...base, event_type: 'exclusion_removed', after: null } as never)).toBe('取消排除')
    expect(AUDIT_ACTION_LABELS['visit_request.exclude']).toBe('標記為排除')
    expect(AUDIT_ACTION_LABELS['visit_request.include']).toBe('取消排除')
    expect(auditMetadataDetails({ exclude_reason: 'test' }, 'visit_request.exclude').lines).toContain('排除原因：測試')
  })

  it('案件匯出的「排除」篩選有中文；不認得的值不顯示', () => {
    expect(auditMetadataDetails({ excluded: 'hide', row_count: 3 }, 'visit_request.export').lines).toContain('隱藏已排除')
    expect(auditMetadataDetails({ excluded: 'only' }, 'visit_request.export').lines).toContain('只看已排除')
    expect(auditMetadataDetails({ excluded: 'nope' }, 'visit_request.export').lines.join()).not.toContain('nope')
  })
})
