<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { VisitSlotOut } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const selectedCampus = ref('')
const dateFrom = ref(new Date().toISOString().slice(0, 10))
const dateTo = ref(
  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
)
const slots = ref<VisitSlotOut[]>([])
const loading = ref(false)

const createDialogVisible = ref(false)
const createForm = ref({ slot_date: dateFrom.value, start_time: '10:00:00', end_time: '11:00:00', capacity: 5 })
const creating = ref(false)

async function load() {
  if (!selectedCampus.value) return
  loading.value = true
  try {
    slots.value = await api.get<VisitSlotOut[]>(
      `/admin/slots?campus_key=${selectedCampus.value}&date_from=${dateFrom.value}&date_to=${dateTo.value}`
    )
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.error(typeof detail === 'object' ? (detail.message ?? '查詢失敗') : detail)
    }
  } finally {
    loading.value = false
  }
}

watch([selectedCampus, dateFrom, dateTo], load)

async function submitCreate() {
  creating.value = true
  try {
    await api.post(`/admin/slots?campus_key=${selectedCampus.value}`, createForm.value)
    ElMessage.success('已建立時段')
    createDialogVisible.value = false
    await load()
  } catch (err) {
    ElMessage.error('建立失敗')
  } finally {
    creating.value = false
  }
}

async function updateCapacity(slot: VisitSlotOut, capacity: number) {
  try {
    await api.patch(`/admin/slots/${slot.id}`, { capacity })
    ElMessage.success('已更新容量')
    await load()
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const detail = err.detail as { message?: string; booked_count?: number }
      ElMessage.error(
        typeof detail === 'object'
          ? `${detail.message}（目前已有 ${detail.booked_count} 筆確認案件）`
          : '容量不能低於目前已確認的案件數'
      )
    } else {
      ElMessage.error('更新失敗')
    }
  }
}

async function toggleClosed(slot: VisitSlotOut) {
  try {
    await api.patch(`/admin/slots/${slot.id}`, { closed: !slot.closed })
    await load()
  } catch {
    ElMessage.error('更新失敗')
  }
}

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    selectedCampus.value = visibleCampusKeys.value[0]
  }
})
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h2>時段與容量</h2>
      <el-button type="primary" :disabled="!selectedCampus" @click="createDialogVisible = true">
        新增時段
      </el-button>
    </div>

    <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
      <el-select v-model="selectedCampus" placeholder="校區">
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
      <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" />
      <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" />
    </div>

    <el-table :data="slots" v-loading="loading">
      <el-table-column prop="slot_date" label="日期" />
      <el-table-column label="時間">
        <template #default="{ row }: { row: VisitSlotOut }">
          {{ row.start_time }}–{{ row.end_time }}
        </template>
      </el-table-column>
      <el-table-column label="容量／已預約">
        <template #default="{ row }: { row: VisitSlotOut }">
          <el-input-number
            :model-value="row.capacity"
            :min="0"
            :max="200"
            size="small"
            @change="(v: number) => updateCapacity(row, v)"
          />
          <span style="margin-left: 0.5rem">／ {{ row.booked_count }}</span>
        </template>
      </el-table-column>
      <el-table-column label="狀態">
        <template #default="{ row }: { row: VisitSlotOut }">
          <el-tag :type="row.closed ? 'info' : 'success'">{{ row.closed ? '已關閉' : '開放中' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }: { row: VisitSlotOut }">
          <el-button size="small" @click="toggleClosed(row)">
            {{ row.closed ? '重新開放' : '關閉' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createDialogVisible" title="新增時段">
      <el-form label-position="top">
        <el-form-item label="日期">
          <el-date-picker v-model="createForm.slot_date" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="開始時間">
          <el-time-picker v-model="createForm.start_time" value-format="HH:mm:ss" />
        </el-form-item>
        <el-form-item label="結束時間">
          <el-time-picker v-model="createForm.end_time" value-format="HH:mm:ss" />
        </el-form-item>
        <el-form-item label="容量">
          <el-input-number v-model="createForm.capacity" :min="1" :max="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">建立</el-button>
      </template>
    </el-dialog>
  </div>
</template>
