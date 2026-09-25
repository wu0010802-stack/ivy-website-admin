<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { AnalyticsFunnelOut } from '../api/types'
import { cancelReasonLabel, ctaEntryLabel, funnelReferralLabel, funnelSourceLabel } from '../api/labels'
import { taipeiToday } from '../composables/newsContent'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'

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
const error = ref<string | null>(null)
const requests = useRequestSequence()
// 手機上日期區間只顯示一個月，雙月面板約 646px 會超出 390px 螢幕。
const narrow = useNarrowScreen()

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

async function load() {
  const request = requests.begin()
  funnel.value = null
  if (!campusKey.value || (period.value === 'custom' && !customRange.value)) { loading.value = false; return }
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

const count = (key: string) => funnel.value?.counts[key] ?? 0
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')

const periodLabel = computed(() => (range.value ? `${range.value.from.replaceAll('-', '/')}–${range.value.to.replaceAll('-', '/')}` : '開站至今'))

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

const stages = computed(() => {
  const created = count('request_created')
  const confirmed = count('visit_confirmed')
  const completed = count('visit_completed')
  const cancelled = count('visit_cancelled')
  const max = Math.max(created, confirmed, completed, cancelled, 1)
  return [
    { key: 'created', label: '已送出需求', value: created, ratio: created / max, note: '家長在官網填表' },
    { key: 'confirmed', label: '已確認預約', value: confirmed, ratio: confirmed / max, note: created ? `${percent(confirmed, created)} 的需求` : '' },
    { key: 'completed', label: '已完成參觀', value: completed, ratio: completed / max, note: confirmed ? `${percent(completed, confirmed)} 的確認` : '' },
    { key: 'cancelled', label: '已取消', value: cancelled, ratio: cancelled / max, note: created ? `取消率 ${percent(cancelled, created)}` : '' },
  ]
})

const cancelReasons = computed(() =>
  Object.entries(funnel.value?.cancelled_by_reason ?? {})
    .filter(([, value]) => value > 0)
    .map(([reason, value]) => `${cancelReasonLabel(reason)} ${value}`)
    .join('・'),
)

// 依來源的列：已知代碼照固定順序，舊資料（unknown）排最後。
const SOURCE_ORDER = ['web', 'phone', 'line', 'walk_in', 'external']
const REFERRAL_ORDER = ['facebook', 'google_reviews', 'parent_community', 'friends_family', 'other', 'none']
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
        cancelRate: percent(cancelled, created),
      }
    })
})

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
    <PageHeader lead="官網瀏覽量與網頁速度，以及各校參觀需求、預約確認、完成參觀與取消的紀錄，可以依期間與來源查看，協助掌握家長從看網站到到訪的情況。" />

    <SiteTrafficPanel />

    <h2 class="analytics__section-title">各校預約</h2>

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
          :clearable="false" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="統計日期區間" />
      </label>
      <el-button :loading="loading" :disabled="!campusKey" @click="load">重新整理</el-button>
    </div>

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <el-skeleton v-else-if="loading" animated :rows="5" aria-label="正在讀取統計" />
    <p v-else-if="period === 'custom' && !customRange" class="field-help">請選擇開始與結束日期。</p>

    <template v-else-if="funnel">
      <section class="panel">
        <div class="panel__head"><h2>預約流程</h2><span class="analytics__period num">{{ periodLabel }}</span></div>
        <ol class="funnel">
          <li v-for="s in stages" :key="s.key" class="funnel__row" :class="{ 'funnel__row--cancelled': s.key === 'cancelled' }">
            <span class="funnel__label">{{ s.label }}</span>
            <span class="funnel__track" aria-hidden="true"><span class="funnel__bar" :style="{ width: `${s.ratio * 100}%` }" /></span>
            <span class="funnel__value num">{{ s.value }}</span>
            <span class="funnel__note">{{ s.note }}</span>
          </li>
        </ol>
        <p v-if="cancelReasons" class="analytics__note">取消原因：{{ cancelReasons }}</p>
        <p class="analytics__note">依事件發生的日期（台北時間）計算；取消率＝取消數 ÷ 同期送出的需求數。後台補登的案件不算「送出需求」，但確認、完成與取消會算進來。</p>
      </section>

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
          <el-table v-else :data="dimensionRows" row-key="key" size="small" class="analytics__table">
            <el-table-column prop="label" :label="dimension === 'source' ? '來源' : '從哪裡知道'" min-width="120" />
            <el-table-column prop="created" label="送出需求" align="right" min-width="80" />
            <el-table-column prop="confirmed" label="確認" align="right" min-width="64" />
            <el-table-column prop="completed" label="完成" align="right" min-width="64" />
            <el-table-column prop="cancelled" label="取消" align="right" min-width="64" />
            <el-table-column prop="cancelRate" label="取消率" align="right" min-width="72" />
          </el-table>
          <p v-if="dimension === 'referral' && dimensionRows.length" class="analytics__note">家長可以複選，各列加總可能大於總數。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head"><h2>預約鈕點擊</h2></div>
        <div class="panel__body">
          <div class="stat-list">
            <div v-for="c in clicks" :key="c.label" class="click">
              <span class="stat__label">{{ c.label }}</span>
              <span class="stat__value">{{ c.value }}</span>
            </div>
          </div>
          <el-table v-if="entryRows.length" :data="entryRows" row-key="key" size="small" class="analytics__table">
            <el-table-column prop="label" label="按鈕位置" min-width="140" />
            <el-table-column prop="form" label="預約表單" align="right" min-width="80" />
            <el-table-column prop="line" label="LINE" align="right" min-width="64" />
            <el-table-column prop="phone" label="電話" align="right" min-width="64" />
            <el-table-column prop="external" label="外部網站" align="right" min-width="80" />
          </el-table>
          <p v-if="unassignedClicks" class="analytics__note">另有 {{ unassignedClicks }} 次點擊沒有指定校區（例如首頁頁首的預約鈕），不算在各校裡。</p>
          <p class="analytics__note">點擊次數不等於預約數；LINE、電話與外部網站的點擊之後有沒有真的預約，官網無法得知。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.analytics__section-title {
  margin: 28px 0 12px;
  font-size: 16px;
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

.panel__body .analytics__note {
  padding: 8px 0 0;
}

.analytics__table {
  margin-top: 12px;
}

.funnel__row--cancelled .funnel__bar {
  background: var(--ink-3);
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

.funnel__value {
  text-align: right;
  font-weight: 600;
  font-size: 16px;
}

.funnel__note {
  font-size: 12px;
  color: var(--ink-3);
}

.click {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
