<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BookingAttributionOut } from '../../api/types'
import { TOUCH_SOURCE_LABELS, campusLabel } from '../../api/labels'
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
const props = defineProps<{ campusKey: string; range: DateRange | null; periodLabel: string; refreshToken?: number }>()

const touch = ref<'last' | 'first'>('last')
const data = ref<BookingAttributionOut | null>(null)
const loadedCampus = ref('')
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
const touchLabel = computed(() => (touch.value === 'last' ? '預約前最後來源' : '第一次進站'))
</script>

<template>
  <section class="panel attribution" :class="{ 'is-updating': loading && data }" aria-labelledby="attribution-title" :aria-busy="loading">
    <div class="panel__head attribution__head">
      <h2 id="attribution-title">網站來源{{ data ? `・${campusLabel(loadedCampus)}校` : '' }}</h2>
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
        <StatsDimensionTable
          v-else
          :title="touchLabel"
          :rows="rows"
          :columns="COLUMNS"
          row-key="key"
          empty-text="沒有資料"
          :export-filename="bookingCsvName(`網站來源-${touchLabel}`, `${campusLabel(loadedCampus)}`, loadedPeriod)"
        />
        <AnalyticsMeta :period="loadedPeriod" unit="官網送出的預約案件（含已取消）" :as-of="data.as_of" />
        <AnalyticsExplainer>
          <p>家長送出預約時，網站自動記下這個瀏覽器「第一次進站」與「預約前最後一次從外面點進來」的來源，和家長自己勾的「得知管道」是兩回事。例如上週點廣告進來、今天自己打網址回來預約，「預約前最後來源」算付費廣告。</p>
          <p>到場率＝已到場 ÷（已到場＋未到場）；預繳率＝預繳 ÷ 已到場，預繳讀招生入學的資料（已預繳、已轉正式，或從這兩種退出的都算預繳過）。</p>
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
