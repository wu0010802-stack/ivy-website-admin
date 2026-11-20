<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getStatsHealth, type StatsHealth } from '../../api/analyticsMore'

// 統計健康檢查（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §2）：昨天（GA4 看前天）有沒有「數字應該有、
// 卻沒有」的情況。沒有異常就什麼都不顯示；讀不到也不顯示（這只是提醒，不要讓整頁多一個錯誤框）。
const data = ref<StatsHealth | null>(null)

onMounted(async () => {
  try {
    data.value = await getStatsHealth()
  } catch {
    data.value = null
  }
})
</script>

<template>
  <el-alert
    v-if="data && data.issues.length"
    type="warning"
    :closable="false"
    show-icon
    class="stats-health"
    title="統計可能有狀況"
    data-test="stats-health"
  >
    <ul class="stats-health__list">
      <li v-for="issue in data.issues" :key="issue.key" :data-test="`stats-health-${issue.key}`">{{ issue.message }}</li>
    </ul>
    <p class="stats-health__hint">數字少了不一定是沒人看，也可能是統計沒送進來；請轉給協助維護官網的人確認。總部 LINE 群組可以在「LINE 通知」開「官網統計異常」，每天早上收到提醒。</p>
  </el-alert>
</template>

<style scoped>
.stats-health {
  margin-bottom: 16px;
}

.stats-health__list {
  margin: 4px 0 0;
  padding-left: 1.2em;
}

.stats-health__list li + li {
  margin-top: 4px;
}

.stats-health__hint {
  margin: 8px 0 0;
  font-size: var(--text-xs);
}
</style>
