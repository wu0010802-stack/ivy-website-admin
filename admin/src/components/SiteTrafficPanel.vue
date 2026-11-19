<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import { MIN_VITAL_SAMPLES, RATING_LABELS, TRAFFIC_COVERAGE_EXPANDED_ON, formatVital, trafficPageLabel, vitalRating, vitalTable, type TrafficSummary, type TrafficVital } from '../api/traffic'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'
import DailyBars from './analytics/DailyBars.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './analytics/csvExport'
import { DEFAULT_ANALYTICS_DAYS, type AnalyticsDays } from './analytics/filters'

// 期間由成效統計頁首共用的那一組決定（2026-11-12，原本面板自己有一個選單），這裡只管讀資料與顯示。
// 換期間時告訴頁首「正在更新」（updating），提示寫在期間旁邊。
const props = withDefaults(defineProps<{ days?: AnalyticsDays }>(), { days: DEFAULT_ANALYTICS_DAYS })
const emit = defineEmits<{ updating: [value: boolean] }>()

const summary = ref<TrafficSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<TrafficSummary>(`/admin/analytics/traffic?days=${props.days}`)
    if (requests.isCurrent(request)) summary.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取瀏覽統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.days, load, { immediate: true })

// 換期間時保留上一次的數字、淡一點；只有第一次載入用骨架。
const updating = computed(() => loading.value && summary.value !== null)
watch(updating, (value) => emit('updating', value))
const today = computed(() => summary.value?.daily.at(-1)?.views ?? 0)
const dailyPoints = computed(() => (summary.value?.daily ?? []).map((item) => ({ day: item.day, value: item.views })))
const TRAFFIC_MARKERS = [{ day: TRAFFIC_COVERAGE_EXPANDED_ON, label: '內頁也開始計入瀏覽，這天前後的次數不能直接比較' }]
const rangeText = computed(() => (summary.value ? `${summary.value.since.replaceAll('-', '/')}–${summary.value.until.replaceAll('-', '/')}` : ''))
const shortRange = computed(() => (summary.value ? `${summary.value.since.slice(5).replace('-', '/')}–${summary.value.until.slice(5).replace('-', '/')}` : ''))
// 瀏覽量少時平均不到 1 次：四捨五入會寫成「0 次」，和上面的總數矛盾（2026-11-12 QA L33），改寫「不到 1 次」。
const dailyAverageText = computed(() => {
  const list = summary.value?.daily ?? []
  const average = list.length ? (summary.value?.total_views ?? 0) / list.length : 0
  return average > 0 && average < 1 ? '平均每天不到 1 次' : `平均每天 ${Math.round(average)} 次`
})
const mobileShare = computed(() => {
  const total = summary.value?.total_views ?? 0
  return total ? Math.round(((summary.value?.devices.mobile ?? 0) / total) * 100) : 0
})
const pages = computed(() => {
  const list = summary.value?.pages ?? []
  const max = Math.max(1, ...list.map((p) => p.views))
  return list.map((p) => ({ ...p, label: trafficPageLabel(p), ratio: p.views / max }))
})
const vitals = computed(() => vitalTable(summary.value?.vitals ?? []))
const DEVICES = [{ key: 'mobile', label: '手機' }, { key: 'desktop', label: '電腦' }] as const
const RATING_TAG = { good: 'success', needs_improvement: 'warning', poor: 'danger', too_few: 'info' } as const
const ratingOf = (vital: TrafficVital) => vitalRating(vital)

// 匯出（2026-10-06）：全站五校合計，檔名寫「官網全站」；期間用畫面上這批資料的實際日期。
// 網頁速度的格子照畫面寫「數值 評等 量測 N 次」，沒有資料的格子空白；欄名同畫面。
const dailyCsvName = computed(() => analyticsCsvName('每日瀏覽', '官網全站', rangeText.value))
function vitalCell(metric: TrafficVital['metric'], vital: TrafficVital | null): string {
  return vital ? `${formatVital(metric, vital.p75)} ${RATING_LABELS[ratingOf(vital)]} 量測 ${vital.samples} 次` : ''
}
function exportPages() {
  // 順序同畫面（瀏覽次數由多到少），頁面名稱同畫面上的白話名稱。
  saveAnalyticsCsv(
    analyticsCsvName('各頁瀏覽', '官網全站', rangeText.value),
    ['頁面', '瀏覽次數'],
    pages.value.map((page) => [page.label, page.views]),
  )
}
function exportVitals() {
  saveAnalyticsCsv(
    analyticsCsvName('網頁速度', '官網全站', rangeText.value),
    ['項目', ...DEVICES.map((device) => device.label)],
    vitals.value.map((row) => [row.name, ...DEVICES.map((device) => vitalCell(row.metric, row[device.key]))]),
  )
}
</script>

<template>
  <section class="traffic" aria-label="官網瀏覽與速度" :aria-busy="loading">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="traffic__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !summary" class="panel">
      <el-skeleton animated :rows="4" class="panel__body" aria-label="正在讀取瀏覽統計" />
    </div>

    <div v-else-if="summary" class="traffic__grid" :class="{ 'is-updating': updating }">
      <section class="panel traffic__overview" aria-labelledby="traffic-views-title">
        <div class="panel__head"><h2 id="traffic-views-title">瀏覽次數<span class="traffic__sub num">{{ shortRange }}</span></h2></div>
        <div class="panel__body traffic__body">
          <div class="stat-list traffic__stats">
            <div class="stat">
              <span class="stat__label">這段期間</span>
              <span class="stat__value">{{ summary.total_views }}</span>
              <span class="stat__hint">{{ dailyAverageText }}</span>
            </div>
            <div class="stat">
              <span class="stat__label">今天</span>
              <span class="stat__value">{{ today }}</span>
            </div>
            <div class="stat">
              <span class="stat__label">手機瀏覽比例</span>
              <span class="stat__value">{{ summary.total_views ? `${mobileShare}%` : '—' }}</span>
            </div>
          </div>

          <DailyBars title="每日瀏覽" :points="dailyPoints" unit="次" value-label="瀏覽次數" :markers="TRAFFIC_MARKERS" :export-filename="dailyCsvName" />
          <AnalyticsMeta :period="rangeText" unit="瀏覽次數（不是人數）" :as-of="summary.as_of" coverage="全站五校合計，不分校區權限" />
          <AnalyticsExplainer>
            <p>全站五校合計，不分校區權限，和參觀預約的統計不能直接相比。</p>
            <p>計算首頁、五校介紹頁、預約參觀頁，2026/09/30 起也計入關於我們、特色教學、常春藤環境、入學資訊與最新消息；期間跨過這天時，前後的瀏覽次數不能直接比較。</p>
            <p>不記錄 IP、cookie 或個人資料；訪客開啟「不要追蹤」時不計入。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="traffic-pages-title">
        <div class="panel__head">
          <h2 id="traffic-pages-title">各頁瀏覽</h2>
          <el-button v-if="pages.length" size="small" text data-test="analytics-csv-pages" aria-label="把「各頁瀏覽」匯出 CSV" @click="exportPages">匯出 CSV</el-button>
        </div>
        <div class="panel__body traffic__body">
          <p v-if="!pages.length" class="hint">這段期間還沒有瀏覽紀錄。</p>
          <ol v-else class="traffic__pages">
            <li v-for="p in pages" :key="`${p.page}-${p.campus_key}`" class="traffic__row">
              <span class="traffic__label">{{ p.label }}</span>
              <span class="traffic__track" aria-hidden="true"><span class="traffic__bar" :style="{ width: `${p.ratio * 100}%` }" /></span>
              <span class="traffic__value num">{{ p.views }}</span>
            </li>
          </ol>
        </div>
      </section>

      <section class="panel" aria-labelledby="traffic-vitals-title">
        <div class="panel__head">
          <h2 id="traffic-vitals-title">網頁速度<span class="traffic__sub">多數訪客的體驗</span></h2>
          <el-button v-if="vitals.length" size="small" text data-test="analytics-csv-vitals" aria-label="把「網頁速度」匯出 CSV" @click="exportVitals">匯出 CSV</el-button>
        </div>
        <div class="panel__body traffic__body">
          <p v-if="!vitals.length" class="hint">這段期間還沒有速度資料。</p>
          <template v-else>
            <table class="traffic__vitals">
              <thead>
                <tr><th scope="col">項目</th><th v-for="device in DEVICES" :key="device.key" scope="col">{{ device.label }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in vitals" :key="row.metric">
                  <th scope="row" :title="row.abbr"><span class="traffic__vital-name">{{ row.name }}</span><span class="hint">{{ row.hint }}</span></th>
                  <td v-for="device in DEVICES" :key="device.key">
                    <div v-if="row[device.key]" class="traffic__vital">
                      <span class="num traffic__vital-value">{{ formatVital(row.metric, row[device.key]!.p75) }}</span>
                      <el-tag size="small" :type="RATING_TAG[ratingOf(row[device.key]!)]">{{ RATING_LABELS[ratingOf(row[device.key]!)] }}</el-tag>
                      <span class="hint num">量測 {{ row[device.key]!.samples }} 次</span>
                    </div>
                    <span v-else class="hint">沒有資料</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <AnalyticsExplainer>
              <p>每 4 位訪客中有 3 位的體驗不比這個數字差。量測不到 {{ MIN_VITAL_SAMPLES }} 次時資料太少，先不評等。</p>
            </AnalyticsExplainer>
          </template>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.traffic__alert {
  margin-bottom: 16px;
}

/* 瀏覽次數橫跨整列，各頁瀏覽與網頁速度並排；1100px 以下退回一欄。 */
.traffic__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  transition: opacity 180ms var(--ease-out);
}

.traffic__grid.is-updating {
  opacity: 0.6;
}

.traffic__grid .panel + .panel {
  margin-top: 0;
}

.traffic__overview {
  grid-column: 1 / -1;
}

.traffic__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.traffic__body {
  display: grid;
  gap: 16px;
}

.traffic__body > .hint {
  margin: 0;
}

.traffic__stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.traffic__pages {
  list-style: none;
  margin: 0;
  padding: 0;
}

.traffic__row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
}

.traffic__row + .traffic__row {
  border-top: 1px solid var(--line);
}

.traffic__label {
  color: var(--ink-2);
}

.traffic__track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.traffic__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
}

.traffic__value {
  text-align: right;
  font-weight: 600;
}

.traffic__vitals {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--text-base);
}

.traffic__vitals th,
.traffic__vitals td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.traffic__vitals thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

.traffic__vitals tbody th {
  font-weight: 400;
}

.traffic__vital-name {
  display: block;
  color: var(--ink);
}

.traffic__vital {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.traffic__vital-value {
  font-weight: 600;
}

.traffic__vital .hint {
  flex-basis: 100%;
}

@media (max-width: 1100px) {
  .traffic__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .traffic__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .traffic__row {
    grid-template-columns: 110px minmax(0, 1fr) 44px;
  }

  .traffic__vitals th,
  .traffic__vitals td {
    padding: 10px 6px;
  }

  .traffic__vitals th:first-child,
  .traffic__vitals td:first-child {
    padding-left: 0;
  }
}
</style>
