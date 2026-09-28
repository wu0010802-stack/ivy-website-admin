<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import type { BookingConfigOut, VisitSlotOut } from '../api/types'
import { attentionListPath, BOOKING_MODE_LABELS, campusLabel, formatDate, formatSlotWhen, formatTime, formatWeekday, slotClosedLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useRequestSequence } from '../composables/useRequestSequence'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import { usePermissions } from '../composables/usePermissions'
import { useAuthStore } from '../stores/auth'
import { canOpenPath } from '../router/nav'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { visibleCampusKeys, selected: selectedCampus } = useCampusScope()
const { can } = usePermissions()
// 櫃台看得到時段與名額（排入案件要用），但新增、調整名額、關閉與每週規則
// 限校區管理者以上（booking.manage）。
const canManage = computed(() => can('booking.manage'))

// 其他頁連過來會帶 ?campus=…（例如預約方式頁的「管理此校日期與場次」）：直接
// 落在那一校，不是預設的第一校。切校時寫回網址，重新整理或上一頁都還在同一校。
const campusFromQuery = (value: unknown): string => (typeof value === 'string' && visibleCampusKeys.value.includes(value) ? value : '')
const initialCampus = campusFromQuery(route.query.campus)
if (initialCampus) selectedCampus.value = initialCampus

function isoDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000))
}

const dateFrom = ref(isoDate())
const dateTo = ref(isoDate(30))
const slots = ref<VisitSlotOut[]>([])
// loading＝換校或換日期後第一次讀（顯示骨架）；refreshing＝背景重讀，舊的列留在
// 畫面上，只讓「重新整理」轉圈，頁面高度與捲動位置不跳。
const loading = ref(false)
const refreshing = ref(false)
const error = ref<string | null>(null)
// 正在儲存的時段：只停用那一列，其他場次照常可以調整。
const busyIds = ref<string[]>([])
const anyBusy = computed(() => busyIds.value.length > 0)
const isBusy = (id: string) => busyIds.value.includes(id)
// 儲存失敗時名額框可能還停在剛按的數字（值沒變就不會重畫）：遞增這個數字讓它
// 重新顯示實際名額。
const capacityResets = ref(0)
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

async function load(options: { background?: boolean } = {}) {
  const request = requests.begin()
  error.value = null
  if (!selectedCampus.value || rangeInvalid.value) {
    slots.value = []
    loading.value = false
    refreshing.value = false
    return
  }
  if (options.background) {
    refreshing.value = true
  } else {
    slots.value = []
    loading.value = true
  }
  try {
    const result = await api.get<VisitSlotOut[]>(
      `/admin/slots?campus_key=${selectedCampus.value}&date_from=${dateFrom.value}&date_to=${dateTo.value}`,
    )
    if (requests.isCurrent(request)) slots.value = result
  } catch (err) {
    if (requests.isCurrent(request)) error.value = errorText(err, '無法讀取參觀時段，請重新載入。')
  } finally {
    if (requests.isCurrent(request)) {
      loading.value = false
      refreshing.value = false
    }
  }
}

watch([selectedCampus, dateFrom, dateTo], () => load(), { immediate: true })
const reload = () => load({ background: true })

// 切校前先問面板裡有沒有沒存的每週規則，拒絕就留在原校。
const schedulePanel = ref<InstanceType<typeof VisitSchedulePanel> | null>(null)
const switchingCampus = ref(false)
function syncCampusQuery() {
  const key = selectedCampus.value
  if (!key || route.query.campus === key) return
  void router.replace({ query: { ...route.query, campus: key } })
}
async function switchCampus(next: string) {
  if (!next || next === selectedCampus.value || switchingCampus.value) return
  switchingCampus.value = true
  try {
    if (!schedulePanel.value || (await schedulePanel.value.confirmLeave())) selectedCampus.value = next
  } finally {
    switchingCampus.value = false
    syncCampusQuery()
  }
}
watch(selectedCampus, syncCampusQuery)
watch(() => route.query.campus, (value) => {
  const key = campusFromQuery(value)
  if (key && key !== selectedCampus.value) void switchCampus(key)
})

// 這一校官網用哪一種預約方式：只有「時段預約」會讓家長看到這些場次，其他方式
// 的場次只供園方確認參觀時排入案件。讀不到就不提示，時段照常可以管理。
const bookingConfig = ref<BookingConfigOut | null>(null)
const configRequests = useRequestSequence()
async function loadBookingConfig() {
  const request = configRequests.begin()
  bookingConfig.value = null
  const campus = selectedCampus.value
  if (!campus) return
  try {
    const result = await api.get<BookingConfigOut>(`/admin/booking-config/${campus}`)
    if (configRequests.isCurrent(request) && result && typeof result === 'object' && typeof result.mode === 'string') bookingConfig.value = result
  } catch {
    // 只是提示，讀不到不影響時段清單。
  }
}
watch(selectedCampus, loadBookingConfig, { immediate: true })

const modeNotice = computed(() => {
  const config = bookingConfig.value
  if (!config || config.mode === 'slots') return ''
  const campus = `${campusLabel(config.campus_key || selectedCampus.value)}校`
  if (config.mode === 'paused') return `${campus}目前暫停預約，家長在官網看不到這些場次。`
  return `${campus}目前的預約方式是「${BOOKING_MODE_LABELS[config.mode] ?? config.mode}」，家長在官網看不到這些場次；這裡的場次供園方確認參觀時排入案件。`
})
const slotsModeNote = computed(() => {
  const config = bookingConfig.value
  if (!config || config.mode !== 'slots') return ''
  return config.slots_auto_confirm
    ? '家長在官網自選這些場次，送出即預約成立。'
    : '家長在官網自選這些場次，送出後暫留名額，由園方在 24 小時內確認才算預約成立。'
})
// 各校預約方式只開給校區管理者以上；櫃台點了會被導回首頁，只給文字說明。
const bookingSettingsPath = computed(() => `/booking?campus=${encodeURIComponent(selectedCampus.value)}`)
const canOpenBookingSettings = computed(() => canOpenPath('/booking', authStore.user))

const createValid = computed(
  () => Boolean(createForm.value.slot_date && createForm.value.start_time && createForm.value.end_time) && createForm.value.start_time < createForm.value.end_time && createForm.value.capacity >= 1 && createForm.value.capacity <= 200,
)

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h! * 60 + m!
}
function fromMinutes(total: number): string {
  const clamped = Math.min(Math.max(total, 0), 23 * 60 + 59)
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}:00`
}

// 剛建立的那一場在清單上標幾秒，一眼找得到，不會以為沒建成又建一次。
const justCreated = ref<{ date: string; start: string } | null>(null)
let justCreatedTimer: ReturnType<typeof setTimeout> | undefined
function markJustCreated(date: string, start: string) {
  if (justCreatedTimer !== undefined) clearTimeout(justCreatedTimer)
  justCreated.value = { date, start }
  justCreatedTimer = setTimeout(() => { justCreated.value = null; justCreatedTimer = undefined }, 6000)
}
function isJustCreated(slot: VisitSlotOut): boolean {
  return justCreated.value !== null && justCreated.value.date === slot.slot_date && justCreated.value.start === slot.start_time
}
watch(selectedCampus, () => { justCreated.value = null })
onBeforeUnmount(() => { if (justCreatedTimer !== undefined) clearTimeout(justCreatedTimer) })

// andNext：同一天臨時加開好幾場時，建立後不關對話框，開始時間接上一場的結束、
// 時長不變，只要再按一次。
async function submitCreate(andNext = false) {
  if (!createValid.value || creating.value || !selectedCampus.value) return
  creating.value = true
  const created = { ...createForm.value }
  try {
    await api.post(`/admin/slots?campus_key=${selectedCampus.value}`, created)
    markJustCreated(created.slot_date, created.start_time)
    const when = `${formatDate(created.slot_date)}（${formatWeekday(created.slot_date)}）${formatTime(created.start_time)}–${formatTime(created.end_time)}`
    // 建在清單範圍外的日期時把範圍放寬，新的一場才看得到，不會以為沒建成又建一次。
    const outside = created.slot_date < dateFrom.value || created.slot_date > dateTo.value
    if (created.slot_date > dateTo.value) dateTo.value = created.slot_date
    if (created.slot_date < dateFrom.value) dateFrom.value = created.slot_date
    ElMessage.success(`已建立 ${when} 的時段${outside ? '，清單的日期範圍已放寬到這一天' : ''}`)
    if (andNext) {
      const duration = toMinutes(created.end_time) - toMinutes(created.start_time)
      createForm.value.start_time = created.end_time
      createForm.value.end_time = fromMinutes(toMinutes(created.end_time) + duration)
    } else {
      createDialogVisible.value = false
    }
    if (!outside) await reload()
  } catch (err) {
    ElMessage.error(errorText(err, '建立失敗，請確認日期與時間'))
  } finally {
    creating.value = false
  }
}

function isSlotOf(value: unknown, id: string): value is VisitSlotOut {
  return Boolean(value) && typeof value === 'object' && (value as VisitSlotOut).id === id && typeof (value as VisitSlotOut).capacity === 'number'
}
// PATCH 會回傳更新後的時段：只換掉那一列，不重讀整張清單。背景重讀剛好在路上
// 時，它的回應是改之前讀的，會把這一列蓋回舊名額：改成再讀一次最新的。
function replaceSlot(updated: VisitSlotOut) {
  const index = slots.value.findIndex(slot => slot.id === updated.id)
  if (index >= 0) slots.value.splice(index, 1, updated)
  if (refreshing.value) void reload()
}
function markBusy(id: string) { busyIds.value = [...busyIds.value, id] }
function clearBusy(id: string) { busyIds.value = busyIds.value.filter(item => item !== id) }

async function updateCapacity(slot: VisitSlotOut, capacity: number, successText = '') {
  if (!canManage.value || isBusy(slot.id) || loading.value || !Number.isInteger(capacity) || capacity === slot.capacity) return
  markBusy(slot.id)
  try {
    const updated = await api.patch<VisitSlotOut>(`/admin/slots/${slot.id}`, { capacity, expected_version: slot.version })
    ElMessage.success(successText || `已儲存：${formatDate(slot.slot_date)} ${formatTime(slot.start_time)} 名額 ${capacity} 組`)
    if (isSlotOf(updated, slot.id)) replaceSlot(updated)
    else await reload()
  } catch (err) {
    capacityResets.value++
    if (isVersionConflict(err)) {
      // 別人剛改過這個時段（或休假日剛把它關掉）：不蓋掉，重新讀最新的。
      ElMessage.warning(SLOT_CONFLICT_RELOADED)
    } else if (err instanceof ApiError && err.status === 409) {
      const detail = err.detail as { message?: string; booked_count?: number }
      ElMessage.error(
        detail !== null && typeof detail === 'object' && detail.booked_count !== undefined
          ? `名額不能低於已占用的 ${detail.booked_count} 組（含待確認、已確認、已完成與未到場）`
          : '名額不能低於目前已占用的組數',
      )
    } else {
      ElMessage.error('更新失敗，正在重新讀取目前名額。')
    }
    await reload()
  } finally { clearBusy(slot.id) }
}

// 關閉＝這一場不接待：已排入的家長會列入「待人工處理」，要聯絡改期或取消。
// 園方常常只是不想再收人、已排入的照常來（規格 L227 關閉時段停止新申請），
// 這時把名額調成已占用的組數就好，案件不會被列成要改期。還有人排入時用
// 三個明確的選項問，不用「取消鈕其實會改名額」的確認框。
const closeTarget = ref<VisitSlotOut | null>(null)
const closeDialogOpen = ref(false)
const closeTargetFull = computed(() => Boolean(closeTarget.value && closeTarget.value.capacity === closeTarget.value.booked_count))

async function toggleClosed(slot: VisitSlotOut) {
  if (!canManage.value || isBusy(slot.id) || loading.value) return
  const closing = !slot.closed
  if (closing && slot.booked_count > 0) {
    closeTarget.value = slot
    closeDialogOpen.value = true
    return
  }
  await setClosed(slot, closing)
}

async function chooseStopNew() {
  const slot = closeTarget.value
  closeDialogOpen.value = false
  if (!slot || closeTargetFull.value) return
  await updateCapacity(slot, slot.booked_count, `已停止新預約：名額改為已占用的 ${slot.booked_count} 組，已排入的家長照常參觀`)
}

async function chooseClose() {
  const slot = closeTarget.value
  closeDialogOpen.value = false
  if (slot) await setClosed(slot, true)
}

async function setClosed(slot: VisitSlotOut, closing: boolean) {
  if (isBusy(slot.id)) return
  markBusy(slot.id)
  const when = `${formatDate(slot.slot_date)} ${formatTime(slot.start_time)}`
  try {
    const updated = await api.patch<VisitSlotOut>(`/admin/slots/${slot.id}`, { closed: closing, expected_version: slot.version })
    if (closing && slot.booked_count > 0) {
      attentionNotice.value = { campus: slot.campus_key, when, count: slot.booked_count }
      ElMessage.success(`已關閉 ${when} 這一場，請聯絡已排入的家長改期或取消`)
    } else {
      ElMessage.success(closing ? `已關閉 ${when} 這一場，家長不能再預約` : `已重新開放 ${when} 這一場，家長可以預約`)
    }
    if (isSlotOf(updated, slot.id)) replaceSlot(updated)
    else await reload()
  } catch (err) {
    if (isVersionConflict(err)) {
      ElMessage.warning(SLOT_CONFLICT_RELOADED)
      await reload()
    } else {
      ElMessage.error(errorText(err, '更新失敗'))
    }
  } finally { clearBusy(slot.id) }
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
  return [isPast(row) ? 'is-past' : '', isJustCreated(row) ? 'is-new' : ''].filter(Boolean).join(' ')
}

// 還能收幾組：櫃台最常查的數字，已結束、已關閉或額滿的不寫。
function seatsLeft(slot: VisitSlotOut): number {
  return slot.closed || isPast(slot) ? 0 : Math.max(slot.capacity - slot.booked_count, 0)
}

function fillRatio(slot: VisitSlotOut): number {
  return slot.capacity === 0 ? 1 : Math.min(1, slot.booked_count / slot.capacity)
}

function capacityLabel(slot: VisitSlotOut): string {
  return `${formatDate(slot.slot_date)} ${formatTime(slot.start_time)} 接待名額${canManage.value ? '，調整後立即儲存' : ''}`
}

function openCreate() {
  if (!canManage.value || anyBusy.value || loading.value || creating.value) return
  createForm.value.slot_date = dateFrom.value >= isoDate() ? dateFrom.value : isoDate(1)
  createDialogVisible.value = true
}
</script>

<template>
  <div class="page">
    <PageHeader lead="每一場參觀的時段與名額（以組家庭計）。已確認的案件會占用名額。關閉時段代表這一場不接待，已排入的家長要聯絡改期；只想停止新預約，把名額調成已占用的組數。">
      <template v-if="canManage" #actions>
        <el-button type="primary" :icon="Plus" :disabled="!selectedCampus || anyBusy || loading || creating" @click="openCreate">新增時段</el-button>
      </template>
    </PageHeader>
    <p v-if="!canManage" class="hint slots-readonly">你的帳號可以查看時段與名額；新增時段、調整名額或關閉由校區管理者處理。</p>

    <!-- 校區管整頁（規則與清單）；日期只篩下面的時段清單，放在清單正上方。 -->
    <div class="toolbar filter-bar slots-scope">
      <label class="filter-field"><span>校區</span><CampusSelect :model-value="selectedCampus" :keys="visibleCampusKeys" :disabled="anyBusy || creating || createDialogVisible || switchingCampus" @update:model-value="switchCampus" /></label>
      <p v-if="!modeNotice && slotsModeNote" class="hint slots-mode-note">{{ slotsModeNote }}</p>
    </div>

    <el-alert v-if="modeNotice" type="info" show-icon :closable="false" class="slots-mode" :title="modeNotice">
      <router-link v-if="canOpenBookingSettings" :to="bookingSettingsPath">到各校預約方式查看或切換 →</router-link>
      <span v-else>要讓家長在官網自選場次，請聯絡校區管理者到「各校預約方式」切換。</span>
    </el-alert>

    <VisitSchedulePanel v-if="selectedCampus" ref="schedulePanel" :campus-key="selectedCampus" :can-manage="canManage" @slots-changed="reload" />

    <el-alert v-if="attentionNotice" type="warning" show-icon class="slots-attention" title="關閉的時段還有家長排入" @close="attentionNotice = null">
      <p>{{ attentionNotice.when }} 已關閉，還有 {{ attentionNotice.count }} 組占用名額。已確認或待確認的家長請聯絡改期到其他場次，或取消預約。</p>
      <router-link :to="attentionListPath(attentionNotice.campus)">查看待人工處理的案件 →</router-link>
    </el-alert>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可管理的校區" />

    <template v-else>
    <div class="toolbar filter-bar slots-period">
      <label class="filter-field"><span>開始日期</span><el-date-picker v-model="dateFrom" :disabled="anyBusy || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="起始日期" /></label>
      <label class="filter-field"><span>結束日期</span><el-date-picker v-model="dateTo" :disabled="anyBusy || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="結束日期" /></label>
    </div>
    <el-alert v-if="rangeInvalid" title="結束日期需與開始日期相同或更晚。" type="warning" :closable="false" show-icon />
    <template v-else>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="inline-error"><el-button :loading="refreshing" @click="reload">重新載入</el-button></el-alert>
    <template v-if="!error || slots.length">
    <div class="list-summary"><span>{{ campusLabel(selectedCampus) }}校 · {{ loading ? '讀取中…' : `期間內 ${slots.length} 場，${availableSlots} 場仍有名額` }}</span><el-button text :loading="refreshing" :disabled="loading" @click="reload">重新整理</el-button></div>
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
        <el-table-column min-width="320">
          <template #header>已占用 / 名額（組）<span v-if="canManage" class="col-note">名額調整後立即儲存</span></template>
          <template #default="{ row }: { row: VisitSlotOut }">
            <div class="cap">
              <span class="cap__count num">{{ row.booked_count }}</span>
              <span class="muted">/</span>
              <el-input-number
                :key="`${row.id}-${capacityResets}`"
                :model-value="row.capacity"
                :min="row.booked_count"
                :max="200"
                controls-position="right"
                :aria-label="capacityLabel(row)"
                :disabled="!canManage || isBusy(row.id) || isPast(row)"
                @change="(v: number | undefined) => v !== undefined && updateCapacity(row, v)"
              />
              <span class="cap__bar" aria-hidden="true">
                <span class="cap__fill" :class="{ 'is-full': fillRatio(row) >= 1 }" :style="{ width: `${fillRatio(row) * 100}%` }" />
              </span>
              <span v-if="seatsLeft(row)" class="cap__left">剩 <b class="num">{{ seatsLeft(row) }}</b> 組</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="狀態" width="110">
          <template #default="{ row }: { row: VisitSlotOut }">
            <el-tag :type="slotState(row).tone" size="small" round>{{ slotState(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="right">
          <template #default="{ row }: { row: VisitSlotOut }">
            <el-button v-if="canManage && !isPast(row)" text :loading="isBusy(row.id)" :disabled="isBusy(row.id)" @click="toggleClosed(row)">
              {{ row.closed ? '重新開放' : '關閉' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="slot-days mobile-records">
        <section v-for="day in days" :key="day.date" class="slot-day" :aria-labelledby="`day-${day.date}`">
          <h2 :id="`day-${day.date}`" class="slot-day__date num">{{ formatDate(day.date) }}（{{ formatWeekday(day.date) }}）<span v-if="day.date === todayIso" class="today-mark">今天</span></h2>
          <ul class="slot-day__list">
            <li v-for="slot in day.slots" :key="slot.id" class="slot-row" :class="{ 'is-past': isPast(slot), 'is-new': isJustCreated(slot) }">
              <div class="slot-row__head">
                <strong class="slot-time num">{{ formatTime(slot.start_time) }}–{{ formatTime(slot.end_time) }}</strong>
                <el-tag :type="slotState(slot).tone" size="small" round>{{ slotState(slot).label }}</el-tag>
              </div>
              <div class="slot-row__body">
                <span class="slot-row__booked">已占用 <b class="num">{{ slot.booked_count }}</b> 組</span>
                <label class="slot-row__cap"><span>名額</span><el-input-number :key="`${slot.id}-${capacityResets}`" :model-value="slot.capacity" :min="slot.booked_count" :max="200" :disabled="!canManage || isBusy(slot.id) || isPast(slot)" :aria-label="capacityLabel(slot)" @change="(v: number | undefined) => v !== undefined && updateCapacity(slot, v)" /><span>組</span></label>
                <el-button v-if="canManage && !isPast(slot)" :loading="isBusy(slot.id)" :disabled="isBusy(slot.id)" @click="toggleClosed(slot)">{{ slot.closed ? '重新開放' : '關閉' }}</el-button>
              </div>
            </li>
          </ul>
        </section>
        <p v-if="canManage" class="hint slot-days__note">名額調整後立即儲存。</p>
      </div>
      </template>
    </div>
    </template>
    </template>
    </template>

    <el-dialog v-model="closeDialogOpen" :title="closeTarget ? `關閉 ${formatSlotWhen(closeTarget)} 這一場？` : '關閉時段？'" width="520px" class="close-slot-dialog">
      <template v-if="closeTarget">
        <p class="close-slot__lead">這一場已有 <b class="num">{{ closeTarget.booked_count }}</b> 組家庭占用名額。</p>
        <ul class="close-slot__choices">
          <li v-if="!closeTargetFull"><strong>只停止新預約</strong>：名額改成 {{ closeTarget.booked_count }} 組，已排入的家長照常參觀，不再接受新的預約。</li>
          <li v-else>名額已經等於已占用的組數，不會再接受新預約；已排入的家長照常參觀。</li>
          <li><strong>關閉這一場</strong>：這一場不接待。既有案件不會自動取消，會列入參觀案件的「待人工處理」，請聯絡家長改期或取消。</li>
        </ul>
      </template>
      <template #footer>
        <div class="close-slot__actions">
          <el-button @click="closeDialogOpen = false">先不要</el-button>
          <el-button type="danger" plain @click="chooseClose">關閉這一場</el-button>
          <el-button v-if="closeTarget && !closeTargetFull" type="primary" @click="chooseStopNew">只停止新預約（名額改為 {{ closeTarget.booked_count }} 組）</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="createDialogVisible" :title="`新增${campusLabel(selectedCampus)}校參觀時段`" width="440px" :close-on-click-modal="!creating" :close-on-press-escape="!creating" :show-close="!creating">
      <el-form label-position="top" :disabled="creating" @submit.prevent="submitCreate()">
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
        <el-button :loading="creating" :disabled="!createValid" @click="submitCreate(true)">建立並新增下一場</el-button>
        <el-button type="primary" :loading="creating" :disabled="!createValid" @click="submitCreate()">建立</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.slots-readonly { margin: -8px 0 16px; }
.slots-attention { margin-bottom: 16px; }
.slots-attention p { margin: 0 0 4px; }
.slots-mode { margin-bottom: 16px; }
/* 目前的預約方式說明放在校區旁：看得出這一校的場次家長怎麼約。 */
.slots-mode-note { flex: 1 1 280px; min-width: 0; margin: 0; padding-bottom: 8px; }
/* 淺藍底上的藍字用深一階的操作色：--el-color-primary 在 light-9 底只有 4.4:1。 */
.today-mark { display:inline-block; margin-left:6px; padding:0 8px; border-radius:999px; background:var(--el-color-primary-light-9); color:var(--admin-accent-hover); font-size:12px; font-weight:600; line-height:20px; vertical-align:1px; }
.col-note { display:block; font-size:12px; font-weight:400; color:var(--ink-3); }
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
  width: 112px;
}

.cap__bar {
  flex: 1;
  max-width: 120px;
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

.cap__left {
  color: var(--ink-2);
  font-size: 13px;
  white-space: nowrap;
}

/* 剛建立的那一場：淺藍底標幾秒。 */
.slots-table :deep(tr.is-new td:not(.slots-table__date)),
.slot-row.is-new {
  background: var(--el-color-primary-light-9);
  transition: background-color 600ms var(--ease-out);
}

.close-slot__lead { margin-bottom: 8px; }
.close-slot__choices { margin: 0; padding-left: 20px; line-height: 1.6; color: var(--ink-2); }
.close-slot__choices li + li { margin-top: 6px; }
.close-slot__choices strong { color: var(--ink); }
.close-slot__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.close-slot__actions .el-button + .el-button { margin-left: 0; }

@media (max-width: 720px) {
  /* 手機上三個選項直向排，最常用的「只停止新預約」在最上面。 */
  .close-slot__actions { flex-direction: column-reverse; align-items: stretch; width: 100%; }
  .close-slot__actions .el-button { width: 100%; white-space: normal; height: auto; }
}
</style>
