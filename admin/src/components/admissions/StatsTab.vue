<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import AreaTab from './area/AreaTab.vue'
import AreaCompareTable from './AreaCompareTable.vue'
import CompareTable from './CompareTable.vue'
import NoDepositList from './NoDepositList.vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import StatsOverview from './StatsOverview.vue'
import JourneyTab from './JourneyTab.vue'
import PotentialTab from './potential/PotentialTab.vue'
import ImportsTab from './imports/ImportsTab.vue'
import AdsTab from './ads/AdsTab.vue'
import BookingStatsPane from '../analytics/BookingStatsPane.vue'
import { getAreaCompare, getCompare, getStats } from '../../api/admissions'
import { campusLabel, formatDateTime } from '../../api/labels'
import type { AdmissionsCompare, AdmissionsStats, AreaCompare } from '../../api/types'
import { currentTerm, taipeiToday, termLabel } from '../../admissions/academic'
import { SEMESTER_LABELS, UNCLASSIFIED_LABEL, UNCLASSIFIED_WITHDRAW } from '../../admissions/constants'
import { AREA_COMPARE_NOTE } from '../../admissions/areaCompareFormat'
import { DEFAULT_AREA_VIEW, type AreaView } from '../../admissions/areaView'
import { DEFAULT_JOURNEY_FILTER, type JourneyFilter } from '../../admissions/journeyFormat'
import { NO_VALUE, formatRate, gradeColumns, priorityLabel, ratio, type StatsColumn, type StatsTarget } from '../../admissions/statsFormat'
import { STATS_GROUPS, STATS_SUB_LABELS, groupOfSub, type StatsGroup, type StatsGroupKey } from '../../admissions/statsNav'
import { type StatsSub } from '../../admissions/useAdmissionsFilters'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { csvFilename } from '../../utils/csv'

// 統計分析（規格 9、10；2026-10-16 起是獨立的招生統計頁）。頁首的校區與入學學年學期由 AdmissionsStatsView 傳進來；這裡管參考月份、
// 子分頁與讀取。換校區或學期時先清空畫面再讀，只採用最後一次的回應（R15：不殘留別校的數字）。
// 子分頁順序同園務：總覽、班別分析、來源分析、接待分析、區域分析（2026-10-08 起官網也做，見區域分析規格）、未預繳與退出原因。
// 警示與行動入口指到統計內的子分頁就直接切；指到訪視明細就交給頁面（open-records）。
// 「未預繳與退出原因」（2026-10-15 由「未預繳原因」改名）另有未預繳明細（NoDepositList，C3b）：警示帶的篩選以 preset 傳下去，名單的「查看」同樣交給頁面；
// 最下面的「退出原因分佈」，「查看明細」帶分類回訪視明細。
// 「參觀預約」（2026-10-13 從成效統計搬來，BookingStatsPane）讀自己的 API、不用招生統計：招生統計還在讀或
// 讀失敗時，子分頁列照樣出現，切得過去；招生的子分頁和以前一樣等招生統計回來才畫（讀失敗只有錯誤與
// 重新載入）。上方的統計範圍與說明只屬於招生統計，在參觀預約不顯示。
// 「預約全程」（2026-10-15，JourneyTab）同樣讀自己的 API，期間與來源由頁面放在網址（journey）。
// 「招生潛力與市佔率」（2026-10-20，PotentialTab）也讀自己的 API，看所有學年，沒有要放網址的篩選。
// 「資料匯入」（2026-10-21，ImportsTab）上傳在籍清冊與歷年註冊，同樣讀自己的 API、不分入學學年學期。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }>()
const emit = defineEmits<{
  'open-records': [filter: { month?: string; area?: string; withdraw?: string; open?: string }]
  'open-area': [campusKey: string]
}>()

// 統計表的匯出檔名：招生統計-表名-校區-學期-日期（沒選學年寫「全部學年」，只選學期就接上學期，
// 檔名才不會把只有上學期的數字寫成全部）。
const csvTerm = () => {
  if (props.schoolYear) return termLabel(props.schoolYear, props.semester)
  return props.semester === null ? '全部學年' : `全部學年${SEMESTER_LABELS[props.semester === 2 ? 2 : 1]}`
}
const csvName = (title: string) => csvFilename('招生統計', title, campusLabel(props.campusKey), csvTerm(), taipeiToday())

// 子分頁由頁面放在網址（sub，見 useAdmissionsFilters）；單獨掛載（測試）時沒有父層就用元件自己的值。
const sub = defineModel<StatsSub>('sub', { default: 'overview' })
const journey = defineModel<JourneyFilter>('journey', { default: () => ({ ...DEFAULT_JOURNEY_FILTER }) })
// 區域分析的地圖模式、選取的里與表格分頁（2026-10-16），同樣由頁面放在網址。
const areaView = defineModel<AreaView>('areaView', { default: () => ({ ...DEFAULT_AREA_VIEW }) })

// 「參觀預約」「預約全程」「招生潛力與市佔率」與「資料匯入」讀自己的 API、不用招生統計：這幾個子分頁都不等招生統計，上方的統計範圍與說明不顯示。
const ownDataSub = computed(() => sub.value === 'booking' || sub.value === 'journey' || sub.value === 'potential' || sub.value === 'imports' || sub.value === 'ads')

// 導覽（2026-11-20）：上層四類、下層是該類的分頁（statsNav.ts），整塊黏在頁首下面；「資料匯入」在分類右邊另一顆。
// 分頁列自己畫、不用 el-tabs：el-tabs 只能把十二個分頁排成一排，而且分頁內容要留著（區域分析的地圖、各分頁自己
// 讀的資料），所以內容區是「開過才掛、之後用 v-show 切」。還沒開過的分頁沒有內容區，tab 就不寫 aria-controls
// （指到不存在的 id 會被 axe 判成無效的 ARIA 值）。
const group = computed(() => groupOfSub(sub.value))
// 五校比較、廣告成效要看得到兩校以上才有；整類沒有分頁就不列。
const visibleSubs = (item: StatsGroup) => item.subs.filter((key) => showCompare.value || (key !== 'compare' && key !== 'ads'))
const groups = computed(() => STATS_GROUPS.filter((item) => visibleSubs(item).length > 0))
const tabs = computed(() => (group.value ? visibleSubs(group.value) : []))
// 換分類時回到那一類上次看的分頁（第一次是那一類的第一頁）。
const lastSub = reactive<Partial<Record<StatsGroupKey, StatsSub>>>({})
function openGroup(item: StatsGroup) {
  if (item.key === group.value?.key) return
  const wanted = lastSub[item.key]
  sub.value = wanted && visibleSubs(item).includes(wanted) ? wanted : visibleSubs(item)[0]!
}
function setSub(value: StatsSub) {
  sub.value = value
}
const visited = reactive(new Set<StatsSub>())
const tablist = useTemplateRef<HTMLElement>('tablist')
watch(
  sub,
  (value) => {
    visited.add(value)
    const current = groupOfSub(value)
    if (current) lastSub[current.key] = value
    // 網址直接帶後段分頁、或手機上換分頁：分頁列捲到選中的那一頁（2026-11-06 QA）。
    void nextTick(() => {
      const tab = tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (typeof tab?.scrollIntoView === 'function') tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  },
  { immediate: true },
)
// 分頁列的鍵盤操作：左右鍵換分頁（焦點跟著走），Home／End 到頭尾。
function onTabKey(event: KeyboardEvent) {
  const list = tabs.value
  const index = list.indexOf(sub.value)
  const next =
    event.key === 'ArrowRight' ? list[(index + 1) % list.length]
    : event.key === 'ArrowLeft' ? list[(index - 1 + list.length) % list.length]
    : event.key === 'Home' ? list[0]
    : event.key === 'End' ? list.at(-1)
    : undefined
  if (!next) return
  event.preventDefault()
  sub.value = next
  void nextTick(() => tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

const stats = ref<AdmissionsStats | null>(null)
const loading = ref(false)
const failed = ref(false)
// null＝跟著後端取最新有資料的月份（園務 _select_reference_month）。
const referenceMonth = ref<string | null>(null)
// 警示或行動入口指到「未預繳原因」時帶的 target_filter（priority、overdue_days），交給名單套用
// （同園務 applyNoDepositFilter）。每次都給新物件，同一個入口點第二次也會重新套用。
const noDepositPreset = ref<Record<string, string | number> | null>(null)
const requests = useRequestSequence()

async function load(options: { reset?: boolean } = {}) {
  const request = requests.begin()
  if (options.reset) stats.value = null
  failed.value = false
  if (!props.campusKey) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await getStats({
      campus_key: props.campusKey,
      school_year: props.schoolYear,
      semester: props.semester,
      reference_month: referenceMonth.value,
    })
    if (requests.isCurrent(request)) stats.value = result
  } catch {
    if (requests.isCurrent(request)) {
      stats.value = null
      failed.value = true
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 換校區或學年學期：參考月份回到「最新」、名單的 preset 清掉，畫面清空再讀（不留舊校區的數字）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    referenceMonth.value = null
    noDepositPreset.value = null
    void load({ reset: true })
  },
  { immediate: true },
)

// 參考月份只影響總覽（本月、月比、年度累計、漏斗快照、警示與行動入口），其他子分頁的數字不變，所以選單放在總覽裡；保留畫面、蓋一層讀取中。
function setReferenceMonth(value: string | null | undefined) {
  referenceMonth.value = value || null
  void load()
}

const hasData = computed(() => (stats.value?.kpi.visit ?? 0) > 0)
// 有資料的月份，新到舊（園務參考月份選單同一份來源）。
const monthOptions = computed(() => [...(stats.value?.monthly ?? [])].reverse().map((row) => row.month))

const scopeLabel = computed(() => {
  if (props.schoolYear === null) {
    return props.semester === null ? '所有學年' : `所有學年的${SEMESTER_LABELS[props.semester === 2 ? 2 : 1]}`
  }
  return termLabel(props.schoolYear, props.semester)
})
// 規格 10：沒有資料時寫原因，不顯示假的 0。
const emptyText = computed(
  () =>
    `${campusLabel(props.campusKey)}在${props.schoolYear === null ? '' : ' '}${scopeLabel.value}還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。`,
)

function navigate(target: { tab: StatsTarget; filter: Record<string, string | number> }) {
  if (target.tab === 'records') {
    const month = target.filter.month
    if (typeof month === 'string' && month) emit('open-records', { month })
    return
  }
  if (target.tab === 'nodeposit') noDepositPreset.value = { ...target.filter }
  sub.value = target.tab
}

// 五校比較（規格 9.3，官網延伸）：看得到兩校以上才有，切到這個子分頁才讀。學年跟頁首（沒選用目前學年）；
// 學期跟頁首：沒選就不帶，件數算整學年，和總覽對得起來。
const showCompare = computed(() => props.campusKeys.length > 1)
const compareTerm = computed(() => ({
  schoolYear: props.schoolYear ?? currentTerm().schoolYear,
  semester: props.semester,
}))
const compareResult = ref<AdmissionsCompare | null>(null)
const compareFailed = ref(false)
const compareRequests = useRequestSequence()

// 頁首沒選學年時說明用了哪一學年（用回應的學年，不用請求前推算的值）；學年學期本身寫在表格標題。
const compareNote = computed(() => {
  const result = compareResult.value
  if (!result || props.schoolYear !== null) return ''
  return `頁首沒選學年，用目前的 ${result.school_year} 學年。`
})

async function loadCompare() {
  const request = compareRequests.begin()
  const { schoolYear, semester } = compareTerm.value
  compareResult.value = null
  compareFailed.value = false
  try {
    const result = await getCompare(schoolYear, semester)
    if (compareRequests.isCurrent(request)) compareResult.value = result
  } catch {
    if (compareRequests.isCurrent(request)) compareFailed.value = true
  }
}

watch([sub, () => compareTerm.value.schoolYear, () => compareTerm.value.semester], () => {
  if (sub.value === 'compare' && showCompare.value) void loadCompare()
}, { immediate: true })

// 五校周邊環境（2026-11-16 規格 §6.2）：接在招生件數表下面，自己讀、自己成敗；不吃學年學期（人口、園所都是當下資料），
// 範圍 1／3／6 公里是畫面狀態（預設 3、不進網址）。
const compareRadius = ref<1 | 3 | 6>(3)
const areaCompare = ref<AreaCompare | null>(null)
const areaCompareFailed = ref(false)
const areaCompareRequests = useRequestSequence()
async function loadAreaCompare() {
  const request = areaCompareRequests.begin()
  areaCompare.value = null
  areaCompareFailed.value = false
  try {
    const result = await getAreaCompare(compareRadius.value)
    if (areaCompareRequests.isCurrent(request)) areaCompare.value = result
  } catch {
    if (areaCompareRequests.isCurrent(request)) areaCompareFailed.value = true
  }
}
watch([sub, compareRadius], () => {
  if (sub.value === 'compare' && showCompare.value) void loadAreaCompare()
}, { immediate: true })
// el-radio-group 回報 string | number | boolean：只收 1、3、6。
function setCompareRadius(value: string | number | boolean | undefined) {
  const km = Number(value)
  if (km === 1 || km === 3 || km === 6) compareRadius.value = km
}
// 權限更新後只剩一校：子分頁消失，退回總覽。
// 網址帶 sub=compare／ads 但只看得到一校：掛載時也要退回。
watch(showCompare, (visible) => {
  if (!visible && (sub.value === 'compare' || sub.value === 'ads')) sub.value = 'overview'
}, { immediate: true })

// 後端把沒填班別、來源、帶參觀老師的歸在這個標籤：排序時固定排最後、字色淡一階，不混在有名字的列中間。
const UNFILLED_LABEL = '未填寫'

// 表頭照園務 Recruitment{Class,Source,Staff,NoDeposit}Tab 原文。
const GRADE_COLUMNS: StatsColumn[] = [
  { key: 'grade', label: '班別', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range', rangeOf: 'visit_to_deposit_rate' },
]
const SOURCE_COLUMNS: StatsColumn[] = [
  { key: 'source', label: '來源', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range', rangeOf: 'visit_to_deposit_rate' },
]
// 接待人員＝帶參觀老師（2026-10-06 起，原本看介紹者欄；和園務分歧）。一筆有多位老師時每位各算一次。
const STAFF_COLUMNS: StatsColumn[] = [
  { key: 'tour_guide', label: '接待人員', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range', rangeOf: 'visit_to_deposit_rate' },
]

// 動態欄的 key 加前綴（g: 年級、s: 來源），來源或年級字面上叫 month／total 也不會撞到。
const monthGradeLabels = computed(() =>
  gradeColumns(Object.values(stats.value?.month_grade ?? {}).flatMap((cells) => Object.keys(cells))),
)
const monthGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'month', label: '月份', sticky: true, csv: 'roc-month' },
  ...monthGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const monthGradeRows = computed(() =>
  (stats.value?.monthly ?? []).map((row) => {
    const cells = stats.value?.month_grade[row.month] ?? {}
    return {
      month: row.month,
      total: cells['合計'] ?? 0,
      ...Object.fromEntries(monthGradeLabels.value.map((grade) => [`g:${grade}`, cells[grade] ?? 0])),
    }
  }),
)

const staffGradeLabels = computed(() => gradeColumns((stats.value?.by_tour_guide ?? []).flatMap((row) => Object.keys(row.by_grade))))
const staffGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'tour_guide', label: '接待人員', sticky: true },
  ...staffGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade, kind: 'split' })),
])
// 園務 StaffTab：格內「{參觀}人 / {預繳率}」，沒有資料寫「—」。畫面上拆成兩行（上面預繳率、下面人數，kind: 'split'），
// 同一欄才比得出高低；匯出的 CSV 仍是這個字串。
const staffGradeRows = computed(() =>
  (stats.value?.by_tour_guide ?? []).map((row) => ({
    tour_guide: row.tour_guide,
    ...Object.fromEntries(
      staffGradeLabels.value.map((grade) => {
        const cell = row.by_grade[grade]
        return [`g:${grade}`, cell ? `${cell.visit}人 / ${formatRate(ratio(cell.deposit, cell.visit))}` : NO_VALUE]
      }),
    ),
  })),
)

const crossColumns = computed<StatsColumn[]>(() => [
  { key: 'tour_guide', label: '接待人員', sticky: true },
  ...(stats.value?.tour_guide_source_cross.sources ?? []).map((source): StatsColumn => ({ key: `s:${source}`, label: source, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const crossRows = computed(() =>
  (stats.value?.tour_guide_source_cross.tour_guides ?? []).map((row) => ({
    tour_guide: row.tour_guide,
    total: row.total,
    ...Object.fromEntries(Object.entries(row.sources).map(([source, count]) => [`s:${source}`, count])),
  })),
)

const noDepositLabels = computed(() =>
  gradeColumns((stats.value?.no_deposit_reasons ?? []).flatMap((row) => Object.keys(row.by_grade))),
)
const noDepositColumns = computed<StatsColumn[]>(() => [
  { key: 'reason', label: '原因分類', sticky: true },
  { key: 'priority', label: '轉換潛力' },
  { key: 'count', label: '筆數', kind: 'bar' },
  ...noDepositLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade, kind: 'count' })),
])
const noDepositRows = computed(() =>
  (stats.value?.no_deposit_reasons ?? []).map((row) => ({
    reason: row.reason,
    priority: priorityLabel(row.priority),
    count: row.count,
    ...Object.fromEntries(noDepositLabels.value.map((grade) => [`g:${grade}`, row.by_grade[grade] ?? 0])),
  })),
)
// 園務 NoDepositTab 的三張數字卡（> 0 才上色）。2026-11-20 起可以點：把下面名單篩成那一批並捲過去
// （原本只是數字，名單卻有對應的篩選，要自己往下找再勾一次）。
type NoDepositPreset = Record<string, string | number>
const KPI_PRESETS: Record<'high' | 'overdue' | 'cold', NoDepositPreset> = {
  high: { priority: 'high' },
  overdue: { priority: 'all', overdue_days: 14 },
  cold: { priority: 'all', cold_only: 1 },
}
const noDepositKpis = computed(() => {
  const summary = stats.value?.no_deposit_summary
  return [
    { label: '高潛力未預繳', value: summary?.high_potential_count ?? 0, preset: KPI_PRESETS.high },
    { label: '逾 14 天待追', value: summary?.overdue_followup_count ?? 0, preset: KPI_PRESETS.overdue },
    { label: '冷名單', value: summary?.cold_count ?? 0, preset: KPI_PRESETS.cold },
  ]
})
const noDepositList = useTemplateRef<{ $el?: HTMLElement }>('noDepositList')
function showNoDeposit(preset: Record<string, string | number>) {
  noDepositPreset.value = { ...preset }
  void nextTick(() => {
    const el = noDepositList.value?.$el
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}
// 五校比較：五校在這個學年都沒有招生訪視時不畫整張 0 與「—（0/0）」，寫一句。
const compareEmpty = computed(() => (compareResult.value?.rows ?? []).every((row) => row.visit === 0))

// 退出原因分佈（2026-10-15 規格 W6、W8）：後端回八項＋未分類（含 0 筆），畫面只列有筆數的。
const withdrawColumns: StatsColumn[] = [
  { key: 'reason', label: '原因', sticky: true },
  { key: 'deposited', label: '退預繳', kind: 'count' },
  { key: 'enrolled', label: '退註冊', kind: 'count' },
  { key: 'total', label: '合計', kind: 'bar' },
]
const withdrawRows = computed(() =>
  (stats.value?.withdraw_reasons ?? [])
    .filter((row) => row.total > 0)
    .map((row) => ({
      reason: row.reason,
      deposited: row.deposited,
      enrolled: row.enrolled,
      total: row.total,
      code: row.reason === UNCLASSIFIED_LABEL ? UNCLASSIFIED_WITHDRAW : row.reason,
    })),
)
function openWithdrawRecords(row: { code: string }) {
  emit('open-records', { withdraw: row.code })
}
</script>

<template>
  <section class="stats" aria-label="統計分析">
    <div class="stats-nav">
      <div class="stats-nav__row">
        <div class="stats-nav__groups">
          <div class="status-tabs stats-nav__cats" role="group" aria-label="統計分類">
            <button
              v-for="item in groups"
              :key="item.key"
              type="button"
              class="status-tab"
              :class="{ 'is-active': item.key === group?.key }"
              :aria-pressed="item.key === group?.key"
              @click="openGroup(item)"
            >
              {{ item.label }}
            </button>
          </div>
          <button type="button" class="stats-nav__imports" :class="{ 'is-active': sub === 'imports' }" :aria-pressed="sub === 'imports'" @click="setSub('imports')">
            資料匯入
          </button>
        </div>
        <div class="stats-nav__filters">
          <slot name="filters" />
        </div>
      </div>
      <div v-if="tabs.length" class="stats-nav__row stats-nav__row--tabs">
        <div ref="tablist" class="stats-tabs" role="tablist" :aria-label="`${group?.label}的分頁`" @keydown="onTabKey">
          <button
            v-for="key in tabs"
            :id="`stats-tab-${key}`"
            :key="key"
            type="button"
            role="tab"
            class="stats-tab"
            :aria-selected="key === sub"
            :aria-controls="visited.has(key) ? `stats-pane-${key}` : undefined"
            :tabindex="key === sub ? 0 : -1"
            @click="setSub(key)"
          >
            {{ STATS_SUB_LABELS[key] }}
          </button>
        </div>
        <p v-if="!ownDataSub && stats" class="hint stats-asof">
          資料時間 <time class="num">{{ formatDateTime(stats.as_of) }}</time>
        </p>
      </div>
    </div>

    <div v-loading="loading && !ownDataSub" class="stats-panes">
      <template v-if="!ownDataSub && !stats">
        <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取統計資料，請重新載入。" class="inline-error">
          <el-button size="small" @click="load()">重新載入</el-button>
        </el-alert>
        <el-skeleton v-else :rows="6" animated />
      </template>

      <div v-if="visited.has('overview') && stats" v-show="sub === 'overview'" id="stats-pane-overview" role="tabpanel" aria-labelledby="stats-tab-overview" tabindex="0">
        <StatsOverview v-if="hasData" :stats="stats" :csv-name="csvName" @navigate="navigate">
          <template #reference-month>
            <div class="stats-month-field">
              <span id="stats-month-label">參考月份</span>
              <!-- 不 teleport：選單留在元件裡，單元測試才找得到選項；外層沒有 overflow:hidden。 -->
              <el-select
                :model-value="referenceMonth ?? undefined"
                clearable
                size="small"
                :placeholder="`最新（${stats.reference_month ?? NO_VALUE}）`"
                aria-label="參考月份"
                class="stats-month"
                :teleported="false"
                @update:model-value="setReferenceMonth"
              >
                <el-option v-for="month in monthOptions" :key="month" :label="month" :value="month" />
              </el-select>
            </div>
          </template>
        </StatsOverview>
        <p v-else class="empty-note stats-empty">{{ emptyText }}</p>
      </div>

      <div v-if="visited.has('class') && stats" v-show="sub === 'class'" id="stats-pane-class" role="tabpanel" aria-labelledby="stats-tab-class" tabindex="0" class="stats-pane">
        <StatsDimensionTable
          title="班別統計"
          :rows="stats.by_grade"
          :columns="GRADE_COLUMNS"
          row-key="grade"
          empty-text="此區間尚無班別資料"
          :export-filename="csvName('班別統計')"
          sortable
          compact
          :average="stats.kpi.visit_to_deposit_rate"
          :pin-last="UNFILLED_LABEL"
        />
        <StatsDimensionTable
          title="月份 × 班別分布"
          :export-filename="csvName('月份 × 班別分布')"
          :rows="monthGradeRows"
          :columns="monthGradeColumns"
          row-key="month"
          empty-text="此區間尚無班別資料"
        />
      </div>

      <div v-if="visited.has('source') && stats" v-show="sub === 'source'" id="stats-pane-source" role="tabpanel" aria-labelledby="stats-tab-source" tabindex="0" class="stats-pane">
        <StatsDimensionTable
          title="來源排名明細"
          :export-filename="csvName('來源排名明細')"
          :rows="stats.by_source"
          :columns="SOURCE_COLUMNS"
          row-key="source"
          numbered
          empty-text="此區間尚無來源資料"
          caption="依家長填的來源原文分組，寫法不同會分開算（例如「FB」和「臉書」）。"
          sortable
          compact
          :average="stats.kpi.visit_to_deposit_rate"
          :pin-last="UNFILLED_LABEL"
        />
      </div>

      <div v-if="visited.has('staff') && stats" v-show="sub === 'staff'" id="stats-pane-staff" role="tabpanel" aria-labelledby="stats-tab-staff" tabindex="0" class="stats-pane">
        <StatsDimensionTable
          title="接待人員統計"
          :export-filename="csvName('接待人員統計')"
          :rows="stats.by_tour_guide"
          :columns="STAFF_COLUMNS"
          row-key="tour_guide"
          empty-text="此區間尚無接待資料"
          caption="依訪視表單的「帶參觀老師」計算，一筆有多位老師時每位各算一次。"
          sortable
          compact
          :average="stats.kpi.visit_to_deposit_rate"
          :pin-last="UNFILLED_LABEL"
        />
        <StatsDimensionTable
          title="接待人員 × 各年級預繳率"
          :export-filename="csvName('接待人員 × 各年級預繳率')"
          :rows="staffGradeRows"
          :columns="staffGradeColumns"
          row-key="tour_guide"
          empty-text="此區間尚無接待資料"
          caption="格內上面是預繳率，下面是參觀人數。"
          compact
          :pin-last="UNFILLED_LABEL"
        />
        <StatsDimensionTable
          v-if="crossRows.length"
          title="接待人員 × 來源 交叉分析"
          :export-filename="csvName('接待人員 × 來源 交叉分析')"
          :rows="crossRows"
          :columns="crossColumns"
          row-key="tour_guide"
          empty-text="此區間尚無接待資料"
          caption="欄位是參觀人數前 10 名的來源；合計含其他來源。"
          :pin-last="UNFILLED_LABEL"
        />
      </div>

      <div v-if="visited.has('area')" v-show="sub === 'area'" id="stats-pane-area" role="tabpanel" aria-labelledby="stats-tab-area" tabindex="0">
        <AreaTab
          v-if="stats"
          v-model:view="areaView"
          :campus-key="campusKey"
          :school-year="schoolYear"
          :semester="semester"
          :csv-name="csvName"
          :empty-text="emptyText"
          @open-records="emit('open-records', $event)"
        />
      </div>

      <div v-if="visited.has('nodeposit') && stats" v-show="sub === 'nodeposit'" id="stats-pane-nodeposit" role="tabpanel" aria-labelledby="stats-tab-nodeposit" tabindex="0" class="stats-pane">
        <template v-if="stats.no_deposit_total">
          <div class="nodeposit-summary">
            <button
              v-for="item in noDepositKpis"
              :key="item.label"
              type="button"
              class="nodeposit-kpi"
              :class="{ 'nodeposit-kpi--on': item.value > 0 }"
              :aria-label="`${item.label} ${item.value} 筆，看名單`"
              @click="showNoDeposit(item.preset)"
            >
              <span>{{ item.label }}</span>
              <strong class="num">{{ item.value }}</strong>
              <span class="nodeposit-kpi__go">看名單</span>
            </button>
          </div>
          <p class="nodeposit-priority">
            高潛力 {{ stats.no_deposit_priority.high }}・中潛力 {{ stats.no_deposit_priority.medium }}・低潛力 {{ stats.no_deposit_priority.low }}・未歸類 {{ stats.no_deposit_priority.other }}（共 {{ stats.no_deposit_total }} 筆）
          </p>
        </template>
        <StatsDimensionTable
          title="未預繳原因分佈"
          :export-filename="csvName('未預繳原因分佈')"
          :rows="noDepositRows"
          :columns="noDepositColumns"
          row-key="reason"
          empty-text="此區間尚無未預繳資料"
        />
        <p class="hint">已退預繳、退註冊的不算未預繳；逾 14 天待追、冷名單＝參觀滿 14、90 天仍未預繳。</p>
        <NoDepositList
          v-if="stats.no_deposit_total"
          ref="noDepositList"
          class="nodeposit-list"
          :campus-key="campusKey"
          :school-year="schoolYear"
          :semester="semester"
          :preset="noDepositPreset"
          :overall-total="stats.no_deposit_total"
          @open-records="emit('open-records', $event)"
        />
        <StatsDimensionTable
          title="退出原因分佈"
          :export-filename="csvName('退出原因分佈')"
          :rows="withdrawRows"
          :columns="withdrawColumns"
          row-key="reason"
          empty-text="此區間沒有退預繳或退註冊的訪視"
          action-label="查看明細"
          compact
          @action="openWithdrawRecords"
        />
        <p class="hint">依頁首的入學學年與學期；改版前退出、還沒補分類的歸「未分類」，可在訪視明細補上。</p>
      </div>

      <div v-if="showCompare && visited.has('compare') && stats" v-show="sub === 'compare'" id="stats-pane-compare" role="tabpanel" aria-labelledby="stats-tab-compare" tabindex="0" class="stats-pane">
        <p v-if="compareNote" class="hint compare-note">{{ compareNote }}</p>
        <el-alert v-if="compareFailed" type="error" :closable="false" show-icon title="無法讀取五校比較，請重新載入。">
          <el-button size="small" @click="loadCompare()">重新載入</el-button>
        </el-alert>
        <el-skeleton v-else-if="!compareResult" :rows="4" animated />
        <p v-else-if="compareEmpty" class="empty-note" data-test="compare-empty">
          {{ termLabel(compareResult.school_year, compareResult.semester) }}五校都還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有各校的比較。
        </p>
        <CompareTable
          v-else
          :rows="compareResult.rows"
          :school-year="compareResult.school_year"
          :semester="compareResult.semester"
          :export-filename="csvFilename('招生統計', '五校比較', termLabel(compareResult.school_year, compareResult.semester), taipeiToday())"
        />
        <section class="area-compare">
          <div class="area-compare__head">
            <span class="area-compare__label" aria-hidden="true">周邊環境範圍</span>
            <el-radio-group :model-value="compareRadius" size="small" aria-label="範圍" @update:model-value="setCompareRadius">
              <el-radio-button v-for="km in [1, 3, 6]" :key="km" :value="km">{{ km }} 公里</el-radio-button>
            </el-radio-group>
          </div>
          <el-alert v-if="areaCompareFailed" type="error" :closable="false" show-icon title="無法讀取周邊環境，請重新載入。">
            <el-button size="small" @click="loadAreaCompare()">重新載入</el-button>
          </el-alert>
          <el-skeleton v-else-if="!areaCompare" :rows="4" animated />
          <template v-else>
            <AreaCompareTable
              :data="areaCompare"
              :export-filename="csvFilename('招生統計', '五校周邊環境', `${areaCompare.radius_km}公里`, taipeiToday())"
              @open-area="emit('open-area', $event)"
            />
            <p class="hint">{{ AREA_COMPARE_NOTE }}</p>
          </template>
        </section>
      </div>

      <div v-if="visited.has('booking')" v-show="sub === 'booking'" id="stats-pane-booking" role="tabpanel" aria-labelledby="stats-tab-booking" tabindex="0">
        <BookingStatsPane :campus-key="campusKey" :campus-keys="campusKeys" />
      </div>

      <div v-if="visited.has('journey')" v-show="sub === 'journey'" id="stats-pane-journey" role="tabpanel" aria-labelledby="stats-tab-journey" tabindex="0">
        <JourneyTab v-model:filter="journey" :campus-key="campusKey" :active="sub === 'journey'" />
      </div>

      <div v-if="visited.has('potential')" v-show="sub === 'potential'" id="stats-pane-potential" role="tabpanel" aria-labelledby="stats-tab-potential" tabindex="0">
        <PotentialTab :campus-key="campusKey" :active="sub === 'potential'" />
      </div>

      <!-- 資料匯入不在分頁列（沒有對應的 tab），所以是一般的區塊、標題寫在裡面。 -->
      <section v-if="visited.has('imports')" v-show="sub === 'imports'" id="stats-pane-imports" aria-label="資料匯入">
        <ImportsTab :campus-key="campusKey" :active="sub === 'imports'" />
      </section>

      <div v-if="showCompare && visited.has('ads')" v-show="sub === 'ads'" id="stats-pane-ads" role="tabpanel" aria-labelledby="stats-tab-ads" tabindex="0">
        <AdsTab :active="sub === 'ads'" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.stats {
  min-width: 0;
}

/* 導覽列黏在頁首下面：分類、頁首條件、分頁列同一塊，捲到頁面中段也換得了分頁。
   底色用 box-shadow 往右鋪滿（不影響版面寬度、不會多出橫向捲軸），clip-path 只留這一條的高度；
   左邊只鋪到內容區的邊（.main 的 28px 內距），不蓋到側欄。 */
.stats-nav {
  position: sticky;
  top: var(--top-h);
  z-index: 5;
  margin: -28px 0 20px;
  padding-top: 12px;
  background: var(--surface-2);
  box-shadow: 0 0 0 100vmax var(--surface-2);
  clip-path: inset(0 -100vmax 0 -28px);
}

.stats-nav__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.stats-nav__row--tabs {
  flex-wrap: nowrap;
  margin-top: 8px;
  border-bottom: 1px solid var(--line);
}

.stats-nav__groups {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.stats-nav__cats {
  margin-bottom: 0;
}

/* 資料匯入是工具不是統計：樣子比分類輕一階（沒有外框），選中時同分類的選中色。 */
.stats-nav__imports {
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-base);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out);
}

.stats-nav__imports:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.stats-nav__imports.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--admin-accent-hover);
  font-weight: 600;
}

.stats-nav__filters {
  min-width: 0;
}

.stats-tabs {
  display: flex;
  gap: 28px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.stats-tabs::-webkit-scrollbar {
  display: none;
}

.stats-tab {
  position: relative;
  flex: none;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-md);
  white-space: nowrap;
  cursor: pointer;
  transition: color 150ms var(--ease-out);
}

.stats-tab:hover {
  color: var(--admin-accent-hover);
}

.stats-tab[aria-selected='true'] {
  color: var(--admin-accent-hover);
  font-weight: 600;
}

.stats-tab[aria-selected='true']::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: var(--admin-accent);
}

.stats-tab:focus-visible,
.stats-nav__imports:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: -2px;
  border-radius: 4px;
}

.stats-asof {
  flex: none;
  margin: 0;
  white-space: nowrap;
}

/* 內容區橫向裁切：原本用 el-tabs 時，`.el-tabs__content` 自帶 overflow: hidden，區域分析有內容比容器寬
   10px（1440）／23px（390），一直是被它裁掉的；自己畫分頁後少了這層，整頁就多出橫向捲軸（2026-11-20 PR #125 的
   E2E「區域分析不橫向溢出」抓到）。用 clip 不用 hidden：不產生捲動容器，裡面的 sticky 與 scrollIntoView 照常；
   不支援 clip 的瀏覽器（Safari 15）退回 hidden。 */
.stats-panes {
  min-width: 0;
  overflow-x: hidden;
}

@supports (overflow-x: clip) {
  .stats-panes {
    overflow-x: clip;
  }
}

/* 分頁內容可以用鍵盤聚焦（tabpanel），不畫外框搶畫面；從分頁列按 Tab 進來時焦點在裡面第一個控制項才有框。 */
.stats-panes > [role='tabpanel']:focus {
  outline: none;
}

.stats-month-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.stats-month {
  width: 150px;
}

.stats-pane {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.nodeposit-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.nodeposit-kpi {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 4px 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-3);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms var(--ease-out), background-color 150ms var(--ease-out);
}

.nodeposit-kpi > span:first-child {
  grid-column: 1 / -1;
}

.nodeposit-kpi:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.nodeposit-kpi:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: 2px;
}

.nodeposit-kpi strong {
  color: var(--ink-3);
  font-size: var(--text-3xl);
  line-height: 1.2;
}

.nodeposit-kpi--on strong {
  color: var(--el-color-warning-dark-2);
}

.nodeposit-kpi__go {
  color: var(--admin-accent-hover);
  font-size: var(--text-sm);
}

/* 點數字卡會捲到名單：留出黏住的頁首與導覽列的高度，名單標題才不會被蓋住。 */
.nodeposit-list {
  scroll-margin-top: calc(var(--top-h) + 120px);
}

.nodeposit-priority {
  margin: 0;
  color: var(--ink-2);
}

.area-compare {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.area-compare__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.area-compare__label {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.compare-note {
  margin: 0;
}

/* 900px 以下（側欄收成抽屜、頁首可能換行）不黏：分類、條件、分頁加起來約 180px，黏住會佔掉手機三分之一個畫面。 */
@media (max-width: 900px) {
  .stats-nav {
    position: static;
    margin: 0 0 16px;
    padding-top: 0;
    box-shadow: none;
    clip-path: none;
  }

  .stats-nav__cats {
    flex-wrap: nowrap;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .stats-nav__filters {
    flex-basis: 100%;
  }

  .stats-asof {
    display: none;
  }

  .stats-tab {
    min-height: 44px;
  }
}

@media (max-width: 720px) {
  .nodeposit-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
