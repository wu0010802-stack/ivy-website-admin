import { describe, expect, it } from 'vitest'
import { maskEmail, visitResultCopy, visitResultKind } from '../app/utils/visit-result'

describe('送出結果', () => {
  it('只有 confirmed 才算預約成功；重送拿到已取消的案件要照實說', () => {
    expect(visitResultKind('confirmed')).toBe('booked')
    expect(visitResultKind('cancelled')).toBe('closed')
    expect(visitResultKind(null)).toBe('closed')
  })

  it('寄信開著才說信已寄出，Email 要遮罩', () => {
    expect(maskEmail('wang.mama@gmail.com')).toBe('w***@gmail.com')
    expect(visitResultCopy('booked', { emailEnabled: true, email: 'wang.mama@gmail.com' }).body).toContain('確認信已寄到 w***@gmail.com')
    const off = visitResultCopy('booked', { emailEnabled: false, email: 'wang.mama@gmail.com' })
    expect(off.eyebrow).toBe('預約成功')
    expect(off.body).not.toContain('已寄到')
    expect(off.body).toContain('收藏')
    expect(visitResultCopy('closed', { emailEnabled: true, email: 'a@b.co' }).eyebrow).toBe('預約已取消')
  })

  it('重送拿不到修改連結（連結已重新產生過）時，不叫家長看「下方的連結」', () => {
    const mailed = visitResultCopy('booked', { emailEnabled: true, email: 'wang.mama@gmail.com', hasLink: false })
    expect(mailed.body).toContain('確認信已寄到 w***@gmail.com')
    expect(mailed.body).not.toContain('下方')
    const unmailed = visitResultCopy('booked', { emailEnabled: false, email: 'wang.mama@gmail.com', hasLink: false })
    expect(unmailed.body).not.toContain('下方')
    expect(unmailed.body).not.toContain('收藏')
    expect(unmailed.body).toContain('聯絡園所')
  })
})
