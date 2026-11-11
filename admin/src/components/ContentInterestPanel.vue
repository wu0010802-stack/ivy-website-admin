<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import {
  CLASS_LABELS, FORM_STEP_LABELS, HOUR_BANDS, MIN_ENGAGEMENT_SAMPLES, SOURCE_LABELS, STORY_KIND_LABELS, WEEKDAY_LABELS,
  actionLabel, conversionLabel, engagementPageLabel, formatDelta, formatDuration, formatShare, hourGrid, journeyPageLabel, pathLabel,
  sectionGroups, type EngagementSummary,
} from '../api/engagement'
import { campusLabel } from '../api/labels'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'
import DailyBars from './analytics/DailyBars.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './analytics/csvExport'

// 內容興趣（2026-11-11）：家長在官網各頁停多久、看到哪些區塊、點了什麼、哪幾篇消息有人讀完，
// 以及看過哪些內容的造訪比較會送出預約。紀錄只留 90 天，期間同「官網瀏覽與速度」。
const DAY_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 28, label: '近 28 天' },
  { value: 90, label: '近 90 天' },
]

// 只看手機或電腦（2026-11-11 第二輪）：兩種裝置的版面與停留差很多，分開看才準。
const DEVICE_OPTIONS = [
  { value: 'all', label: '全部裝置' },
  { value: 'mobile', label: '只看手機' },
  { value: 'desktop', label: '只看電腦' },
]

const days = ref(28)
const device = ref('all')
const summary = ref<EngagementSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<EngagementSummary>(`/admin/analytics/engagement?days=${days.value}${device.value === 'all' ? '' : `&device=${device.value}`}`)
    if (requests.isCurrent(request)) summary.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取內容興趣統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([days, device], load, { immediate: true })

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

// ---- 第二輪：趨勢、預約表單、試算班別、首頁消息、瀏覽順序、時段、各校、活動代碼 ----
const deviceLabel = computed(() => (device.value === 'mobile' ? '手機' : device.value === 'desktop' ? '電腦' : ''))
const previous = computed(() => summary.value?.previous ?? null)
const dailyPoints = computed(() => (summary.value?.daily ?? []).map((item) => ({ day: item.day, value: item.sessions })))
const mobileShare = computed(() => (totals.value?.sessions ? formatShare(totals.value.mobile_sessions / totals.value.sessions) : '—'))
const delta = (current: number, before: number | null | undefined) => formatDelta(current, before)

const form = computed(() => summary.value?.booking_form ?? null)
const formSteps = computed(() => {
  const steps = form.value?.steps ?? []
  return steps.map((step, index) => ({
    ...step,
    label: FORM_STEP_LABELS[step.key] ?? step.key,
    // 比上一步少了幾次造訪：最大的那一格就是卡最多人的地方。
    lost: index ? Math.max(0, steps[index - 1]!.sessions - step.sessions) : 0,
  }))
})
const biggestDrop = computed(() => formSteps.value.slice(1).reduce<(typeof formSteps.value)[number] | null>((worst, step) => (step.lost > (worst?.lost ?? 0) ? step : worst), null))

const classes = computed(() => {
  const rows = (summary.value?.classes ?? []).map((row) => ({ ...row, label: CLASS_LABELS[row.key] ?? row.key }))
  const total = rows.reduce((sum, row) => sum + row.visits, 0)
  return { total, rows: rows.map((row) => ({ ...row, share: total ? row.visits / total : 0 })) }
})
const stories = computed(() => (summary.value?.stories ?? []).map((row) => ({ ...row, label: row.title || `（沒有標題的${STORY_KIND_LABELS[row.kind] ?? '內容'}）`, kindLabel: STORY_KIND_LABELS[row.kind] ?? row.kind })))
const maxStoryVisits = computed(() => Math.max(1, ...stories.value.map((row) => row.visits)))

const journey = computed(() => summary.value?.journey ?? null)
const entries = computed(() => (journey.value?.entries ?? []).map((row) => ({ ...row, label: journeyPageLabel(row.page) })))
const exits = computed(() => (journey.value?.exits ?? []).map((row) => ({ ...row, label: journeyPageLabel(row.page) })))
// 寫成頁面名稱後一樣的順序（例如只差在有沒有先經過選校頁）合併成一列。
const paths = computed(() => {
  const merged = new Map<string, { label: string; sessions: number }>()
  for (const row of journey.value?.paths ?? []) {
    const label = pathLabel(row.pages)
    merged.set(label, { label, sessions: (merged.get(label)?.sessions ?? 0) + row.sessions })
  }
  const total = journey.value?.sessions ?? 0
  return [...merged.values()].sort((a, b) => b.sessions - a.sessions).map((row) => ({ ...row, rate: total ? row.sessions / total : null }))
})

const hours = computed(() => hourGrid(summary.value?.hours ?? []))

const campuses = computed(() => (summary.value?.campuses ?? []).map((row) => ({ ...row, label: `${campusLabel(row.campus_key)}校` })))
const showBookings = computed(() => campuses.value.some((row) => row.bookings !== null))
const campusActivity = computed(() => campuses.value.some((row) => row.tab_visits || row.map_visits || row.visit_sessions || row.bookings))
const campaigns = computed(() => (summary.value?.campaigns ?? []).map((row) => ({ ...row, sourceLabel: SOURCE_LABELS[row.source]?.replace(/（.*$/, '') ?? row.source })))

const csv = (name: string) => analyticsCsvName(name, deviceLabel.value ? `官網全站（${deviceLabel.value}）` : '官網全站', rangeText.value)
const dailyCsvName = computed(() => csv('每日造訪'))
function exportForm() {
  saveAnalyticsCsv(csv('預約表單各步'), ['步驟', '造訪次數', '占進到預約頁的比例', '比上一步少'],
    formSteps.value.map((step, index) => [step.label, step.sessions, formatShare(step.rate), index ? step.lost : '']))
}
function exportClasses() {
  saveAnalyticsCsv(csv('入學試算班別'), ['班別', '查到的次數', '比例'], classes.value.rows.map((row) => [row.label, row.visits, formatShare(classes.value.total ? row.share : null)]))
}
function exportStories() {
  saveAnalyticsCsv(csv('首頁點開的消息'), ['類型', '標題', '看到的瀏覽'], stories.value.map((row) => [row.kindLabel, row.label, row.visits]))
}
function exportJourney() {
  saveAnalyticsCsv(csv('進站頁與離開頁'), ['種類', '頁面或順序', '造訪次數', '比例'], [
    ...entries.value.map((row) => ['進站頁', row.label, row.sessions, formatShare(row.rate)]),
    ...exits.value.map((row) => ['離開頁', row.label, row.sessions, formatShare(row.rate)]),
    ...paths.value.map((row) => ['瀏覽順序', row.label, row.sessions, formatShare(row.rate)]),
  ])
}
function exportHours() {
  saveAnalyticsCsv(csv('瀏覽時段'), ['星期', ...HOUR_BANDS.map((band) => `${band.label}（${band.range} 點）`)],
    hours.value.rows.map((row, day) => [WEEKDAY_LABELS[day]!, ...row]))
}
function exportCampuses() {
  saveAnalyticsCsv(csv('各校興趣'), ['校區', '首頁切到這一校', '點地址開地圖', '進預約頁的造訪', ...(showBookings.value ? ['實際送出的預約'] : [])],
    campuses.value.map((row) => [row.label, row.tab_visits, row.map_visits, row.visit_sessions, ...(showBookings.value ? [row.bookings ?? ''] : [])]))
}
function exportCampaigns() {
  saveAnalyticsCsv(csv('活動代碼'), ['活動代碼', '來源', '造訪次數', '送出預約的造訪', '比例'],
    campaigns.value.map((row) => [row.campaign, row.sourceLabel, row.sessions, row.booked_sessions, formatShare(row.booked_rate)]))
}
function exportPages() {
  saveAnalyticsCsv(csv('各頁停留'), ['頁面', '瀏覽次數', '和上一期比', '停留（中位數）', '10 秒內離開', '捲動深度（中位數）'],
    pages.value.map((row) => [row.label, row.visits, delta(row.visits, row.previous_visits), formatDuration(row.median_active_ms), formatShare(row.bounce_rate), `${row.median_scroll_pct}%`]))
}
function exportSections() {
  saveAnalyticsCsv(csv('各區塊觸及'), ['頁面', '區塊', '看到的瀏覽', '看到的比例', '停留（中位數）'],
    groups.value.flatMap((group) => group.rows.map((row) => [group.label, row.label, row.reached, formatShare(row.reach_rate), formatDuration(row.median_ms)])))
}
function exportActions() {
  saveAnalyticsCsv(csv('互動'), ['互動', '做過的瀏覽', '總次數'], actions.value.map((row) => [row.label, row.visits, row.total]))
}
function exportNews() {
  saveAnalyticsCsv(csv('單篇消息'), ['消息', '瀏覽次數', '和上一期比', '停留（中位數）', '讀到文末'],
    news.value.map((row) => [row.label, row.visits, delta(row.visits, row.previous_visits), formatDuration(row.median_active_ms), formatShare(row.read_rate)]))
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
          <span>裝置</span>
          <el-select v-model="device" aria-label="內容興趣要看的裝置" data-test="interest-device">
            <el-option v-for="option in DEVICE_OPTIONS" :key="option.value" :value="option.value" :label="option.label" />
          </el-select>
        </label>
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
              <span class="stat__hint">共看了 {{ totals.visits }} 頁<template v-if="previous">；{{ previous.sessions ? `上一期 ${previous.sessions} 次（${delta(totals.sessions, previous.sessions)}）` : '上一期沒有紀錄' }}</template></span>
            </div>
            <div class="stat">
              <span class="stat__label">每次造訪看幾頁</span>
              <span class="stat__value">{{ totals.pages_per_session ?? '—' }}</span>
              <span v-if="device === 'all'" class="stat__hint">手機造訪占 {{ mobileShare }}</span>
            </div>
            <div class="stat">
              <span class="stat__label">每次造訪停留</span>
              <span class="stat__value">{{ formatDuration(totals.median_session_ms) }}</span>
              <span class="stat__hint">單頁 {{ formatDuration(totals.median_active_ms) }}（中位數）</span>
            </div>
            <div class="stat">
              <span class="stat__label">送出預約的造訪</span>
              <span class="stat__value">{{ formatShare(totals.booked_rate) }}</span>
              <span class="stat__hint">{{ totals.booked_sessions }} 次<template v-if="previous && previous.sessions">；上一期 {{ formatShare(previous.booked_rate) }}</template></span>
            </div>
          </div>
          <DailyBars v-if="totals.sessions" title="每日造訪" :points="dailyPoints" unit="次" value-label="造訪次數" :export-filename="dailyCsvName" />
          <AnalyticsMeta :period="rangeText" unit="造訪與頁面瀏覽（不是人數）" :as-of="summary.as_of" :coverage="deviceLabel ? `全站五校合計，只看${deviceLabel}` : '全站五校合計，不分校區權限'" />
          <AnalyticsExplainer>
            <p>「造訪」是同一個瀏覽器分頁從進站到關掉為止；同一位家長隔天再來、或另開分頁，會算成另一次造訪，所以不是人數。</p>
            <p>停留只算分頁在前景、而且一分鐘內有捲動或點擊的時間；一半的瀏覽比「中位數」久、一半比它短。</p>
            <p>手機直接滑掉分頁時，最後一段停留可能送不出來，手機的數字會偏低。訪客開啟「不要追蹤」時不計入，所以次數會比「官網瀏覽與速度」的瀏覽次數少。</p>
            <p>「送出預約的造訪」由瀏覽器回報，只用來比較內容，不是正式的預約數；正式數字看「招生統計 → 參觀預約」。</p>
            <p>「上一期」是往前同樣天數；紀錄只保留 90 天，所以選近 90 天時沒有上一期可比。一次造訪跨過午夜會在兩天各算一次。</p>
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
              <thead><tr><th scope="col">頁面</th><th scope="col" class="num">瀏覽</th><th v-if="previous" scope="col" class="num">和上一期比</th><th scope="col" class="num">停留</th><th scope="col" class="num">10 秒內離開</th><th scope="col" class="num">捲動深度</th></tr></thead>
              <tbody>
                <tr v-for="row in pages" :key="`${row.page}-${row.campus_key}`">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.visits }}</td>
                  <td v-if="previous" class="num">{{ delta(row.visits, row.previous_visits) }}</td>
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
              <thead><tr><th scope="col">消息</th><th scope="col" class="num">瀏覽</th><th v-if="previous" scope="col" class="num">和上一期比</th><th scope="col" class="num">停留</th><th scope="col" class="num">讀到文末</th></tr></thead>
              <tbody>
                <tr v-for="row in news" :key="row.id">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.visits }}</td>
                  <td v-if="previous" class="num">{{ delta(row.visits, row.previous_visits) }}</td>
                  <td class="num">{{ formatDuration(row.median_active_ms) }}</td>
                  <td class="num">{{ formatShare(row.read_rate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>只算消息內文頁（/news/…）。在首頁直接點開的消息另外列在「首頁點開的消息」。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-stories-title">
        <div class="panel__head">
          <h2 id="interest-stories-title">首頁點開的消息</h2>
          <el-button v-if="stories.length" size="small" text data-test="interest-csv-stories" aria-label="把「首頁點開的消息」匯出 CSV" @click="exportStories">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!stories.length" class="hint">這段期間還沒有紀錄。</p>
          <ol v-else class="interest__bars" data-test="interest-stories">
            <li v-for="row in stories" :key="`${row.kind}-${row.id}`" class="interest__bar-row">
              <span class="interest__bar-label">{{ row.label }}</span>
              <span class="interest__track" aria-hidden="true"><span class="interest__bar" :style="{ width: `${(row.visits / maxStoryVisits) * 100}%` }" /></span>
              <span class="interest__bar-value num">{{ row.visits }}</span>
              <span class="interest__bar-note hint">{{ row.kindLabel }}</span>
            </li>
          </ol>
          <AnalyticsExplainer>
            <p>在首頁「最新消息」點開、或接著滑到的消息、活動與影片，一次瀏覽同一則只算一次。只列目前還在發布中的內容。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel interest__wide" aria-labelledby="interest-form-title">
        <div class="panel__head">
          <h2 id="interest-form-title">預約表單卡在哪一步</h2>
          <el-button v-if="form?.sessions" size="small" text data-test="interest-csv-form" aria-label="把「預約表單卡在哪一步」匯出 CSV" @click="exportForm">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!form?.sessions" class="hint">這段期間還沒有人進到預約頁。</p>
          <template v-else>
            <ol class="interest__bars" data-test="interest-form">
              <li v-for="(step, index) in formSteps" :key="step.key" class="interest__bar-row" :class="{ 'is-worst': step === biggestDrop && step.lost > 0 }">
                <span class="interest__bar-label">{{ index + 1 }}. {{ step.label }}</span>
                <span class="interest__track" aria-hidden="true"><span class="interest__bar" :style="{ width: `${(step.rate ?? 0) * 100}%` }" /></span>
                <span class="interest__bar-value num">{{ step.sessions }}</span>
                <span class="interest__bar-note hint num">{{ formatShare(step.rate) }}<template v-if="index">，比上一步少 {{ step.lost }} 次<template v-if="step === biggestDrop && step.lost > 0">（流失最多）</template></template></span>
              </li>
            </ol>
            <p class="hint" data-test="interest-form-notes">看到「目前沒有開放的參觀場次」的造訪：<strong class="num">{{ form.no_slots_sessions }}</strong> 次；按了確認但有欄位沒填對：<strong class="num">{{ form.invalid_sessions }}</strong> 次。<template v-if="few(form.sessions)">進到預約頁的造訪不到 {{ MIN_ENGAGEMENT_SAMPLES }} 次，樣本太少，先別下結論。</template></p>
          </template>
          <AnalyticsExplainer>
            <p>以造訪為單位：進過預約頁的造訪裡，有多少走到每一步。只記「走到了」，不記填了什麼。</p>
            <p>預約方式是 LINE 或電話的校區沒有表單，那些造訪會停在「選好校區」。「預約成功」由瀏覽器回報，正式預約數看「招生統計 → 參觀預約」。</p>
            <p>這項統計 2026/11/11 第二輪上線後才開始記；在那之前的造訪只會算到「選好校區」。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-classes-title">
        <div class="panel__head">
          <h2 id="interest-classes-title">家長查的是哪個班別<span class="interest__sub">入學試算</span></h2>
          <el-button v-if="classes.total" size="small" text data-test="interest-csv-classes" aria-label="把「家長查的是哪個班別」匯出 CSV" @click="exportClasses">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!classes.total" class="hint">這段期間還沒有人用入學資訊頁的生日試算。</p>
          <ol v-else class="interest__bars" data-test="interest-classes">
            <li v-for="row in classes.rows" :key="row.key" class="interest__bar-row">
              <span class="interest__bar-label">{{ row.label }}</span>
              <span class="interest__track" aria-hidden="true"><span class="interest__bar" :style="{ width: `${row.share * 100}%` }" /></span>
              <span class="interest__bar-value num">{{ row.visits }}</span>
              <span class="interest__bar-note hint num">{{ formatShare(row.share) }}</span>
            </li>
          </ol>
          <AnalyticsExplainer>
            <p>入學資訊頁「寶貝何時入學」輸入生日後算出的班別（這個學年度）。只記班別，不記生日；同一次瀏覽查了兩個孩子會各算一次。</p>
            <p v-if="few(classes.total)">目前不到 {{ MIN_ENGAGEMENT_SAMPLES }} 次，樣本太少。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-campuses-title">
        <div class="panel__head">
          <h2 id="interest-campuses-title">各校的興趣與預約</h2>
          <el-button v-if="campusActivity" size="small" text data-test="interest-csv-campuses" aria-label="把「各校的興趣與預約」匯出 CSV" @click="exportCampuses">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!campusActivity" class="hint">這段期間還沒有紀錄。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-campuses">
              <thead><tr><th scope="col">校區</th><th scope="col" class="num">首頁切到這一校</th><th scope="col" class="num">點地址</th><th scope="col" class="num">進預約頁</th><th v-if="showBookings" scope="col" class="num">實際預約</th></tr></thead>
              <tbody>
                <tr v-for="row in campuses" :key="row.campus_key">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.tab_visits }}</td>
                  <td class="num">{{ row.map_visits }}</td>
                  <td class="num">{{ row.visit_sessions }}</td>
                  <td v-if="showBookings" class="num">{{ row.bookings ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>前兩欄是首頁五校區塊的點擊（做過的瀏覽數），「進預約頁」是進過那一校預約頁的造訪數。</p>
            <p>「實際預約」是這段期間官網真的送出的預約（同招生統計），不受「不要追蹤」影響，也不分手機電腦；只顯示你有權限看的校區。</p>
            <p>首頁一打開就顯示的那一校不用點就看得到，它的「切到這一校」會偏低。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-entries-title">
        <div class="panel__head">
          <h2 id="interest-entries-title">從哪一頁進來、哪一頁離開</h2>
          <el-button v-if="journey?.sessions" size="small" text data-test="interest-csv-journey" aria-label="把「進站頁、離開頁與瀏覽順序」匯出 CSV" @click="exportJourney">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!journey?.sessions" class="hint">這段期間還沒有紀錄。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-entries">
              <thead><tr><th scope="col">頁面</th><th scope="col" class="num">第一頁</th><th scope="col" class="num">最後一頁</th></tr></thead>
              <tbody>
                <tr v-for="row in entries" :key="row.page">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">{{ row.sessions }}<span class="hint">（{{ formatShare(row.rate) }}）</span></td>
                  <td class="num">{{ exits.find((item) => item.page === row.page)?.sessions ?? 0 }}</td>
                </tr>
                <tr v-for="row in exits.filter((item) => !entries.some((entry) => entry.page === item.page))" :key="`exit-${row.page}`">
                  <th scope="row">{{ row.label }}</th>
                  <td class="num">0</td>
                  <td class="num">{{ row.sessions }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer>
            <p>共 {{ journey?.sessions ?? 0 }} 次有記順序的造訪。「第一頁」是家長一進站落在哪一頁（貼文連到哪裡）；「最後一頁」是看完就離開的那一頁，預約頁以外的頁面數字高，代表很多人看到這裡就走了。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel" aria-labelledby="interest-paths-title">
        <div class="panel__head"><h2 id="interest-paths-title">最常見的瀏覽順序</h2></div>
        <div class="panel__body interest__body">
          <p v-if="!paths.length" class="hint">這段期間還沒有紀錄。</p>
          <ol v-else class="interest__paths" data-test="interest-paths">
            <li v-for="row in paths" :key="row.label"><span>{{ row.label }}</span><span class="num"><strong>{{ row.sessions }}</strong> 次<span class="hint">（{{ formatShare(row.rate) }}）</span></span></li>
          </ol>
          <AnalyticsExplainer>
            <p>每次造訪照順序看的前 4 頁，列出最多的 10 種。只有一頁代表看了那一頁就離開。</p>
          </AnalyticsExplainer>
        </div>
      </section>

      <section class="panel interest__wide" aria-labelledby="interest-hours-title">
        <div class="panel__head">
          <h2 id="interest-hours-title">什麼時候有人看</h2>
          <el-button v-if="hours.total" size="small" text data-test="interest-csv-hours" aria-label="把「什麼時候有人看」匯出 CSV" @click="exportHours">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!hours.total" class="hint">這段期間還沒有紀錄。</p>
          <template v-else>
            <p class="interest__peaks" data-test="interest-peaks">最多人看的時段：<template v-for="(peak, index) in hours.peaks" :key="`${peak.weekday}-${peak.band}`"><template v-if="index">、</template><strong>{{ peak.weekday }}{{ peak.band }}</strong> {{ peak.visits }} 次</template></p>
            <div class="interest__scroll">
              <table class="interest__table interest__heat" data-test="interest-hours">
                <thead><tr><th scope="col">星期</th><th v-for="band in HOUR_BANDS" :key="band.label" scope="col" class="num">{{ band.label }}<span class="hint">{{ band.range }}</span></th></tr></thead>
                <tbody>
                  <tr v-for="(row, day) in hours.rows" :key="day">
                    <th scope="row">{{ WEEKDAY_LABELS[day] }}</th>
                    <td v-for="(visits, band) in row" :key="band" class="num"><span class="interest__heat-cell" :style="{ '--heat': hours.max ? visits / hours.max : 0 }">{{ visits }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <AnalyticsExplainer>
            <p>頁面瀏覽次數，依台灣時間的星期與時段（用離開那一頁的時間）。底色越深代表越多人看；發文、回訊息可以挑這些時段。</p>
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

      <section class="panel" aria-labelledby="interest-campaigns-title">
        <div class="panel__head">
          <h2 id="interest-campaigns-title">哪一則貼文或廣告帶來的<span class="interest__sub">活動代碼</span></h2>
          <el-button v-if="campaigns.length" size="small" text data-test="interest-csv-campaigns" aria-label="把「哪一則貼文或廣告帶來的」匯出 CSV" @click="exportCampaigns">匯出 CSV</el-button>
        </div>
        <div class="panel__body interest__body">
          <p v-if="!campaigns.length" class="hint">這段期間沒有帶活動代碼的造訪。貼連結時在網址後面加上代碼，這裡才分得出是哪一則（做法見下方說明）。</p>
          <div v-else class="interest__scroll">
            <table class="interest__table" data-test="interest-campaigns">
              <thead><tr><th scope="col">活動代碼</th><th scope="col">來源</th><th scope="col" class="num">造訪</th><th scope="col" class="num">送出預約</th></tr></thead>
              <tbody>
                <tr v-for="row in campaigns" :key="`${row.campaign}-${row.source}`">
                  <th scope="row"><code>{{ row.campaign }}</code></th>
                  <td>{{ row.sourceLabel }}</td>
                  <td class="num">{{ row.sessions }}</td>
                  <td class="num">{{ row.booked_sessions }}<span class="hint">（{{ few(row.sessions) ? '樣本太少' : formatShare(row.booked_rate) }}）</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsExplainer summary="怎麼幫貼文加活動代碼">
            <p>貼官網連結時，在網址最後加上 <code>?utm_source=facebook&amp;utm_campaign=open-day-1122</code>：<code>utm_source</code> 寫平台（facebook、line、instagram），<code>utm_campaign</code> 自己取，每則貼文或廣告用不同的代碼。</p>
            <p>代碼只能用英文小寫、數字、連字號與底線，最長 32 個字；中文會被略過。最多列 30 組。</p>
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
  width: 132px;
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

.interest__bar-row.is-worst .interest__bar-label {
  color: var(--ink);
  font-weight: 600;
}

.interest__paths {
  list-style: none;
  margin: 0;
  padding: 0;
}

.interest__paths li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 16px;
  padding: 8px 0;
  color: var(--ink-2);
}

.interest__paths li + li {
  border-top: 1px solid var(--line);
}

.interest__peaks {
  margin: 0;
  color: var(--ink-2);
}

.interest__heat thead .hint {
  display: block;
  font-weight: 400;
}

.interest__heat td {
  padding: 4px;
}

.interest__heat th {
  white-space: nowrap;
}

/* 底色深淺＝這一格占最多那一格的比例；數字一定寫出來，顏色只是輔助。 */
.interest__heat-cell {
  display: block;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-color-primary) calc(var(--heat) * 32%), transparent);
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
