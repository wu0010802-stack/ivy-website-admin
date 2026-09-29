<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import type { VisitSlotOut } from '../api/types'
import { attentionListPath, campusLabel, formatDate, formatTime, formatWeekday, slotClosedLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useRequestSequence } from '../composables/useRequestSequence'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import { usePermissions } from '../composables/usePermissions'

const { visibleCampusKeys, selected: selectedCampus } = useCampusScope()
const { can } = usePermissions()
// 櫃台看得到時段與名額（排入案件要用），但新增、調整名額、關閉與每週規則
// 限校區管理者以上（booking.manage）。
const canManage = computed(() => can('booking.manage'))

function isoDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000))
}

const dateFrom = ref(isoDate())
const dateTo = ref(isoDate(30))
const slots = ref<VisitSlotOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const requests = useRequestSequence()
const rangeInvalid = computed(() => dateFrom.value > dateTo.value)
const availableSlots = computed(() => slots.value.filter(slot => !slot.closed && !isPast(slot) && slot.booked_count < slot.capacity).length)

// 關掉還有人排入的時段後，留一個連到「待人工處理」的提醒（換校就清掉）。
const attentionNotice = ref<{ campus: string; when: string; count: number } | null>(null)
watch(selectedCampus, () => { attentionNotice.value = null })

const createDialogVisible = ref(false)
const createForm = ref({ slot_date: isoDate(1), start_time: '10:00:00', end_time: '11:00:00', capacity: 5 })
const creating = ref(false)

const errorText = apiErrorMessage
// 版本衝突時畫面會自動重讀，所以用固定文案，不接後端「請重新載入後再調整」。
const SLOT_CONFLICT_RELOADED = '這個時段剛被其他人修改（或因休假日關閉），已載入最新的時段，請確認後再調整'

async function load() {
  const request = requests.begin()
  error.value = null
  slots.value = []
  if (!selectedCampus.value || rangeInvalid.value) { loading.value = false; return }
  loading.value = true
  try {
    const result = await api.get<VisitSlotOut[]>(
      `/admin/slots?campus_key=${selectedCampus.value}&date_from=${dateFrom.value}&date_to=${dateTo.value}`,
    )
    if (requests.isCurrent(request)) slots.value = result
  } catch (err) {
    if (requests.isCurrent(request)) error.value = errorText(err, '無法讀取參觀時段，請重新載入。')
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([selectedCampus, dateFrom, dateTo], load, { immediate: true })

const createValid = computed(
  () => Boolean(createForm.value.slot_date && createForm.value.start_time && createForm.value.end_time) && createForm.value.start_time < createForm.value.end_time && createForm.value.capacity >= 1 && createForm.value.capacity <= 200,
)

async function submitCreate() {
  if (!createValid.value || creating.value || !selectedCampus.value) return
  creating.value = true
  try {
    await api.post(`/admin/slots?campus_key=${selectedCampus.value}`, createForm.value)
    ElMessage.success('已建立時段')
    createDialogVisible.value = false
    await load()
  } catch (err) {
    ElMessage.error(errorText(err, '建立失敗，請確認日期與時間'))
  } finally {
    creating.value = false
  }
}

async function updateCapacity(slot: VisitSlotOut, capacity: number, successText = '已更新名額') {
  if (!canManage.value || busyId.value || loading.value || !Number.isInteger(capacity) || capacity === slot.capacity) return
  busyId.value = slot.id
  try {
    await api.patch(`/admin/slots/${slot.id}`, { capacity, expected_version: slot.version })
    ElMessage.success(successText)
    await load()
  } catch (err) {
    if (isVersionConflict(err)) {
      // 別人剛改過這個時段（或休假日剛把它關掉）：不蓋掉，重新讀最新的。
      ElMessage.warning(SLOT_CONFLICT_RELOADED)
      await load()
    } else if (err instanceof ApiError && err.status === 409) {
      const detail = err.detail as { message?: string; booked_count?: number }
      ElMessage.error(
        detail !== null && typeof detail === 'object' && detail.booked_count !== undefined
          ? `名額不能低於已占用的 ${detail.booked_count} 組（含待確認、已確認、已完成與未到場）`
          : '名額不能低於目前已占用的組數',
      )
      await load()
    } else {
      ElMessage.error('更新失敗，正在重新讀取目前名額。')
      await load()
    }
  } finally { busyId.value = null }
}

// 關閉＝這一場不接待：已排入的家長會列入「待人工處理」，要聯絡改期或取消。
// 園方常常只是不想再收人、已排入的照常來（規格 L227 關閉時段停止新申請），
// 這時把名額調成已占用的組數就好，案件不會被列成要改期。
async function toggleClosed(slot: VisitSlotOut) {
  if (!canManage.value || busyId.value || loading.value) return
  const closing = !slot.closed
  if (closing && slot.booked_count > 0) {
    try {
      await ElMessageBox.confirm(
        `這個時段已有 ${slot.booked_count} 組占用名額。已排入的家長照常來、只是不再接受新預約，請選「只停止新預約」，名額會改成 ${slot.booked_count} 組。這一場不能接待才選「關閉時段」：既有案件不會自動取消，會列入參觀案件的「待人工處理」，請聯絡家長改期或取消。`,
        '關閉時段？',
        { confirmButtonText: '關閉時段', cancelButtonText: '只停止新預約', distinguishCancelAndClose: true, type: 'warning' },
      )
    } catch (action) {
      if (action !== 'cancel') return
      if (slot.capacity === slot.booked_count) ElMessage.info('名額已經等於已占用的組數，不會再接受新預約')
      else await updateCapacity(slot, slot.booked_count, `已停止新預約：名額改為已占用的 ${slot.booked_count} 組，已排入的家長照常參觀`)
      return
    }
  }
  busyId.value = slot.id
  try {
    try {
      await api.patch(`/admin/slots/${slot.id}`, { closed: closing, expected_version: slot.version })
      if (closing && slot.booked_count > 0) {
        attentionNotice.value = { campus: slot.campus_key, when: `${formatDate(slot.slot_date)} ${formatTime(slot.start_time)}`, count: slot.booked_count }
      }
      await load()
    } catch (err) {
      if (isVersionConflict(err)) {
        ElMessage.warning(SLOT_CONFLICT_RELOADED)
        await load()
      } else {
        ElMessage.error(errorText(err, '更新失敗'))
      }
    }
  } finally { busyId.value = null }
}

// 預設從今天列起，今天早上的場次下午還在清單裡；已經結束的不能再預約，
// 不該跟其他場次一樣顯示「開放中」、也不必再調名額或關閉。
function isPast(slot: VisitSlotOut): boolean {
  return new Date(`${slot.slot_date}T${slot.end_time}+08:00`).getTime() <= Date.now()
}

type SlotState = { label: string; tone: 'info' | 'warning' | 'success' }
function slotState(slot: VisitSlotOut): SlotState {
  if (isPast(slot)) return { label: '已結束', tone: 'info' }
  if (slot.closed) return { label: slotClosedLabel(slot.closed_source), tone: 'info' }
  if (slot.booked_count >= slot.capacity) return { label: '已額滿', tone: 'warning' }
  return { label: '開放中', tone: 'success' }
}

// 同一天常有上午、下午兩場以上；日期只寫一次，一眼看出哪天排了幾場。
// 桌機表格合併日期儲存格，手機依日期分組。清單由後端依日期、時間排好。
const days = computed(() => {
  const out: { date: string; slots: VisitSlotOut[] }[] = []
  for (const slot of slots.value) {
    const last = out[out.length - 1]
    if (last && last.date === slot.slot_date) last.slots.push(slot)
    else out.push({ date: slot.slot_date, slots: [slot] })
  }
  return out
})
const todayIso = computed(() => isoDate())

function dateSpan({ row, rowIndex, columnIndex }: { row: VisitSlotOut; rowIndex: number; columnIndex: number }) {
  if (columnIndex !== 0) return undefined
  if (rowIndex > 0 && slots.value[rowIndex - 1]?.slot_date === row.slot_date) return { rowspan: 0, colspan: 0 }
  let span = 1
  while (slots.value[rowIndex + span]?.slot_date === row.slot_date) span += 1
  return { rowspan: span, colspan: 1 }
}

function rowClass({ row }: { row: VisitSlotOut }): string {
  return isPast(row) ? 'is-past' : ''
}

function fillRatio(slot: VisitSlotOut): number {
  return slot.capacity === 0 ? 1 : Math.min(1, slot.booked_count / slot.capacity)
}

function openCreate() {
  if (!canManage.value || busyId.value || loading.value || creating.value) return
  createForm.value.slot_date = dateFrom.value >= isoDate() ? dateFrom.value : isoDate(1)
  createDialogVisible.value = true
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長可預約的參觀時段與每場名額。已確認的案件會占用名額。關閉時段代表這一場不接待，已排入的家長要聯絡改期；只想停止新預約，把名額調成已占用的組數。">
      <template v-if="canManage" #actions>
        <el-button type="primary" :icon="Plus" :disabled="!selectedCampus || Boolean(busyId) || loading || creating" @click="openCreate">新增時段</el-button>
      </template>
    </PageHeader>
    <p v-if="!canManage" class="hint slots-readonly">你的帳號可以查看時段與名額；新增時段、調整名額或關閉由校區管理者處理。</p>

    <div class="toolbar filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="selectedCampus" :keys="visibleCampusKeys" :disabled="Boolean(busyId) || creating || createDialogVisible" /></label>
      <label class="filter-field"><span>開始日期</span><el-date-picker v-model="dateFrom" :disabled="Boolean(busyId) || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="起始日期" /></label>
      <label class="filter-field"><span>結束日期</span><el-date-picker v-model="dateTo" :disabled="Boolean(busyId) || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="結束日期" /></label>
    </div>

    <VisitSchedulePanel v-if="selectedCampus" :campus-key="selectedCampus" :can-manage="canManage" @slots-changed="load" />

    <el-alert v-if="attentionNotice" type="warning" show-icon class="slots-attention" title="關閉的時段還有家長排入" @close="attentionNotice = null">
      <p>{{ attentionNotice.when }} 已關閉，還有 {{ attentionNotice.count }} 組占用名額。已確認或待確認的家長請聯絡改期到其他場次，或取消預約。</p>
      <router-link :to="attentionListPath(attentionNotice.campus)">查看待人工處理的案件 →</router-link>
    </el-alert>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可管理的校區" />

    <el-alert v-else-if="rangeInvalid" title="結束日期需與開始日期相同或更晚。" type="warning" :closable="false" show-icon />
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon><el-button @click="load">重新載入</el-button></el-alert>
    <template v-else>
    <div class="list-summary"><span>{{ campusLabel(selectedCampus) }}校 · {{ loading ? '讀取中…' : `期間內 ${slots.length} 場，${availableSlots} 場仍有名額` }}</span><el-button text :loading="loading" :disabled="Boolean(busyId)" @click="load">重新整理</el-button></div>
    <div class="panel">
      <el-skeleton v-if="loading" animated :rows="4" class="list-skeleton" />
      <el-empty v-else-if="!slots.length" description="這段期間尚未安排參觀時段"><el-button v-if="canManage" type="primary" @click="openCreate">新增第一個時段</el-button></el-empty>
      <template v-else>
      <el-table class="data-table slots-table" :data="slots" :span-method="dateSpan" :row-class-name="rowClass">
        <el-table-column label="日期" width="170" class-name="slots-table__date">
          <template #default="{ row }: { row: VisitSlotOut }">
            <span class="num">{{ formatDate(row.slot_date) }}</span>
            <span class="muted">（{{ formatWeekday(row.slot_date) }}）</span>
            <span v-if="row.slot_date === todayIso" class="today-mark">今天</span>
          </template>
        </el-table-column>
        <el-table-column label="時間" width="130">
          <template #default="{ row }: { row: VisitSlotOut }">
            <span class="num">{{ formatTime(row.start_time) }}–{{ formatTime(row.end_time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="已占用 / 名額" min-width="220">
          <template #default="{ row }: { row: VisitSlotOut }">
            <div class="cap">
              <span class="cap__count num">{{ row.booked_count }}</span>
              <span class="muted">/</span>
              <el-input-number
                :model-value="row.capacity"
                :min="row.booked_count"
                :max="200"
                size="small"
                controls-position="right"
                aria-label="名額"
                :disabled="!canManage || Boolean(busyId) || isPast(row)"
                @change="(v: number | undefined) => v !== undefined && updateCapacity(row, v)"
              />
              <span class="cap__bar" aria-hidden="true">
                <span class="cap__fill" :class="{ 'is-full': fillRatio(row) >= 1 }" :style="{ width: `${fillRatio(row) * 100}%` }" />
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="狀態" width="100">
          <template #default="{ row }: { row: VisitSlotOut }">
            <el-tag :type="slotState(row).tone" size="small" round>{{ slotState(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="right">
          <template #default="{ row }: { row: VisitSlotOut }">
            <el-button v-if="canManage && !isPast(row)" size="small" text :loading="busyId === row.id" :disabled="Boolean(busyId)" @click="toggleClosed(row)">
              {{ row.closed ? '重新開放' : '關閉' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="slot-days mobile-records">
        <section v-for="day in days" :key="day.date" class="slot-day" :aria-labelledby="`day-${day.date}`">
          <h2 :id="`day-${day.date}`" class="slot-day__date num">{{ formatDate(day.date) }}（{{ formatWeekday(day.date) }}）<span v-if="day.date === todayIso" class="today-mark">今天</span></h2>
          <ul class="slot-day__list">
            <li v-for="slot in day.slots" :key="slot.id" class="slot-row" :class="{ 'is-past': isPast(slot) }">
              <div class="slot-row__head">
                <strong class="slot-time num">{{ formatTime(slot.start_time) }}–{{ formatTime(slot.end_time) }}</strong>
                <el-tag :type="slotState(slot).tone" size="small" round>{{ slotState(slot).label }}</el-tag>
              </div>
              <div class="slot-row__body">
                <span class="slot-row__booked">已占用 <b class="num">{{ slot.booked_count }}</b> 組</span>
                <label class="slot-row__cap"><span>名額</span><el-input-number :model-value="slot.capacity" :min="slot.booked_count" :max="200" :disabled="!canManage || Boolean(busyId) || isPast(slot)" :aria-label="`${formatDate(slot.slot_date)} ${formatTime(slot.start_time)} 接待名額，調整後立即儲存`" @change="(v: number | undefined) => v !== undefined && updateCapacity(slot, v)" /></label>
                <el-button v-if="canManage && !isPast(slot)" :loading="busyId === slot.id" :disabled="Boolean(busyId)" @click="toggleClosed(slot)">{{ slot.closed ? '重新開放' : '關閉' }}</el-button>
              </div>
            </li>
          </ul>
        </section>
        <p v-if="canManage" class="hint slot-days__note">名額調整後立即儲存。</p>
      </div>
      </template>
    </div>
    </template>

    <el-dialog v-model="createDialogVisible" :title="`新增${campusLabel(selectedCampus)}校參觀時段`" width="420px" :close-on-click-modal="!creating" :close-on-press-escape="!creating" :show-close="!creating">
      <el-form label-position="top" :disabled="creating" @submit.prevent="submitCreate">
        <el-form-item label="日期">
          <el-date-picker v-model="createForm.slot_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" :clearable="false" />
        </el-form-item>
        <div class="field-row">
          <el-form-item label="開始">
            <el-time-picker v-model="createForm.start_time" value-format="HH:mm:ss" format="HH:mm" style="width: 100%" :clearable="false" />
          </el-form-item>
          <el-form-item label="結束">
            <el-time-picker v-model="createForm.end_time" value-format="HH:mm:ss" format="HH:mm" style="width: 100%" :clearable="false" />
          </el-form-item>
        </div>
        <el-form-item label="名額（組家庭）">
          <el-input-number v-model="createForm.capacity" :min="1" :max="200" />
        </el-form-item>
        <p v-if="createForm.start_time >= createForm.end_time" class="hint" style="color: var(--el-color-danger)">結束時間要晚於開始時間。</p>
      </el-form>
      <template #footer>
        <el-button :disabled="creating" @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!createValid" @click="submitCreate">建立</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.slots-readonly { margin: -8px 0 16px; }
.slots-attention { margin-bottom: 16px; }
.slots-attention p { margin: 0 0 4px; }
.today-mark { display:inline-block; margin-left:6px; padding:0 8px; border-radius:999px; background:var(--el-color-primary-light-9); color:var(--el-color-primary); font-size:12px; font-weight:600; line-height:20px; vertical-align:1px; }
.slots-table :deep(td.slots-table__date) { vertical-align:top; background:var(--surface); }
.slots-table :deep(tr.is-past td:not(.slots-table__date)) { color:var(--ink-3); }
.slots-table :deep(tr.is-past .cap__count) { color:var(--ink-3); }
.slot-day + .slot-day { border-top:1px solid var(--line); }
.slot-day__date { padding:12px 16px; background:var(--surface-2); font-size:15px; }
.slot-day__list { list-style:none; margin:0; padding:0; }
.slot-row { padding:12px 16px; }
.slot-row + .slot-row { border-top:1px solid var(--line); }
.slot-row.is-past .slot-time, .slot-row.is-past .slot-row__booked { color:var(--ink-3); }
.slot-row__head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.slot-time { font-size:16px; color:var(--el-color-primary); }
.slot-row__body { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin-top:8px; }
.slot-row__booked { color:var(--ink-2); }
.slot-row__cap { display:inline-flex; align-items:center; gap:8px; color:var(--ink-2); }
.slot-row__cap .el-input-number { width:128px; }
.slot-row__body .el-button { margin-left:auto; }
.slot-days__note { padding:12px 16px; border-top:1px solid var(--line); }
.cap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap__count {
  min-width: 1.5em;
  text-align: right;
  font-weight: 600;
}

.cap .el-input-number {
  width: 96px;
}

.cap__bar {
  flex: 1;
  max-width: 96px;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.cap__fill {
  display: block;
  height: 100%;
  background: var(--el-color-primary-light-3);
  transition: width 200ms var(--ease-out);
}

.cap__fill.is-full {
  background: var(--el-color-warning);
}
</style>
