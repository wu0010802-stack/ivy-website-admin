<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import type { VisitSlotOut } from '../api/types'
import { formatDate, formatTime, formatWeekday } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'

const { visibleCampusKeys, selected: selectedCampus } = useCampusScope()

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const dateFrom = ref(isoDate())
const dateTo = ref(isoDate(30))
const slots = ref<VisitSlotOut[]>([])
const loading = ref(false)

const createDialogVisible = ref(false)
const createForm = ref({ slot_date: isoDate(1), start_time: '10:00:00', end_time: '11:00:00', capacity: 5 })
const creating = ref(false)

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { message?: string } | string
    return typeof detail === 'object' ? (detail.message ?? fallback) : detail
  }
  return fallback
}

async function load() {
  if (!selectedCampus.value) return
  loading.value = true
  try {
    slots.value = await api.get<VisitSlotOut[]>(
      `/admin/slots?campus_key=${selectedCampus.value}&date_from=${dateFrom.value}&date_to=${dateTo.value}`,
    )
  } catch (err) {
    ElMessage.error(errorText(err, '查詢失敗'))
  } finally {
    loading.value = false
  }
}

watch([selectedCampus, dateFrom, dateTo], load, { immediate: true })

const createValid = computed(
  () => Boolean(createForm.value.slot_date) && createForm.value.start_time < createForm.value.end_time && createForm.value.capacity >= 1,
)

async function submitCreate() {
  if (!createValid.value) return
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
  try {
    await api.patch(`/admin/slots/${slot.id}`, { capacity })
    ElMessage.success('已更新名額')
    await load()
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const detail = err.detail as { message?: string; booked_count?: number }
      ElMessage.error(
        typeof detail === 'object' && detail.booked_count !== undefined
          ? `名額不能低於已確認的 ${detail.booked_count} 筆`
          : '名額不能低於目前已確認的案件數',
      )
      await load()
    } else {
      ElMessage.error('更新失敗')
    }
  }
}

async function toggleClosed(slot: VisitSlotOut) {
  if (!slot.closed && slot.booked_count > 0) {
    try {
      await ElMessageBox.confirm(
        `這個時段已有 ${slot.booked_count} 筆確認案件，關閉後不再接受新預約，既有案件不受影響。`,
        '關閉時段？',
        { confirmButtonText: '關閉', cancelButtonText: '先不要', type: 'warning' },
      )
    } catch {
      return
    }
  }
  try {
    await api.patch(`/admin/slots/${slot.id}`, { closed: !slot.closed })
    await load()
  } catch {
    ElMessage.error('更新失敗')
  }
}

function fillRatio(slot: VisitSlotOut): number {
  return slot.capacity === 0 ? 1 : Math.min(1, slot.booked_count / slot.capacity)
}

function openCreate() {
  createForm.value.slot_date = dateFrom.value >= isoDate() ? dateFrom.value : isoDate(1)
  createDialogVisible.value = true
}
</script>

<template>
  <div class="page">
    <PageHeader lead="家長可預約的參觀時段與每場名額。已確認的案件會占用名額；關閉時段只是不再開放，不影響既有案件。">
      <template #actions>
        <el-button type="primary" :icon="Plus" :disabled="!selectedCampus" @click="openCreate">新增時段</el-button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <CampusSelect v-model="selectedCampus" :keys="visibleCampusKeys" />
      <span class="toolbar__range">
        <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="起" :clearable="false" aria-label="起始日期" />
        <span>到</span>
        <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="迄" :clearable="false" aria-label="結束日期" />
      </span>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可管理的校區" />

    <div v-else class="panel">
      <el-table :data="slots" v-loading="loading" empty-text="這段期間沒有時段，按右上角「新增時段」建立">
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
            <el-button size="small" text @click="toggleClosed(row)">
              {{ row.closed ? '重新開放' : '關閉' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="createDialogVisible" title="新增參觀時段" width="420px">
      <el-form label-position="top" @submit.prevent="submitCreate">
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
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!createValid" @click="submitCreate">建立</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
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
