<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import StatsOverview from './StatsOverview.vue'
import { getStats } from '../../api/admissions'
import { campusLabel, formatDateTime } from '../../api/labels'
import type { AdmissionsStats } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { SEMESTER_LABELS } from '../../admissions/constants'
import { NO_VALUE, formatRate, gradeColumns, priorityLabel, ratio, type StatsColumn, type StatsTarget } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 統計分析（規格 9、10）。頁首的校區與入學學年學期由 AdmissionsView 傳進來；這裡管參考月份、
// 子分頁與讀取。換校區或學期時先清空畫面再讀，只採用最後一次的回應（R15：不殘留別校的數字）。
// 子分頁順序同園務：總覽、班別分析、來源分析、接待分析、未預繳原因（園務的「區域分析」不做）。
// 警示與行動入口指到統計內的子分頁就直接切；指到訪視明細就交給頁面（open-records）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }>()
const emit = defineEmits<{ 'open-records': [filter: { month: string }] }>()

const SUB_TABS = ['stats-overview', 'stats-class', 'stats-source', 'stats-staff', 'stats-nodeposit'] as const
type SubTab = (typeof SUB_TABS)[number]
const subTab = ref<SubTab>('stats-overview')

function isSubTab(value: unknown): value is SubTab {
  return typeof value === 'string' && (SUB_TABS as readonly string[]).includes(value)
}
function setSubTab(name: string | number) {
  if (isSubTab(name)) subTab.value = name
}

const stats = ref<AdmissionsStats | null>(null)
const loading = ref(false)
const failed = ref(false)
// null＝跟著後端取最新有資料的月份（園務 _select_reference_month）。
const referenceMonth = ref<string | null>(null)
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

// 換校區或學年學期：參考月份回到「最新」，畫面清空再讀（不留舊校區的數字）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    referenceMonth.value = null
    void load({ reset: true })
  },
  { immediate: true },
)

// 換參考月份只影響本月、月比、年度累計與警示；保留畫面、蓋一層讀取中。
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
    `${campusLabel(props.campusKey)}在${props.schoolYear === null ? '' : ' '}${scopeLabel.value}還沒有招生訪視。新增訪視，或在「官網預約」確認到場後，這裡就會有統計。`,
)

function navigate(target: { tab: StatsTarget; filter: Record<string, string | number> }) {
  if (target.tab === 'records') {
    const month = target.filter.month
    if (typeof month === 'string' && month) emit('open-records', { month })
    return
  }
  setSubTab(`stats-${target.tab}`)
}

// 表頭照園務 Recruitment{Class,Source,Staff,NoDeposit}Tab 原文。
const GRADE_COLUMNS: StatsColumn[] = [
  { key: 'grade', label: '班別', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]
const SOURCE_COLUMNS: StatsColumn[] = [
  { key: 'source', label: '來源', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]
const STAFF_COLUMNS: StatsColumn[] = [
  { key: 'referrer', label: '接待人員', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]

// 動態欄的 key 加前綴（g: 年級、s: 來源），來源或年級字面上叫 month／total 也不會撞到。
const monthGradeLabels = computed(() =>
  gradeColumns(Object.values(stats.value?.month_grade ?? {}).flatMap((cells) => Object.keys(cells))),
)
const monthGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'month', label: '月份', sticky: true },
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

const staffGradeLabels = computed(() => gradeColumns((stats.value?.by_referrer ?? []).flatMap((row) => Object.keys(row.by_grade))))
const staffGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'referrer', label: '接待人員', sticky: true },
  ...staffGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade })),
])
// 園務 StaffTab：格內「{參觀}人 / {預繳率}」，沒有資料寫「—」。
const staffGradeRows = computed(() =>
  (stats.value?.by_referrer ?? []).map((row) => ({
    referrer: row.referrer,
    ...Object.fromEntries(
      staffGradeLabels.value.map((grade) => {
        const cell = row.by_grade[grade]
        return [`g:${grade}`, cell ? `${cell.visit}人 / ${formatRate(ratio(cell.deposit, cell.visit))}` : NO_VALUE]
      }),
    ),
  })),
)

const crossColumns = computed<StatsColumn[]>(() => [
  { key: 'referrer', label: '介紹者', sticky: true },
  ...(stats.value?.referrer_source_cross.sources ?? []).map((source): StatsColumn => ({ key: `s:${source}`, label: source, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const crossRows = computed(() =>
  (stats.value?.referrer_source_cross.referrers ?? []).map((row) => ({
    referrer: row.referrer,
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
</script>

<template>
  <section class="stats" aria-label="統計分析">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取統計資料，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!stats" :rows="6" animated />
    <template v-else>
      <div class="stats-toolbar">
        <p class="hint stats-scope">
          統計範圍：{{ campusLabel(campusKey) }}・{{ scopeLabel }}（依入學學年學期）・資料時間
          <time class="num">{{ formatDateTime(stats.as_of) }}</time>
        </p>
        <div v-if="hasData" class="filter-field">
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
      </div>

      <el-tabs v-loading="loading" :model-value="subTab" class="stats-subtabs" @update:model-value="setSubTab">
        <el-tab-pane label="總覽" name="stats-overview">
          <StatsOverview v-if="hasData" :stats="stats" @navigate="navigate" />
          <p v-else class="stats-empty">{{ emptyText }}</p>
        </el-tab-pane>

        <el-tab-pane label="班別分析" name="stats-class">
          <div class="stats-pane">
            <StatsDimensionTable title="班別統計" :rows="stats.by_grade" :columns="GRADE_COLUMNS" row-key="grade" empty-text="此區間尚無班別資料" />
            <StatsDimensionTable
              title="月份 × 班別分布"
              :rows="monthGradeRows"
              :columns="monthGradeColumns"
              row-key="month"
              empty-text="此區間尚無班別資料"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="來源分析" name="stats-source">
          <div class="stats-pane">
            <StatsDimensionTable
              title="來源排名明細"
              :rows="stats.by_source"
              :columns="SOURCE_COLUMNS"
              row-key="source"
              numbered
              empty-text="此區間尚無來源資料"
              caption="依家長填的來源原文分組（園務會合併義華的同義字詞，官網不合併）。"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="接待分析" name="stats-staff">
          <div class="stats-pane">
            <StatsDimensionTable
              title="接待人員統計"
              :rows="stats.by_referrer"
              :columns="STAFF_COLUMNS"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="接待人員＝訪視表單的「介紹者」欄。"
            />
            <StatsDimensionTable
              title="接待人員 × 各年級預繳率"
              :rows="staffGradeRows"
              :columns="staffGradeColumns"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="格內寫「參觀人數 / 預繳率」。"
            />
            <StatsDimensionTable
              v-if="crossRows.length"
              title="介紹者 × 來源 交叉分析"
              :rows="crossRows"
              :columns="crossColumns"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="欄位是參觀人數前 10 名的來源；合計含其他來源。"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="未預繳原因" name="stats-nodeposit">
          <div class="stats-pane">
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
              :rows="noDepositRows"
              :columns="noDepositColumns"
              row-key="reason"
              empty-text="此區間尚無未預繳資料"
            />
            <p class="hint">
              名單請到「訪視明細」用「預繳：否」與「未預繳原因」篩選。已退預繳、退註冊的不算未預繳；冷名單＝建檔滿 90 天仍未預繳。
            </p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
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

.stats-empty {
  padding: 32px 16px;
  color: var(--ink-2);
  text-align: center;
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
  font-size: 22px;
}

.nodeposit-kpi--on strong {
  color: var(--el-color-warning-dark-2);
}

.nodeposit-priority {
  margin: 0;
  color: var(--ink-2);
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
