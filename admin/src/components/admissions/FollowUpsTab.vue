<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Phone } from '@element-plus/icons-vue'
import { getFollowUps, getRecord, listAdmissionsStaff } from '../../api/admissions'
import type { AdmissionsStaff, FollowUpList, FollowUpRow, RecruitmentVisit } from '../../api/types'
import { rocDate } from '../../admissions/academic'
import { MISSING_CHILD_NAME, stageLabel } from '../../admissions/constants'
import {
  FOLLOW_UP_EMPTY_TEXT,
  FOLLOW_UP_SCOPES,
  FOLLOW_UP_SCOPE_LABELS,
  UNSCHEDULED_HINT,
  followUpText,
  isDue,
  isOpenStage,
  lastContactText,
  ownerLabel,
  type FollowUpScope,
} from '../../admissions/followUp'
import { usePermissions } from '../../composables/usePermissions'
import { useRouter } from 'vue-router'
import { visitRequestPath } from '../../admissions/family'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { useRequestSequence } from '../../composables/useRequestSequence'
import ContactLogDialog, { type ContactTarget } from './ContactLogDialog.vue'
import FollowUpDialog, { type FollowUpTarget } from './FollowUpDialog.vue'
import EventsDrawer from './EventsDrawer.vue'

// 待追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 7.1）：已到期／7 天內／未排定。
// 不吃頁首的入學學年學期（追蹤跟入學學期無關）。分頁標籤的數字是已到期筆數（totals.due）。
const props = defineProps<{ campusKey: string }>()
const scope = defineModel<FollowUpScope>('scope', { required: true })
const owner = defineModel<string>('owner', { required: true })
const emit = defineEmits<{ count: [due: number] }>()

const PAGE_SIZE = 50
const { can } = usePermissions()
const router = useRouter()
const canWrite = computed(() => can('admissions.write'))
const narrow = useNarrowScreen()

const data = ref<FollowUpList | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const page = ref(1)
const staff = ref<AdmissionsStaff[]>([])
const requests = useRequestSequence()
const staffRequests = useRequestSequence()

const rows = computed<FollowUpRow[]>(() => (Array.isArray(data.value?.rows) ? data.value.rows : []))
const total = computed(() => data.value?.total ?? 0)

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) data.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getFollowUps({
      campus_key: props.campusKey,
      scope: scope.value,
      owner: owner.value || null,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (!requests.isCurrent(request)) return
    data.value = result
    emit('count', result.totals?.due ?? 0)
  } catch {
    if (!requests.isCurrent(request)) return
    data.value = null
    error.value = '無法讀取待追蹤清單，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

async function loadStaff() {
  const request = staffRequests.begin()
  try {
    const result = await listAdmissionsStaff(props.campusKey)
    if (staffRequests.isCurrent(request)) staff.value = Array.isArray(result) ? result : []
  } catch {
    if (staffRequests.isCurrent(request)) staff.value = []
  }
}

watch(() => props.campusKey, () => {
  page.value = 1
  void loadStaff()
  void load()
}, { immediate: true })
watch([scope, owner], () => {
  page.value = 1
  void load()
})
watch(page, () => void load({ keep: true }))

function setScope(value: string | number | boolean | undefined) {
  if (typeof value === 'string' && (FOLLOW_UP_SCOPES as readonly string[]).includes(value)) scope.value = value as FollowUpScope
}

const scopeCount = (name: FollowUpScope) => data.value?.totals?.[name]

// ---- 對話框與歷程 ----
const contactOpen = ref(false)
const contactTarget = ref<ContactTarget | null>(null)
const followUpOpen = ref(false)
const followUpTarget = ref<FollowUpTarget | null>(null)
const eventsOpen = ref(false)
const eventsRow = ref<FollowUpRow | null>(null)

function openContact(row: FollowUpRow) {
  contactTarget.value = {
    id: row.visit_id,
    version: row.version,
    child_name: row.child_name,
    stage: row.stage,
    grade: row.grade,
    contact_name: row.contact_name,
    phone: row.phone,
  }
  contactOpen.value = true
}

function openFollowUp(row: FollowUpRow) {
  followUpTarget.value = {
    id: row.visit_id,
    version: row.version,
    child_name: row.child_name,
    stage: row.stage,
    follow_up_at: row.follow_up_at ?? null,
    follow_up_owner_id: row.follow_up_owner_id ?? null,
  }
  followUpOpen.value = true
}

// 有預約、看得到預約的開預約明細（家庭頁規格 6.1）；其他照舊開歷程抽屜。
function openEvents(row: FollowUpRow) {
  const path = visitRequestPath(row.visit_request_id, can)
  if (path) {
    void router.push(path)
    return
  }
  eventsRow.value = row
  eventsOpen.value = true
}

// 記完、改完：重讀清單（這一列可能換範圍）。對話框還開著遇到 409 時，把新版本交回對話框：
// 直接讀這一筆，不靠清單——同事剛改過下次聯絡，這一列常常已經換到別的範圍或別頁，
// 清單裡找不到就一直帶舊版本、一直 409。
async function refreshAfterStale() {
  const current = contactOpen.value ? contactTarget.value : null
  const [, latest] = await Promise.all([
    load({ keep: true }),
    current ? getRecord(current.id).catch(() => null) : null,
  ])
  const target = contactTarget.value
  if (latest && contactOpen.value && target?.id === latest.id) {
    contactTarget.value = { ...target, version: latest.version, stage: latest.stage }
  }
}

function onSaved(_visit?: RecruitmentVisit) {
  void load({ keep: true })
}

const nameOf = (row: FollowUpRow) => row.child_name
const ownerText = (row: FollowUpRow) => ownerLabel(row.follow_up_owner_id, staff.value, row.follow_up_owner_name, row.follow_up_owner_active)
const lastText = (row: FollowUpRow) => lastContactText(row.last_contacted_at, row.last_contact_channel, row.last_contact_reached)
const followUpLabel = (row: FollowUpRow) => (row.follow_up_at ? followUpText(row.follow_up_at) : '未排定')
const followUpDue = (row: FollowUpRow) => isDue(row.follow_up_at)
const scheduleLabel = (row: FollowUpRow) => (row.follow_up_at ? '改期／負責人' : '排下次聯絡')
</script>

<template>
  <div class="follow-ups">
    <div class="toolbar follow-ups__filters">
      <el-radio-group :model-value="scope" aria-label="追蹤範圍" @update:model-value="setScope">
        <el-radio-button v-for="name in FOLLOW_UP_SCOPES" :key="name" :value="name">
          {{ FOLLOW_UP_SCOPE_LABELS[name] }}<span v-if="scopeCount(name) !== undefined" class="num follow-ups__scope-count">{{ scopeCount(name) }}</span>
        </el-radio-button>
      </el-radio-group>
      <div class="filter-field">
        <span>負責人</span>
        <el-select v-model="owner" placeholder="全部" aria-label="負責人" class="follow-ups__owner">
          <el-option value="" label="全部" />
          <el-option value="me" label="我負責的" />
          <el-option value="none" label="未指派" />
          <el-option v-for="person in staff" :key="person.id" :value="person.id" :label="person.display_name || person.email" />
        </el-select>
      </div>
    </div>
    <p v-if="scope === 'unscheduled'" class="hint follow-ups__lead">{{ UNSCHEDULED_HINT }}</p>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="follow-ups__notice">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>

    <div v-else class="panel" :aria-busy="loading">
      <div class="panel__head">
        <h2>{{ FOLLOW_UP_SCOPE_LABELS[scope] }}</h2>
        <span v-if="loading || total" class="hint num">{{ loading ? '載入中…' : `共 ${total} 筆` }}</span>
      </div>

      <template v-if="narrow">
        <div v-if="!loading && !rows.length" class="follow-ups__empty"><strong>{{ FOLLOW_UP_EMPTY_TEXT[scope] }}</strong></div>
        <ul v-else v-loading="loading" class="follow-ups__cards">
          <li v-for="row in rows" :key="row.visit_id" class="follow-card">
            <div class="follow-card__top">
              <strong class="follow-card__name">{{ nameOf(row) }}</strong>
              <el-tag v-if="row.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
              <span v-if="row.follow_up_at" class="num follow-card__when" :class="{ 'is-due': followUpDue(row) }">{{ followUpLabel(row) }}</span>
            </div>
            <p class="follow-card__meta">{{ stageLabel(row.stage) }}・{{ row.grade || '班別未填' }}・參觀 {{ rocDate(row.visit_date) }}</p>
            <p class="follow-card__meta">{{ row.contact_name || '聯絡人未填' }}　最近：{{ lastText(row) }}</p>
            <p class="follow-card__meta">負責人：{{ ownerText(row) }}</p>
            <div class="follow-card__actions">
              <el-button v-if="row.phone" tag="a" :href="`tel:${row.phone}`" :icon="Phone" plain>{{ row.phone }}</el-button>
              <el-button v-if="canWrite" type="primary" plain @click="openContact(row)">記錄聯絡</el-button>
              <el-button v-if="canWrite && isOpenStage(row.stage)" @click="openFollowUp(row)">{{ scheduleLabel(row) }}</el-button>
              <el-button text @click="openEvents(row)">歷程</el-button>
            </div>
          </li>
        </ul>
      </template>

      <el-table v-else v-loading="loading" :data="rows" class="follow-ups-table" :empty-text="loading ? '' : FOLLOW_UP_EMPTY_TEXT[scope]">
        <el-table-column v-if="scope !== 'unscheduled'" label="下次聯絡" width="104">
          <template #default="{ row }: { row: FollowUpRow }">
            <span class="num follow-ups__when" :class="{ 'is-due': followUpDue(row) }">{{ followUpLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="幼生" min-width="100">
          <template #default="{ row }: { row: FollowUpRow }">
            <span class="follow-ups__name">{{ nameOf(row) }}</span>
            <el-tag v-if="row.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
            <span class="hint follow-ups__grade">{{ row.grade || '' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="階段" width="68">
          <template #default="{ row }: { row: FollowUpRow }">{{ stageLabel(row.stage) }}</template>
        </el-table-column>
        <el-table-column label="參觀日期" width="100">
          <template #default="{ row }: { row: FollowUpRow }"><span class="num follow-ups__nowrap">{{ rocDate(row.visit_date) }}</span></template>
        </el-table-column>
        <el-table-column label="聯絡人與電話" min-width="130">
          <template #default="{ row }: { row: FollowUpRow }">
            <span>{{ row.contact_name || '—' }}</span>
            <a v-if="row.phone" :href="`tel:${row.phone}`" class="num follow-ups__phone">{{ row.phone }}</a>
          </template>
        </el-table-column>
        <el-table-column label="最近聯絡" min-width="120">
          <template #default="{ row }: { row: FollowUpRow }">{{ lastText(row) }}</template>
        </el-table-column>
        <el-table-column label="負責人" min-width="80" show-overflow-tooltip>
          <template #default="{ row }: { row: FollowUpRow }">{{ ownerText(row) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }: { row: FollowUpRow }">
            <div class="cell-actions follow-ups__actions">
              <el-button v-if="canWrite" size="small" type="primary" plain @click="openContact(row)">記錄聯絡</el-button>
              <el-button v-if="canWrite && isOpenStage(row.stage)" size="small" text type="primary" @click="openFollowUp(row)">{{ scheduleLabel(row) }}</el-button>
              <el-button size="small" text @click="openEvents(row)">歷程</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="total > PAGE_SIZE" class="follow-ups__pager">
        <el-pagination v-model:current-page="page" :page-size="PAGE_SIZE" :total="total" layout="prev, pager, next" :small="narrow" />
      </div>
    </div>

    <ContactLogDialog v-model="contactOpen" :target="contactTarget" @saved="onSaved" @stale="refreshAfterStale" />
    <FollowUpDialog v-model="followUpOpen" :target="followUpTarget" :campus-key="campusKey" @saved="onSaved" @stale="load({ keep: true })" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsRow?.visit_id ?? null" :child-name="eventsRow?.child_name" @changed="onSaved" />
  </div>
</template>

<style scoped>
.follow-ups__filters {
  flex-wrap: wrap;
  gap: 8px 16px;
}

.follow-ups__scope-count {
  margin-left: 6px;
  opacity: 0.8;
}

.follow-ups__owner {
  width: 160px;
}

.follow-ups__lead {
  margin: 0 0 12px;
}

.follow-ups__notice {
  margin-bottom: 12px;
}

.follow-ups__when.is-due,
.follow-card__when.is-due {
  color: var(--el-color-danger);
  font-weight: 600;
}

.follow-ups__name {
  margin-right: 6px;
  overflow-wrap: anywhere;
}

.follow-ups__when {
  white-space: nowrap;
}

.follow-ups__nowrap {
  white-space: nowrap;
}

.follow-ups__grade {
  display: block;
}

.follow-ups__phone {
  display: block;
  white-space: nowrap;
  margin-top: 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.follow-ups__actions {
  flex-wrap: nowrap;
  white-space: nowrap;
}

.follow-ups__actions .el-button + .el-button {
  margin-left: 0;
}

.follow-ups__pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.follow-ups__empty {
  padding: 24px 16px;
  color: var(--ink-2);
  text-align: center;
}

.follow-ups__cards {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.follow-card {
  display: grid;
  gap: 4px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.follow-card:first-child {
  border-top: 0;
}

.follow-card__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.follow-card__name {
  overflow-wrap: anywhere;
}

.follow-card__when {
  margin-left: auto;
}

.follow-card__meta {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.follow-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.follow-card__actions .el-button + .el-button {
  margin-left: 0;
}
</style>
