<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { timingRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 各段要花多久（2026-10-15 規格 §3.3）：中位數與筆數。預繳日是後台標記預繳的日期，補登或事後標記會讓天數偏長；
// 缺時間或日期倒置的不納入、另寫筆數。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const TITLE = '各段要花多久'
const COLUMNS: StatsColumn[] = [
  { key: 'metric', label: '指標', sticky: true },
  { key: 'median', label: '中位數' },
  { key: 'n', label: '筆數', kind: 'count' },
  { key: 'note', label: '說明' },
]
const rows = computed(() => timingRows(props.data))
</script>

<template>
  <StatsDimensionTable
    :title="TITLE"
    :rows="rows"
    :columns="COLUMNS"
    row-key="key"
    empty-text="這段期間沒有預約案件"
    :export-filename="csvName(TITLE)"
    caption="預繳日是後台標記預繳的日期（最後一次標記），補登或事後標記的案件天數會偏長；之後退出的家庭也算預繳過；筆數不足 20 標「樣本較少」。"
  />
</template>
