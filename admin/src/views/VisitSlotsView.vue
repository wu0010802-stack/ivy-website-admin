<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import type { VisitSlotOut } from '../api/types'
import { campusLabel, formatDate, formatTime, formatWeekday } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useRequestSequence } from '../composables/useRequestSequence'

const { visibleCampusKeys, selected: selectedCampus } = useCampusScope()

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
const availableSlots = computed(() => slots.value.filter(slot => !slot.closed && slot.booked_count < slot.capacity).length)

const createDialogVisible = ref(false)
const createForm = ref({ slot_date: isoDate(1), start_time: '10:00:00', end_time: '11:00:00', capacity: 5 })
const creating = ref(false)

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { message?: string } | string
    return detail !== null && typeof detail === 'object' ? (detail.message ?? fallback) : typeof detail === 'string' ? detail : fallback
  }
  return fallback
}

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

async function updateCapacity(slot: VisitSlotOut, capacity: number) {
  if (busyId.value || loading.value || !Number.isInteger(capacity) || capacity === slot.capacity) return
  busyId.value = slot.id
  try {
    await api.patch(`/admin/slots/${slot.id}`, { capacity })
    ElMessage.success('已更新名額')
    await load()
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const detail = err.detail as { message?: string; booked_count?: number }
      ElMessage.error(
        detail !== null && typeof detail === 'object' && detail.booked_count !== undefined
          ? `名額不能低於已確認的 ${detail.booked_count} 筆`
          : '名額不能低於目前已確認的案件數',
      )
      await load()
    } else {
      ElMessage.error('更新失敗，正在重新讀取目前名額。')
      await load()
    }
  } finally { busyId.value = null }
}

async function toggleClosed(slot: VisitSlotOut) {
  if (busyId.value || loading.value) return
  busyId.value = slot.id
  try {
    if (!slot.closed && slot.booked_count > 0) {
      try {
        await ElMessageBox.confirm(
          `這個時段已有 ${slot.booked_count} 筆確認案件，關閉後不再接受新預約，既有案件不受影響。`,
          '關閉時段？',
          { confirmButtonText: '關閉', cancelButtonText: '先不要', type: 'warning' },
        )
      } catch { return }
    }
    try {
      await api.patch(`/admin/slots/${slot.id}`, { closed: !slot.closed })
      await load()
    } catch { ElMessage.error('更新失敗') }
  } finally { busyId.value = null }
}

function fillRatio(slot: VisitSlotOut): number {
  return slot.capacity === 0 ? 1 : Math.min(1, slot.booked_count / slot.capacity)
}

function openCreate() {
  if (busyId.value || loading.value || creating.value) return
  createForm.value.slot_date = dateFrom.value >= isoDate() ? dateFrom.value : isoDate(1)
  createDialogVisible.value = true
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長可預約的參觀時段與每場名額。已確認的案件會占用名額；關閉時段只是不再開放，不影響既有案件。">
      <template #actions>
        <el-button type="primary" :icon="Plus" :disabled="!selectedCampus || Boolean(busyId) || loading || creating" @click="openCreate">新增時段</el-button>
      </template>
    </PageHeader>

    <div class="toolbar filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="selectedCampus" :keys="visibleCampusKeys" :disabled="Boolean(busyId) || creating || createDialogVisible" /></label>
      <label class="filter-field"><span>開始日期</span><el-date-picker v-model="dateFrom" :disabled="Boolean(busyId) || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="起始日期" /></label>
      <label class="filter-field"><span>結束日期</span><el-date-picker v-model="dateTo" :disabled="Boolean(busyId) || creating" type="date" value-format="YYYY-MM-DD" :clearable="false" aria-label="結束日期" /></label>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可管理的校區" />

    <el-alert v-else-if="rangeInvalid" title="結束日期需與開始日期相同或更晚。" type="warning" :closable="false" show-icon />
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon><el-button @click="load">重新載入</el-button></el-alert>
    <template v-else>
    <div class="list-summary"><span>{{ campusLabel(selectedCampus) }}校 · {{ loading ? '讀取中…' : `期間內 ${slots.length} 場，${availableSlots} 場仍有名額` }}</span><el-button text :loading="loading" :disabled="Boolean(busyId)" @click="load">重新整理</el-button></div>
    <div class="panel">
      <el-skeleton v-if="loading" animated :rows="4" class="list-skeleton" />
      <el-empty v-else-if="!slots.length" description="這段期間尚未安排參觀時段"><el-button type="primary" @click="openCreate">新增第一個時段</el-button></el-empty>
      <template v-else>
      <el-table class="data-table" :data="slots">
        <el-table-column label="日期" width="170">
          <template #default="{ row }: { row: VisitSlotOut }">
            <span class="num">{{ formatDate(row.slot_date) }}</span>
            <span class="muted">（{{ formatWeekday(row.slot_date) }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="時間" width="130">
          <template #default="{ row }: { row: VisitSlotOut }">
            <span class="num">{{ formatTime(row.start_time) }}–{{ formatTime(row.end_time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="已預約 / 名額" min-width="220">
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
                :disabled="Boolean(busyId)"
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
            <el-tag v-if="row.closed" type="info" size="small" round>已關閉</el-tag>
            <el-tag v-else-if="row.booked_count >= row.capacity" type="warning" size="small" round>已額滿</el-tag>
            <el-tag v-else type="success" size="small" round>開放中</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="right">
          <template #default="{ row }: { row: VisitSlotOut }">
            <el-button size="small" text :loading="busyId === row.id" :disabled="Boolean(busyId)" @click="toggleClosed(row)">
              {{ row.closed ? '重新開放' : '關閉' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <ul class="mobile-records" aria-label="參觀時段">
        <li v-for="slot in slots" :key="slot.id" class="mobile-record">
          <div class="record-heading"><strong>{{ formatDate(slot.slot_date) }}（{{ formatWeekday(slot.slot_date) }}）</strong><el-tag :type="slot.closed ? 'info' : fillRatio(slot) >= 1 ? 'warning' : 'success'">{{ slot.closed ? '已關閉' : fillRatio(slot) >= 1 ? '已額滿' : '開放中' }}</el-tag></div>
          <p class="slot-time num">{{ formatTime(slot.start_time) }}–{{ formatTime(slot.end_time) }}</p>
          <dl class="record-meta"><dt>已確認</dt><dd>{{ slot.booked_count }} 組家庭</dd><dt>接待名額</dt><dd><el-input-number :model-value="slot.capacity" :min="slot.booked_count" :max="200" :disabled="Boolean(busyId)" :aria-label="`${formatDate(slot.slot_date)} ${formatTime(slot.start_time)} 接待名額`" @change="(v: number | undefined) => v !== undefined && updateCapacity(slot, v)" /><span class="record-caption">調整後立即儲存</span></dd></dl>
          <div class="record-actions"><span class="hint">{{ slot.closed ? '不接受新預約' : `剩餘 ${Math.max(0, slot.capacity - slot.booked_count)} 組名額` }}</span><el-button :loading="busyId === slot.id" :disabled="Boolean(busyId)" @click="toggleClosed(slot)">{{ slot.closed ? '重新開放' : '關閉時段' }}</el-button></div>
        </li>
      </ul>
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
.slot-time { margin-top:8px; font-size:16px; color:var(--brand-green-deep); }
.record-meta dd .record-caption { display:block; }
.record-actions .el-button { margin-left:auto; }
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
