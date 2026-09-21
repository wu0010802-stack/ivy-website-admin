<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import { useAuthStore } from '../stores/auth'

interface NotificationOut {
  id: string
  campus_key: string
  kind: string
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
}

interface RescheduleRequestOut {
  id: string
  visit_request_id: string
  requested_slot_id: string
  created_at: string
}

const authStore = useAuthStore()
const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const campusFilter = ref('')
const notifications = ref<NotificationOut[]>([])
const pendingReschedules = ref<RescheduleRequestOut[]>([])

async function load() {
  const params = campusFilter.value ? `?campus_key=${campusFilter.value}` : ''
  notifications.value = await api.get<NotificationOut[]>(`/admin/notifications${params}`)
  if (campusFilter.value) {
    pendingReschedules.value = await api.get<RescheduleRequestOut[]>(
      `/admin/reschedule-requests?campus_key=${campusFilter.value}`
    )
  }
}

watch(campusFilter, load)

async function markRead(id: string) {
  await api.post(`/admin/notifications/${id}/read`)
  await load()
}

async function approveReschedule(id: string) {
  await api.post(`/admin/reschedule-requests/${id}/approve`)
  await load()
}

async function rejectReschedule(id: string) {
  await api.post(`/admin/reschedule-requests/${id}/reject`)
  await load()
}

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    campusFilter.value = visibleCampusKeys.value[0]
  }
})
</script>

<template>
  <div>
    <h2>站內通知</h2>
    <el-select v-model="campusFilter" placeholder="校區" style="margin-bottom: 1rem">
      <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
    </el-select>

    <h3 v-if="pendingReschedules.length > 0">待核准的改期申請</h3>
    <el-table v-if="pendingReschedules.length > 0" :data="pendingReschedules" style="margin-bottom: 2rem">
      <el-table-column prop="visit_request_id" label="案件" />
      <el-table-column prop="created_at" label="申請時間" />
      <el-table-column label="操作">
        <template #default="{ row }: { row: RescheduleRequestOut }">
          <el-button size="small" type="primary" @click="approveReschedule(row.id)">核准</el-button>
          <el-button size="small" @click="rejectReschedule(row.id)">退回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-table :data="notifications">
      <el-table-column prop="kind" label="類型" />
      <el-table-column prop="created_at" label="時間" />
      <el-table-column label="狀態">
        <template #default="{ row }: { row: NotificationOut }">
          <el-tag :type="row.read_at ? 'info' : 'warning'">{{ row.read_at ? '已讀' : '未讀' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }: { row: NotificationOut }">
          <el-button v-if="!row.read_at" size="small" @click="markRead(row.id)">標記已讀</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
