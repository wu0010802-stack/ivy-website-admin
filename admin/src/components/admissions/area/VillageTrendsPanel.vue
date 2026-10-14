<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import BirthSeries from './BirthSeries.vue'
import type { AreaTrends, AreaTrendsVillage } from '../../../api/types'
import { NO_VALUE, type StatsColumn } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import {
  KIDS_LEVEL_LABELS, formatCount, formatDistance, incomeText, kidsNetText, populationVersionLabel, signedCount,
  trendsPlaceName, trendsSummary, trendsUnavailable, villageSchoolsText,
} from './areaFormat'

type Row = AreaTrendsVillage & {
  place: string
  distance: string
  children_text: string
  kids_text: string
  level_text: string
  births_text: string
  migration_text: string
  income_text: string
  schools_text: string
}

// 里的變化（2026-10-14 規格 7.2）：本校半徑內各里這一年 2–5 歲孩子的淨增、近 12 個月出生與全年齡淨遷入，
// 以及所得中位數（C 段；只當背景，規格 V9：不著色、不分級、不排序、不進總結）與國小學區（D 段）。
// 半徑跟招生機會、附近幼兒園同一個 1／3／6 公里（AreaTab 換半徑就重讀）。這裡只呈現後端算好的數字與分級，
// 不另外推估；里界調整過的里後端已合併成一列，名稱寫出來。
const props = defineProps<{
  data: AreaTrends | null
  failed: boolean
  csvName: (title: string) => string
}>()
defineEmits<{ retry: [] }>()

// 2–5 歲：人口都匯入時用長條；有里沒有人口時改用文字欄，缺值寫「—」不寫 0。
const COLUMNS = computed<StatsColumn[]>(() => {
  const withChildren = (props.data?.villages ?? []).every((row) => row.children !== null)
  return [
    { key: 'place', label: '里', sticky: true },
    { key: 'distance', label: '距本校' },
    withChildren ? { key: 'children', label: '2–5 歲', kind: 'bar' } : { key: 'children_text', label: '2–5 歲' },
    { key: 'kids_text', label: '這一年淨增' },
    { key: 'level_text', label: '孩子增減' },
    { key: 'births_text', label: '近 12 個月出生' },
    { key: 'migration_text', label: '近 12 個月淨遷入' },
    { key: 'income_text', label: '所得中位數' },
    { key: 'schools_text', label: '國小學區' },
  ]
})

// 3 公里內常有上百個里：先列淨增最多的 10 個，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const title = computed(() => `里的變化（本校 ${props.data?.radius_km ?? 3} 公里內）`)
const unavailable = computed(() => (props.data ? trendsUnavailable(props.data) : null))
const birthPeriods = computed(() => props.data?.baseline?.births_series ?? [])
const radiusKm = computed(() => props.data?.radius_km ?? 3)
const summary = computed(() => (props.data && !unavailable.value ? trendsSummary(props.data) : null))
const rows = computed<Row[]>(() =>
  (props.data?.villages ?? []).map((row) => ({
    ...row,
    place: trendsPlaceName(row),
    distance: formatDistance(row.distance_m),
    children_text: row.children === null ? NO_VALUE : formatCount(row.children),
    kids_text: kidsNetText(row),
    level_text: KIDS_LEVEL_LABELS[row.kids_level],
    births_text: row.births_12m === null ? NO_VALUE : formatCount(row.births_12m),
    migration_text: signedCount(row.migration_net_12m),
    income_text: incomeText(row),
    schools_text: villageSchoolsText(row),
  })),
)

function monthRange(months: readonly string[]): string {
  if (!months.length) return ''
  const first = populationVersionLabel(months[0]!)
  const last = populationVersionLabel(months[months.length - 1]!)
  return first === last ? first : `${first}到 ${last}`
}

const caption = computed(() => {
  const data = props.data
  if (!data || unavailable.value) return ''
  const { sources } = data
  const parts = [
    '「附近」是里的中心點在半徑內的里。這一年淨增＝本月 2–5 歲減一年前 1–4 歲的同一批孩子，是搬進搬出的結果，不是推估；' +
      '分級：增減 10% 以上且至少 5 位是「增加多／減少多」，3% 以上且至少 3 位是「增加／減少」，一年前 1–4 歲不到 20 位是「孩子少」。',
    '出生依出生登記的戶籍里；淨遷入＝跨區遷入減遷出，加上同區換址的進出。',
    sources.income.year === null
      ? '各里所得資料尚未匯入。'
      : `所得是 ${sources.income.year} 年度綜合所得稅申報戶的中位數，只當背景；* 表示界線在所得年度之後調整過，` +
        '里界調整合併的列不列所得。',
  ]
  const months = [
    sources.population.month
      ? `人口 ${populationVersionLabel(sources.population.month)}${sources.population.year_ago_month ? `與 ${populationVersionLabel(sources.population.year_ago_month)}` : ''}`
      : '',
    sources.births.months.length ? `出生 ${monthRange(sources.births.months)}` : '',
    sources.migration.months.length ? `遷入遷出 ${monthRange(sources.migration.months)}` : '',
  ].filter(Boolean)
  const missing = sources.births.missing.length
    ? `出生缺 ${sources.births.missing.map((month) => populationVersionLabel(month)).join('、')}的資料。`
    : ''
  const income = sources.income.note ? `${sources.income.note}。` : ''
  const schools = `國小學區依 ${sources.school_districts.school_year} 學年度一覽表，「部分」是只有部分鄰屬於那所國小。`
  return `${parts.join('')}${sources.note}（${months.join('、')}）。${missing}${income}${schools}`
})
const emptyText = computed(() => unavailable.value ?? `本校 ${props.data?.radius_km ?? 3} 公里內沒有里的資料。`)

// CSV 寫數字：淨增拆「這一年淨增」「一年前 1–4 歲」兩欄、淨遷入寫有號整數、所得寫千元並另寫年度與界線調整，
// 要拿去算的人不用再拆字；沒有值寫空白。
function csvCell(row: Row, column: StatsColumn): CsvCell | undefined {
  if (column.key === 'kids_text') return row.kids_net ?? ''
  if (column.key === 'kids_base') return row.kids_base ?? ''
  if (column.key === 'children_text') return row.children ?? ''
  if (column.key === 'births_text') return row.births_12m ?? ''
  if (column.key === 'migration_text') return row.migration_net_12m ?? ''
  if (column.key === 'level_text') return row.kids_level === 'unknown' ? '' : row.level_text
  if (column.key === 'income_text') return row.income_median ?? ''
  if (column.key === 'income_year') return row.income_median === null ? '' : (props.data?.sources.income.year ?? '')
  if (column.key === 'income_changed') return row.income_boundary_changed ? '是' : ''
  if (column.key === 'schools_text') return row.schools.length ? villageSchoolsText(row, '；') : ''
  return undefined
}
const csvColumns = computed<StatsColumn[]>(() => {
  const columns = [...COLUMNS.value]
  // 一年前 1–4 歲只在 CSV（淨增的分母）：插在「這一年淨增」後面。
  columns.splice(columns.findIndex((column) => column.key === 'kids_text') + 1, 0, { key: 'kids_base', label: '一年前 1–4 歲' })
  // 所得：畫面的「45.8 萬*」在 CSV 拆成千元、年度、界線是否調整過三欄。
  const income = columns.findIndex((column) => column.key === 'income_text')
  columns.splice(
    income, 1,
    { key: 'income_text', label: '所得中位數（千元）' },
    { key: 'income_year', label: '所得年度' },
    { key: 'income_changed', label: '界線在所得年度後調整' },
  )
  return columns
})
</script>

<template>
  <el-alert v-if="failed" class="trends-error" type="error" :closable="false" show-icon title="無法讀取里的變化，請重新載入。">
    <el-button size="small" @click="$emit('retry')">重新載入</el-button>
  </el-alert>
  <el-skeleton v-else-if="!data" :rows="4" animated />
  <StatsDimensionTable
    v-else
    class="trends"
    :title="title"
    :rows="rows"
    :columns="COLUMNS"
    :csv-columns="csvColumns"
    row-key="key"
    numbered
    :empty-text="emptyText"
    :caption="caption"
    :export-filename="csvName('里的變化')"
    :csv-cell="csvCell"
    :collapsed-rows="COLLAPSED_ROWS"
  >
    <template #intro>
      <div v-if="summary" class="trends-summary">
        <p v-for="line in summary.lines" :key="line">{{ line }}</p>
        <p v-if="summary.note" class="hint">{{ summary.note }}</p>
      </div>
      <BirthSeries
        v-if="!unavailable && birthPeriods.length"
        :periods="birthPeriods"
        :radius-km="radiusKm"
        :csv-name="csvName('近幾年的出生數')"
      />
    </template>
  </StatsDimensionTable>
</template>

<style scoped>
.trends-summary {
  display: grid;
  gap: 2px;
  margin-bottom: 8px;
  color: var(--ink);
}

.trends-summary p {
  margin: 0;
}
</style>
