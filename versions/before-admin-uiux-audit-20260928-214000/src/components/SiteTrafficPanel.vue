<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import { RATING_LABELS, VITAL_LABELS, formatVital, trafficPageLabel, type TrafficSummary } from '../api/traffic'
import { useRequestSequence } from '../composables/useRequestSequence'

const days = ref(28)
const summary = ref<TrafficSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<TrafficSummary>(`/admin/analytics/traffic?days=${days.value}`)
    if (requests.isCurrent(request)) summary.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取瀏覽統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(days, load, { immediate: true })

const today = computed(() => summary.value?.daily.at(-1)?.views ?? 0)
const mobileShare = computed(() => {
  const total = summary.value?.total_views ?? 0
  return total ? Math.round(((summary.value?.devices.mobile ?? 0) / total) * 100) : 0
})
const pages = computed(() => {
  const list = summary.value?.pages ?? []
  const max = Math.max(1, ...list.map((p) => p.views))
  return list.map((p) => ({ ...p, label: trafficPageLabel(p), ratio: p.views / max }))
})
const RATING_TAG = { good: 'success', needs_improvement: 'warning', poor: 'danger' } as const
</script>

<template>
  <section class="panel traffic">
    <div class="panel__head">
      <h2>官網瀏覽與速度</h2>
      <el-select v-model="days" size="small" style="width: 120px" aria-label="統計期間">
        <el-option :value="7" label="近 7 天" />
        <el-option :value="28" label="近 28 天" />
        <el-option :value="90" label="近 90 天" />
      </el-select>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="traffic__alert">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !summary" animated :rows="4" class="panel__body" aria-label="正在讀取瀏覽統計" />

    <div v-else-if="summary" class="panel__body traffic__body">
      <p class="hint">
        全站五校合計，不分校區權限。只計算公開頁面，不記錄 IP、cookie 或個人資料；
        訪客開啟「不要追蹤」時不計入。
      </p>

      <div class="stat-list">
        <div class="stat">
          <span class="stat__label">瀏覽次數（{{ summary.since.slice(5).replace('-', '/') }}–{{ summary.until.slice(5).replace('-', '/') }}）</span>
          <span class="stat__value">{{ summary.total_views }}</span>
        </div>
        <div class="stat">
          <span class="stat__label">今天</span>
          <span class="stat__value">{{ today }}</span>
        </div>
        <div class="stat">
          <span class="stat__label">手機瀏覽比例</span>
          <span class="stat__value">{{ summary.total_views ? `${mobileShare}%` : '—' }}</span>
        </div>
      </div>

      <h3 class="traffic__title">各頁瀏覽</h3>
      <p v-if="!pages.length" class="hint">這段期間還沒有瀏覽紀錄。</p>
      <ol v-else class="traffic__pages">
        <li v-for="p in pages" :key="`${p.page}-${p.campus_key}`" class="traffic__row">
          <span class="traffic__label">{{ p.label }}</span>
          <span class="traffic__track" aria-hidden="true"><span class="traffic__bar" :style="{ width: `${p.ratio * 100}%` }" /></span>
          <span class="traffic__value num">{{ p.views }}</span>
        </li>
      </ol>

      <h3 class="traffic__title">網頁速度（實際訪客的第 75 百分位）</h3>
      <p v-if="!summary.vitals.length" class="hint">這段期間還沒有速度資料。</p>
      <el-table v-else :data="summary.vitals" size="small" class="traffic__vitals">
        <el-table-column label="指標" min-width="150">
          <template #default="{ row }">
            <div>{{ VITAL_LABELS[row.metric as keyof typeof VITAL_LABELS].name }}</div>
            <div class="hint">{{ VITAL_LABELS[row.metric as keyof typeof VITAL_LABELS].hint }}</div>
          </template>
        </el-table-column>
        <el-table-column label="裝置" width="80">
          <template #default="{ row }">{{ row.device === 'mobile' ? '手機' : '電腦' }}</template>
        </el-table-column>
        <el-table-column label="p75" width="110" align="right">
          <template #default="{ row }"><span class="num">{{ formatVital(row.metric, row.p75) }}</span></template>
        </el-table-column>
        <el-table-column label="評等" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="RATING_TAG[row.rating as keyof typeof RATING_TAG]">{{ RATING_LABELS[row.rating as keyof typeof RATING_LABELS] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="樣本" width="80" align="right">
          <template #default="{ row }"><span class="num">{{ row.samples }}</span></template>
        </el-table-column>
      </el-table>
    </div>
  </section>
</template>

<style scoped>
.traffic__alert {
  margin: 16px 24px;
  width: auto;
}

.traffic__body {
  display: grid;
  gap: 16px;
}

.traffic__body > .hint {
  margin: 0;
}

.traffic__title {
  margin: 8px 0 0;
  font-size: 14px;
}

.traffic__pages {
  list-style: none;
  margin: 0;
  padding: 0;
}

.traffic__row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.traffic__row + .traffic__row {
  border-top: 1px solid var(--line);
}

.traffic__label {
  color: var(--ink-2);
}

.traffic__track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.traffic__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
  transition: width 300ms var(--ease-out);
}

.traffic__value {
  text-align: right;
  font-weight: 600;
}

@media (max-width: 600px) {
  .traffic__row {
    grid-template-columns: 110px minmax(0, 1fr) 44px;
  }
}
</style>
