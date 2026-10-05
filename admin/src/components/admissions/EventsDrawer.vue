<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { getRecord, listAdmissionsStaff, listContactLogs, listEvents } from '../../api/admissions'
import { api } from '../../api/client'
import type { AdmissionsStaff, ContactLog, RecruitmentEvent, RecruitmentVisit, VisitContactNoteOut } from '../../api/types'
import { formatDateTime } from '../../api/labels'
import { termLabel } from '../../admissions/academic'
import { STAGE_LABELS, eventLabel, isStage, moveTargets, stageLabel, type Stage, type TransitionTarget } from '../../admissions/constants'
import { channelLabel, followUpText, isDue, isOpenStage, ownerLabel } from '../../admissions/followUp'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import ContactLogDialog, { type ContactTarget } from './ContactLogDialog.vue'
import FollowUpDialog, { type FollowUpTarget } from './FollowUpDialog.vue'
import TransitionDialog from './TransitionDialog.vue'

// 參觀→入學歷程（園務 JourneyTimeline／RecruitmentTimelineList）。明細的「歷程」、看板點卡片、
// 待追蹤分頁共用。園務的坑不照抄：座位事件的起訖階段相同（已預繳 → 已預繳），改寫年級與學期；
// 建立訪視沒有起始階段，不寫「— → 已訪視」。
// 參觀後追蹤（2026-10-04 規格 7.3）：時間線另合併參觀後的聯絡紀錄，以及參觀前在預約記的
// 聯絡紀錄（有 booking.read 才讀，唯讀、標「參觀前」）；頂部可記錄聯絡、排下次聯絡。
// 摘要列出聯絡人與電話（打電話不用再回明細找），也可以直接「移到…」換階段，同看板的確認框。
const props = defineProps<{ visitId: string | null; childName?: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [visit: RecruitmentVisit] }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))

const record = ref<RecruitmentVisit | null>(null)
const events = ref<RecruitmentEvent[]>([])
const contactLogs = ref<ContactLog[]>([])
const bookingNotes = ref<VisitContactNoteOut[]>([])
const bookingNotesError = ref(false)
const staff = ref<AdmissionsStaff[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

type TimelineItem =
  | { kind: 'event'; key: string; at: string; event: RecruitmentEvent }
  | { kind: 'contact'; key: string; at: string; log: ContactLog }
  | { kind: 'before'; key: string; at: string; note: VisitContactNoteOut }

async function loadBookingNotes(visitRequestId: string | null | undefined, request: number) {
  bookingNotes.value = []
  bookingNotesError.value = false
  if (!visitRequestId || !can('booking.read')) return
  try {
    const notes = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${visitRequestId}/contact-notes`)
    if (requests.isCurrent(request)) bookingNotes.value = Array.isArray(notes) ? notes : []
  } catch {
    // 讀不到參觀前紀錄只在那一段說明，不影響其他內容。
    if (requests.isCurrent(request)) bookingNotesError.value = true
  }
}

async function load() {
  if (!props.visitId) return
  const request = requests.begin()
  loading.value = true
  error.value = null
  events.value = []
  contactLogs.value = []
  try {
    const [visit, eventRows, logRows] = await Promise.all([
      getRecord(props.visitId),
      listEvents(props.visitId),
      listContactLogs(props.visitId),
    ])
    if (!requests.isCurrent(request)) return
    record.value = visit
    events.value = Array.isArray(eventRows) ? eventRows : []
    contactLogs.value = Array.isArray(logRows) ? logRows : []
    await Promise.all([
      loadBookingNotes(visit.visit_request_id, request),
      listAdmissionsStaff(visit.campus_key)
        .then((rows) => { if (requests.isCurrent(request)) staff.value = Array.isArray(rows) ? rows : [] })
        .catch(() => { if (requests.isCurrent(request)) staff.value = [] }),
    ])
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

const timeline = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [
    ...bookingNotes.value.map((note) => ({ kind: 'before' as const, key: `before-${note.id}`, at: note.created_at, note })),
    ...events.value.map((event) => ({ kind: 'event' as const, key: `event-${event.id}`, at: event.created_at, event })),
    ...contactLogs.value.map((log) => ({ kind: 'contact' as const, key: `contact-${log.id}`, at: log.contacted_at, log })),
  ]
  // 舊到新；同一時間時參觀前在前、招生事件次之、聯絡紀錄最後，順序固定。
  const rank = { before: 0, event: 1, contact: 2 }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || rank[a.kind] - rank[b.kind])
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

const bookingNoteAuthor = (note: VisitContactNoteOut) => note.created_by_display_name || note.created_by_email || ''

// ---- 摘要與動作 ----
const editable = computed(() => Boolean(record.value && !record.value.anonymized_at && canWrite.value))
const ownerText = computed(() => ownerLabel(record.value?.follow_up_owner_id, staff.value))
// 已匿名化的電話不是真的號碼，不給撥號。
const phone = computed(() => (record.value && !record.value.anonymized_at ? record.value.phone : null))
const contactOpen = ref(false)
const contactTarget = ref<ContactTarget | null>(null)
const followUpOpen = ref(false)
const followUpTarget = ref<FollowUpTarget | null>(null)

function openContact() {
  const visit = record.value
  if (!visit) return
  contactTarget.value = {
    id: visit.id,
    version: visit.version,
    child_name: visit.child_name,
    stage: visit.stage,
    grade: visit.grade,
    contact_name: visit.contact_name,
    phone: visit.phone,
  }
  contactOpen.value = true
}

function openFollowUp() {
  const visit = record.value
  if (!visit) return
  followUpTarget.value = {
    id: visit.id,
    version: visit.version,
    child_name: visit.child_name,
    stage: visit.stage,
    follow_up_at: visit.follow_up_at ?? null,
    follow_up_owner_id: visit.follow_up_owner_id ?? null,
  }
  followUpOpen.value = true
}

// 換階段：選項同看板卡片的「移到…」（允許而且有權限的目的欄），已匿名化不給。
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)
const moveOptions = computed<Stage[]>(() => {
  const visit = record.value
  return visit && !visit.anonymized_at && isStage(visit.stage) ? moveTargets(visit.stage, can) : []
})

function openTransition(to: Stage) {
  const visit = record.value
  if (!visit || !isStage(visit.stage)) return
  transitionTarget.value = { card: visit, from: visit.stage, to }
  transitionOpen.value = true
}

// 別人剛改過或刪掉（確認框已提示並關閉）：重讀抽屜，也讓父層重讀。
async function onTransitionStale() {
  await load()
  if (record.value) emit('changed', record.value)
}

async function onSaved(visit: RecruitmentVisit) {
  emit('changed', visit)
  await load()
}

// 對話框遇到 409：重讀，並把新版本交回還開著的記錄聯絡對話框（內容保留）。
async function onStale() {
  await load()
  const visit = record.value
  if (contactOpen.value && visit && contactTarget.value) {
    contactTarget.value = { ...contactTarget.value, version: visit.version, stage: visit.stage }
  }
}
</script>

<template>
  <el-drawer v-model="open" title="參觀→入學 歷程" size="min(460px, 100vw)" append-to-body class="events-drawer">
    <p v-if="childName || record" class="hint events__lead">幼生：{{ record?.child_name ?? childName }}</p>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !record" :rows="4" animated />
    <template v-else>
      <dl v-if="record" class="events__summary">
        <div v-if="record.contact_name"><dt>聯絡人</dt><dd>{{ record.contact_name }}</dd></div>
        <div v-if="phone">
          <dt>電話</dt>
          <dd><a :href="`tel:${phone}`" class="num events__tel" :aria-label="`撥打 ${phone}`">{{ phone }}</a></dd>
        </div>
        <div><dt>階段</dt><dd>{{ stageLabel(record.stage) }}</dd></div>
        <div>
          <dt>下次聯絡</dt>
          <dd class="num" :class="{ 'is-due': isDue(record.follow_up_at) }">{{ followUpText(record.follow_up_at) }}</dd>
        </div>
        <div class="events__owner"><dt>負責人</dt><dd :title="ownerText">{{ ownerText }}</dd></div>
      </dl>
      <div v-if="record && (editable || moveOptions.length)" class="events__actions">
        <el-button v-if="editable" type="primary" size="small" @click="openContact">記錄聯絡</el-button>
        <el-button v-if="editable && isOpenStage(record.stage)" size="small" @click="openFollowUp">
          {{ record.follow_up_at ? '改期／負責人' : '排下次聯絡' }}
        </el-button>
        <el-dropdown
          v-if="moveOptions.length"
          trigger="click"
          placement="bottom-start"
          :persistent="false"
          popper-class="events-move-menu"
          @command="openTransition"
        >
          <el-button size="small" class="events__move" aria-label="移到其他階段">
            移到…<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="to in moveOptions" :key="to" :command="to">{{ STAGE_LABELS[to] }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <p v-if="bookingNotesError" class="hint events__notice">參觀前的紀錄讀不到。</p>
      <p v-if="timeline.length === 0" class="hint">尚無歷程事件</p>
      <ol v-else class="events">
        <li v-for="item in timeline" :key="item.key" class="events__item" :class="`events__item--${item.kind}`">
          <template v-if="item.kind === 'event'">
            <p class="events__meta">
              <time class="num">{{ formatDateTime(item.event.created_at) }}</time>
              <span v-if="actorOf(item.event)">・{{ actorOf(item.event) }}</span>
            </p>
            <p class="events__title">{{ eventLabel(item.event.event_type, item.event.metadata_json) }}</p>
            <p v-if="stageChange(item.event)" class="events__detail">{{ stageChange(item.event) }}</p>
            <p v-if="seatDetail(item.event)" class="events__detail">{{ seatDetail(item.event) }}</p>
            <p v-if="item.event.reason" class="events__reason">{{ item.event.reason }}</p>
          </template>
          <template v-else-if="item.kind === 'contact'">
            <p class="events__meta">
              <time class="num">{{ formatDateTime(item.log.contacted_at) }}</time>
              <span v-if="item.log.created_by_name">・{{ item.log.created_by_name }}</span>
            </p>
            <p class="events__title">{{ channelLabel(item.log.channel) }}・{{ item.log.reached ? '聯絡到了' : '沒聯絡到' }}</p>
            <p v-if="item.log.note" class="events__reason">{{ item.log.note }}</p>
            <p v-if="item.log.next_follow_up_at" class="events__detail">排下次聯絡 {{ formatDateTime(item.log.next_follow_up_at) }}</p>
          </template>
          <template v-else>
            <p class="events__meta">
              <el-tag size="small" type="info" effect="plain" round>參觀前</el-tag>
              <time class="num">{{ formatDateTime(item.note.created_at) }}</time>
              <span v-if="bookingNoteAuthor(item.note)">・{{ bookingNoteAuthor(item.note) }}</span>
            </p>
            <p class="events__reason">{{ item.note.note }}</p>
          </template>
        </li>
      </ol>
    </template>

    <ContactLogDialog v-model="contactOpen" :target="contactTarget" @saved="onSaved" @stale="onStale" />
    <FollowUpDialog
      v-if="record"
      v-model="followUpOpen"
      :target="followUpTarget"
      :campus-key="record.campus_key"
      @saved="onSaved"
      @stale="load"
    />
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="onSaved" @stale="onTransitionStale" />
  </el-drawer>
</template>

<style scoped>
.events__lead {
  margin: 0 0 12px;
}

.events__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0 0 12px;
}

.events__summary dt {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.events__summary dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

/* 負責人常是 email：自己一整列、不從中間斷開，真的放不下才截斷（滑鼠指上去看全文）。 */
.events__owner {
  grid-column: 1 / -1;
}

.events__owner dd {
  overflow: hidden;
  overflow-wrap: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.events__tel {
  color: var(--el-color-primary);
}

.events__summary dd.is-due {
  color: var(--el-color-danger);
  font-weight: 600;
}

.events__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.events__actions .el-button + .el-button {
  margin-left: 0;
}

@media (pointer: coarse) {
  .events__actions .el-button {
    min-height: 44px;
  }

  /* 撥號點擊範圍上下各多 12px 到 44px 左右，負邊距抵掉，號碼仍和旁邊的聯絡人對齊。 */
  .events__tel {
    display: inline-block;
    padding-block: 12px;
    margin-block: -12px;
  }
}

.events__notice {
  margin: 0 0 8px;
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

/* 參觀後聯絡用主色線、參觀前用淡色線，和招生事件分得出來。 */
.events__item--contact {
  border-left-color: var(--el-color-primary);
}

.events__item--before {
  border-left-style: dashed;
}

.events__item p {
  margin: 0;
  overflow-wrap: anywhere;
}

.events__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.events__title {
  color: var(--ink);
  font-weight: 600;
}

.events__detail {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.events__reason {
  color: var(--ink-2);
  font-style: italic;
  white-space: pre-wrap;
}
</style>
