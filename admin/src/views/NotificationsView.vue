<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlarmClock, Bell, Check, CircleCheck, CircleClose, CirclePlus, RefreshRight, Switch, Timer, Warning } from '@element-plus/icons-vue'
import { notifyError } from '../composables/notify'
import { api, ApiError } from '../api/client'
import {
  campusLabel, formatDate, formatDateTime, formatShortDateTime, formatShortSlotWhen, formatSlotWhen, formatWeekday,
  notificationLabel, outboxErrorLabel,
} from '../api/labels'
import type { NotificationInboxItemOut, NotificationOutboxOut, NotificationOutboxPageOut, NotificationRetryBatchOut, RescheduleRequestOut } from '../api/types'
import { useCampusScope } from '../composables/useCampusScope'
import { usePermissions } from '../composables/usePermissions'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from '../composables/rescheduleDecision'
import { useOpenRequestsStore } from '../stores/openRequests'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'

type NotificationOut = NotificationInboxItemOut

// 管多校的人預設看「全部校區」（''），和下面寄送失敗、改期申請的範圍一致，不必
// 切五次才看完；只管一校的人直接是那一校。
const { visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
watch(visibleCampusKeys, (keys) => {
  if (keys.length === 1) campusFilter.value = keys[0]!
  else if (campusFilter.value && !keys.includes(campusFilter.value)) campusFilter.value = ''
}, { immediate: true })

// 校區與「未讀」頁籤寫進網址（router.replace，不堆歷史）：點進案件再返回、重新整理，
// 都回到剛才看的那一份清單。
const route = useRoute()
const router = useRouter()
const queryCampus = typeof route.query.campus === 'string' ? route.query.campus : ''
if (multiCampus.value && visibleCampusKeys.value.includes(queryCampus)) campusFilter.value = queryCampus
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
const onlyUnread = ref(route.query.unread === '1')
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

// quiet：切回分頁時的背景更新，保留畫面上的清單、不閃骨架，讀不到就維持原樣。
async function load(options: { quiet?: boolean } = {}) {
  const version = ++loadVersion
  const campus = campusFilter.value
  const quiet = options.quiet === true && listMatches(campus) && !loadError.value
  if (!quiet) {
    notifications.value = []
    loadedFilter.value = null
    loadError.value = ''
  }
  if (visibleCampusKeys.value.length === 0) { loading.value = false; return }
  if (!quiet) loading.value = true
  try {
    // 不帶校區＝你負責的全部校區（後端依權限範圍過濾）。
    const n = await api.get<NotificationOut[]>(campus ? `/admin/notifications?campus_key=${encodeURIComponent(campus)}` : '/admin/notifications')
    if (!alive || version !== loadVersion || campus !== campusFilter.value) return
    notifications.value = n
    loadedFilter.value = campus
    loadedAt = Date.now()
  } catch {
    if (alive && version === loadVersion && !quiet) loadError.value = '無法讀取通知，請重試。'
  } finally {
    if (alive && version === loadVersion) loading.value = false
  }
}

function changeCampus(value: string) {
  if (!operationBusy.value) campusFilter.value = value ?? ''
}
watch(campusFilter, () => { operationResult.value = ''; void load() }, { immediate: true })
watch([campusFilter, onlyUnread], ([campus, unread]) => {
  const campusParam = multiCampus.value && campus ? campus : undefined
  const unreadParam = unread ? '1' : undefined
  if (route.query.campus === campusParam && route.query.unread === unreadParam) return
  void router.replace({ query: { ...route.query, campus: campusParam, unread: unreadParam } }).catch(() => {})
})

// 和案件列表一樣不做定時輪詢：切回這個分頁或視窗時，距上次讀取超過 60 秒就
// 在背景重抓一次（三個區塊與頁首的改期數字）。處理中不打斷。
const STALE_MS = 60_000
let loadedAt = 0
function refreshIfStale() {
  if (document.visibilityState === 'hidden' || loading.value || operationBusy.value || Date.now() - loadedAt < STALE_MS) return
  loadedAt = Date.now()
  void load({ quiet: true })
  void loadFailed()
  void loadReschedules()
  void openRequests.refresh(true)
}
onMounted(() => {
  document.addEventListener('visibilitychange', refreshIfStale)
  window.addEventListener('focus', refreshIfStale)
})
onBeforeUnmount(() => {
  alive = false
  loadVersion++
  document.removeEventListener('visibilitychange', refreshIfStale)
  window.removeEventListener('focus', refreshIfStale)
})

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
// 給螢幕報讀器的清單摘要（畫面上的數字在頁籤裡）。
const liveSummary = computed(() => {
  if (loading.value) return '正在讀取通知…'
  if (loadError.value) return ''
  return `${scopeLabel.value} · ${notifications.value.length} 則通知，${unreadCount.value} 則未讀${unreadBreakdown.value ? `（${unreadBreakdown.value}）` : ''}`
})

const listTabs = computed(() => [
  { unread: false, label: '全部', count: notifications.value.length },
  { unread: true, label: '未讀', count: unreadCount.value },
])

// 通知種類的圖示與色調：一眼分得出新預約、改期、取消與提醒。顏色只標種類，
// 已讀未讀看左邊的點與標題粗細。
type Tone = 'success' | 'primary' | 'warning' | 'danger' | 'info'
const KIND_META: Record<string, { tone: Tone; icon: Component }> = {
  visit_request_created: { tone: 'success', icon: CirclePlus },
  visit_request_confirmed: { tone: 'success', icon: CircleCheck },
  visit_request_rescheduled: { tone: 'primary', icon: Switch },
  visit_upcoming: { tone: 'warning', icon: AlarmClock },
  visit_request_overdue: { tone: 'danger', icon: Warning },
  visit_request_cancelled: { tone: 'info', icon: CircleClose },
  // 人工確認時期的舊種類：舊資料仍會出現。
  visit_reschedule_requested: { tone: 'warning', icon: Switch },
  visit_request_hold_expired: { tone: 'info', icon: Timer },
}
function kindMeta(kind: string) {
  return KIND_META[kind] ?? { tone: 'info' as Tone, icon: Bell }
}

// 依台北日期分組：「今天」「昨天」，更早的寫日期與星期（今年省略年份）。
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })
const clockFormatter = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
function dayKey(value: string | Date): string {
  return dayKeyFormatter.format(typeof value === 'string' ? new Date(value) : value)
}
function clockOf(value: string): string {
  return clockFormatter.format(new Date(value))
}
function dayLabel(key: string): string {
  const now = new Date()
  if (key === dayKey(now)) return '今天'
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return '昨天'
  const date = formatDate(key)
  const thisYear = `${dayKey(now).slice(0, 4)}/`
  return `${date.startsWith(thisYear) ? date.slice(thisYear.length) : date}（${formatWeekday(key)}）`
}
const dayGroups = computed(() => {
  const groups: { key: string; label: string; items: NotificationOut[] }[] = []
  for (const row of visibleNotifications.value) {
    const key = dayKey(row.created_at)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(row)
    else groups.push({ key, label: dayLabel(key), items: [row] })
  }
  return groups
})

// outbox 的 payload 用 receipt_id 放案件編號（舊版前端讀 visit_request_id，
// 永遠找不到，「查看案件」連結從來沒出現過）。
function visitRequestId(n: NotificationOut): string | null {
  const id = n.payload?.receipt_id ?? n.payload?.visit_request_id
  return typeof id === 'string' ? id : null
}

// 案件的參觀場次是後端讀取時查的（不存在通知裡），只有日期時段、不含家長
// 個資；還沒排場次或案件已清除時不顯示。全部校區時前面帶校名。
function summary(n: NotificationOut): string {
  const parts: string[] = []
  if (multiCampus.value && !campusFilter.value) parts.push(campusLabel(n.campus_key))
  if (n.slot) parts.push(`參觀 ${formatShortSlotWhen(n.slot)}`)
  return parts.join('・')
}

function listMatches(campus: string): boolean {
  return loadedFilter.value === campus && campusFilter.value === campus
}

// 標記成功後寫回目前畫面上的那一則：背景更新可能已經換過一份清單。
function setReadLocally(n: NotificationOut, readAt: string | null) {
  n.read_at = readAt
  const current = notifications.value.find((row) => row.id === n.id)
  if (current) current.read_at = readAt
}

// 點通知打開案件就算看過，順手標成已讀（2026-10-05 業主裁定）。標記權限照舊只有
// booking.manage；在背景送出、不擋換頁，送不成功就變回未讀。中鍵開新分頁也算。
function markReadOnOpen(n: NotificationOut, event?: MouseEvent) {
  if (event?.type === 'auxclick' && event.button !== 1) return
  if (!canMarkRead.value || n.read_at) return
  setReadLocally(n, new Date().toISOString())
  api.post(`/admin/notifications/${n.id}/read`).catch(() => {
    if (alive) setReadLocally(n, null)
  })
}

async function markRead(n: NotificationOut) {
  const campus = campusFilter.value
  if (!canMarkRead.value || operationBusy.value || loading.value || n.read_at || !listMatches(campus) || (campus && n.campus_key !== campus)) return
  busyId.value = n.id
  operationResult.value = ''
  try {
    await api.post(`/admin/notifications/${n.id}/read`)
    if (alive && campus === campusFilter.value) setReadLocally(n, new Date().toISOString())
  } catch {
    if (alive) notifyError('標記失敗，請重試')
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
        if (alive && campus === campusFilter.value) setReadLocally(n, new Date().toISOString())
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
    notifyError(apiMessage(err, '重新寄送失敗，請重試'))
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
    if (alive) notifyError(apiMessage(err, '重新寄送失敗，請重試'))
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
    notifyError(apiMessage(err, '操作失敗，請重試'))
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
    <PageHeader lead="家長預約、改期、取消與到期提醒。" more="家長送出預約、改期、取消，以及即將參觀、逾期未處理的提醒都在這裡，點一則就打開那筆案件。Email 與 LINE 寄送另外處理，這裡一定看得到紀錄；寄送失敗的可以在這裡重新寄送。「已讀」是同校共用的狀態：校區管理者以上點開一則或按標記，同校同事也會看到已讀；櫃台點開不會改變已讀。" />

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可查看的校區" />

    <template v-else>
      <el-alert v-if="operationResult" :title="operationResult" :type="operationFailed ? 'warning' : 'success'" show-icon :closable="false" class="inline-error" />

      <!-- 要園方動手的放最上面：家長等著回覆的改期，再來是沒送出去的通知。兩區都列你負責的所有校區，不跟著下面清單的校區切換。 -->
      <el-alert v-if="rescheduleError" :title="rescheduleError" type="error" show-icon :closable="false" class="inline-error" />
      <section v-if="pendingReschedules.length > 0" class="panel reschedule" aria-labelledby="reschedule-title">
        <div class="panel__head"><h2 id="reschedule-title">待核准的改期申請（{{ pendingReschedules.length }}）</h2></div>
        <p class="section-lead">核准前原場次仍有效。</p>
        <el-table :data="pendingReschedules" class="data-table">
          <el-table-column label="家長" min-width="140">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <router-link :to="`/visit-requests/${row.visit_request_id}`" class="case-link">{{ row.parent_name }}</router-link>
            </template>
          </el-table-column>
          <el-table-column v-if="multiCampus" label="校區" width="80">
            <template #default="{ row }: { row: RescheduleRequestOut }">{{ campusLabel(row.campus_key) }}</template>
          </el-table-column>
          <el-table-column label="原場次" min-width="170">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num">{{ formatShortSlotWhen(row.current_slot) }}</span></template>
          </el-table-column>
          <el-table-column label="申請改到" min-width="190">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <strong class="num">{{ formatShortSlotWhen(row.requested_slot) }}</strong>
              <span class="slot-note" :class="{ 'is-blocked': !row.requested_slot_available }">{{ requestedSlotNote(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="申請時間" width="120">
            <template #default="{ row }: { row: RescheduleRequestOut }"><span class="num" :title="formatDateTime(row.created_at)">{{ formatShortDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column v-if="canHandle" label="操作" width="150" align="right">
            <template #default="{ row }: { row: RescheduleRequestOut }">
              <span class="cell-actions">
                <el-button size="small" type="primary" plain :loading="busyId === row.id" :disabled="operationBusy || !row.requested_slot_available" @click="decideReschedule(row, 'approve')">核准</el-button>
                <el-button size="small" :disabled="operationBusy" @click="decideReschedule(row, 'reject')">退回</el-button>
              </span>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="待核准的改期申請">
          <li v-for="row in pendingReschedules" :key="row.id" class="mobile-record">
            <div class="record-heading"><router-link :to="`/visit-requests/${row.visit_request_id}`" class="case-link">{{ row.parent_name }}</router-link></div>
            <dl class="record-meta">
              <template v-if="multiCampus"><dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd></template>
              <dt>原場次</dt><dd>{{ formatShortSlotWhen(row.current_slot) }}</dd>
              <dt>申請改到</dt><dd><strong>{{ formatShortSlotWhen(row.requested_slot) }}</strong><span class="slot-note" :class="{ 'is-blocked': !row.requested_slot_available }">{{ requestedSlotNote(row) }}</span></dd>
              <dt>申請時間</dt><dd>{{ formatShortDateTime(row.created_at) }}</dd>
            </dl>
            <div v-if="canHandle" class="record-actions record-actions--split">
              <el-button type="primary" plain :loading="busyId === row.id" :disabled="operationBusy || !row.requested_slot_available" @click="decideReschedule(row, 'approve')">核准</el-button>
              <el-button :disabled="operationBusy" @click="decideReschedule(row, 'reject')">退回</el-button>
            </div>
          </li>
        </ul>
      </section>

      <el-alert v-if="failedError" :title="failedError" type="error" show-icon :closable="false" class="inline-error" />
      <section v-if="failedOutbox.length > 0" class="panel failed" aria-labelledby="failed-outbox-title">
        <div class="panel__head">
          <h2 id="failed-outbox-title">寄送失敗（{{ failedTotal }}）</h2>
          <el-button v-if="canHandle" type="primary" plain :loading="retryAllBusy" :disabled="operationBusy" @click="retryAll">全部重新寄送</el-button>
        </div>
        <p class="section-lead">系統自動重試 5 次仍沒送出。先確認寄信或 LINE 設定已修好再重新寄送，已送到的管道不會重複送。</p>
        <el-alert v-if="failedHidden > 0" :title="`這裡只列出最新的 ${failedOutbox.length} 則，另有 ${failedHidden} 則沒有列出。「全部重新寄送」一次處理列出的這些，完成後會補上其餘的，請再按一次。`" type="warning" show-icon :closable="false" class="inline-error" />
        <el-table :data="failedOutbox" class="data-table">
          <el-table-column label="通知" min-width="200">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              <router-link :to="`/visit-requests/${row.visit_request_id}`" class="case-link">{{ notificationLabel(row.kind, { reason: row.reason }) }}</router-link>
              <span v-if="row.parent_name" class="slot-note">{{ row.parent_name }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="multiCampus" label="校區" width="80">
            <template #default="{ row }: { row: NotificationOutboxOut }">{{ campusLabel(row.campus_key) }}</template>
          </el-table-column>
          <el-table-column label="失敗原因" min-width="170">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              {{ outboxErrorLabel(row.error_code) }}
              <!-- 英文錯誤碼只給技術人員對 log，放在滑鼠提示裡。 -->
              <span class="slot-note" :title="row.error_code ?? undefined">已試 {{ row.attempts }} 次</span>
            </template>
          </el-table-column>
          <el-table-column label="已送到" min-width="140">
            <template #default="{ row }: { row: NotificationOutboxOut }">{{ deliveredText(row) }}</template>
          </el-table-column>
          <el-table-column label="通知時間" width="120">
            <template #default="{ row }: { row: NotificationOutboxOut }"><span class="num" :title="formatDateTime(row.created_at)">{{ formatShortDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column v-if="canHandle" width="110" align="right">
            <template #default="{ row }: { row: NotificationOutboxOut }">
              <el-button size="small" :loading="busyId === row.id" :disabled="operationBusy" @click="retryOne(row)">重新寄送</el-button>
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="寄送失敗的通知">
          <li v-for="row in failedOutbox" :key="row.id" class="mobile-record">
            <div class="record-heading"><router-link :to="`/visit-requests/${row.visit_request_id}`" class="case-link">{{ notificationLabel(row.kind, { reason: row.reason }) }}</router-link></div>
            <dl class="record-meta">
              <template v-if="row.parent_name"><dt>家長</dt><dd>{{ row.parent_name }}</dd></template>
              <template v-if="multiCampus"><dt>校區</dt><dd>{{ campusLabel(row.campus_key) }}</dd></template>
              <dt>失敗原因</dt><dd>{{ outboxErrorLabel(row.error_code) }}（已試 {{ row.attempts }} 次）</dd>
              <dt>已送到</dt><dd>{{ deliveredText(row) }}</dd>
              <dt>通知時間</dt><dd>{{ formatShortDateTime(row.created_at) }}</dd>
            </dl>
            <div v-if="canHandle" class="record-actions">
              <el-button :loading="busyId === row.id" :disabled="operationBusy" @click="retryOne(row)">重新寄送</el-button>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel notices" aria-labelledby="notification-list-title">
        <h2 id="notification-list-title" class="visually-hidden">通知清單</h2>
        <div class="notices__bar">
          <div class="status-tabs" role="group" aria-label="顯示哪些通知">
            <button
              v-for="tab in listTabs"
              :key="tab.label"
              type="button"
              class="status-tab"
              :class="{ 'is-active': onlyUnread === tab.unread }"
              :aria-pressed="onlyUnread === tab.unread"
              @click="onlyUnread = tab.unread"
            >{{ tab.label }}<span v-if="!loading && !loadError" class="status-tab__count num">{{ tab.count }}<span class="visually-hidden"> 則</span></span></button>
          </div>
          <p v-if="unreadBreakdown" class="notices__breakdown">未讀：{{ unreadBreakdown }}</p>
          <span class="toolbar__spacer" />
          <CampusSelect v-if="multiCampus" class="notices__campus" :model-value="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" :disabled="operationBusy" @update:model-value="changeCampus" />
          <el-button v-if="canMarkRead" class="notices__mark-all" :disabled="operationBusy || loading || !!loadError || unreadCount === 0" :loading="bulkBusy" @click="markAllRead">{{ bulkBusy ? `標記中 ${bulkProgress} / ${bulkTotal}` : '全部標記已讀' }}</el-button>
          <!-- 三個區塊一起重讀；切回分頁超過 60 秒也會自己更新，所以只放一顆小圖示。 -->
          <el-button class="notices__refresh" :icon="RefreshRight" aria-label="重新整理" title="重新整理" :disabled="operationBusy || loading" @click="refreshAll" />
        </div>
        <p class="visually-hidden" aria-live="polite">{{ liveSummary }}</p>

        <div v-if="loading" class="notices__skeleton" role="status">
          <span class="visually-hidden">正在讀取通知…</span>
          <el-skeleton animated :rows="4" />
        </div>
        <el-alert v-else-if="loadError" :title="loadError" type="error" show-icon :closable="false" class="notices__error">
          <el-button :disabled="operationBusy" @click="load()">重新載入</el-button>
        </el-alert>
        <el-empty v-else-if="visibleNotifications.length === 0" :image-size="72" :description="onlyUnread ? '沒有未讀通知' : campusFilter && multiCampus ? '這個校區還沒有通知' : '還沒有通知'">
          <el-button v-if="onlyUnread && notifications.length > 0" @click="onlyUnread = false">查看全部通知</el-button>
        </el-empty>
        <template v-else>
          <section v-for="group in dayGroups" :key="group.key" class="notice-day" :aria-labelledby="`notice-day-${group.key}`">
            <h3 :id="`notice-day-${group.key}`" class="notice-day__label">{{ group.label }}</h3>
            <ul class="notice-list">
              <li v-for="row in group.items" :key="row.id" class="notice" :class="{ 'is-unread': !row.read_at }" :data-tone="kindMeta(row.kind).tone">
                <span class="notice__dot"><span v-if="!row.read_at" class="dot" role="img" aria-label="未讀" /></span>
                <span class="notice__icon" aria-hidden="true"><el-icon><component :is="kindMeta(row.kind).icon" /></el-icon></span>
                <component
                  :is="visitRequestId(row) ? RouterLink : 'div'"
                  :to="visitRequestId(row) ? `/visit-requests/${visitRequestId(row)}` : undefined"
                  class="notice__main"
                  @click="visitRequestId(row) && markReadOnOpen(row, $event)"
                  @auxclick="visitRequestId(row) && markReadOnOpen(row, $event)"
                >
                  <span class="notice__head">
                    <span class="notice__title">{{ notificationLabel(row.kind, row.payload) }}</span>
                    <span v-if="row.parent_name" class="notice__who">{{ row.parent_name }}</span>
                  </span>
                  <span v-if="summary(row)" class="notice__meta num">{{ summary(row) }}</span>
                </component>
                <time class="notice__time num" :datetime="row.created_at" :title="formatDateTime(row.created_at)">{{ clockOf(row.created_at) }}</time>
                <span v-if="canMarkRead" class="notice__action">
                  <el-button v-if="!row.read_at" text :icon="Check" :loading="busyId === row.id" :disabled="operationBusy" title="標記已讀" @click="markRead(row)"><span class="notice__action-label">標記已讀</span></el-button>
                </span>
              </li>
            </ul>
          </section>
          <p v-if="listCapped" class="notices__cap">只列出最新的 {{ NOTIFICATION_LIMIT }} 則通知，更早的沒有列出；「全部標記已讀」也只處理列出的這些。</p>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.section-lead {
  margin: 0;
  padding: 12px 24px;
  font-size: var(--text-sm);
  color: var(--ink-3);
}

.reschedule {
  margin-bottom: 20px;
  border-color: var(--el-color-warning-light-5);
}

.failed {
  margin-bottom: 20px;
  border-color: var(--el-color-danger-light-5);
}

.case-link {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.record-heading .case-link {
  font-size: var(--text-md);
}

.slot-note {
  display: block;
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.slot-note.is-blocked {
  color: var(--el-color-danger);
}

/* 通知清單：頁籤、校區、全部標記已讀放在清單自己的頂列，看得出它們只管這份清單。 */
.notices__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
}

.notices__bar .status-tabs {
  margin-bottom: 0;
}

.notices__campus {
  width: 140px;
}

.notices__breakdown {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-3);
}

.notices__bar .el-button + .el-button {
  margin-left: 0;
}

.notices__skeleton {
  padding: 20px 24px;
}

.notices__error {
  margin: 16px 24px;
  width: auto;
}

.notices__cap {
  margin: 0;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
  color: var(--ink-3);
}

.notice-day__label {
  margin: 0;
  padding: 16px 24px 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink-3);
}

.notice-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 一則一列：未讀點、種類圖示、標題與場次（點了開案件）、時間、標記已讀。 */
.notice {
  display: grid;
  grid-template-columns: 10px 32px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0 12px;
  padding: 10px 24px;
  border-top: 1px solid var(--line);
  transition: background-color 150ms var(--ease-out);
}

.notice-day__label + .notice-list > .notice:first-child {
  border-top: 0;
}

.notice:hover {
  background: var(--surface-2);
}

.notice__icon {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: var(--text-lg);
}

.notice[data-tone='success'] .notice__icon { background: var(--el-color-success-light-9); color: var(--status-live-ink); }
.notice[data-tone='primary'] .notice__icon { background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); }
.notice[data-tone='warning'] .notice__icon { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.notice[data-tone='danger'] .notice__icon { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.notice[data-tone='info'] .notice__icon { background: var(--surface-3); color: var(--ink-3); }

.notice__main {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 4px 0;
  color: var(--ink-2);
  text-decoration: none;
}

a.notice__main:hover .notice__title {
  color: var(--admin-accent-hover);
}

a.notice__main:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

/* 標題與家長稱呼同一行，放不下就換行。 */
.notice__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
  min-width: 0;
}

.notice__title {
  overflow-wrap: anywhere;
}

.notice__who {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.notice.is-unread .notice__title {
  color: var(--ink);
  font-weight: 600;
}

.notice__meta {
  font-size: var(--text-sm);
  color: var(--ink-3);
}

.notice__time {
  font-size: var(--text-sm);
  color: var(--ink-3);
}

/* 每列都留同寬的位置，已讀列沒有按鈕時時間仍對齊。 */
.notice__action {
  display: flex;
  justify-content: flex-end;
  width: 112px;
}

.notice__action .el-button {
  color: var(--ink-2);
}

.dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
}

@media (max-width: 720px) {
  .section-lead { padding: 12px 16px; }
  .notices__bar { padding: 12px 16px; }
  .notices__bar .status-tabs { flex: 1 1 100%; }
  .notices__bar .status-tab { flex: 1 1 0; justify-content: center; min-height: 44px; }
  .notices__bar .toolbar__spacer { display: none; }
  .notices__campus { flex: 1 1 0; width: auto; min-width: 0; }
  .notices__mark-all { min-height: 44px; }
  .notices__refresh { width: 44px; min-height: 44px; }
  .notices__breakdown { order: 5; flex-basis: 100%; }
  .notices__skeleton { padding: 16px; }
  .notices__error { margin: 16px; }
  .notices__cap { padding: 12px 16px 16px; }
  .notice-day__label { padding: 14px 16px 4px; }
  /* 手機：時間在右上，標記已讀在右下（44px 觸控），標題可以換行。 */
  .notice {
    grid-template-columns: 6px 28px minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    align-items: start;
    gap: 0 8px;
    padding: 10px 16px;
  }
  .notice__dot { grid-row: 1 / 3; padding-top: 11px; }
  .notice__dot .dot { width: 6px; height: 6px; }
  .notice__icon { grid-row: 1 / 3; width: 28px; height: 28px; margin-top: 2px; font-size: var(--text-md); }
  .notice__main { grid-row: 1 / 3; padding: 2px 0 4px; }
  .notice__time { grid-column: 4; grid-row: 1; padding-top: 4px; text-align: right; }
  .notice__action { grid-column: 4; grid-row: 2; width: auto; }
  /* 手機只留打勾圖示（名稱照樣是「標記已讀」），場次那行才不會被擠成兩行。 */
  .notice__action .el-button { width: 44px; min-height: 44px; margin-right: -12px; padding: 0; }
  .notice__action .el-button :deep([class*='el-icon'] + span) { margin-left: 0; }
  .notice__action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .record-actions--split .el-button { flex: 1 1 0; min-height: 44px; }
}

@media (max-width: 720px), (pointer: coarse) {
  a.notice__main { min-height: 44px; }
}
</style>
