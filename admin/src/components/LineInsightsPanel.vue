<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import { searchPeriod } from '../api/googleInsights'
import type { LineFollowerAccountOut, LineInsightsOut } from '../api/types'
import { useRequestSequence } from '../composables/useRequestSequence'
import AnalyticsExplainer from './analytics/AnalyticsExplainer.vue'
import { DEFAULT_ANALYTICS_DAYS, type AnalyticsDays } from './analytics/filters'
import { formatCount } from './analytics/format'

// LINE（2026-11-16）：各官方帳號這段期間多了多少好友，對照官網 LINE 按鈕的點擊數與綁定 LINE 通知的預約數。
// 好友數來自 LINE（隔天才算好），點擊與綁定是官網自己的資料。期間跟著成效統計頁首；只有切到這一類才讀。
const props = withDefaults(defineProps<{ days?: AnalyticsDays; active?: boolean }>(), {
  days: DEFAULT_ANALYTICS_DAYS,
  active: true,
})

const data = ref<LineInsightsOut | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const requests = useRequestSequence()
const period = computed(() => searchPeriod(props.days))
let requestedKey = ''

async function load() {
  const request = requests.begin()
  const { start, end } = period.value
  requestedKey = `${start}|${end}`
  loading.value = true
  failed.value = null
  try {
    const result = await api.get<LineInsightsOut>(`/admin/line-insights?start=${start}&end=${end}`)
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    failed.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取 LINE 的資料，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(
  [() => props.active, period],
  () => {
    if (props.active && requestedKey !== `${period.value.start}|${period.value.end}`) void load()
  },
  { immediate: true },
)

const updating = computed(() => loading.value && data.value !== null)
const campuses = computed(() => data.value?.campuses ?? [])
const totalClicks = computed(() => campuses.value.reduce((sum, row) => sum + row.line_clicks, 0))
const totalLinked = computed(() => campuses.value.reduce((sum, row) => sum + row.linked, 0))
const campusNames = computed(() => Object.fromEntries(campuses.value.filter(row => row.campus_key).map(row => [row.campus_key as string, row.campus_name])))

function day(value: string): string {
  return value.slice(5).replace('-', '/')
}

function accountTitle(account: LineFollowerAccountOut): string {
  const role = account.key === 'main' ? '園方群組推播帳號' : `${campusNames.value[account.key] ?? account.key}官方帳號`
  const name = account.display_name ?? role
  return account.basic_id ? `${name}（${account.basic_id}）` : name
}

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value > 0 ? `+${formatCount(value)}` : formatCount(value)
}
</script>

<template>
  <section class="line-insights" aria-label="LINE" :aria-busy="loading">
    <el-alert v-if="failed" type="error" :closable="false" show-icon :title="failed" class="line-insights__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !data" class="panel">
      <el-skeleton animated :rows="3" class="panel__body" aria-label="正在讀取 LINE 的資料" />
    </div>

    <section v-else-if="data" class="panel" :class="{ 'is-updating': updating }" aria-labelledby="line-insights-title">
      <div class="panel__head"><h2 id="line-insights-title">LINE</h2></div>
      <div class="panel__body line-insights__body">
        <div class="stat-list line-insights__stats" data-test="line-insights-totals">
          <div class="stat">
            <span class="stat__label">官網 LINE 按鈕被點</span>
            <span class="stat__value">{{ formatCount(totalClicks) }}</span>
            <span class="stat__hint">次</span>
          </div>
          <div class="stat">
            <span class="stat__label">預約綁定 LINE 通知</span>
            <span class="stat__value">{{ formatCount(totalLinked) }}</span>
            <span class="stat__hint">筆</span>
          </div>
        </div>

        <p v-if="!data.configured" class="hint" data-test="line-insights-unconfigured">官方帳號的 Messaging API 金鑰尚未設定，看不到好友數。</p>
        <!-- 兩張表在寬螢幕並排（2026-11-20 可讀性）：原本各自拉滿 1,100px，三欄的校區表名稱和數字隔了半個畫面。 -->
        <div class="line-insights__tables" :class="{ 'is-single': !data.configured }">
        <div v-if="data.configured" class="line-insights__scroll" role="region" tabindex="0" aria-label="各官方帳號的好友（可左右捲動）">
          <table class="line-insights__table" data-test="line-insights-accounts">
            <thead>
              <tr>
                <th scope="col">官方帳號</th>
                <th scope="col" class="num">新增好友</th>
                <th scope="col" class="num">封鎖增減</th>
                <th scope="col" class="num">累計加好友</th>
                <th scope="col" class="num">目前封鎖</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="account in data.accounts" :key="account.key">
                <th scope="row">
                  {{ accountTitle(account) }}
                  <span class="hint line-insights__sub">{{ day(account.from_date) }}–{{ day(account.to_date) }}</span>
                </th>
                <template v-if="account.error_status !== null && account.error_status !== undefined">
                  <td colspan="4" class="hint">{{ account.error_status === 401 ? '讀不到：金鑰可能已失效' : '暫時讀不到 LINE 的資料' }}</td>
                </template>
                <template v-else-if="!account.ready">
                  <td colspan="4" class="hint">LINE 還沒算好這兩天的數字，明天再看</td>
                </template>
                <template v-else>
                  <td class="num">{{ signed(account.new_followers) }}</td>
                  <td class="num">{{ signed(account.blocks_change) }}</td>
                  <td class="num">{{ formatCount(account.followers) }}</td>
                  <td class="num">{{ formatCount(account.blocks) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="line-insights__scroll" role="region" tabindex="0" aria-label="各校 LINE 按鈕點擊與綁定（可左右捲動）">
          <table class="line-insights__table line-insights__table--campuses" data-test="line-insights-campuses">
            <thead><tr><th scope="col">校區</th><th scope="col" class="num">LINE 按鈕點擊</th><th scope="col" class="num">綁定 LINE 通知</th></tr></thead>
            <tbody>
              <tr v-for="row in campuses" :key="row.campus_key ?? 'none'">
                <th scope="row">{{ row.campus_name }}</th>
                <td class="num">{{ formatCount(row.line_clicks) }}</td>
                <td class="num">{{ formatCount(row.linked) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>

        <AnalyticsExplainer>
          <p>「新增好友」是這段期間開始前一天到結束日（今天的數字 LINE 隔天才算好）之間，加好友的次數；同一人封鎖後再加回來會算兩次，封鎖不會讓它變少。封鎖的人數另外看「封鎖增減」。</p>
          <p>好友數是整個官方帳號的，包含從 FB、傳單、現場 QR code 加入的；「官網 LINE 按鈕被點」只算官網上的 LINE 連結，兩者放在一起看趨勢就好，不是一對一的因果。</p>
          <p>「預約綁定 LINE 通知」是家長在預約完成頁或修改頁按「用 LINE 接收通知」並完成綁定的預約數。</p>
        </AnalyticsExplainer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.line-insights {
  margin-top: 20px;
}

.line-insights__alert {
  margin-bottom: 16px;
}

.line-insights .panel {
  transition: opacity 180ms var(--ease-out);
}

.line-insights .panel.is-updating {
  opacity: 0.6;
}

.line-insights__body {
  display: grid;
  gap: 16px;
}

.line-insights__body > .hint {
  margin: 0;
}

.line-insights__stats {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.line-insights__scroll {
  overflow-x: auto;
}

/* 官方帳號表（五欄）在左、校區表（三欄）在右；1100px 以下上下排。只有校區表時（金鑰沒設定）不分欄。 */
.line-insights__tables {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px 32px;
  align-items: start;
}

.line-insights__tables.is-single {
  grid-template-columns: minmax(0, 1fr);
}

@media (max-width: 1100px) {
  .line-insights__tables {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 字級、表頭底色、列高和同一頁其他表（來源、Google 搜尋）一致：原本這兩張小一號、表頭沒有底色，
   排在別的表下面看起來像另一套東西。 */
.line-insights__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.line-insights__table th,
.line-insights__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.line-insights__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

.line-insights__table tbody th {
  font-weight: 400;
  color: var(--ink);
  white-space: normal;
  min-width: 12em;
}

.line-insights__table tbody tr {
  transition: background-color 120ms var(--ease-out);
}

.line-insights__table tbody tr:hover {
  background: var(--surface-2);
}

/* 校區表只有三欄，手機放得下：不留官方帳號表那樣的名稱最小寬度，表頭也可以換行。 */
.line-insights__table--campuses tbody th {
  min-width: 0;
}

.line-insights__table--campuses thead th {
  white-space: normal;
}

.line-insights__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.line-insights__sub {
  display: block;
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .line-insights__table th,
  .line-insights__table td {
    padding: 10px 6px;
  }
}
</style>
