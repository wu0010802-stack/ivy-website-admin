<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getNotFound, NOT_FOUND_REF_LABELS, type NotFoundSummary } from '../../api/analyticsMore'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './csvExport'
import { DEFAULT_ANALYTICS_DAYS, periodText, type AnalyticsDays } from './filters'
import RowsToggle from './RowsToggle.vue'

// 找不到的網址（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §4）：訪客與搜尋引擎落在哪些不存在的網址，
// 看舊網站（Wix）的連結要補哪些轉址。訪客的次數排前面；爬蟲自己來抓的另列一欄。
const props = withDefaults(defineProps<{ days?: AnalyticsDays; active?: boolean }>(), { days: DEFAULT_ANALYTICS_DAYS, active: true })

const data = ref<NotFoundSummary | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
let requestedDays = 0

async function load() {
  const request = requests.begin()
  requestedDays = props.days
  loading.value = true
  failed.value = false
  try {
    const result = await getNotFound(props.days)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([() => props.active, () => props.days], () => {
  if (props.active && requestedDays !== props.days) void load()
}, { immediate: true })

const paths = computed(() => data.value?.paths ?? [])
const visitorTotal = computed(() => (data.value?.totals ?? []).filter((row) => row.ref !== 'crawler').reduce((sum, row) => sum + row.hits, 0))
const crawlerTotal = computed(() => data.value?.totals.find((row) => row.ref === 'crawler')?.hits ?? 0)
const period = computed(() => (data.value ? periodText(data.value.since, data.value.until) : ''))
const LIMIT = 10
const expanded = ref(false)
const shown = computed(() => (expanded.value ? paths.value : paths.value.slice(0, LIMIT)))

function refText(refs: readonly { ref: string; hits: number }[]): string {
  return refs.filter((row) => row.ref !== 'crawler').map((row) => `${(NOT_FOUND_REF_LABELS[row.ref] ?? row.ref).replace(/（.*）$/, '')} ${row.hits}`).join('、')
}

function crawlerHits(refs: readonly { ref: string; hits: number }[]): number {
  return refs.find((row) => row.ref === 'crawler')?.hits ?? 0
}

function exportCsv() {
  if (!data.value) return
  saveAnalyticsCsv(analyticsCsvName('找不到的網址', '全站', period.value), ['網址', '訪客次數', '訪客從哪裡來', '爬蟲次數', '最後一次'],
    paths.value.map((row) => [row.path, row.visitor_hits, refText(row.refs), crawlerHits(row.refs), row.last_day]))
}
</script>

<template>
  <section class="panel not-found" :class="{ 'is-empty': data && !paths.length, 'is-updating': loading && data }" aria-labelledby="not-found-title" :aria-busy="loading">
    <div class="panel__head">
      <h2 id="not-found-title">找不到的網址</h2>
      <el-button v-if="paths.length" size="small" text data-test="not-found-csv" aria-label="把「找不到的網址」匯出 CSV" @click="exportCsv">匯出 CSV</el-button>
    </div>
    <div class="panel__body not-found__body">
      <p v-if="failed" class="hint">讀不到找不到的網址。<el-button size="small" text @click="load">重新載入</el-button></p>
      <el-skeleton v-else-if="loading && !data" animated :rows="2" aria-label="正在讀取找不到的網址" />
      <p v-else-if="!paths.length" class="hint" data-test="not-found-empty">這段期間沒有人或搜尋引擎打開不存在的網址。</p>
      <template v-else>
        <p class="not-found__lede" data-test="not-found-lede">
          {{ period }}，訪客打開不存在的網址 <strong class="num">{{ visitorTotal }}</strong> 次，搜尋引擎與 AI 爬蟲另外抓到 <strong class="num">{{ crawlerTotal }}</strong> 次，共 {{ data!.paths_total }} 個網址。
        </p>
        <div class="not-found__scroll" role="region" tabindex="0" aria-label="找不到的網址（可左右捲動）">
          <table class="not-found__table" data-test="not-found-paths">
            <thead>
              <tr>
                <th scope="col">網址</th>
                <th scope="col" class="num">訪客</th>
                <th scope="col">訪客從哪裡來</th>
                <th scope="col" class="num">爬蟲</th>
                <th scope="col" class="num">最後一次</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shown" :key="row.path">
                <th scope="row" class="not-found__path">{{ row.path }}</th>
                <td class="num">{{ row.visitor_hits }}</td>
                <td class="not-found__refs">{{ refText(row.refs) || '—' }}</td>
                <td class="num">{{ crawlerHits(row.refs) }}</td>
                <td class="num">{{ row.last_day.slice(5).replace('-', '/') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <RowsToggle v-model="expanded" :total="paths.length" :limit="LIMIT" />
      </template>
      <AnalyticsExplainer>
        <p>訪客看到「找不到網頁」時，官網記下網址（不含 ? 後面的參數）與從哪裡點來的；搜尋引擎與 AI 爬蟲抓到不存在的網址，官網伺服器另外記。</p>
        <p>次數多、而且是舊網站（Wix）網址的，可以請協助維護官網的人加轉址，把人帶到對應的新頁面。「官網自己的連結」代表站內有壞掉的連結，要修。紀錄留 90 天。</p>
      </AnalyticsExplainer>
    </div>
  </section>
</template>

<style scoped>
.not-found {
  margin-top: 20px;
  transition: opacity 180ms var(--ease-out);
}

.not-found.is-updating {
  opacity: 0.6;
}

.not-found__body {
  display: grid;
  gap: 12px;
}

.not-found__body > .hint,
.not-found__lede {
  margin: 0;
}

.not-found__scroll {
  overflow-x: auto;
}

.not-found__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.not-found__table th,
.not-found__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.not-found__table tbody th {
  font-weight: 500;
}

.not-found__path {
  max-width: 28em;
  overflow-wrap: anywhere;
  white-space: normal !important;
}

.not-found__refs {
  white-space: normal !important;
  min-width: 12em;
}

.not-found__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
