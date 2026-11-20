<script setup lang="ts">
import { computed } from 'vue'
import { formatCount } from './format'

// 「次數（比例）」寫在同一格時的對齊（2026-11-20 可讀性）：原本整串靠右，括號裡的字有長有短
// （「（47%）」「（樣本太少）」），前面的次數就跟著左右跑，一欄的數字對不成一直線。
// 這裡把括號那一段放進固定寬度的一格：次數的個位數對齊，比例也自己對齊。文字內容不變（仍是「151（47%）」）。
// wide：括號裡可能寫「樣本太少」的欄位用寬一點的格子。note 給空字串時不寫括號、只留格子（同一欄其他列有比例時用）。
const props = defineProps<{ count: number | null | undefined; note: string; wide?: boolean }>()
const text = computed(() => formatCount(props.count))
</script>

<template>
  <span class="count-note" :class="{ 'count-note--wide': wide }"><span class="count-note__count">{{ text }}</span><span class="count-note__note"><template v-if="note">（{{ note }}）</template></span></span>
</template>

<style scoped>
.count-note {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 「（100%）」放得下的寬度；全形括號各占一個字寬。 */
.count-note__note {
  flex: none;
  min-width: 4.9em;
  font-size: var(--text-sm);
  color: var(--ink-3);
  text-align: right;
}

/* 這一欄有的列寫比例、有的列寫「樣本太少」：字數差很多，靠左接在次數後面，才不會「3　　　（2%）」中間空一大段。 */
.count-note--wide .count-note__note {
  min-width: 6.2em;
  text-align: left;
}
</style>
