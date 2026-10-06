<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import { campusLabel } from '../../api/labels'
import type { AdmissionsCompareRow, AdmissionsRate } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { formatRate, type StatsColumn } from '../../admissions/statsFormat'

// 五校比較（官網延伸，規格 9.3）。數字是「招生案件數」：同一個孩子在兩校各參觀一次算兩筆，
// 不是跨校去重後的孩子數。比率同時寫分子分母。計畫名額與名額剩餘兩欄隨名額規劃 2026-10-05 拿掉，
// 後端仍回 target_seats／remaining_seats（併入園務時用得到），這裡不顯示。
const props = defineProps<{ rows: readonly AdmissionsCompareRow[]; schoolYear: number; semester: number | null; exportFilename?: string }>()

const COLUMNS: StatsColumn[] = [
  { key: 'campus', label: '校區', sticky: true },
  { key: 'visit', label: '參觀', kind: 'bar' },
  { key: 'deposit', label: '預繳', kind: 'count' },
  { key: 'enrolled', label: '註冊', kind: 'count' },
  { key: 'effective_deposit', label: '有效預繳', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit', label: '參觀→預繳率' },
  { key: 'visit_to_enrolled', label: '參觀→註冊率' },
  { key: 'deposit_to_enrolled', label: '預繳→註冊率' },
  { key: 'effective_to_enrolled', label: '排除轉期→註冊率' },
]

function rateText(rate: AdmissionsRate): string {
  return `${formatRate(rate.value)}（${rate.numerator}/${rate.denominator}）`
}

const tableRows = computed(() =>
  props.rows.map((row) => ({
    campus_key: row.campus_key,
    campus: campusLabel(row.campus_key),
    visit: row.visit,
    deposit: row.deposit,
    enrolled: row.enrolled,
    effective_deposit: row.effective_deposit,
    pending_deposit: row.pending_deposit,
    visit_to_deposit: rateText(row.visit_to_deposit_rate),
    visit_to_enrolled: rateText(row.visit_to_enrolled_rate),
    deposit_to_enrolled: rateText(row.deposit_to_enrolled_rate),
    effective_to_enrolled: rateText(row.effective_to_enrolled_rate),
  })),
)
const title = computed(() => `五校比較（${termLabel(props.schoolYear, props.semester)}）`)
</script>

<template>
  <StatsDimensionTable
    :title="title"
    :rows="tableRows"
    :columns="COLUMNS"
    row-key="campus_key"
    empty-text="沒有可比較的校區"
    :export-filename="exportFilename"
    caption="數字是招生案件數：同一個孩子在兩校各參觀一次算兩筆，不是跨校去重後的孩子數。比率括號內是分子／分母。"
  />
</template>
