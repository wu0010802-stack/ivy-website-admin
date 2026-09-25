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

    // 提醒的 kind 用常數寫在 reminders.py。
    const reminders = source('notifications/reminders.py')
    const reminderKinds = [...reminders.matchAll(/^[A-Z_]+_KIND = "([a-z_]+)"/gm)].map((m) => m[1]!)
    expect(reminderKinds).toEqual(['visit_upcoming', 'visit_request_overdue'])
    for (const kind of reminderKinds) expect(NOTIFICATION_KIND_LABELS[kind], kind).toBeTruthy()

    // 所有 enqueue_outbox 的 kind 也要有。
    const enqueued = new Set<string>()
    for (const text of Object.values(backendSources)) {
      for (const m of text.matchAll(/enqueue_outbox\(\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g)) enqueued.add(m[1]!)
    }
    expect(enqueued.size).toBeGreaterThan(4)
    expect([...enqueued].filter((kind) => !NOTIFICATION_KIND_LABELS[kind])).toEqual([])
  })

  it('逾期未處理的原因有中文，並帶進通知標題', () => {
    const reminders = source('notifications/reminders.py')
    const reasons = [...reminders.matchAll(/^REASON_[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1]!)
    expect(reasons.length).toBe(2)
    for (const reason of reasons) expect(NOTIFICATION_REASON_LABELS[reason], reason).toBeTruthy()
    expect(notificationLabel('visit_request_overdue', { reason: 'new_unhandled' })).toBe(
      '案件逾期未處理：新的參觀需求超過 24 小時尚未處理',
    )
    expect(notificationLabel('visit_request_overdue', { reason: 'other' })).toBe('案件逾期未處理')
    expect(notificationLabel('visit_upcoming', null)).toBe('即將參觀（24 小時內）')
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
