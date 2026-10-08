// 案件頁首主動作的階段（2026-10-06 方向 C：頁首依階段只給一顆主鈕）。純函式，畫面在 VisitPrimaryAction。
export type CaseStage =
  | 'loading' // 已到場、還在查招生：先不畫（免得查完整頁跳成家庭版面）
  | 'readonly' // 沒有 booking.handle：只寫提示
  | 'attendance' // 預約正常、場次已開始：家長到了／沒來
  | 'upcoming' // 預約正常、還沒開始：沒有主鈕
  | 'family' // 家庭版面：填招生資料
  | 'admissions-retry' // 已到場、招生讀不到：重新載入
  | 'admissions-create' // 已到場、沒有招生訪視、能建立
  | 'admissions-ask' // 已到場、沒有招生訪視、不能建立
  | 'closed' // 其他結案：重新預約（另建新案）

export interface StageInput {
  status: string
  canHandle: boolean
  visitStarted: boolean
  familyPending: boolean
  isFamily: boolean
  canReadAdmissions: boolean
  canCreateAdmissions: boolean
  admissionsAvailable: 'yes' | 'no' | 'unknown'
  lookupFailed: boolean
}

export function caseStage(i: StageInput): CaseStage {
  if (i.familyPending) return 'loading'
  if (i.status === 'confirmed') {
    if (!i.canHandle) return 'readonly'
    if (i.visitStarted) return 'attendance'
    return 'upcoming'
  }
  // 招生的三種情況只看招生權限，不看 booking.handle（同改版前的「招生訪視」區塊）。
  if (i.status === 'completed') {
    if (i.isFamily) return 'family'
    if (i.canReadAdmissions && i.lookupFailed) return 'admissions-retry'
    if (i.canReadAdmissions && i.admissionsAvailable === 'yes') return i.canCreateAdmissions ? 'admissions-create' : 'admissions-ask'
  }
  return i.canHandle ? 'closed' : 'readonly'
}
