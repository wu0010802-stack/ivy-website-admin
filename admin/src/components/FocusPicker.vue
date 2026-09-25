<script setup lang="ts">
import { computed } from 'vue'
import type { FocusPointPayload } from '../api/types'

/**
 * 在照片上點選裁切焦點（0–100，左上為 0）。官網把這一點當 object-position，
 * 照片裁成不同比例時盡量保留它。也可以用方向鍵（Shift 一次 10）或兩個數字欄
 * 調整；modelValue 為 null 時顯示 fallback（素材預設焦點，沒有就置中）的淡色點。
 * previews 會用同一個焦點示範版位的實際裁切比例。
 */
const props = withDefaults(
  defineProps<{
    src: string
    modelValue: FocusPointPayload | null | undefined
    fallback?: FocusPointPayload | null
    /** 沒設焦點時實際套用的是什麼（顯示在數字欄旁） */
    fallbackLabel?: string
    label?: string
    resetLabel?: string
    previews?: { label: string; ratio: string }[]
    disabled?: boolean
  }>(),
  { fallback: null, fallbackLabel: '', label: '裁切焦點', resetLabel: '改用素材預設焦點', previews: () => [], disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: FocusPointPayload | null] }>()

const shown = computed<FocusPointPayload>(() => props.modelValue ?? props.fallback ?? { x: 50, y: 50 })
const position = computed(() => `${shown.value.x}% ${shown.value.y}%`)

function round(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)))
}

function set(x: number, y: number) {
  if (props.disabled) return
  emit('update:modelValue', { x: round(x), y: round(y) })
}

function pick(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return
  set(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100)
}

const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

function onKey(event: KeyboardEvent) {
  const step = STEPS[event.key]
  if (!step) return
  event.preventDefault()
  const size = event.shiftKey ? 10 : 1
  set(shown.value.x + step[0] * size, shown.value.y + step[1] * size)
}

function setAxis(axis: 'x' | 'y', value: number | undefined) {
  if (value == null || Number.isNaN(value)) return
  set(axis === 'x' ? value : shown.value.x, axis === 'y' ? value : shown.value.y)
}
</script>

<template>
  <div class="focus-picker" :class="{ 'is-disabled': disabled }">
    <div
      class="focus-picker__stage"
      :tabindex="disabled ? -1 : 0"
      role="group"
      :aria-label="`${label}：點照片或用方向鍵移動，目前左右 ${shown.x}%、上下 ${shown.y}%`"
      @click="pick"
      @keydown="onKey"
    >
      <img :src="src" alt="" draggable="false" />
      <span class="focus-picker__pin" :class="{ 'is-default': !modelValue }" :style="{ left: `${shown.x}%`, top: `${shown.y}%` }" />
    </div>
    <div class="focus-picker__row">
      <label class="focus-picker__num">
        <span>左右 %</span>
        <el-input-number :model-value="shown.x" :min="0" :max="100" :step="1" size="small" controls-position="right" :disabled="disabled" @update:model-value="setAxis('x', $event)" />
      </label>
      <label class="focus-picker__num">
        <span>上下 %</span>
        <el-input-number :model-value="shown.y" :min="0" :max="100" :step="1" size="small" controls-position="right" :disabled="disabled" @update:model-value="setAxis('y', $event)" />
      </label>
      <el-button v-if="modelValue && !disabled" text size="small" @click="emit('update:modelValue', null)">{{ resetLabel }}</el-button>
      <span v-else-if="!modelValue" class="field-help">目前用{{ fallbackLabel || (fallback ? '素材預設的焦點' : '照片正中央') }}</span>
    </div>
    <div v-if="previews.length" class="focus-picker__previews" aria-hidden="true">
      <figure v-for="preview in previews" :key="preview.label">
        <img :src="src" alt="" :style="{ aspectRatio: preview.ratio, objectPosition: position }" />
        <figcaption>{{ preview.label }}</figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.focus-picker { display: grid; gap: 8px; max-width: 100%; }
.focus-picker__stage {
  position: relative;
  justify-self: start;
  max-width: min(360px, 100%);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: crosshair;
  line-height: 0;
}
.focus-picker.is-disabled .focus-picker__stage { cursor: default; }
.focus-picker__stage:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.focus-picker__stage img { display: block; max-width: 100%; max-height: 260px; }
.focus-picker__pin {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border: 2px solid var(--on-photo);
  border-radius: 50%;
  background: var(--brand-gold);
  box-shadow: 0 0 0 1px var(--on-photo-shadow-strong), 0 0 6px var(--on-photo-shadow-strong);
  pointer-events: none;
}
.focus-picker__pin.is-default { opacity: 0.55; }
.focus-picker__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.focus-picker__num { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.focus-picker__num .el-input-number { width: 96px; }
.focus-picker__previews { display: flex; flex-wrap: wrap; gap: 10px; }
.focus-picker__previews figure { margin: 0; display: grid; gap: 4px; }
.focus-picker__previews img { display: block; height: 64px; width: auto; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); }
.focus-picker__previews figcaption { font-size: 11px; color: var(--ink-3); }
</style>
