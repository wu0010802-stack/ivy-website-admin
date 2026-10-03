<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EventTrendOut } from '../../api/types'
import { campusLabel } from '../../api/labels'
import { SELF_BOOKING_SINCE, getEventTrend, rangeKey, type DateRange } from '../../api/analytics'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsMeta from './AnalyticsMeta.vue'
import DailyBars from './DailyBars.vue'

// 選定校區的每日事件（GET /admin/analytics/event-trend）。和「預約流程」同一個口徑：依事件發生
// 的台北日期計數；確認不畫（10/01 起和送出需求同時發生），未到場沒有事件，看「預約結果」。
type Series = 'request_created' | 'visit_completed' | 'visit_cancelled' | 'clicks'
const SERIES: { value: Series; label: string }[] = [
  { value: 'request_created', label: '送出需求' },
  { value: 'visit_completed', label: '已到場' },
  { value: 'visit_cancelled', label: '已取消' },
  { value: 'clicks', label: '預約鈕點擊' },
]
const MARKERS = [{ day: SELF_BOOKING_SINCE, label: '家長自選場次上線，送出即預約成功' }]

const props = defineProps<{ campusKey: string; range: DateRange | null; periodLabel: string; refreshToken?: number }>()
const series = ref<Series>('request_created')
const trend = ref<EventTrendOut | null>(null)
// 畫面上這批資料的校區：重抓時舊資料還在，標題不能先換成新校區。
const loadedCampus = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  const campus = props.campusKey
  try {
    const result = await getEventTrend(campus, props.range)
    if (requests.isCurrent(request)) {
      trend.value = result
      loadedCampus.value = campus
    }
  } catch {
    if (!requests.isCurrent(request)) return
    trend.value = null
    error.value = '無法讀取每日變化，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${props.campusKey}|${rangeKey(props.range)}|${props.refreshToken ?? 0}`, load, { immediate: true })

const seriesLabel = computed(() => SERIES.find((item) => item.value === series.value)!.label)
const points = computed(() => (trend.value?.days ?? []).map((item) => ({ day: item.day, value: item[series.value] })))
const slash = (day: string) => day.replaceAll('-', '/')
const actualPeriod = computed(() => (trend.value ? `${slash(trend.value.date_from)}–${slash(trend.value.date_to)}` : props.periodLabel))
</script>

<template>
  <section class="panel trend" :class="{ 'is-updating': loading && trend }" aria-labelledby="event-trend-title" :aria-busy="loading">
    <div class="panel__head trend__head">
      <h2 id="event-trend-title">每日變化{{ trend ? `・${campusLabel(loadedCampus)}校` : '' }}</h2>
      <el-radio-group v-model="series" size="small" aria-label="要看的項目">
        <el-radio-button v-for="item in SERIES" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel__body trend__body">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
      <el-skeleton v-else-if="loading && !trend" animated :rows="3" aria-label="正在讀取每日變化" />
      <template v-else-if="trend">
        <DailyBars :title="`每日${seriesLabel}`" :points="points" unit="次" :markers="MARKERS" />
        <AnalyticsMeta :period="actualPeriod" unit="事件次數（依發生日期）" :as-of="trend.as_of" />
        <p v-if="trend.truncated" class="hint">期間超過 400 天，只畫最近 400 天。</p>
        <p class="hint">已到場、已取消可能是更早送出的預約；未到場沒有每日紀錄，請看上方「預約結果」。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.trend.is-updating {
  opacity: 0.6;
}

.trend__head {
  flex-wrap: wrap;
  gap: 8px 12px;
}

.trend__body {
  display: grid;
  gap: 8px;
}

.trend__body > .hint {
  margin: 0;
}
</style>
