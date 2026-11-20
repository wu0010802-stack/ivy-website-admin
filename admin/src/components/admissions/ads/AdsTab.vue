<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdConversionStatus from './AdConversionStatus.vue'
import AdSpendDialog from './AdSpendDialog.vue'
import { deleteAdSpend, getAdRoi, listAdSpend } from '../../../api/admissions'
import { apiErrorMessage } from '../../../api/errors'
import { campusLabel } from '../../../api/labels'
import type { AdRoi, AdSpendEntry, AdSpendPlatform } from '../../../api/types'
import { taipeiToday } from '../../../admissions/academic'
import {
  AD_ROW_LABELS, AD_ROI_FIRST_MONTH, PARTIAL_NOTE, campusCellText, costCellText, costText, defaultMonthRange, googleZoneNote, pendingText, spendText,
} from '../../../admissions/adRoiFormat'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { formatCount } from '../area/areaFormat'

// 廣告成效（2026-11-16）：各平台花費對預約、到場、預繳，與每月手填花費。看五校合計，不受頁首校區影響。
// active：這是不是目前的子分頁；第一次切進來才讀（pane 看過之後一直掛著）。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const thisMonth = taipeiToday().slice(0, 7)
const initial = defaultMonthRange(taipeiToday())
const range = ref<[string, string]>([initial.from, initial.to])
const touch = ref<'last' | 'first'>('last')
const data = ref<AdRoi | null>(null)
const entries = ref<AdSpendEntry[]>([])
const failed = ref(false)
const loadedOnce = ref(false)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  failed.value = false
  const [from, to] = range.value
  try {
    const [roi, spend] = await Promise.all([getAdRoi(from, to, touch.value), listAdSpend(from, to)])
    if (!requests.isCurrent(request)) return
    data.value = roi
    entries.value = spend.entries
  } catch {
    if (requests.isCurrent(request)) {
      data.value = null
      failed.value = true
    }
  }
}

watch(() => props.active, (active) => {
  if (active && !loadedOnce.value) {
    loadedOnce.value = true
    void load()
  }
}, { immediate: true })
watch([range, touch], () => { if (loadedOnce.value) void load() })

const disabledMonth = (date: Date) => {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return key > thisMonth || key < AD_ROI_FIRST_MONTH
}
function onRange(value: [string, string] | null) {
  if (value) range.value = value
}

const currency = computed(() => data.value?.google.currency ?? null)
const pending = computed(() => (data.value ? pendingText(data.value.pending) : ''))
const campaigns = computed(() => data.value?.google.campaigns ?? [])
const campusRows = computed(() => (data.value?.by_campus ?? []).filter((item) => item.cases > 0))
const zoneNote = computed(() => googleZoneNote(data.value?.google.time_zone ?? null))
const anyPartial = computed(() => data.value?.rows.some((row) => row.cost_partial) ?? false)
const showCurrency = computed(() => !!currency.value && currency.value !== 'TWD')
const count = (value: number | null) => (value === null ? NO_VALUE : formatCount(value))

// 助攻／收尾（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md §1）：另一次進站是這個平台的廣告、
// 但這筆歸給別的來源。只有廣告列有意義；寫「預約 / 到場 / 預繳」。不分攤花費、不算進成本。
const AD_KEYS = new Set(['google', 'openai', 'meta', 'line', 'other', 'unknown'])
const assistLabel = computed(() => (touch.value === 'last' ? '助攻' : '收尾'))
const assistNote = computed(() => (touch.value === 'last'
  ? '助攻：第一次由這個平台的廣告帶進站，但預約前最後一次是別的來源（例如之後自己搜尋回來）的預約／到場／預繳；不算進上面的預約與成本。'
  : '收尾：預約前最後一次是點這個平台的廣告進來，但第一次是從別的來源認識的預約／到場／預繳；不算進上面的預約與成本。'))
function assistText(row: AdRoi['rows'][number]) {
  if (!AD_KEYS.has(row.key)) return NO_VALUE
  return row.assist_cases ? `${formatCount(row.assist_cases)} / ${formatCount(row.assist_completed)} / ${formatCount(row.assist_deposited)}` : '0'
}

// 各校表：平台 × 校，每格「預約 / 到場 / 預繳」；沒有資料的格子是破折號。
const CAMPUS_ORDER = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const campusPlatforms = computed(() => [...new Set(campusRows.value.map((item) => item.platform))])
function campusCell(platform: string, campus: string) {
  return campusRows.value.find((item) => item.platform === platform && item.campus_key === campus)
}
const platformLabel = (key: string) => AD_ROW_LABELS[key as keyof typeof AD_ROW_LABELS] ?? key

const dialogOpen = ref(false)
const editing = ref<AdSpendEntry | null>(null)
function openAdd() {
  editing.value = null
  dialogOpen.value = true
}
function openEdit(entry: AdSpendEntry) {
  editing.value = entry
  dialogOpen.value = true
}
async function remove(entry: AdSpendEntry) {
  const label = platformLabel(entry.platform)
  try {
    await ElMessageBox.confirm(`會刪掉 ${entry.month} ${label}的花費。`, '刪除這筆花費？', {
      confirmButtonText: '刪除',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
      autofocus: false,
    })
  } catch {
    return
  }
  try {
    await deleteAdSpend(entry.month, entry.platform as AdSpendPlatform)
    ElMessage.success('已刪除')
  } catch (err) {
    notifyError(apiErrorMessage(err, '刪除失敗，請再試一次。'))
  }
  // 失敗（例如別人已刪掉、404）也重讀，畫面才跟資料一致。
  void load()
}
</script>

<template>
  <section class="ads" aria-label="廣告成效">
    <div class="ads-head">
      <el-date-picker
        :model-value="range" type="monthrange" value-format="YYYY-MM" format="YYYY-MM" range-separator="～"
        start-placeholder="開始月份" end-placeholder="結束月份" :clearable="false" :disabled-date="disabledMonth"
        aria-label="月份區間" @update:model-value="onRange"
      />
      <el-radio-group v-model="touch" class="ads-touch" aria-label="歸因方式">
        <el-radio-button value="last">最後一次進站</el-radio-button>
        <el-radio-button value="first">第一次進站</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取廣告成效，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="5" animated />
    <template v-else>
      <div class="ads-scroll">
        <table class="ads-table ads-main">
          <thead>
            <tr>
              <th scope="col">平台</th>
              <th scope="col">花費</th>
              <th scope="col">點擊</th>
              <th scope="col">預約</th>
              <th scope="col">到場</th>
              <th scope="col">預繳</th>
              <th scope="col">{{ assistLabel }}</th>
              <th scope="col">每筆預約</th>
              <th scope="col">每位到場</th>
              <th scope="col">每位預繳</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.rows" :key="row.key">
              <th scope="row">{{ AD_ROW_LABELS[row.key] }}</th>
              <td class="num">{{ spendText(row, currency) }}</td>
              <td class="num">{{ count(row.clicks) }}</td>
              <td class="num">{{ formatCount(row.cases) }}</td>
              <td class="num">{{ formatCount(row.completed) }}</td>
              <td class="num">{{ formatCount(row.deposited) }}</td>
              <td class="num" data-test="ads-assist">{{ assistText(row) }}</td>
              <td class="num">{{ costCellText(row.cost_per_case, row.cost_partial) }}</td>
              <td class="num">{{ costCellText(row.cost_per_completed, row.cost_partial) }}</td>
              <td class="num">{{ costCellText(row.cost_per_deposit, row.cost_partial) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="anyPartial" class="hint ads-note ads-partial">{{ PARTIAL_NOTE }}</p>
      <p v-if="pending" class="ads-note ads-pending">{{ pending }}</p>
      <p v-if="!data.google.configured" class="hint ads-note">Google 花費尚未設定。</p>
      <p v-else-if="data.google.error" class="hint ads-note">Google 花費讀取失敗：{{ data.google.error }}</p>
      <p class="hint ads-note">{{ assistNote }}</p>
      <p class="hint ads-note">預約含之後取消的。沒有計入：開了「不要追蹤」的訪客、看到廣告後直接來電或到校的家長。</p>
      <p class="hint ads-note">Google 花費約晚一天。<template v-if="showCurrency">Google 花費以 {{ currency }} 計。</template></p>
      <p v-if="zoneNote" class="hint ads-note ads-zone">{{ zoneNote }}</p>

      <section v-if="campaigns.length" class="ads-block ads-campaigns" aria-label="Google 活動">
        <h3>Google 活動</h3>
        <div class="ads-scroll">
          <table class="ads-table">
            <thead>
              <tr>
                <th scope="col">活動</th>
                <th scope="col">花費</th>
                <th scope="col">點擊</th>
                <th scope="col">曝光</th>
                <th scope="col">單次點擊</th>
                <th scope="col">Google 回報預約</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in campaigns" :key="item.campaign_id">
                <th scope="row">{{ item.campaign_name }}</th>
                <td class="num">{{ costText(item.cost) }}</td>
                <td class="num">{{ formatCount(item.clicks) }}</td>
                <td class="num">{{ formatCount(item.impressions) }}</td>
                <td class="num">{{ costText(item.cost_per_click) }}</td>
                <td class="num">{{ formatCount(item.leads) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="campusRows.length" class="ads-block ads-campus" aria-label="各校">
        <h3>各校（廣告帶來的預約 / 到場 / 預繳）</h3>
        <div class="ads-scroll">
          <table class="ads-table">
            <thead>
              <tr>
                <th scope="col">平台</th>
                <th v-for="key in CAMPUS_ORDER" :key="key" scope="col">{{ campusLabel(key) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="platform in campusPlatforms" :key="platform">
                <th scope="row">{{ platformLabel(platform) }}</th>
                <td v-for="key in CAMPUS_ORDER" :key="key" class="num">{{ campusCellText(campusCell(platform, key)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <AdConversionStatus :active="loadedOnce" />

      <section class="ads-block ads-spend" aria-label="每月花費">
        <div class="ads-spend__head">
          <h3>其他平台花費（每月手填）</h3>
          <el-button size="small" type="primary" plain data-test="ads-add" @click="openAdd">新增</el-button>
        </div>
        <p v-if="!entries.length" class="hint">這段期間還沒有填寫。</p>
        <ul v-else class="ads-spend__list">
          <li v-for="entry in entries" :key="`${entry.month}-${entry.platform}`">
            <span class="num ads-spend__month">{{ entry.month }}</span>
            <span class="ads-spend__platform">{{ platformLabel(entry.platform) }}</span>
            <span class="num ads-spend__amount">{{ formatCount(entry.amount) }}</span>
            <span class="ads-spend__note">{{ entry.note ?? '' }}</span>
            <span class="ads-spend__actions">
              <el-button size="small" text :aria-label="`編輯 ${entry.month} ${platformLabel(entry.platform)}`" @click="openEdit(entry)">編輯</el-button>
              <el-button size="small" text type="danger" data-test="ads-delete" :aria-label="`刪除 ${entry.month} ${platformLabel(entry.platform)}`" @click="remove(entry)">刪除</el-button>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <AdSpendDialog v-model="dialogOpen" :entry="editing" :this-month="thisMonth" @saved="load()" />
  </section>
</template>

<style scoped>
.ads {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.ads-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.ads-scroll {
  overflow-x: auto;
}

.ads-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.ads-table th,
.ads-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.ads-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.ads-table th:first-child {
  text-align: left;
}

.ads-table tbody th {
  font-weight: 600;
}

.ads-note {
  margin: 0;
  line-height: 1.5;
}

.ads-pending {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.ads-block {
  display: grid;
  gap: 8px;
}

.ads-block h3 {
  margin: 0;
  font-size: var(--text-base);
  color: var(--ink);
}

.ads-spend__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ads-spend__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ads-spend__list li {
  display: grid;
  grid-template-columns: 5.5em 9em 7em minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-base);
}

.ads-spend__amount {
  text-align: right;
}

.ads-spend__note {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .ads-spend__list li {
    grid-template-columns: 1fr 1fr;
  }

  .ads-spend__note,
  .ads-spend__actions {
    grid-column: 1 / -1;
  }
}
</style>
