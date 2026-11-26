<script setup lang="ts">
import { computed } from 'vue'
import { IS_APPLE, splitKeys, splitMatches } from '../tips/tips'

// 小技巧的一段字（2026-11-26）：反引號標的按鍵畫成 <kbd>，符合搜尋字的地方標 <mark>。不用 v-html。
const props = defineProps<{
  text: string
  /** 正規化過的搜尋字；沒在搜尋時不給 */
  terms?: readonly string[]
}>()

const parts = computed(() => splitKeys(props.text, IS_APPLE).map(part => ({
  kind: part.kind,
  pieces: splitMatches(part.value, props.terms ?? []),
})))
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <kbd v-if="part.kind === 'key'"><template v-for="(piece, at) in part.pieces" :key="at"><mark v-if="piece.hit">{{ piece.value }}</mark><template v-else>{{ piece.value }}</template></template></kbd>
    <template v-else><template v-for="(piece, at) in part.pieces" :key="at"><mark v-if="piece.hit">{{ piece.value }}</mark><template v-else>{{ piece.value }}</template></template></template>
  </template>
</template>

<style scoped>
kbd {
  display: inline-block;
  min-width: 1.6em;
  margin: 0 2px;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 0.9em;
  font-weight: 500;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
}

/* 搜尋字用操作色的淡底標出來：暖黃在後台是「草稿／待注意」，不拿來標搜尋結果。 */
mark {
  border-radius: 2px;
  background: var(--el-color-primary-light-7);
  color: inherit;
}
</style>
