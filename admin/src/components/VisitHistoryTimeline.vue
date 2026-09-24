<script setup lang="ts">
import { computed } from 'vue'
import type { VisitHistoryOut } from '../api/types'
import { formatDateTime } from '../api/labels'
import { visitEventActor, visitEventChanges, visitEventRelatedId, visitEventTitle } from '../api/visitHistory'

// 案件歷程（規格 L299）：誰、什麼時候、做了什麼、前後差在哪、為什麼。
// 最新的在上面，跟聯絡紀錄同一個方向。
const props = defineProps<{
  events: readonly VisitHistoryOut[]
  staff: readonly { id: string; email: string }[]
}>()

const rows = computed(() =>
  [...props.events].reverse().map((event) => ({
    event,
    title: visitEventTitle(event),
    actor: visitEventActor(event),
    changes: visitEventChanges(event, props.staff),
    related: visitEventRelatedId(event),
  })),
)
</script>

<template>
  <ol v-if="rows.length" class="timeline" aria-label="案件歷程">
    <li v-for="row in rows" :key="row.event.id" class="timeline__item">
      <div class="timeline__head">
        <strong>{{ row.title }}</strong>
        <span v-if="row.actor" class="timeline__actor">{{ row.actor }}</span>
        <time class="timeline__time num">{{ formatDateTime(row.event.created_at) }}</time>
      </div>
      <p v-for="line in row.changes" :key="line" class="timeline__change">{{ line }}</p>
      <p v-if="row.event.reason" class="timeline__reason">原因：{{ row.event.reason }}</p>
      <router-link v-if="row.related" :to="`/visit-requests/${row.related}`" class="timeline__link">查看關聯案件</router-link>
    </li>
  </ol>
  <p v-else class="hint">還沒有歷程紀錄。</p>
</template>

<style scoped>
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}

.timeline__item {
  position: relative;
  padding: 0 0 14px 18px;
  border-left: 1px solid var(--line);
  margin-left: 4px;
}

.timeline__item:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

.timeline__item::before {
  content: '';
  position: absolute;
  top: 6px;
  left: -5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--line-strong);
}

.timeline__item:first-child::before {
  border-color: var(--el-color-primary);
}

.timeline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  font-size: 14px;
}

.timeline__actor {
  color: var(--ink-2);
  font-size: 13px;
}

.timeline__time {
  color: var(--ink-3);
  font-size: 12px;
}

.timeline__change,
.timeline__reason {
  margin: 2px 0 0;
  color: var(--ink-2);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.timeline__reason {
  white-space: pre-wrap;
}

.timeline__link {
  display: inline-block;
  margin-top: 2px;
  font-size: 13px;
}
</style>
