<script setup lang="ts">
import { useContactPhrases } from '../composables/useContactPhrases'

// 聯絡紀錄輸入框上方的常用片語（2026-10-12）：一句一顆按鈕，點一下送出 pick，
// 由輸入框那邊用 usePhraseInsert 接進內容。片語空、讀取失敗或沒有讀取權限時整列不渲染。
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ pick: [phrase: string] }>()
const { phrases } = useContactPhrases()
</script>

<template>
  <div v-if="phrases.length" class="phrase-chips" role="group" aria-label="常用片語">
    <button
      v-for="(phrase, index) in phrases"
      :key="index"
      type="button"
      class="phrase-chips__chip"
      :disabled="disabled"
      @click="emit('pick', phrase)"
    >{{ phrase }}</button>
  </div>
</template>

<style scoped>
.phrase-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  min-width: 0;
  width: 100%;
}

/* 輕量的按鈕：不搶過「新增紀錄」「記下來」這類主要動作。長片語在手機上自己換行，不撐寬版面。 */
.phrase-chips__chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.4;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out);
}

.phrase-chips__chip:hover:not(:disabled) {
  border-color: var(--admin-accent);
  background: var(--el-color-primary-light-9);
  color: var(--admin-accent-hover);
}

.phrase-chips__chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 觸控裝置的點擊區放大到 44px。 */
@media (pointer: coarse) {
  .phrase-chips__chip {
    min-height: 44px;
  }
}
</style>
