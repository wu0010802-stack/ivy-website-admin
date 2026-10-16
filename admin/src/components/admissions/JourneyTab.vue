<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import JourneyExits from './JourneyExits.vue'
import JourneyFunnel from './JourneyFunnel.vue'
import JourneyTiming from './JourneyTiming.vue'
import { getJourney } from '../../api/admissions'
import { campusLabel } from '../../api/labels'
import type { AdmissionsJourney } from '../../api/types'
import { taipeiToday } from '../../admissions/academic'
import {
  DEFAULT_JOURNEY_FILTER, JOURNEY_PERIODS, JOURNEY_SOURCES, journeyRange, journeySummary, type JourneyFilter,
} from '../../admissions/journeyFormat'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { csvFilename } from '../../utils/csv'

// 預約全程（2026-10-15 規格 §3.3）：同一批預約案件（預定參觀日在期間內、已過參觀時間）從預約到預繳、註冊的人數與
// 各段天數，以及家庭離開的時點。校區跟頁首；期間不看入學學年學期，所以學年學期下拉在這頁停用、期間在這裡選；
// 期間與來源由父層放在網址（filter）。只呈現後端算好的數字，不預測。
// 匯出檔名自己組（不用招生統計共用的：那個帶入學學年學期，這頁不分學年學期）：招生統計-預約全程-表名-校區-起至迄[-來源]，
// 起迄與來源取回應的 filters（資料實際涵蓋的日期，迄日可能被截到今天），不取畫面上的篩選值。
// active：預約全程是不是目前的子分頁。pane 看過之後一直掛著，離開時頁面把篩選收回預設、換校區也會傳進來，
// 不在這頁時只記下要重讀，回來才讀（不在背景打 API）。
const props = withDefaults(defineProps<{ campusKey: string; active?: boolean }>(), { active: true })
const filter = defineModel<JourneyFilter>('filter', { default: () => ({ ...DEFAULT_JOURNEY_FILTER }) })

const data = ref<AdmissionsJourney | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
const narrow = useNarrowScreen()
const MAX_RANGE_DAYS = 400

const range = computed(() => journeyRange(filter.value, taipeiToday()))
const rangeTooLong = computed(() => {
  if (filter.value.period !== 'custom' || !range.value) return false
  const [from, to] = [range.value.from, range.value.to].map((day) => Date.parse(`${day}T00:00:00Z`))
  return (to! - from!) / 86_400_000 + 1 > MAX_RANGE_DAYS
})
const rangeMessage = computed(() => {
  if (filter.value.period !== 'custom') return ''
  if (!range.value) return '請選擇開始與結束日期。'
  if (rangeTooLong.value) return `自訂區間最長 ${MAX_RANGE_DAYS} 天，請把開始或結束日期調近一點。`
  if (range.value.from > range.value.to) return '開始日期不能晚於結束日期。'
  return ''
})

function isFutureDate(date: Date): boolean {
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return local > taipeiToday()
}

const customRange = computed<[string, string] | null>({
  get: (): [string, string] | null => (filter.value.from && filter.value.to ? [filter.value.from, filter.value.to] : null),
  set: (value: [string, string] | null) => { filter.value = { ...filter.value, from: value?.[0] ?? '', to: value?.[1] ?? '' } },
})

let pending = false

async function load() {
  pending = false
  const request = requests.begin()
  const current = range.value
  if (!props.campusKey || !current || rangeMessage.value) {
    data.value = null
    failed.value = false
    loading.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const result = await getJourney({ campus_key: props.campusKey, from: current.from, to: current.to, source: filter.value.source })
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) {
      data.value = null
      failed.value = true
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 換校區：先清空再讀（不留別校的數字）；換期間或來源：保留上一次的數字、淡一點，讀完換掉。
function refresh() {
  if (props.active) void load()
  else pending = true
}
watch(() => props.campusKey, () => { data.value = null; refresh() })
watch(
  [() => filter.value.period, () => filter.value.from, () => filter.value.to, () => filter.value.source],
  refresh,
  { immediate: true },
)
watch(() => props.active, (active) => { if (active && pending) void load() })

const summary = computed(() => (data.value ? journeySummary(data.value, campusLabel(props.campusKey)) : ''))
const empty = computed(() => data.value !== null && data.value.cases.total === 0)
const coverage = computed(() => {
  const found = data.value
  if (!found) return ''
  const { coverage: cover, rescheduled } = found
  return [
    `另有 ${cover.visits_without_request} 筆招生訪視沒有預約案件（現場參觀、舊名單補登、預約案件已刪除），不在這個漏斗裡。`,
    `已到場但沒有招生訪視 ${cover.completed_without_visit} 筆（招生功能關閉期間到場、事後沒補建，或訪視被刪）。`,
    cover.undated_cases ? `預定參觀日算不出來而未納入的案件 ${cover.undated_cases} 筆。` : '',
    // 這裡的 excluded_cases 是被標記排除的測試／重複預約；各段天數裡的 excluded 是不納入天數計算的筆數，兩回事（計畫 P11）。
    cover.excluded_cases ? `已排除的測試或重複預約 ${cover.excluded_cases} 筆，不在這個漏斗裡。` : '',
    `改期過的案件 ${rescheduled.cases}／${rescheduled.total}。`,
  ].filter(Boolean).join('')
})

function csvName(table: string): string {
  const filters = data.value?.filters
  const source = filters ? JOURNEY_SOURCES.find((option) => option.value === filters.source) : undefined
  return csvFilename(
    '招生統計', '預約全程', table, campusLabel(props.campusKey),
    filters ? `${filters.date_from}至${filters.date_to}` : '',
    source && source.value !== 'all' ? source.label : '',
  )
}

function setPeriod(value: string | number | boolean | undefined) {
  const period = JOURNEY_PERIODS.find((option) => option.value === value)?.value
  if (period) filter.value = { ...filter.value, period, ...(period === 'custom' ? {} : { from: '', to: '' }) }
}
function setSource(value: string | number | boolean | undefined) {
  const source = JOURNEY_SOURCES.find((option) => option.value === value)?.value
  if (source) filter.value = { ...filter.value, source }
}
</script>

<template>
  <section class="journey" aria-label="預約全程">
    <div class="journey-controls">
      <label class="filter-field">
        <span>期間</span>
        <el-select :model-value="filter.period" aria-label="期間" @update:model-value="setPeriod">
          <el-option v-for="option in JOURNEY_PERIODS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </label>
      <label v-if="filter.period === 'custom'" class="filter-field journey-range">
        <span>自訂區間</span>
        <el-date-picker
          v-model="customRange" type="daterange" value-format="YYYY-MM-DD" format="YYYY/MM/DD" unlink-panels :single-panel="narrow"
          :disabled-date="isFutureDate" :clearable="false" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="預約全程日期區間"
        />
      </label>
      <el-radio-group :model-value="filter.source" size="default" aria-label="來源" @update:model-value="setSource">
        <el-radio-button v-for="option in JOURNEY_SOURCES" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <p v-if="rangeMessage" class="field-help">{{ rangeMessage }}</p>
    <el-alert v-else-if="failed" type="error" :closable="false" show-icon title="無法讀取預約全程，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="5" animated />
    <p v-else-if="empty" class="empty-note journey-empty">這段期間沒有預約案件。</p>
    <div v-else class="journey-body" :class="{ 'is-updating': loading }" :aria-busy="loading">
      <p class="journey-summary">{{ summary }}</p>
      <JourneyFunnel :data="data" :csv-name="csvName" />
      <JourneyExits :data="data" :csv-name="csvName" />
      <JourneyTiming :data="data" :csv-name="csvName" />
      <p class="hint journey-coverage">{{ coverage }}</p>
    </div>
  </section>
</template>

<style scoped>
.journey {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.journey-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  min-width: 0;
}

/* 日期區間選單預設固定 350px（--el-date-editor-daterange-width），窄螢幕要自己讓它縮。 */
.journey-range :deep(.el-date-editor) {
  max-width: 100%;
}

.journey-body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.journey-body.is-updating {
  opacity: 0.6;
}

.journey-summary {
  margin: 0;
  color: var(--ink);
}

.journey-coverage {
  margin: 0;
}

@media (max-width: 720px) {
  .journey-controls > * {
    max-width: 100%;
  }

  .journey-controls .filter-field {
    flex-basis: 100%;
  }

  .journey-controls .filter-field :deep(.el-select),
  .journey-controls .filter-field :deep(.el-date-editor) {
    width: 100%;
  }
}
</style>
