<script setup lang="ts">
import { computed, inject } from 'vue'
import { formatShortDateTime } from '../../api/labels'
import { PANE_META } from './metaContext'

// 每張圖表都寫期間、計數單位、更新時間與涵蓋範圍（招生分析報告第 4 節第 8 項）。
const props = defineProps<{ period: string; unit: string; asOf?: string | null; coverage?: string }>()

// 所在的分頁已經在頂端寫了期間與更新時間（metaContext.ts）：這裡只留單位；期間和分頁的不一樣才寫。
const pane = inject(PANE_META, null)
const parts = computed(() =>
  [
    pane && pane.period.value === props.period ? '' : `期間 ${props.period}`,
    `單位：${props.unit}`,
    props.asOf && !pane ? `更新 ${formatShortDateTime(props.asOf)}` : '',
    props.coverage ?? '',
  ].filter(Boolean),
)
</script>

<template>
  <p class="analytics-meta"><span v-for="part in parts" :key="part">{{ part }}</span></p>
</template>

<style scoped>
.analytics-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--ink-3);
}
</style>
