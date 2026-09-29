<script setup lang="ts">
import { computed } from 'vue'
import { LENGTH_HINTS, lengthHintText, type LengthHintKey } from '../composables/contentHints'

// 欄位下方的建議字數：目前幾字、建議幾字內，超過時說明在官網上會怎樣。
// 只是提醒，不擋存檔（後端上限另外檢查）。
const props = defineProps<{ value: string | null | undefined; rule: LengthHintKey }>()
const hint = computed(() => lengthHintText(props.value, LENGTH_HINTS[props.rule]))
</script>

<template>
  <span class="field-help length-hint" :class="{ 'is-over': hint.over }">{{ hint.text }}</span>
</template>

<style scoped>
.length-hint.is-over { color: var(--brand-gold-ink); }
</style>
