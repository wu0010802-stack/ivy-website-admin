// 操作紀錄一筆的文字（2026-10-06 從 AuditView.vue 抽出）：畫面、搜尋與 CSV 匯出共用，
// 中文只維護在 labels.ts 一份。
import { auditActionLabel, auditTargetLabel, campusLabel, type AuditDetails, type StaffPerson, staffEmail, staffLabel, staffOf } from '../api/labels'
import type { AuditLogEntryOut } from '../api/types'
import type { CsvCell } from './csv'
import { describeUserAgent } from './userAgent'

type AuditEntry = AuditLogEntryOut

export function auditCampusText(entry: AuditEntry): string {
  return entry.campus_key ? campusLabel(entry.campus_key) : '全站'
}

// 誰做的：讀取時由後端 join 帳號查出來（紀錄本身不存名字與 Email）。沒有操作者
// 是排程發布、每天清理這類系統自己做的事；有 id 卻查不到是帳號已刪除。
export function auditActorText(entry: AuditEntry): string {
  return staffLabel(staffOf(entry, 'actor'), entry.actor_user_id ? '已移除的帳號' : '系統')
}

export function auditActorEmail(entry: AuditEntry): string {
  return staffEmail(staffOf(entry, 'actor'))
}

// 從哪裡做的：裝置（由 User-Agent 解析）與 IP。IP 只有總部拿得到，其他人
// 後端回 null；改版前的紀錄與系統動作兩個都沒有，就不多寫一行。
export function auditSourceText(entry: AuditEntry): string {
  return [describeUserAgent(entry.user_agent), entry.ip_address].filter(Boolean).join('・')
}

// 對哪個帳號（新增帳號、重設密碼、改角色……）：後端給對方的顯示名稱，沒有時
// 給 Email；Email 和其他地方一樣只寫 @ 前面那段，完整的放在 title。
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+$/
export function auditTargetPerson(entry: AuditEntry): StaffPerson | null {
  const label = entry.target_label?.trim()
  if (!label) return null
  return EMAIL_LIKE.test(label) ? { email: label } : { display_name: label }
}

export function auditTargetText(entry: AuditEntry): string {
  const person = auditTargetPerson(entry)
  return person ? staffLabel(person) : ''
}

/** 搜尋用的整筆文字（已轉小寫）：畫面上的搜尋與匯出的搜尋用同一份，裝置與 IP 也搜得到。 */
export function auditSearchText(entry: AuditEntry, details: AuditDetails): string {
  const who = [auditActorText(entry), auditActorEmail(entry), auditTargetText(entry), staffEmail(auditTargetPerson(entry))]
  return [auditActionLabel(entry.action), auditTargetLabel(entry.target_type), ...who, auditSourceText(entry), ...details.lines, ...details.others, auditCampusText(entry)]
    .join(' ')
    .toLocaleLowerCase()
}

// 欄位：裝置人人有；IP 只有總部拿得到（後端只給總部），非總部的檔案不出一整欄空白，所以另外附加。
export const AUDIT_CSV_HEADER: readonly string[] = ['日期時間', '操作者', '操作者 Email', '動作', '對象類型', '對象帳號', '校區', '細節', '其他細節', '裝置']

export function auditCsvHeader(withIp: boolean): readonly string[] {
  return withIp ? [...AUDIT_CSV_HEADER, 'IP'] : AUDIT_CSV_HEADER
}

const CSV_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** 台北時間「2026/09/28 14:30」（同參觀案件匯出）。 */
export function auditCsvTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = Object.fromEntries(CSV_TIME.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

/** CSV 一列：Email 與對象帳號寫完整的（畫面只寫 @ 前面那段）；withIp 要和 auditCsvHeader 的參數一致。 */
export function auditCsvRow(entry: AuditEntry, details: AuditDetails, withIp = false): CsvCell[] {
  const row: CsvCell[] = [
    auditCsvTime(entry.created_at),
    auditActorText(entry),
    entry.actor_email ?? '',
    auditActionLabel(entry.action),
    auditTargetLabel(entry.target_type),
    entry.target_label ?? '',
    auditCampusText(entry),
    details.lines.join('，'),
    details.others.join('；'),
    describeUserAgent(entry.user_agent),
  ]
  if (withIp) row.push(entry.ip_address ?? '')
  return row
}
