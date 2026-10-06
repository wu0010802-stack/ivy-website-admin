<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import AnalyticsExplainer from '../components/analytics/AnalyticsExplainer.vue'
import AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'
import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'
import ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'
import EventTrendPanel from '../components/analytics/EventTrendPanel.vue'

type Period = 'all' | '30' | '90' | 'year' | 'custom'
type Dimension = 'source' | 'referral'
// 三個頁籤（2026-10-06 成效統計 UI/UX）：預約是天天看的主體；官網瀏覽是全站合計、期間另算；
// 班別一年看幾次。頁籤寫進網址的 ?tab=，重新整理或分享連結會停在同一頁。
type Tab = 'booking' | 'traffic' | 'classes'
const TABS: { value: Tab; label: string }[] = [
  { value: 'booking', label: '各校預約' },
  { value: 'traffic', label: '官網瀏覽與速度' },
  { value: 'classes', label: '預約孩子的班別' },
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: '開站至今' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: 'year', label: '今年' },
  { value: 'custom', label: '自訂區間' },
]

const route = useRoute()
const router = useRouter()
const isTab = (value: unknown): value is Tab => TABS.some((tab) => tab.value === value)
const tab = computed<Tab>(() => (isTab(route.query.tab) ? route.query.tab : 'booking'))
function selectTab(next: Tab) {
  if (next === tab.value) return
  void router.replace({ query: { ...route.query, tab: next === 'booking' ? undefined : next } })
}
// 左右鍵在頁籤間移動（WAI-ARIA tabs）；焦點跟著移到新的頁籤。
function onTabKey(event: KeyboardEvent, index: number) {
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!delta) return
  event.preventDefault()
  const next = TABS[(index + delta + TABS.length) % TABS.length]!
  selectTab(next.value)
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
  buttons?.[(index + delta + TABS.length) % TABS.length]?.focus()
}

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
// 自訂區間沒選完或太長時，整個預約頁籤只留一句提示。
const rangeMessage = computed(() => {
  if (period.value !== 'custom') return ''
  if (!customRange.value) return '請選擇開始與結束日期。'
  if (rangeTooLong.value) return `自訂區間最長 ${MAX_RANGE_DAYS} 天，請把開始或結束日期調近一點。`
  return ''
})

function refresh() {
  refreshToken.value += 1
  void load()
}

// 重新整理或換條件時保留上一次的數字、淡一點並寫「更新中…」（和瀏覽統計一致），
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
const REFERRAL_ORDER = ['friends_family', 'sibling', 'nearby', 'flyer', 'online', 'other', 'facebook', 'google_reviews', 'parent_community', 'none']
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
  <div class="page analytics">
    <PageHeader lead="官網瀏覽量、網頁速度與各校參觀預約的結果。" more="各校預約有五校比較、到場與取消、每日變化、來源與預約鈕點擊，可以依期間與校區查看；官網瀏覽是全站合計；班別依孩子生日換算。" />

    <div class="analytics__bar">
      <div class="status-tabs analytics__tabs" role="tablist" aria-label="統計分頁">
        <button
          v-for="(item, index) in TABS"
          :key="item.value"
          :id="`analytics-tab-${item.value}`"
          type="button"
          role="tab"
          class="status-tab"
          :class="{ 'is-active': tab === item.value }"
          :aria-selected="tab === item.value"
          :aria-controls="`analytics-panel-${item.value}`"
          :tabindex="tab === item.value ? 0 : -1"
          @click="selectTab(item.value)"
          @keydown="onTabKey($event, index)"
        >{{ item.label }}</button>
      </div>

      <div v-if="tab !== 'traffic'" class="analytics__controls">
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
        <el-button class="analytics__refresh" :loading="loading" :disabled="!campusKey" @click="refresh">重新整理</el-button>
        <span class="hint analytics__status" role="status">{{ updating ? '更新中…' : '' }}</span>
      </div>
    </div>

    <!-- 各校預約 -->
    <div v-show="tab === 'booking'" id="analytics-panel-booking" role="tabpanel" aria-labelledby="analytics-tab-booking" tabindex="-1">
      <h2 class="analytics__section-title">各校預約（{{ periodTitle }}）</h2>
      <el-empty v-if="!visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
      <p v-else-if="rangeMessage" class="field-help">{{ rangeMessage }}</p>
      <div v-else-if="panelsReady" class="booking-grid">
        <BookingOutcomesSection
          :range="range"
          :campus-key="campusKey"
          :period-label="periodLabel"
          :refresh-token="refreshToken"
          :show-compare="visibleCampusKeys.length > 1"
        />

        <section class="panel booking-grid__side funnel-panel" :class="{ 'is-updating': updating }" :aria-busy="loading" aria-labelledby="funnel-title">
          <div class="panel__head"><h2 id="funnel-title">預約流程<span class="analytics__period num">{{ periodLabel }}</span></h2></div>
          <div class="panel__body funnel__body">
            <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
            <el-skeleton v-else-if="loading && !funnel" animated :rows="4" aria-label="正在讀取統計" />
            <template v-else-if="showFunnel && funnel">
              <ol class="funnel">
                <li v-for="s in stages" :key="s.key" class="funnel__row" :class="{ 'funnel__row--cancelled': s.key === 'cancelled' }">
                  <span class="funnel__label">{{ s.label }}</span>
                  <span class="funnel__value num">{{ s.value }}</span>
                  <span class="funnel__track" aria-hidden="true">
                    <span class="funnel__bar" :class="{ 'has-manual': s.manualRatio > 0 }" :style="{ width: `${(s.ratio - s.manualRatio) * 100}%` }" />
                    <span v-if="s.manualRatio > 0" class="funnel__bar funnel__bar--manual" :style="{ width: `${s.manualRatio * 100}%` }" />
                  </span>
                  <span class="funnel__note">{{ s.note }}</span>
                </li>
              </ol>
              <p v-if="hasManualBars" class="analytics__note">條上淡色的一段是後台補登，深色是官網表單。</p>
              <p v-if="cancelReasons" class="analytics__note">取消原因：{{ cancelReasons }}</p>
              <AnalyticsMeta :period="periodLabel" unit="事件次數（依發生日期）" :as-of="funnel.as_of" />
              <AnalyticsExplainer>
                <p>依事件發生的日期（台北時間）計算，所以這段期間的確認、完成或取消，可能是更早送出的需求。</p>
                <p>「送出需求」只算家長從官網送出的；確認率與取消率只拿官網表單的需求來算，後台補登（電話、LINE、親自到園等）與沒有記錄來源的舊資料，件數另外寫。</p>
                <p>2026/10/01 起家長自選場次、送出即預約成功，期間的結束日在這天以後就不計確認率。</p>
              </AnalyticsExplainer>
            </template>
          </div>
        </section>

        <EventTrendPanel class="booking-grid__main" :campus-key="campusKey" :range="range" :period-label="periodLabel" :refresh-token="refreshToken" />

        <div v-if="showFunnel && funnel" class="booking-grid__side analytics__stack" :class="{ 'is-updating': updating }" :aria-busy="loading">
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
                  <el-table-column prop="label" :label="dimension === 'source' ? '來源' : '從哪裡知道'" min-width="110" />
                  <el-table-column prop="created" label="送出" align="right" min-width="56" />
                  <el-table-column prop="confirmed" label="確認" align="right" min-width="56" />
                  <el-table-column prop="completed" label="完成" align="right" min-width="56" />
                  <el-table-column prop="cancelled" label="取消" align="right" min-width="56" />
                  <el-table-column prop="cancelRate" label="取消率" align="right" min-width="64" />
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
                  <el-table-column prop="label" label="按鈕位置" min-width="110" />
                  <el-table-column prop="form" label="預約表單" align="right" min-width="72" />
                  <el-table-column prop="line" label="LINE" align="right" min-width="56" />
                  <el-table-column prop="phone" label="電話" align="right" min-width="56" />
                  <el-table-column prop="external" label="外部網站" align="right" min-width="72" />
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
              <AnalyticsExplainer>
                <p>點擊次數不等於預約數；LINE、電話與外部網站的點擊之後有沒有真的預約，官網無法得知。</p>
              </AnalyticsExplainer>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- 官網瀏覽與速度 -->
    <div v-show="tab === 'traffic'" id="analytics-panel-traffic" role="tabpanel" aria-labelledby="analytics-tab-traffic" tabindex="-1">
      <SiteTrafficPanel />
    </div>

    <!-- 預約孩子的班別 -->
    <div v-show="tab === 'classes'" id="analytics-panel-classes" role="tabpanel" aria-labelledby="analytics-tab-classes" tabindex="-1">
      <el-empty v-if="!visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
      <p v-else-if="rangeMessage" class="field-help">{{ rangeMessage }}</p>
      <ClassDistributionPanel v-else-if="panelsReady" class="analytics__classes" :campus-key="campusKey" :range="range" :period-label="periodLabel" :refresh-token="refreshToken" />
    </div>
  </div>
</template>

<style scoped>
/* 頁籤列與條件列同一行：左邊頁籤、右邊校區與期間。窄視口各自換行。 */
.analytics__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 16px;
}

.analytics__tabs {
  margin-bottom: 0;
}

.analytics__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.analytics__controls .filter-field {
  font-size: var(--text-xs);
}

.analytics__controls .filter-field :deep(.el-select) {
  width: 140px;
}

.analytics__status {
  min-width: 4em;
  align-self: center;
}

/* 視覺上不必再看到大標，但讀屏與測試仍有一個對應的 h2。 */
.analytics__section-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* 預約頁籤的格線：五校比較橫跨整列；左欄 3、右欄 2，每一列左邊是主體（預約結果、每日變化），
   右邊是對照（預約流程、來源與點擊）。1100px 以下退回一欄，照 DOM 順序往下排。 */
.booking-grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: start;
}

.booking-grid__side {
  grid-column: 2;
}

.booking-grid__main {
  grid-column: 1;
}

.analytics__stack {
  display: grid;
  gap: 20px;
}

.booking-grid :deep(.panel + .panel) {
  margin-top: 0;
}

.is-updating {
  opacity: 0.6;
  transition: opacity 180ms var(--ease-out);
}

.analytics__classes {
  max-width: 760px;
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
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
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
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.panel__body .analytics__note {
  padding: 8px 0 0;
}

.analytics__table {
  margin-top: 12px;
}

.funnel__body {
  display: grid;
  gap: 10px;
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
  padding: 0;
}

/* 一列兩行：第一行名稱＋數字，第二行長條，第三行說明；右欄 2/5 寬放得下。 */
.funnel__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label value'
    'track track'
    'note note';
  align-items: baseline;
  gap: 4px 12px;
  padding: 10px 0;
}

.funnel__row + .funnel__row {
  border-top: 1px solid var(--line);
}

.funnel__label {
  grid-area: label;
  color: var(--ink-2);
}

.funnel__track {
  grid-area: track;
  display: flex;
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.funnel__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
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
  grid-area: value;
  text-align: right;
  font-weight: 600;
  font-size: var(--text-lg);
}

.funnel__note {
  grid-area: note;
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.funnel__note:empty {
  display: none;
}

/* 四種點擊兩兩一列（右欄不寬）；手機沿用共用的兩欄。 */
.analytics__clicks {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* 1400px 以下右欄放不下六欄的來源表（會變成表內橫捲），改成左右等寬。 */
@media (max-width: 1400px) {
  .booking-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .booking-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .booking-grid__side,
  .booking-grid__main {
    grid-column: auto;
  }

  .analytics__clicks {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .analytics__bar {
    align-items: stretch;
  }

  .analytics__tabs {
    flex: 1 1 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .analytics__tabs .status-tab {
    flex: 1 1 0;
    justify-content: center;
    min-height: 44px;
    padding: 0 10px;
  }

  .analytics__controls {
    flex: 1 1 100%;
  }

  .analytics__controls .filter-field {
    flex: 1 1 calc(50% - 6px);
    font-size: var(--text-base);
  }

  .analytics__controls .filter-field :deep(.el-select) {
    width: 100%;
  }

  .analytics__refresh {
    flex: 1 1 100%;
  }

  .analytics__status {
    display: none;
  }

  .analytics__clicks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .analytics__range {
    flex-basis: 100%;
  }

  .analytics__range :deep(.el-date-editor) {
    width: 100%;
  }
}
</style>
