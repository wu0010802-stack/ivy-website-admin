<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { funnelRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 全程漏斗（2026-10-15 規格 §3.3）：預約案件 → 已到場 → 有招生訪視 → 預繳過 → 註冊過，再接預繳後退出。
// 每個階段是「曾經到達」，全部從同一批案件往下數；長條以預約案件數為 100%。比率附分子分母。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const TITLE = '全程漏斗'
const COLUMNS: StatsColumn[] = [
  { key: 'stage', label: '階段', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
  { key: 'rate', label: '比率' },
]
// 匯出時比率拆成四欄（指標、百分比、分子、分母），不輸出畫面上的整句；「樣本較少」看分母就知道。
const CSV_COLUMNS: StatsColumn[] = [
  COLUMNS[0]!,
  COLUMNS[1]!,
  { key: 'rate_label', label: '比率指標' },
  { key: 'rate_pct', label: '比率', kind: 'rate' },
  { key: 'numerator', label: '分子', kind: 'count' },
  { key: 'denominator', label: '分母', kind: 'count' },
]
const rows = computed(() => funnelRows(props.data))
</script>

<template>
  <StatsDimensionTable
    :title="TITLE"
    :rows="rows"
    :columns="COLUMNS"
    :csv-columns="CSV_COLUMNS"
    row-key="key"
    empty-text="這段期間沒有預約案件"
    :export-filename="csvName(TITLE)"
    caption="每個階段是「曾經到達」：預繳過包含之後退出的，註冊過包含之後退註冊的；預繳後退出另列在最後。人數是預約案件數，同一個家庭重新預約會算成兩筆。"
  />
</template>
