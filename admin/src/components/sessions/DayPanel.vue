<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../../composables/notify'
import { api } from '../../api/client'
import { isVersionConflict, apiErrorMessage } from '../../api/errors'
import { formatDate, formatTime, formatWeekday, staffEmailById, staffLabelById, visitDisplay, visitDisplayStatus, visitSourceLabel, type StatusMeta } from '../../api/labels'
import type { VisitStaffOut } from '../../api/types'
import StatusTag from '../StatusTag.vue'
import { slotEnded, type CalendarSlot } from '../../utils/calendarChips'
import { sessionName } from '../../utils/sessions'

const props = defineProps<{ day: string; campusKey: string; slots: CalendarSlot[]; holiday: { id: string; reason: string | null } | null; canManage: boolean; staff: VisitStaffOut[] }>()
const emit = defineEmits<{ changed: [] }>()

const busyId = ref('')
const adding = ref(false)
// 加開送出中：連按或按 Enter 兩次不能建出兩場一樣的場次（後端另有重複場次的 409 SLOT_DUPLICATE）。
const addingBusy = ref(false)
const newSlot = ref({ start: '10:00', minutes: 60, capacity: 1 })
const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => { const t = 7 * 60 + i * 30; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })
const sorted = computed(() => [...props.slots].sort((a, b) => a.start_time.localeCompare(b.start_time)))
const bookedToday = computed(() => props.slots.reduce((sum, s) => sum + s.visits.filter(v => v.status === 'confirmed').length, 0))
const dayPast = computed(() => new Date(`${props.day}T23:59:59+08:00`).getTime() < Date.now())

// 狀態和案件列表、明細同一組詞：預約正常；場次開始後是「尚未確認到場」（暖黃）、
// 已到場、未到場。這裡已經按場次分好，不再重複寫「預約時間已過」。
function visitMeta(slot: CalendarSlot, status: string): StatusMeta {
  const shown = visitDisplay({ status, display_status: visitDisplayStatus(status, slot) })
  return { label: shown.sub || shown.label, tone: shown.tone }
}

function endTime(start: string, minutes: number) {
  const [h, m] = start.split(':').map(Number)
  const total = h! * 60 + m! + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`
}

async function patchSlot(slot: CalendarSlot, body: { closed?: boolean; capacity?: number }, success: string) {
  busyId.value = slot.id
  try {
    await api.patch(`/admin/slots/${slot.id}`, { ...body, expected_version: slot.version })
    ElMessage.success(success)
    emit('changed')
  } catch (err) {
    if (isVersionConflict(err)) { notifyWarning('這一場剛被其他人修改，已重新載入'); emit('changed') }
    else notifyError(apiErrorMessage(err, '更新失敗，請稍後再試'))
  } finally {
    busyId.value = ''
  }
}

function stop(slot: CalendarSlot) {
  const kept = slot.visits.filter(v => v.status === 'confirmed').length
  void patchSlot(slot, { closed: true }, kept ? `已停止申請，已約好的 ${kept} 組家長照常參觀` : '已停止申請')
}
function resume(slot: CalendarSlot) {
  void patchSlot(slot, { closed: false }, '已恢復開放')
}
function setCapacity(slot: CalendarSlot, capacity: number) {
  void patchSlot(slot, { capacity }, `名額改成 ${capacity} 組`)
}

async function setHoliday() {
  const warning = bookedToday.value ? `這天還有 ${bookedToday.value} 組家長預約，設為休假後不會自動取消，請逐筆改期或取消（會寄信通知家長）。` : '這天所有場次都會停止申請。'
  let reason = ''
  try {
    const answer = await ElMessageBox.prompt(`${warning}\n休假原因（選填）：`, `${formatDate(props.day)} 整天休假？`, { confirmButtonText: '設為休假', cancelButtonText: '先不要', inputPlaceholder: '例如：教師研習' })
    reason = (answer as { value?: string }).value?.trim() ?? ''
  } catch { return }
  try {
    await api.post(`/admin/visit-schedule/${props.campusKey}/exceptions`, { exception_date: props.day, reason: reason || null })
    ElMessage.success('已設為休假')
    emit('changed')
  } catch (err) {
    notifyError(apiErrorMessage(err, '設定休假失敗'))
  }
}

async function cancelHoliday() {
  if (!props.holiday) return
  try {
    await ElMessageBox.confirm('取消休假後，這天的固定場次會重新開放。', '取消休假？', { confirmButtonText: '取消休假', cancelButtonText: '先不要' })
  } catch { return }
  try {
    await api.delete(`/admin/visit-schedule/${props.campusKey}/exceptions/${props.holiday.id}`)
    ElMessage.success('已取消休假')
    emit('changed')
  } catch (err) {
    notifyError(apiErrorMessage(err, '取消休假失敗'))
  }
}

async function addSlot() {
  if (addingBusy.value) return
  addingBusy.value = true
  try {
    await api.post(`/admin/slots?campus_key=${encodeURIComponent(props.campusKey)}`, {
      slot_date: props.day,
      start_time: `${newSlot.value.start}:00`,
      end_time: endTime(newSlot.value.start, newSlot.value.minutes),
      capacity: newSlot.value.capacity,
    })
    ElMessage.success('已加開一場')
    adding.value = false
    emit('changed')
  } catch (err) {
    notifyError(apiErrorMessage(err, '加開失敗'))
  } finally {
    addingBusy.value = false
  }
}
</script>

<template>
  <section class="section day-panel" aria-labelledby="day-panel-title">
    <div class="section__title day-panel__head">
      <h2 id="day-panel-title">{{ formatDate(day) }}（{{ formatWeekday(day) }}）<span v-if="holiday" class="day-panel__holiday">休假：{{ holiday.reason || '未填原因' }}</span></h2>
      <template v-if="canManage && !dayPast">
        <el-button v-if="holiday" @click="cancelHoliday">取消休假</el-button>
        <el-button v-else @click="setHoliday">整天休假</el-button>
      </template>
    </div>
    <p v-if="!sorted.length && !holiday" class="hint">這天沒有場次。</p>
    <div v-for="slot in sorted" :key="slot.id" class="panel calendar__slot" :class="{ 'is-ended': slotEnded(slot) }">
      <div class="panel__head">
        <h3 class="num">{{ sessionName(slot.start_time) }}–{{ formatTime(slot.end_time) }}</h3>
        <span class="hint"><template v-if="slotEnded(slot)">已結束 · </template>{{ slot.closed ? (slot.closed_source === 'exception' ? '休假' : '已停止申請') : `已約 ${slot.booked_count}／${slot.capacity} 組` }}</span>
        <div v-if="canManage && !slotEnded(slot)" class="day-panel__actions">
          <el-select v-if="!slot.closed" :model-value="slot.capacity" size="small" class="day-panel__capacity" :aria-label="`${sessionName(slot.start_time)}名額`" :disabled="busyId === slot.id" @update:model-value="(n: number) => setCapacity(slot, n)">
            <el-option v-for="n in Array.from({ length: 10 }, (_, i) => i + 1).filter(n => n >= slot.booked_count)" :key="n" :label="`${n} 組`" :value="n" />
          </el-select>
          <el-button v-if="!slot.closed" size="small" :loading="busyId === slot.id" @click="stop(slot)">停止申請</el-button>
          <el-button v-else-if="slot.closed_source !== 'exception'" size="small" :loading="busyId === slot.id" @click="resume(slot)">恢復開放</el-button>
        </div>
      </div>
      <ul v-if="slot.visits.length" class="calendar__visits">
        <li v-for="v in slot.visits" :key="v.id">
          <router-link :to="`/visit-requests/${v.id}`" class="calendar__visit-name">{{ v.parent_name }}</router-link>
          <span class="muted calendar__visit-child">{{ v.child_name || '孩子姓名未填寫' }}<template v-if="v.party_size"> · {{ v.party_size }} 人參觀</template></span>
          <a class="num calendar__visit-phone" :href="`tel:${v.phone}`">{{ v.phone }}</a>
          <span class="muted calendar__visit-staff" :title="staffEmailById(v.assigned_staff_id, staff) || undefined">承辦：{{ staffLabelById(v.assigned_staff_id, staff) }}<template v-if="v.source !== 'web'"> · {{ visitSourceLabel(v.source) }}補登</template></span>
          <StatusTag :meta="visitMeta(slot, v.status)" size="small" />
        </li>
      </ul>
    </div>
    <template v-if="canManage && !dayPast && !holiday">
      <el-button v-if="!adding" text @click="adding = true">＋加開一場</el-button>
      <form v-else class="day-panel__add" @submit.prevent="addSlot">
        <el-select v-model="newSlot.start" aria-label="加開場次時間" :disabled="addingBusy"><el-option v-for="t in TIME_OPTIONS" :key="t" :label="t" :value="t" /></el-select>
        <el-select v-model="newSlot.capacity" aria-label="加開場次組數" :disabled="addingBusy"><el-option v-for="n in 10" :key="n" :label="`${n} 組`" :value="n" /></el-select>
        <el-button type="primary" native-type="submit" :loading="addingBusy" :disabled="addingBusy">加開</el-button>
        <el-button :disabled="addingBusy" @click="adding = false">取消</el-button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.day-panel__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.day-panel__holiday { margin-left: 8px; font-size: var(--text-base); color: var(--ink-3); }
.day-panel__actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
.day-panel__capacity { width: 88px; }
.day-panel__add { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
/* 點日期後捲到這裡，標題不要被黏在上方的頁首蓋住。 */
.day-panel h2 { scroll-margin-top: calc(var(--top-h) + 16px); }
.calendar__slot { margin-bottom: 12px; }
.calendar__slot h3 { font-size: var(--text-md); margin: 0; }
.calendar__visits { list-style: none; margin: 0; padding: 0; }
.calendar__visits li {
  display: grid;
  grid-template-columns: minmax(6em, 1fr) minmax(6em, 1fr) auto minmax(8em, 1.5fr) auto;
  gap: 4px 16px;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  font-size: var(--text-base);
}
.calendar__visit-name { font-weight: 600; }
.calendar__visits li > .el-tag { justify-self: start; }
.calendar__empty { padding: 0 16px 12px; }

/* 已結束的場次不整塊調淡（小字會掉到 4.5:1 以下，DESIGN.md 規則），只在標題旁寫「已結束」。 */

@media (max-width: 720px) {
  /* 每筆：家長＋狀態、可撥號的電話、灰字的孩子與承辦。 */
  .calendar__visits li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name status' 'phone phone' 'child child' 'staff staff'; gap: 0 12px; }
  /* 點家長進案件是這裡最主要的動作，觸控範圍跟電話一樣 44px。 */
  .calendar__visit-name { grid-area: name; display: inline-flex; align-items: center; min-height: 44px; justify-self: start; }
  .calendar__visits li > .el-tag { grid-area: status; justify-self: end; }
  .calendar__visit-phone { grid-area: phone; display: inline-flex; align-items: center; min-height: 44px; justify-self: start; }
  .calendar__visit-child { grid-area: child; }
  .calendar__visit-staff { grid-area: staff; }
}
</style>
