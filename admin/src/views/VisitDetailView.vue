<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import type { VisitContactNoteOut, VisitRequestDetailOut, VisitSlotOut } from '../api/types'
import { campusLabel, formatDateTime, formatHoldRemaining, formatSlotWhen, holdIsUrgent, visitStatus, referralSourceLabels, staffLabel, visitSourceLabel } from '../api/labels'
import { useOpenRequestsStore } from '../stores/openRequests'
import { useAuthStore } from '../stores/auth'
import { useVisitStaff } from '../composables/useVisitStaff'
import StatusTag from '../components/StatusTag.vue'

const route = useRoute()
const openRequests = useOpenRequestsStore()
const router = useRouter()
const id = computed(() => route.params.id as string)

const detail = ref<VisitRequestDetailOut | null>(null)
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
const selectedSlotId = ref('')
const newNote = ref('')
// 「下次聯絡」跟著這一筆紀錄一起送；家長說「下週再打」時才有地方記，
// 總覽的「到期待追蹤」也才會有來源。
const followUpAt = ref<string | null>(null)
const noteInput = ref<{ focus: () => void } | null>(null)
// 同校還在「待處理」的其他案件，讓櫃台早上能一筆接一筆處理，不必每次回列表。
const nextPending = ref<{ id: string; count: number } | null>(null)
const busy = ref(false)
const loading = ref(true)
const authStore = useAuthStore()
const canManage = computed(() => authStore.user?.role === 'super_admin' || authStore.user?.role === 'campus_admin')
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
    detail.value = await api.patch<VisitRequestDetailOut>(`/admin/visit-requests/${id.value}/assignee`, {
      assigned_staff_id: staffId || null,
    })
    ElMessage.success(staffId ? `已指派給 ${staffLabel(staffId, staff.value)}` : '已取消指派')
  } catch (err) {
    reportError(err, '指派失敗')
  } finally {
    assigning.value = false
  }
}
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    detail.value = await api.get<VisitRequestDetailOut>(`/admin/visit-requests/${id.value}`)
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id.value}/contact-notes`)
    void loadNextPending(detail.value.campus_key)
    if (detail.value.status === 'new') {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      availableSlots.value = await api.get<VisitSlotOut[]>(
        `/admin/slots?campus_key=${detail.value.campus_key}&date_from=${today}&date_to=${future}`,
      )
    }
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
  } finally {
    loading.value = false
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
  if (err instanceof ApiError) {
    const d = err.detail as { message?: string } | string
    ElMessage.error(typeof d === 'object' ? (d.message ?? fallback) : d)
  } else {
    ElMessage.error(fallback)
  }
}

const openSlots = computed(() => availableSlots.value.filter((s) => !s.closed && s.booked_count < s.capacity))

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
    await load()
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
  try {
    await ElMessageBox.confirm('取消後家長需要重新送出需求才能再預約。', '取消這筆預約？', {
      confirmButtonText: '取消預約',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/cancel`)
    ElMessage.success('已取消')
    openRequests.refresh(true)
    await load()
  } catch (err) {
    reportError(err, '取消失敗')
  } finally {
    busy.value = false
  }
}

async function markNoShow() {
  try {
    await ElMessageBox.confirm('標記後這筆案件會結案，並釋出時段名額。', '標記為未到場？', {
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
    await load()
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    busy.value = false
  }
}

// 參觀日當天或之後才出現「完成參觀」：還沒到的預約按完成沒有意義。
const visitDayReached = computed(() => {
  const day = detail.value?.slot?.slot_date
  if (!day) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  return day <= today
})

async function markCompleted() {
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id.value}/complete`)
    ElMessage.success('已標記完成參觀')
    await load()
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
    })
    newNote.value = ''
    followUpAt.value = null
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id.value}/contact-notes`)
    if (hadFollowUp) {
      // 追蹤時間存在案件上，不在紀錄裡；重讀一次頁首才會顯示新的日期。
      detail.value = await api.get<VisitRequestDetailOut>(`/admin/visit-requests/${id.value}`)
      ElMessage.success('已記下，到時會出現在總覽的「到期待追蹤」')
    }
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
  load()
})
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
              <el-descriptions-item label="得知管道">{{ referralSourceLabels(detail.referral_sources) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.age" label="家長填的年齡">{{ detail.age }}</el-descriptions-item>
              <el-descriptions-item label="接電話時段">{{ detail.preferred_time || '—' }}</el-descriptions-item>
              <el-descriptions-item label="想了解的事">
                <span class="detail__pre">{{ detail.questions || '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.confirmed_at" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <section class="section">
            <div class="section__title"><h2>聯絡紀錄</h2></div>
            <ol class="notes" v-if="notes.length > 0">
              <li v-for="n in notes" :key="n.id" class="notes__item">
                <time class="notes__time num">{{ formatDateTime(n.created_at) }}</time>
                <p class="detail__pre">{{ n.note }}</p>
              </li>
            </ol>
            <p v-else class="hint">還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。</p>
            <div class="notes__form">
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
        </div>

        <aside class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <template v-if="detail.status === 'new'">
                <p class="hint">與家長確認時間後，選一個時段排入，預約才算成立。</p>
                <el-select v-model="selectedSlotId" placeholder="選擇參觀時段" :disabled="openSlots.length === 0" style="width: 100%">
                  <el-option v-for="slot in openSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                </el-select>
                <p v-if="openSlots.length === 0" class="hint">
                  未來 60 天沒有可用時段。先到 <router-link to="/slots">時段與容量</router-link> 新增。
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
              </template>

              <template v-else-if="detail.status === 'confirmed'">
                <p class="hint">{{ visitDayReached ? '家長來參觀後標記完成；沒有出現請標記未到場。' : '參觀日當天起可以標記完成或未到場。' }}</p>
                <el-button v-if="visitDayReached" type="primary" :loading="busy" style="width: 100%" @click="markCompleted">完成參觀</el-button>
                <el-button :loading="busy" style="width: 100%; margin-left: 0" @click="markNoShow">標記未到場</el-button>
              </template>

              <p v-else class="hint">這筆案件已結案，沒有可執行的動作。</p>
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
              v-if="detail.status === 'new' || detail.status === 'pending_confirmation' || detail.status === 'confirmed'"
              class="detail__danger"
            >
              <span class="hint">家長不來了？</span>
              <el-button text type="danger" :loading="busy" class="detail__cancel" @click="cancel">取消預約</el-button>
            </div>
          </div>
        </aside>
      </div>
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

.notes__time {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  color: var(--ink-3);
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
