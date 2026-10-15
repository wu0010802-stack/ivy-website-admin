<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaEnrolled } from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { ENROLLED_GRADE_ORDER, enrolledBandRows, enrolledVillageRows, type GradeFilter } from './areaFormat'

// 在籍學生（2026-10-15 規格 §6）：距離分布（距離帶 × 班別）與里排行（跟著地圖上的班別篩選）。
// 只呈現後端的聚合數字；匯出的 CSV 也只有這些數字。
const props = defineProps<{
  data: AreaEnrolled | null
  failed: boolean
  gradeFilter: GradeFilter
  csvName: (title: string) => string
}>()
defineEmits<{ retry: [] }>()

// 里排行先列 10 個，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const grades = computed(() =>
  ENROLLED_GRADE_ORDER.filter((grade) => grade !== '其他' || props.data?.grades.some((item) => item.grade === '其他')),
)
const bandColumns = computed<StatsColumn[]>(() => [
  { key: 'band_label', label: '距本校', sticky: true },
  ...grades.value.map((grade): StatsColumn => ({ key: grade, label: grade, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const bandRows = computed(() => (props.data ? enrolledBandRows(props.data) : []))
const filterLabel = computed(() => (props.gradeFilter === 'all' ? '全部' : props.gradeFilter))
const VILLAGE_COLUMNS: StatsColumn[] = [
  { key: 'place', label: '里', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
]
const villageRows = computed(() => (props.data ? enrolledVillageRows(props.data, props.gradeFilter) : []))
</script>

<template>
  <el-alert v-if="failed" class="enrolled-error" type="error" :closable="false" show-icon title="無法讀取在籍學生，請重新載入。">
    <el-button size="small" @click="$emit('retry')">重新載入</el-button>
  </el-alert>
  <div v-else-if="data && data.status === 'ready'" class="enrolled-panel">
    <StatsDimensionTable
      title="在籍學生距離分布"
      :rows="bandRows"
      :columns="bandColumns"
      row-key="band"
      empty-text="沒有在籍學生"
      :export-filename="csvName('在籍學生距離分布')"
    />
    <StatsDimensionTable
      :title="`在籍學生里排行（${filterLabel}）`"
      :rows="villageRows"
      :columns="VILLAGE_COLUMNS"
      row-key="key"
      numbered
      empty-text="這個班別沒有比對到里的學生"
      :export-filename="csvName(`在籍學生里排行-${filterLabel}`)"
      :collapsed-rows="COLLAPSED_ROWS"
    />
  </div>
</template>

<style scoped>
.enrolled-panel {
  display: grid;
  gap: 16px;
}

@media (min-width: 1200px) {
  .enrolled-panel {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
