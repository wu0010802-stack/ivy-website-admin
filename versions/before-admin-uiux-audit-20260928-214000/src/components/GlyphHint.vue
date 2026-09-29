<script setup lang="ts">
import { computed } from 'vue'
import { TITLE_FONT_NAMES, useTitleFontCoverage, type TitleFontSubset } from '../composables/useTitleFontCoverage'

// 標題欄位下方的缺字提示（規格 3.1.1）：官網這個位置用的字型沒有的字會以
// 系統字顯示。一個欄位可能同時出現在兩種字型（例如校名：分校頁大標是明體、
// 聯絡區小標是標題字型），逐個字型列出。只提醒，不擋存檔。
const props = withDefaults(defineProps<{ value: string | null | undefined; fonts?: TitleFontSubset[] }>(), {
  fonts: () => ['bd'],
})

const checkers = props.fonts.map((font) => ({ font, missing: useTitleFontCoverage(font) }))
const problems = computed(() =>
  checkers
    .map(({ font, missing }) => ({ font, chars: missing(props.value ?? '') }))
    .filter((problem) => problem.chars.length > 0),
)
</script>

<template>
  <p v-for="problem in problems" :key="problem.font" class="glyph-hint" role="status">
    {{ TITLE_FONT_NAMES[problem.font] }}沒有「{{ problem.chars.join('') }}」，這幾個字會以系統字顯示。可以換個說法，或請工程補字。
  </p>
</template>

<style scoped>
.glyph-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}
</style>
