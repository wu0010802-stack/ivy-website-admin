<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { stopKey, type YearStop } from './childrenHistory'

// 「2–5 歲孩子」模式的年份滑桿（2026-11-16 規格 §5.3）：九月年份舊到新、最後一格是最新月份。
// el-slider 用索引（0…n-1），提示文字寫年份標籤，刻度只標頭尾；▶／❚❚ 每 1 秒前進一格、到最後一格停。
// 拖動、再按一次、格子換了（換校區、半徑重讀）、卸載都停止播放；偏好減少動態時不放播放鈕。
const PLAY_INTERVAL_MS = 1000

const props = defineProps<{
  stops: readonly YearStop[]
  modelValue: YearStop
  labels: Readonly<Record<string, string>>
}>()
const emit = defineEmits<{ 'update:modelValue': [stop: YearStop] }>()

const labelOf = (stop: YearStop): string => props.labels[stopKey(stop)] ?? stopKey(stop)
const index = computed(() => Math.max(0, props.stops.indexOf(props.modelValue)))
const last = computed(() => Math.max(0, props.stops.length - 1))
const marks = computed(() => {
  const result: Record<number, string> = {}
  if (props.stops.length) result[0] = labelOf(props.stops[0]!)
  if (props.stops.length > 1) result[last.value] = labelOf(props.stops[last.value]!)
  return result
})
const formatTooltip = (value: number): string => (props.stops[value] === undefined ? '' : labelOf(props.stops[value]!))

const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false

const playing = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
function stop() {
  if (timer !== null) clearInterval(timer)
  timer = null
  playing.value = false
}
function tick() {
  const next = props.stops[index.value + 1]
  if (next === undefined) {
    stop()
    return
  }
  emit('update:modelValue', next)
  // 這一步就是最後一格：同一刻停（不用再等一秒才發現沒有下一格）。
  if (index.value + 1 >= last.value) stop()
}
function togglePlay() {
  if (playing.value) {
    stop()
    return
  }
  if (props.stops.length < 2) return
  // 已經在最後一格再按播放：從第一格重來。
  if (index.value >= last.value) emit('update:modelValue', props.stops[0]!)
  playing.value = true
  timer = setInterval(tick, PLAY_INTERVAL_MS)
}
function onSlide(value: number | number[]) {
  stop()
  const next = props.stops[Array.isArray(value) ? value[0]! : value]
  if (next !== undefined && next !== props.modelValue) emit('update:modelValue', next)
}
watch(() => props.stops, stop)
onBeforeUnmount(stop)
</script>

<template>
  <div class="children-year">
    <el-button
      v-if="!reducedMotion"
      class="children-year__play"
      size="small"
      circle
      :icon="playing ? VideoPause : VideoPlay"
      :aria-label="playing ? '暫停播放' : '播放'"
      :disabled="stops.length < 2"
      @click="togglePlay"
    />
    <el-slider
      class="children-year__slider"
      :model-value="index"
      :min="0"
      :max="last"
      :step="1"
      :show-tooltip="true"
      :format-tooltip="formatTooltip"
      :marks="marks"
      :disabled="stops.length < 2"
      aria-label="年份"
      @update:model-value="onSlide"
    />
  </div>
</template>

<style scoped>
.children-year {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 320px;
}

.children-year__play {
  flex: none;
}

.children-year__slider {
  flex: 1 1 auto;
  min-width: 160px;
  /* 刻度標籤在軌道下方：留出空間，不壓到下一行。 */
  margin-block-end: 18px;
  --el-slider-main-bg-color: var(--admin-accent);
}

.children-year__slider :deep(.el-slider__marks-text) {
  color: var(--ink-3);
  font-size: var(--text-sm);
}
</style>
