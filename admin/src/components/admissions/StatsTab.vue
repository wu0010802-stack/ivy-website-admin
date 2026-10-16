<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AreaTab from './area/AreaTab.vue'
import CompareTable from './CompareTable.vue'
import NoDepositList from './NoDepositList.vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import StatsOverview from './StatsOverview.vue'
import JourneyTab from './JourneyTab.vue'
import AnalyticsExplainer from '../analytics/AnalyticsExplainer.vue'
import BookingStatsPane from '../analytics/BookingStatsPane.vue'
import { getCompare, getStats } from '../../api/admissions'
import { campusLabel, formatDateTime } from '../../api/labels'
import type { AdmissionsCompare, AdmissionsStats } from '../../api/types'
import { currentTerm, taipeiToday, termLabel } from '../../admissions/academic'
import { SEMESTER_LABELS, UNCLASSIFIED_LABEL, UNCLASSIFIED_WITHDRAW } from '../../admissions/constants'
import { DEFAULT_AREA_VIEW, type AreaView } from '../../admissions/areaView'
import { DEFAULT_JOURNEY_FILTER, type JourneyFilter } from '../../admissions/journeyFormat'
import { NO_VALUE, formatRate, gradeColumns, priorityLabel, ratio, type StatsColumn, type StatsTarget } from '../../admissions/statsFormat'
import { isStatsSub, type StatsSub } from '../../admissions/useAdmissionsFilters'
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
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }>()
const emit = defineEmits<{ 'open-records': [filter: { month?: string; area?: string; withdraw?: string }] }>()

// 統計表的匯出檔名：招生統計-表名-校區-學期-日期（沒選學年寫「全部學年」，只選學期就接上學期，
// 檔名才不會把只有上學期的數字寫成全部）。
const csvTerm = () => {
  if (props.schoolYear) return termLabel(props.schoolYear, props.semester)
  return props.semester === null ? '全部學年' : `全部學年${SEMESTER_LABELS[props.semester === 2 ? 2 : 1]}`
}
const csvName = (title: string) => csvFilename('招生統計', title, campusLabel(props.campusKey), csvTerm(), taipeiToday())

// 子分頁由頁面放在網址（sub，見 useAdmissionsFilters）；單獨掛載（測試）時沒有父層就用元件自己的值。
const sub = defineModel<StatsSub>('sub', { default: 'overview' })
const subTab = computed(() => `stats-${sub.value}`)
const journey = defineModel<JourneyFilter>('journey', { default: () => ({ ...DEFAULT_JOURNEY_FILTER }) })
// 區域分析的地圖模式、選取的里與表格分頁（2026-10-16），同樣由頁面放在網址。
const areaView = defineModel<AreaView>('areaView', { default: () => ({ ...DEFAULT_AREA_VIEW }) })

// 「參觀預約」與「預約全程」讀自己的 API、不用招生統計：兩個子分頁都不等招生統計，上方的統計範圍與說明不顯示。
const ownDataSub = computed(() => sub.value === 'booking' || sub.value === 'journey')

function setSubTab(name: string | number) {
  const value = String(name).replace(/^stats-/, '')
  if (isStatsSub(value)) sub.value = value
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
  setSubTab(`stats-${target.tab}`)
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

watch([subTab, () => compareTerm.value.schoolYear, () => compareTerm.value.semester], () => {
  if (subTab.value === 'stats-compare' && showCompare.value) void loadCompare()
}, { immediate: true })
// 權限更新後只剩一校：子分頁消失，退回總覽。
// 網址帶 sub=compare 但只看得到一校：掛載時也要退回。
watch(showCompare, (visible) => {
  if (!visible && sub.value === 'compare') sub.value = 'overview'
}, { immediate: true })

// 表頭照園務 Recruitment{Class,Source,Staff,NoDeposit}Tab 原文。
const GRADE_COLUMNS: StatsColumn[] = [
  { key: 'grade', label: '班別', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]
const SOURCE_COLUMNS: StatsColumn[] = [
  { key: 'source', label: '來源', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]
// 接待人員＝帶參觀老師（2026-10-06 起，原本看介紹者欄；和園務分歧）。一筆有多位老師時每位各算一次。
const STAFF_COLUMNS: StatsColumn[] = [
  { key: 'tour_guide', label: '接待人員', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
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
  ...staffGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade })),
])
// 園務 StaffTab：格內「{參觀}人 / {預繳率}」，沒有資料寫「—」。
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
// 園務 NoDepositTab 的三張數字卡（> 0 才上色）。
const noDepositKpis = computed(() => {
  const summary = stats.value?.no_deposit_summary
  return [
    { label: '高潛力未預繳', value: summary?.high_potential_count ?? 0 },
    { label: '逾 14 天待追', value: summary?.overdue_followup_count ?? 0 },
    { label: '冷名單', value: summary?.cold_count ?? 0 },
  ]
})

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
    <template v-if="!ownDataSub">
      <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取統計資料，請重新載入。" class="inline-error">
        <el-button size="small" @click="load()">重新載入</el-button>
      </el-alert>
      <el-skeleton v-else-if="!stats" :rows="6" animated />
      <div v-else class="stats-toolbar">
        <p class="hint stats-scope">
          統計範圍：{{ campusLabel(campusKey) }}・{{ scopeLabel }}（依入學學年學期）・資料時間
          <time class="num">{{ formatDateTime(stats.as_of) }}</time>
        </p>
        <AnalyticsExplainer summary="怎麼看可能範圍與預繳速度" class="stats-explainer" data-test="stats-explainer">
          <p>可能範圍：依筆數估計真實預繳率大概落在哪裡。筆數少時範圍寬，而且會往這張表的全體平均靠，所以 3 筆裡 3 筆不代表比較好。</p>
          <p>預繳速度：剛參觀的家長還沒到會預繳的時候，所以「本月預繳比過去慢」「來源結構失衡」是依過去的速度，算到今天應該有幾筆預繳再比較。</p>
        </AnalyticsExplainer>
      </div>
    </template>

    <el-tabs v-if="stats || failed || ownDataSub" v-loading="loading && !ownDataSub" :model-value="subTab" class="stats-subtabs" @update:model-value="setSubTab">
      <el-tab-pane label="總覽" name="stats-overview">
        <template v-if="stats">
          <StatsOverview v-if="hasData" :stats="stats" :csv-name="csvName" @navigate="navigate">
            <template #reference-month>
              <div class="filter-field stats-month-field">
                <span>參考月份</span>
                <!-- 不 teleport：選單留在元件裡，單元測試才找得到選項；外層沒有 overflow:hidden。 -->
                <el-select
                  :model-value="referenceMonth ?? undefined"
                  clearable
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
        </template>
      </el-tab-pane>

      <el-tab-pane label="班別分析" name="stats-class">
        <div v-if="stats" class="stats-pane">
          <StatsDimensionTable
            title="班別統計"
            :rows="stats.by_grade"
            :columns="GRADE_COLUMNS"
            row-key="grade"
            empty-text="此區間尚無班別資料"
            :export-filename="csvName('班別統計')"
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
      </el-tab-pane>

      <el-tab-pane label="來源分析" name="stats-source">
        <div v-if="stats" class="stats-pane">
          <StatsDimensionTable
            title="來源排名明細"
            :export-filename="csvName('來源排名明細')"
            :rows="stats.by_source"
            :columns="SOURCE_COLUMNS"
            row-key="source"
            numbered
            empty-text="此區間尚無來源資料"
            caption="依家長填的來源原文分組，寫法不同會分開算（例如「FB」和「臉書」）。"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="接待分析" name="stats-staff">
        <div v-if="stats" class="stats-pane">
          <StatsDimensionTable
            title="接待人員統計"
            :export-filename="csvName('接待人員統計')"
            :rows="stats.by_tour_guide"
            :columns="STAFF_COLUMNS"
            row-key="tour_guide"
            empty-text="此區間尚無接待資料"
            caption="依訪視表單的「帶參觀老師」計算，一筆有多位老師時每位各算一次。"
          />
          <StatsDimensionTable
            title="接待人員 × 各年級預繳率"
            :export-filename="csvName('接待人員 × 各年級預繳率')"
            :rows="staffGradeRows"
            :columns="staffGradeColumns"
            row-key="tour_guide"
            empty-text="此區間尚無接待資料"
            caption="格內寫「參觀人數 / 預繳率」。"
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
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="區域分析" name="stats-area" lazy>
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
      </el-tab-pane>

      <el-tab-pane label="未預繳與退出原因" name="stats-nodeposit" lazy>
        <div v-if="stats" class="stats-pane">
          <template v-if="stats.no_deposit_total">
            <div class="nodeposit-summary">
              <div
                v-for="item in noDepositKpis"
                :key="item.label"
                class="nodeposit-kpi"
                :class="{ 'nodeposit-kpi--on': item.value > 0 }"
              >
                <span>{{ item.label }}</span>
                <strong class="num">{{ item.value }}</strong>
              </div>
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
            @action="openWithdrawRecords"
          />
          <p class="hint">依頁首的入學學年與學期；改版前退出、還沒補分類的歸「未分類」，可在訪視明細補上。</p>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="showCompare" label="五校比較" name="stats-compare" lazy>
        <div v-if="stats" class="stats-pane">
          <p v-if="compareNote" class="hint compare-note">{{ compareNote }}</p>
          <el-alert v-if="compareFailed" type="error" :closable="false" show-icon title="無法讀取五校比較，請重新載入。">
            <el-button size="small" @click="loadCompare()">重新載入</el-button>
          </el-alert>
          <el-skeleton v-else-if="!compareResult" :rows="4" animated />
          <CompareTable
            v-else
            :rows="compareResult.rows"
            :school-year="compareResult.school_year"
            :semester="compareResult.semester"
            :export-filename="csvFilename('招生統計', '五校比較', termLabel(compareResult.school_year, compareResult.semester), taipeiToday())"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="參觀預約" name="stats-booking" lazy>
        <BookingStatsPane :campus-key="campusKey" :campus-keys="campusKeys" />
      </el-tab-pane>

      <el-tab-pane label="預約全程" name="stats-journey" lazy>
        <JourneyTab v-model:filter="journey" :campus-key="campusKey" :active="sub === 'journey'" />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.stats {
  min-width: 0;
}

.stats-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.stats-scope {
  margin: 0;
}

.stats-explainer {
  flex-basis: 100%;
}

.stats-month {
  width: 180px;
}

.stats-subtabs {
  min-width: 0;
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
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-3);
}

.nodeposit-kpi strong {
  color: var(--ink-3);
  font-size: var(--text-3xl);
}

.nodeposit-kpi--on strong {
  color: var(--el-color-warning-dark-2);
}

.nodeposit-priority {
  margin: 0;
  color: var(--ink-2);
}

.compare-note {
  margin: 0;
}

@media (max-width: 720px) {
  .stats-month {
    width: 100%;
  }

  .nodeposit-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
