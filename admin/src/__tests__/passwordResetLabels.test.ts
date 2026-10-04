// 2026-10-03 重設密碼連結：操作紀錄的動作、原因與寄送失敗原因都有中文。
import { describe, expect, it } from 'vitest'
import { auditActionLabel, auditMetadataSummary, auditReasonLabel } from '../api/labels'

describe('重設密碼連結的操作紀錄', () => {
  it('四種動作都有中文', () => {
    expect(auditActionLabel('user.password_reset_link_sent')).toBe('寄出重設密碼連結')
    expect(auditActionLabel('user.password_reset_link_failed')).toBe('重設密碼連結沒有寄出')
    expect(auditActionLabel('user.password_reset_link_rejected')).toBe('重設密碼連結無效，沒有改密碼')
    expect(auditActionLabel('user.password_reset_completed')).toBe('用重設連結設定新密碼')
  })

  it('連結無效的原因翻成白話', () => {
    expect(auditReasonLabel('link_expired')).toBe('連結已過期')
    expect(auditReasonLabel('link_used')).toBe('連結已經用過')
    expect(auditReasonLabel('link_revoked')).toBe('連結已作廢（寄了新連結、密碼已變更或帳號停用）')
    expect(auditMetadataSummary({ reason: 'link_expired' }, 'user.password_reset_link_rejected')).toBe('原因：連結已過期')
  })

  it('寄送失敗的錯誤類別翻成大概原因', () => {
    expect(auditMetadataSummary({ error_code: 'SMTPAuthenticationError' }, 'user.password_reset_link_failed')).toBe(
      '寄送失敗原因：寄信伺服器帳號或密碼錯誤',
    )
  })

  it('寄出時記的期限與是否取代舊連結沿用既有寫法', () => {
    const summary = auditMetadataSummary({ expires_at: '2026-10-03T06:52:00Z', replaced_previous: true }, 'user.password_reset_link_sent')
    expect(summary).toContain('連結到期')
    expect(summary).toContain('先前的連結同時失效')
  })
})
