// 招生入學的文案與規則（比照園務 constants/recruitmentFunnel.ts、recruitment.ts）。
// 列舉值以後端 backend/app/admissions/constants.py 為準，admissionsConstants.test.ts 逐字比對。
import { RECRUITMENT_STAGE_LABELS, type StatusMeta, type TagTone } from '../api/labels'

export const GRADES = ['幼幼班', '小班', '中班', '大班'] as const
export type Grade = (typeof GRADES)[number]

export const STAGES = ['visited', 'deposited', 'enrolled', 'withdrawn'] as const
export type Stage = (typeof STAGES)[number]

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

// 階段文案只維護一份：A3 在 labels.ts 匯出 RECRUITMENT_STAGE_LABELS（操作紀錄也用它）。
export const STAGE_LABELS: Record<Stage, string> = {
  visited: RECRUITMENT_STAGE_LABELS.visited!,
  deposited: RECRUITMENT_STAGE_LABELS.deposited!,
  enrolled: RECRUITMENT_STAGE_LABELS.enrolled!,
  withdrawn: RECRUITMENT_STAGE_LABELS.withdrawn!,
}

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—'
  return isStage(stage) ? STAGE_LABELS[stage] : stage
}

// 欄位顏色（園務：灰 → 橙 → 綠 → 藍）。只給 token 名稱，元件用 `var(...)` 套上，不寫色值。
export const STAGE_TOKENS: Record<Stage, string> = {
  visited: '--ink-3',
  deposited: '--el-color-warning',
  enrolled: '--el-color-success',
  withdrawn: '--admin-accent',
}

// 各欄空狀態（園務 FunnelColumn.vue:44-49 原文）。
export const STAGE_EMPTY_TEXT: Record<Stage, string> = {
  visited: '還沒有訪視紀錄，用右上角的「新增訪視」建立第一筆。',
  deposited: '家長完成預繳後，把「已訪視」的卡片拖到這一欄。',
  enrolled: '家長完成註冊後，把「已預繳」的卡片拖到這一欄。',
  withdrawn: '退預繳或退註冊的紀錄會落在這一欄。',
}

// 409 RECRUITMENT_VISIT_ANONYMIZED 的提示（各分頁共用）。
export const ANONYMIZED_CONFLICT_TEXT = '這筆招生訪視已依保存政策匿名化，不能再變更'

// 預約沒填孩子姓名時後端寫的姓名（constants.py MISSING_CHILD_NAME）；卡片與明細遇到時標「待補」。
export const MISSING_CHILD_NAME = '（未填姓名）'

export const WITHDRAWN_FROM_LABELS: Record<string, string> = { deposited: '退預繳', enrolled: '退註冊' }

// 招生階段的標籤（訪視明細「階段」欄、預約明細家庭版面頁首共用）：色系同看板欄（灰 → 橙 → 綠），
// 退出後 has_deposit 已清成 false，寫清楚從哪一段退的（園務總覽第 6 點）。
const STAGE_TONES: Record<Stage, TagTone> = { visited: 'info', deposited: 'warning', enrolled: 'success', withdrawn: 'danger' }

export function stageMeta(visit: { stage: string; withdrawn_at?: string | null; withdrawn_from?: string | null }): StatusMeta {
  if (visit.withdrawn_at || visit.stage === 'withdrawn') {
    return { label: `已${WITHDRAWN_FROM_LABELS[visit.withdrawn_from ?? 'deposited'] ?? '退預繳'}`, tone: 'danger' }
  }
  return { label: stageLabel(visit.stage), tone: isStage(visit.stage) ? STAGE_TONES[visit.stage] : 'info' }
}

export const SEMESTER_LABELS: Record<1 | 2, string> = { 1: '上學期', 2: '下學期' }

// 未預繳原因（園務 api/recruitment/shared.py:43-52，順序照抄）。
export const NO_DEPOSIT_REASONS = [
  '時程未到／仍在觀望', '已有其他就學選項／比較他校', '未註明／待追蹤', '距離／地點因素',
  '家庭照顧安排考量', '特殊需求／名額限制', '課程／環境仍在評估', '費用考量',
] as const

// 歷程事件（園務 FUNNEL_EVENT_LABELS）。官網沒有學生檔：converted／revert_converted
// 拿掉「轉學生／刪學生」；園務漏掉的 seat_reserved／seat_released 在這裡補上。
export const EVENT_LABELS: Record<string, string> = {
  created: '建立訪視',
  deposit_added: '加上預繳',
  deposit_removed: '取消預繳',
  converted: '標記註冊',
  revert_converted: '取消註冊',
  withdrawn: '退預繳／退註冊',
  withdraw_cancelled: '取消退費',
  seat_reserved: '保留座位',
  seat_released: '釋放保留',
}

const CREATED_ORIGIN_LABELS: Record<string, string> = { visit_request: '官網預約到場', manual: '手動新增' }

/** 查不到的事件顯示原字串（園務同樣做法），建立訪視依 metadata.origin 補來源。 */
export function eventLabel(eventType: string, metadata?: unknown): string {
  const label = EVENT_LABELS[eventType] ?? eventType
  if (eventType !== 'created' || !metadata || typeof metadata !== 'object') return label
  const origin = CREATED_ORIGIN_LABELS[String((metadata as { origin?: unknown }).origin)]
  return origin ? `${label}（${origin}）` : label
}

export type TransitionCapability = 'admissions.write' | 'admissions.convert'

// 規格 6.3（後端 funnel.transition_capability 同一張表）。沒列的＝不允許。
const TRANSITIONS: Partial<Record<`${Stage}>${Stage}`, TransitionCapability>> = {
  'visited>deposited': 'admissions.write',
  'deposited>visited': 'admissions.write',
  'deposited>enrolled': 'admissions.convert',
  'enrolled>deposited': 'admissions.convert',
  'enrolled>visited': 'admissions.convert',
  'deposited>withdrawn': 'admissions.write',
  'enrolled>withdrawn': 'admissions.convert',
  'withdrawn>visited': 'admissions.write',
  'withdrawn>deposited': 'admissions.write',
}

export function transitionCapability(from: Stage, to: Stage): TransitionCapability | null {
  return TRANSITIONS[`${from}>${to}`] ?? null
}

const BLOCKED_TEXT: Partial<Record<`${Stage}>${Stage}`, string>> = {
  // 園務 recruitment_funnel.py:610 原文。
  'visited>withdrawn': '已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」',
  'visited>enrolled': '請先把卡片移到「已預繳」，再標記註冊',
  'withdrawn>enrolled': '請先取消退出、回到「已預繳」，再標記註冊',
}

export function transitionBlockedText(from: Stage, to: Stage): string {
  return BLOCKED_TEXT[`${from}>${to}`] ?? '不支援這個轉換'
}

export type TransitionMode = 'deposit' | 'enroll' | 'destructive' | 'confirm'

// 園務 TransitionConfirmDialog 的模式；官網沒有班級，註冊改填註冊日期、年級、入學學年學期。
export function transitionMode(from: Stage, to: Stage): TransitionMode {
  if (from === 'visited' && to === 'deposited') return 'deposit'
  if (from === 'deposited' && to === 'enrolled') return 'enroll'
  if (to === 'withdrawn' || (from === 'enrolled' && STAGES.indexOf(to) < STAGES.indexOf(from))) return 'destructive'
  return 'confirm'
}

// 園務 warningText（順序照抄）；「刪除學生檔案」「學費管理」改成官網實際發生的事。
export function transitionWarning(from: Stage, to: Stage): string {
  if (to === 'withdrawn' && from === 'enrolled') return '將標記退註冊，註冊日期會清除，招生紀錄保留'
  if (to === 'withdrawn') return '將標記退預繳。若已實際收款，退款要另外處理'
  if (from === 'enrolled') return to === 'visited' ? '將取消註冊並取消預繳，註冊日期會清除' : '將取消註冊，註冊日期會清除'
  if (from === 'withdrawn') return '將取消這筆退預繳／退註冊的標記，卡片回到前一個階段'
  if (from === 'deposited' && to === 'visited') return '將取消預繳標記，卡片退回「已訪視」'
  return ''
}

type Can = (capability: string) => boolean

// 園務 FunnelBoard.vue:136-150：以卡片「原本所在的欄」決定能不能拖。官網沒有學生檔，
// 從已註冊拖出只要 admissions.convert（園務另要 STUDENTS_WRITE）。
export function canDragFrom(stage: Stage, can: Can): boolean {
  if (stage === 'enrolled') return can('admissions.convert')
  if (stage === 'withdrawn') return can('admissions.write')
  return can('admissions.write') || can('admissions.convert')
}

/** 卡片選單「移到…」的選項：允許、而且這個人有權限的目的欄。 */
export function moveTargets(from: Stage, can: Can): Stage[] {
  return STAGES.filter((to) => {
    const capability = transitionCapability(from, to)
    return capability !== null && can(capability)
  })
}

/** 確認框需要的卡片欄位：看板卡片（FunnelCard）與明細列（RecruitmentVisit）都符合。 */
export interface TransitionCard {
  id: string
  child_name: string
  grade?: string | null
  provisional_grade?: string | null
  target_school_year?: number | null
  target_semester?: number | null
  version: number
}

export interface TransitionTarget {
  card: TransitionCard
  from: Stage
  to: Stage
}
