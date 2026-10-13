<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaOpportunity, AreaOpportunityRow } from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import {
  expectedText, formatDistance, opportunitySummary, opportunityUnavailable, populationVersionLabel, signalText,
} from './areaFormat'

type Row = AreaOpportunityRow & { place: string; distance: string; expected_text: string; signal_text: string }

// 招生機會（2026-10-13 規格 7.3）：本校半徑內各里的 2–5 歲孩子、參觀率，和附近平均比明顯偏少的里排最前面。
// 半徑跟著附近幼兒園那一個 1／3／6 公里走（AreaTab 換半徑就重讀）。這裡只呈現後端算好的數字與判讀，
// 不另外推估；判讀約有一成機率是誤報，說明寫在表格下。
const props = defineProps<{
  data: AreaOpportunity | null
  failed: boolean
  csvName: (title: string) => string
}>()
defineEmits<{ retry: [] }>()

const COLUMNS: StatsColumn[] = [
  { key: 'place', label: '里', sticky: true },
  { key: 'distance', label: '距本校' },
  { key: 'children', label: '2–5 歲', kind: 'bar' },
  { key: 'infants', label: '0–1 歲', kind: 'count' },
  { key: 'visit', label: '參觀人數', kind: 'count' },
  { key: 'rate', label: '參觀率', kind: 'rate' },
  { key: 'expected_text', label: '照附近應有' },
  { key: 'signal_text', label: '判讀' },
]

// 3 公里內常有上百個里：先列少最多的 10 個，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const title = computed(() => `招生機會（本校 ${props.data?.radius_km ?? 3} 公里內）`)
const unavailable = computed(() => (props.data ? opportunityUnavailable(props.data) : null))
const summary = computed(() => (props.data ? opportunitySummary(props.data) : null))
const rows = computed<Row[]>(() =>
  (props.data?.villages ?? []).map((row) => ({
    ...row,
    place: `${row.district}${row.village}`,
    distance: formatDistance(row.distance_m),
    expected_text: expectedText(row.expected),
    signal_text: signalText(row),
  })),
)
const caption = computed(() => {
  const data = props.data
  if (!data?.population.version || unavailable.value) return ''
  return (
    '「附近」是里的中心點在半徑內的里。參觀率＝參觀人數 ÷ 2–5 歲孩子數；照附近應有＝孩子數 × 本校附近的參觀率。' +
    '「少了約 N 位」只標和附近比明顯偏少的里，約有一成機率是誤報。' +
    `${data.population.source_note}，${populationVersionLabel(data.population.version)}。`
  )
})
const emptyText = computed(() => unavailable.value ?? `本校 ${props.data?.radius_km ?? 3} 公里內沒有里的人口資料。`)

// CSV 的「照附近應有」寫數字（小數一位），不寫「約」：要拿去算的人不用再拆字。
function csvCell(row: Row, column: StatsColumn): CsvCell | undefined {
  if (column.key === 'expected_text') return row.expected ?? ''
  return undefined
}
</script>

<template>
  <el-alert v-if="failed" class="opportunity-error" type="error" :closable="false" show-icon title="無法讀取招生機會，請重新載入。">
    <el-button size="small" @click="$emit('retry')">重新載入</el-button>
  </el-alert>
  <el-skeleton v-else-if="!data" :rows="4" animated />
  <StatsDimensionTable
    v-else
    class="opportunity"
    :title="title"
    :rows="rows"
    :columns="COLUMNS"
    row-key="village_code"
    numbered
    :empty-text="emptyText"
    :caption="caption"
    :export-filename="csvName('招生機會')"
    :csv-cell="csvCell"
    :collapsed-rows="COLLAPSED_ROWS"
  >
    <template #intro>
      <div v-if="summary" class="opportunity-summary">
        <p>{{ summary.lead }}<strong>{{ summary.verdict }}</strong></p>
        <p v-if="summary.note" class="hint">{{ summary.note }}</p>
      </div>
    </template>
  </StatsDimensionTable>
</template>

<style scoped>
.opportunity-summary {
  display: grid;
  gap: 2px;
  margin-bottom: 8px;
  color: var(--ink);
}

.opportunity-summary p {
  margin: 0;
}

.opportunity-summary strong {
  font-weight: 600;
}
</style>
