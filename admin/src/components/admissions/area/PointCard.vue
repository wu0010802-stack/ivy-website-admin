<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { AreaPoint } from '../../../api/types'
import { pointCampusHeader, pointFootnotes, pointPlace, pointRows, pointSources } from './pointFormat'

// 區域分析右欄的地點卡片（2026-11-20 規格 §5.1）：這一點與頁首選的校區並排。資料文字全由 pointFormat 組好，
// 這裡只畫：讀取中骨架、失敗寫原因加重試、成功畫兩欄表與註腳。關閉叫「清除」（拿掉圖釘）。
const props = defineProps<{ data: AreaPoint | null; loading: boolean; failed: boolean; campusName: string; radiusKm: 1 | 3 | 6 }>()
const emit = defineEmits<{ clear: []; retry: [] }>()

const titleId = `${useId()}-title`
const heading = ref<HTMLElement | null>(null)
function focusTitle() {
  heading.value?.focus()
}
defineExpose({ focusTitle })

const ready = computed(() => (props.loading || props.failed ? null : props.data))
const rows = computed(() => (ready.value ? pointRows(ready.value, props.campusName) : []))
const hasCampus = computed(() => ready.value?.rows.campus != null)
const campusHeader = computed(() => (ready.value ? pointCampusHeader(ready.value, props.campusName) : props.campusName))
const notes = computed(() => (ready.value ? pointFootnotes(ready.value) : []))
</script>

<template>
  <section class="point-card" :aria-labelledby="titleId" @keydown.esc="emit('clear')">
    <header class="point-card__head">
      <div class="point-card__heading">
        <h2 :id="titleId" ref="heading" class="point-card__title" tabindex="-1">這一點 {{ radiusKm }} 公里內</h2>
        <p v-if="ready" class="point-card__place">{{ pointPlace(ready) }}</p>
      </div>
      <el-button size="small" @click="emit('clear')">清除</el-button>
    </header>

    <el-skeleton v-if="loading" :rows="6" animated />
    <p v-else-if="failed || !data" class="point-card__failed">
      <span>讀不到這一點的資料</span>
      <el-button size="small" @click="emit('retry')">重試</el-button>
    </p>
    <template v-else>
      <table class="point-card__table">
        <thead>
          <tr>
            <th scope="col"><span class="point-card__sr">項目</span></th>
            <th scope="col" class="num">這一點</th>
            <th v-if="hasCampus" scope="col" class="num">{{ campusHeader }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.label">
            <th scope="row">{{ row.label }}</th>
            <td class="num">{{ row.point }}</td>
            <td v-if="hasCampus" class="num">{{ row.campus }}</td>
          </tr>
        </tbody>
      </table>
      <p v-for="note in notes" :key="note" class="point-card__note">{{ note }}</p>
      <p v-if="pointSources(data)" class="point-card__sources">{{ pointSources(data) }}</p>
    </template>
  </section>
</template>

<style scoped>
.point-card {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 0 16px 16px;
  min-width: 0;
}

.point-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 0 8px;
  background: var(--surface);
}

.point-card__heading {
  min-width: 0;
}

.point-card__title {
  margin: 0;
  font-size: var(--text-lg);
}

.point-card__title:focus-visible {
  outline-offset: 2px;
}

.point-card__place {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.point-card__failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.point-card__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.point-card__table th,
.point-card__table td {
  padding: 5px 4px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}

.point-card__table thead th {
  color: var(--ink-3);
  font-weight: 600;
  text-align: right;
}

.point-card__table tbody th {
  color: var(--ink-2);
  font-weight: 400;
  text-align: left;
}

.point-card__table td {
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.point-card__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.point-card__note,
.point-card__sources {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-xs);
}
</style>
