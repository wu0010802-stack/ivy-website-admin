// 後端每新增一種通知 kind、稽核動作或稽核對象，後台都要有中文標籤，否則
// 站內通知與操作紀錄頁會直接顯示英文代碼。這裡直接讀後端原始碼比對，不靠
// 人記得同步：新增 log_action 或 outbox kind 忘了補 labels.ts，這個測試就會失敗。
import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_HIDDEN_METADATA_KEYS,
  AUDIT_METADATA_KEYS,
  AUDIT_TARGET_LABELS,
  auditChangeSummary,
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

// ---- 操作紀錄「細節」：後端 log_action 的每個 metadata 鍵都要有中文寫法或刻意不顯示 ----
// 只看 metadata 字面值的第一層鍵與 ** 展開；巢狀的物件（例如時段 {date,start,end}、
// 還原的內容清單）由上一層的鍵整個翻譯。metadata 改成別的寫法（新的輔助函式、
// 變數）時直接報錯，不讓比對悄悄失效。

// 從 text[start]（左括號）找到對應的右括號，跳過字串內容。
function balancedEnd(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"' || ch === "'") {
      i = text.indexOf(ch, i + 1)
      if (i === -1) return text.length - 1
      continue
    }
    if ('({['.includes(ch)) depth++
    else if (')}]'.includes(ch) && --depth === 0) return i
  }
  return text.length - 1
}

// 從 index 開始、到第一層的逗號或右括號為止的運算式（kwarg 的值）：回傳結束位置。
function expressionEnd(text: string, index: number): number {
  let i = index
  for (; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"' || ch === "'") { i = text.indexOf(ch, i + 1); continue }
    if ('({['.includes(ch)) { i = balancedEnd(text, i); continue }
    if (ch === ',' || ch === ')' || ch === '}' || ch === ']') break
  }
  return i
}

function expressionAt(text: string, index: number): string {
  return text.slice(index, expressionEnd(text, index)).trim()
}

// `{...}` 字面值第一層的 "key": 與 **展開。
function dictEntries(literal: string): { keys: string[]; spreads: string[] } {
  const keys: string[] = []
  const spreads: string[] = []
  for (let i = 1; i < literal.length - 1; i++) {
    const ch = literal[i]!
    if (ch === '"' || ch === "'") {
      const end = literal.indexOf(ch, i + 1)
      if (/^\s*:/.test(literal.slice(end + 1))) keys.push(literal.slice(i + 1, end))
      i = end
      continue
    }
    if ('({['.includes(ch)) { i = balancedEnd(literal, i); continue }
    if (literal.startsWith('**', i)) {
      const end = expressionEnd(literal, i + 2)
      spreads.push(literal.slice(i + 2, end).trim())
      i = end - 1
    }
  }
  return { keys, spreads }
}

function functionBody(text: string, signature: string): string {
  const start = text.indexOf(signature)
  if (start === -1) throw new Error(`找不到 ${signature}`)
  const rest = text.slice(start + signature.length)
  const end = rest.search(/\n(?:\s*(?:async\s+)?def |@|class )/)
  return end === -1 ? rest : rest.slice(0, end)
}

// 函式裡 `return {…}` 或 `name = {…}` 的第一層鍵。
function returnedKeys(body: string, marker = /(?:return|applied =) \{/g): string[] {
  const keys: string[] = []
  for (const m of body.matchAll(marker)) {
    const open = m.index! + m[0].length - 1
    keys.push(...dictEntries(body.slice(open, balancedEnd(body, open) + 1)).keys)
  }
  return keys
}

// 呼叫端的 kwargs（_audit_transition(..., action="…", has_reason=…) 的 **extra）。
function transitionExtras(): string[] {
  const keys: string[] = []
  for (const call of logActionCalls().filter((c) => c.startsWith('_audit_transition('))) {
    for (const m of call.matchAll(/[(,]\s*([a-z_]+)=/g)) if (m[1] !== 'action') keys.push(m[1]!)
  }
  return keys
}

// 不是字面值的 metadata：各自對到產生它的函式。
const METADATA_HELPERS: [RegExp, () => string[]][] = [
  [/^_media_audit\(/, () => returnedKeys(functionBody(source('media/routes.py'), 'def _media_audit('))],
  [/^retention_service\.audit_metadata\(/, () => returnedKeys(functionBody(source('operations/retention_service.py'), 'def audit_metadata('))],
  [/^filters\.audit_metadata\(\)$/, () => returnedKeys(functionBody(source('booking/routes.py'), 'def audit_metadata('))],
  [/^result$/, () => [
    ...returnedKeys(functionBody(source('booking/schedule_service.py'), 'async def remove_exception(')),
    // generate_slots 回傳的是 _create_from_rules 的結果。
    ...returnedKeys(functionBody(source('booking/schedule_service.py'), 'async def _create_from_rules(')),
  ]],
  [/^metadata$/, () => {
    const body = functionBody(source('auth/routes.py'), 'async def update_user_role(')
    return [...returnedKeys(body, /metadata = \{/g), ...[...body.matchAll(/metadata\["([a-z_]+)"\]/g)].map((m) => m[1]!)]
  }],
  [/^extra$/, transitionExtras],
]

function metadataKeys(expr: string): string[] {
  if (expr.startsWith('{')) {
    const { keys, spreads } = dictEntries(expr)
    return [...keys, ...spreads.flatMap(metadataKeys)]
  }
  // 條件式展開：**({"follow_up_cleared": True} if … else {})
  if (expr.startsWith('(') && expr.includes('{')) {
    return [...expr.matchAll(/\{/g)].flatMap((m) => dictEntries(expr.slice(m.index!, balancedEnd(expr, m.index!) + 1)).keys)
  }
  const helper = METADATA_HELPERS.find(([pattern]) => pattern.test(expr))
  if (!helper) throw new Error(`新的 metadata 寫法「${expr}」：請在 labelCoverage 補上解析方式，並在 labels.ts 為它的鍵寫中文`)
  return helper[1]()
}

function backendMetadataKeys(): Set<string> {
  const keys = new Set<string>()
  for (const call of logActionCalls()) {
    const index = call.search(/\bmetadata=/)
    if (index === -1) continue
    for (const key of metadataKeys(expressionAt(call, index + 'metadata='.length))) keys.add(key)
  }
  return keys
}

describe('操作紀錄細節涵蓋後端所有 metadata 鍵', () => {
  it('解析得出字面值、輔助函式與狀態轉換的額外欄位', () => {
    expect(dictEntries('{"a": 1, "b": {"c": 2}, **extra}')).toEqual({ keys: ['a', 'b'], spreads: ['extra'] })
    const keys = backendMetadataKeys()
    expect(keys.size).toBeGreaterThan(50)
    // 字面值、巢狀在字面值裡的輔助函式、**展開與 _audit_transition 的額外欄位都要掃得到。
    for (const key of ['slot', 'from_status', 'to_status', 'row_count', 'has_search', 'size_bytes', 'trigger', 'run_id', 'has_reason', 'capabilities_removed', 'skipped_exception_days']) {
      expect(keys, key).toContain(key)
    }
    expect(() => metadataKeys('some_new_helper(x)')).toThrow('新的 metadata 寫法')
  })

  it('每個鍵都有中文寫法，或列在刻意不顯示的識別碼裡', () => {
    const keys = backendMetadataKeys()
    expect([...keys].filter((key) => !AUDIT_METADATA_KEYS.has(key) && !AUDIT_HIDDEN_METADATA_KEYS.has(key))).toEqual([])
    // 同一個鍵不會同時要顯示又要藏。
    expect([...AUDIT_HIDDEN_METADATA_KEYS].filter((key) => AUDIT_METADATA_KEYS.has(key))).toEqual([])
  })

  it('修改前後（before／after）裡的欄位都有中文名', () => {
    const fields = new Set<string>()
    for (const text of Object.values(backendSources)) {
      if (!text.includes('log_action(')) continue
      for (const m of text.matchAll(/\b(?:before|after) = \{/g)) {
        const open = m.index! + m[0].length - 1
        const { keys, spreads } = dictEntries(text.slice(open, balancedEnd(text, open) + 1))
        keys.forEach((key) => fields.add(key))
        for (const spread of spreads) {
          if (!spread.startsWith('retention_service.policy_days(')) throw new Error(`before／after 新的展開寫法：${spread}`)
          returnedKeys(functionBody(source('operations/retention_service.py'), 'def policy_days(')).forEach((key) => fields.add(key))
        }
      }
    }
    // 預約設定的修改前後是 CONFIG_AUDIT_FIELDS 的快照。
    const service = source('booking/service.py')
    const tuple = service.slice(service.indexOf('CONFIG_AUDIT_FIELDS = ('), service.indexOf(')', service.indexOf('CONFIG_AUDIT_FIELDS = (')))
    ;[...tuple.matchAll(/"([a-z_]+)"/g)].forEach((m) => fields.add(m[1]!))
    for (const key of ['capacity', 'closed', 'cancelled_days', 'auto_run_enabled', 'min_lead_hours', 'mode', 'role']) expect(fields, key).toContain(key)
    const raw = [...fields].filter((field) => auditChangeSummary({ before: { [field]: 1 }, after: { [field]: 2 } }).startsWith(`${field}：`))
    expect(raw).toEqual([])
  })
})
