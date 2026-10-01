<script setup lang="ts">
import { ref, watch } from 'vue'
import { listEvents } from '../../api/admissions'
import type { RecruitmentEvent } from '../../api/types'
import { formatDateTime } from '../../api/labels'
import { termLabel } from '../../admissions/academic'
import { eventLabel, stageLabel } from '../../admissions/constants'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 參觀→入學歷程（園務 JourneyTimeline／RecruitmentTimelineList）。明細的「歷程」與看板點卡片共用。
// 園務的坑不照抄：座位事件的起訖階段相同（已預繳 → 已預繳），改寫年級與學期；
// 建立訪視沒有起始階段，不寫「— → 已訪視」。
const props = defineProps<{ visitId: string | null; childName?: string }>()
const open = defineModel<boolean>({ required: true })

const events = ref<RecruitmentEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  if (!props.visitId) return
  const request = requests.begin()
  loading.value = true
  error.value = null
  events.value = []
  try {
    const result = await listEvents(props.visitId)
    if (requests.isCurrent(request)) events.value = Array.isArray(result) ? result : []
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取歷程'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 打開時才讀；開著換另一筆（看板連點兩張卡）也重讀，舊的回應不蓋掉新的。
watch([open, () => props.visitId], ([value]) => {
  if (value) void load()
})

function metadataOf(event: RecruitmentEvent): Record<string, unknown> {
  const metadata = event.metadata_json as unknown
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
}

function stageChange(event: RecruitmentEvent): string {
  if (!event.from_stage || !event.to_stage || event.from_stage === event.to_stage) return ''
  return `${stageLabel(event.from_stage)} → ${stageLabel(event.to_stage)}`
}

function seatDetail(event: RecruitmentEvent): string {
  if (event.event_type !== 'seat_reserved' && event.event_type !== 'seat_released') return ''
  const metadata = metadataOf(event)
  const grade = typeof metadata.grade === 'string' ? metadata.grade : ''
  const year = typeof metadata.school_year === 'number' ? metadata.school_year : null
  const semester = typeof metadata.semester === 'number' ? metadata.semester : null
  return [grade, year ? termLabel(year, semester) : ''].filter(Boolean).join('・')
}

// A 階段若在歷程帶了操作者名字（actor_name）才顯示；園務不顯示操作者。
function actorOf(event: RecruitmentEvent): string {
  const name = (event as { actor_name?: unknown }).actor_name
  return typeof name === 'string' ? name : ''
}
</script>

<template>
  <el-drawer v-model="open" title="參觀→入學 歷程" size="min(460px, 100vw)" append-to-body class="events-drawer">
    <p v-if="childName" class="hint events__lead">幼生：{{ childName }}</p>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" :rows="4" animated />
    <p v-else-if="events.length === 0" class="hint">尚無歷程事件</p>
    <ol v-else class="events">
      <li v-for="event in events" :key="event.id" class="events__item">
        <p class="events__meta">
          <time class="num">{{ formatDateTime(event.created_at) }}</time>
          <span v-if="actorOf(event)">・{{ actorOf(event) }}</span>
        </p>
        <p class="events__title">{{ eventLabel(event.event_type, event.metadata_json) }}</p>
        <p v-if="stageChange(event)" class="events__detail">{{ stageChange(event) }}</p>
        <p v-if="seatDetail(event)" class="events__detail">{{ seatDetail(event) }}</p>
        <p v-if="event.reason" class="events__reason">{{ event.reason }}</p>
      </li>
    </ol>
  </el-drawer>
</template>

<style scoped>
.events__lead {
  margin: 0 0 16px;
}

.events {
  margin: 0;
  padding: 0;
  list-style: none;
}

.events__item {
  display: grid;
  gap: 2px;
  padding: 12px 0 12px 14px;
  border-left: 2px solid var(--line);
}

.events__item p {
  margin: 0;
  overflow-wrap: anywhere;
}

.events__meta {
  color: var(--ink-3);
  font-size: 13px;
}

.events__title {
  color: var(--ink);
  font-weight: 600;
}

.events__detail {
  color: var(--ink-2);
  font-size: 13px;
}

.events__reason {
  color: var(--ink-2);
  font-style: italic;
  white-space: pre-wrap;
}
</style>
