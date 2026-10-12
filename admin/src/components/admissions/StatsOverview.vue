<script setup lang="ts">
import { computed } from 'vue'
import { rocMonth, taipeiToday } from '../../admissions/academic'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsStats } from '../../api/types'
import {
  NO_VALUE, TREND_MARK, alertLevelLabel, barWidth, formatPoints, formatRate, rateLevel, trendLabel, trendOf,
  type StatsColumn, type StatsTarget,
} from '../../admissions/statsFormat'

// 統計「總覽」（園務 RecruitmentOverviewTab 的區塊）：主管決策摘要 → 異常警示、行動入口 →
// 本月漏斗快照、月比變化 → 本範圍合計 → 月度明細表 → 年度統計。官網差異：園務的兩張圖
// （月度量體、轉換率走勢）由月度明細表的長條取代；「全管道彙整」是園務自家官網報名，不做；
// 「本範圍合計」是官網加的，一次列出規格 9.2 的六個計數、唯一幼生與四個比率。
// 比率 null（分母 0）一律寫「—」。
const props = defineProps<{ stats: AdmissionsStats; csvName?: (title: string) => string }>()
const emit = defineEmits<{ navigate: [target: { tab: StatsTarget; filter: Record<string, string | number> }] }>()

type Snapshot = AdmissionsStats['decision_summary']['current_month']
type Target = { target_tab: StatsTarget; target_filter: Record<string, string | number> }

const cards = computed<{ key: string; title: string; snapshot: Snapshot }[]>(() => [
  { key: 'current_month', title: '本月', snapshot: props.stats.decision_summary.current_month },
  { key: 'rolling_30d', title: '近 30 天', snapshot: props.stats.decision_summary.rolling_30d },
  { key: 'rolling_90d', title: '近 90 天', snapshot: props.stats.decision_summary.rolling_90d },
  { key: 'ytd', title: '年度累計', snapshot: props.stats.decision_summary.ytd },
])

// 參考月份就是目前這個月：本月還在進行中，數字之後還會增加。
const monthInProgress = computed(() => props.stats.reference_month === rocMonth(taipeiToday()))
const mom = computed(() => props.stats.month_over_month)
const funnel = computed(() => props.stats.funnel_snapshot)
// 漏斗快照的比率與「本月」卡同源，讀後端已算好的值，避免前端五入與後端差 0.1。
const rates = computed(() => props.stats.decision_summary.current_month)
const badgeTrend = computed(() => trendOf(mom.value.visit_to_deposit_rate.delta))

const kpiItems = computed(() => {
  const kpi = props.stats.kpi
  return [
    { label: '參觀', value: String(kpi.visit), sub: `唯一幼生 ${kpi.unique_visit}` },
    { label: '預繳', value: String(kpi.deposit), sub: `唯一幼生 ${kpi.unique_deposit}` },
    { label: '註冊', value: String(kpi.enrolled), sub: '' },
    { label: '轉其他學期', value: String(kpi.transfer_term), sub: '' },
    { label: '有效預繳', value: String(kpi.effective_deposit), sub: '' },
    { label: '預繳未註冊', value: String(kpi.pending_deposit), sub: '' },
    { label: '參觀→預繳率', value: formatRate(kpi.visit_to_deposit_rate), sub: '' },
    { label: '參觀→註冊率', value: formatRate(kpi.visit_to_enrolled_rate), sub: '' },
    { label: '預繳→註冊率', value: formatRate(kpi.deposit_to_enrolled_rate), sub: '' },
    { label: '排除轉期→註冊率', value: formatRate(kpi.effective_to_enrolled_rate), sub: '' },
  ]
})

// 預繳速度（2026-10-12 規格 §10.1）：參觀後第 N 天的累積預繳率；長條以五個觀察點的最大值為 100%。
const timing = computed(() => props.stats.deposit_timing)
const timingMax = computed(() => Math.max(0, ...timing.value.checkpoints.map((point) => point.cumulative_rate ?? 0)))
const pace = computed(() => props.stats.deposit_pace)
const paceText = computed(() => {
  const value = pace.value
  if (value.evaluable && value.expected !== null) {
    return `依過去的預繳速度，到今天應有約 ${value.expected.toFixed(1)} 筆預繳，實際 ${value.observed} 筆。`
  }
  if (value.reason === 'insufficient_baseline') return `其他月份的預繳還不到 ${timing.value.min_events} 筆，先不比較預繳速度。`
  return ''
})

function go(item: Target) {
  emit('navigate', { tab: item.target_tab, filter: item.target_filter })
}

// 表頭照園務原文（月度明細表沒有「預繳→註冊率」，年度統計沒有「有效預繳」）。
const MONTHLY_COLUMNS: StatsColumn[] = [
  { key: 'month', label: '月份', sticky: true, csv: 'roc-month' },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'enrolled', label: '註冊人數', kind: 'count' },
  { key: 'transfer_term', label: '轉其他學期', kind: 'count' },
  { key: 'effective_deposit', label: '有效預繳', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '參觀→預繳率', kind: 'rate' },
  { key: 'visit_to_enrolled_rate', label: '參觀→註冊率', kind: 'rate' },
  { key: 'effective_to_enrolled_rate', label: '排除轉期→註冊率', kind: 'rate' },
]
const YEARLY_COLUMNS: StatsColumn[] = [
  { key: 'label', label: '年份', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'enrolled', label: '註冊人數', kind: 'count' },
  { key: 'transfer_term', label: '轉其他學期', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '參觀→預繳率', kind: 'rate' },
  { key: 'visit_to_enrolled_rate', label: '參觀→註冊率', kind: 'rate' },
  { key: 'effective_to_enrolled_rate', label: '排除轉期→註冊率', kind: 'rate' },
]
const yearlyRows = computed(() => props.stats.by_year.map((row) => ({ ...row, label: `${row.year}年` })))
</script>

<template>
  <div class="overview">
    <section class="stats-card decision">
      <div class="decision__head">
        <div>
          <h3>主管決策摘要</h3>
          <p class="hint">參考月份：{{ stats.reference_month ?? '尚未指定' }}</p>
        </div>
        <span class="decision__badge" :class="`decision__badge--${badgeTrend}`">{{ badgeTrend === 'none' ? '' : `${TREND_MARK[badgeTrend]} ` }}月比預繳率 {{ formatPoints(mom.visit_to_deposit_rate.delta) }}</span>
      </div>
      <slot name="reference-month" />
      <div class="decision__cards">
        <article v-for="card in cards" :key="card.key" class="decision__card">
          <h4>
            {{ card.title }}
            <el-tag v-if="card.key === 'current_month' && monthInProgress" size="small" type="info" effect="plain" disable-transitions>進行中</el-tag>
          </h4>
          <p class="decision__visit"><strong class="num">{{ card.snapshot.visit }}</strong> 人次</p>
          <dl class="decision__rates">
            <div>
              <dt>預繳率</dt>
              <dd class="num" :class="`rate--${rateLevel(card.snapshot.visit_to_deposit_rate)}`">{{ formatRate(card.snapshot.visit_to_deposit_rate) }}</dd>
            </div>
            <div>
              <dt>註冊率</dt>
              <dd class="num" :class="`rate--${rateLevel(card.snapshot.visit_to_enrolled_rate)}`">{{ formatRate(card.snapshot.visit_to_enrolled_rate) }}</dd>
            </div>
          </dl>
          <p class="decision__foot">預繳 {{ card.snapshot.deposit }} · 註冊 {{ card.snapshot.enrolled }}</p>
        </article>
      </div>
      <p class="hint decision__basis">本月依參觀月份；近 30／90 天依建檔時間；年度累計是參考月份所在民國年，從 1 月累計到該月。</p>
    </section>

    <div class="overview__pair">
      <section class="stats-card">
        <h3>異常警示</h3>
        <ul v-if="stats.alerts.length" class="overview__list">
          <li v-for="alert in stats.alerts" :key="alert.code">
            <button type="button" class="alert-item" @click="go(alert)">
              <el-tag size="small" :type="alert.level" disable-transitions>{{ alertLevelLabel(alert.level) }}</el-tag>
              <strong>{{ alert.title }}</strong>
              <span class="alert-item__message">{{ alert.message }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="overview__empty">目前沒有明顯異常</p>
      </section>
      <section class="stats-card">
        <h3>行動入口</h3>
        <ul v-if="stats.top_action_queue.length" class="overview__list">
          <li v-for="action in stats.top_action_queue" :key="action.code">
            <button type="button" class="action-item" @click="go(action)">
              <strong>{{ action.title }}</strong>
              <span>{{ action.description }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="overview__empty">目前沒有需要優先處理的事項</p>
      </section>
    </div>

    <div class="overview__pair">
      <section class="stats-card snapshot">
        <h3>本月漏斗快照</h3>
        <ol class="snapshot__steps">
          <li class="snapshot__step">
            <span>參觀</span>
            <strong class="num">{{ funnel.visit }}</strong>
          </li>
          <li class="snapshot__rate">
            <span>轉預繳</span>
            <span class="num">{{ formatRate(rates.visit_to_deposit_rate) }}</span>
          </li>
          <li class="snapshot__step">
            <span>預繳</span>
            <strong class="num">{{ funnel.deposit }}</strong>
          </li>
          <li class="snapshot__rate">
            <span>轉註冊</span>
            <span class="num">{{ formatRate(rates.deposit_to_enrolled_rate) }}</span>
          </li>
          <li class="snapshot__step">
            <span>註冊</span>
            <strong class="num">{{ funnel.enrolled }}</strong>
          </li>
        </ol>
        <p class="snapshot__pending" :class="{ 'snapshot__pending--alert': funnel.pending_deposit > 0 }">
          <span>待轉換（預繳未註冊）</span>
          <strong class="num">{{ funnel.pending_deposit }}</strong>
        </p>
      </section>
      <section class="stats-card mom">
        <h3>月比變化</h3>
        <dl class="mom__list">
          <div>
            <dt>參觀→預繳率</dt>
            <dd class="num" :class="`trend--${trendOf(mom.visit_to_deposit_rate.delta)}`">{{ trendLabel(mom.visit_to_deposit_rate.delta) }}</dd>
          </div>
          <div>
            <dt>參觀→註冊率</dt>
            <dd class="num" :class="`trend--${trendOf(mom.visit_to_enrolled_rate.delta)}`">{{ trendLabel(mom.visit_to_enrolled_rate.delta) }}</dd>
          </div>
          <div>
            <dt>有效預繳</dt>
            <dd class="num">{{ mom.effective_deposit.current }}（上月 {{ mom.effective_deposit.previous }}）</dd>
          </div>
          <div>
            <dt>對比月份</dt>
            <dd class="num">{{ mom.current_month ?? NO_VALUE }} / {{ mom.previous_month ?? NO_VALUE }}</dd>
          </div>
        </dl>
        <p v-if="paceText" class="mom__pace" :class="{ 'mom__pace--slow': pace.slow }" data-test="deposit-pace">{{ paceText }}</p>
      </section>
    </div>

    <section class="stats-card pace" data-test="deposit-timing">
      <h3>預繳速度</h3>
      <template v-if="timing.status === 'ok'">
        <p v-if="timing.half_by_day !== null" class="pace__summary">
          到第 90 天會預繳的家長，一半在參觀後 {{ timing.half_by_day }} 天內就預繳了。
        </p>
        <ol class="pace__rows">
          <li v-for="point in timing.checkpoints" :key="point.day" class="pace__row">
            <span class="pace__day">第 {{ point.day }} 天</span>
            <span class="pace__bar" aria-hidden="true">
              <span class="pace__fill" :style="{ width: barWidth(point.cumulative_rate ?? 0, timingMax) }" />
            </span>
            <strong class="num">{{ formatRate(point.cumulative_rate) }}</strong>
            <span class="pace__reached">
              {{ point.cumulative_rate === null ? `還沒有家長參觀滿 ${point.day} 天` : `參觀滿 ${point.day} 天：${point.visits_reached} 位` }}
            </span>
          </li>
        </ol>
        <p class="hint">預繳時間是後台標記預繳的日期，補登的訪視天數會偏長；之後退出的也算預繳過。</p>
      </template>
      <p v-else class="pace__empty">
        預繳過的家長還不到 {{ timing.min_events }} 位（目前 {{ timing.deposited }} 位），先不計算預繳速度。
      </p>
      <p v-if="timing.missing_time > 0" class="hint">另有 {{ timing.missing_time }} 筆已預繳但沒有預繳紀錄時間，不列入。</p>
    </section>

    <section class="stats-card">
      <h3>本範圍合計</h3>
      <dl class="kpi">
        <div v-for="item in kpiItems" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>
            <strong class="num">{{ item.value }}</strong>
            <span v-if="item.sub" class="kpi__sub">{{ item.sub }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <StatsDimensionTable
      title="月度明細表"
      :rows="stats.monthly"
      :columns="MONTHLY_COLUMNS"
      row-key="month"
      empty-text="此區間尚無資料"
      :export-filename="csvName?.('月度明細表')"
    />
    <StatsDimensionTable
      title="年度統計"
      :rows="yearlyRows"
      :columns="YEARLY_COLUMNS"
      row-key="year"
      empty-text="此區間尚無資料"
      :export-filename="csvName?.('年度統計')"
      caption="依參觀月份的民國年加總，不是入學學年。"
    />
    <p class="hint">
      口徑：有效預繳＝預繳且沒有轉其他學期；排除轉期→註冊率＝註冊 ÷ 有效預繳；預繳未註冊＝已預繳、還沒註冊、也沒轉其他學期。近 30／90 天依建檔時間，其餘依參觀月份。分母是 0 的比率寫「—」。
    </p>
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.stats-card {
  min-width: 0;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.stats-card h3 {
  margin-bottom: 12px;
  font-size: var(--text-md);
}

.decision__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 12px;
}

.decision__head h3 {
  margin-bottom: 2px;
}

.decision__badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.decision__badge--up {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.decision__badge--down {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.decision__basis {
  margin: 12px 0 0;
}

.decision__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.decision__card {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.decision__card h4 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.decision__visit {
  margin: 6px 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.decision__visit strong {
  color: var(--ink);
  font-size: var(--text-3xl);
}

.decision__rates,
.mom__list {
  display: grid;
  gap: 4px;
  margin: 0;
}

.decision__rates div,
.mom__list div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.decision__rates dt,
.mom__list dt {
  color: var(--ink-3);
}

.decision__rates dd,
.mom__list dd {
  margin: 0;
  font-weight: 600;
}

.rate--high,
.trend--up {
  color: var(--el-color-success);
}

.rate--mid {
  color: var(--brand-gold-ink);
}

.rate--low,
.trend--down {
  color: var(--el-color-danger);
}

.rate--none,
.trend--none,
.trend--flat {
  color: var(--ink-3);
}

.decision__foot {
  margin-top: 8px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.overview__pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.overview__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.overview__empty {
  color: var(--ink-3);
}

.alert-item,
.action-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.alert-item {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
}

.alert-item__message {
  grid-column: 2;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.action-item span {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.alert-item:hover,
.action-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.snapshot__steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.snapshot__step,
.snapshot__pending {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.snapshot__step strong {
  font-size: var(--text-xl);
}

.snapshot__rate {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-left: 16px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

/* 箭頭只是裝飾，用 CSS 畫，不進文字內容。 */
.snapshot__rate span:first-child::before {
  content: '↓ ';
}

.snapshot__pending {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.snapshot__pending--alert strong {
  color: var(--el-color-warning-dark-2);
}

.kpi {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin: 0;
}

.kpi dt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.kpi dd {
  display: grid;
  margin: 0;
}

.kpi dd strong {
  font-size: var(--text-xl);
}

.kpi__sub {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.mom__pace {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.mom__pace--slow {
  color: var(--el-color-danger);
}

.pace__summary {
  margin: 0 0 10px;
}

.pace__rows {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.pace__row {
  display: grid;
  grid-template-columns: 4.5em minmax(40px, 160px) 4.5em minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.pace__day,
.pace__reached,
.pace__empty {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.pace__row strong {
  text-align: right;
}

.pace__bar {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
}

.pace__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

@media (max-width: 720px) {
  .stats-card {
    padding: 14px 16px;
  }

  .pace__row {
    grid-template-columns: 4.5em minmax(40px, 1fr) 4.5em;
  }

  .pace__reached {
    grid-column: 1 / -1;
  }

  .decision__cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview__pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
