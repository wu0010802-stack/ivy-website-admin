<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AreaCompare } from '../../api/types'
import { areaCompareCells } from '../../admissions/areaCompareFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 五校周邊環境（2026-11-16 規格 §6.2）：一校一列，數字都是公開人口與園所資料，不打分數、不排名次、不下結論。
// 校區名是按鈕，交給頁面切到那一校的區域分析（open-area）；匯出 CSV 欄同畫面。
const props = defineProps<{ data: AreaCompare; exportFilename: string }>()
const emit = defineEmits<{ 'open-area': [campusKey: string] }>()

const COLUMNS: StatsColumn[] = [
  { key: 'campus', label: '校區', sticky: true },
  { key: 'children', label: '2–5 歲' },
  { key: 'kids_net', label: '一年增減' },
  { key: 'kg_private', label: '私立' },
  { key: 'kg_quasi_public', label: '準公共' },
  { key: 'kg_public', label: '公立' },
  { key: 'kg_nonprofit', label: '非營利' },
  { key: 'babycare', label: '托嬰' },
  { key: 'own_fee', label: '本校 3 歲收費' },
  { key: 'fee_median', label: '私立一般中位數' },
  { key: 'fee_rank', label: '排名' },
  { key: 'changes_12m', label: '近 12 月異動' },
]

const rows = computed(() => props.data.rows.map((row) => ({ campus_key: row.campus_key, ...areaCompareCells(row) })))
const title = computed(() => `周邊環境（${props.data.radius_km} 公里內）`)
</script>

<template>
  <StatsDimensionTable
    :title="title"
    :rows="rows"
    :columns="COLUMNS"
    row-key="campus_key"
    empty-text="沒有可比較的校區"
    name-action="看區域分析"
    :export-filename="exportFilename"
    @name-action="emit('open-area', $event.campus_key)"
  />
</template>
