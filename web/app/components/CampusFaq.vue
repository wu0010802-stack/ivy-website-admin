<script setup lang="ts">
import type { FaqItem } from '~/types/site-content'

defineProps<{ items: FaqItem[] }>()
</script>

<template>
  <div class="faq-list">
    <details v-for="item in items" :key="item.q">
      <summary>{{ item.q }}</summary>
      <p>{{ item.a }}</p>
    </details>
  </div>
</template>
