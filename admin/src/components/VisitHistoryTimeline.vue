<script setup lang="ts">
import { computed } from 'vue'
import type { RecruitmentEvent, VisitHistoryOut } from '../api/types'
import { formatDateTime, type StaffPerson, staffEmail, staffOf } from '../api/labels'
import { visitEventActor, visitEventChanges, visitEventRelatedId, visitEventTitle } from '../api/visitHistory'
import { eventLabel } from '../admissions/constants'
import { familyHistory, personLabel, recruitmentEventChanges } from '../admissions/family'

// 案件歷程（規格 L299）：誰、什麼時候、做了什麼、前後差在哪、為什麼。
// 最新的在上面，跟聯絡紀錄同一個方向。
// 家庭版面（2026-10-05 家庭頁規格 5.5）另傳招生事件，合併後每列標「預約」或「招生」；沒傳時跟改版前一模一樣。
const props = defineProps<{
  events: readonly VisitHistoryOut[]
  staff: readonly (StaffPerson & { id: string })[]
  recruitmentEvents?: readonly RecruitmentEvent[]
}>()

interface Row {
  key: string
  at: string
  title: string
  actor: string
  actorEmail: string
  changes: string[]
  reason: string | null
  related: string | null
  source: '' | '預約' | '招生'
}

function bookingRow(event: VisitHistoryOut, source: Row['source']): Row {
  return {
    key: event.id,
    at: event.created_at,
    title: visitEventTitle(event),
    actor: visitEventActor(event),
    // 園方人員的名字滑過去看得到完整 Email（同前綴的同事靠這個分辨）。
    actorEmail: event.source === 'staff' ? staffEmail(staffOf(event, 'actor')) : '',
    changes: visitEventChanges(event, props.staff),
    reason: event.reason,
    related: visitEventRelatedId(event),
    source,
  }
}

function admissionsRow(event: RecruitmentEvent): Row {
  return {
    key: `admissions-${event.id}`,
    at: event.created_at,
    title: eventLabel(event.event_type, event.metadata_json),
    actor: personLabel(event.actor_name),
    actorEmail: event.actor_name?.includes('@') ? event.actor_name : '',
    changes: recruitmentEventChanges(event),
    reason: event.reason,
    related: null,
    source: '招生',
  }
}

const rows = computed<Row[]>(() => {
  if (!props.recruitmentEvents) return [...props.events].reverse().map((event) => bookingRow(event, ''))
  return familyHistory(props.events, props.recruitmentEvents).map((row) =>
    row.booking ? bookingRow(row.booking, '預約') : admissionsRow(row.admissions!),
  )
})
</script>

<template>
  <ol v-if="rows.length" class="timeline" aria-label="案件歷程">
    <li v-for="row in rows" :key="row.key" class="timeline__item">
      <div class="timeline__head">
        <strong>{{ row.title }}</strong>
        <span v-if="row.source" class="timeline__source">{{ row.source }}</span>
        <span v-if="row.actor" class="timeline__actor" :title="row.actorEmail || undefined">{{ row.actor }}</span>
        <time class="timeline__time num">{{ formatDateTime(row.at) }}</time>
      </div>
      <p v-for="line in row.changes" :key="line" class="timeline__change">{{ line }}</p>
      <p v-if="row.reason" class="timeline__reason">原因：{{ row.reason }}</p>
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
  font-size: var(--text-base);
}

.timeline__source {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__actor {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.timeline__time {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__change,
.timeline__reason {
  margin: 2px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.timeline__reason {
  white-space: pre-wrap;
}

.timeline__link {
  display: inline-block;
  margin-top: 2px;
  font-size: var(--text-sm);
}
</style>
