import { ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { useCampusScope } from '../composables/useCampusScope'
import { currentTerm } from './academic'

// 名額規劃（intake）與官網預約（arrivals）2026-10-05 拿掉、待追蹤（followups）2026-10-06 拿掉，
// 舊連結的 tab=intake、tab=arrivals、tab=followups 退回漏斗看板。
export const ADMISSIONS_TABS = ['funnel', 'records', 'stats'] as const
export type AdmissionsTab = (typeof ADMISSIONS_TABS)[number]
export type Semester = 1 | 2
// 統計分析的子分頁（StatsTab 的 pane 名稱去掉 stats- 前綴）；overview 是預設，不寫進網址。
export const STATS_SUBS = ['overview', 'class', 'source', 'staff', 'nodeposit', 'compare'] as const
export type StatsSub = (typeof STATS_SUBS)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 民國月份「115.09」：三位數年份，同後端 academic.py 的 ROC_MONTH。
const ROC_MONTH = /^\d{3}\.(0[1-9]|1[0-2])$/
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function isAdmissionsTab(value: unknown): value is AdmissionsTab {
  return typeof value === 'string' && (ADMISSIONS_TABS as readonly string[]).includes(value)
}

export function isStatsSub(value: unknown): value is StatsSub {
  return typeof value === 'string' && (STATS_SUBS as readonly string[]).includes(value)
}

function queryKey(query: LocationQuery | Record<string, string>): string {
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') entries.push([key, item])
  }
  return new URLSearchParams(entries.sort(([a], [b]) => a.localeCompare(b))).toString()
}

/**
 * 招生入學頁的篩選與分頁 ↔ 網址（比照園務 useAdmissionsTermFilter）：
 * - campus：校區，沿用 useCampusScope 的可見範圍；沒指定或看不到就用第一校（同參觀場次頁）。
 * - sy：入學學年，預設目前學年（台北日期）；all＝不限學年。
 * - sem：入學學期 1／2；不帶＝整學年（同園務看板）。
 * - tab：分頁；vr：只看某筆預約的招生訪視（預約明細的連結用）。
 * - month：訪視明細的參觀月份（民國 115.09）；統計分頁的「查看本月明細」帶這個切過來。
 * - sub：統計分頁的子分頁，只在 tab=stats 時有意義，總覽不寫進網址；切子分頁用 replace，
 *   「查看」明細用 push，所以上一頁回到離開時的子分頁。
 * 畫面改條件用 replace 寫回網址，不堆瀏覽紀錄；網址被改（上一頁、連結）時讀回畫面。
 */
export function useAdmissionsFilters() {
  const route = useRoute()
  const router = useRouter()
  const PATH = route.path
  const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
  const defaultYear = currentTerm().schoolYear

  const campus = ref('')
  const schoolYear = ref<number | null>(defaultYear)
  const semester = ref<Semester | null>(null)
  const tab = ref<AdmissionsTab>('funnel')
  const visitRequestId = ref('')
  const month = ref('')
  const sub = ref<StatsSub>('overview')

  function pickCampus(wanted: string): string {
    const keys = visibleCampusKeys.value
    if (keys.includes(wanted)) return wanted
    if (keys.includes(campus.value)) return campus.value
    return keys[0] ?? ''
  }

  function apply(query: LocationQuery) {
    campus.value = pickCampus(text(query.campus))
    const sy = text(query.sy)
    schoolYear.value = sy === 'all' ? null : /^\d{2,3}$/.test(sy) ? Number(sy) : defaultYear
    const sem = text(query.sem)
    semester.value = sem === '1' ? 1 : sem === '2' ? 2 : null
    tab.value = isAdmissionsTab(query.tab) ? query.tab : 'funnel'
    const vr = text(query.vr)
    visitRequestId.value = UUID.test(vr) ? vr : ''
    const roc = text(query.month)
    month.value = ROC_MONTH.test(roc) ? roc : ''
    sub.value = tab.value === 'stats' && isStatsSub(query.sub) ? query.sub : 'overview'
  }

  function stateQuery(): Record<string, string> {
    const query: Record<string, string> = {}
    if (campus.value) query.campus = campus.value
    if (schoolYear.value === null) query.sy = 'all'
    else if (schoolYear.value !== defaultYear) query.sy = String(schoolYear.value)
    if (semester.value) query.sem = String(semester.value)
    if (tab.value !== 'funnel') query.tab = tab.value
    if (visitRequestId.value) query.vr = visitRequestId.value
    if (month.value) query.month = month.value
    if (tab.value === 'stats' && sub.value !== 'overview') query.sub = sub.value
    return query
  }

  // 自己寫出去、還在路上的網址：回來時不要讀回畫面，快速連點才不會被前一次的網址蓋回去
  // （同 VisitRequestsView 的 writingQueries）。
  const writing = new Set<string>()
  function syncUrl() {
    if (route.path !== PATH) return
    const query = stateQuery()
    const key = queryKey(query)
    if (key === queryKey(route.query)) return
    writing.add(key)
    void router.replace({ query }).catch(() => {}).finally(() => writing.delete(key))
  }

  apply(route.query)
  // 離開統計分頁就把子分頁收回總覽，下次進來從總覽開始。
  watch(tab, (value) => {
    if (value !== 'stats') sub.value = 'overview'
  })
  watch([campus, schoolYear, semester, tab, visitRequestId, month, sub], syncUrl, { immediate: true })
  watch(() => route.query, (query) => {
    if (route.path !== PATH) return
    const key = queryKey(query)
    if (writing.has(key) || key === queryKey(stateQuery())) return
    apply(query)
  })
  // 換帳號或權限更新：選的校區不在範圍內就換成第一校。
  watch(visibleCampusKeys, () => { campus.value = pickCampus(campus.value) })

  /** 清掉入學學年學期（「另有 N 筆沒有填入學學期」與明細的「清除篩選」用）。 */
  function clearTerm() {
    schoolYear.value = null
    semester.value = null
  }

  return {
    campus, schoolYear, semester, tab, visitRequestId, month, sub, visibleCampusKeys, defaultYear, clearTerm,
  }
}
