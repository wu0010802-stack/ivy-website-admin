<script setup lang="ts">
import { WEEKDAY_LABELS, monthCells, monthOf, monthTitle, shiftMonth } from '~/utils/visit-month'
import { visitDateLabel } from '~/utils/visit-form'

// 預約日期月曆（2026-10-02 取代 40 多個選項的原生下拉）：只有開放場次的日子可以選，
// 每格寫當天還有幾場。一天一個原生 radio，鍵盤方向鍵、表單驗證與讀螢幕都照原生行為；
// 沒開放的日子只是數字，不進 tab 順序。
const props = defineProps<{
  modelValue: string
  /** 每個開放日期還能選的場次數；沒有出現的日子不能選 */
  counts: Record<string, number>
  invalid?: boolean
  describedby?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [date: string] }>()

const openDates = computed(() => Object.keys(props.counts).sort())
const firstMonth = computed(() => openDates.value[0] ? monthOf(openDates.value[0]) : '')
const lastMonth = computed(() => openDates.value.at(-1) ? monthOf(openDates.value.at(-1)!) : '')
const month = ref(monthOf(props.modelValue || openDates.value[0] || ''))
const cells = computed(() => month.value ? monthCells(month.value) : [])
const canPrev = computed(() => Boolean(month.value) && month.value > firstMonth.value)
const canNext = computed(() => Boolean(month.value) && month.value < lastMonth.value)
const dayNumber = (date: string) => Number(date.slice(8))

// 重新讀場次後月份超出範圍（例如原本看的那個月已經沒有場次）就回到有場次的第一個月；
// 已選的日子在別的月份時跟著翻過去。
watch(openDates, () => {
  if (!month.value || month.value < firstMonth.value || month.value > lastMonth.value) month.value = firstMonth.value
})
watch(() => props.modelValue, (date) => { if (date && monthOf(date) !== month.value) month.value = monthOf(date) })
</script>

<template>
  <fieldset class="visit-date-picker" :aria-describedby="describedby">
    <legend>預約日期<small>必填</small></legend>
    <div class="visit-month-bar">
      <p class="visit-month-title" aria-live="polite">{{ monthTitle(month) }}</p>
      <button type="button" class="visit-month-nav" :disabled="!canPrev" aria-label="上個月" @click="month = shiftMonth(month, -1)"><svg class="icon" aria-hidden="true"><use href="#i-arrow-left" /></svg></button>
      <button type="button" class="visit-month-nav" :disabled="!canNext" aria-label="下個月" @click="month = shiftMonth(month, 1)"><svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></button>
    </div>
    <div class="visit-month-grid">
      <span v-for="weekday in WEEKDAY_LABELS" :key="weekday" class="visit-weekday" aria-hidden="true">{{ weekday }}</span>
      <template v-for="(cell, index) in cells" :key="cell ?? `blank-${index}`">
        <span v-if="!cell" aria-hidden="true" />
        <label v-else-if="counts[cell]" class="visit-day is-open">
          <input
            type="radio" name="visitDate" :value="cell" :checked="modelValue === cell" required
            :aria-label="`${visitDateLabel(cell)}，${counts[cell]} 場可預約`" :aria-invalid="invalid"
            @change="emit('update:modelValue', cell)"
          >
          <span class="visit-day-number">{{ dayNumber(cell) }}</span>
          <small>{{ counts[cell] }} 場</small>
        </label>
        <span v-else class="visit-day" aria-hidden="true"><span class="visit-day-number">{{ dayNumber(cell) }}</span></span>
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
.visit-date-picker {min-width:0;margin:0;padding:0;border:0}
.visit-date-picker legend {padding:0;margin-bottom:6px;font-size:var(--fs-md);font-weight:600;line-height:1.8}
.visit-date-picker legend small {display:inline-block;margin-left:9px;font-size:var(--fs-xs);font-weight:400;color:var(--visit-muted)}
.visit-month-bar {display:flex;align-items:center;gap:4px;margin-bottom:6px}
.visit-month-title {flex:1;margin:0;color:var(--visit-ink);font-size:var(--fs-md);font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.visit-month-nav {display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--visit-ink);cursor:pointer}
.visit-month-nav .icon {width:20px;height:20px}
.visit-month-nav:disabled {color:var(--visit-line);cursor:default}
.visit-month-nav:focus-visible {outline:3px solid var(--leaf);outline-offset:0}
.visit-month-grid {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.visit-weekday {padding-bottom:2px;text-align:center;font-size:var(--fs-xs);line-height:1.8;color:var(--visit-muted)}
.visit-day {position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:54px;border-radius:12px;font-variant-numeric:tabular-nums;color:var(--visit-muted);line-height:1.3}
.visit-day-number {font-size:var(--fs-md)}
.visit-day.is-open {border:1px solid color-mix(in oklch,var(--visit-ink) 32%,var(--visit-surface));background:var(--visit-surface);color:var(--visit-ink);cursor:pointer;transition:background-color .2s,border-color .2s,color .2s}
.visit-day.is-open .visit-day-number {font-weight:600}
.visit-day.is-open small {font-size:var(--fs-xs);color:var(--visit-muted)}
/* 透明 radio 蓋滿整格：點哪裡都是點它本身（不靠 label 轉送），焦點框畫在格子上。 */
.visit-day>input {position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:inherit}
.visit-day.is-open:has(input:checked) {border-color:var(--visit-ink);background:var(--visit-ink);color:var(--visit-bg)}
.visit-day.is-open:has(input:checked) small {color:inherit}
.visit-day.is-open:has(input:focus-visible) {outline:3px solid var(--leaf);outline-offset:2px}
.visit-day.is-open:has(input[aria-invalid=true]) {border-color:var(--error)}
fieldset:disabled .visit-day.is-open {cursor:default}
@media(hover:hover) {
  .visit-day.is-open:hover:not(:has(input:checked)) {border-color:var(--visit-ink)}
  .visit-month-nav:hover:not(:disabled) {background:var(--visit-soft)}
}
@media(max-width:360px) {
  .visit-month-grid {gap:4px}
  .visit-day {min-height:50px;border-radius:10px}
}
@media(forced-colors:active) {
  .visit-day.is-open:has(input:checked) {outline:3px solid Highlight}
}
</style>
