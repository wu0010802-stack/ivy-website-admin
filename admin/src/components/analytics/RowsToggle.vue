<script setup lang="ts">
// 長清單先列前幾項，要看全部再展開（2026-11-20 成效統計 UI/UX）。樣子同各表的「這些數字怎麼算」；
// 項目數沒有超過 limit 就不出現。匯出不受影響（呼叫端一律匯出全部）。
defineProps<{ total: number; limit: number }>()
const expanded = defineModel<boolean>({ default: false })
</script>

<template>
  <button v-if="total > limit" type="button" class="rows-toggle" :class="{ 'is-open': expanded }" :aria-expanded="expanded" @click="expanded = !expanded">
    {{ expanded ? `只看前 ${limit} 項` : `顯示全部 ${total} 項` }}
  </button>
</template>

<style scoped>
.rows-toggle {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 6px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--admin-accent-strong);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.rows-toggle::before {
  content: '';
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translate(-1px, -1px);
  transition: transform 150ms var(--ease-out);
}

.rows-toggle.is-open::before {
  transform: rotate(-135deg) translate(-1px, -1px);
}

.rows-toggle:hover {
  text-decoration: underline;
}

.rows-toggle:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (max-width: 720px) {
  .rows-toggle {
    min-height: 44px;
    font-size: var(--text-base);
  }
}
</style>
