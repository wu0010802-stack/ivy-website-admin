<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import {
  CRUX_DEVICE_LABELS, CRUX_METRICS, cruxAllInsufficient, cruxRating, cruxTrend, formatRatio, latestCruxWeek, type CruxHistory,
} from '../api/googleInsights'
import { RATING_LABELS, VITAL_LABELS, formatVital } from '../api/traffic'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'

// Chrome 真實使用者（2026-11-12，CrUX）：Google 從 Chrome 使用者蒐集的官網速度，放在自己量到的「網頁速度」旁邊對照。
// 不隨整頁的期間變（28 天滾動、每週更新一格）；切到「瀏覽與速度」（active）才讀，後端另外把結果快取 12 小時。
// 沒設定時只留一行小字。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const data = ref<CruxHistory | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const requests = useRequestSequence()
let requested = false

async function load() {
  const request = requests.begin()
  requested = true
  loading.value = true
  failed.value = null
  try {
    const result = await api.get<CruxHistory>('/admin/crux')
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    failed.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取 Chrome 真實使用者數據，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.active, (active) => { if (active && !requested) void load() }, { immediate: true })

const RATING_TAG = { good: 'success', needs_improvement: 'warning', poor: 'danger' } as const
const configured = computed(() => data.value?.configured === true)
const devices = computed(() => data.value?.devices ?? [])
const allInsufficient = computed(() => (data.value ? cruxAllInsufficient(data.value) : false))

// 速度表：一個指標一列、手機與電腦各一欄（同旁邊「網頁速度」的版面）。
const latest = computed(() => devices.value.map((device) => ({ device, week: latestCruxWeek(device) })))
const rows = computed(() =>
  CRUX_METRICS.map(({ key, vital }) => ({
    key,
    ...VITAL_LABELS[vital],
    cells: latest.value.map(({ device, week }) => {
      const value = week?.[key] ?? null
      return {
        form: device.form_factor,
        status: device.status,
        value,
        rating: cruxRating(key, value?.p75),
      }
    }),
    format: (p75: number) => formatVital(vital, p75),
  })),
)
const newestEnd = computed(() => latest.value.map(({ week }) => week?.last_date).filter((day): day is string => !!day).sort().at(-1) ?? '')
const trends = computed(() => devices.value.map((device) => ({ device, weeks: cruxTrend(device) })).filter(({ weeks }) => weeks.length))
const slash = (day: string) => day.replaceAll('-', '/')
</script>

<template>
  <section class="crux" aria-label="Chrome 真實使用者" :aria-busy="loading">
    <el-alert v-if="failed" type="error" :closable="false" show-icon :title="failed" class="crux__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !data" class="panel">
      <el-skeleton animated :rows="3" class="panel__body" aria-label="正在讀取 Chrome 真實使用者數據" />
    </div>

    <section v-else-if="data && !configured" class="panel" aria-labelledby="crux-title">
      <div class="panel__head"><h2 id="crux-title">Chrome 真實使用者</h2></div>
      <div class="panel__body crux__body">
        <p class="hint" data-test="crux-unconfigured">尚未設定</p>
      </div>
    </section>

    <section v-else-if="data && data.error" class="panel" aria-labelledby="crux-title">
      <div class="panel__head"><h2 id="crux-title">Chrome 真實使用者</h2></div>
      <div class="panel__body crux__body">
        <el-alert type="warning" :closable="false" show-icon :title="`暫時讀不到 Chrome 真實使用者數據：${data.error}`" data-test="crux-error">
          <el-button @click="load">重新載入</el-button>
        </el-alert>
      </div>
    </section>

    <section v-else-if="data" class="panel" aria-labelledby="crux-title">
      <div class="panel__head">
        <h2 id="crux-title">Chrome 真實使用者<span class="crux__sub">28 天滾動，每週更新</span></h2>
      </div>
      <div class="panel__body crux__body">
        <p v-if="allInsufficient" class="hint" data-test="crux-insufficient">Chrome 使用者數量還不夠，Google 尚未提供這個網站的數據。</p>
        <template v-else>
          <table class="crux__table" data-test="crux-table">
            <thead>
              <tr><th scope="col">項目</th><th v-for="device in devices" :key="device.form_factor" scope="col">{{ CRUX_DEVICE_LABELS[device.form_factor] }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.key">
                <th scope="row" :title="row.abbr"><span class="crux__name">{{ row.name }}</span><span class="hint">{{ row.hint }}</span></th>
                <td v-for="cell in row.cells" :key="cell.form">
                  <div v-if="cell.value && cell.value.p75 !== null" class="crux__cell">
                    <span class="num crux__value">{{ row.format(cell.value.p75) }}</span>
                    <el-tag v-if="cell.rating" size="small" :type="RATING_TAG[cell.rating]">{{ RATING_LABELS[cell.rating] }}</el-tag>
                    <span class="hint num">良好 {{ formatRatio(cell.value.good) }}・需要改善 {{ formatRatio(cell.value.needs_improvement) }}・不佳 {{ formatRatio(cell.value.poor) }}</span>
                  </div>
                  <span v-else-if="cell.status === 'insufficient'" class="hint">Chrome 使用者數量還不夠</span>
                  <span v-else class="hint">沒有資料</span>
                </td>
              </tr>
            </tbody>
          </table>

          <AnalyticsMeta :period="newestEnd ? `到 ${slash(newestEnd)} 為止的 28 天` : '最近 28 天'" unit="Chrome 使用者的體驗（不是人數）" :as-of="data.as_of" :coverage="data.origin ?? ''" />
          <p class="hint">網域 2026/11/11 才從舊網站換過來，前幾週的數字混有舊網站的資料。</p>

          <details v-if="trends.length" class="crux__trend" data-test="crux-trend">
            <summary>近 25 週走勢</summary>
            <div v-for="trend in trends" :key="trend.device.form_factor" class="crux__scroll" role="region" tabindex="0" :aria-label="`${CRUX_DEVICE_LABELS[trend.device.form_factor]}近 25 週（可左右捲動）`">
              <table class="crux__table crux__table--trend">
                <caption>{{ CRUX_DEVICE_LABELS[trend.device.form_factor] }}</caption>
                <thead>
                  <tr><th scope="col">到這天為止的 28 天</th><th v-for="metric in CRUX_METRICS" :key="metric.key" scope="col" class="num">{{ VITAL_LABELS[metric.vital].name }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="week in trend.weeks" :key="week.last_date">
                    <th scope="row" class="num">{{ slash(week.last_date) }}</th>
                    <td v-for="metric in CRUX_METRICS" :key="metric.key" class="num">{{ week[metric.key].p75 === null ? '—' : formatVital(metric.vital, week[metric.key].p75!) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>

          <AnalyticsExplainer>
            <p>數字是 Google 從使用 Chrome 的訪客蒐集到的真實體驗，不是官網自己量的；每 4 位訪客中有 3 位的體驗不比這個數字差。</p>
            <p>Chrome 使用者不夠多的裝置，Google 不會提供數據。每週更新一次，所以不會天天變。</p>
          </AnalyticsExplainer>
        </template>
      </div>
    </section>
  </section>
</template>

<style scoped>
.crux {
  margin-top: 20px;
}

.crux__alert {
  margin-bottom: 16px;
}

.crux__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.crux__body {
  display: grid;
  gap: 16px;
}

.crux__body > .hint {
  margin: 0;
}

.crux__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--text-base);
}

.crux__table th,
.crux__table td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.crux__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

.crux__table tbody th {
  font-weight: 400;
}

.crux__table .num {
  text-align: right;
  white-space: nowrap;
}

.crux__name {
  display: block;
  color: var(--ink);
}

.crux__cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.crux__value {
  font-weight: 600;
}

.crux__cell .hint {
  flex-basis: 100%;
}

.crux__trend {
  font-size: var(--text-sm);
}

.crux__trend summary {
  min-height: 28px;
  color: var(--admin-accent-strong);
  cursor: pointer;
}

.crux__scroll {
  overflow-x: auto;
  margin-top: 8px;
}

.crux__table--trend {
  table-layout: auto;
  font-size: var(--text-sm);
}

.crux__table--trend caption {
  padding: 4px 0;
  font-weight: 500;
  text-align: left;
}

.crux__table--trend th,
.crux__table--trend td {
  padding: 6px 10px;
}

@media (max-width: 720px) {
  .crux__table th,
  .crux__table td {
    padding: 10px 6px;
  }

  .crux__table th:first-child,
  .crux__table td:first-child {
    padding-left: 0;
  }

  .crux__trend summary {
    min-height: 44px;
  }
}
</style>
