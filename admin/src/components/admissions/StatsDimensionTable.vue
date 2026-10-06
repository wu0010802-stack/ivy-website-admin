<script setup lang="ts">
import { computed, useId } from 'vue'
import { NO_VALUE, barWidth, formatRate, type StatsColumn } from '../../admissions/statsFormat'
import { buildCsv, downloadCsv, type CsvCell } from '../../utils/csv'

// 統計的共用表格：標題＋表格，bar 欄在數字旁畫 CSS 長條（規格 10：不新增圖表套件，
// 長條只是輔助，數字一定寫出來）。手機寬度表格在框內橫捲，sticky 欄固定在左側，
// 頁面本身不溢出（R16）。count／bar 欄缺值寫 0（呼叫端已補齊），text 欄缺值寫「—」。
const props = withDefaults(
  defineProps<{
    title: string
    rows: readonly Record<string, unknown>[]
    columns: readonly StatsColumn[]
    rowKey: string
    emptyText: string
    numbered?: boolean
    caption?: string
    /** 有值且有資料才顯示「匯出 CSV」；檔名由呼叫端決定（校區、學期、日期）。 */
    exportFilename?: string
  }>(),
  { numbered: false, caption: '', exportFilename: '' },
)

const headingId = useId()

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 每個 bar 欄的最大值：長條以它為 100%。
const maxima = computed(() => {
  const result: Record<string, number> = {}
  for (const column of props.columns) {
    if (column.kind === 'bar') result[column.key] = Math.max(0, ...props.rows.map((row) => toNumber(row[column.key])))
  }
  return result
})

function display(row: Record<string, unknown>, column: StatsColumn): string {
  const value = row[column.key]
  if (column.kind === 'rate') return formatRate(typeof value === 'number' ? value : null)
  if (column.kind === 'count' || column.kind === 'bar') return String(toNumber(value))
  if (value === null || value === undefined || value === '') return NO_VALUE
  return String(value)
}

const isNumeric = (column: StatsColumn) => column.kind === 'count' || column.kind === 'rate' || column.kind === 'bar'

// 匯出（2026-10-03）：欄名、編號同畫面；計數缺值寫 0，比率沒有值寫空白（Excel 會把「—」
// 當文字、算平均時出錯），文字欄畫面上的「—」缺值也寫空白，長條欄只輸出數字。
function csvValue(row: Record<string, unknown>, column: StatsColumn): CsvCell {
  const value = row[column.key]
  if (column.kind === 'rate') return typeof value === 'number' ? formatRate(value) : ''
  if (column.kind === 'count' || column.kind === 'bar') return toNumber(value)
  if (value === null || value === undefined || value === '' || value === NO_VALUE) return ''
  return String(value)
}

function exportCsv() {
  if (!props.exportFilename) return
  const header = [...(props.numbered ? ['#'] : []), ...props.columns.map((column) => column.label)]
  const rows = props.rows.map((row, index) => [
    ...(props.numbered ? [index + 1] : []),
    ...props.columns.map((column) => csvValue(row, column)),
  ])
  downloadCsv(props.exportFilename, buildCsv(header, rows))
}
</script>

<template>
  <section class="stats-block" :aria-labelledby="headingId">
    <div class="stats-block__head">
      <h3 :id="headingId" class="stats-block__title">{{ title }}</h3>
      <el-button
        v-if="exportFilename && rows.length"
        size="small"
        text
        data-test="stats-csv"
        :aria-label="`把「${title}」匯出 CSV`"
        @click="exportCsv"
      >
        匯出 CSV
      </el-button>
    </div>
    <p v-if="caption" class="hint stats-block__caption">{{ caption }}</p>
    <p v-if="!rows.length" class="stats-block__empty">{{ emptyText }}</p>
    <div v-else class="stats-block__scroll" role="region" tabindex="0" :aria-label="`${title}（可左右捲動）`">
      <table class="stats-table">
        <thead>
          <tr>
            <th v-if="numbered" scope="col" class="stats-table__index">#</th>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="{ 'stats-table__sticky': column.sticky, 'stats-table__number': isNumeric(column) }"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="String(row[rowKey])">
            <td v-if="numbered" class="stats-table__index num">{{ index + 1 }}</td>
            <template v-for="column in columns" :key="column.key">
              <th v-if="column.sticky" scope="row" class="stats-table__sticky">{{ display(row, column) }}</th>
              <td v-else-if="column.kind === 'bar'" class="stats-table__number">
                <span class="stats-bar" aria-hidden="true">
                  <span class="stats-bar__fill" :style="{ width: barWidth(toNumber(row[column.key]), maxima[column.key] ?? 0) }" />
                </span>
                <span class="num">{{ display(row, column) }}</span>
              </td>
              <td v-else :class="{ 'stats-table__number': isNumeric(column), num: isNumeric(column) }">{{ display(row, column) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.stats-block {
  min-width: 0;
}

.stats-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.stats-block__title {
  margin-bottom: 8px;
  font-size: var(--text-md);
}

.stats-block__caption {
  margin: -4px 0 8px;
}

.stats-block__empty {
  padding: 20px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-3);
  text-align: center;
}

.stats-block__scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.stats-table th,
.stats-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.stats-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.stats-table tbody tr:last-child > * {
  border-bottom: 0;
}

.stats-table tbody th {
  color: var(--ink);
  font-weight: 500;
}

/* 要壓過上面 `.stats-table th, .stats-table td` 的靠左，選擇器多一層。 */
.stats-table .stats-table__number {
  text-align: right;
}

.stats-table .stats-table__index {
  width: 1%;
  color: var(--ink-3);
  text-align: right;
}

.stats-table__sticky {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
}

.stats-table thead .stats-table__sticky {
  background: var(--surface-2);
}

.stats-bar {
  display: inline-block;
  width: 72px;
  height: 6px;
  margin-right: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
  vertical-align: middle;
}

.stats-bar__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

@media (max-width: 720px) {
  .stats-table th,
  .stats-table td {
    padding: 8px 10px;
  }

  .stats-bar {
    width: 40px;
  }
}
</style>
