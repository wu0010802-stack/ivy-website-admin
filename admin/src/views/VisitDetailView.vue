<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import type { VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
import { ageLabel, campusLabel, consentRecordLabel, contactTimeLabel, formatDateTime, formatHoldRemaining, formatSlotWhen, holdIsUrgent, partySizeLabel, visitStatus, referralSourceLabels, slotStarted, staffLabel, visitSourceLabel } from '../api/labels'
import { useOpenRequestsStore } from '../stores/openRequests'
import { usePermissions } from '../composables/usePermissions'
import { useVisitStaff } from '../composables/useVisitStaff'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from '../composables/rescheduleDecision'
import StatusTag from '../components/StatusTag.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import VisitHistoryTimeline from '../components/VisitHistoryTimeline.vue'
import { useCampusScope } from '../composables/useCampusScope'

const route = useRoute()
const openRequests = useOpenRequestsStore()
const router = useRouter()
const id = computed(() => route.params.id as string)

const detail = ref<VisitRequestFullOut | null>(null)
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
const selectedSlotId = ref('')
// 已確認案件改期：選新場次、原因選填（記在案件歷程）。
const rescheduleSlotId = ref('')
const rescheduleReason = ref('')
const newNote = ref('')
// 「下次聯絡」跟著這一筆紀錄一起送；家長說「下週再打」時才有地方記，
// 總覽的「到期待追蹤」也才會有來源。
const followUpAt = ref<string | null>(null)
const noteInput = ref<{ focus: () => void } | null>(null)
// 同校還在「待處理」的其他案件，讓櫃台早上能一筆接一筆處理，不必每次回列表。
const nextPending = ref<{ id: string; count: number } | null>(null)
const busy = ref(false)
const rebookOpen = ref(false)
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const loading = ref(true)
const { can } = usePermissions()
// 處理案件（聯絡紀錄、確認、取消、改期…）含櫃台；指派承辦人與新增時段
// 仍是校區管理者以上（booking.manage）。
const canHandle = computed(() => can('booking.handle'))
const canManage = computed(() => can('booking.manage'))
const { staff, load: loadStaff } = useVisitStaff()
const assignable = computed(() =>
  staff.value.filter(
    (s) => s.is_active && (s.role === 'super_admin' || (detail.value ? s.campus_keys.includes(detail.value.campus_key) : false)),
  ),
)
const assigning = ref(false)

async function assign(staffId: string | null) {
  if (!detail.value) return
  assigning.value = true
  try {
    await api.patch<VisitRequestDetailOut>(`/admin/visit-requests/${id.value}/assignee`, {
      assigned_staff_id: staffId || null,
      expected_version: detail.value.version,
    })
    await refreshDetail()
    ElMessage.success(staffId ? `已指派給 ${staffLabel(staffId, staff.value)}` : '已取消指派')
  } catch (err) {
    reportError(err, '指派失敗')
  } finally {
    assigning.value = false
  }
}
const error = ref<string | null>(null)

// quiet：動作完成後的重讀不切回骨架畫面，頁面上的狀態（例如剛產生、只顯示
// 一次的家長連結）才不會因為元件重新掛載而消失。
async function load(options: { quiet?: boolean } = {}) {
  if (!options.quiet) loading.value = true
  error.value = null
  try {
    detail.value = await api.get<VisitRequestFullOut>(`/admin/visit-requests/${id.value}`)
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id.value}/contact-notes`)
    void loadNextPending(detail.value.campus_key)
    // 排入時段（新需求、聯絡中）與改期（已確認）都從同校未來 60 天的時段挑。
    if (['new', 'contacting', 'confirmed'].includes(detail.value.status)) {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      availableSlots.value = await api.get<VisitSlotOut[]>(
        `/admin/slots?campus_key=${detail.value.campus_key}&date_from=${today}&date_to=${future}`,
      )
    } else {
      availableSlots.value = []
    }
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
  } finally {
    loading.value = false
  }
}

// 動作完成後只更新案件本身（含歷程），不切回骨架畫面：家長連結剛產生的
// 網址還顯示在頁面上，重新掛載就看不到了。
async function refreshDetail() {
  try {
    detail.value = await api.get<VisitRequestFullOut>(`/admin/visit-requests/${id.value}`)
  } catch {
    /* 下次重新整理再讀 */
  }
}

async function loadNextPending(campusKey: string) {
  try {
    const params = new URLSearchParams({ status: 'new', campus_key: campusKey, order: 'oldest', page_size: '50' })
    const list = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
    const others = Array.isArray(list) ? list.filter((r) => r.id !== id.value) : []
    nextPending.value = others.length ? { id: others[0]!.id, count: others.length } : null
  } catch {
    nextPending.value = null
  }
}

function reportError(err: unknown, fallback: string) {
  if (isVersionConflict(err)) {
    // 別人剛改過承辦人或下次聯絡時間：不蓋掉，重讀案件讓畫面顯示最新的。
    ElMessage.warning(apiErrorMessage(err, '這筆案件剛被其他人修改，已重新載入'))
    void refreshDetail()
    return
  }
  ElMessage.error(apiErrorMessage(err, fallback))
}

// 已經開始的場次不能再排人（後端也會拒絕），名額滿或關閉的也不列。
const openSlots = computed(() =>
  availableSlots.value.filter((s) => !s.closed && s.booked_count < s.capacity && !slotStarted(s)),
)
const rescheduleSlots = computed(() => openSlots.value.filter((s) => s.id !== detail.value?.slot_id))

function slotLabel(slot: VisitSlotOut): string {
  const left = slot.capacity - slot.booked_count
  return `${formatSlotWhen(slot)}，剩 ${left} 位`
}

async function confirm() {
  if (!selectedSlotId.value && detail.value?.status !== 'pending_confirmation') {
    ElMessage.warning('請先選擇一個時段')
    return
  }
  const slot = detail.value?.status === 'pending_confirmation' ? detail.value.slot : openSlots.value.find((s) => s.id === selectedSlotId.value)
  if (!slot) {
    ElMessage.warning('這個時段已經不能選了，請重新選擇')
    return
  }
  try {
    // 家長 Email 目前僅供聯絡；不把案件狀態更新誤稱為已寄信給家長。
    await ElMessageBox.confirm(
      `將把 ${detail.value?.parent_name} 排入 ${formatSlotWhen(slot)}，案件更新為已確認。請另行聯絡家長告知參觀安排。`,
      '確認這筆預約？',
      { confirmButtonText: '確認預約', cancelButtonText: '先不要', type: 'info' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/confirm`, { slot_id: slot.id })
    ElMessage.success(`已確認，參觀時間 ${formatSlotWhen(slot)}。記得告知家長。`)
    openRequests.refresh(true)
    await load({ quiet: true })
    // 確認完的下一步幾乎都是打電話告知家長：把紀錄框先填好、游標放進去，
    // 講完電話按 Enter 就記下，不用再想要寫什麼。
    if (!newNote.value.trim()) newNote.value = `已致電家長，告知參觀時間 ${formatSlotWhen(slot)}。`
    await nextTick()
    noteInput.value?.focus()
  } catch (err) {
    reportError(err, '確認失敗')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  let reason: string | null = null
  try {
    const result = await ElMessageBox.prompt('取消後家長需要重新送出需求才能再預約。', '取消這筆預約？', {
      confirmButtonText: '取消預約',
      cancelButtonText: '先不要',
      inputPlaceholder: '取消原因（選填，會記在案件歷程）',
      inputValidator: (value: string) => !value || value.length <= 500 || '原因最多 500 字',
      type: 'warning',
    })
    const value = (result as { value?: string }).value ?? ''
    reason = value.trim() || null
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/cancel`, { reason })
    ElMessage.success('已取消')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '取消失敗')
  } finally {
    busy.value = false
  }
}

async function markNoShow() {
  try {
    await ElMessageBox.confirm('標記後這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。', '標記為未到場？', {
      confirmButtonText: '標記未到場',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/no-show`)
    ElMessage.success('已標記未到場')
    // 結案時家長待核准的改期申請跟著失效，側欄的待核准數要一起更新。
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    busy.value = false
  }
}

// 參觀時段開始後才出現「完成參觀」與「標記未到場」（後端也會拒絕）：兩者都會
// 保留這一場的名額，提早按下去未來那一場就永遠排不進人；家長事先說不來要取消。
// 櫃台常開著案件頁等家長來，時間每 30 秒重算一次，場次一開始按鈕就出現。
const clockNow = ref(Date.now())
const clock = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(clock))
const visitStarted = computed(() => {
  const slot = detail.value?.slot
  return slot ? slotStarted(slot, clockNow.value) : false
})

async function markContacting() {
  const returning = detail.value?.status === 'pending_confirmation'
  if (returning) {
    try {
      await ElMessageBox.confirm('家長選的場次會釋出給別人，案件回到「聯絡中」，之後再和家長約時間。', '退回聯絡中？', {
        confirmButtonText: '退回並釋出名額',
        cancelButtonText: '先不要',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/contacting`)
    ElMessage.success(returning ? '已退回聯絡中，名額已釋出' : '已標為聯絡中')
    openRequests.refresh(true)
    await load({ quiet: true })
    if (!returning) {
      await nextTick()
      noteInput.value?.focus()
    }
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    busy.value = false
  }
}

async function reschedule() {
  const current = detail.value
  const target = rescheduleSlots.value.find((s) => s.id === rescheduleSlotId.value)
  if (!current || !target) {
    ElMessage.warning('請先選擇新的參觀時段')
    return
  }
  try {
    await ElMessageBox.confirm(
      `${current.parent_name} 的參觀時間會從 ${formatSlotWhen(current.slot)} 改到 ${formatSlotWhen(target)}，原時段名額釋出。請另行告知家長。`,
      '改期？',
      { confirmButtonText: '確認改期', cancelButtonText: '先不要', type: 'info' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/reschedule`, {
      new_slot_id: target.id,
      reason: rescheduleReason.value.trim() || null,
    })
    ElMessage.success(`已改到 ${formatSlotWhen(target)}。記得告知家長。`)
    rescheduleSlotId.value = ''
    rescheduleReason.value = ''
    // 家長先前的改期申請在直接改期時失效，側欄的待核准數要一起更新。
    openRequests.refresh(true)
    await load({ quiet: true })
    if (!newNote.value.trim()) newNote.value = `已致電家長，參觀改到 ${formatSlotWhen(target)}。`
  } catch (err) {
    reportError(err, '改期失敗')
    // 名額或時段可能剛被別人用掉，重讀一次讓選單反映現況。
    await load({ quiet: true })
  } finally {
    busy.value = false
  }
}

async function decideReschedule(action: RescheduleAction) {
  const request = detail.value?.pending_reschedule
  if (!request) return
  const decision = await confirmRescheduleDecision(request, action)
  if (!decision) return
  busy.value = true
  try {
    await submitRescheduleDecision(request.id, action, decision.reason)
    ElMessage.success(action === 'approve' ? `已核准，改到 ${formatSlotWhen(request.requested_slot)}。記得告知家長。` : '已退回改期申請，家長維持原時段')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
    await load({ quiet: true })
  } finally {
    busy.value = false
  }
}

function onRebooked(created: VisitRequestDetailOut) {
  openRequests.refresh(true)
  router.push(`/visit-requests/${created.id}`)
}

async function markCompleted() {
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/complete`)
    ElMessage.success('已標記完成參觀')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    busy.value = false
  }
}

async function addNote() {
  if (!newNote.value.trim()) return
  busy.value = true
  try {
    const hadFollowUp = Boolean(followUpAt.value)
    await api.post(`/admin/visit-requests/${id.value}/contact-notes`, {
      note: newNote.value.trim(),
      follow_up_at: followUpAt.value || null,
      // 改下次聯絡時間會蓋掉案件上的值，要帶版本；只記一筆紀錄不用。
      ...(followUpAt.value ? { expected_version: detail.value?.version } : {}),
    })
    newNote.value = ''
    followUpAt.value = null
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id.value}/contact-notes`)
    // 追蹤時間存在案件上、歷程也多一筆；重讀一次頁首與歷程。
    await refreshDetail()
    if (hadFollowUp) ElMessage.success('已記下，到時會出現在總覽的「到期待追蹤」')
  } catch (err) {
    reportError(err, '新增紀錄失敗')
  } finally {
    busy.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/visit-requests')
}

function goNext() {
  if (nextPending.value) router.push(`/visit-requests/${nextPending.value.id}`)
}

// 追蹤時間已過、案件還沒結案：頁首用警示色提醒。
const followUpDue = computed(() => {
  const at = detail.value?.follow_up_at
  if (!at) return false
  const open = detail.value?.status !== 'cancelled' && detail.value?.status !== 'completed'
  return open && new Date(at).getTime() <= Date.now()
})

// 日期選擇器不給過去的時間：「下次聯絡」記在昨天沒有意義。
function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

onMounted(() => {
  load()
  void loadStaff()
})
// 「下一筆待處理」是同一個元件換 id，router 不會重新掛載。
watch(id, () => {
  newNote.value = ''
  followUpAt.value = null
  selectedSlotId.value = ''
  rescheduleSlotId.value = ''
  rescheduleReason.value = ''
  load()
})

// 還在流程中的案件才需要家長連結；結案時後端已經撤銷。
const linkApplicable = computed(() =>
  ['new', 'contacting', 'pending_confirmation', 'confirmed'].includes(detail.value?.status ?? ''),
)
</script>

<template>
  <div class="page detail">
    <div class="detail__nav">
      <el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">參觀案件</el-button>
      <el-button v-if="nextPending" text class="detail__next" @click="goNext">
        下一筆待處理（還有 {{ nextPending.count }} 件）<el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-skeleton v-else-if="loading" animated :rows="6" />

    <template v-else-if="detail">
      <div class="detail__head">
        <div>
          <h1 class="detail__title">{{ detail.parent_name }}</h1>
          <p class="hint">
            {{ campusLabel(detail.campus_key) }}・{{ formatDateTime(detail.created_at) }}
            {{ detail.source && detail.source !== 'web' ? `${visitSourceLabel(detail.source)}補登` : '官網送出' }}<template v-if="detail.created_by">（{{ staffLabel(detail.created_by, staff) }} 登錄）</template>
          </p>
          <p v-if="detail.related_request_id" class="hint">
            重新預約自 <router-link :to="`/visit-requests/${detail.related_request_id}`">先前的案件</router-link>
          </p>
          <p v-if="detail.slot" class="detail__when">參觀時間 {{ formatSlotWhen(detail.slot) }}</p>
          <p v-if="detail.follow_up_at" class="detail__follow" :class="{ 'is-due': followUpDue }">
            {{ followUpDue ? '已到預定聯絡時間' : '預定聯絡' }} {{ formatDateTime(detail.follow_up_at) }}
          </p>
        </div>
        <StatusTag :meta="visitStatus(detail.status)" size="large" />
      </div>

      <div class="detail__grid">
        <div class="detail__main">
          <div class="panel">
            <div class="panel__head"><h2>家長填寫的資料</h2></div>
            <el-descriptions :column="1" border label-width="120" class="detail__desc">
              <el-descriptions-item label="電話">
                <a :href="`tel:${detail.phone}`" class="num">{{ detail.phone }}</a>
              </el-descriptions-item>
              <el-descriptions-item label="孩子姓名">{{ detail.child_name || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="出生年月日">{{ detail.child_birthdate || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="Email"><a v-if="detail.email" :href="`mailto:${detail.email}`">{{ detail.email }}</a><span v-else>未填寫</span></el-descriptions-item>
              <el-descriptions-item label="參觀人數">{{ partySizeLabel(detail.party_size) }}</el-descriptions-item>
              <el-descriptions-item label="得知管道">{{ referralSourceLabels(detail.referral_sources) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.age" label="家長填的年齡">{{ ageLabel(detail.age) }}</el-descriptions-item>
              <el-descriptions-item label="接電話時段">{{ contactTimeLabel(detail.preferred_time) }}</el-descriptions-item>
              <el-descriptions-item label="想了解的事">
                <span class="detail__pre">{{ detail.questions || '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="同意紀錄">{{ consentRecordLabel(detail) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.confirmed_at" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <ParentAccessLinkPanel
            v-if="linkApplicable"
            :visit-id="detail.id"
            :access-link="detail.access_link"
            :can-handle="canHandle"
            :deadline-hours="detail.parent_change_deadline_hours"
            @changed="refreshDetail"
          />

          <section class="section">
            <div class="section__title"><h2>聯絡紀錄</h2></div>
            <ol class="notes" v-if="notes.length > 0">
              <li v-for="n in notes" :key="n.id" class="notes__item">
                <span class="notes__meta">
                  <time class="notes__time num">{{ formatDateTime(n.created_at) }}</time>
                  <span v-if="n.created_by" class="notes__author">{{ n.created_by_email ? n.created_by_email.split('@')[0] : '已移除的帳號' }}</span>
                </span>
                <p class="detail__pre">{{ n.note }}</p>
              </li>
            </ol>
            <p v-else class="hint">{{ canHandle ? '還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。' : '還沒有聯絡紀錄。' }}</p>
            <div v-if="canHandle" class="notes__form">
              <el-input
                ref="noteInput"
                v-model="newNote"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="例如：已致電，家長希望週六上午，下週回覆"
                aria-label="新增聯絡紀錄"
                @keydown.meta.enter="addNote"
                @keydown.ctrl.enter="addNote"
              />
              <div class="notes__row">
                <label class="notes__follow">
                  <span>下次聯絡</span>
                  <el-date-picker
                    v-model="followUpAt"
                    type="datetime"
                    value-format="YYYY-MM-DDTHH:mm:ss+08:00"
                    format="MM/DD HH:mm"
                    placeholder="不用再追"
                    :disabled-date="disablePast"
                    :default-time="new Date(2000, 0, 1, 10, 0, 0)"
                    clearable
                    style="width: 160px"
                  />
                </label>
                <el-button :loading="busy" :disabled="!newNote.trim()" @click="addNote">新增紀錄</el-button>
                <span class="hint notes__hint">按 ⌘／Ctrl＋Enter 也能送出</span>
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section__title"><h2>案件歷程</h2><span class="hint">誰在什麼時候改了什麼</span></div>
            <VisitHistoryTimeline :events="detail.history ?? []" :staff="staff" />
          </section>
        </div>

        <aside class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <p v-if="!canHandle" class="hint">你的帳號只能查看案件，狀態由負責處理案件的同事更新。</p>
              <template v-else-if="detail.status === 'new' || detail.status === 'contacting'">
                <el-button v-if="detail.status === 'new'" :loading="busy" style="width: 100%" @click="markContacting">開始聯絡（標為聯絡中）</el-button>
                <p class="hint">與家長確認時間後，選一個時段排入，預約才算成立。</p>
                <el-select v-model="selectedSlotId" placeholder="選擇參觀時段" :disabled="openSlots.length === 0" style="width: 100%">
                  <el-option v-for="slot in openSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                </el-select>
                <p v-if="openSlots.length === 0" class="hint">
                  <template v-if="canManage">未來 60 天沒有可用時段。先到 <router-link to="/slots">時段與容量</router-link> 新增。</template>
                  <template v-else>未來 60 天沒有可用時段，請校區管理者到「時段與容量」新增。</template>
                </p>
                <el-button type="primary" :loading="busy" :disabled="!selectedSlotId" style="width: 100%" @click="confirm">
                  確認並排入時段
                </el-button>
              </template>

              <template v-else-if="detail.status === 'pending_confirmation'">
                <p class="hint">家長已選擇場次，名額暫時保留。確認後預約才會成立。</p>
                <p v-if="detail.hold_expires_at" class="hold-deadline" :class="{ 'is-urgent': holdIsUrgent(detail.hold_expires_at) }">
                  請於 <strong class="num">{{ formatDateTime(detail.hold_expires_at) }}</strong> 前確認（{{ formatHoldRemaining(detail.hold_expires_at) }}），逾期名額會自動釋出。
                </p>
                <el-button type="primary" :loading="busy" :disabled="!detail.slot" style="width: 100%" @click="confirm">確認已選場次</el-button>
                <el-button :loading="busy" style="width: 100%; margin-left: 0" @click="markContacting">家長要改時間：退回聯絡中</el-button>
              </template>

              <template v-else-if="detail.status === 'confirmed'">
                <div v-if="detail.pending_reschedule" class="reschedule-request" role="group" aria-label="家長的改期申請">
                  <p class="reschedule-request__title">家長申請改期<span class="num">（{{ formatDateTime(detail.pending_reschedule.created_at) }}）</span></p>
                  <p class="reschedule-request__slots">
                    {{ formatSlotWhen(detail.pending_reschedule.current_slot) }}<br />→ <strong>{{ formatSlotWhen(detail.pending_reschedule.requested_slot) }}</strong>
                  </p>
                  <p class="hint">
                    {{ detail.pending_reschedule.requested_slot_available
                      ? `新時段剩 ${detail.pending_reschedule.requested_slot_remaining} 位。原時段在核准前仍有效。`
                      : '新時段已額滿、關閉或已開始，無法核准；請退回並聯絡家長另約。' }}
                  </p>
                  <div class="reschedule-request__actions">
                    <el-button type="primary" :loading="busy" :disabled="!detail.pending_reschedule.requested_slot_available" @click="decideReschedule('approve')">核准改期</el-button>
                    <el-button :loading="busy" @click="decideReschedule('reject')">退回申請</el-button>
                  </div>
                </div>
                <p class="hint">{{ visitStarted ? '家長來參觀後標記完成；沒有出現請標記未到場。' : '參觀時段開始後可以標記完成或未到場；家長事先說不來，請用下方的「取消預約」。' }}</p>
                <template v-if="visitStarted">
                  <el-button type="primary" :loading="busy" style="width: 100%" @click="markCompleted">完成參觀</el-button>
                  <el-button :loading="busy" style="width: 100%; margin-left: 0" @click="markNoShow">標記未到場</el-button>
                </template>
                <div class="reschedule">
                  <p class="reschedule__title">改期（換時段）</p>
                  <el-select v-model="rescheduleSlotId" placeholder="選擇新的參觀時段" :disabled="rescheduleSlots.length === 0" aria-label="改期的新時段" style="width: 100%">
                    <el-option v-for="slot in rescheduleSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                  </el-select>
                  <p v-if="rescheduleSlots.length === 0" class="hint">
                    <template v-if="canManage">未來 60 天沒有其他可用時段。先到 <router-link to="/slots">時段與容量</router-link> 新增。</template>
                    <template v-else>未來 60 天沒有其他可用時段，請校區管理者到「時段與容量」新增。</template>
                  </p>
                  <el-input v-model="rescheduleReason" maxlength="500" placeholder="改期原因（選填）" aria-label="改期原因" />
                  <el-button :loading="busy" :disabled="!rescheduleSlotId" style="width: 100%; margin-left: 0" @click="reschedule">改到這個時段</el-button>
                  <p class="hint">案件編號與紀錄不變，原時段名額在同一步釋出；新時段滿了會整筆不改。</p>
                </div>
              </template>

              <template v-else>
                <p class="hint">這筆案件已結案。家長想再約，請另建新案，舊案會保留原紀錄。</p>
                <el-button :loading="busy" style="width: 100%" @click="rebookOpen = true">重新預約（另建新案）</el-button>
              </template>
            </div>
            <div class="detail__assignee">
              <label for="visit-assignee">承辦人</label>
              <el-select
                v-if="canManage"
                id="visit-assignee"
                :model-value="detail.assigned_staff_id ?? ''"
                :loading="assigning"
                :disabled="assigning"
                placeholder="未指派"
                clearable
                style="width: 100%"
                @change="(value: string) => assign(value || null)"
              >
                <el-option
                  v-if="detail.assigned_staff_id && !assignable.some((s) => s.id === detail!.assigned_staff_id)"
                  :value="detail.assigned_staff_id"
                  :label="staffLabel(detail.assigned_staff_id, staff)"
                  disabled
                />
                <el-option v-for="s in assignable" :key="s.id" :value="s.id" :label="s.email" />
              </el-select>
              <span v-else>{{ staffLabel(detail.assigned_staff_id, staff) }}</span>
            </div>
            <div
              v-if="canHandle && ['new', 'contacting', 'pending_confirmation', 'confirmed'].includes(detail.status)"
              class="detail__danger"
            >
              <span class="hint">家長不來了？</span>
              <el-button text type="danger" :loading="busy" class="detail__cancel" @click="cancel">取消預約</el-button>
            </div>
          </div>
        </aside>
      </div>
      <ManualVisitDialog v-model="rebookOpen" :campus-keys="visibleCampusKeys" :related-from="detail" @created="onRebooked" />
    </template>
  </div>
</template>

<style scoped>
.hold-deadline { margin: 0; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); color: var(--ink-2); font-size: 13px; line-height: 1.6; }
.hold-deadline strong { color: var(--ink); font-weight: 600; }
.hold-deadline.is-urgent { background: var(--el-color-warning-light-9); color: var(--brand-gold-ink); }
.detail__nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail__back {
  margin-left: -8px;
}

.detail__next {
  margin-right: -8px;
}

.detail__follow {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-2);
}

.detail__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.notes__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.notes__follow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}

.notes__hint {
  font-size: 12px;
}

.detail__assignee {
  display: grid;
  gap: 6px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-2);
}

/* 取消預約與主動作隔開一段，並用分隔線宣告它是另一類動作，減少誤觸。 */
.detail__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 16px 6px;
  border-top: 1px solid var(--line);
}

.detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.detail__title {
  font-size: 22px;
}

.detail__when {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-color-primary);
}

.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}

.detail__pre {
  white-space: pre-wrap;
}

.notes {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.notes__item {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.notes__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.notes__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-bottom: 2px;
  font-size: 12px;
}

.notes__time {
  color: var(--ink-3);
}

.notes__author {
  color: var(--ink-2);
}

.reschedule,
.reschedule-request {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.reschedule-request {
  padding: 12px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: var(--radius);
  background: var(--el-color-warning-light-9);
}

.reschedule__title,
.reschedule-request__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.reschedule-request__title .num {
  font-weight: 400;
  color: var(--ink-3);
}

.reschedule-request__slots {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
}

.reschedule-request__slots strong {
  color: var(--ink);
}

.reschedule-request__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reschedule-request__actions .el-button + .el-button {
  margin-left: 0;
}

.notes__form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.detail__side {
  position: sticky;
  top: calc(var(--top-h) + 16px);
}

.detail__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail__cancel {
  margin-right: -8px;
}

@media (max-width: 900px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__side {
    position: static;
    order: -1;
  }
}
</style>
