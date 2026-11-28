<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../api/client'
import { ageBars, areaBars, genderBars, periodBars, type DemographicBar } from '../api/lineTools'
import type { LineDemographicsAccountOut, LineDemographicsOut } from '../api/types'
import { useRequestSequence } from '../composables/useRequestSequence'

// 好友輪廓（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §6）：和面板原本的好友數表分開載入，
// 失敗只影響這一段。橫條是純 CSS（寬度＝百分比）。
const props = defineProps<{ active?: boolean; accountTitle: (account: LineDemographicsAccountOut) => string }>()

const data = ref<LineDemographicsOut | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const requests = useRequestSequence()
let loaded = false

async function load() {
  const request = requests.begin()
  loading.value = true
  failed.value = null
  try {
    const result = await api.get<LineDemographicsOut>('/admin/line-insights/demographics')
    if (requests.isCurrent(request)) {
      data.value = result
      loaded = true
    }
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    failed.value = detail && typeof detail === 'object' && detail.message ? detail.message : '好友輪廓暫時讀不到，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 資料本來就晚 3 天、後端快取 12 小時：切換期間不重讀，只在第一次顯示時讀。
watch(
  () => props.active,
  active => {
    if (active && !loaded && !loading.value) void load()
  },
  { immediate: true },
)

interface Group {
  key: string
  title: string
  bars: DemographicBar[]
}

function groups(account: LineDemographicsAccountOut): Group[] {
  return [
    { key: 'gender', title: '性別', bars: genderBars(account.genders ?? []) },
    { key: 'age', title: '年齡', bars: ageBars(account.ages ?? []) },
    { key: 'area', title: '地區', bars: areaBars(account.areas ?? []) },
    { key: 'period', title: '加好友多久', bars: periodBars(account.subscription_periods ?? []) },
  ]
}

function percentText(value: number): string {
  return `${Math.round(value * 10) / 10}%`
}

function barWidth(value: number): string {
  return `${Math.max(0, Math.min(100, value))}%`
}

const accounts = computed(() => data.value?.accounts ?? [])
</script>

<template>
  <section class="demo" aria-labelledby="line-demographics-title" :aria-busy="loading" data-test="line-demographics">
    <h3 id="line-demographics-title" class="demo__title">好友輪廓</h3>
    <el-skeleton v-if="loading && !data" animated :rows="3" aria-label="正在讀取好友輪廓" />
    <p v-else-if="failed" class="hint" role="alert" data-test="line-demographics-error">{{ failed }}<el-button size="small" class="demo__retry" @click="load">重新載入</el-button></p>
    <template v-else-if="data">
      <p v-if="!data.configured" class="hint" data-test="line-demographics-unconfigured">官方帳號的 Messaging API 金鑰尚未設定，看不到好友輪廓。</p>
      <div v-for="account in accounts" :key="account.key" class="demo__account" :data-test="`line-demographics-${account.key}`">
        <h4 class="demo__account-name">{{ accountTitle(account) }}</h4>
        <p v-if="account.error_status !== null && account.error_status !== undefined" class="hint" data-test="line-demographics-account-error">
          {{ account.error_status === 401 ? '查詢失敗：金鑰可能已失效' : '查詢失敗，暫時讀不到 LINE 的資料' }}
        </p>
        <p v-else-if="!account.available" class="hint" data-test="line-demographics-unavailable">好友不到 20 位，LINE 不提供輪廓。</p>
        <div v-else class="demo__groups">
          <section v-for="group in groups(account)" :key="group.key" class="demo__group" :data-test="`line-demographics-${account.key}-${group.key}`">
            <h5 class="demo__group-title">{{ group.title }}</h5>
            <p v-if="!group.bars.length" class="hint">沒有資料</p>
            <ul v-else class="demo__bars">
              <li v-for="bar in group.bars" :key="bar.key" class="demo__row" :aria-label="`${bar.label} ${percentText(bar.percentage)}`">
                <span class="demo__label">{{ bar.label }}</span>
                <span class="demo__track" aria-hidden="true"><span class="demo__fill" :style="{ width: barWidth(bar.percentage) }" /></span>
                <span class="demo__value">{{ percentText(bar.percentage) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
      <p class="hint demo__note">LINE 的估計值，約晚 3 天</p>
    </template>
  </section>
</template>

<style scoped>
.demo {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.demo__title {
  margin: 0;
  font-size: var(--text-lg);
}

.demo__retry {
  margin-left: 8px;
}

.demo__account {
  display: grid;
  gap: 8px;
}

.demo__account-name {
  margin: 0;
  font-size: var(--text-base);
  overflow-wrap: anywhere;
}

.demo__groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px 32px;
}

.demo__group-title {
  margin: 0 0 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink-2);
}

.demo__bars {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.demo__row {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1fr) 3.5em;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
}

.demo__label {
  overflow-wrap: anywhere;
}

.demo__track {
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-3);
}

.demo__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

.demo__value {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}

.demo__note {
  margin: 0;
}
</style>
