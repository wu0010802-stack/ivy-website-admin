import type { RecruitmentVisit } from '../../api/types'
import type { Stage } from '../../admissions/constants'

// 訪視明細每一列的動作（2026-10-20 從 RecordsTab.vue 抽出，行為不變）：依階段的主要動作與「更多」選單。

export type MoreCommand = 'edit' | 'seat' | 'withdraw' | 'delete'
export interface StageAction { label: string; from: Stage; to: Stage }
export interface RowPermissions { canWrite: boolean; canConvert: boolean }

// 依階段的主要動作：已訪視 → 標記預繳（admissions.write）、已預繳 → 標記註冊（admissions.convert，
// 園務「轉為學生」的位置）。已匿名化的列不能再變更。
export function stageAction(row: RecruitmentVisit, perms: RowPermissions): StageAction | null {
  if (row.anonymized_at) return null
  if (row.stage === 'visited' && perms.canWrite) return { label: '標記預繳', from: 'visited', to: 'deposited' }
  if (row.stage === 'deposited' && perms.canConvert) return { label: '標記註冊', from: 'deposited', to: 'enrolled' }
  return null
}

function needsConvert(row: RecruitmentVisit): boolean {
  return row.stage === 'enrolled' || (row.stage === 'withdrawn' && row.withdrawn_from === 'enrolled')
}

export function moreCommands(row: RecruitmentVisit, perms: RowPermissions): { command: MoreCommand; label: string }[] {
  const { canWrite, canConvert } = perms
  const items: { command: MoreCommand; label: string }[] = []
  // 已匿名化的列不能再變更（編輯、退出）；刪除與歷程照常。
  if (!row.anonymized_at) {
    if (canWrite) items.push({ command: 'edit', label: '編輯' })
    // 保留座位只給已預繳、未註冊、未退出（規格 6.5）；已註冊不能清除保留，要改年級請先取消註冊。
    if (row.stage === 'deposited' && canWrite) items.push({ command: 'seat', label: row.provisional_grade ? '變更座位' : '保留座位' })
    // 退預繳要 write、退註冊要 convert（規格 6.3）；已訪視沒有可退的款項（園務 :610）。
    if (row.stage === 'deposited' && canWrite) items.push({ command: 'withdraw', label: '退預繳' })
    if (row.stage === 'enrolled' && canConvert) items.push({ command: 'withdraw', label: '退註冊' })
  }
  // 官網沒有學生檔，刪除已註冊或從已註冊退出的訪視等於退註冊，要 admissions.convert（後端 403，調整第 34 條）。
  if (canWrite && (!needsConvert(row) || canConvert)) items.push({ command: 'delete', label: '刪除' })
  return items
}
