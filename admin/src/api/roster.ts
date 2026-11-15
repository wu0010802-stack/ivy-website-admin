// 招生入學「編班與缺額」API（/admin/admissions/roster/*，2026-11-15）。型別取自契約產生檔。
// 下學年的年級目標沿用計畫名額（grade_intake_targets）的 PUT /admin/admissions/intake-targets。
import type { components } from '../../../contracts/generated/website-api'
import { api } from './client'

export type Roster = components['schemas']['RosterOut']
export type RosterClass = components['schemas']['ClassOut']
export type RosterClassWithStudents = components['schemas']['ClassWithStudentsOut']
export type RosterStudent = components['schemas']['StudentOut']
export type StudentsCreated = components['schemas']['StudentsCreated']
export type GapBlock = components['schemas']['GapBlockOut']
export type Tier = components['schemas']['TierOut']
export type RosterSnapshot = components['schemas']['SnapshotOut']
export type ClassCreate = components['schemas']['ClassCreate']
export type ClassUpdate = components['schemas']['ClassUpdate']
export type StudentsCreate = components['schemas']['StudentsCreate']
export type StudentUpdate = components['schemas']['StudentUpdate']
export type StudentMove = components['schemas']['StudentMove']
export type TierTargetsRequest = components['schemas']['TierTargetsRequest']

const ROOT = '/admin/admissions/roster'

type QueryValue = string | number | null | undefined

function toQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

/** 整張編班表、預繳名單與缺額統計；asOf 沒給＝今天。名單永遠是現在的狀態，只有統計數字跟著 asOf 回算。 */
export function getRoster(campusKey: string, schoolYear: number, asOf?: string | null): Promise<Roster> {
  return api.get<Roster>(`${ROOT}?${toQuery({ campus_key: campusKey, school_year: schoolYear, as_of: asOf })}`)
}

export function createClass(campusKey: string, body: ClassCreate): Promise<RosterClass> {
  return api.post<RosterClass>(`${ROOT}/classes?${toQuery({ campus_key: campusKey })}`, body)
}

export function updateClass(id: string, body: ClassUpdate): Promise<RosterClass> {
  return api.patch<RosterClass>(`${ROOT}/classes/${id}`, body)
}

export function deleteClass(id: string, expectedVersion: number): Promise<void> {
  return api.delete<void>(`${ROOT}/classes/${id}?${toQuery({ expected_version: expectedVersion })}`)
}

export function createStudents(campusKey: string, body: StudentsCreate): Promise<StudentsCreated> {
  return api.post<StudentsCreated>(`${ROOT}/students?${toQuery({ campus_key: campusKey })}`, body)
}

export function updateStudent(id: string, body: StudentUpdate): Promise<RosterStudent> {
  return api.patch<RosterStudent>(`${ROOT}/students/${id}`, body)
}

export function moveStudent(id: string, body: StudentMove): Promise<RosterStudent> {
  return api.post<RosterStudent>(`${ROOT}/students/${id}/move`, body)
}

/** 已入園：日期沒給＝今天（後端決定）。 */
export function enterStudent(id: string, expectedVersion: number, enrollmentDate: string | null = null): Promise<RosterStudent> {
  return api.post<RosterStudent>(`${ROOT}/students/${id}/enter`, { expected_version: expectedVersion, enrollment_date: enrollmentDate })
}

export function leaveStudent(id: string, expectedVersion: number, leftDate: string | null = null): Promise<RosterStudent> {
  return api.post<RosterStudent>(`${ROOT}/students/${id}/leave`, { expected_version: expectedVersion, left_date: leftDate })
}

export function refundStudent(id: string, expectedVersion: number, refundedDate: string | null = null): Promise<RosterStudent> {
  return api.post<RosterStudent>(`${ROOT}/students/${id}/refund`, { expected_version: expectedVersion, refunded_date: refundedDate })
}

/** 已退預繳的恢復成還沒編班（classId 忽略）；已離園的恢復成在籍，要給班級。 */
export function restoreStudent(id: string, expectedVersion: number, classId: string | null = null): Promise<RosterStudent> {
  return api.post<RosterStudent>(`${ROOT}/students/${id}/restore`, { expected_version: expectedVersion, class_id: classId })
}

export function saveTierTargets(campusKey: string, body: TierTargetsRequest): Promise<Tier> {
  return api.put<Tier>(`${ROOT}/tier-targets?${toQuery({ campus_key: campusKey })}`, body)
}

export function createSnapshot(
  campusKey: string,
  body: { school_year: number; as_of: string; overwrite?: boolean },
): Promise<RosterSnapshot> {
  return api.post<RosterSnapshot>(`${ROOT}/snapshots?${toQuery({ campus_key: campusKey })}`, { overwrite: false, ...body })
}

/** 「(Y+1)(上)」的年級目標：沿用計畫名額，固定寫 (Y+1, 上學期)；值是 null＝回到未設定，沒送的年級不動。 */
export function saveNextYearTargets(campusKey: string, schoolYear: number, targets: Record<string, number | null>): Promise<unknown> {
  return api.put<unknown>(`/admin/admissions/intake-targets?${toQuery({ campus_key: campusKey })}`, {
    school_year: schoolYear + 1,
    semester: 1,
    targets,
  })
}
