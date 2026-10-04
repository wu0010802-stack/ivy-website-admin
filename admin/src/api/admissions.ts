// 招生入學 API（/admin/admissions/*）。型別取自契約產生檔（api/types.ts 的別名）。
// 統計：getStats（C3）、getNoDepositRecords（C3b）、getCompare（C4）。「已到場／未到場」沿用預約既有的
// /admin/visit-requests/{id}/complete、/no-show，不在這裡另包。
import { api } from './client'
import type {
  AdmissionsCompare, AdmissionsOptions, AdmissionsStaff, AdmissionsStats, Arrivals, ContactLog, ContactLogCreate, ContactLogResult, FollowUpList,
  FollowUpUpdate, FunnelBoard, IntakePlan, IntakeTargetsRequest, NoDepositRecords, RecruitmentEvent, RecruitmentVisit,
  RecruitmentVisitCreate, RecruitmentVisitUpdate, SeatRequest, SeatResult, TransitionRequest,
} from './types'
import type { Stage } from '../admissions/constants'

/** 訪視明細的篩選（後端 RecruitmentVisitFilters）。空字串與 null 不送。 */
export type RecordFilters = {
  campus_key: string
  month?: string | null
  grade?: string | null
  target_school_year?: number | null
  target_semester?: number | null
  source?: string | null
  referrer?: string | null
  has_deposit?: boolean | null
  no_deposit_reason?: string | null
  stage?: string | null
  visit_request_id?: string | null
  q?: string | null
  // 參觀後追蹤（2026-10-04）：due 已到期、upcoming 7 天內、unscheduled 未排定；負責人 me／none／帳號 id。
  follow_up?: FollowUpScope | null
  owner?: string | null
}

export type FollowUpScope = 'due' | 'upcoming' | 'unscheduled'

type QueryValue = string | number | boolean | null | undefined

function toQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

export function listRecords(params: RecordFilters & { page: number; page_size: number }): Promise<RecruitmentVisit[]> {
  return api.get<RecruitmentVisit[]>(`/admin/admissions/records?${toQuery(params)}`)
}

export function createRecord(campusKey: string, body: RecruitmentVisitCreate): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/records?${toQuery({ campus_key: campusKey })}`, body)
}

export function getRecord(id: string): Promise<RecruitmentVisit> {
  return api.get<RecruitmentVisit>(`/admin/admissions/records/${id}`)
}

export function updateRecord(id: string, body: RecruitmentVisitUpdate): Promise<RecruitmentVisit> {
  return api.patch<RecruitmentVisit>(`/admin/admissions/records/${id}`, body)
}

export function deleteRecord(id: string, expectedVersion: number): Promise<void> {
  return api.delete<void>(`/admin/admissions/records/${id}?${toQuery({ expected_version: expectedVersion })}`)
}

export function listEvents(id: string): Promise<RecruitmentEvent[]> {
  return api.get<RecruitmentEvent[]>(`/admin/admissions/records/${id}/events`)
}

export function transition(id: string, body: TransitionRequest): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/records/${id}/transition`, body)
}

type TransitionFields = Omit<TransitionRequest, 'to_stage' | 'expected_version'>

/** 轉換請求一律送齊欄位，沒用到的是 null（後端各轉換只讀自己需要的欄位）。 */
export function transitionRequest(toStage: Stage, expectedVersion: number, fields: Partial<TransitionFields> = {}): TransitionRequest {
  return {
    to_stage: toStage,
    expected_version: expectedVersion,
    reason: null,
    deposit_collector: null,
    enrolled_on: null,
    grade: null,
    target_school_year: null,
    target_semester: null,
    ...fields,
  }
}

export function setSeat(id: string, body: SeatRequest): Promise<SeatResult> {
  return api.post<SeatResult>(`/admin/admissions/records/${id}/seat`, body)
}

export function getBoard(campusKey: string, schoolYear: number, semester: number | null): Promise<FunnelBoard> {
  return api.get<FunnelBoard>(`/admin/admissions/board?${toQuery({ campus_key: campusKey, school_year: schoolYear, semester })}`)
}

export function getIntakePlan(campusKey: string, schoolYear: number, semester: number): Promise<IntakePlan> {
  return api.get<IntakePlan>(`/admin/admissions/intake-plan?${toQuery({ campus_key: campusKey, school_year: schoolYear, semester })}`)
}

export function saveIntakeTargets(campusKey: string, body: IntakeTargetsRequest): Promise<IntakePlan> {
  return api.put<IntakePlan>(`/admin/admissions/intake-targets?${toQuery({ campus_key: campusKey })}`, body)
}

export function getArrivals(campusKey: string): Promise<Arrivals> {
  return api.get<Arrivals>(`/admin/admissions/arrivals?${toQuery({ campus_key: campusKey })}`)
}

export function createFromVisitRequest(visitRequestId: string): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/from-visit-request/${visitRequestId}`)
}

export function getOptions(campusKey: string): Promise<AdmissionsOptions> {
  return api.get<AdmissionsOptions>(`/admin/admissions/options?${toQuery({ campus_key: campusKey })}`)
}

/** 統計分析（規格第 9 節）。school_year／semester 為 null＝不篩；reference_month 為 null＝最新有資料的月份。 */
export function getStats(params: {
  campus_key: string
  school_year: number | null
  semester: number | null
  reference_month: string | null
}): Promise<AdmissionsStats> {
  return api.get<AdmissionsStats>(`/admin/admissions/stats?${toQuery(params)}`)
}

/** 未預繳明細（園務 /no-deposit-analysis）。priority 為 null＝全部潛力；overdue_days、cold_only 為 null＝不限。 */
export function getNoDepositRecords(params: {
  campus_key: string
  school_year: number | null
  semester: number | null
  reason: string | null
  grade: string | null
  priority: 'high' | 'medium' | 'low' | null
  overdue_days: number | null
  cold_only: boolean | null
  page: number
  page_size: number
}): Promise<NoDepositRecords> {
  return api.get<NoDepositRecords>(`/admin/admissions/no-deposit-records?${toQuery(params)}`)
}

/** 五校比較（規格 9.3）：後端只回授權範圍內的校區；學年學期必填（名額剩餘要對到單一學期）。 */
export function getCompare(schoolYear: number, semester?: number | null): Promise<AdmissionsCompare> {
  return api.get<AdmissionsCompare>(`/admin/admissions/compare?${toQuery({ school_year: schoolYear, semester })}`)
}

// ---- 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 9 節）----

/** 待追蹤分頁。不吃入學學年學期；totals 是全校區三種的數量，不受負責人篩選影響。 */
export function getFollowUps(params: {
  campus_key: string
  scope: FollowUpScope
  owner: string | null
  page: number
  page_size: number
}): Promise<FollowUpList> {
  return api.get<FollowUpList>(`/admin/admissions/follow-ups?${toQuery(params)}`)
}

/** 可以當這個校區追蹤負責人的帳號（啟用中、有招生寫入權限、涵蓋該校區）。 */
export function listAdmissionsStaff(campusKey: string): Promise<AdmissionsStaff[]> {
  return api.get<AdmissionsStaff[]>(`/admin/admissions/staff?${toQuery({ campus_key: campusKey })}`)
}

/** 參觀後的聯絡紀錄，新到舊。 */
export function listContactLogs(id: string): Promise<ContactLog[]> {
  return api.get<ContactLog[]>(`/admin/admissions/records/${id}/contact-logs`)
}

/** 記錄一次聯絡；next_follow_up_at 必送（時間或 null＝不用再追）。回傳新紀錄與更新後的訪視。 */
export function createContactLog(id: string, body: ContactLogCreate): Promise<ContactLogResult> {
  return api.post<ContactLogResult>(`/admin/admissions/records/${id}/contact-logs`, body)
}

/** 只改下次聯絡或負責人：沒帶的鍵不動，帶 null＝清除。 */
export function updateFollowUp(id: string, body: FollowUpUpdate): Promise<RecruitmentVisit> {
  return api.patch<RecruitmentVisit>(`/admin/admissions/records/${id}/follow-up`, body)
}
