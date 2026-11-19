<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import {
  SEARCH_DEVICE_LABELS, formatCtr, formatPosition, searchPageLabel, searchPeriod, type SearchInsights,
} from '../api/googleInsights'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'
import { DEFAULT_ANALYTICS_DAYS, type AnalyticsDays } from './analytics/filters'

// Google 搜尋（2026-11-12，Search Console）：家長在 Google 搜尋什麼字、點進官網哪一頁。
// 期間由成效統計頁首共用的那一組決定；只有切到這一類（active）才向 Google 要資料，
// 後端另外把結果快取 6 小時，所以重新整理不會一直打 Google。沒設定時只留一行小字。
const props = withDefaults(defineProps<{ days?: AnalyticsDays; active?: boolean }>(), {
  days: DEFAULT_ANALYTICS_DAYS,
  active: true,
})
const emit = defineEmits<{ updating: [value: boolean] }>()

const data = ref<SearchInsights | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const requests = useRequestSequence()
const period = computed(() => searchPeriod(props.days))
// 最近一次送出請求的期間：回到這一類、期間沒變就不重讀。
let requestedKey = ''

async function load() {
  const request = requests.begin()
  const { start, end } = period.value
  requestedKey = `${start}|${end}`
  loading.value = true
  failed.value = null
  try {
    const result = await api.get<SearchInsights>(`/admin/search-insights?start=${start}&end=${end}`)
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    failed.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取 Google 搜尋資料，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(
  [() => props.active, period],
  () => {
    if (props.active && requestedKey !== `${period.value.start}|${period.value.end}`) void load()
  },
  { immediate: true },
)

// 換期間時保留上一次的數字、淡一點；只有第一次載入用骨架。
const updating = computed(() => loading.value && data.value !== null)
watch(updating, (value) => emit('updating', value))

const configured = computed(() => data.value?.configured === true)
const rangeText = computed(() => (data.value?.start && data.value.end ? `${data.value.start.replaceAll('-', '/')}–${data.value.end.replaceAll('-', '/')}` : ''))
const totals = computed(() => data.value?.totals ?? null)
const queries = computed(() => data.value?.queries ?? [])
const pages = computed(() => (data.value?.pages ?? []).map((row) => ({ ...row, label: searchPageLabel(row.page) })))
const devices = computed(() => data.value?.devices ?? [])
const deviceClicks = computed(() => devices.value.reduce((sum, row) => sum + row.clicks, 0))
const deviceShare = (clicks: number) => (deviceClicks.value ? `${Math.round((clicks / deviceClicks.value) * 100)}%` : '—')
</script>

<template>
  <section class="search" aria-label="Google 搜尋" :aria-busy="loading">
    <el-alert v-if="failed" type="error" :closable="false" show-icon :title="failed" class="search__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !data" class="panel">
      <el-skeleton animated :rows="4" class="panel__body" aria-label="正在讀取 Google 搜尋資料" />
    </div>

    <section v-else-if="data && !configured" class="panel" aria-labelledby="search-title">
      <div class="panel__head"><h2 id="search-title">Google 搜尋</h2></div>
      <div class="panel__body search__body">
        <p class="hint" data-test="search-unconfigured">尚未設定</p>
      </div>
    </section>

    <section v-else-if="data && data.error" class="panel" aria-labelledby="search-title">
      <div class="panel__head"><h2 id="search-title">Google 搜尋</h2></div>
      <div class="panel__body search__body">
        <el-alert type="warning" :closable="false" show-icon :title="`暫時讀不到 Google 搜尋資料：${data.error}`" data-test="search-error">
          <el-button @click="load">重新載入</el-button>
        </el-alert>
      </div>
    </section>

    <div v-else-if="data && totals" class="search__view" :class="{ 'is-updating': updating }">
      <section class="panel" aria-labelledby="search-title">
        <div class="panel__head"><h2 id="search-title">Google 搜尋</h2></div>
        <div class="panel__body search__body">
          <div class="stat-list search__stats" data-test="search-totals">
            <div class="stat">
              <span class="stat__label">點進官網</span>
              <span class="stat__value">{{ totals.clicks }}</span>
              <span class="stat__hint">次</span>
            </div>
            <div class="stat">
              <span class="stat__label">出現在搜尋結果</span>
              <span class="stat__value">{{ totals.impressions }}</span>
              <span class="stat__hint">次</span>
            </div>
            <div class="stat">
              <span class="stat__label">點進去的比例</span>
              <span class="stat__value">{{ formatCtr(totals.ctr) }}</span>
            </div>
            <div class="stat">
              <span class="stat__label">平均排名</span>
              <span class="stat__value">{{ formatPosition(totals.position) }}</span>
              <span class="stat__hint">數字越小越前面</span>
            </div>
          </div>
          <AnalyticsMeta :period="rangeText" unit="Google 搜尋結果的曝光與點擊（不是人數）" :as-of="data.as_of" coverage="官網整站，手機、電腦、平板合計" />
          <p class="hint">Google 的搜尋資料約有 2–3 天延遲，期間最後兩三天的數字會偏少。</p>
          <AnalyticsExplainer>
            <p>「出現在搜尋結果」（Google 稱曝光）是官網的連結在 Google 搜尋結果頁出現的次數，「點進官網」（點擊）是有人點了它；「點進去的比例」（點閱率）＝點進官網 ÷ 出現次數。</p>
            <p>平均排名是官網在搜尋結果裡的平均位置（1 是第一個）；排名會因為搜尋字詞不同差很多，只適合看起伏。</p>
            <p>Google 會把搜尋人數很少的字詞隱藏（保護搜尋者），所以下面字詞加起來會比上面的總數少。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <div class="search__cols">
        <section class="panel" aria-labelledby="search-queries-title">
          <div class="panel__head"><h2 id="search-queries-title">搜尋字詞<span class="search__sub">點進官網最多的前 25 個</span></h2></div>
          <div class="panel__body search__body">
            <p v-if="!queries.length" class="hint">這段期間沒有資料。</p>
            <div v-else class="search__scroll" role="region" tabindex="0" aria-label="搜尋字詞（可左右捲動）">
              <table class="search__table" data-test="search-queries">
                <thead><tr><th scope="col">搜尋字詞</th><th scope="col" class="num">點進官網</th><th scope="col" class="num">出現次數</th><th scope="col" class="num">比例</th><th scope="col" class="num">排名</th></tr></thead>
                <tbody>
                  <tr v-for="row in queries" :key="row.query">
                    <th scope="row">{{ row.query }}</th>
                    <td class="num">{{ row.clicks }}</td>
                    <td class="num">{{ row.impressions }}</td>
                    <td class="num">{{ formatCtr(row.ctr) }}</td>
                    <td class="num">{{ formatPosition(row.position) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div class="search__col">
          <section class="panel" aria-labelledby="search-pages-title">
            <div class="panel__head"><h2 id="search-pages-title">被點進去的頁面<span class="search__sub">前 25 頁</span></h2></div>
            <div class="panel__body search__body">
              <p v-if="!pages.length" class="hint">這段期間沒有資料。</p>
              <div v-else class="search__scroll" role="region" tabindex="0" aria-label="被點進去的頁面（可左右捲動）">
                <table class="search__table" data-test="search-pages">
                  <thead><tr><th scope="col">頁面</th><th scope="col" class="num">點進官網</th><th scope="col" class="num">出現次數</th><th scope="col" class="num">比例</th><th scope="col" class="num">排名</th></tr></thead>
                  <tbody>
                    <tr v-for="row in pages" :key="row.page">
                      <th scope="row">
                        <template v-if="row.label">{{ row.label }}<span class="hint search__path">{{ row.page }}</span></template>
                        <template v-else>{{ row.page }}</template>
                      </th>
                      <td class="num">{{ row.clicks }}</td>
                      <td class="num">{{ row.impressions }}</td>
                      <td class="num">{{ formatCtr(row.ctr) }}</td>
                      <td class="num">{{ formatPosition(row.position) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section class="panel" aria-labelledby="search-devices-title">
            <div class="panel__head"><h2 id="search-devices-title">用什麼裝置搜尋</h2></div>
            <div class="panel__body search__body">
              <p v-if="!devices.length" class="hint">這段期間沒有資料。</p>
              <div v-else class="search__scroll">
                <table class="search__table" data-test="search-devices">
                  <thead><tr><th scope="col">裝置</th><th scope="col" class="num">點進官網</th><th scope="col" class="num">占</th><th scope="col" class="num">出現次數</th><th scope="col" class="num">比例</th><th scope="col" class="num">排名</th></tr></thead>
                  <tbody>
                    <tr v-for="row in devices" :key="row.device">
                      <th scope="row">{{ SEARCH_DEVICE_LABELS[row.device] }}</th>
                      <td class="num">{{ row.clicks }}</td>
                      <td class="num">{{ deviceShare(row.clicks) }}</td>
                      <td class="num">{{ row.impressions }}</td>
                      <td class="num">{{ formatCtr(row.ctr) }}</td>
                      <td class="num">{{ formatPosition(row.position) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search {
  margin-top: 20px;
}

.search__alert {
  margin-bottom: 16px;
}

.search__view {
  display: grid;
  gap: 20px;
  min-width: 0;
  transition: opacity 180ms var(--ease-out);
}

.search__view.is-updating {
  opacity: 0.6;
}

.search__view .panel + .panel {
  margin-top: 0;
}

/* 字詞表（最長）在左，頁面與裝置兩張短表疊在右邊；1100px 以下退回一欄。 */
.search__cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.search__col {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.search__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.search__body {
  display: grid;
  gap: 16px;
}

.search__body > .hint {
  margin: 0;
}

.search__stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.search__scroll {
  overflow-x: auto;
}

.search__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.search__table th,
.search__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.search__table .num {
  text-align: right;
  white-space: nowrap;
}

.search__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

.search__table tbody th {
  font-weight: 400;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.search__table tbody tr {
  transition: background-color 120ms var(--ease-out);
}

.search__table tbody tr:hover {
  background: var(--surface-2);
}

.search__path {
  display: block;
}

@media (max-width: 1100px) {
  .search__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .search__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search__table th,
  .search__table td {
    padding: 10px 6px;
  }
}
</style>
