<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { campusLabel, formatDateTime, formatSlotWhen, notificationLabel, outboxErrorLabel } from '../api/labels'
import type { NotificationOutboxOut, NotificationOutboxPageOut, NotificationRetryBatchOut, RescheduleRequestOut } from '../api/types'
import { useCampusScope } from '../composables/useCampusScope'
import { usePermissions } from '../composables/usePermissions'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from '../composables/rescheduleDecision'
import { useOpenRequestsStore } from '../stores/openRequests'
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

// 管多校的人預設看「全部校區」（''），和下面寄送失敗、改期申請的範圍一致，不必
// 切五次才看完；只管一校的人直接是那一校。
const { visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
watch(visibleCampusKeys, (keys) => {
  if (keys.length === 1) campusFilter.value = keys[0]!
  else if (campusFilter.value && !keys.includes(campusFilter.value)) campusFilter.value = ''
}, { immediate: true })
// 後端一次最多回最新的 100 則（notifications/routes.py）。
const NOTIFICATION_LIMIT = 100
const { can } = usePermissions()
// 核准／退回改期與重新寄送要能處理案件（booking.handle，含櫃台）；沒有的人
// 只看清單，不顯示一按就被拒絕的按鈕。
const canHandle = computed(() => can('booking.handle'))
// 標記已讀改的是全校共用的處理狀態（有人標了，同校其他人就看不到未讀），
// 2026-09-25 裁定沒有開放給櫃台，業主確認前限 booking.manage。
const canMarkRead = computed(() => can('booking.manage'))
const openRequests = useOpenRequestsStore()

const notifications = ref<NotificationOut[]>([])
// 畫面上的清單是哪個篩選讀回來的（全部校區是 ''）：標記已讀時比對這個快照，
// 切換篩選途中不會寫回舊清單。
const loadedFilter = ref<string | null>(null)
const loading = ref(false)
const onlyUnread = ref(false)
const busyId = ref<string | null>(null)
const bulkBusy = ref(false)
const bulkProgress = ref(0)
const bulkTotal = ref(0)
const loadError = ref('')
const operationResult = ref('')
const operationFailed = ref(false)
const retryAllBusy = ref(false)
const operationBusy = computed(() => busyId.value !== null || bulkBusy.value || retryAllBusy.value)
let loadVersion = 0
let alive = true

// 寄送失敗（自動重試到上限仍失敗）的通知。列出你負責的所有校區，不跟著上面
// 的校區切換——總覽的失敗數是全部校區加總，點進來要看得到同一批。另外載入，
// 讀不到也不影響下面的通知清單。清單只給最新的 200 則，failedTotal 是全部的
// 則數（和總覽同一個數字）；超過時提示重新寄送後再按一次。
const failedOutbox = ref<NotificationOutboxOut[]>([])
const failedTotal = ref(0)
const failedHidden = computed(() => Math.max(failedTotal.value - failedOutbox.value.length, 0))
const failedError = ref('')
let failedVersion = 0

async function loadFailed() {
  const version = ++failedVersion
  failedError.value = ''
  if (!can('booking.read')) { failedOutbox.value = []; failedTotal.value = 0; return }
  try {
    const page = await api.get<NotificationOutboxPageOut>('/admin/notification-outbox')
    if (alive && version === failedVersion) {
      // 部署交替的短暫期間可能拿到舊版 API 的陣列格式：當成沒有資料，不讓整頁壞掉。
      failedOutbox.value = Array.isArray(page.items) ? page.items : []
      failedTotal.value = typeof page.total === 'number' ? page.total : failedOutbox.value.length
    }
  } catch {
    if (alive && version === failedVersion) failedError.value = '無法讀取寄送失敗的通知，請重新整理。'
  }
}
void loadFailed()

// 待核准的改期申請同樣列出你負責的所有校區，不跟著上面的校區切換：側欄徽章
// 與總覽「核准改期申請」算的是全部校區，點進來要看得到同一批，不能落在
// 預設第一校的空清單。
const pendingReschedules = ref<RescheduleRequestOut[]>([])
const rescheduleError = ref('')
let rescheduleVersion = 0

async function loadReschedules() {
  const version = ++rescheduleVersion
  rescheduleError.value = ''
  if (!can('booking.read')) { pendingReschedules.value = []; return }
  try {
    const rows = await api.get<RescheduleRequestOut[]>('/admin/reschedule-requests')
    if (alive && version === rescheduleVersion) pendingReschedules.value = rows
  } catch {
    if (alive && version === rescheduleVersion) rescheduleError.value = '無法讀取待核准的改期申請，請重新整理。'
  }
}
void loadReschedules()

function refreshAll() {
  void load()
  void loadFailed()
  void loadReschedules()
}

async function load() {
  const version = ++loadVersion
  const campus = campusFilter.value
  notifications.value = []
  loadedFilter.value = null
  loadError.value = ''
  if (visibleCampusKeys.value.length === 0) { loading.value = false; return }
  loading.value = true
  try {
    // 不帶校區＝你負責的全部校區（後端依權限範圍過濾）。
    const n = await api.get<NotificationOut[]>(campus ? `/admin/notifications?campus_key=${encodeURIComponent(campus)}` : '/admin/notifications')
    if (!alive || version !== loadVersion || campus !== campusFilter.value) return
    notifications.value = n
    loadedFilter.value = campus
  } catch {
    if (alive && version === loadVersion) loadError.value = '無法讀取通知，請重試。'
  } finally {
    if (alive && version === loadVersion) loading.value = false
  }
}

function changeCampus(value: string) {
  if (!operationBusy.value) campusFilter.value = value ?? ''
}
watch(campusFilter, () => { operationResult.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { alive = false; loadVersion++ })

const visibleNotifications = computed(() =>
  onlyUnread.value ? notifications.value.filter((n) => !n.read_at) : notifications.value,
)
const unreadCount = computed(() => notifications.value.filter((n) => !n.read_at).length)
const scopeLabel = computed(() => (campusFilter.value ? campusLabel(campusFilter.value) : '全部校區'))
// 「義華 3 則、仁武 1 則」：全部校區時講清楚未讀在哪幾校。
function countByCampus(rows: NotificationOut[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.campus_key, (counts.get(row.campus_key) ?? 0) + 1)
  return [...counts].map(([key, count]) => `${campusLabel(key)} ${count} 則`).join('、')
}
const unreadBreakdown = computed(() => (campusFilter.value ? '' : countByCampus(notifications.value.filter((n) => !n.read_at))))
const listCapped = computed(() => notifications.value.length >= NOTIFICATION_LIMIT)

// outbox 的 payload 用 receipt_id 放案件編號（舊版前端讀 visit_request_id，
// 永遠找不到，「查看案件」連結從來沒出現過）。
function visitRequestId(n: NotificationOut): string | null {
  const id = n.payload?.receipt_id ?? n.payload?.visit_request_id
  return typeof id === 'string' ? id : null
}

function summary(n: NotificationOut): string {
  const p = n.payload ?? {}
  const parts: string[] = []
  if (typeof p.parent_name === 'string') parts.push(p.parent_name)
  if (typeof p.slot_date === 'string') parts.push(String(p.slot_date))
  return parts.join('・')
}

function listMatches(campus: string): boolean {
  return loadedFilter.value === campus && campusFilter.value === campus
}

async function markRead(n: NotificationOut) {
  const campus = campusFilter.value
  if (!canMarkRead.value || operationBusy.value || loading.value || n.read_at || !listMatches(campus) || (campus && n.campus_key !== campus)) return
  busyId.value = n.id
  operationResult.value = ''
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
  if (!canMarkRead.value || operationBusy.value || loading.value || loadError.value) return
  const campus = campusFilter.value
  if (!listMatches(campus)) return
  const unread = notifications.value.filter((n) => !n.read_at && (!campus || n.campus_key === campus))
  if (!unread.length) return
  const scope = campus ? campusLabel(campus) : countByCampus(unread)
  // 已讀是同校共用的狀態；全部校區時一次會動到好幾校，先講清楚是哪幾校。
  if (!campus) {
    try {
      await ElMessageBox.confirm(
        `會把 ${scope}，共 ${unread.length} 則通知標記為已讀${listCapped.value ? `（只含列出的最新 ${NOTIFICATION_LIMIT} 則）` : ''}。已讀是同校共用的狀態，這幾校的同事也會看到已讀。`,
        '全部校區標記已讀？',
        { confirmButtonText: '標記已讀', cancelButtonText: '先不要', type: 'warning' },
      )
    } catch {
      return
    }
    if (!alive || operationBusy.value || !listMatches(campus)) return
  }
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
        : campus ? `已將${scope}的 ${bulkProgress.value} 則通知標記為已讀。` : `已將全部校區 ${bulkProgress.value} 則通知標記為已讀（${scope}）。`
    }
  } finally { bulkBusy.value = false }
}

// 已經送到的管道：重新寄送時會略過，只補沒送到的。
function deliveredText(row: NotificationOutboxOut): string {
  const parts: string[] = []
  if (row.delivered.inbox) parts.push('站內通知')
  if (row.delivered.line) parts.push('LINE 群組')
  if (row.delivered.email > 0) parts.push(`Email ${row.delivered.email} 人`)
  return parts.length ? parts.join('、') : '尚未送到任何管道'
}

function apiMessage(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
  return detail && typeof detail === 'object' && detail.message ? detail.message : fallback
}

async function retryOne(row: NotificationOutboxOut) {
  if (!canHandle.value || operationBusy.value) return
  busyId.value = row.id
  try {
    await api.post(`/admin/notification-outbox/${row.id}/retry`)
    if (!alive) return
    ElMessage.success('已排入重新寄送，約一分鐘內由系統重送')
    failedOutbox.value = failedOutbox.value.filter((item) => item.id !== row.id)
    failedTotal.value = Math.max(failedTotal.value - 1, failedOutbox.value.length)
  } catch (err) {
    if (!alive) return
    ElMessage.error(apiMessage(err, '重新寄送失敗，請重試'))
    await loadFailed()
  } finally { busyId.value = null }
}

async function retryAll() {
  if (!canHandle.value || operationBusy.value || failedOutbox.value.length === 0) return
  retryAllBusy.value = true
  operationResult.value = ''
  try {
    const result = await api.post<NotificationRetryBatchOut>('/admin/notification-outbox/retry', {
      ids: failedOutbox.value.map((row) => row.id),
    })
    if (!alive) return
    operationFailed.value = result.skipped > 0
    const done = result.skipped
      ? `已排入 ${result.requeued} 則重新寄送；${result.skipped} 則已被其他人處理或無法重送。`
      : `已排入 ${result.requeued} 則重新寄送，約一分鐘內由系統重送。`
    await loadFailed()
    // 一次只送得出畫面上列出的這些；還有沒列出的，重新載入後已經補上來了。
    operationResult.value = failedOutbox.value.length > 0 && !failedError.value
      ? `${done}還有 ${failedTotal.value} 則寄送失敗，請再按一次「全部重新寄送」。`
      : done
  } catch (err) {
    if (alive) ElMessage.error(apiMessage(err, '重新寄送失敗，請重試'))
  } finally { retryAllBusy.value = false }
}

async function decideReschedule(row: RescheduleRequestOut, action: RescheduleAction) {
  if (!canHandle.value || operationBusy.value) return
  // 核准會直接換掉家長的參觀時間、退回會讓家長維持原時段，兩者都是對外
  // 且不能反悔的動作，比照確認預約先問一次並講清楚是誰、從哪一場改到哪一場。
  const decision = await confirmRescheduleDecision(row, action)
  if (!decision) return
  busyId.value = row.id
  try {
    await submitRescheduleDecision(row.id, action, decision.reason)
    openRequests.refresh(true)
    if (!alive) return
    ElMessage.success(action === 'approve' ? `已核准，改到 ${formatSlotWhen(row.requested_slot)}` : '已退回改期申請')
    await loadReschedules()
  } catch (err) {
    if (!alive) return
    ElMessage.error(apiMessage(err, '操作失敗，請重試'))
    // 可能剛被別人處理或已失效：重讀清單，側欄數字也跟著更新。
    openRequests.refresh(true)
    await loadReschedules()
  } finally { busyId.value = null }
}

// 名額以組家庭計（一組三人只占一個名額），和時段頁、官網一樣寫「組」。
function requestedSlotNote(row: RescheduleRequestOut): string {
  return row.requested_slot_available ? `剩 ${row.requested_slot_remaining} 組` : '已額滿、關閉或已開始，無法核准'
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長送出需求、申請改期、案件確認與取消，以及即將參觀、逾期未處理的提醒。Email 與 LINE 寄送另外處理，這裡一定看得到紀錄；寄送失敗的可以在這裡重新寄送。" />

    <div class="filter-bar">
      <label class="filter-field"><span>通知校區</span><CampusSelect :model-value="campusFilter" :keys="visibleCampusKeys" :all-label="multiCampus ? '全部校區' : undefined" :disabled="operationBusy" @update:model-value="changeCampus" /></label>
      <el-checkbox v-model="onlyUnread" class="unread-toggle">只看未讀（{{ unreadCount }}）</el-checkbox>
      <span class="toolbar__spacer" />
      <el-button v-if="canMarkRead" text :disabled="operationBusy || loading || !!loadError || unreadCount === 0" :loading="bulkBusy" @click="markAllRead">{{ bulkBusy ? `標記中 ${bulkProgress} / ${bulkTotal}` : '全部標記已讀' }}</el-button>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可查看的校區" />

    <template v-else>
      <div class="list-summary" aria-live="polite">
        <span>{{ scopeLabel }} · {{ loading ? '讀取中…' : loadError ? '尚未載入' : `${notifications.length} 則通知，${unreadCount} 則未讀${unreadBreakdown ? `（${unreadBreakdown}）` : ''}` }}</span>
        <el-button :disabled="operationBusy || loading" @click="refreshAll">重新整理</el-button>
      </div>
      <el-alert v-if="operationResult" :title="operationResult" :type="operationFailed ? 'warning' : 'success'" show-icon :closable="false" class="inline-error" />
      <el-alert v-if="failedError" :title="failedError" type="error" show-icon :closable="false" class="inline-error" />
      <section v-if="failedOutbox.length > 0" class="panel failed" aria-labelledby="failed-outbox-title">
        <div class="panel__head">
          <h2 id="failed-outbox-title">寄送失敗（{{ failedTotal }}）</h2>
          <el-button v-if="canHandle" type="primary" :loading="retryAllBusy" :disabled="operationBusy" @click="retryAll">全部重新寄送</el-button>
        </div>
        <p class="section-lead">系統自動重試 5 次仍沒送出的通知（含你負責的所有校區）。先確認寄信或 LINE 設定已修好再重新寄送；已送到的管道不會重複送。</p>
        <el-alert v-if="failedHidden > 0" :title="`這裡只列出最新的 ${failedOutbox.length} 則，另有 ${failedHidden} 則沒有列出。「全部重新寄送」一次處理列出的這些，完成後會補上其餘的，請再按一次。`" type="warning" show-icon :closable="false" class="inline-error" />
        <el-table :data="failedOutbox" class="data-table">
          <el-table-column label="通知" min-width="220">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              <strong>{{ notificationLabel(row.kind, { reason: row.reason }) }}</strong>
              <router-link :to="`/visit-requests/${row.visit_request_id}`" class="open-link">查看案件</router-link>
            </template>
          </el-table-column>
          <el-table-column label="校區" width="80">
            <template #default="{ row }: { row: NotificationOutboxOut }">{{ campusLabel(row.campus_key) }}</template>
          </el-table-column>
          <el-table-column label="失敗原因" min-width="170">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              {{ outboxErrorLabel(row.error_code) }}
              <!-- 英文錯誤碼只給技術人員對 log，放在滑鼠提示裡。 -->
              <span v-if="row.error_code" class="slot-note" :title="row.error_code">已試 {{ row.attempts }} 次</span>
            </template>
          </el-table-column>
          <el-table-column label="已送到" min-width="150">
            <template #default="{ row }: { row: NotificationOutboxOut }">{{ deliveredText(row) }}</template>
          </el-table-column>
          <el-table-column label="通知時間" width="150">
            <template #default="{ row }: { row: NotificationOutboxOut }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column v-if="canHandle" width="110" align="right">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              <el-button size="small" :loading="busyId === row.id" :disabled="operationBusy" @click="retryOne(row)">重新寄送</el-button>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="寄送失敗的通知">
          <li v-for="row in failedOutbox" :key="row.id" class="mobile-record">
            <div class="record-heading"><strong>{{ notificationLabel(row.kind, { reason: row.reason }) }}</strong><el-tag type="danger">寄送失敗</el-tag></div>
            <dl class="record-meta">
              <dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd>
              <dt>失敗原因</dt><dd>{{ outboxErrorLabel(row.error_code) }}</dd>
              <dt>已送到</dt><dd>{{ deliveredText(row) }}</dd>
              <dt>通知時間</dt><dd>{{ formatDateTime(row.created_at) }}</dd>
            </dl>
            <div class="record-actions">
              <router-link :to="`/visit-requests/${row.visit_request_id}`">查看案件</router-link>
              <el-button v-if="canHandle" :loading="busyId === row.id" :disabled="operationBusy" @click="retryOne(row)">重新寄送</el-button>
            </div>
          </li>
        </ul>
      </section>
      <el-alert v-if="rescheduleError" :title="rescheduleError" type="error" show-icon :closable="false" class="inline-error" />
      <section v-if="pendingReschedules.length > 0" class="panel reschedule">
        <div class="panel__head"><h2>待核准的改期申請（{{ pendingReschedules.length }}）</h2></div>
        <p class="section-lead">家長線上申請、等園方核准的改期（含你負責的所有校區）。核准前原時段仍有效。</p>
        <el-table :data="pendingReschedules" class="data-table">
          <el-table-column label="家長" min-width="140">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <strong>{{ row.parent_name }}</strong>
              <router-link :to="`/visit-requests/${row.visit_request_id}`" class="open-link">查看案件</router-link>
            </template>
          </el-table-column>
          <el-table-column label="校區" width="80">
            <template #default="{ row }: { row: RescheduleRequestOut }">{{ campusLabel(row.campus_key) }}</template>
          </el-table-column>
          <el-table-column label="原時段" min-width="190">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num">{{ formatSlotWhen(row.current_slot) }}</span></template>
          </el-table-column>
          <el-table-column label="申請改到" min-width="210">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <strong class="num">{{ formatSlotWhen(row.requested_slot) }}</strong>
              <span class="slot-note" :class="{ 'is-blocked': !row.requested_slot_available }">{{ requestedSlotNote(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="申請時間" width="150">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column v-if="canHandle" label="操作" width="160" align="right">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <span class="cell-actions">
                <el-button size="small" type="primary" :loading="busyId === row.id" :disabled="operationBusy || !row.requested_slot_available" @click="decideReschedule(row, 'approve')">核准</el-button>
                <el-button size="small" :loading="busyId === row.id" :disabled="operationBusy" @click="decideReschedule(row, 'reject')">退回</el-button>
              </span>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="待核准的改期申請">
          <li v-for="row in pendingReschedules" :key="row.id" class="mobile-record">
            <div class="record-heading"><strong>{{ row.parent_name }}</strong><el-tag type="warning">待核准</el-tag></div>
            <dl class="record-meta">
              <dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd>
              <dt>原時段</dt><dd>{{ formatSlotWhen(row.current_slot) }}</dd>
              <dt>申請改到</dt><dd>{{ formatSlotWhen(row.requested_slot) }}（{{ requestedSlotNote(row) }}）</dd>
              <dt>申請時間</dt><dd>{{ formatDateTime(row.created_at) }}</dd>
            </dl>
            <div class="record-actions">
              <router-link :to="`/visit-requests/${row.visit_request_id}`">查看案件</router-link>
              <template v-if="canHandle">
                <el-button type="primary" :loading="busyId === row.id" :disabled="operationBusy || !row.requested_slot_available" @click="decideReschedule(row, 'approve')">核准</el-button>
                <el-button :disabled="operationBusy" @click="decideReschedule(row, 'reject')">退回</el-button>
              </template>
            </div>
          </li>
        </ul>
      </section>
      <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false" class="inline-error">
        <el-button :disabled="operationBusy" @click="load">重新載入</el-button>
      </el-alert>
      <div v-if="loading" class="panel loading-state" role="status">正在讀取通知…</div>
      <template v-else-if="!loadError">
      <section class="panel" aria-labelledby="notification-list-title">
        <div class="panel__head">
          <h2 id="notification-list-title">通知清單（{{ scopeLabel }}）</h2>
        </div>
        <p v-if="listCapped" class="section-lead">只列出最新的 {{ NOTIFICATION_LIMIT }} 則通知，更早的沒有列出；「全部標記已讀」也只處理列出的這些。</p>
        <el-empty v-if="visibleNotifications.length === 0" :image-size="72" :description="onlyUnread ? '沒有未讀通知' : campusFilter ? '這個校區還沒有通知' : '還沒有通知'">
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
              <strong :class="{ muted: row.read_at }">{{ notificationLabel(row.kind, row.payload) }}</strong>
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
              <el-button v-if="canMarkRead && !row.read_at" size="small" text :loading="busyId === row.id" :disabled="operationBusy" @click="markRead(row)">標記已讀</el-button>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="通知清單">
          <li v-for="row in visibleNotifications" :key="row.id" class="mobile-record">
            <div class="record-heading"><strong>{{ notificationLabel(row.kind, row.payload) }}</strong><el-tag :type="row.read_at ? 'info' : 'primary'">{{ row.read_at ? '已讀' : '未讀' }}</el-tag></div>
            <p v-if="summary(row)">{{ summary(row) }}</p>
            <dl class="record-meta"><dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd><dt>時間</dt><dd>{{ formatDateTime(row.created_at) }}</dd></dl>
            <div v-if="visitRequestId(row) || (canMarkRead && !row.read_at)" class="record-actions">
              <router-link v-if="visitRequestId(row)" :to="`/visit-requests/${visitRequestId(row)}`">查看案件</router-link>
              <el-button v-if="canMarkRead && !row.read_at" :loading="busyId === row.id" :disabled="operationBusy" @click="markRead(row)">標記已讀</el-button>
            </div>
          </li>
        </ul>
        </template>
      </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.loading-state { padding: 32px 20px; color: var(--ink-3); }
.record-actions { align-items: center; }
.record-actions a { margin-right: auto; }
.record-heading strong { overflow-wrap: anywhere; }

.failed {
  margin-bottom: 20px;
  border-color: var(--el-color-danger-light-5);
}

.section-lead {
  margin: 0;
  padding: 12px 24px;
  font-size: 13px;
  color: var(--ink-3);
}

@media (max-width: 720px) {
  .section-lead { padding: 12px 16px; }
}

/* el-checkbox 預設只有 32px 高，手機上撐到 44px 才點得準。 */
@media (max-width: 720px), (pointer: coarse) {
  .unread-toggle { --el-checkbox-height: 44px; min-height: 44px; }
}

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

.slot-note {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
}

.slot-note.is-blocked {
  color: var(--el-color-danger);
}

:deep(.el-table__row.is-read) {
  color: var(--ink-3);
}
</style>
