<script setup lang="ts">
// 每頁頂部：標題（可省略，頂欄已顯示路由標題時只放說明與動作）、
// 一句說明、右側主要動作。
defineProps<{
  title?: string
  lead?: string
}>()
</script>

<template>
  <div class="page-header">
    <div class="page-header__text">
      <h1 v-if="title">{{ title }}</h1>
      <p v-if="lead || $slots.lead" class="page-header__lead">
        <slot name="lead">{{ lead }}</slot>
      </p>
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
</style>
