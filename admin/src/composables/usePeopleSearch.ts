import { computed, ref, watch, type Ref } from 'vue'
import { api } from '../api/client'
import { listRecords, type RecordFilters } from '../api/admissions'
import { campusLabel } from '../api/labels'
import { searchHeaders } from '../api/searchHeader'
import type { RecruitmentVisit, VisitRequestDetailOut } from '../api/types'
import { searchTerm } from '../api/visitListQuery'
import { useDebouncedFn } from './useDebouncedFn'

// 側欄搜尋順便找人（2026-11-27）：打家長或孩子的姓名、電話，直接列出參觀案件與招生紀錄，
// 點了就到那一筆。搜尋字和兩個列表一樣放 X-Ivy-Search header、不進網址；結果只留在記憶體。
// 權限沿用兩個列表的 API：看不到的校區後端本來就不回。

export interface PersonHit {
  key: string
  kind: 'visit' | 'record'
  /** 第一行：家長・孩子 */
  title: string
  /** 第二行：校區・日期或狀態 */
  detail: string
  to: { path: string; query?: Record<string, string> }
}

const VISIT_LIMIT = 5
const RECORD_LIMIT_PER_CAMPUS = 3
const RECORD_LIMIT = 5

/** 夠具體才查：姓名至少 2 個字，電話至少 4 碼（「09」「王」會帶出幾乎每一筆）。 */
export function peopleSearchTerm(raw: string): string {
  const term = searchTerm(raw)
  if (!term) return ''
  if (/^\d+$/.test(term)) return term.length >= 4 ? term : ''
  // 還在打的電話片段（+88、09-）不查。
  if (/^[\d\s()+-]+$/.test(term)) return ''
  return [...term].length >= 2 ? term : ''
}

const shortDate = (iso: string | null | undefined): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return match ? `${Number(match[2])}/${Number(match[3])}` : ''
}

export function visitHit(visit: VisitRequestDetailOut): PersonHit {
  const date = shortDate(visit.visited_on ?? visit.slot?.slot_date ?? null)
  return {
    key: `visit-${visit.id}`,
    kind: 'visit',
    title: [visit.parent_name, visit.child_name].filter(Boolean).join('・'),
    detail: [`${campusLabel(visit.campus_key)}校`, date ? `${date} 參觀` : visit.display_status].filter(Boolean).join('・'),
    to: { path: `/visit-requests/${visit.id}` },
  }
}

export function recordHit(record: RecruitmentVisit): PersonHit {
  return {
    key: `record-${record.id}`,
    kind: 'record',
    title: [record.child_name, record.contact_name].filter(Boolean).join('・'),
    detail: [`${campusLabel(record.campus_key)}校`, record.month ? `${record.month} 參觀` : ''].filter(Boolean).join('・'),
    // sy=all：紀錄可能不在預設學年；open 讓明細直接展開那一筆。
    to: { path: '/admissions', query: { campus: record.campus_key, sy: 'all', tab: 'records', open: record.id } },
  }
}

export function usePeopleSearch(
  query: Ref<string>,
  scope: { canVisits: Ref<boolean>; canRecords: Ref<boolean>; campusKeys: Ref<readonly string[]> },
) {
  const visits = ref<PersonHit[]>([])
  const records = ref<PersonHit[]>([])
  const loading = ref(false)
  const enabled = computed(() => scope.canVisits.value || scope.canRecords.value)
  const term = computed(() => (enabled.value ? peopleSearchTerm(query.value) : ''))
  let version = 0

  async function searchVisits(q: string): Promise<PersonHit[]> {
    if (!scope.canVisits.value) return []
    const params = new URLSearchParams({ page: '1', page_size: String(VISIT_LIMIT), order: 'newest' })
    const rows = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`, { headers: searchHeaders({ q }) })
    return rows.map(visitHit)
  }

  async function searchRecords(q: string): Promise<PersonHit[]> {
    if (!scope.canRecords.value) return []
    // 招生紀錄的 API 一次只查一校：看得到的校各查一次，沒權限的那幾校（403）略過。
    const settled = await Promise.allSettled(scope.campusKeys.value.map(campus_key =>
      listRecords({ campus_key, q, page: 1, page_size: RECORD_LIMIT_PER_CAMPUS } as RecordFilters & { page: number; page_size: number })))
    return settled.flatMap(result => (result.status === 'fulfilled' ? result.value : [])).slice(0, RECORD_LIMIT).map(recordHit)
  }

  const run = useDebouncedFn(async (q: string) => {
    const mine = ++version
    const [visitRows, recordRows] = await Promise.allSettled([searchVisits(q), searchRecords(q)])
    if (mine !== version) return
    visits.value = visitRows.status === 'fulfilled' ? visitRows.value : []
    records.value = recordRows.status === 'fulfilled' ? recordRows.value : []
    loading.value = false
  }, 350)

  watch(term, (q) => {
    version += 1
    run.cancel()
    visits.value = []
    records.value = []
    loading.value = Boolean(q)
    if (q) run(q)
  }, { immediate: true })

  const hits = computed(() => [...visits.value, ...records.value])
  return { enabled, term, visits, records, hits, loading }
}
