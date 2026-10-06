<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import type { AdmissionsRate, BookingOutcomesOut, CampusOutcomeOut } from '../../api/types'
import { BOOKING_MODE_LABELS, campusLabel, cancelReasonLabel } from '../../api/labels'
import {
  PENDING_KINDS, PENDING_KIND_LABELS, getBookingOutcomes, isSmallSample, pendingLink, rangeKey, rateCsv, rateText, type DateRange,
} from '../../api/analytics'
import { barWidth } from '../../admissions/statsFormat'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './csvExport'

// 預約結果（GET /admin/analytics/booking-outcomes，招生分析報告階段 1 第 1、4、5 項）：期間內
// 送出的案件現在各是什麼結果。一次回全部授權校區，換校只換顯示的列、不重抓；換期間才重抓。
// 和「預約流程」（依事件發生日期）口徑不同，說明裡寫明不能互相相除。
// 2026-10-06 起這裡畫兩塊：五校比較表（橫跨整列）與選定校區的預約結果（左欄）；根元素
// display: contents，兩塊直接排進父層的格線，父層決定誰在哪一欄。
const props = defineProps<{ range: DateRange | null; campusKey: string; periodLabel: string; showCompare: boolean; refreshToken?: number }>()

const UNIT = '預約案件數（同一個孩子預約兩校算兩筆，不是家庭數）'

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

const updating = computed(() => loading.value && data.value !== null)
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
    { label: '已取消', value: current.cancelled, note: reasonText(current.cancelled_by_reason) },
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

// 這批案件裡還沒有結果的：還沒到參觀日、參觀時間過了還沒標記。寫成一句，不占統計格。
const pendingNote = computed(() => {
  const current = row.value
  if (!current) return ''
  const parts = [
    current.upcoming ? `還有 ${current.upcoming} 件還沒到參觀日` : '',
    current.awaiting_attendance ? `另有 ${current.awaiting_attendance} 件參觀時間過了還沒標記，標記之後到場率會變` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join('；')}。` : ''
})

// 五校比較表：到場率畫小條（以 100% 為滿），分母少掛「樣本較少」。取消原因不進表，
// 看選定校區的預約結果；待處理兩欄是此刻的數字，不受期間影響。
interface CompareRow {
  key: string
  campus: string
  mode: string
  modeShort: string
  paused: boolean
  cases: number
  completed: number
  no_show: number
  attendance: AdmissionsRate
  cancelled: number
  cancel: AdmissionsRate
  awaiting_now: number
  follow_up_now: number
}

const compareRows = computed<CompareRow[]>(() =>
  (data.value?.campuses ?? []).map((item) => ({
    key: item.campus_key,
    campus: `${campusLabel(item.campus_key)}${item.active ? '' : '（已停用）'}`,
    mode: modeLabel(item.booking_mode),
    // 表格裡只放括號前的短名（「自選場次」），全名放 title；手機的固定欄才不會占掉半個螢幕。
    modeShort: modeLabel(item.booking_mode).split('（')[0]!,
    paused: item.booking_mode !== 'slots',
    cases: item.cases,
    completed: item.completed,
    no_show: item.no_show,
    attendance: item.attendance_rate,
    cancelled: item.cancelled,
    cancel: item.cancel_rate,
    awaiting_now: item.open_now.awaiting_attendance,
    follow_up_now: item.open_now.follow_up_due,
  })),
)

const compareTotal = computed<CompareRow | null>(() => {
  if (!data.value) return null
  const totals = data.value.totals
  const open = data.value.open_now_totals
  return {
    key: 'total', campus: '合計', mode: '', modeShort: '', paused: false, cases: totals.cases, completed: totals.completed, no_show: totals.no_show,
    attendance: totals.attendance_rate, cancelled: totals.cancelled, cancel: totals.cancel_rate,
    awaiting_now: open.awaiting_attendance, follow_up_now: open.follow_up_due,
  }
})

const rateBar = (rate: AdmissionsRate) => barWidth(rate.value ?? 0, 100)

// 匯出五校比較（2026-10-06）：欄名同畫面，「現在」標籤併進欄名；校區格畫面上是「校名＋預約方式」兩行，
// 這裡拆成兩欄；比率沒有分母寫空白（畫面的「—」不進檔案）；最後一列合計。整張表不受查看校區影響，
// 檔名只寫期間（畫面上這批資料的，不是剛換的選擇）。
const COMPARE_CSV_HEADER = [
  '校區', '預約方式', '預約案件', '已到場', '未到場', '到場率', '已取消', '取消率', '待標記到場（現在）', '到期待追蹤（現在）',
]
function exportCompare() {
  const rows = compareTotal.value ? [...compareRows.value, compareTotal.value] : compareRows.value
  saveAnalyticsCsv(
    analyticsCsvName('五校比較', '', loadedLabel.value),
    COMPARE_CSV_HEADER,
    rows.map((item) => [
      item.campus, item.modeShort, item.cases, item.completed, item.no_show, rateCsv(item.attendance),
      item.cancelled, rateCsv(item.cancel), item.awaiting_now, item.follow_up_now,
    ]),
  )
}
</script>

<template>
  <div class="outcomes-section">
    <section
      v-if="showCompare && data"
      class="panel compare"
      :class="{ 'is-updating': updating }"
      :aria-busy="loading"
      aria-labelledby="compare-title"
    >
      <div class="panel__head">
        <h2 id="compare-title">五校比較<span class="panel__sub num">{{ loadedLabel }}</span></h2>
        <div class="compare__tools">
          <span class="hint" role="status">{{ updating ? '更新中…' : '' }}</span>
          <el-button v-if="compareRows.length" size="small" text data-test="analytics-csv-compare" aria-label="把「五校比較」匯出 CSV" @click="exportCompare">匯出 CSV</el-button>
        </div>
      </div>
      <div class="compare__scroll" role="region" tabindex="0" aria-label="五校比較（可左右捲動）">
        <table class="stats-table compare__table">
          <thead>
            <tr>
              <th scope="col" class="compare__sticky">校區</th>
              <th scope="col" class="compare__num">預約案件</th>
              <th scope="col" class="compare__num">已到場</th>
              <th scope="col" class="compare__num">未到場</th>
              <th scope="col" class="compare__num">到場率</th>
              <th scope="col" class="compare__num">已取消</th>
              <th scope="col" class="compare__num">取消率</th>
              <th scope="col" class="compare__num compare__now-head">待標記到場<span class="compare__now-tag">現在</span></th>
              <th scope="col" class="compare__num compare__now-head">到期待追蹤<span class="compare__now-tag">現在</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in compareRows" :key="item.key" :class="{ 'is-paused': item.paused, 'is-current': item.key === campusKey }">
              <th scope="row" class="compare__sticky">
                <span class="compare__campus">{{ item.campus }}</span>
                <span class="compare__mode" :title="item.mode">{{ item.modeShort }}</span>
              </th>
              <td class="compare__num num">{{ item.cases }}</td>
              <td class="compare__num num">{{ item.completed }}</td>
              <td class="compare__num num">{{ item.no_show }}</td>
              <td class="compare__num num compare__rate">
                <template v-if="item.attendance.denominator">
                  <span class="compare__bar" aria-hidden="true"><span class="compare__bar-fill" :style="{ width: rateBar(item.attendance) }" /></span>
                  <span>{{ rateText(item.attendance) }}</span>
                  <span v-if="isSmallSample(item.attendance)" class="compare__small">樣本較少</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="compare__num num">{{ item.cancelled }}</td>
              <td class="compare__num num compare__rate">
                <template v-if="item.cancel.denominator">
                  <span>{{ rateText(item.cancel) }}</span>
                  <span v-if="isSmallSample(item.cancel)" class="compare__small">樣本較少</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="compare__num num">
                <router-link v-if="canOpenCases && item.awaiting_now > 0" :to="pendingLink('awaiting_attendance', item.key)">{{ item.awaiting_now }}</router-link>
                <template v-else>{{ item.awaiting_now }}</template>
              </td>
              <td class="compare__num num">
                <router-link v-if="canOpenCases && item.follow_up_now > 0" :to="pendingLink('follow_up_due', item.key)">{{ item.follow_up_now }}</router-link>
                <template v-else>{{ item.follow_up_now }}</template>
              </td>
            </tr>
            <tr v-if="compareTotal" class="compare__total">
              <th scope="row" class="compare__sticky"><span class="compare__campus">合計</span></th>
              <td class="compare__num num">{{ compareTotal.cases }}</td>
              <td class="compare__num num">{{ compareTotal.completed }}</td>
              <td class="compare__num num">{{ compareTotal.no_show }}</td>
              <td class="compare__num num compare__rate">
                <template v-if="compareTotal.attendance.denominator">
                  <span>{{ rateText(compareTotal.attendance) }}</span>
                  <span v-if="isSmallSample(compareTotal.attendance)" class="compare__small">樣本較少</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="compare__num num">{{ compareTotal.cancelled }}</td>
              <td class="compare__num num compare__rate">
                <template v-if="compareTotal.cancel.denominator">
                  <span>{{ rateText(compareTotal.cancel) }}</span>
                  <span v-if="isSmallSample(compareTotal.cancel)" class="compare__small">樣本較少</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="compare__num num">{{ compareTotal.awaiting_now }}</td>
              <td class="compare__num num">{{ compareTotal.follow_up_now }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="compare__foot">
        <AnalyticsMeta :period="loadedLabel" :unit="UNIT" :as-of="data.as_of" />
        <AnalyticsExplainer>
          <p>數字是預約案件數，同一個孩子預約兩校算兩筆；比率括號內是分子／分母，分母不到 20 時標「樣本較少」。</p>
          <p>「現在」兩欄是此刻待處理的件數，不受期間影響。整張表不受「查看校區」影響，取消原因看選定校區的預約結果。</p>
        </AnalyticsExplainer>
      </div>
    </section>

    <section class="panel outcomes" :class="{ 'is-updating': updating }" :aria-busy="loading" aria-labelledby="outcomes-title">
      <div class="panel__head">
        <h2 id="outcomes-title">預約結果{{ row ? `・${campusLabel(row.campus_key)}校` : '' }}</h2>
        <span class="hint" role="status">{{ updating ? '更新中…' : '' }}</span>
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
                <span v-if="stat.note" class="stat__hint">{{ stat.note }}</span>
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
            <p v-if="pendingNote" class="hint">{{ pendingNote }}</p>

            <div class="outcomes__now">
              <h3 class="outcomes__title">現在待處理<span class="outcomes__title-sub">此刻的狀態，不受期間影響</span></h3>
              <ul class="outcomes__pending">
                <li v-for="kind in PENDING_KINDS" :key="kind">
                  <span>{{ PENDING_KIND_LABELS[kind] }}</span>
                  <router-link v-if="canOpenCases && row.open_now[kind] > 0" class="num" :to="pendingLink(kind, row.campus_key)">{{ row.open_now[kind] }} 件</router-link>
                  <span v-else class="num">{{ row.open_now[kind] }} 件</span>
                </li>
              </ul>
              <p v-if="!canOpenCases" class="hint">你的帳號只能看統計數字，看不到是哪幾筆案件。</p>
            </div>
          </template>
          <AnalyticsMeta :period="loadedLabel" :unit="UNIT" :as-of="data.as_of" />
          <AnalyticsExplainer>
            <p>依送出日期取這段期間的案件，看它們現在的結果。到場率＝已到場 ÷（已到場＋未到場），取消率＝已取消 ÷ 預約案件，分母不到 20 時標「樣本較少」。</p>
            <p>和「預約流程」依事件發生日期計算不同，兩邊的數字不能互相相除。</p>
          </AnalyticsExplainer>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 兩塊直接排進父層格線（AnalyticsView 的 .booking-grid）；本身不占格。 */
.outcomes-section {
  display: contents;
}

.compare {
  grid-column: 1 / -1;
}

.compare.is-updating,
.outcomes.is-updating {
  opacity: 0.6;
}

.panel__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.compare__tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare__scroll {
  overflow-x: auto;
}

.compare__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.compare__table th,
.compare__table td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
  vertical-align: middle;
}

.compare__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.compare__table thead th:first-child,
.compare__table tbody th {
  padding-left: 24px;
}

.compare__table th:last-child,
.compare__table td:last-child {
  padding-right: 24px;
}

.compare__table tbody tr:last-child > * {
  border-bottom: 0;
}

.compare__table .compare__num {
  text-align: right;
}

.compare__sticky {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
}

.compare__table thead .compare__sticky {
  background: var(--surface-2);
}

.compare__campus {
  display: block;
  color: var(--ink);
  font-weight: 600;
}

.compare__mode {
  display: block;
  margin-top: 1px;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--ink-3);
}

/* 暫停預約的校區整列淡一階；正在看的校區只把名字欄換淺色底（DESIGN：不用彩色側條）。 */
.is-paused td {
  color: var(--ink-3);
}

.is-current .compare__sticky {
  background: var(--el-color-primary-light-9);
}

.compare__total th,
.compare__total td {
  background: var(--surface-2);
  font-weight: 600;
}

.compare__rate > * + * {
  margin-left: 6px;
}

/* 「樣本較少」寫在比率下面一行的小字，不用標籤：五校表橫向才塞得下九欄。 */
.compare__small {
  display: block;
  margin: 1px 0 0;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--ink-3);
}

/* 「現在」兩欄的表頭換成兩行，欄寬跟著數字走。 */
.compare__now-head {
  white-space: normal;
  min-width: 6.5em;
  line-height: 1.3;
}

.compare__now-head .compare__now-tag {
  display: block;
  width: fit-content;
  margin: 2px 0 0 auto;
}

.compare__bar {
  display: inline-block;
  width: 56px;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
  vertical-align: middle;
}

.compare__bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

.compare__now-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 16px;
}

.compare__foot {
  display: grid;
  gap: 6px;
  padding: 12px 24px 14px;
  border-top: 1px solid var(--line);
}

.outcomes__body {
  display: grid;
  gap: 14px;
}

.outcomes__body > .hint,
.outcomes__body > .field-help {
  margin: 0;
}

.outcomes__stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.outcomes__rates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.outcomes__rates dt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.outcomes__rates dd {
  margin: 2px 0 0;
}

.outcomes__rates dd.num {
  font-size: var(--text-xl);
  font-weight: 600;
}

.outcomes__now {
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.outcomes__title {
  margin: 0;
  font-size: var(--text-base);
}

.outcomes__title-sub {
  margin-left: 8px;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--ink-3);
}

.outcomes__pending {
  list-style: none;
  margin: 4px 0 0;
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

@media (max-width: 1100px) {
  .outcomes__stats {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
}

@media (max-width: 720px) {
  .compare__table th,
  .compare__table td {
    padding: 8px 10px;
  }

  .compare__table thead th:first-child,
  .compare__table tbody th {
    padding-left: 16px;
  }

  .compare__table th:last-child,
  .compare__table td:last-child {
    padding-right: 16px;
  }

  .compare__bar {
    width: 36px;
  }

  .compare__foot {
    padding: 12px 16px;
  }

  .outcomes__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .outcomes__rates {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
