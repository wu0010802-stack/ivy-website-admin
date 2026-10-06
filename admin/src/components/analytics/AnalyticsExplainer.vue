<script setup lang="ts">
// 每段統計的算法說明（口徑、排除了什麼、為什麼不能互相相除）收成一行可展開的摘要
// （2026-10-06 成效統計 UI/UX）：天天看數字的人不必每次讀過一段，第一次用的人點開看得到。
withDefaults(defineProps<{ summary?: string }>(), { summary: '這些數字怎麼算' })
</script>

<template>
  <details class="explainer">
    <summary class="explainer__summary">{{ summary }}</summary>
    <div class="explainer__body"><slot /></div>
  </details>
</template>

<style scoped>
.explainer {
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.explainer__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  color: var(--admin-accent-strong);
  cursor: pointer;
  list-style: none;
}

.explainer__summary::-webkit-details-marker {
  display: none;
}

.explainer__summary::before {
  content: '';
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 150ms var(--ease-out);
}

.explainer[open] .explainer__summary::before {
  transform: rotate(45deg);
}

.explainer__summary:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.explainer__body {
  display: grid;
  gap: 6px;
  max-width: 72ch;
  padding: 4px 0 2px;
  line-height: 1.6;
}

.explainer__body :deep(p) {
  margin: 0;
}

@media (max-width: 720px) {
  .explainer {
    font-size: var(--text-base);
  }

  .explainer__summary {
    min-height: 44px;
  }
}
</style>
