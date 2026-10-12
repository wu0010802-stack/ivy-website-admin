<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { AreaKindergartens } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { KIND_LABELS, KIND_ORDER, RADIUS_OPTIONS, campusNotLocatedReason, formatDistance, kindLabel, shortDay, shortName, type RadiusKm } from './areaFormat'

// 附近幼兒園（2026-10-08 規格 9.4）：本校半徑內的公開園所資料，後端已依距離排序。
// 點一列：地圖移過去並打開該園資訊（select），同時展開這一列的詳情；再點一次只收合，不再請地圖定位。
// 本機構（is_own）只標示，不算競爭園所，也不列入「沒有其他幼兒園」的判斷。
const props = defineProps<{ data: AreaKindergartens | null; failed: boolean; radiusKm: RadiusKm }>()
const emit = defineEmits<{ 'update:radiusKm': [value: RadiusKm]; select: [id: string]; retry: [] }>()

const PAGE = 20
// 教保資訊網沒有單一園所的固定網址，連到查詢頁。
const MOE_SEARCH = 'https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx'
const headingId = useId()
const search = ref('')
const kinds = ref<string[]>([])
const showAll = ref(false)
const expanded = ref<string | null>(null)

// 換校區或半徑（新資料）：收回「顯示更多」與展開。
watch(() => props.data, () => {
  showAll.value = false
  expanded.value = null
})

const items = computed(() => props.data?.items ?? [])
const others = computed(() => items.value.filter((item) => !item.is_own).length)
const filtered = computed(() => {
  const keyword = search.value.trim()
  return items.value.filter((item) => {
    if (kinds.value.length && (item.is_own || !kinds.value.includes(item.kind))) return false
    return !keyword || item.name.includes(keyword) || item.address.includes(keyword)
  })
})
const visible = computed(() => (showAll.value ? filtered.value : filtered.value.slice(0, PAGE)))
const emptyText = computed(() => {
  if (!others.value) return `${props.radiusKm} 公里內沒有其他幼兒園。`
  return filtered.value.length ? '' : '沒有符合條件的幼兒園。'
})
const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法列出附近幼兒園。` : ''
})
// 幼兒園資料從未匯入（後端 synced_at 為 null）：空清單不代表附近沒有園所，寫原因、不顯示假的「沒有其他幼兒園」。
// 校區位置沒標出來的原因優先（上一個分支先攔下）。
const notImported = computed(() => props.data?.synced_at === null)

function toggleKind(kind: string) {
  kinds.value = kinds.value.includes(kind) ? kinds.value.filter((value) => value !== kind) : [...kinds.value, kind]
}
function choose(id: string) {
  const opening = expanded.value !== id
  expanded.value = opening ? id : null
  if (opening) emit('select', id)
}
function setRadius(value: string | number | boolean | undefined) {
  const km = Number(value)
  if (km === 1 || km === 3 || km === 6) emit('update:radiusKm', km)
}
const fee = (value: number | null) => (value === null ? NO_VALUE : `${value.toLocaleString('zh-TW')} 元`)
</script>

<template>
  <section class="nearby" :aria-labelledby="headingId">
    <div class="nearby__head">
      <h3 :id="headingId" class="nearby__title">附近幼兒園</h3>
      <el-radio-group :model-value="radiusKm" size="small" aria-label="搜尋半徑" @update:model-value="setRadius">
        <el-radio-button v-for="km in RADIUS_OPTIONS" :key="km" :value="km">{{ km }} 公里</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近幼兒園。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="notLocated" class="nearby__empty">{{ notLocated }}</p>
    <p v-else-if="notImported" class="nearby__empty">幼兒園名單尚未匯入。</p>
    <template v-else>
      <el-input v-model="search" clearable maxlength="40" placeholder="園名或地址" aria-label="搜尋幼兒園" />
      <div class="nearby__kinds" role="group" aria-label="依類型篩選">
        <button
          v-for="kind in KIND_ORDER"
          :key="kind"
          type="button"
          class="nearby__kind"
          :class="{ 'is-on': kinds.includes(kind) }"
          :aria-pressed="kinds.includes(kind)"
          @click="toggleKind(kind)"
        >
          <span class="nearby__dot" :class="`nearby__dot--${kind}`" aria-hidden="true" />{{ KIND_LABELS[kind] }}
        </button>
      </div>

      <ul v-if="visible.length" class="nearby__list">
        <li v-for="item in visible" :key="item.source_id" class="nearby__item">
          <button type="button" class="nearby__row" :aria-expanded="expanded === item.source_id" @click="choose(item.source_id)">
            <span class="nearby__line">
              <span class="nearby__name">{{ shortName(item.name) }}</span>
              <el-tag v-if="item.is_own" size="small" effect="plain" round>本機構</el-tag>
              <el-tag v-else size="small" type="info" effect="plain" round>{{ kindLabel(item.kind) }}</el-tag>
              <el-tag v-if="item.has_penalty" size="small" type="danger" effect="plain" round>有裁罰紀錄</el-tag>
            </span>
            <span class="nearby__meta num">{{ formatDistance(item.distance_m) }}・核定 {{ item.approved_capacity ?? NO_VALUE }} 人・月費（估）{{ fee(item.monthly_fee_estimate) }}</span>
          </button>
          <dl v-if="expanded === item.source_id" class="nearby__detail">
            <div><dt>地址</dt><dd>{{ item.address }}</dd></div>
            <div v-if="item.phone"><dt>電話</dt><dd>{{ item.phone }}</dd></div>
            <div v-if="item.pre_public_period"><dt>準公共</dt><dd>{{ item.pre_public_period }} 學年</dd></div>
            <div><dt>官方資料</dt><dd><a :href="MOE_SEARCH" target="_blank" rel="noopener noreferrer">全國教保資訊網查詢 ↗</a></dd></div>
          </dl>
        </li>
      </ul>
      <p v-if="emptyText" class="nearby__empty">{{ emptyText }}</p>
      <el-button v-if="!showAll && filtered.length > PAGE" text @click="showAll = true">顯示更多（還有 {{ filtered.length - PAGE }} 所）</el-button>
      <p class="hint nearby__source">{{ data.source_note }}・{{ shortDay(data.synced_at) }} 更新</p>
    </template>
  </section>
</template>

<style scoped>
.nearby {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.nearby__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nearby__title {
  margin: 0;
  font-size: var(--text-md);
}

.nearby__kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nearby__kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.nearby__kind.is-on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--ink);
}

.nearby__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.nearby__dot--public { background: var(--area-kind-public); }
.nearby__dot--nonprofit { background: var(--area-kind-nonprofit); }
.nearby__dot--quasi_public { background: var(--area-kind-quasi-public); }
.nearby__dot--private { background: var(--area-kind-private); }

.nearby__list {
  display: grid;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.nearby__item + .nearby__item {
  border-top: 1px solid var(--line);
}

.nearby__row {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nearby__row:focus-visible {
  outline-offset: -2px;
}

.nearby__row:hover,
.nearby__row[aria-expanded='true'] {
  background: var(--surface-2);
}

.nearby__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.nearby__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.nearby__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.nearby__detail {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
}

.nearby__detail div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}

.nearby__detail dt {
  color: var(--ink-3);
}

.nearby__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.nearby__detail a {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.nearby__empty {
  margin: 0;
  color: var(--ink-2);
}

.nearby__source {
  margin: 0;
}

@media (min-width: 1200px) {
  .nearby__list {
    max-height: 420px;
  }
}
</style>
