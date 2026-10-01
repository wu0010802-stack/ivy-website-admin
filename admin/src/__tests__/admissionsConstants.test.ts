import { describe, expect, it } from 'vitest'
import {
  EVENT_LABELS, GRADES, NO_DEPOSIT_REASONS, STAGES, STAGE_LABELS, STAGE_TOKENS, canDragFrom, eventLabel, moveTargets,
  stageLabel, ANONYMIZED_CONFLICT_TEXT, MISSING_CHILD_NAME, transitionBlockedText, transitionCapability, transitionMode, transitionWarning, type Stage,
} from '../admissions/constants'

// 後端列舉值的唯一來源是 backend/app/admissions/constants.py（A1）；前端的文案表要對得上。
// vitest.config.ts 已放行 ../backend/app 的 ?raw 讀取（labelCoverage 同一招）。
const backend = import.meta.glob('../../../backend/app/admissions/constants.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = Object.values(backend)[0] ?? ''

function tuple(name: string): string[] {
  const start = source.indexOf(`${name}:`)
  expect(start, `constants.py 找不到 ${name}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('(', start)
  const close = source.indexOf(')', open)
  return [...source.slice(open, close).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
}

describe('與後端 constants.py 對齊', () => {
  it('年級、階段、未預繳原因逐字相同', () => {
    expect([...GRADES]).toEqual(tuple('GRADES'))
    expect([...STAGES]).toEqual(tuple('STAGES'))
    expect([...NO_DEPOSIT_REASONS]).toEqual(tuple('NO_DEPOSIT_REASONS'))
  })

  it('每一種事件都有中文，歷程不會露英文代碼', () => {
    const types = tuple('EVENT_TYPES')
    expect(types).toContain('seat_reserved')
    expect(types.filter((type) => !EVENT_LABELS[type])).toEqual([])
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

describe('狀態轉換（規格 6.3）', () => {
  const ALLOWED: [Stage, Stage, string][] = [
    ['visited', 'deposited', 'admissions.write'], ['deposited', 'visited', 'admissions.write'],
    ['deposited', 'enrolled', 'admissions.convert'], ['enrolled', 'deposited', 'admissions.convert'],
    ['enrolled', 'visited', 'admissions.convert'], ['deposited', 'withdrawn', 'admissions.write'],
    ['enrolled', 'withdrawn', 'admissions.convert'], ['withdrawn', 'visited', 'admissions.write'],
    ['withdrawn', 'deposited', 'admissions.write'],
  ]
  const BLOCKED: [Stage, Stage][] = [['visited', 'enrolled'], ['visited', 'withdrawn'], ['withdrawn', 'enrolled']]

  it('權限對照同後端 transition_capability；不允許的三種回 null 並說明原因', () => {
    for (const [from, to, capability] of ALLOWED) expect(transitionCapability(from, to), `${from}→${to}`).toBe(capability)
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
