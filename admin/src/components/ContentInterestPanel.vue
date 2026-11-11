<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import {
  MIN_ENGAGEMENT_SAMPLES, SOURCE_LABELS, actionLabel, conversionLabel, engagementPageLabel, formatDuration, formatShare,
  sectionGroups, type EngagementSummary,
} from '../api/engagement'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './analytics/csvExport'

// 內容興趣（2026-11-11）：家長在官網各頁停多久、看到哪些區塊、點了什麼、哪幾篇消息有人讀完，
// 以及看過哪些內容的造訪比較會送出預約。紀錄只留 90 天，期間同「官網瀏覽與速度」。
const DAY_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 28, label: '近 28 天' },
  { value: 90, label: '近 90 天' },
]

const days = ref(28)
const summary = ref<EngagementSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<EngagementSummary>(`/admin/analytics/engagement?days=${days.value}`)
    if (requests.isCurrent(request)) summary.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取內容興趣統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(days, load, { immediate: true })

const periodLabel = computed(() => DAY_OPTIONS.find((option) => option.value === days.value)?.label ?? `近 ${days.value} 天`)
const updating = computed(() => loading.value && summary.value !== null)
const rangeText = computed(() => (summary.value ? `${summary.value.since.replaceAll('-', '/')}–${summary.value.until.replaceAll('-', '/')}` : ''))
const totals = computed(() => summary.value?.totals ?? null)
const few = (count: number) => count < MIN_ENGAGEMENT_SAMPLES

const pages = computed(() => (summary.value?.pages ?? []).map((row) => ({ ...row, label: engagementPageLabel(row.page, row.campus_key) })))
const groups = computed(() => sectionGroups(summary.value?.sections ?? []))
const actions = computed(() =>
  (summary.value?.actions ?? []).flatMap((row) => {
    const label = actionLabel(row.key)
    return label ? [{ ...row, label }] : []
  }),
)
const maxActionVisits = computed(() => Math.max(1, ...actions.value.map((row) => row.visits)))
const news = computed(() => (summary.value?.news ?? []).map((row) => ({ ...row, label: row.title || `已下架或改過代號的消息（${row.id}）` })))
const sources = computed(() => (summary.value?.sources ?? []).map((row) => ({ ...row, label: SOURCE_LABELS[row.source] ?? row.source })))
// 看過哪些內容的造訪比較會預約：樣本夠的排前面，再照預約比例由高到低。
const conversion = computed(() =>
  (summary.value?.conversion ?? [])
    .flatMap((row) => {
      const label = conversionLabel(row)
      return label ? [{ ...row, label }] : []
    })
    .sort((a, b) => Number(few(a.sessions)) - Number(few(b.sessions)) || (b.booked_rate ?? 0) - (a.booked_rate ?? 0) || b.sessions - a.sessions),
)

const csv = (name: string) => analyticsCsvName(name, '官網全站', rangeText.value)
function exportPages() {
  saveAnalyticsCsv(csv('各頁停留'), ['頁面', '瀏覽次數', '停留（中位數）', '10 秒內離開', '捲動深度（中位數）'],
    pages.value.map((row) => [row.label, row.visits, formatDuration(row.median_active_ms), formatShare(row.bounce_rate), `${row.median_scroll_pct}%`]))
}
function exportSections() {
  saveAnalyticsCsv(csv('各區塊觸及'), ['頁面', '區塊', '看到的瀏覽', '看到的比例', '停留（中位數）'],
    groups.value.flatMap((group) => group.rows.map((row) => [group.label, row.label, row.reached, formatShare(row.reach_rate), formatDuration(row.median_ms)])))
}
function exportActions() {
  saveAnalyticsCsv(csv('互動'), ['互動', '做過的瀏覽', '總次數'], actions.value.map((row) => [row.label, row.visits, row.total]))
}
function exportNews() {
  saveAnalyticsCsv(csv('單篇消息'), ['消息', '瀏覽次數', '停留（中位數）', '讀到文末'],
    news.value.map((row) => [row.label, row.visits, formatDuration(row.median_active_ms), formatShare(row.read_rate)]))
}
function exportSources() {
  saveAnalyticsCsv(csv('造訪來源'), ['來源', '造訪次數', '送出預約的造訪', '比例'],
    sources.value.map((row) => [row.label, row.sessions, row.booked_sessions, formatShare(row.booked_rate)]))
}
function exportConversion() {
  saveAnalyticsCsv(csv('內容與預約'), ['看過的內容', '造訪次數', '送出預約的造訪', '比例'],
    conversion.value.map((row) => [row.label, row.sessions, row.booked_sessions, formatShare(row.booked_rate)]))
}
</script>

<template>
  <section class="interest" aria-labelledby="interest-title" :aria-busy="loading">
    <div class="interest__head">
      <h2 id="interest-title" class="interest__section-title">內容興趣（{{ periodLabel }}）</h2>
      <div class="interest__controls">
        <span class="hint" role="status">{{ updating ? '更新中…' : '' }}</span>
        <label class="filter-field">
          <span>期間</span>
          <el-select v-model="days" aria-label="內容興趣的期間">
            <el-option v-for="option in DAY_OPTIONS" :key="option.value" :value="option.value" :label="option.label" />
          </el-select>
        </label>
      </div>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="interest__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !summary" class="panel">
      <el-skeleton animated :rows="4" class="panel__body" aria-label="正在讀取內容興趣統計" />
    </div>

    <div v-else-if="summary && totals" class="interest__grid" :class="{ 'is-updating': updating }">
      <section class="panel interest__wide" aria-labelledby="interest-overview-title">
        <div class="panel__head"><h2 id="interest-overview-title">造訪概況</h2></div>
        <div class="panel__body interest__body">
          <p v-if="!totals.sessions" class="hint" data-test="interest-empty">這段期間還沒有紀錄。這項統計 2026/11/11 上線，上線後的瀏覽才會計入。</p>
          <div v-else class="stat-list interest__stats">
            <div class="stat">
              <span class="stat__label">造訪次數</span>
              <span class="stat__value">{{ totals.sessions }}</span>
              <span class="stat__hint">共看了 {{ totals.visits }} 頁</span>
            </div>
            <div class="stat">
              <span class="stat__label">每次造訪看幾頁</span>
              <span class="stat__value">{{ totals.pages_per_session ?? '—' }}</span>
            </div>
            <div class="stat">
              <span class="stat__label">每次造訪停留</span>
              <span class="stat__value">{{ formatDuration(totals.median_session_ms) }}</span>
              <span class="stat__hint">單頁 {{ formatDuration(totals.median_active_ms) }}（中位數）</span>
            </div>
            <div class="stat">
              <span class="stat__label">送出預約的造訪</span>
              <span class="stat__value">{{ formatShare(totals.booked_rate) }}</span>
              <span class="stat__hint">{{ totals.booked_sessions }} 次</span>
            </div>
          </div>
          <AnalyticsMeta :period="rangeText" unit="造訪與頁面瀏覽（不是人數）" :as-of="summary.as_of" coverage="全站五校合計，不分校區權限" />
          <AnalyticsExplainer>
            <p>「造訪」是同一個瀏覽器分頁從進站到關掉為止；同一位家長隔天再來、或另開分頁，會算成另一次造訪，所以不是人數。</p>
            <p>停留只算分頁在前景、而且一分鐘內有捲動或點擊的時間；一半的瀏覽比「中位數」久、一半比它短。</p>
            <p>手機直接滑掉分頁時，最後一段停留可能送不出來，手機的數字會偏低。訪客開啟「不要追蹤」時不計入，所以次數會比「官網瀏覽與速度」的瀏覽次數少。</p>
            <p>「送出預約的造訪」由瀏覽器回報，只用來比較內容，不是正式的預約數；正式數字看「招生統計 → 參觀預約」。</p>
            <p>不使用 cookie、不記錄 IP 與來源網址；紀錄保留 90 天。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel interest__wide" aria-labelledby="interest-pages-title">
        <div class="panel__head">
          <h2 id="interest-pages-title">各頁停留</h2>
          <el-button v-if="pages.length" size="small" text data-test="interest-csv-pages" aria-label="把「各頁停留」匯出 CSV" @click="exportPages">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!pages.length" class="hint">這段期間還沒有紀錄。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-pages">
              <thead><tr><th scope="col">頁面</th><th scope="col" class="num">瀏覽</th><th scope="col" class="num">停留</th><th scope="col" class="num">10 秒內離開</th><th scope="col" class="num">捲動深度</th></tr></thead>
              <tbody>
                <tr v-for="row in pages" :key="`${row.page}-${row.campus_key}`">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.visits }}</td>
                  <td class="num">{{ formatDuration(row.median_active_ms) }}</td>
                  <td class="num">{{ formatShare(row.bounce_rate) }}</td>
                  <td class="num">{{ row.median_scroll_pct }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>停留與捲動深度是中位數。捲動深度 100% 代表捲到頁面最底；首頁與入學資訊很長，數字低不代表沒興趣，搭配下面的區塊一起看。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-sections-title">
        <div class="panel__head">
          <h2 id="interest-sections-title">各區塊有多少人看到</h2>
          <el-button v-if="groups.length" size="small" text data-test="interest-csv-sections" aria-label="把「各區塊有多少人看到」匯出 CSV" @click="exportSections">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!groups.length" class="hint">這段期間還沒有紀錄。</p>
          <div v-for="group in groups" :key="group.page" class="interest__group" data-test="interest-section-group">
            <h3 class="interest__group-title">{{ group.label }}<span class="hint num">{{ group.visits }} 次瀏覽<template v-if="few(group.visits)">，樣本太少</template></span></h3>
            <ol class="interest__bars">
              <li v-for="row in group.rows" :key="row.key" class="interest__bar-row">
                <span class="interest__bar-label">{{ row.label }}</span>
                <span class="interest__track" aria-hidden="true"><span class="interest__bar" :style="{ width: `${(row.reach_rate ?? 0) * 100}%` }" /></span>
                <span class="interest__bar-value num">{{ formatShare(row.reach_rate) }}</span>
                <span class="interest__bar-note hint num">停留 {{ formatDuration(row.median_ms) }}</span>
              </li>
            </ol>
          </div>
          <AnalyticsExplainer>
            <p>區塊停在畫面中央滿 1 秒才算看到；比例是「看到這個區塊的瀏覽 ÷ 這一頁的瀏覽」。停留是看到的人當中的中位數。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-actions-title">
        <div class="panel__head">
          <h2 id="interest-actions-title">點開了什麼</h2>
          <el-button v-if="actions.length" size="small" text data-test="interest-csv-actions" aria-label="把「點開了什麼」匯出 CSV" @click="exportActions">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!actions.length" class="hint">這段期間還沒有紀錄。</p>
          <ol v-else class="interest__bars" data-test="interest-actions">
            <li v-for="row in actions" :key="`${row.page}-${row.key}`" class="interest__bar-row">
              <span class="interest__bar-label">{{ row.label }}</span>
              <span class="interest__track" aria-hidden="true"><span class="interest__bar" :style="{ width: `${(row.visits / maxActionVisits) * 100}%` }" /></span>
              <span class="interest__bar-value num">{{ row.visits }}</span>
              <span class="interest__bar-note hint num">共 {{ row.total }} 次</span>
            </li>
          </ol>
          <AnalyticsExplainer>
            <p>數字是做過這個動作的瀏覽數（同一次瀏覽點很多下只算一次），後面是總次數。只算「打開」：把拍立得翻回正面、把問題收起來不算。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-news-title">
        <div class="panel__head">
          <h2 id="interest-news-title">單篇消息</h2>
          <el-button v-if="news.length" size="small" text data-test="interest-csv-news" aria-label="把「單篇消息」匯出 CSV" @click="exportNews">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!news.length" class="hint">這段期間還沒有人打開消息內文頁。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-news">
              <thead><tr><th scope="col">消息</th><th scope="col" class="num">瀏覽</th><th scope="col" class="num">停留</th><th scope="col" class="num">讀到文末</th></tr></thead>
              <tbody>
                <tr v-for="row in news" :key="row.id">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.visits }}</td>
                  <td class="num">{{ formatDuration(row.median_active_ms) }}</td>
                  <td class="num">{{ formatShare(row.read_rate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>只算消息內文頁（/news/…）。在首頁直接點開的消息算在「點開了什麼 → 首頁最新消息：點開一則」，不分篇。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-sources-title">
        <div class="panel__head">
          <h2 id="interest-sources-title">從哪裡來</h2>
          <el-button v-if="sources.length" size="small" text data-test="interest-csv-sources" aria-label="把「從哪裡來」匯出 CSV" @click="exportSources">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!sources.length" class="hint">這段期間還沒有紀錄。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-sources">
              <thead><tr><th scope="col">來源</th><th scope="col" class="num">造訪</th><th scope="col" class="num">送出預約</th></tr></thead>
              <tbody>
                <tr v-for="row in sources" :key="row.source">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.sessions }}</td>
                  <td class="num">{{ row.booked_sessions }}<span class="hint">（{{ few(row.sessions) ? '樣本太少' : formatShare(row.booked_rate) }}）</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>只看這次造訪的第一頁是從哪裡點進來的，分成幾類，不保留來源網址。LINE、Facebook 的 App 常不帶來源，認不出來的會算在「直接進站」。</p>
            <p>貼連結時加上 <code>?utm_source=line</code>（或 facebook、instagram）可以分得更準；付費廣告加 <code>utm_medium=cpc</code>。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel interest__wide" aria-labelledby="interest-conversion-title">
        <div class="panel__head">
          <h2 id="interest-conversion-title">看過哪些內容的造訪比較會預約<span class="interest__sub">全部造訪 {{ formatShare(totals.booked_rate) }}</span></h2>
          <el-button v-if="conversion.length" size="small" text data-test="interest-csv-conversion" aria-label="把「看過哪些內容的造訪比較會預約」匯出 CSV" @click="exportConversion">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!conversion.length" class="hint">這段期間還沒有紀錄。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-conversion">
              <thead><tr><th scope="col">看過的內容</th><th scope="col" class="num">造訪</th><th scope="col" class="num">其中送出預約</th><th scope="col" class="num">比例</th></tr></thead>
              <tbody>
                <tr v-for="row in conversion" :key="`${row.kind}-${row.page}-${row.key}`">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.sessions }}</td>
                  <td class="num">{{ row.booked_sessions }}</td>
                  <td class="num">{{ few(row.sessions) ? '樣本太少' : formatShare(row.booked_rate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>以造訪為單位：看過這一頁（或在這個區塊停滿 3 秒）的造訪裡，有多少在同一次造訪送出預約。比例高於「全部造訪」的內容，代表看過它的家長比較常接著預約。</p>
            <p>這是相關，不是因果：本來就想預約的家長也會多看幾頁。造訪不到 {{ MIN_ENGAGEMENT_SAMPLES }} 次的先不算比例。隔天才回來預約的不會算進來。</p>
          </AnalyticsExplainer>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.interest {
  margin-top: 32px;
}

.interest__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 12px;
  margin-bottom: 12px;
}

.interest__section-title {
  font-size: var(--text-lg);
}

.interest__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.interest__controls .filter-field {
  font-size: var(--text-xs);
}

.interest__controls .filter-field :deep(.el-select) {
  width: 140px;
}

.interest__alert {
  margin-bottom: 16px;
}

.interest__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  transition: opacity 180ms var(--ease-out);
}

.interest__grid.is-updating {
  opacity: 0.6;
}

.interest__grid .panel + .panel {
  margin-top: 0;
}

.interest__wide {
  grid-column: 1 / -1;
}

.interest__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.interest__body {
  display: grid;
  gap: 16px;
}

.interest__body > .hint {
  margin: 0;
}

.interest__stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.interest__scroll {
  overflow-x: auto;
}

.interest__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.interest__table th,
.interest__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.interest__table .num {
  text-align: right;
  white-space: nowrap;
}

.interest__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

.interest__table tbody th {
  font-weight: 400;
  color: var(--ink);
}

.interest__group-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 4px;
  font-size: var(--text-base);
  font-weight: 600;
}

.interest__group-title .hint {
  font-weight: 400;
}

.interest__bars {
  list-style: none;
  margin: 0;
  padding: 0;
}

.interest__bar-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 48px;
  align-items: center;
  gap: 2px 12px;
  padding: 7px 0;
}

.interest__bar-row + .interest__bar-row {
  border-top: 1px solid var(--line);
}

.interest__bar-label {
  color: var(--ink-2);
}

.interest__track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.interest__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
}

.interest__bar-value {
  text-align: right;
  font-weight: 600;
}

.interest__bar-note {
  grid-column: 1 / -1;
}

@media (max-width: 1100px) {
  .interest__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .interest__controls {
    width: 100%;
  }

  .interest__controls .filter-field {
    flex: 1;
    font-size: var(--text-base);
  }

  .interest__controls .filter-field :deep(.el-select) {
    width: 100%;
  }

  .interest__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .interest__table th,
  .interest__table td {
    padding: 10px 6px;
  }
}
</style>
