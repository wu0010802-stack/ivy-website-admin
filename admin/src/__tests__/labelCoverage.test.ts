// 後端每新增一種通知 kind、稽核動作或稽核對象，後台都要有中文標籤，否則
// 站內通知與操作紀錄頁會直接顯示英文代碼。這裡直接讀後端原始碼比對，不靠
// 人記得同步：新增 log_action 或 outbox kind 忘了補 labels.ts，這個測試就會失敗。
import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_LABELS,
  CANCEL_REASON_LABELS,
  CTA_ENTRY_LABELS,
  REFERRAL_SOURCE_LABELS,
  RETENTION_CATEGORY_LABELS,
  SLOT_CLOSED_SOURCE_LABELS,
  VISIT_SOURCE_LABELS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_REASON_LABELS,
  notificationLabel,
  outboxErrorLabel,
} from '../api/labels'

const backendSources = import.meta.glob('../../../backend/app/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function source(path: string): string {
  const key = Object.keys(backendSources).find((k) => k.endsWith(path))
  if (!key) throw new Error(`找不到後端檔案 ${path}`)
  return backendSources[key]!
}

// 每個 audit_service.log_action(...) 呼叫的參數區段（到下一個右括號收尾為止
// 的第一層），從裡面取 action= 與 target_type= 的字串字面值；條件式
// `"a" if x else "b"` 兩邊都算。
// booking/routes.py 的 _audit_transition(...) 也是在呼叫端寫 action 字面值。
const AUDIT_CALLS = ['log_action(', '_audit_transition(']

function logActionCalls(): string[] {
  const calls: string[] = []
  for (const [path, text] of Object.entries(backendSources)) {
    if (path.endsWith('audit_service.py')) continue
    for (const name of AUDIT_CALLS) {
      let index = text.indexOf(name)
      while (index !== -1) {
        let depth = 0
        let end = index + name.length - 1
        for (; end < text.length; end++) {
          if (text[end] === '(') depth++
          else if (text[end] === ')' && --depth === 0) break
        }
        calls.push(text.slice(index, end + 1))
        index = text.indexOf(name, end)
      }
    }
  }
  return calls
}

// 提醒的門檻是 reminders.py 的 timedelta 常數，後端文案用 f-string 帶出數字，
// labels.ts 則是寫死的。這裡解析常數、把後端的 f-string 算成實際文字再比對，
// 改了常數忘了改 labels.ts（或反過來）就會失敗。常數改成別的寫法時直接報錯，
// 不讓比對悄悄失效。
function reminderHours(reminders: string): Record<string, number> {
  const hours: Record<string, number> = {}
  for (const m of reminders.matchAll(/^([A-Z_]+) = timedelta\((hours|days)=(\d+)\)$/gm)) {
    hours[m[1]!] = Number(m[3]) * (m[2] === 'days' ? 24 : 1)
  }
  return hours
}

function renderReminderText(template: string, hours: Record<string, number>): string {
  return template.replace(/\{(?:reminders\.)?whole_hours\((?:reminders\.)?([A-Z_]+)\)\}/g, (_, name: string) => {
    if (hours[name] === undefined) throw new Error(`reminders.py 的 ${name} 不是 timedelta(hours=N) 或 timedelta(days=N)`)
    return String(hours[name])
  })
}

function literals(calls: string[], keyword: string): Set<string> {
  const found = new Set<string>()
  const pattern = new RegExp(`\\b${keyword}=([^,\\n]+)`, 'g')
  for (const call of calls) {
    for (const match of call.matchAll(pattern)) {
      // 條件式只取兩個結果，條件本身的字串（例如 == "approve"）不算。
      const expression = match[1]!.replace(/\sif\s.*?\selse\s/g, ' ')
      for (const literal of expression.matchAll(/"([^"]+)"/g)) found.add(literal[1]!)
    }
  }
  return found
}

describe('中文標籤涵蓋後端所有代碼', () => {
  const calls = logActionCalls()

  it('讀得到後端的稽核呼叫（避免 glob 路徑錯了測試變成空轉）', () => {
    expect(calls.length).toBeGreaterThan(30)
  })

  it('每一種稽核動作都有中文', () => {
    const actions = literals(calls, 'action')
    expect(actions.size).toBeGreaterThan(30)
    expect(actions).toContain('content.approve')
    expect(actions).toContain('content.reject')
    // 狀態轉換經 _audit_transition 記，也要掃得到。
    expect(actions).toContain('visit_request.cancel')
    expect([...actions].filter((action) => !AUDIT_ACTION_LABELS[action])).toEqual([])
  })

  it('每一種稽核對象都有中文', () => {
    const targets = literals(calls, 'target_type')
    expect(targets.size).toBeGreaterThan(5)
    expect([...targets].filter((target) => !AUDIT_TARGET_LABELS[target])).toEqual([])
  })

  it('每一種通知 kind 都有中文，且和後端文字一致', () => {
    const service = source('notifications/service.py')
    const block = service.slice(service.indexOf('_KIND_LABELS = {'), service.indexOf('\n}\n', service.indexOf('_KIND_LABELS = {')))
    const backendKinds = [...block.matchAll(/^\s+"([a-z_]+)":\s*"([^"]+)"/gm)].map((m) => [m[1]!, m[2]!] as const)
    expect(backendKinds.length).toBeGreaterThan(5)
    for (const [kind, text] of backendKinds) expect(NOTIFICATION_KIND_LABELS[kind], kind).toBe(text)

    // 提醒的 kind 用常數寫在 reminders.py，_KIND_LABELS 以 reminders.XXX_KIND 當鍵、
    // 門檻數字用 f-string 帶出。
    const reminders = source('notifications/reminders.py')
    const kindByConstant = Object.fromEntries(
      [...reminders.matchAll(/^([A-Z_]+_KIND) = "([a-z_]+)"/gm)].map((m) => [m[1]!, m[2]!]),
    )
    expect(Object.values(kindByConstant)).toEqual(['visit_upcoming', 'visit_request_overdue'])
    const hours = reminderHours(reminders)
    const reminderLabels = [...block.matchAll(/^\s+reminders\.([A-Z_]+_KIND):\s*f?"([^"]+)"/gm)]
    expect(reminderLabels.map((m) => kindByConstant[m[1]!])).toEqual(['visit_upcoming', 'visit_request_overdue'])
    for (const [, constant, template] of reminderLabels) {
      const kind = kindByConstant[constant!]!
      expect(NOTIFICATION_KIND_LABELS[kind], kind).toBe(renderReminderText(template!, hours))
    }
    expect(NOTIFICATION_KIND_LABELS.visit_upcoming).toBe(`即將參觀（${hours.UPCOMING_VISIT_LEAD} 小時內）`)

    // 所有 enqueue_outbox 的 kind 也要有。
    const enqueued = new Set<string>()
    for (const text of Object.values(backendSources)) {
      for (const m of text.matchAll(/enqueue_outbox\(\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g)) enqueued.add(m[1]!)
    }
    expect(enqueued.size).toBeGreaterThan(4)
    expect([...enqueued].filter((kind) => !NOTIFICATION_KIND_LABELS[kind])).toEqual([])
  })

  it('逾期未處理的原因有中文、文字和後端一致，並帶進通知標題', () => {
    const reminders = source('notifications/reminders.py')
    const reasonByConstant = Object.fromEntries(
      [...reminders.matchAll(/^(REASON_[A-Z_]+) = "([a-z_]+)"/gm)].map((m) => [m[1]!, m[2]!]),
    )
    expect(Object.values(reasonByConstant)).toEqual(['new_unhandled', 'hold_expiring'])
    const hours = reminderHours(reminders)
    const block = reminders.slice(reminders.indexOf('REASON_LABELS = {'), reminders.indexOf('\n}\n', reminders.indexOf('REASON_LABELS = {')))
    const backendReasons = [...block.matchAll(/^\s+(REASON_[A-Z_]+):\s*f?"([^"]+)"/gm)]
    expect(backendReasons.length).toBe(2)
    for (const [, constant, template] of backendReasons) {
      const reason = reasonByConstant[constant!]!
      expect(NOTIFICATION_REASON_LABELS[reason], reason).toBe(renderReminderText(template!, hours))
    }
    expect(NOTIFICATION_REASON_LABELS.new_unhandled).toContain(`${hours.NEW_REQUEST_OVERDUE_AFTER} 小時`)
    expect(NOTIFICATION_REASON_LABELS.hold_expiring).toContain(`${hours.HOLD_EXPIRING_WITHIN} 小時`)

    expect(notificationLabel('visit_request_overdue', { reason: 'new_unhandled' })).toBe(
      `案件逾期未處理：${NOTIFICATION_REASON_LABELS.new_unhandled}`,
    )
    expect(notificationLabel('visit_request_overdue', { reason: 'other' })).toBe('案件逾期未處理')
    expect(notificationLabel('visit_upcoming', null)).toBe(NOTIFICATION_KIND_LABELS.visit_upcoming)
  })

  it('解析得出提醒門檻，後端文案改成別的寫法時直接報錯', () => {
    const hours = reminderHours('UPCOMING_VISIT_LEAD = timedelta(hours=24)\nHOLD_EXPIRING_WITHIN = timedelta(days=1)\n')
    expect(hours).toEqual({ UPCOMING_VISIT_LEAD: 24, HOLD_EXPIRING_WITHIN: 24 })
    expect(renderReminderText('即將參觀（{reminders.whole_hours(reminders.UPCOMING_VISIT_LEAD)} 小時內）', hours)).toBe('即將參觀（24 小時內）')
    expect(() => renderReminderText('{whole_hours(NEW_REQUEST_OVERDUE_AFTER)}', hours)).toThrow('NEW_REQUEST_OVERDUE_AFTER')
  })

  it('個資保存政策的案件分類都有中文', () => {
    const retention = source('operations/retention_service.py')
    const block = retention.slice(retention.indexOf('# 各類的代碼'), retention.indexOf('CATEGORIES = ('))
    // 類別直接沿用案件狀態的代碼（VisitRequestStatus.XXX.value）。
    const categories = [...block.matchAll(/^[A-Z_]+ = VisitRequestStatus\.([A-Z_]+)\.value/gm)].map((m) => m[1]!.toLowerCase())
    expect(categories).toEqual(['cancelled', 'no_show', 'completed'])
    expect(categories.filter((c) => !RETENTION_CATEGORY_LABELS[c])).toEqual([])
  })

  it('寄送失敗的錯誤碼轉成大概原因', () => {
    expect(outboxErrorLabel('LinePushError')).toBe('LINE 推播失敗')
    expect(outboxErrorLabel('SMTPAuthenticationError')).toBe('寄信伺服器帳號或密碼錯誤')
    expect(outboxErrorLabel('SMTPServerDisconnected')).toBe('寄信伺服器錯誤')
    expect(outboxErrorLabel('ConnectionRefusedError')).toBe('連不上寄信或推播伺服器')
    expect(outboxErrorLabel('TimeoutError')).toBe('連線逾時')
    // LINE 推播連不上或逾時時，錯誤碼是 httpx 的例外類別名稱（沒有包成 LinePushError）。
    for (const code of ['ConnectError', 'ReadError', 'WriteError', 'RemoteProtocolError', 'ProxyError']) {
      expect(outboxErrorLabel(code), code).toBe('連不上寄信或推播伺服器')
    }
    for (const code of ['ConnectTimeout', 'ReadTimeout', 'WriteTimeout', 'PoolTimeout']) {
      expect(outboxErrorLabel(code), code).toBe('連線逾時')
    }
    // 寄信走 smtplib，憑證或 TLS 握手失敗是 ssl 模組的例外。
    for (const code of ['SSLError', 'SSLCertVerificationError', 'SSLEOFError']) {
      expect(outboxErrorLabel(code), code).toBe('加密連線失敗，請檢查伺服器位址與憑證')
    }
    expect(outboxErrorLabel('RuntimeError')).toBe('其他錯誤')
    expect(outboxErrorLabel(null)).toBe('原因不明')
  })

  it('成效統計的入口代碼、取消原因、案件來源與「從哪裡知道我們」都有中文', () => {
    const models = source('operations/models.py')
    const entriesBlock = models.slice(models.indexOf('CTA_ENTRIES = ('), models.indexOf(')', models.indexOf('CTA_ENTRIES = (')))
    const entries = [...entriesBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)
    expect(entries.length).toBeGreaterThan(8)
    expect(entries.filter((entry) => !CTA_ENTRY_LABELS[entry])).toEqual([])

    const reasons = [...models.matchAll(/^CANCEL_REASON_[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1]!)
    expect(reasons).toEqual(['parent', 'staff', 'hold_expired'])
    expect(reasons.filter((reason) => !CANCEL_REASON_LABELS[reason])).toEqual([])

    const bookingModels = source('booking/models.py')
    const sourceBlock = bookingModels.slice(bookingModels.indexOf('class VisitRequestSource'), bookingModels.indexOf('class BookingConfig'))
    const sources = [...sourceBlock.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1]!)
    expect(sources).toContain('walk_in')
    expect(sources.filter((value) => !VISIT_SOURCE_LABELS[value])).toEqual([])

    // 時段關閉來源：休假日、手動、改規則停用，時段頁的狀態欄都要有中文。
    const closedBlock = bookingModels.slice(bookingModels.indexOf('class SlotClosedSource'), bookingModels.indexOf('class VisitSlot('))
    const closedSources = [...closedBlock.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1]!)
    expect(closedSources).toEqual(['manual', 'exception', 'rule'])
    expect(closedSources.filter((value) => !SLOT_CLOSED_SOURCE_LABELS[value])).toEqual([])

    const schemas = source('booking/schemas.py')
    const referralLine = schemas.slice(schemas.indexOf('ReferralSource = Literal['), schemas.indexOf('\n', schemas.indexOf('ReferralSource = Literal[')))
    const referrals = [...referralLine.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)
    expect(referrals.length).toBe(5)
    expect(referrals.filter((value) => !REFERRAL_SOURCE_LABELS[value])).toEqual([])
  })
})
