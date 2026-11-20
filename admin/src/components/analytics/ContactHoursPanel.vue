<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getContactHours, ISO_WEEKDAY_LABELS, type ContactHours } from '../../api/analyticsMore'
import { formatShare } from '../../api/engagement'
import { campusLabel } from '../../api/labels'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './csvExport'
import { DEFAULT_ANALYTICS_DAYS, periodText, type AnalyticsDays } from './filters'

// 家長什麼時候按電話、LINE（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §6）：多半在上班時間外的話，
// LINE 可以設自動回覆、電話可以考慮轉接或語音留言。時段的切法和「什麼時候有人看」不同：上班時間（8–18 點）切在段落邊界上。
const props = withDefaults(defineProps<{ days?: AnalyticsDays; active?: boolean }>(), { days: DEFAULT_ANALYTICS_DAYS, active: true })

const data = ref<ContactHours | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
let requestedDays = 0

async function load() {
  const request = requests.begin()
  requestedDays = props.days
  loading.value = true
  failed.value = false
  try {
    const result = await getContactHours(props.days)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([() => props.active, () => props.days], () => {
  if (props.active && requestedDays !== props.days) void load()
}, { immediate: true })

const BANDS = [
  { label: '凌晨', range: '0–6', from: 0, to: 6 },
  { label: '早上', range: '6–8', from: 6, to: 8 },
  { label: '上午', range: '8–12', from: 8, to: 12 },
  { label: '中午', range: '12–14', from: 12, to: 14 },
  { label: '下午', range: '14–18', from: 14, to: 18 },
  { label: '晚上', range: '18–21', from: 18, to: 21 },
  { label: '深夜', range: '21–24', from: 21, to: 24 },
] as const

const grid = computed(() => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(() => BANDS.map(() => ({ phone: 0, line: 0 })))
  for (const cell of data.value?.cells ?? []) {
    const band = BANDS.findIndex((item) => cell.hour >= item.from && cell.hour < item.to)
    const row = rows[cell.weekday - 1]
    if (band < 0 || !row) continue
    row[band]!.phone += cell.phone
    row[band]!.line += cell.line
  }
  const max = Math.max(0, ...rows.flat().map((item) => item.phone + item.line))
  return { rows, max }
})

const clicks = computed(() => data.value?.clicks ?? 0)
const outside = computed(() => clicks.value - (data.value?.office ?? 0))
const period = computed(() => (data.value ? periodText(data.value.since, data.value.until) : ''))
const channel = (name: 'phone' | 'line') => data.value?.channels.find((row) => row.channel === name)
const officeText = computed(() => {
  const hours = data.value?.office_hours
  return hours ? `週${'一二三四五六日'[hours.weekdays[0]! - 1]}到週${'一二三四五六日'[hours.weekdays[1]! - 1]} ${hours.hours[0]}–${hours.hours[1]} 點` : ''
})
const isOffice = (weekday: number, band: number) => weekday <= 5 && BANDS[band]!.from >= 8 && BANDS[band]!.to <= 18

function exportCsv() {
  saveAnalyticsCsv(analyticsCsvName('電話與LINE的時段', '全站', period.value), ['星期', ...BANDS.flatMap((band) => [`${band.label}（${band.range} 點）電話`, `${band.label}（${band.range} 點）LINE`])],
    grid.value.rows.map((row, index) => [ISO_WEEKDAY_LABELS[index + 1]!, ...row.flatMap((item) => [item.phone, item.line])]))
}
</script>

<template>
  <section class="panel contact-hours" :class="{ 'is-empty': data && !clicks, 'is-updating': loading && data }" aria-labelledby="contact-hours-title" :aria-busy="loading">
    <div class="panel__head">
      <h2 id="contact-hours-title">家長什麼時候按電話、LINE</h2>
      <el-button v-if="clicks" size="small" text data-test="contact-hours-csv" aria-label="把「家長什麼時候按電話、LINE」匯出 CSV" @click="exportCsv">匯出 CSV</el-button>
    </div>
    <div class="panel__body contact-hours__body">
      <p v-if="failed" class="hint">讀不到電話與 LINE 的點擊。<el-button size="small" text @click="load">重新載入</el-button></p>
      <el-skeleton v-else-if="loading && !data" animated :rows="2" aria-label="正在讀取電話與 LINE 的點擊" />
      <p v-else-if="!clicks" class="hint" data-test="contact-hours-empty">這段期間官網上的電話、LINE 按鈕還沒有人點。</p>
      <template v-else>
        <p class="contact-hours__lede" data-test="contact-hours-lede">
          {{ period }}，電話按鈕被點 <strong class="num">{{ channel('phone')?.clicks ?? 0 }}</strong> 次、LINE 按鈕 <strong class="num">{{ channel('line')?.clicks ?? 0 }}</strong> 次；
          <strong class="num">{{ outside }}</strong> 次（{{ formatShare(outside / clicks) }}）在上班時間（{{ officeText }}）以外。
        </p>
        <div class="contact-hours__scroll" role="region" tabindex="0" aria-label="電話與 LINE 的點擊時段（可左右捲動）">
          <table class="contact-hours__table contact-hours__heat" data-test="contact-hours-grid">
            <thead><tr><th scope="col">星期</th><th v-for="band in BANDS" :key="band.label" scope="col" class="num">{{ band.label }}<span class="hint">{{ band.range }}</span></th></tr></thead>
            <tbody>
              <tr v-for="(row, day) in grid.rows" :key="day">
                <th scope="row">{{ ISO_WEEKDAY_LABELS[day + 1] }}</th>
                <td v-for="(item, band) in row" :key="band" class="num" :class="{ 'is-office': isOffice(day + 1, band) }">
                  <span
                    class="contact-hours__cell"
                    :class="{ 'is-zero': !(item.phone + item.line) }"
                    :style="{ '--heat': grid.max ? (item.phone + item.line) / grid.max : 0 }"
                    :title="`電話 ${item.phone}、LINE ${item.line}`"
                  >{{ item.phone + item.line }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="data!.campuses.length > 1" class="contact-hours__scroll" role="region" tabindex="0" aria-label="各校的電話與 LINE 點擊（可左右捲動）">
          <table class="contact-hours__table" data-test="contact-hours-campuses">
            <thead><tr><th scope="col">校區</th><th scope="col" class="num">電話</th><th scope="col" class="num">LINE</th><th scope="col" class="num">上班時間外</th></tr></thead>
            <tbody>
              <tr v-for="row in data!.campuses" :key="row.campus_key ?? 'none'">
                <th scope="row">{{ row.campus_key ? `${campusLabel(row.campus_key)}校` : '不分校' }}</th>
                <td class="num">{{ row.phone }}</td>
                <td class="num">{{ row.line }}</td>
                <td class="num">{{ formatShare((row.clicks - row.office) / row.clicks) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <AnalyticsExplainer>
        <p>官網上各校的電話、LINE 按鈕被點的當下（台灣時間）。灰底的格子是上班時間（{{ officeText || '週一到週五 8–18 點' }}）；各校實際的行政時間不同時，請協助維護官網的人改。</p>
        <p>點了不代表真的打通或傳了訊息。上班時間外的比例高的話，LINE 官方帳號可以設下班時間的自動回覆，電話可以考慮語音留言或轉接。</p>
      </AnalyticsExplainer>
    </div>
  </section>
</template>

<style scoped>
.contact-hours {
  margin-top: 20px;
  transition: opacity 180ms var(--ease-out);
}

.contact-hours.is-updating {
  opacity: 0.6;
}

.contact-hours__body {
  display: grid;
  gap: 12px;
}

.contact-hours__body > .hint,
.contact-hours__lede {
  margin: 0;
}

.contact-hours__scroll {
  overflow-x: auto;
}

.contact-hours__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.contact-hours__table th,
.contact-hours__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.contact-hours__table tbody th {
  font-weight: 500;
}

.contact-hours__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.contact-hours__heat thead .hint {
  display: block;
  font-weight: 400;
}

.contact-hours__heat td {
  padding: 4px;
}

/* 上班時間的格子墊一層淡灰底（顏色深淺留給次數）。 */
.contact-hours__heat td.is-office {
  background: var(--surface-2);
}

.contact-hours__cell {
  display: block;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-color-primary) calc(var(--heat) * 32%), transparent);
}

.contact-hours__cell.is-zero {
  color: var(--ink-3);
}
</style>
