<script setup lang="ts">
import { ref, useId } from 'vue'

// 每頁頂部：標題（可省略，頂欄已顯示路由標題時只放說明與動作）、
// 一句說明、右側主要動作。
// more：天天用的頁面說明只留一句，其餘收進「說明」展開（2026-10-05 第九輪）；
// 第一次用的人點開看得到，每天來的人不必每次讀過一段才看到清單。
defineProps<{
  title?: string
  lead?: string
  more?: string
}>()

const moreOpen = ref(false)
const moreId = useId()
</script>

<template>
  <div class="page-header">
    <div class="page-header__text">
      <h1 v-if="title">{{ title }}</h1>
      <p v-if="lead || $slots.lead" class="page-header__lead">
        <slot name="lead">{{ lead }}</slot>
        <button
          v-if="more"
          type="button"
          class="page-header__more-toggle"
          :aria-expanded="moreOpen"
          :aria-controls="moreId"
          @click="moreOpen = !moreOpen"
        >{{ moreOpen ? '收起說明' : '說明' }}</button>
      </p>
      <p v-if="more" v-show="moreOpen" :id="moreId" class="page-header__more">{{ more }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.page-header__text {
  min-width: 0;
}

.page-header__lead {
  color: var(--ink-2);
  max-width: 68ch;
}

.page-header h1 + .page-header__lead {
  margin-top: 4px;
}

/* 「說明」是文字連結的樣子：跟在句尾、有底線，不做成按鈕外框搶過右邊的主要動作。 */
.page-header__more-toggle {
  display: inline;
  margin-left: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--admin-accent-strong);
  font: inherit;
  font-size: var(--text-sm);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.page-header__more {
  max-width: 68ch;
  margin-top: 6px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.page-header__actions {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
  }
  .page-header__actions { width:100%; }
  .page-header__actions :deep(.el-button) { flex:1; margin-left:0; }
}

/* 觸控裝置上「說明」點得到：放大成 44px 高的點擊區，文字位置不變。 */
@media (pointer: coarse) {
  .page-header__more-toggle {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-block: -12px;
  }
}
</style>
