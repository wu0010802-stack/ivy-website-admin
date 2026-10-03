<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { AnalyticsFunnelOut } from '../api/types'
import { SELF_BOOKING_SINCE } from '../api/analytics'
import { MANUAL_VISIT_SOURCES, cancelReasonLabel, ctaEntryLabel, funnelReferralLabel, funnelSourceLabel } from '../api/labels'
import { taipeiToday } from '../composables/newsContent'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'
import AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'
import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'
import ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'
import EventTrendPanel from '../components/analytics/EventTrendPanel.vue'

type Period = 'all' | '30' | '90' | 'year' | 'custom'
type Dimension = 'source' | 'referral'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: '開站至今' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: 'year', label: '今年' },
  { value: 'custom', label: '自訂區間' },
]

const { visibleCampusKeys, selected: campusKey } = useCampusScope()
const period = ref<Period>('all')
const customRange = ref<[string, string] | null>(null)
const dimension = ref<Dimension>('source')
const funnel = ref<AnalyticsFunnelOut | null>(null)
const loading = ref(false)
// 「重新整理」遞增它，讓不靠預約流程請求的三個面板也一起重抓。
const refreshToken = ref(0)
const error = ref<string | null>(null)
const requests = useRequestSequence()
// 手機上日期區間只顯示一個月，雙月面板約 646px 會超出 390px 螢幕。
const narrow = useNarrowScreen()

// 後端一次最多查 400 天，超過的自訂區間先在前端擋下來。
const MAX_RANGE_DAYS = 400

// 台北日期往前推 n 天（含今天共 n 天）。後端也以台北日界線切日期。
function daysBefore(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d! - (days - 1)))
  return date.toISOString().slice(0, 10)
}

const range = computed<{ from: string; to: string } | null>(() => {
  const today = taipeiToday()
  if (period.value === '30') return { from: daysBefore(today, 30), to: today }
  if (period.value === '90') return { from: daysBefore(today, 90), to: today }
  if (period.value === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  if (period.value === 'custom' && customRange.value) return { from: customRange.value[0], to: customRange.value[1] }
  return null
})

// 日期選單的格子是本機時間的午夜；今天以後（台北日期）不能選。
function isFutureDate(date: Date): boolean {
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return local > taipeiToday()
}

const rangeTooLong = computed(() => {
  if (period.value !== 'custom' || !customRange.value) return false
  const [from, to] = customRange.value.map((day) => Date.parse(`${day}T00:00:00Z`))
  return (to! - from!) / 86_400_000 + 1 > MAX_RANGE_DAYS
})

// 自訂區間還沒選好或太長時，各面板都不送請求（和預約流程同一個條件）。
const rangeReady = computed(() => period.value !== 'custom' || (customRange.value !== null && !rangeTooLong.value))
const panelsReady = computed(() => visibleCampusKeys.value.length > 0 && !!campusKey.value && rangeReady.value)
// 預約流程與依來源、預約鈕點擊三塊要等 funnel 回來才有東西顯示；錯誤時整塊收起。
const showFunnel = computed(() => visibleCampusKeys.value.length > 0 && !error.value && funnel.value !== null)

function refresh() {
  refreshToken.value += 1
  void load()
}

// 重新整理或換條件時保留上一次的數字、淡一點並寫「更新中…」（和上方瀏覽統計一致），
// 只有第一次載入用骨架，整區不會消失再出現。
async function load() {
  const request = requests.begin()
  if (!campusKey.value || (period.value === 'custom' && (!customRange.value || rangeTooLong.value))) {
    funnel.value = null
    error.value = null
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  const query = new URLSearchParams({ campus_key: campusKey.value })
  if (range.value) { query.set('from', range.value.from); query.set('to', range.value.to) }
  try {
    const result = await api.get<AnalyticsFunnelOut>(`/admin/analytics/funnel?${query}`)
    if (requests.isCurrent(request)) funnel.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    error.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([campusKey, range], load, { immediate: true })

const updating = computed(() => loading.value && funnel.value !== null)
const count = (key: string) => funnel.value?.counts[key] ?? 0
// 事件依發生日期計算：期間內的確認、完成或取消可能來自期間之前送出的需求，
// 分子比分母大時硬算會出現超過 100%，這時不給比例。
const percent = (part: number, whole: number): string | null => (whole > 0 && part <= whole ? `${Math.round((part / whole) * 100)}%` : null)

const periodLabel = computed(() => (range.value ? `${range.value.from.replaceAll('-', '/')}–${range.value.to.replaceAll('-', '/')}` : '開站至今'))
// 區塊標題寫出這一段用的期間：預設選項用名稱，自訂區間寫日期。
const periodTitle = computed(() =>
  period.value === 'custom' ? (range.value ? periodLabel.value : '自訂區間') : PERIOD_OPTIONS.find((option) => option.value === period.value)!.label,
)

const clicks = computed(() => [
  { label: '預約表單', value: count('booking_cta_clicked') },
  { label: 'LINE', value: count('cta_click_line') },
  { label: '電話', value: count('cta_click_phone') },
  { label: '外部網站', value: count('cta_click_external') },
])

const unassignedClicks = computed(() => {
  const counts = funnel.value?.unassigned_clicks
  return counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0
})

// 「送出需求」只有家長從官網送出才記，後台補登的案件沒有；確認率與取消率因此只拿
// 官網表單那一列來算，補登的另外寫件數，不讓補登把比例灌到 100% 以上。
const webCounts = computed(() => funnel.value?.by_source.find((row) => row.source === 'web')?.counts ?? {})
const isManualSource = (source: string) => (MANUAL_VISIT_SOURCES as readonly string[]).includes(source)
const sourceCount = (key: string, match: (source: string) => boolean) =>
  (funnel.value?.by_source ?? [])
    .filter((row) => match(row.source))
    .reduce((sum, row) => sum + (row.counts[key] ?? 0), 0)

// 2026-10-01 起家長自選場次：官網送出即預約成功，同時記「已送出需求」與「已確認預約」，
// 官網確認率必為 100%。期間的結束日在這天以後（含開站至今）就不算確認率，免得和舊流程的
// 人工確認混在一起；取消率照算。
const coversSelfBooking = computed(() => !range.value || range.value.to >= SELF_BOOKING_SINCE)

// 舊資料沒有記來源（「未記錄來源」）：不算進官網比例也不算補登，另外寫，總數才對得起來。
// skipRate 有值時改寫這段說明、不算官網比例（補登與未記錄來源照寫）。
function webShareNote(key: string, describe: (rate: string) => string, skipRate?: string): string {
  const webCreated = webCounts.value.request_created ?? 0
  const manual = sourceCount(key, isManualSource)
  const unrecorded = sourceCount(key, (source) => source !== 'web' && !isManualSource(source))
  const rate = percent(webCounts.value[key] ?? 0, webCreated)
  return [
    skipRate ?? (webCreated ? (rate ? describe(rate) : '含之前送出的需求，不計比例') : ''),
    manual ? `另有後台補登 ${manual} 筆` : '',
    unrecorded ? `另有未記錄來源 ${unrecorded} 筆` : '',
  ].filter(Boolean).join('・')
}

const stages = computed(() => {
  const created = count('request_created')
  const confirmed = count('visit_confirmed')
  const completed = count('visit_completed')
  const cancelled = count('visit_cancelled')
  const max = Math.max(created, confirmed, completed, cancelled, 1)
  const completedRate = percent(completed, confirmed)
  // 補登的案件沒有「送出需求」，確認、完成、取消卻會算進去；條上把補登畫成淡色的
  // 一段，深色段和「已送出需求」同一個口徑，才不會看起來像漏斗倒過來。
  const manual = (key: string, value: number) => Math.min(sourceCount(key, isManualSource), value) / max
  return [
    { key: 'created', label: '已送出需求', value: created, ratio: created / max, manualRatio: 0, note: '只算家長在官網填表' },
    { key: 'confirmed', label: '已確認預約', value: confirmed, ratio: confirmed / max, manualRatio: manual('visit_confirmed', confirmed), note: webShareNote('visit_confirmed', (rate) => `官網需求的 ${rate}`, coversSelfBooking.value ? '2026/10/01 起官網送出即預約成功，不計確認率' : undefined) },
    { key: 'completed', label: '已完成參觀', value: completed, ratio: completed / max, manualRatio: manual('visit_completed', completed), note: confirmed ? (completedRate ? `${completedRate} 的確認` : '含之前確認的預約，不計比例') : '' },
    { key: 'cancelled', label: '已取消', value: cancelled, ratio: cancelled / max, manualRatio: manual('visit_cancelled', cancelled), note: webShareNote('visit_cancelled', (rate) => `官網需求取消率 ${rate}`) },
  ]
})

const hasManualBars = computed(() => stages.value.some((stage) => stage.manualRatio > 0))

const cancelReasons = computed(() =>
  Object.entries(funnel.value?.cancelled_by_reason ?? {})
    .filter(([, value]) => value > 0)
    .map(([reason, value]) => `${cancelReasonLabel(reason)} ${value}`)
    .join('・'),
)

// 依來源的列：已知代碼照固定順序，舊資料（unknown）排最後。
const SOURCE_ORDER = ['web', 'phone', 'line', 'walk_in', 'external']
const REFERRAL_ORDER = ['friends_family', 'nearby', 'online', 'other', 'facebook', 'google_reviews', 'parent_community', 'none']
function orderOf(order: string[], key: string) {
  const index = order.indexOf(key)
  return index === -1 ? order.length : index
}

const dimensionRows = computed(() => {
  if (!funnel.value) return []
  const rows = dimension.value === 'source'
    ? funnel.value.by_source.map((row) => ({ key: row.source, label: funnelSourceLabel(row.source), counts: row.counts, order: orderOf(SOURCE_ORDER, row.source) }))
    : funnel.value.by_referral.map((row) => ({ key: row.referral, label: funnelReferralLabel(row.referral), counts: row.counts, order: orderOf(REFERRAL_ORDER, row.referral) }))
  return rows
    .sort((a, b) => a.order - b.order)
    .map((row) => {
      const created = row.counts.request_created ?? 0
      const cancelled = row.counts.visit_cancelled ?? 0
      return {
        key: row.key,
        label: row.label,
        created,
        confirmed: row.counts.visit_confirmed ?? 0,
        completed: row.counts.visit_completed ?? 0,
        cancelled,
        cancelRate: percent(cancelled, created) ?? '—',
        cancelCapped: created > 0 && cancelled > created,
      }
    })
})
const hasCappedRate = computed(() => dimensionRows.value.some((row) => row.cancelCapped))

const entryRows = computed(() =>
  (funnel.value?.clicks_by_entry ?? [])
    .map((row) => ({
      key: row.entry,
      label: ctaEntryLabel(row.entry),
      form: row.counts.booking_cta_clicked ?? 0,
      line: row.counts.cta_click_line ?? 0,
      phone: row.counts.cta_click_phone ?? 0,
      external: row.counts.cta_click_external ?? 0,
    }))
    .map((row) => ({ ...row, total: row.form + row.line + row.phone + row.external }))
    .sort((a, b) => b.total - a.total),
)
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="官網瀏覽量與網頁速度，以及各校參觀預約的結果（到場、未到、取消）、每日變化、來源與預約孩子的班別，可以依期間與校區查看。" />

    <SiteTrafficPanel />

    <div class="analytics__section-head">
      <h2 class="analytics__section-title">各校預約（{{ periodTitle }}）</h2>
      <span class="hint" role="status">{{ updating ? '更新中…' : '' }}</span>
    </div>

    <div class="filter-bar">
      <label class="filter-field"><span>查看校區</span><CampusSelect v-model="campusKey" :keys="visibleCampusKeys" /></label>
      <label class="filter-field">
        <span>期間</span>
        <el-select v-model="period" aria-label="期間">
          <el-option v-for="option in PERIOD_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </label>
      <label v-if="period === 'custom'" class="filter-field analytics__range">
        <span>自訂區間</span>
        <el-date-picker v-model="customRange" type="daterange" value-format="YYYY-MM-DD" format="YYYY/MM/DD" unlink-panels :single-panel="narrow"
          :disabled-date="isFutureDate" :clearable="false" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="統計日期區間" />
      </label>
      <el-button :loading="loading" :disabled="!campusKey" @click="refresh">重新整理</el-button>
    </div>

    <BookingOutcomesSection
      v-if="panelsReady"
      :range="range"
      :campus-key="campusKey"
      :period-label="periodLabel"
      :refresh-token="refreshToken"
      :show-compare="visibleCampusKeys.length > 1"
    />

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <el-skeleton v-else-if="loading && !funnel" animated :rows="5" aria-label="正在讀取統計" />
    <p v-else-if="period === 'custom' && !customRange" class="field-help">請選擇開始與結束日期。</p>
    <p v-else-if="rangeTooLong" class="field-help">自訂區間最長 {{ MAX_RANGE_DAYS }} 天，請把開始或結束日期調近一點。</p>

    <div v-if="showFunnel && funnel" class="analytics__results" :class="{ 'is-updating': updating }" :aria-busy="loading">
      <section class="panel">
        <div class="panel__head"><h2>預約流程</h2><span class="analytics__period num">{{ periodLabel }}</span></div>
        <ol class="funnel">
          <li v-for="s in stages" :key="s.key" class="funnel__row" :class="{ 'funnel__row--cancelled': s.key === 'cancelled' }">
            <span class="funnel__label">{{ s.label }}</span>
            <span class="funnel__track" aria-hidden="true">
              <span class="funnel__bar" :class="{ 'has-manual': s.manualRatio > 0 }" :style="{ width: `${(s.ratio - s.manualRatio) * 100}%` }" />
              <span v-if="s.manualRatio > 0" class="funnel__bar funnel__bar--manual" :style="{ width: `${s.manualRatio * 100}%` }" />
            </span>
            <span class="funnel__value num">{{ s.value }}</span>
            <span class="funnel__note">{{ s.note }}</span>
          </li>
        </ol>
        <p v-if="hasManualBars" class="analytics__note">條上淡色的一段是後台補登，深色是官網表單。</p>
        <p v-if="cancelReasons" class="analytics__note">取消原因：{{ cancelReasons }}</p>
        <p class="analytics__note">依事件發生的日期（台北時間）計算，所以這段期間的確認、完成或取消，可能是更早送出的需求。「送出需求」只算家長從官網送出的；確認率與取消率只拿官網表單的需求來算，後台補登（電話、LINE、親自到園等）與沒有記錄來源的舊資料，件數另外寫。2026/10/01 起家長自選場次、送出即預約成功，期間的結束日在這天以後就不計確認率。</p>
        <div class="analytics__meta"><AnalyticsMeta :period="periodLabel" unit="事件次數（依發生日期）" :as-of="funnel.as_of" /></div>
      </section>

    </div>

    <EventTrendPanel v-if="panelsReady" :campus-key="campusKey" :range="range" :period-label="periodLabel" :refresh-token="refreshToken" />

    <div v-if="showFunnel && funnel" class="analytics__results" :class="{ 'is-updating': updating }" :aria-busy="loading">
      <section class="panel">
        <div class="panel__head analytics__dims-head">
          <h2>依來源</h2>
          <el-radio-group v-model="dimension" size="small" aria-label="來源維度">
            <el-radio-button value="source">案件來源</el-radio-button>
            <el-radio-button value="referral">從哪裡知道我們</el-radio-button>
          </el-radio-group>
        </div>
        <div class="panel__body">
          <p v-if="!dimensionRows.length" class="field-help">這段期間沒有預約紀錄。</p>
          <template v-else>
            <el-table :data="dimensionRows" row-key="key" size="small" class="analytics__table data-table">
              <el-table-column prop="label" :label="dimension === 'source' ? '來源' : '從哪裡知道'" min-width="120" />
              <el-table-column prop="created" label="送出需求" align="right" min-width="80" />
              <el-table-column prop="confirmed" label="確認" align="right" min-width="64" />
              <el-table-column prop="completed" label="完成" align="right" min-width="64" />
              <el-table-column prop="cancelled" label="取消" align="right" min-width="64" />
              <el-table-column prop="cancelRate" label="取消率" align="right" min-width="72" />
            </el-table>
            <!-- 手機上每一列一張小卡，不必左右捲也看得到取消與取消率。 -->
            <ul class="mobile-records analytics__records">
              <li v-for="row in dimensionRows" :key="row.key" class="analytics__record">
                <strong>{{ row.label }}</strong>
                <dl>
                  <div><dt>送出需求</dt><dd class="num">{{ row.created }}</dd></div>
                  <div><dt>確認</dt><dd class="num">{{ row.confirmed }}</dd></div>
                  <div><dt>完成</dt><dd class="num">{{ row.completed }}</dd></div>
                  <div><dt>取消</dt><dd class="num">{{ row.cancelled }}<template v-if="row.cancelRate !== '—'">（取消率 {{ row.cancelRate }}）</template></dd></div>
                </dl>
              </li>
            </ul>
          </template>
          <p v-if="hasCappedRate" class="analytics__note">取消數比同期送出的需求多（含更早送出的需求）時，不計取消率。</p>
          <p v-if="dimension === 'referral' && dimensionRows.length" class="analytics__note">家長可以複選，各列加總可能大於總數。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head"><h2>預約鈕點擊</h2></div>
        <div class="panel__body">
          <div class="stat-list analytics__clicks">
            <div v-for="c in clicks" :key="c.label" class="stat">
              <span class="stat__label">{{ c.label }}</span>
              <span class="stat__value">{{ c.value }}</span>
            </div>
          </div>
          <template v-if="entryRows.length">
            <el-table :data="entryRows" row-key="key" size="small" class="analytics__table data-table">
              <el-table-column prop="label" label="按鈕位置" min-width="140" />
              <el-table-column prop="form" label="預約表單" align="right" min-width="80" />
              <el-table-column prop="line" label="LINE" align="right" min-width="64" />
              <el-table-column prop="phone" label="電話" align="right" min-width="64" />
              <el-table-column prop="external" label="外部網站" align="right" min-width="80" />
            </el-table>
            <ul class="mobile-records analytics__records">
              <li v-for="row in entryRows" :key="row.key" class="analytics__record">
                <strong>{{ row.label }}</strong>
                <dl>
                  <div><dt>預約表單</dt><dd class="num">{{ row.form }}</dd></div>
                  <div><dt>LINE</dt><dd class="num">{{ row.line }}</dd></div>
                  <div><dt>電話</dt><dd class="num">{{ row.phone }}</dd></div>
                  <div><dt>外部網站</dt><dd class="num">{{ row.external }}</dd></div>
                </dl>
              </li>
            </ul>
          </template>
          <p v-if="unassignedClicks" class="analytics__note">另有 {{ unassignedClicks }} 次點擊沒有指定校區（例如首頁頁首的預約鈕），不算在各校裡。</p>
          <p class="analytics__note">點擊次數不等於預約數；LINE、電話與外部網站的點擊之後有沒有真的預約，官網無法得知。</p>
        </div>
      </section>
    </div>

    <ClassDistributionPanel v-if="panelsReady" :campus-key="campusKey" :range="range" :period-label="periodLabel" :refresh-token="refreshToken" />
  </div>
</template>

<style scoped>
.analytics__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 28px 0 12px;
}

.analytics__section-title {
  font-size: 16px;
}

.analytics__results {
  transition: opacity 180ms var(--ease-out);
}

.analytics__results.is-updating {
  opacity: 0.6;
}

.analytics__records {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.analytics__record {
  padding: 12px 14px;
}

.analytics__record + .analytics__record {
  border-top: 1px solid var(--line);
}

.analytics__record strong {
  font-weight: 500;
}

.analytics__record dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 20px;
  margin: 8px 0 0;
}

.analytics__record dl > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.analytics__record dt {
  color: var(--ink-3);
}

.analytics__record dd {
  margin: 0;
  font-weight: 600;
}

.analytics__period {
  font-size: 13px;
  color: var(--ink-3);
}

.analytics__range :deep(.el-date-editor) {
  max-width: 100%;
}

.analytics__dims-head {
  flex-wrap: wrap;
}

.analytics__note {
  margin: 0;
  padding: 0 24px 16px;
  font-size: 12px;
  color: var(--ink-3);
}

.analytics__meta {
  padding: 0 24px 16px;
}

.panel__body .analytics__note {
  padding: 8px 0 0;
}

.analytics__table {
  margin-top: 12px;
}

.funnel__row--cancelled .funnel__bar {
  background: var(--ink-3);
}

.funnel__row--cancelled .funnel__bar--manual {
  background: color-mix(in oklch, var(--ink-3), var(--surface) 55%);
}

.funnel {
  list-style: none;
  margin: 0;
  padding: 8px 24px 16px;
}

.funnel__row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) 56px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.funnel__row + .funnel__row {
  border-top: 1px solid var(--line);
}

.funnel__label {
  color: var(--ink-2);
}

.funnel__track {
  display: flex;
  height: 10px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.funnel__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
  transition: width 300ms var(--ease-out);
}

/* 官網段後面接補登段：接縫不畫圓角。 */
.funnel__bar.has-manual {
  border-radius: 999px 0 0 999px;
}

.funnel__bar--manual {
  border-radius: 0 999px 999px 0;
  background: var(--el-color-primary-light-5);
}

.funnel__value {
  text-align: right;
  font-weight: 600;
  font-size: 16px;
}

.funnel__note {
  font-size: 12px;
  color: var(--ink-3);
}

/* 四種點擊排成一列；手機沿用共用的兩欄。 */
@media (min-width: 721px) {
  .analytics__clicks {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .analytics__range :deep(.el-date-editor) {
    width: 100%;
  }

  .funnel__row {
    grid-template-columns: 90px minmax(0, 1fr) 48px;
  }

  .funnel__note {
    grid-column: 2 / -1;
  }
}
</style>
