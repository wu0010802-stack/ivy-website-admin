/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EVENT_LABELS, GRADES, NO_DEPOSIT_REASONS, STAGES, STAGE_LABELS, STAGE_TOKENS, WITHDRAW_REASON_CATEGORIES, canDragFrom, eventLabel, moveTargets,
  stageLabel, ANONYMIZED_CONFLICT_TEXT, MISSING_CHILD_NAME, isWithdrawFilter, transitionBlockedText, transitionCapability, transitionMode,
  transitionWarning, withdrawFilterLabel, withdrawReasonText, UNCLASSIFIED_LABEL, UNCLASSIFIED_WITHDRAW, type Stage,
} from '../admissions/constants'

// 後端列舉值的唯一來源是 backend/app/admissions/constants.py（A1）；前端的文案表要對得上。
// vitest.config.ts 已放行 ../backend/app 的 ?raw 讀取（labelCoverage 同一招）。
const backend = import.meta.glob('../../../backend/app/admissions/constants.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = Object.values(backend)[0] ?? ''
// 統計表「未分類」列名在 stats.py（UNCLASSIFIED_REASON），篩選值在 constants.py（WITHDRAW_UNCLASSIFIED）。
const backendStats = import.meta.glob('../../../backend/app/admissions/stats.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const statsSource = Object.values(backendStats)[0] ?? ''

function tuple(name: string): string[] {
  const start = source.indexOf(`${name}:`)
  expect(start, `constants.py 找不到 ${name}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('(', start)
  const close = source.indexOf(')', open)
  return [...source.slice(open, close).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
}

describe('與後端 constants.py 對齊', () => {
  it('年級、階段、未預繳原因、退出原因分類逐字相同', () => {
    expect([...GRADES]).toEqual(tuple('GRADES'))
    expect([...STAGES]).toEqual(tuple('STAGES'))
    expect([...NO_DEPOSIT_REASONS]).toEqual(tuple('NO_DEPOSIT_REASONS'))
    expect([...WITHDRAW_REASON_CATEGORIES]).toEqual(tuple('WITHDRAW_REASON_CATEGORIES'))
  })

  it('每一種事件都有中文，歷程不會露英文代碼', () => {
    const types = tuple('EVENT_TYPES')
    expect(types).toContain('seat_reserved')
    expect(types.filter((type) => !EVENT_LABELS[type])).toEqual([])
  })

  it('官網專用的歷程事件（2026-10-15）有中文，預約同步的另標來源；查不到的顯示原字串', () => {
    expect(EVENT_LABELS.details_updated).toBe('修改招生資料')
    expect(EVENT_LABELS.follow_up_updated).toBe('排下次聯絡')
    expect(eventLabel('details_updated', { fields: ['phone'] })).toBe('修改招生資料')
    expect(eventLabel('details_updated', { fields: ['phone'], origin: 'visit_request_sync' })).toBe('修改招生資料（從預約同步）')
    expect(eventLabel('created', { origin: 'manual' })).toBe('建立訪視（手動新增）')
    expect(eventLabel('something_new', null)).toBe('something_new')
  })

  it('來源只標在自己的事件上：建立訪視不吃預約同步，排下次聯絡也不標', () => {
    expect(eventLabel('created', { origin: 'visit_request_sync' })).toBe('建立訪視')
    expect(eventLabel('details_updated', { origin: 'manual' })).toBe('修改招生資料')
    expect(eventLabel('follow_up_updated', { origin: 'visit_request_sync' })).toBe('排下次聯絡')
    expect(eventLabel('details_updated', { origin: 'visit_request_sync' })).toBe('修改招生資料（從預約同步）')
  })
})

describe('退出原因分類（2026-10-15）', () => {
  it('顯示文字：分類（說明）；沒有說明只寫分類；舊資料只有說明就寫說明；都沒有是空字串', () => {
    expect(withdrawReasonText({ withdraw_reason_category: '費用考量', withdraw_reason: '學費比預期高' })).toBe('費用考量（學費比預期高）')
    expect(withdrawReasonText({ withdraw_reason_category: '費用考量', withdraw_reason: null })).toBe('費用考量')
    expect(withdrawReasonText({ withdraw_reason_category: null, withdraw_reason: '改送他校' })).toBe('改送他校')
    expect(withdrawReasonText({})).toBe('')
  })

  it('篩選值：八項與 unclassified 才算數；未分類有說明', () => {
    expect(isWithdrawFilter('費用考量')).toBe(true)
    expect(isWithdrawFilter('unclassified')).toBe(true)
    expect(isWithdrawFilter('其他')).toBe(false)
    expect(withdrawFilterLabel('unclassified')).toBe('未分類（改版前退出）')
    expect(withdrawFilterLabel('費用考量')).toBe('費用考量')
  })

  it('未分類：篩選值與後端 WITHDRAW_UNCLASSIFIED、統計列名與 stats.py 的 UNCLASSIFIED_REASON 逐字相同', () => {
    expect(/^WITHDRAW_UNCLASSIFIED\s*=\s*"([^"]+)"/m.exec(source)?.[1]).toBe(UNCLASSIFIED_WITHDRAW)
    expect(/^UNCLASSIFIED_REASON\s*=\s*"([^"]+)"/m.exec(statsSource)?.[1]).toBe(UNCLASSIFIED_LABEL)
  })
})

describe('已匿名化與待補姓名（R4、R10）', () => {
  it('待補姓名與後端 MISSING_CHILD_NAME 逐字相同', () => {
    expect(/MISSING_CHILD_NAME\s*=\s*"([^"]+)"/.exec(source)?.[1]).toBe(MISSING_CHILD_NAME)
  })

  it('匿名化 409 提示用調整 31 原文', () => {
    expect(ANONYMIZED_CONFLICT_TEXT).toBe('這筆招生訪視已依保存政策匿名化，不能再變更')
  })
})

describe('階段與事件文案（照園務，官網沒有學生檔的改寫）', () => {
  it('四欄標題與顏色 token', () => {
    expect(STAGES.map((stage) => STAGE_LABELS[stage])).toEqual(['已訪視', '已預繳', '已註冊', '退預繳／退註冊'])
    for (const stage of STAGES) expect(STAGE_TOKENS[stage]).toMatch(/^--/)
    expect(stageLabel(null)).toBe('—')
    expect(stageLabel('mystery')).toBe('mystery')
  })

  it('事件：補上園務缺的保留座位；建立訪視寫出來源', () => {
    expect(eventLabel('seat_reserved')).toBe('保留座位')
    expect(eventLabel('seat_released')).toBe('釋放保留')
    expect(eventLabel('created', { origin: 'visit_request' })).toBe('建立訪視（官網預約到場）')
    expect(eventLabel('created', { origin: 'manual' })).toBe('建立訪視（手動新增）')
    expect(eventLabel('created', null)).toBe('建立訪視')
    expect(eventLabel('converted')).toBe('標記註冊')
    expect(eventLabel('unknown_event')).toBe('unknown_event')
  })
})

// 後端唯一來源 funnel.py 的 _CAPABILITY：直接讀原始碼，前端表漂移就會紅燈。
const funnelSource = readFileSync(resolve(__dirname, '../../../backend/app/admissions/funnel.py'), 'utf8')
const capabilityBlock = /_CAPABILITY\s*:[^=]*=\s*\{([^}]*)\}/.exec(funnelSource)?.[1] ?? ''
const BACKEND_CAPABILITY = [...capabilityBlock.matchAll(/\(\s*"(\w+)"\s*,\s*"(\w+)"\s*\)\s*:\s*"([\w.]+)"/g)].map((m) => [m[1], m[2], m[3]] as [Stage, Stage, string])

describe('狀態轉換（規格 6.3）', () => {
  it('讀得到後端權限表（防正規式失效變成空測）', () => {
    expect(BACKEND_CAPABILITY.length).toBeGreaterThan(0)
  })

  const BLOCKED: [Stage, Stage][] = [['visited', 'enrolled'], ['visited', 'withdrawn'], ['withdrawn', 'enrolled']]

  it('權限對照同後端 transition_capability；不允許的三種回 null 並說明原因', () => {
    for (const [from, to, capability] of BACKEND_CAPABILITY) expect(transitionCapability(from, to), `${from}→${to}`).toBe(capability)
    const listed = new Set(BACKEND_CAPABILITY.map(([from, to]) => `${from}>${to}`))
    for (const from of STAGES) for (const to of STAGES) if (!listed.has(`${from}>${to}`)) expect(transitionCapability(from, to), `${from}→${to}`).toBeNull()
    for (const [from, to] of BLOCKED) {
      expect(transitionCapability(from, to)).toBeNull()
      expect(transitionBlockedText(from, to)).not.toBe('')
    }
    expect(transitionBlockedText('visited', 'withdrawn')).toBe('已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」')
    expect(transitionCapability('visited', 'visited')).toBeNull()
  })

  it('確認框模式：預繳記收預繳人員、註冊填日期年級學期、退出與從已註冊往回要原因、其他只確認', () => {
    expect(transitionMode('visited', 'deposited')).toBe('deposit')
    expect(transitionMode('deposited', 'enrolled')).toBe('enroll')
    expect(transitionMode('deposited', 'withdrawn')).toBe('destructive')
    expect(transitionMode('enrolled', 'deposited')).toBe('destructive')
    expect(transitionMode('enrolled', 'visited')).toBe('destructive')
    expect(transitionMode('withdrawn', 'visited')).toBe('confirm')
    expect(transitionMode('deposited', 'visited')).toBe('confirm')
  })

  it('警示文字（園務 warningText 的順序；學生檔與學費管理改成官網的說法）', () => {
    expect(transitionWarning('enrolled', 'withdrawn')).toBe('將標記退註冊，註冊日期會清除，招生紀錄保留')
    expect(transitionWarning('deposited', 'withdrawn')).toBe('將標記退預繳。若已實際收款，退款要另外處理')
    expect(transitionWarning('enrolled', 'visited')).toBe('將取消註冊並取消預繳，註冊日期會清除')
    expect(transitionWarning('enrolled', 'deposited')).toBe('將取消註冊，註冊日期會清除')
    expect(transitionWarning('withdrawn', 'deposited')).toBe('將取消這筆退預繳／退註冊的標記，卡片回到前一個階段')
    expect(transitionWarning('deposited', 'visited')).toBe('將取消預繳標記，卡片退回「已訪視」')
    expect(transitionWarning('visited', 'deposited')).toBe('')
  })

  it('拖曳權限看卡片原本的欄；「移到…」只列有權限、允許的目的欄', () => {
    const receptionCan = (capability: string) => ['admissions.read', 'admissions.write'].includes(capability)
    const viewerCan = (capability: string) => capability === 'admissions.read'
    const adminCan = () => true
    expect(canDragFrom('visited', receptionCan)).toBe(true)
    expect(canDragFrom('enrolled', receptionCan)).toBe(false)
    expect(canDragFrom('withdrawn', receptionCan)).toBe(true)
    expect(canDragFrom('visited', viewerCan)).toBe(false)
    expect(moveTargets('deposited', receptionCan)).toEqual(['visited', 'withdrawn'])
    expect(moveTargets('deposited', adminCan)).toEqual(['visited', 'enrolled', 'withdrawn'])
    expect(moveTargets('enrolled', receptionCan)).toEqual([])
    expect(moveTargets('visited', adminCan)).toEqual(['deposited'])
    expect(moveTargets('withdrawn', receptionCan)).toEqual(['visited', 'deposited'])
  })
})
