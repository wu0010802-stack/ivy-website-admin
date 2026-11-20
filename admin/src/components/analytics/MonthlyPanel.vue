<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import { FORM_STEP_LABELS, SOURCE_LABELS, formatDuration, formatShare, journeyPageLabel } from '../../api/engagement'
import {
  changeText, getMonthly, lastYearMonth, monthLabel, monthRow, type MonthlyItem, type MonthlySummary,
} from '../../api/analyticsMore'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './csvExport'
import { formatCount } from './format'

// 每月比較（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §1）：內容興趣的原始紀錄只留 90 天，
// 這裡讀的是每天重算、之後一直留著的每月彙總，明年同月起每一格下面多一行「比去年同月」。
// 期間與裝置選單在這一類不適用（一列就是一個月），AnalyticsView 會把它們藏起來。只有切到這一類才讀。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const data = ref<MonthlySummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()
let loaded = false

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await getMonthly()
    if (requests.isCurrent(request)) {
      data.value = result
      loaded = true
    }
  } catch (err) {
    if (!requests.isCurrent(request)) return
    error.value = err instanceof ApiError && err.status === 403 ? '沒有權限看每月比較。' : '無法讀取每月比較，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.active, (active) => { if (active && !loaded) void load() }, { immediate: true })

const months = computed(() => data.value?.months ?? [])
const byMonth = computed(() => new Map(months.value.map((item) => [item.month, item])))
const showBookings = computed(() => months.value.some((item) => item.bookings !== null))
const lastYear = (item: MonthlyItem) => byMonth.value.get(lastYearMonth(item.month))
const hasYearOverYear = computed(() => months.value.some((item) => lastYear(item)))

function coverage(item: MonthlyItem): string {
  if (!item.first_day || !item.last_day) return ''
  const first = item.first_day.slice(5).replace('-', '/')
  const last = item.last_day.slice(5).replace('-', '/')
  if (item.complete && item.first_day.endsWith('-01')) return ''
  return item.complete ? `${first} 起` : `${first}–${last}`
}

function mobileShare(item: MonthlyItem): number | null {
  return item.sessions ? (monthRow(item.devices, 'mobile')?.sessions ?? 0) / item.sessions : null
}

function returningShare(item: MonthlyItem): number | null {
  const known = (monthRow(item.returning, 'new')?.sessions ?? 0) + (monthRow(item.returning, 'returning')?.sessions ?? 0)
  return known ? (monthRow(item.returning, 'returning')?.sessions ?? 0) / known : null
}

function visitSessions(item: MonthlyItem): number | null {
  return item.sessions === null ? null : monthRow(item.form, 'visit')?.sessions ?? 0
}

type Column = { key: string; label: string; hint?: string; value: (item: MonthlyItem) => number | null; format?: (value: number) => string; compare?: boolean }
const columns = computed<Column[]>(() => [
  { key: 'views', label: '瀏覽', hint: '次', value: (item) => item.page_views, compare: true },
  { key: 'sessions', label: '造訪', hint: '次', value: (item) => item.sessions, compare: true },
  { key: 'mobile', label: '手機占', value: mobileShare, format: (value) => formatShare(value) },
  { key: 'returning', label: '回訪占', value: returningShare, format: (value) => formatShare(value) },
  { key: 'pages', label: '每次看幾頁', value: (item) => (item.sessions ? (item.visits ?? 0) / item.sessions : null), format: (value) => value.toFixed(1) },
  { key: 'stay', label: '每次停留', hint: '中位數', value: (item) => item.median_session_ms, format: formatDuration },
  { key: 'visit', label: '進到預約頁', hint: '造訪', value: visitSessions, compare: true },
  { key: 'booked', label: '送出預約', hint: '造訪', value: (item) => item.booked_sessions, compare: true },
  ...(showBookings.value ? [{ key: 'bookings', label: '實際預約', hint: '筆', value: (item: MonthlyItem) => item.bookings, compare: true }] : []),
])

function cell(item: MonthlyItem, column: Column): string {
  const value = column.value(item)
  if (value === null || value === undefined) return '—'
  return column.format ? column.format(value) : formatCount(value)
}

function yoy(item: MonthlyItem, column: Column): string {
  const before = lastYear(item)
  if (!before || !column.compare) return ''
  const text = changeText(column.value(item), column.value(before))
  return text ? `去年 ${text}` : ''
}

// 來源：只列有出現過的來源，照所有月份加總由多到少。
const sourceKeys = computed(() => {
  const totals = new Map<string, number>()
  for (const item of months.value) for (const row of item.sources) totals.set(row.key, (totals.get(row.key) ?? 0) + row.sessions)
  return [...totals].sort((a, b) => b[1] - a[1]).map(([key]) => key)
})
const sourceMonths = computed(() => months.value.filter((item) => item.sessions))
const pageKeys = computed(() => {
  const totals = new Map<string, number>()
  for (const item of months.value) for (const row of item.pages) totals.set(row.key, (totals.get(row.key) ?? 0) + row.visits)
  return [...totals].sort((a, b) => b[1] - a[1]).map(([key]) => key)
})
const STEP_KEYS = ['visit', 'campus', 'form_date', 'form_slot', 'form_contact', 'form_submit', 'booking_done'] as const

function sourceCell(item: MonthlyItem, key: string): string {
  const row = monthRow(item.sources, key)
  if (!row?.sessions || !item.sessions) return '0'
  return `${formatCount(row.sessions)}（${formatShare(row.sessions / item.sessions)}）`
}

function exportOverview() {
  saveAnalyticsCsv(
    analyticsCsvName('每月總覽', '全站', months.value.length ? `${months.value.at(-1)!.month}–${months.value[0]!.month}` : ''),
    ['月份', '涵蓋', ...columns.value.map((column) => column.hint ? `${column.label}（${column.hint}）` : column.label)],
    months.value.map((item) => [item.month, coverage(item) || '整月', ...columns.value.map((column) => {
      const value = column.value(item)
      return value === null || value === undefined ? '' : column.format ? column.format(value) : value
    })]),
  )
}

</script>

<template>
  <section class="monthly" aria-label="每月比較" :aria-busy="loading">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="monthly__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !data" class="panel">
      <el-skeleton animated :rows="4" class="panel__body" aria-label="正在讀取每月比較" />
    </div>
    <template v-else-if="data">
      <div class="monthly__context">
        <p class="monthly__lede" data-test="monthly-lede">
          <template v-if="!months.length">還沒有任何一個月的紀錄。</template>
          <template v-else-if="hasYearOverYear">每一格下面是比去年同月多或少。</template>
          <template v-else>每個月的數字會一直留著；到 {{ Number(months.at(-1)!.month.slice(0, 4)) + 1 }} 年 {{ Number(months.at(-1)!.month.slice(5)) }} 月起，每一格下面會多一行「比去年同月」。</template>
        </p>
      </div>

      <section class="panel" :class="{ 'is-empty': !months.length }" aria-labelledby="monthly-overview-title">
        <div class="panel__head">
          <h2 id="monthly-overview-title">每月總覽</h2>
          <el-button v-if="months.length" size="small" text data-test="monthly-csv" aria-label="把「每月總覽」匯出 CSV" @click="exportOverview">匯出 CSV</el-button>
        </div>
        <div v-if="months.length" class="panel__body">
          <div class="monthly__scroll" role="region" tabindex="0" aria-label="每月總覽（可左右捲動）">
            <table class="monthly__table" data-test="monthly-overview">
              <thead>
                <tr>
                  <th scope="col">月份</th>
                  <th v-for="column in columns" :key="column.key" scope="col" class="num">{{ column.label }}<span v-if="column.hint" class="hint">{{ column.hint }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in months" :key="item.month" :data-test="`monthly-${item.month}`">
                  <th scope="row">{{ monthLabel(item.month) }}<span v-if="coverage(item)" class="hint monthly__sub">{{ coverage(item) }}</span></th>
                  <td v-for="column in columns" :key="column.key" class="num">
                    {{ cell(item, column) }}
                    <span v-if="yoy(item, column)" class="hint monthly__sub">{{ yoy(item, column) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>「瀏覽」是頁面被打開的次數；「造訪」是同一個分頁連續看的一串頁面（不是人數）。兩個都從成效統計起算日（{{ data.stats_start ? data.stats_start.slice(5).replace('-', '/') : '—' }}）開始算，本月算到昨天。</p>
            <p>「送出預約」是瀏覽器回報有送出預約的造訪；「實際預約」是那個月官網表單送出、沒有標成測試或重複的預約案件（和招生統計同一個口徑，限有招生統計權限的帳號）。</p>
            <p>「回訪占」只算認得出是不是第一次來的造訪（同一台裝置跨天再來算回訪）。比去年同月的百分比只看次數，不比比例。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section v-if="sourceMonths.length" class="panel" aria-labelledby="monthly-sources-title">
        <div class="panel__head"><h2 id="monthly-sources-title">每月從哪裡來<span class="monthly__head-sub">造訪次數（占當月）</span></h2></div>
        <div class="panel__body">
          <div class="monthly__scroll" role="region" tabindex="0" aria-label="每月從哪裡來（可左右捲動）">
            <table class="monthly__table" data-test="monthly-sources">
              <thead><tr><th scope="col">月份</th><th v-for="key in sourceKeys" :key="key" scope="col" class="num">{{ (SOURCE_LABELS[key] ?? key).replace(/（.*）$/, '') }}</th></tr></thead>
              <tbody>
                <tr v-for="item in sourceMonths" :key="item.month">
                  <th scope="row">{{ monthLabel(item.month) }}</th>
                  <td v-for="key in sourceKeys" :key="key" class="num">{{ sourceCell(item, key) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-if="sourceMonths.length" class="panel" aria-labelledby="monthly-form-title">
        <div class="panel__head"><h2 id="monthly-form-title">每月預約表單走到哪一步<span class="monthly__head-sub">造訪次數</span></h2></div>
        <div class="panel__body">
          <div class="monthly__scroll" role="region" tabindex="0" aria-label="每月預約表單走到哪一步（可左右捲動）">
            <table class="monthly__table" data-test="monthly-form">
              <thead><tr><th scope="col">月份</th><th v-for="key in STEP_KEYS" :key="key" scope="col" class="num">{{ FORM_STEP_LABELS[key] ?? key }}</th></tr></thead>
              <tbody>
                <tr v-for="item in sourceMonths" :key="item.month">
                  <th scope="row">{{ monthLabel(item.month) }}</th>
                  <td v-for="key in STEP_KEYS" :key="key" class="num">{{ formatCount(monthRow(item.form, key)?.sessions ?? 0) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-if="sourceMonths.length" class="panel" aria-labelledby="monthly-pages-title">
        <div class="panel__head"><h2 id="monthly-pages-title">每月各頁<span class="monthly__head-sub">瀏覽次數（停留中位數）</span></h2></div>
        <div class="panel__body">
          <div class="monthly__scroll" role="region" tabindex="0" aria-label="每月各頁（可左右捲動）">
            <table class="monthly__table" data-test="monthly-pages">
              <thead><tr><th scope="col">月份</th><th v-for="key in pageKeys" :key="key" scope="col" class="num">{{ journeyPageLabel(key) }}</th></tr></thead>
              <tbody>
                <tr v-for="item in sourceMonths" :key="item.month">
                  <th scope="row">{{ monthLabel(item.month) }}</th>
                  <td v-for="key in pageKeys" :key="key" class="num">
                    {{ formatCount(monthRow(item.pages, key)?.visits ?? 0) }}
                    <span v-if="monthRow(item.pages, key)?.median_ms" class="hint monthly__sub">{{ formatDuration(monthRow(item.pages, key)!.median_ms!) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.monthly__alert {
  margin-bottom: 16px;
}

.monthly__context {
  margin-bottom: 16px;
}

.monthly__lede {
  margin: 0;
  font-size: var(--text-lg);
  line-height: 1.6;
}

.monthly .panel + .panel {
  margin-top: 20px;
}

.monthly__scroll {
  overflow-x: auto;
}

.monthly__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.monthly__table th,
.monthly__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
  vertical-align: top;
}

.monthly__table thead th {
  font-weight: 500;
}

.monthly__table thead .hint {
  display: block;
  font-weight: 400;
  font-size: var(--text-xs);
}

.monthly__table tbody th {
  font-weight: 500;
}

.monthly__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.monthly__sub {
  display: block;
  font-size: var(--text-xs);
}

.monthly__head-sub {
  margin-left: 8px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}
</style>
