<script setup lang="ts">
import { onMounted, ref } from 'vue'

const health = ref<{ status: string; environment: string } | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const response = await fetch('/api/website/v1/health')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    health.value = await response.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})
</script>

<template>
  <main style="font-family: sans-serif; padding: 2rem">
    <h1>常春藤官網後台（開發殼）</h1>
    <p v-if="health">API 健康檢查：{{ health.status }}（{{ health.environment }}）</p>
    <p v-else-if="error">API 連線失敗：{{ error }}（請確認 backend 是否已啟動）</p>
    <p v-else>檢查中…</p>
  </main>
</template>
