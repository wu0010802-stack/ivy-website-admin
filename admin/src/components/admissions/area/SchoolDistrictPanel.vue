<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaTrends, AreaTrendsSchool } from '../../../api/types'
import { NO_VALUE, type StatsColumn } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import { ENROLLMENT_NOTES, formatCount, schoolKidsNetText, schoolVillagesText, trendsUnavailable } from './areaFormat'

type Row = AreaTrendsSchool & {
  place: string
  villages_text: string
  children_text: string
  kids_text: string
  note: string
}

// 依國小學區（2026-10-14 規格 7.3，D 段）：學區碰到本校半徑內任一個里的國小，每所合計整個學區（含半徑外的里）的
// 2–5 歲孩子、這一年淨增與參觀人數。資料跟「里的變化」同一支 API（AreaTab 讀一次、兩塊共用）；讀取失敗由上面那塊
// 寫錯誤與重試，這裡不重複。被拆鄰或自由學區的里同時算進每一所，各列不能相加，所以沒有合計列。
const props = defineProps<{
  data: AreaTrends | null
  failed: boolean
  csvName: (title: string) => string
}>()

const COLUMNS = computed<StatsColumn[]>(() => {
  const withChildren = (props.data?.schools ?? []).every((row) => row.children !== null)
  return [
    { key: 'place', label: '國小', sticky: true },
    { key: 'villages_text', label: '學區里數' },
    withChildren ? { key: 'children', label: '2–5 歲', kind: 'bar' } : { key: 'children_text', label: '2–5 歲' },
    { key: 'kids_text', label: '這一年淨增' },
    { key: 'visit', label: '參觀人數', kind: 'count' },
    { key: 'rate', label: '參觀率', kind: 'rate' },
    { key: 'note', label: '備註' },
  ]
})

const COLLAPSED_ROWS = 10

const radius = computed(() => props.data?.radius_km ?? 3)
const title = computed(() => `依國小學區（本校 ${radius.value} 公里內）`)
const rows = computed<Row[]>(() =>
  (props.data?.schools ?? []).map((row) => ({
    ...row,
    // 有同名學校（民權、中山、成功…）：校名前面一律加學校所在的區。
    place: `${row.district}${row.name}`,
    villages_text: schoolVillagesText(row),
    children_text: row.children === null ? NO_VALUE : formatCount(row.children),
    kids_text: schoolKidsNetText(row),
    note: ENROLLMENT_NOTES[row.enrollment],
  })),
)
const unavailable = computed(() => {
  const data = props.data
  if (!data) return null
  if (data.campus.lat === null || data.campus.lng === null) return trendsUnavailable(data)
  return null
})
const caption = computed(() => {
  const data = props.data
  if (!data || unavailable.value) return ''
  return (
    `列出學區碰到本校 ${radius.value} 公里內任一個里的國小；整里、部分里都算整個學區（含 ${radius.value} 公里外的里）。` +
    '被拆鄰或自由學區的里同時算進每一所國小，各列不能相加。國小新生依 1 月中的戶籍學區分發。' +
    '115 年 7 月新設的里沿用調整前所屬里的學區。這一年淨增只加算得出的里，* 表示有里界調整過或缺一年前人口的里沒算進去；' +
    `參觀人數的範圍同招生機會（頁首校區與學年學期、對到里的參觀）。${data.sources.school_districts.note}。`
  )
})
const emptyText = computed(() => unavailable.value ?? `本校 ${radius.value} 公里內的里沒有對到國小學區。`)

// CSV 寫數字：學區里數拆「整里」「部分里」兩欄、淨增寫有號整數並另寫「淨增有里沒算進去」。
function csvCell(row: Row, column: StatsColumn): CsvCell | undefined {
  if (column.key === 'villages_text') return row.villages_full
  if (column.key === 'villages_partial') return row.villages_partial
  if (column.key === 'children_text') return row.children ?? ''
  if (column.key === 'kids_text') return row.kids_net ?? ''
  if (column.key === 'kids_partial') return row.kids_partial ? '是' : ''
  return undefined
}
const csvColumns = computed<StatsColumn[]>(() => {
  const columns = COLUMNS.value.map((column) => (column.key === 'villages_text' ? { ...column, label: '學區整里數' } : column))
  columns.splice(columns.findIndex((column) => column.key === 'villages_text') + 1, 0, { key: 'villages_partial', label: '學區部分里數' })
  columns.splice(columns.findIndex((column) => column.key === 'kids_text') + 1, 0, { key: 'kids_partial', label: '淨增有里沒算進去' })
  return columns
})
</script>

<template>
  <template v-if="!failed">
    <el-skeleton v-if="!data" :rows="4" animated />
    <StatsDimensionTable
      v-else
      class="school-districts"
      :title="title"
      :rows="rows"
      :columns="COLUMNS"
      :csv-columns="csvColumns"
      row-key="code"
      numbered
      :empty-text="emptyText"
      :caption="caption"
      caption-collapsed
      :export-filename="csvName('依國小學區')"
      :csv-cell="csvCell"
      :collapsed-rows="COLLAPSED_ROWS"
    />
  </template>
</template>
