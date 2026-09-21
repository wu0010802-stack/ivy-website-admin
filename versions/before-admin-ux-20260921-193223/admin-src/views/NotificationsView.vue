<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { campusLabel, formatDateTime, notificationKindLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
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

const notifications = ref<NotificationOut[]>([])
const pendingReschedules = ref<RescheduleRequestOut[]>([])
const loading = ref(false)
const onlyUnread = ref(false)
const busyId = ref<string | null>(null)

async function load() {
  if (!campusFilter.value) return
  loading.value = true
  try {
    const [n, r] = await Promise.all([
      api.get<NotificationOut[]>(`/admin/notifications?campus_key=${campusFilter.value}`),
      api.get<RescheduleRequestOut[]>(`/admin/reschedule-requests?campus_key=${campusFilter.value}`),
    ])
    notifications.value = n
    pendingReschedules.value = r
  } catch {
    ElMessage.error('無法讀取通知')
  } finally {
    loading.value = false
  }
}

watch(campusFilter, load, { immediate: true })

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
  busyId.value = n.id
  try {
    await api.post(`/admin/notifications/${n.id}/read`)
    n.read_at = new Date().toISOString()
  } catch {
    ElMessage.error('標記失敗')
  } finally {
    busyId.value = null
  }
}

async function markAllRead() {
  const unread = notifications.value.filter((n) => !n.read_at)
  for (const n of unread) {
    try {
      await api.post(`/admin/notifications/${n.id}/read`)
      n.read_at = new Date().toISOString()
    } catch {
      ElMessage.error('部分通知標記失敗')
      break
    }
  }
}

async function decideReschedule(id: string, action: 'approve' | 'reject') {
  busyId.value = id
  try {
    await api.post(`/admin/reschedule-requests/${id}/${action}`)
    ElMessage.success(action === 'approve' ? '已核准改期' : '已退回改期申請')
    await load()
  } catch {
    ElMessage.error('操作失敗')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長送出需求、確認或取消時的站內通知。Email 寄送另外處理，這裡一定看得到紀錄。" />

    <div class="toolbar">
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" />
      <el-checkbox v-model="onlyUnread">只看未讀（{{ unreadCount }}）</el-checkbox>
      <span class="toolbar__spacer" />
      <el-button text :disabled="unreadCount === 0" @click="markAllRead">全部標記已讀</el-button>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可查看的校區" />

    <template v-else>
      <section v-if="pendingReschedules.length > 0" class="panel reschedule">
        <div class="panel__head"><h2>待核准的改期申請（{{ pendingReschedules.length }}）</h2></div>
        <el-table :data="pendingReschedules">
          <el-table-column label="案件" min-width="200">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <router-link :to="`/visit-requests/${row.visit_request_id}`">查看案件</router-link>
            </template>
          </el-table-column>
          <el-table-column label="申請時間" width="160">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="right">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <span class="cell-actions">
                <el-button size="small" type="primary" :loading="busyId === row.id" @click="decideReschedule(row.id, 'approve')">核准</el-button>
                <el-button size="small" :loading="busyId === row.id" @click="decideReschedule(row.id, 'reject')">退回</el-button>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <div class="panel">
        <el-table
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
              <el-button v-if="!row.read_at" size="small" text :loading="busyId === row.id" @click="markRead(row)">標記已讀</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<style scoped>
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
