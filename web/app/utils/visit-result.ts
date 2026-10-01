export type VisitResultKind = 'booked' | 'closed'

export function visitResultKind(status: string | null | undefined): VisitResultKind {
  return status === 'confirmed' ? 'booked' : 'closed'
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  if (!name || !domain) return email
  return `${name.slice(0, 1)}***@${domain}`
}

export function visitResultCopy(kind: VisitResultKind, mail: { emailEnabled: boolean; email: string }) {
  if (kind === 'closed') {
    return {
      eyebrow: '預約已取消',
      title: '這筆預約已經取消',
      body: '若想再參觀，請重新選擇場次，或直接聯絡園所。'
    }
  }
  return {
    eyebrow: '預約成功',
    title: '已經幫你排好參觀時間',
    body: mail.emailEnabled && mail.email
      ? `確認信已寄到 ${maskEmail(mail.email)}，沒收到請看垃圾信件匣。之後要改時間、修改資料或取消，都從信裡或下方的連結進入。`
      : '請收藏下方的修改連結，之後要改時間、修改資料或取消，都從這裡進入。'
  }
}
