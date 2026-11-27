// 2026-11-27：總部群組在統計異常卡片按「知道了」的操作紀錄（docs/specs/2026-11-27-line-card-buttons-design.md §4）。
import { describe, expect, it } from 'vitest'
import { auditMetadataDetails, auditSearchTerms } from '../api/auditLabels'
import { AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS } from '../api/labels'

describe('統計異常「知道了」的操作紀錄', () => {
  it('動作、對象與 metadata 都翻成中文，群組與 LINE 代碼不顯示', () => {
    expect(AUDIT_ACTION_LABELS['line.group.stats_health_mute']).toBe('統計異常先不提醒（LINE 群組）')
    expect(AUDIT_TARGET_LABELS.stats_health).toBe('官網統計異常提醒')
    const details = auditMetadataDetails(
      { issues: ['ga4_silent', 'traffic_zero'], muted_until: '2026-11-30', group_id: 'Cabc', line_user_id: 'Uabc' },
      'line.group.stats_health_mute',
    )
    expect(details.lines).toEqual(expect.arrayContaining(['問題：GA4 沒收到事件、瀏覽是 0', '暫停提醒到：2026-11-30']))
    expect(details.lines.join('')).not.toContain('Cabc')
    expect(details.lines.join('')).not.toContain('Uabc')
  })

  it('用中文搜得到問題代碼', () => {
    expect(auditSearchTerms('GA4 沒收到')).toEqual(expect.arrayContaining(['ga4_silent']))
  })
})
