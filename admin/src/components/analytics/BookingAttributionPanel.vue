<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BookingAttributionOut } from '../../api/types'
import { REFERRAL_SOURCE_LABELS, TOUCH_SOURCE_LABELS, campusLabel } from '../../api/labels'
import { getBookingAttribution, rangeKey, type DateRange } from '../../api/analytics'
import type { StatsColumn } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'
import { bookingCsvName } from './csvExport'

// 官網預約依網站來源分組的到場與預繳（2026-11-16，GET /admin/analytics/booking-attribution）。
// 來源是官網送單時第一方 cookie 自動記下的（docs/specs/2026-11-16-cookie-features-design.md §1），
// 和家長自己勾的「得知管道」不同：這裡看得出廣告、搜尋、社群各帶來多少真的到場與預繳。
const props = defineProps<{ campusKey: string | null; range: DateRange | null; periodLabel: string; refreshToken?: number }>()

const touch = ref<'last' | 'first'>('last')
const data = ref<BookingAttributionOut | null>(null)
const loadedCampus = ref<string | null>(null)
const scopeLabel = computed(() => (loadedCampus.value ? `${campusLabel(loadedCampus.value)}校` : '授權校區合計'))
// 匯出檔名沿用招生統計其他表的寫法（校名不加「校」）。
const csvScope = computed(() => (loadedCampus.value ? campusLabel(loadedCampus.value) : '授權校區合計'))
const loadedPeriod = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  const campus = props.campusKey
  const period = props.periodLabel
  try {
    const result = await getBookingAttribution(campus, touch.value, props.range)
    if (requests.isCurrent(request)) {
      data.value = result
      loadedCampus.value = campus
      loadedPeriod.value = period
    }
  } catch {
    if (!requests.isCurrent(request)) return
    data.value = null
    error.value = '無法讀取網站來源，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${props.campusKey}|${rangeKey(props.range)}|${touch.value}|${props.refreshToken ?? 0}`, load, { immediate: true })

const COLUMNS: StatsColumn[] = [
  { key: 'label', label: '來源', sticky: true },
  { key: 'cases', label: '預約', kind: 'count' },
  { key: 'completed', label: '已到場', kind: 'count' },
  { key: 'no_show', label: '未到場', kind: 'count' },
  { key: 'attendance', label: '到場率', kind: 'rate' },
  { key: 'deposited', label: '預繳', kind: 'count' },
  { key: 'deposit', label: '預繳率', kind: 'rate' },
]

type Counts = BookingAttributionOut['totals']
const cells = (counts: Counts) => ({
  cases: counts.cases,
  completed: counts.completed,
  no_show: counts.no_show,
  attendance: counts.attendance_rate.value,
  deposited: counts.deposited,
  deposit: counts.deposit_rate.value,
})
// 活動代碼（utm_campaign）接在來源下面一列一列列出，標籤寫「來源・代碼」，匯出 CSV 也看得懂。
const rows = computed(() =>
  data.value
    ? data.value.rows.flatMap((row) => {
        const name = TOUCH_SOURCE_LABELS[row.source] ?? row.source
        return [
          { key: row.source, label: name, ...cells(row) },
          ...row.campaigns.map((item) => ({ key: `${row.source}:${item.campaign}`, label: `${name}・${item.campaign}`, ...cells(item) })),
        ]
      })
    : [],
)
// ── 2026-11-18／19 擴充（docs/specs/2026-11-19-cookie-stats-design.md §1～3、§7）──
const DELAY_KEYS = ['same_day', 'days_1_3', 'days_4_7', 'days_8_30', 'days_31_plus'] as const
const DELAY_LABELS: Record<(typeof DELAY_KEYS)[number], string> = {
  same_day: '當天', days_1_3: '1–3 天', days_4_7: '4–7 天', days_8_30: '8–30 天', days_31_plus: '31 天以上',
}
const daysText = (value: number | null | undefined) => (value == null ? '—' : `${Number(value.toFixed(1))} 天`)
const sourceLabel = (key: string) => (key === 'unrecorded' ? '沒有記錄' : TOUCH_SOURCE_LABELS[key] ?? key)
const delayColumns: StatsColumn[] = [
  { key: 'label', label: '第一次來源', sticky: true },
  { key: 'cases', label: '預約', kind: 'count' },
  ...DELAY_KEYS.map((key) => ({ key, label: DELAY_LABELS[key], kind: 'count' as const })),
  { key: 'median', label: '中位數' },
]
const delayRows = computed(() => {
  const out = data.value
  if (!out) return []
  const dated = DELAY_KEYS.reduce((sum, key) => sum + out.delays[key], 0)
  return [
    ...out.delay_rows.map((row) => ({
      key: row.source, label: sourceLabel(row.source), cases: row.cases,
      ...Object.fromEntries(DELAY_KEYS.map((key) => [key, row[key]])), median: daysText(row.median_days),
    })),
    ...(out.delay_rows.length > 1
      ? [{ key: '__total', label: '合計', cases: dated, ...Object.fromEntries(DELAY_KEYS.map((key) => [key, out.delays[key]])), median: daysText(out.median_days) }]
      : []),
  ]
})
const datedCases = computed(() => (data.value ? data.value.totals.cases - data.value.delays.unrecorded : 0))

const pathColumns: StatsColumn[] = [
  { key: 'first', label: '第一次來源', sticky: true },
  { key: 'last', label: '預約前最後外部來源' },
  ...COLUMNS.slice(1),
]
const pathRows = computed(() => (data.value?.source_paths ?? []).map((row) => ({
  key: `${row.first}-${row.last}`,
  first: sourceLabel(row.first),
  last: row.last === 'no_external' ? '之後只直接進站' : sourceLabel(row.last),
  ...cells(row),
})))
// 「廣告助攻」：第一次是付費廣告、最後外部來源不是廣告的組合。
const adAssists = computed(() => (data.value?.source_paths ?? [])
  .filter((row) => row.first === 'ads' && row.last !== 'ads')
  .reduce((sum, row) => sum + row.cases, 0))

// 家長自填「如何知道常春藤」× 網站記到的第一次來源：欄位只列有出現的來源。
const referralSources = computed(() => {
  const present = new Set((data.value?.referral_rows ?? []).flatMap((row) => row.sources.map((item) => item.source)))
  return Object.keys(TOUCH_SOURCE_LABELS).filter((key) => present.has(key))
})
const referralColumns = computed<StatsColumn[]>(() => [
  { key: 'label', label: '家長自填', sticky: true },
  { key: 'cases', label: '預約', kind: 'count' },
  ...referralSources.value.map((key) => ({ key: `src_${key}`, label: TOUCH_SOURCE_LABELS[key] ?? key, kind: 'count' as const })),
])
const referralRows = computed(() => (data.value?.referral_rows ?? []).map((row) => ({
  key: row.referral,
  label: row.referral === 'none' ? '沒有勾' : REFERRAL_SOURCE_LABELS[row.referral] ?? row.referral,
  cases: row.cases,
  ...Object.fromEntries(referralSources.value.map((key) => [`src_${key}`, row.sources.find((item) => item.source === key)?.cases ?? 0])),
})))

// 這台裝置記住預約的使用次數。
const rememberedColumns: StatsColumn[] = [{ key: 'label', label: '動作', sticky: true }, { key: 'count', label: '次數', kind: 'count' }]
const rememberedRows = computed(() => {
  const r = data.value?.remembered
  if (!r) return []
  return [
    { key: 'shown', label: '預約頁顯示「您已預約」', count: r.shown },
    { key: 'opened', label: '按「修改或取消」', count: r.opened },
    { key: 'opened_without_email', label: '按「修改或取消」的沒留 Email 家長', count: r.opened_without_email },
    { key: 'dismissed', label: '按「不是我」', count: r.dismissed },
  ]
})
const rememberedAny = computed(() => rememberedRows.value.some((row) => row.count > 0))
const touchLabel = computed(() => (touch.value === 'last' ? '預約前最後來源' : '第一次進站'))
</script>

<template>
  <section class="panel attribution" :class="{ 'is-updating': loading && data }" aria-labelledby="attribution-title" :aria-busy="loading">
    <div class="panel__head attribution__head">
      <h2 id="attribution-title">網站來源{{ data ? `・${scopeLabel}` : '' }}</h2>
      <el-radio-group v-model="touch" size="small" aria-label="依哪一次進站分組">
        <el-radio-button value="last">預約前最後來源</el-radio-button>
        <el-radio-button value="first">第一次進站</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel__body attribution__body">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
      <el-skeleton v-else-if="loading && !data" animated :rows="3" aria-label="正在讀取網站來源" />
      <template v-else-if="data">
        <p v-if="data.totals.cases === 0" class="field-help">這段期間沒有官網送出的預約。</p>
        <template v-else>
          <StatsDimensionTable
            :title="touchLabel"
            :rows="rows"
            :columns="COLUMNS"
            row-key="key"
            empty-text="沒有資料"
            :export-filename="bookingCsvName(`網站來源-${touchLabel}`, csvScope, loadedPeriod)"
          />
          <StatsDimensionTable
            v-if="pathRows.length"
            title="第一次來源 × 預約前最後外部來源"
            :rows="pathRows"
            :columns="pathColumns"
            row-key="key"
            empty-text="沒有資料"
            :export-filename="bookingCsvName('第一次與最後來源', csvScope, loadedPeriod)"
          />
          <p v-if="adAssists" class="field-help" data-test="attribution-ad-assists">第一次由付費廣告帶進站、預約前最後一次是別的來源的有 {{ adAssists }} 件（廣告助攻）。</p>
          <StatsDimensionTable
            v-if="delayRows.length"
            title="從第一次進站到送出預約隔了幾天"
            :rows="delayRows"
            :columns="delayColumns"
            row-key="key"
            empty-text="沒有資料"
            :export-filename="bookingCsvName('第一次進站到預約天數', csvScope, loadedPeriod)"
          />
          <p class="field-help">依台北日期計算；{{ data.totals.cases }} 件官網預約中有 {{ datedCases }} 件記得到第一次進站的日期。</p>
          <StatsDimensionTable
            v-if="referralRows.length"
            title="家長自填「如何知道常春藤」× 網站記到的第一次來源"
            :rows="referralRows"
            :columns="referralColumns"
            row-key="key"
            empty-text="沒有資料"
            :export-filename="bookingCsvName('自填管道對照第一次來源', csvScope, loadedPeriod)"
          />
        </template>
        <StatsDimensionTable
          v-if="rememberedAny"
          title="這台裝置記住預約"
          :rows="rememberedRows"
          :columns="rememberedColumns"
          row-key="key"
          empty-text="沒有資料"
          :export-filename="bookingCsvName('這台裝置記住預約', csvScope, loadedPeriod)"
        />
        <AnalyticsMeta :period="loadedPeriod" unit="官網送出的預約案件（含已取消）" :coverage="campusKey ? undefined : '授權校區合計'" :as-of="data.as_of" />
        <AnalyticsExplainer>
          <p>家長送出預約時，網站自動記下這個瀏覽器「第一次進站」與「預約前最後一次從外面點進來」的來源，和家長自己勾的「得知管道」是兩回事。例如上週點廣告進來、今天自己打網址回來預約，「預約前最後來源」算付費廣告。</p>
          <p>到場率＝已到場 ÷（已到場＋未到場）；預繳率＝預繳 ÷ 已到場，預繳讀招生入學的資料（已預繳、已轉正式，或從這兩種退出的都算預繳過）。</p>
          <p>「第一次 × 最後」：「之後只直接進站」是這個瀏覽器第一次之後都自己打網址或從書籤回來。天數表只算記得到第一次進站日期的預約；這個瀏覽器 90 天沒來，紀錄會重新起算。</p>
          <p>自填對照：家長複選的每個選項各算一次，只看記得到第一次來源的預約。常見的是勾「親友介紹」、實際從搜尋引擎找到網站。</p>
          <p v-if="rememberedAny">「這台裝置記住預約」是預約成功後同一台裝置再回到預約頁的使用次數（同一位家長重新整理會再算一次），從 2026/11/19 起累計。</p>
          <p>「沒有記錄」是 2026/11/16 以前的預約、瀏覽器開了「不要追蹤」，或擋掉 cookie 的。活動代碼是連結上的 utm_campaign。</p>
        </AnalyticsExplainer>
      </template>
    </div>
  </section>
</template>

<style scoped>
.attribution.is-updating {
  opacity: 0.6;
}

.attribution__head {
  flex-wrap: wrap;
  gap: 8px 12px;
}

.attribution__body {
  display: grid;
  gap: 8px;
}

.attribution__body > .field-help {
  margin: 0;
}
</style>
