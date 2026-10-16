<script setup lang="ts" generic="Row extends Record<string, unknown>">
import { computed, ref, useId } from 'vue'
import { NO_VALUE, barWidth, formatRange, formatRate, rateCsvCell, toRange, type StatsColumn } from '../../admissions/statsFormat'
import AnalyticsExplainer from '../analytics/AnalyticsExplainer.vue'
import { notifyError } from '../../composables/notify'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { buildCsv, downloadCsv, rocMonthCsv, type CsvCell } from '../../utils/csv'

// 統計的共用表格：標題＋表格，bar 欄在數字旁畫 CSS 長條（規格 10：不新增圖表套件，
// 長條只是輔助，數字一定寫出來）。手機寬度表格在框內橫捲，sticky 欄固定在左側，
// 頁面本身不溢出（R16）。count／bar 欄缺值寫 0（呼叫端已補齊），text 欄缺值寫「—」。
// 有 actionLabel 時最後多一欄按鈕（區域分析的「查看明細」，2026-10-08）；不做整列可點（列不是按鈕，鍵盤與讀屏不好用）。按鈕欄不匯出。
// 手機（≤720px）不多那一欄：按鈕欄在最右邊，一打開只露幾 px、看不出能橫捲（2026-10-12），改成名稱本身是連結。
// 桌機（721px 以上）按鈕欄固定在表格右緣（sticky right）：表格比框寬、要橫捲時操作還是看得到，不必捲到最右邊才找得到按鈕。
// 有 nameAction 時（區域分析各里表的「在地圖上選取」，2026-10-16）sticky 名稱欄在所有寬度都是原生按鈕，按下 emit('name-action')；
// 和 actionLabel 各管各的：兩個都給時名稱走 nameAction，actionLabel 的按鈕欄在手機也保留（名稱已經被 nameAction 佔了）。
// 泛型 Row：rows 是什麼型別，action 事件就回同一個型別，呼叫端不用自己轉型。
const props = withDefaults(
  defineProps<{
    title: string
    rows: readonly Row[]
    columns: readonly StatsColumn[]
    rowKey: string
    emptyText: string
    numbered?: boolean
    caption?: string
    /** caption 改收進預設收起的「這些數字怎麼算」（details），表格上方只留一行摘要的版面用（2026-10-16）。 */
    captionCollapsed?: boolean
    /** 有值且有資料才顯示「匯出 CSV」；檔名由呼叫端決定（校區、學期、日期）。 */
    exportFilename?: string
    /** 有值時每列最後多一顆這個字的按鈕，按下 emit('action', row)。 */
    actionLabel?: string
    /** 有值時 sticky 名稱欄在所有寬度都是原生按鈕（aria-label 為「${值}：名稱」），按下 emit('name-action', row)；不多一欄。 */
    nameAction?: string
    /** 匯出專用的格值：回傳值優先於畫面值（含 ''＝寫空白），回 undefined 就照欄位規則。 */
    csvCell?: (row: Row, column: StatsColumn) => CsvCell | undefined
    /** 有值時預設只列前 N 列，表格下一顆「顯示全部」（招生機會的各里排行，2026-10-13）；匯出 CSV 一律是全部。 */
    collapsedRows?: number
    /** 匯出用的欄（只在 CSV 多幾欄時給，例如里的變化的「一年前 1–4 歲」，2026-10-14）；沒給就是 columns。 */
    csvColumns?: readonly StatsColumn[]
  }>(),
  { numbered: false, caption: '', captionCollapsed: false, exportFilename: '', actionLabel: '', nameAction: '', collapsedRows: 0 },
)

const emit = defineEmits<{ action: [row: Row]; 'name-action': [row: Row] }>()

const headingId = useId()

const expanded = ref(false)
const collapsible = computed(() => props.collapsedRows > 0 && props.rows.length > props.collapsedRows)
const shownRows = computed(() => (collapsible.value && !expanded.value ? props.rows.slice(0, props.collapsedRows) : props.rows))

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 每個 bar 欄的最大值：長條以它為 100%；欄位指定 barMax 時（數值本身就是比例的欄）改用它。
const maxima = computed(() => {
  const result: Record<string, number> = {}
  for (const column of props.columns) {
    if (column.kind === 'bar') result[column.key] = column.barMax ?? Math.max(0, ...props.rows.map((row) => toNumber(row[column.key])))
  }
  return result
})

function display(row: Row, column: StatsColumn): string {
  const value = row[column.key]
  if (column.kind === 'range') return formatRange(toRange(value))
  if (column.kind === 'rate') return formatRate(typeof value === 'number' ? value : null)
  if (column.kind === 'count' || column.kind === 'bar') return String(toNumber(value))
  if (value === null || value === undefined || value === '') return NO_VALUE
  return String(value)
}

const isNumeric = (column: StatsColumn) =>
  column.kind === 'count' || column.kind === 'rate' || column.kind === 'bar' || column.kind === 'range'

// 按鈕的 aria-label 帶這一列的名稱（第一個 sticky 欄，沒有就第一欄），讀屏才分得出是哪一列的「查看明細」。
const nameColumn = computed(() => props.columns.find((column) => column.sticky) ?? props.columns[0])
// 名稱缺值（畫面上寫「—」）或根本沒有欄位時不寫「查看明細：—」，改寫第幾列，讀屏才分得出是哪一列。
const rowAria = (label: string, row: Row, index: number) => {
  const name = nameColumn.value ? display(row, nameColumn.value) : NO_VALUE
  return name === NO_VALUE ? `${label}（第 ${index + 1} 列）` : `${label}：${name}`
}
const actionAria = (row: Row, index: number) => rowAria(props.actionLabel, row, index)
const nameActionAria = (row: Row, index: number) => rowAria(props.nameAction, row, index)
// 名稱連結只放在 sticky 名稱欄（橫捲時一直看得到）；沒有 sticky 欄的表手機上照舊用按鈕欄。
const narrow = useNarrowScreen()
const stickyName = computed(() => Boolean(nameColumn.value?.sticky))
const nameButtons = computed(() => Boolean(props.nameAction) && stickyName.value)
const nameLinks = computed(() => Boolean(props.actionLabel) && narrow.value && stickyName.value && !nameButtons.value)
const actionColumn = computed(() => Boolean(props.actionLabel) && !nameLinks.value)
const nameAsAction = (column: StatsColumn) => nameLinks.value && column === nameColumn.value
const nameAsNameAction = (column: StatsColumn) => nameButtons.value && column === nameColumn.value

// 匯出（2026-10-03）：欄名、編號同畫面；計數缺值寫 0，比率沒有值寫空白（Excel 會把「—」
// 當文字、算平均時出錯），文字欄畫面上的「—」缺值也寫空白，長條欄只輸出數字；
// 月份欄（csv: 'roc-month'）寫「115年09月」；呼叫端要特別處理的格子走 csvCell。
// 可能範圍欄拆成下限、上限兩欄（2026-10-12）。
function csvValue(row: Row, column: StatsColumn): CsvCell {
  const override = props.csvCell?.(row, column)
  if (override !== undefined) return override
  const value = row[column.key]
  if (column.csv === 'roc-month') return rocMonthCsv(typeof value === 'string' ? value : null)
  if (column.kind === 'rate') return rateCsvCell(typeof value === 'number' ? value : null)
  if (column.kind === 'count' || column.kind === 'bar') return toNumber(value)
  if (value === null || value === undefined || value === '' || value === NO_VALUE) return ''
  return String(value)
}

// 可能範圍欄（2026-10-12）匯出成「下限」「上限」兩個數字欄，Excel 才能排序、算平均；沒有值寫空白。
function csvHeaders(column: StatsColumn): string[] {
  return column.kind === 'range' ? [`${column.label}下限`, `${column.label}上限`] : [column.label]
}

function csvValues(row: Row, column: StatsColumn): CsvCell[] {
  if (column.kind !== 'range') return [csvValue(row, column)]
  const range = toRange(row[column.key])
  return range ? [range.low, range.high] : ['', '']
}

function exportCsv() {
  if (!props.exportFilename) return
  const columns = props.csvColumns ?? props.columns
  const header = [...(props.numbered ? ['#'] : []), ...columns.flatMap(csvHeaders)]
  const rows = props.rows.map((row, index) => [
    ...(props.numbered ? [index + 1] : []),
    ...columns.flatMap((column) => csvValues(row, column)),
  ])
  try {
    downloadCsv(props.exportFilename, buildCsv(header, rows))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
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
    <!-- 標題與表格之間的說明（招生機會的總結，2026-10-13）；caption 是小字，intro 是正文。 -->
    <slot name="intro" />
    <AnalyticsExplainer v-if="caption && captionCollapsed" class="stats-block__how" summary="這些數字怎麼算">
      <p>{{ caption }}</p>
    </AnalyticsExplainer>
    <p v-else-if="caption" class="hint stats-block__caption">{{ caption }}</p>
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
            <th v-if="actionColumn" scope="col" class="stats-table__action"><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in shownRows" :key="String(row[rowKey])">
            <td v-if="numbered" class="stats-table__index num">{{ index + 1 }}</td>
            <template v-for="column in columns" :key="column.key">
              <th v-if="column.sticky" scope="row" class="stats-table__sticky">
                <button v-if="nameAsNameAction(column)" type="button" class="stats-table__name-link" :aria-label="nameActionAria(row, index)" @click="emit('name-action', row)">
                  {{ display(row, column) }}
                </button>
                <button v-else-if="nameAsAction(column)" type="button" class="stats-table__name-link" :aria-label="actionAria(row, index)" @click="emit('action', row)">
                  {{ display(row, column) }}
                </button>
                <template v-else>{{ display(row, column) }}</template>
              </th>
              <td v-else-if="column.kind === 'bar'" class="stats-table__number">
                <span class="stats-bar" aria-hidden="true">
                  <span class="stats-bar__fill" :style="{ width: barWidth(toNumber(row[column.key]), maxima[column.key] ?? 0) }" />
                </span>
                <span class="num">{{ display(row, column) }}</span>
              </td>
              <td v-else :class="{ 'stats-table__number': isNumeric(column), num: isNumeric(column) }">{{ display(row, column) }}</td>
            </template>
            <td v-if="actionColumn" class="stats-table__action">
              <el-button size="small" text type="primary" :aria-label="actionAria(row, index)" @click="emit('action', row)">{{ actionLabel }}</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <el-button
      v-if="rows.length && collapsible"
      class="stats-block__more"
      size="small"
      text
      type="primary"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? `只顯示前 ${collapsedRows} 列` : `顯示全部 ${rows.length} 列` }}
    </el-button>
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

.stats-block__how {
  margin: -4px 0 8px;
}

.stats-block__empty {
  padding: 20px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-3);
  text-align: center;
}

.stats-block__more {
  margin-top: 4px;
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

.stats-table .stats-table__action {
  position: sticky;
  right: 0;
  z-index: 1;
  width: 1%;
  background: var(--surface);
  /* 表格比框寬、要橫捲時，操作欄壓在最右邊：左緣一條細線表示底下還有欄。用 inset 陰影而不是 border，
     border-collapse 的表格 sticky 欄的邊框不會跟著走。 */
  box-shadow: inset 1px 0 0 var(--line);
  text-align: right;
}

.stats-table thead .stats-table__action {
  background: var(--surface-2);
}

/* 名稱按鈕（手機版 actionLabel 的名稱連結、各里表的 nameAction）：不用 el-button（自帶 32px 高，整張表每列被撐高一倍）。 */
.stats-table__name-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  text-align: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
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
