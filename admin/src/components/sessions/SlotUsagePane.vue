<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api/client'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { barWidth, type StatsColumn } from '../../admissions/statsFormat'
import AnalyticsExplainer from '../analytics/AnalyticsExplainer.vue'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import {
  BUCKET_LABELS, lookupEmptyText, lookupSummaryText, signalText, slotLabel, slotsEmptyText, usageCsvFilename,
  type SlotUsage, type SlotUsageRow,
} from '../../utils/slotUsage'

// 場次使用情況（2026-10-13 規格 §5.2）：上面是新預約表單近 4 週的「最早能約哪天」，下面是各時段過去坐了幾成。
// 兩塊來自同一支 API，失敗是一起失敗、一起重試。數字寫出來，長條只是輔助（DESIGN.md：圖是表格＋CSS 長條）。
const props = defineProps<{ campusKey: string; campusName: string }>()
defineEmits<{ 'go-calendar': [] }>()

const WEEK_CHOICES = [4, 12, 26] as const
const weeks = ref<(typeof WEEK_CHOICES)[number]>(12)
const usage = ref<SlotUsage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<SlotUsage>(`/admin/visit-slot-usage?campus_key=${props.campusKey}&weeks=${weeks.value}`)
    if (requests.isCurrent(request)) usage.value = result
  } catch {
    if (requests.isCurrent(request)) {
      usage.value = null
      error.value = '無法讀取場次使用情況，請重新載入。'
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}
// 換校區時先清空：回應回來前不能顯示「新校名＋舊校數字」。只換週數則保留舊表格，等新範圍回來再換。
watch(() => [props.campusKey, weeks.value] as const, ([campusKey], previous) => {
  if (previous && previous[0] !== campusKey) {
    usage.value = null
    error.value = null
  }
  load()
}, { immediate: true })

const lookupEmpty = computed(() => (usage.value ? lookupEmptyText(usage.value) : null))
const slotsEmpty = computed(() => (usage.value ? slotsEmptyText(usage.value) : null))
const maxBucket = computed(() => Math.max(1, ...(usage.value?.lookups.buckets.map(b => b.count) ?? [0])))
const hasOftenFull = computed(() => usage.value?.slots.rows.some(r => r.signal === 'often_full') ?? false)

type Row = SlotUsageRow & { slot: string; fill: number; signalLabel: string; key: string }
const rows = computed<Row[]>(() => (usage.value?.slots.rows ?? []).map(r => ({
  ...r,
  key: `${r.weekday}-${r.start_time}-${r.end_time}`,
  slot: slotLabel(r),
  fill: Math.round(r.fill_rate * 100),
  signalLabel: signalText(r.signal, usage.value?.slots.thresholds.min_slots ?? 4),
})))
const columns: StatsColumn[] = [
  { key: 'slot', label: '時段', kind: 'text', sticky: true },
  { key: 'slot_count', label: '場次數', kind: 'count' },
  { key: 'capacity_total', label: '總名額', kind: 'count' },
  { key: 'booked', label: '已約', kind: 'count' },
  { key: 'fill', label: '填滿率（%）', kind: 'bar', barMax: 100 },
  { key: 'full_count', label: '額滿場次', kind: 'count' },
  { key: 'signalLabel', label: '判讀', kind: 'text' },
]
</script>

<template>
  <div v-loading="loading" class="usage" :class="{ 'usage--pending': loading && !usage }" :aria-busy="loading">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" data-test="reload" @click="load">重新載入</el-button>
    </el-alert>

    <template v-else-if="usage">
      <section class="usage__block" aria-labelledby="usage-lookup-title">
        <h2 id="usage-lookup-title" class="usage__title">最早能約哪天（近 4 週）</h2>
        <p v-if="lookupEmpty" class="empty-note">{{ lookupEmpty }}</p>
        <template v-else>
          <p class="usage__summary">{{ lookupSummaryText(campusName, usage.lookups) }}</p>
          <ul class="usage__buckets">
            <li v-for="bucket in usage.lookups.buckets" :key="bucket.key" class="usage__bucket">
              <span class="usage__bucket-label">{{ BUCKET_LABELS[bucket.key] ?? bucket.key }}</span>
              <span class="usage__bar" aria-hidden="true"><span :style="{ width: barWidth(bucket.count, maxBucket) }" /></span>
              <span class="usage__bucket-count num">{{ bucket.count }} 次</span>
            </li>
          </ul>
        </template>
        <p v-if="usage.lookups.first_recorded_day" class="hint">從 {{ usage.lookups.first_recorded_day }} 開始記錄。</p>
      </section>

      <section class="usage__block" aria-labelledby="usage-slots-title">
        <div class="usage__head">
          <h2 id="usage-slots-title" class="usage__title">各時段坐了幾成</h2>
          <div class="usage__weeks" role="group" aria-label="統計範圍">
            <el-button
              v-for="choice in WEEK_CHOICES" :key="choice" size="small" :data-test="`weeks-${choice}`"
              :type="weeks === choice ? 'primary' : 'default'" :aria-pressed="weeks === choice" @click="weeks = choice"
            >近 {{ choice }} 週</el-button>
          </div>
        </div>
        <p v-if="slotsEmpty" class="empty-note">{{ slotsEmpty }}</p>
        <StatsDimensionTable
          v-else :title="`時段（${usage.slots.date_from} 至 ${usage.slots.date_to}）`" :rows="rows" :columns="columns" row-key="key"
          empty-text="" :export-filename="usageCsvFilename(campusName, usage.slots.weeks, usage.today)"
        />
        <p v-if="usage.slots.excluded_cases" class="hint">已排除的測試或重複預約 {{ usage.slots.excluded_cases }} 筆，不算進已約。</p>
        <p v-if="hasOftenFull" class="usage__link">
          <el-button link type="primary" data-test="go-calendar" @click="$emit('go-calendar')">到接待月曆改規則</el-button>
        </p>
      </section>

      <AnalyticsExplainer summary="這些數字怎麼算">
        <ul>
          <li>最早能約哪天：家長每打開一次新預約表單算一次，所以單位是「次」，同一位家長重新整理或切校區會算兩次；沒有存任何能辨識家長的資料。</li>
          <li>只算已經過去的場次，不含今天與未來；園方關閉的場次（休假、手動關閉）不算。</li>
          <li>已約＝排進這個場次、沒有取消的預約；後來到場或沒來都算佔了位子。填滿率＝已約 ÷ 總名額，最多 100%。</li>
          <li>同一個時段（星期＋開始＋結束時間）不到 {{ usage.slots.thresholds.min_slots }} 場，還不判斷；一半（{{ Math.round(usage.slots.thresholds.often_full_share * 100) }}%）以上的場次額滿，標「常額滿」；填滿率在 {{ Math.round(usage.slots.thresholds.rarely_booked_rate * 100) }}% 以下，標「很少人約」。這是描述，不是預測。</li>
        </ul>
      </AnalyticsExplainer>
    </template>
  </div>
</template>

<style scoped>
.usage { display: grid; gap: 24px; }
.usage--pending { min-height: 160px; }
.usage__block { display: grid; gap: 12px; }
.usage__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.usage__title { margin: 0; font-size: var(--text-lg); }
.usage__summary { margin: 0; color: var(--ink); }
.usage__buckets { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.usage__bucket { display: grid; grid-template-columns: 7em minmax(0, 1fr) 4.5em; align-items: center; gap: 12px; font-size: var(--text-sm); }
.usage__bar { height: 10px; border-radius: 5px; background: var(--surface-3); overflow: hidden; }
.usage__bar > span { display: block; height: 100%; border-radius: 5px; background: var(--el-color-primary); }
.usage__bucket-count { text-align: right; }
.usage__link { margin: 0; }
@media (max-width: 720px) {
  .usage__bucket { grid-template-columns: 6em minmax(0, 1fr) 4em; gap: 8px; }
}
</style>
