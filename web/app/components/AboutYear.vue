<script setup lang="ts">
// 年份跳字（關於頁「一路走來」，2026-11-11）：四欄數字，每欄一條 0–9 的直條，數字變了就滾到新的那一格。
// 位置寫在 inline style（--d），伺服器輸出就是對的年份；沒有 JS 是靜態數字，減少動態時不滾、直接換。
// 螢幕閱讀器讀 sr-only 的那個數字，滾動的直條不讀。
import { yearDigits } from '~/utils/about-content'

const props = defineProps<{ value: number }>()
const digits = computed(() => yearDigits(props.value))
</script>

<template>
  <span class="aby">
    <span class="sr-only">{{ value }}</span>
    <span class="aby-reel" aria-hidden="true">
      <span v-for="(digit, i) in digits" :key="i" class="aby-col" :style="{ '--d': digit, '--i': i }">
        <span class="aby-strip"><span v-for="n in 10" :key="n">{{ n - 1 }}</span></span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.aby{display:inline-block;font-family:var(--font-head);font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.aby-reel{display:inline-flex}
.aby-col{display:block;height:1em;overflow:hidden}
.aby-strip{display:flex;flex-direction:column;align-items:center;transform:translateY(calc(var(--d) * -10%))}
.aby-strip>span{display:block;height:1em}
@media (prefers-reduced-motion:no-preference){
  .aby-strip{transition:transform 1s cubic-bezier(.16,1,.3,1) calc(var(--i) * 70ms)}
}
</style>
