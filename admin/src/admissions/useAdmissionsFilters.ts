import { ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { useCampusScope } from '../composables/useCampusScope'
import { currentTerm } from './academic'
import { DEFAULT_AREA_VIEW, areaViewQuery, parseAreaViewQuery, type AreaView } from './areaView'
import { parseAreaQuery } from './areaFilter'
import { isWithdrawFilter } from './constants'
import { DEFAULT_JOURNEY_FILTER, journeyQuery, parseJourneyQuery, type JourneyFilter } from './journeyFormat'

// 名額規劃（intake）與官網預約（arrivals）2026-10-05 拿掉、待追蹤（followups）2026-10-06 拿掉，
// 舊連結的 tab=intake、tab=arrivals、tab=followups 退回漏斗看板。統計分析 2026-10-16 抽成獨立的
// 招生統計頁（限總管理者）：舊連結 tab=stats 由路由轉過去（router/index.ts），看不到的人退回漏斗看板。
export const ADMISSIONS_TABS = ['funnel', 'records'] as const
export type AdmissionsTab = (typeof ADMISSIONS_TABS)[number]
export type Semester = 1 | 2
// 招生統計的子分頁（StatsTab 的 pane 名稱去掉 stats- 前綴）；overview 是預設，不寫進網址。
// 順序同園務：區域分析在接待之後、未預繳之前（2026-10-08 起官網也做）。官網延伸的「參觀預約」
// （2026-10-13 從成效統計搬來）、「預約全程」（2026-10-15）、「招生潛力與市佔率」（2026-10-20）與「資料匯入」（2026-10-21）排最後，
// 園務有的子分頁順序不動。
export const STATS_SUBS = ['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare', 'booking', 'journey', 'potential', 'imports'] as const
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

/** 用這組篩選的頁面：招生入學（漏斗看板、訪視明細）或招生統計（2026-10-16 從招生入學的「統計分析」分頁抽出）。 */
export type AdmissionsPage = 'admissions' | 'stats'

/**
 * 招生入學與招生統計頁的篩選與分頁 ↔ 網址（比照園務 useAdmissionsTermFilter）：
 * - campus：校區，沿用 useCampusScope 的可見範圍；沒指定或看不到就用第一校（同參觀場次頁）。
 * - sy：入學學年，預設目前學年（台北日期）；all＝不限學年。
 * - sem：入學學期 1／2；不帶＝整學年（同園務看板）。
 * 以下只屬於招生入學頁：
 * - tab：分頁；vr：只看某筆預約的招生訪視（預約明細的連結用）。
 * - month：訪視明細的參觀月份（民國 115.09）；招生統計的「查看本月明細」帶這個切過來。
 * - area：訪視明細的區域（區域分析的「查看明細」帶過來，寫法見 areaFilter.ts）；只在 tab=records 有意義，
 *   離開訪視明細就拿掉，手改成認不得的值就當沒篩。
 * - wr：訪視明細的退出原因分類（八項或 unclassified，2026-10-15）；統計「退出原因分佈」的「查看明細」帶過來，
 *   只在 tab=records 有意義，離開訪視明細就拿掉，認不得的值當沒篩。
 * 以下只屬於招生統計頁：
 * - sub：子分頁，總覽不寫進網址；切子分頁用 replace，「查看」明細用 push（到招生入學），
 *   所以上一頁回到離開時的子分頁。
 * - jp／jf／jt／js：「預約全程」的期間、自訂起訖與來源（journeyFormat.ts），只在 sub=journey 有意義，
 *   離開就拿掉，手改成認不得的值就退回預設。
 * - map／village／table：「區域分析」的地圖模式、選取的里與表格分頁（areaView.ts，2026-10-16），只在 sub=area
 *   有意義，離開就拿掉，認不得的值退回預設。畫面上換校區、學年或學期時清掉 village（那個里在新條件下
 *   不一定有意義）；網址讀進來的（初次掛載、上一頁）不清。
 * 兩頁共用校區、學年、學期；另一頁的參數出現在網址上就拿掉。
 * 畫面改條件用 replace 寫回網址，不堆瀏覽紀錄；網址被改（上一頁、連結）時讀回畫面。
 */
export function useAdmissionsFilters(page: AdmissionsPage = 'admissions') {
  const onStats = page === 'stats'
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
  const area = ref('')
  const withdraw = ref('')
  const sub = ref<StatsSub>('overview')
  const journey = ref<JourneyFilter>({ ...DEFAULT_JOURNEY_FILTER })
  const areaView = ref<AreaView>({ ...DEFAULT_AREA_VIEW })

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
    // 招生統計頁沒有分頁：tab 固定是預設值、不寫進網址，下面 records 才有的參數也就不讀。
    tab.value = !onStats && isAdmissionsTab(query.tab) ? query.tab : 'funnel'
    const vr = text(query.vr)
    visitRequestId.value = !onStats && UUID.test(vr) ? vr : ''
    const roc = text(query.month)
    month.value = !onStats && ROC_MONTH.test(roc) ? roc : ''
    const areaValue = text(query.area)
    area.value = tab.value === 'records' && parseAreaQuery(areaValue) ? areaValue : ''
    const wr = text(query.wr)
    withdraw.value = tab.value === 'records' && isWithdrawFilter(wr) ? wr : ''
    sub.value = onStats && isStatsSub(query.sub) ? query.sub : 'overview'
    journey.value = onStats && sub.value === 'journey' ? parseJourneyQuery(query) : { ...DEFAULT_JOURNEY_FILTER }
    // 排在校區、學年、學期之後：下面「使用者換條件就清 village」的 watch 是 sync 的，apply 改校區也會觸發，
    // 最後才指派 areaView，網址帶進來的 village 才蓋得過那一次清除（初次掛載、上一頁都保留）。
    areaView.value = onStats && sub.value === 'area' ? parseAreaViewQuery(query) : { ...DEFAULT_AREA_VIEW }
  }

  function stateQuery(): Record<string, string> {
    const query: Record<string, string> = {}
    if (campus.value) query.campus = campus.value
    if (schoolYear.value === null) query.sy = 'all'
    else if (schoolYear.value !== defaultYear) query.sy = String(schoolYear.value)
    if (semester.value) query.sem = String(semester.value)
    if (!onStats && tab.value !== 'funnel') query.tab = tab.value
    if (visitRequestId.value) query.vr = visitRequestId.value
    if (month.value) query.month = month.value
    if (tab.value === 'records' && area.value) query.area = area.value
    if (tab.value === 'records' && withdraw.value) query.wr = withdraw.value
    if (onStats && sub.value !== 'overview') query.sub = sub.value
    if (onStats && sub.value === 'journey') Object.assign(query, journeyQuery(journey.value))
    if (onStats && sub.value === 'area') Object.assign(query, areaViewQuery(areaView.value))
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

  // 離開預約全程就放掉期間與來源；已經是預設就不重新指派，免得還掛著的預約全程 pane 收到新物件。
  function resetJourney() {
    const { period, from, to, source } = journey.value
    const fresh = DEFAULT_JOURNEY_FILTER
    if (period === fresh.period && from === fresh.from && to === fresh.to && source === fresh.source) return
    journey.value = { ...fresh }
  }

  // 離開區域分析就放掉模式、里與表格分頁；已經是預設就不重新指派（同 resetJourney）。
  function resetAreaView() {
    const { map, village, table } = areaView.value
    const fresh = DEFAULT_AREA_VIEW
    if (map === fresh.map && village === fresh.village && table === fresh.table) return
    areaView.value = { ...fresh }
  }

  apply(route.query)
  // 換校區、學年或學期：選取的里清掉（網址 village 一起拿掉），模式與表格分頁保留。
  // sync：校區等一變就清，不等到下一輪 flush，syncUrl 寫出去的網址才不帶舊的里；apply() 讀網址時也會經過這裡，
  // 靠它最後才指派 areaView 把網址的 village 放回來（見 apply）。排在 syncUrl 的 watch 前面。
  watch([campus, schoolYear, semester], () => {
    if (areaView.value.village === DEFAULT_AREA_VIEW.village) return
    areaView.value = { ...areaView.value, village: DEFAULT_AREA_VIEW.village }
  }, { flush: 'sync' })
  // 離開訪視明細就放掉區域與退出原因篩選。
  watch(tab, (value) => {
    if (value !== 'records') {
      area.value = ''
      withdraw.value = ''
    }
  })
  watch(sub, (value) => {
    if (value !== 'journey') resetJourney()
    if (value !== 'area') resetAreaView()
  })
  watch([campus, schoolYear, semester, tab, visitRequestId, month, area, withdraw, sub, journey, areaView], syncUrl, { immediate: true, deep: true })
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
    campus, schoolYear, semester, tab, visitRequestId, month, area, withdraw, sub, journey, areaView, visibleCampusKeys, defaultYear, clearTerm,
  }
}
