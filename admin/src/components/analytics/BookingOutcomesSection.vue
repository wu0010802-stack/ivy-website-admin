<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import type { BookingOutcomesOut, CampusOutcomeOut } from '../../api/types'
import { BOOKING_MODE_LABELS, campusLabel, cancelReasonLabel } from '../../api/labels'
import {
  PENDING_KINDS, PENDING_KIND_LABELS, getBookingOutcomes, isSmallSample, pendingLink, rangeKey, rateText, type DateRange,
} from '../../api/analytics'
import type { StatsColumn } from '../../admissions/statsFormat'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'

// 預約結果（GET /admin/analytics/booking-outcomes，招生分析報告階段 1 第 1、4、5 項）：期間內
// 送出的案件現在各是什麼結果。一次回全部授權校區，換校只換顯示的列、不重抓；換期間才重抓。
// 和下方「預約流程」（依事件發生日期）口徑不同，畫面寫明不能互相相除。
const props = defineProps<{ range: DateRange | null; campusKey: string; periodLabel: string; showCompare: boolean; refreshToken?: number }>()

const UNIT = '預約案件數（同一個孩子預約兩校算兩筆，不是家庭數）'
const COVERAGE = '依送出日期取這段期間的案件，看它們現在的結果；和下方「預約流程」依事件發生日期計算不同，兩邊的數字不能互相相除。'

const { can } = usePermissions()
const data = ref<BookingOutcomesOut | null>(null)
// 畫面上這批資料的期間標籤：重抓期間時舊數字還在，標題與說明列不能先換成新期間。
const loadedLabel = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  const label = props.periodLabel
  try {
    const result = await getBookingOutcomes(props.range)
    if (requests.isCurrent(request)) {
      data.value = result
      loadedLabel.value = label
    }
  } catch (err) {
    if (!requests.isCurrent(request)) return
    data.value = null
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    error.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取預約結果，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${rangeKey(props.range)}|${props.refreshToken ?? 0}`, load, { immediate: true })

const row = computed<CampusOutcomeOut | null>(() => data.value?.campuses.find((item) => item.campus_key === props.campusKey) ?? null)
const canOpenCases = computed(() => can('booking.read'))
const modeLabel = (mode: string | null) => (mode ? BOOKING_MODE_LABELS[mode] ?? mode : '尚未設定')
const reasonText = (reasons: Record<string, number>) =>
  Object.entries(reasons).filter(([, value]) => value > 0).map(([reason, value]) => `${cancelReasonLabel(reason)} ${value}`).join('・')

const stats = computed(() => {
  const current = row.value
  if (!current) return []
  return [
    { label: '預約案件', value: current.cases, note: `官網 ${current.web_cases}・補登 ${current.cases - current.web_cases}` },
    { label: '已到場', value: current.completed, note: '' },
    { label: '未到場', value: current.no_show, note: '' },
    { label: '參觀時間過了，還沒標記（這批）', value: current.awaiting_attendance, note: '' },
    { label: '預約正常（還沒到參觀日）', value: current.upcoming, note: '' },
    { label: '已取消', value: current.cancelled, note: reasonText(current.cancelled_by_reason) },
    ...(current.pending ? [{ label: '舊資料的待處理', value: current.pending, note: '' }] : []),
    ...(current.unscheduled ? [{ label: '已確認、沒有場次（舊資料）', value: current.unscheduled, note: '' }] : []),
  ]
})

const rates = computed(() => {
  const current = row.value
  if (!current) return []
  return [
    { key: 'attendance', label: '到場率', rate: current.attendance_rate, hint: '已到場 ÷（已到場＋未到場）' },
    { key: 'no_show', label: '未到率', rate: current.no_show_rate, hint: '未到場 ÷（已到場＋未到場）' },
    { key: 'cancel', label: '取消率', rate: current.cancel_rate, hint: '已取消 ÷ 預約案件' },
  ]
})

const COLUMNS: StatsColumn[] = [
  { key: 'campus', label: '校區', sticky: true },
  { key: 'mode', label: '預約方式' },
  { key: 'cases', label: '預約案件', kind: 'count' },
  { key: 'completed', label: '已到場', kind: 'count' },
  { key: 'no_show', label: '未到場', kind: 'count' },
  { key: 'attendance', label: '到場率' },
  { key: 'cancelled', label: '已取消', kind: 'count' },
  { key: 'reasons', label: '取消原因' },
  { key: 'cancel', label: '取消率' },
  { key: 'awaiting_now', label: '待標記到場（現在）', kind: 'count' },
  { key: 'follow_up_now', label: '到期待追蹤（現在）', kind: 'count' },
  { key: 'legacy_now', label: '舊資料待處理（現在）', kind: 'count' },
]

const rateCell = (rate: Parameters<typeof rateText>[0]) => `${rateText(rate)}${isSmallSample(rate) ? '・樣本較少' : ''}`

const compareRows = computed(() => {
  if (!data.value) return []
  const rows: Record<string, unknown>[] = data.value.campuses.map((item) => ({
    key: item.campus_key,
    campus: `${campusLabel(item.campus_key)}${item.active ? '' : '（已停用）'}`,
    mode: modeLabel(item.booking_mode),
    cases: item.cases,
    completed: item.completed,
    no_show: item.no_show,
    attendance: rateCell(item.attendance_rate),
    cancelled: item.cancelled,
    reasons: reasonText(item.cancelled_by_reason),
    cancel: rateCell(item.cancel_rate),
    awaiting_now: item.open_now.awaiting_attendance,
    follow_up_now: item.open_now.follow_up_due,
    legacy_now: item.open_now.legacy_pending,
  }))
  const totals = data.value.totals
  const open = data.value.open_now_totals
  rows.push({
    key: 'total', campus: '合計', mode: '', cases: totals.cases, completed: totals.completed, no_show: totals.no_show,
    attendance: rateCell(totals.attendance_rate), cancelled: totals.cancelled, reasons: reasonText(totals.cancelled_by_reason),
    cancel: rateCell(totals.cancel_rate), awaiting_now: open.awaiting_attendance, follow_up_now: open.follow_up_due, legacy_now: open.legacy_pending,
  })
  return rows
})
</script>

<template>
  <div class="outcomes-section" :class="{ 'is-updating': loading && data }" :aria-busy="loading">
    <StatsDimensionTable
      v-if="showCompare && data"
      :title="`五校比較（${loadedLabel}）`"
      :rows="compareRows"
      :columns="COLUMNS"
      row-key="key"
      empty-text="沒有可比較的校區"
      caption="數字是預約案件數，同一個孩子預約兩校算兩筆；比率括號內是分子／分母。「現在」三欄是此刻的待處理，不受期間影響。不受上方「查看校區」影響。"
    />

    <section class="panel" aria-labelledby="outcomes-title">
      <div class="panel__head">
        <h2 id="outcomes-title">預約結果{{ row ? `・${campusLabel(row.campus_key)}校` : '' }}</h2>
        <span class="hint" role="status">{{ loading && data ? '更新中…' : '' }}</span>
      </div>
      <div class="panel__body outcomes__body">
        <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="loading && !data" animated :rows="4" aria-label="正在讀取預約結果" />
        <template v-else-if="data">
          <p v-if="!row" class="field-help">這個校區沒有資料。</p>
          <template v-else>
            <p v-if="row.booking_mode !== 'slots'" class="hint">
              {{ campusLabel(row.campus_key) }}校目前的預約方式是「{{ modeLabel(row.booking_mode) }}」，官網預約的件數會很少或是 0。
            </p>
            <div class="stat-list outcomes__stats">
              <div v-for="stat in stats" :key="stat.label" class="stat">
                <span class="stat__label">{{ stat.label }}</span>
                <span class="stat__value">{{ stat.value }}</span>
                <span v-if="stat.note" class="hint">{{ stat.note }}</span>
              </div>
            </div>
            <dl class="outcomes__rates">
              <div v-for="item in rates" :key="item.key">
                <dt>{{ item.label }}</dt>
                <dd class="num">
                  {{ rateText(item.rate) }}
                  <el-tag v-if="isSmallSample(item.rate)" size="small" type="info">樣本較少</el-tag>
                </dd>
                <dd class="hint">{{ item.hint }}</dd>
              </div>
            </dl>
            <p v-if="row.awaiting_attendance" class="hint">
              另有 {{ row.awaiting_attendance }} 件參觀時間過了還沒標記，標記之後到場率會變。
            </p>

            <h3 class="outcomes__title">現在待處理</h3>
            <p class="hint">此刻的狀態，不受上方期間影響。</p>
            <ul class="outcomes__pending">
              <li v-for="kind in PENDING_KINDS" :key="kind">
                <span>{{ PENDING_KIND_LABELS[kind] }}</span>
                <router-link v-if="canOpenCases && row.open_now[kind] > 0" class="num" :to="pendingLink(kind, row.campus_key)">{{ row.open_now[kind] }} 件</router-link>
                <span v-else class="num">{{ row.open_now[kind] }} 件</span>
              </li>
            </ul>
            <p v-if="!canOpenCases" class="hint">你的帳號只能看統計數字，看不到是哪幾筆案件。</p>
          </template>
          <AnalyticsMeta :period="loadedLabel" :unit="UNIT" :as-of="data.as_of" :coverage="COVERAGE" />
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.outcomes-section {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}

.outcomes-section.is-updating {
  opacity: 0.6;
}

.outcomes__body {
  display: grid;
  gap: 12px;
}

.outcomes__body > .hint,
.outcomes__body > .field-help {
  margin: 0;
}

.outcomes__rates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.outcomes__rates dt {
  color: var(--ink-3);
  font-size: 13px;
}

.outcomes__rates dd {
  margin: 2px 0 0;
}

.outcomes__rates dd.num {
  font-size: 18px;
  font-weight: 600;
}

.outcomes__title {
  margin: 8px 0 0;
  font-size: 14px;
}

.outcomes__pending {
  list-style: none;
  margin: 0;
  padding: 0;
}

.outcomes__pending li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.outcomes__pending li + li {
  border-top: 1px solid var(--line);
}

@media (max-width: 600px) {
  .outcomes__rates {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
