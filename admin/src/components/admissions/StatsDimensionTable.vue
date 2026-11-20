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
    /** 數字欄的表頭可以點來排序（2026-11-20）：第一次由大到小，再點一次由小到大；預設照呼叫端給的順序。匯出不受影響。 */
    sortable?: boolean
    /** 名稱欄等於這個值的列（「未填寫」）排序時固定在最後，字色淡一階。 */
    pinLast?: string
    /** 欄數少的表不拉滿整頁（名稱和數字隔太遠不好對）：限寬 760px。 */
    compact?: boolean
    /** 區間條上的參考線：這張表全體的比率（百分比）。 */
    average?: number | null
  }>(),
  { numbered: false, caption: '', captionCollapsed: false, exportFilename: '', actionLabel: '', nameAction: '', collapsedRows: 0, sortable: false, pinLast: '', compact: false, average: null },
)

const emit = defineEmits<{ action: [row: Row]; 'name-action': [row: Row] }>()

const headingId = useId()

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 排序（sortable）：只排畫面，匯出仍是呼叫端的順序。比率沒有值（分母 0）的列不論升降都排在有值的後面；
// pinLast 那一列（未填寫）永遠最後。
type SortState = { key: string; dir: 'desc' | 'asc' }
const sort = ref<SortState | null>(null)
const canSort = (column: StatsColumn) => props.sortable && (column.kind === 'count' || column.kind === 'bar' || column.kind === 'rate')
function toggleSort(column: StatsColumn) {
  const current = sort.value
  sort.value = current?.key === column.key ? (current.dir === 'desc' ? { key: column.key, dir: 'asc' } : null) : { key: column.key, dir: 'desc' }
}
const ariaSort = (column: StatsColumn) => (sort.value?.key === column.key ? (sort.value.dir === 'desc' ? 'descending' : 'ascending') : undefined)
const sortHint = (column: StatsColumn) => {
  const dir = sort.value?.key === column.key ? sort.value.dir : null
  return `${column.label}，${dir === 'desc' ? '目前由大到小，按一下改成由小到大' : dir === 'asc' ? '目前由小到大，按一下取消排序' : '按一下由大到小排序'}`
}
const isPinned = (row: Row) => Boolean(props.pinLast) && nameColumn.value !== undefined && row[nameColumn.value.key] === props.pinLast
const sortedRows = computed<readonly Row[]>(() => {
  const state = sort.value
  if (!state && !props.pinLast) return props.rows
  const sign = state?.dir === 'asc' ? 1 : -1
  const valueOf = (row: Row) => (state && typeof row[state.key] === 'number' ? (row[state.key] as number) : null)
  return [...props.rows].sort((a, b) => {
    const pinned = Number(isPinned(a)) - Number(isPinned(b))
    if (pinned || !state) return pinned
    const [x, y] = [valueOf(a), valueOf(b)]
    if (x === null || y === null) return Number(x === null) - Number(y === null)
    return (x - y) * sign
  })
})

const expanded = ref(false)
const collapsible = computed(() => props.collapsedRows > 0 && props.rows.length > props.collapsedRows)
const shownRows = computed(() => (collapsible.value && !expanded.value ? sortedRows.value.slice(0, props.collapsedRows) : sortedRows.value))

// 區間條（range 欄有 rangeOf）：0–100% 的軌道上，色條是可能範圍、點是實際比率、虛線是全體平均。
const hasInterval = computed(() => props.columns.some((column) => column.kind === 'range' && column.rangeOf))
const percentStyle = (value: number) => `${Math.min(100, Math.max(0, value))}%`
function interval(row: Row, column: StatsColumn) {
  const range = toRange(row[column.key])
  const actual = column.rangeOf ? row[column.rangeOf] : null
  return {
    range: range ? { left: percentStyle(range.low), width: `${Math.min(100, Math.max(0, range.high - range.low))}%` } : null,
    dot: typeof actual === 'number' ? percentStyle(actual) : null,
  }
}

// split 欄：「20人 / 80.0%」拆成上面 80.0%、下面 20人；不是這個寫法（「—」）就整格照寫。
function splitCell(row: Row, column: StatsColumn): { main: string; sub: string } | null {
  const value = row[column.key]
  if (typeof value !== 'string') return null
  const [sub, main, ...rest] = value.split(' / ')
  return sub && main && !rest.length ? { main, sub } : null
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
  column.kind === 'count' || column.kind === 'rate' || column.kind === 'bar' || column.kind === 'range' || column.kind === 'split'

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
  <section class="stats-block" :class="{ 'stats-block--compact': compact }" :aria-labelledby="headingId">
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
    <template v-if="hasInterval && rows.length">
      <p class="stats-legend" data-test="stats-interval-legend">
        <span><i class="stats-legend__dot" aria-hidden="true" />實際比率</span>
        <span><i class="stats-legend__range" aria-hidden="true" />可能範圍</span>
        <span v-if="average !== null"><i class="stats-legend__avg" aria-hidden="true" />全體平均 <span class="num">{{ formatRate(average) }}</span></span>
      </p>
      <AnalyticsExplainer class="stats-block__how" summary="怎麼看可能範圍" data-test="stats-explainer">
        <p>可能範圍：依筆數估計真實預繳率大概落在哪裡。筆數少時範圍寬，而且會往這張表的全體平均靠，所以 3 筆裡 3 筆不代表比較好。</p>
        <p>兩列的色條大部分重疊，就還分不出誰高誰低。</p>
      </AnalyticsExplainer>
    </template>
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
              :aria-sort="ariaSort(column)"
            >
              <button
                v-if="canSort(column)"
                type="button"
                class="stats-sort"
                :class="sort?.key === column.key ? `is-${sort.dir}` : ''"
                :title="sortHint(column)"
                @click="toggleSort(column)"
              >
                {{ column.label }}<span class="stats-sort__mark" aria-hidden="true" />
              </button>
              <template v-else>{{ column.label }}</template>
            </th>
            <th v-if="actionColumn" scope="col" class="stats-table__action"><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in shownRows" :key="String(row[rowKey])" :class="{ 'stats-table__row--muted': isPinned(row) }">
            <td v-if="numbered" class="stats-table__index num">{{ isPinned(row) ? '' : index + 1 }}</td>
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
              <td v-else-if="column.kind === 'range' && column.rangeOf" class="stats-table__number stats-table__interval">
                <span class="stats-interval" aria-hidden="true">
                  <span v-if="interval(row, column).range" class="stats-interval__range" :style="interval(row, column).range!" />
                  <span v-if="average !== null" class="stats-interval__avg" :style="{ left: percentStyle(average) }" />
                  <span v-if="interval(row, column).dot" class="stats-interval__dot" :style="{ left: interval(row, column).dot! }" />
                </span>
                <span class="num stats-interval__text">{{ display(row, column) }}</span>
              </td>
              <td v-else-if="column.kind === 'split' && splitCell(row, column)" class="stats-table__number stats-table__split">
                <span class="num">{{ splitCell(row, column)!.main }}</span>
                <small class="num">{{ splitCell(row, column)!.sub }}</small>
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

.stats-block--compact {
  max-width: 760px;
}

.stats-table__row--muted > * {
  color: var(--ink-3);
}

.stats-table tbody .stats-table__row--muted th {
  color: var(--ink-3);
  font-weight: 400;
}

/* 排序鈕：樣子就是表頭的字，後面一個小箭頭；沒排序時箭頭是淡的上下，排序中是操作色的單向。 */
.stats-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.stats-sort__mark::before {
  content: '↕';
  color: var(--line-strong);
  font-size: var(--text-xs);
  font-weight: 400;
}

.stats-sort:hover .stats-sort__mark::before {
  color: var(--ink-2);
}

.stats-sort.is-desc,
.stats-sort.is-asc {
  color: var(--admin-accent-hover);
}

.stats-sort.is-desc .stats-sort__mark::before {
  content: '↓';
  color: var(--admin-accent-hover);
}

.stats-sort.is-asc .stats-sort__mark::before {
  content: '↑';
  color: var(--admin-accent-hover);
}

.stats-sort:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.stats-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 16px;
  margin: -2px 0 4px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.stats-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.stats-legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--admin-accent-hover);
}

.stats-legend__range {
  width: 22px;
  height: 6px;
  border-radius: 3px;
  background: var(--el-color-primary-light-7);
}

.stats-legend__avg {
  height: 14px;
  border-left: 1px dashed var(--ink-3);
}

.stats-table .stats-table__interval {
  white-space: nowrap;
}

.stats-interval {
  position: relative;
  display: inline-block;
  width: 180px;
  height: 14px;
  margin-right: 10px;
  vertical-align: middle;
}

.stats-interval::before {
  content: '';
  position: absolute;
  inset: 6px 0;
  border-radius: 1px;
  background: var(--surface-3);
}

.stats-interval__range {
  position: absolute;
  top: 4px;
  height: 6px;
  border-radius: 3px;
  background: var(--el-color-primary-light-7);
}

.stats-interval__avg {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--ink-3);
}

.stats-interval__dot {
  position: absolute;
  top: 2px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--admin-accent-hover);
}

.stats-interval__text {
  display: inline-block;
  min-width: 4.5em;
  color: var(--ink-2);
}

.stats-table__split {
  line-height: 1.3;
}

.stats-table__split small {
  display: block;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .stats-table th,
  .stats-table td {
    padding: 8px 10px;
  }

  .stats-interval {
    width: 96px;
  }

  .stats-bar {
    width: 40px;
  }
}
</style>
