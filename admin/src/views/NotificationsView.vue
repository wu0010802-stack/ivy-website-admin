<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { campusLabel, formatDateTime, notificationKindLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import { usePermissions } from '../composables/usePermissions'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'

interface NotificationOut {
  id: string
  campus_key: string
  kind: string
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
}

interface RescheduleRequestOut {
  id: string
  visit_request_id: string
  requested_slot_id: string
  created_at: string
}

const { visibleCampusKeys, selected: campusFilter } = useCampusScope()
const { can } = usePermissions()
// 標記已處理與核准／退回改期都要能處理案件（booking.handle，含櫃台）；
// 沒有的人只看清單，不顯示一按就被拒絕的按鈕。
const canHandle = computed(() => can('booking.handle'))

const notifications = ref<NotificationOut[]>([])
const pendingReschedules = ref<RescheduleRequestOut[]>([])
const loading = ref(false)
const onlyUnread = ref(false)
const busyId = ref<string | null>(null)
const bulkBusy = ref(false)
const bulkProgress = ref(0)
const bulkTotal = ref(0)
const loadError = ref('')
const operationResult = ref('')
const operationFailed = ref(false)
const operationBusy = computed(() => busyId.value !== null || bulkBusy.value)
let loadVersion = 0
let alive = true

async function load() {
  const version = ++loadVersion
  const campus = campusFilter.value
  notifications.value = []
  pendingReschedules.value = []
  loadError.value = ''
  if (!campus) { loading.value = false; return }
  loading.value = true
  try {
    const [n, r] = await Promise.all([
      api.get<NotificationOut[]>(`/admin/notifications?campus_key=${encodeURIComponent(campus)}`),
      api.get<RescheduleRequestOut[]>(`/admin/reschedule-requests?campus_key=${encodeURIComponent(campus)}`),
    ])
    if (!alive || version !== loadVersion || campus !== campusFilter.value) return
    notifications.value = n
    pendingReschedules.value = r
  } catch {
    if (alive && version === loadVersion) loadError.value = '無法讀取通知與改期申請，請重試。'
  } finally {
    if (alive && version === loadVersion) loading.value = false
  }
}

function changeCampus(value: string) {
  if (!operationBusy.value) campusFilter.value = value
}
watch(campusFilter, () => { operationResult.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { alive = false; loadVersion++ })

const visibleNotifications = computed(() =>
  onlyUnread.value ? notifications.value.filter((n) => !n.read_at) : notifications.value,
)
const unreadCount = computed(() => notifications.value.filter((n) => !n.read_at).length)

function visitRequestId(n: NotificationOut): string | null {
  const id = n.payload?.visit_request_id
  return typeof id === 'string' ? id : null
}

function summary(n: NotificationOut): string {
  const p = n.payload ?? {}
  const parts: string[] = []
  if (typeof p.parent_name === 'string') parts.push(p.parent_name)
  if (typeof p.slot_date === 'string') parts.push(String(p.slot_date))
  return parts.join('・')
}

async function markRead(n: NotificationOut) {
  if (!canHandle.value || operationBusy.value || loading.value || n.read_at || n.campus_key !== campusFilter.value) return
  busyId.value = n.id
  operationResult.value = ''
  const campus = campusFilter.value
  try {
    await api.post(`/admin/notifications/${n.id}/read`)
    if (alive && campus === campusFilter.value) n.read_at = new Date().toISOString()
  } catch {
    if (alive) ElMessage.error('標記失敗，請重試')
  } finally {
    busyId.value = null
  }
}

async function markAllRead() {
  if (!canHandle.value || operationBusy.value || loading.value || loadError.value) return
  const campus = campusFilter.value
  const unread = notifications.value.filter((n) => !n.read_at && n.campus_key === campus)
  if (!unread.length) return
  bulkBusy.value = true
  bulkProgress.value = 0
  bulkTotal.value = unread.length
  operationResult.value = ''
  let failed = 0
  try {
    for (const n of unread) {
      if (!alive || campus !== campusFilter.value) break
      try {
        await api.post(`/admin/notifications/${n.id}/read`)
        if (alive && campus === campusFilter.value) n.read_at = new Date().toISOString()
      } catch { failed++ }
      bulkProgress.value++
    }
    if (alive && campus === campusFilter.value) {
      operationFailed.value = failed > 0
      operationResult.value = failed
        ? `已標記 ${bulkProgress.value - failed} 則，${failed} 則失敗。失敗通知仍保留未讀，可再次操作。`
        : `已將 ${bulkProgress.value} 則通知標記為已讀。`
    }
  } finally { bulkBusy.value = false }
}

async function decideReschedule(id: string, action: 'approve' | 'reject') {
  if (!canHandle.value || operationBusy.value || loading.value) return
  // 核准會直接換掉家長的參觀時間、退回會讓家長維持原時段，兩者都是對外
  // 且不能反悔的動作，比照確認預約先問一次並講清楚後果。
  try {
    await ElMessageBox.confirm(
      action === 'approve'
        ? '核准後案件會改到家長申請的新時段，原時段名額釋出。請另行告知家長已改期。'
        : '退回後家長的參觀時間維持原時段，申請不會再出現在這裡。請另行告知家長。',
      action === 'approve' ? '核准這筆改期？' : '退回這筆改期申請？',
      { confirmButtonText: action === 'approve' ? '核准改期' : '退回申請', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  busyId.value = id
  const campus = campusFilter.value
  try {
    await api.post(`/admin/reschedule-requests/${id}/${action}`)
    if (!alive || campus !== campusFilter.value) return
    ElMessage.success(action === 'approve' ? '已核准改期' : '已退回改期申請')
    await load()
  } catch {
    if (alive) ElMessage.error('操作失敗，請重試')
  } finally { busyId.value = null }
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長送出需求、確認或取消時的站內通知。Email 寄送另外處理，這裡一定看得到紀錄。" />

    <div class="filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect :model-value="campusFilter" :keys="visibleCampusKeys" :disabled="operationBusy" @update:model-value="changeCampus" /></label>
      <el-checkbox v-model="onlyUnread">只看未讀（{{ unreadCount }}）</el-checkbox>
      <span class="toolbar__spacer" />
      <el-button v-if="canHandle" text :disabled="operationBusy || loading || !!loadError || unreadCount === 0" :loading="bulkBusy" @click="markAllRead">{{ bulkBusy ? `標記中 ${bulkProgress} / ${bulkTotal}` : '全部標記已讀' }}</el-button>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可查看的校區" />

    <template v-else>
      <div class="list-summary" aria-live="polite">
        <span>{{ campusLabel(campusFilter) }} · {{ loading ? '讀取中…' : loadError ? '尚未載入' : `${notifications.length} 則通知，${unreadCount} 則未讀` }}</span>
        <el-button :disabled="operationBusy || loading" @click="load">重新整理</el-button>
      </div>
      <el-alert v-if="operationResult" :title="operationResult" :type="operationFailed ? 'warning' : 'success'" show-icon :closable="false" class="inline-error" />
      <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false" class="inline-error">
        <el-button :disabled="operationBusy" @click="load">重新載入</el-button>
      </el-alert>
      <div v-if="loading" class="panel loading-state" role="status">正在讀取通知與改期申請…</div>
      <template v-else-if="!loadError">

      <section v-if="pendingReschedules.length > 0" class="panel reschedule">
        <div class="panel__head"><h2>待核准的改期申請（{{ pendingReschedules.length }}）</h2></div>
        <el-table :data="pendingReschedules" class="data-table">
          <el-table-column label="案件" min-width="200">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <router-link :to="`/visit-requests/${row.visit_request_id}`">查看案件</router-link>
            </template>
          </el-table-column>
          <el-table-column label="申請時間" width="160">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column v-if="canHandle" label="操作" width="160" align="right">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <span class="cell-actions">
                <el-button size="small" type="primary" :loading="busyId === row.id" :disabled="operationBusy" @click="decideReschedule(row.id, 'approve')">核准</el-button>
                <el-button size="small" :loading="busyId === row.id" :disabled="operationBusy" @click="decideReschedule(row.id, 'reject')">退回</el-button>
              </span>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="待核准的改期申請">
          <li v-for="row in pendingReschedules" :key="row.id" class="mobile-record">
            <div class="record-heading"><strong>改期申請</strong><el-tag type="warning">待核准</el-tag></div>
            <dl class="record-meta"><dt>申請時間</dt><dd>{{ formatDateTime(row.created_at) }}</dd></dl>
            <div class="record-actions">
              <router-link :to="`/visit-requests/${row.visit_request_id}`">查看案件</router-link>
              <template v-if="canHandle">
                <el-button type="primary" :loading="busyId === row.id" :disabled="operationBusy" @click="decideReschedule(row.id, 'approve')">核准</el-button>
                <el-button :disabled="operationBusy" @click="decideReschedule(row.id, 'reject')">退回</el-button>
              </template>
            </div>
          </li>
        </ul>
      </section>

      <div class="panel">
        <el-empty v-if="visibleNotifications.length === 0" :description="onlyUnread ? '沒有未讀通知' : '這個校區還沒有通知'">
          <el-button v-if="onlyUnread" @click="onlyUnread = false">查看全部通知</el-button>
        </el-empty>
        <template v-else>
        <el-table
          class="data-table"
          :data="visibleNotifications"
          v-loading="loading"
          :empty-text="onlyUnread ? '沒有未讀通知' : '還沒有任何通知'"
          :row-class-name="({ row }: { row: NotificationOut }) => (row.read_at ? 'is-read' : '')"
        >
          <el-table-column width="24">
            <template #default="{ row }: { row: NotificationOut }">
              <span v-if="!row.read_at" class="dot" aria-label="未讀" />
            </template>
          </el-table-column>
          <el-table-column label="通知" min-width="260">
            <template #default="{ row }: { row: NotificationOut }">
              <strong :class="{ muted: row.read_at }">{{ notificationKindLabel(row.kind) }}</strong>
              <span v-if="summary(row)" class="muted">・{{ summary(row) }}</span>
              <router-link v-if="visitRequestId(row)" :to="`/visit-requests/${visitRequestId(row)}`" class="open-link">查看案件</router-link>
            </template>
          </el-table-column>
          <el-table-column label="校區" width="90">
            <template #default="{ row }: { row: NotificationOut }">{{ campusLabel(row.campus_key) }}</template>
          </el-table-column>
          <el-table-column label="時間" width="160">
            <template #default="{ row }: { row: NotificationOut }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column width="120" align="right">
            <template #default="{ row }: { row: NotificationOut }">
              <el-button v-if="canHandle && !row.read_at" size="small" text :loading="busyId === row.id" :disabled="operationBusy" @click="markRead(row)">標記已讀</el-button>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="通知清單">
          <li v-for="row in visibleNotifications" :key="row.id" class="mobile-record">
            <div class="record-heading"><strong>{{ notificationKindLabel(row.kind) }}</strong><el-tag :type="row.read_at ? 'info' : 'primary'">{{ row.read_at ? '已讀' : '未讀' }}</el-tag></div>
            <p v-if="summary(row)">{{ summary(row) }}</p>
            <dl class="record-meta"><dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd><dt>時間</dt><dd>{{ formatDateTime(row.created_at) }}</dd></dl>
            <div v-if="visitRequestId(row) || (canHandle && !row.read_at)" class="record-actions">
              <router-link v-if="visitRequestId(row)" :to="`/visit-requests/${visitRequestId(row)}`">查看案件</router-link>
              <el-button v-if="canHandle && !row.read_at" :loading="busyId === row.id" :disabled="operationBusy" @click="markRead(row)">標記已讀</el-button>
            </div>
          </li>
        </ul>
        </template>
      </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.loading-state { padding: 32px 20px; color: var(--ink-3); }
.record-actions { align-items: center; }
.record-actions a { margin-right: auto; }
.record-heading strong { overflow-wrap: anywhere; }

.reschedule {
  margin-bottom: 20px;
  border-color: var(--el-color-warning-light-5);
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
}

.open-link {
  margin-left: 10px;
  font-size: 13px;
}

:deep(.el-table__row.is-read) {
  color: var(--ink-3);
}
</style>
