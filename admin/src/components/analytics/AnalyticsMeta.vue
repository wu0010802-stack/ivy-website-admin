<script setup lang="ts">
import { computed } from 'vue'
import { formatShortDateTime } from '../../api/labels'

// 每張圖表都寫期間、計數單位、更新時間與涵蓋範圍（招生分析報告第 4 節第 8 項）。
const props = defineProps<{ period: string; unit: string; asOf?: string | null; coverage?: string }>()

const parts = computed(() =>
  [`期間 ${props.period}`, `單位：${props.unit}`, props.asOf ? `更新 ${formatShortDateTime(props.asOf)}` : '', props.coverage ?? '']
    .filter(Boolean),
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
  font-size: 12px;
  color: var(--ink-3);
}
</style>
