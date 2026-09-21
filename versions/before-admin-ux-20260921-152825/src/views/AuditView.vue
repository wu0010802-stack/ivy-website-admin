<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import { useAuthStore } from '../stores/auth'

interface AuditEntry {
  id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string
  campus_key: string | null
  metadata: Record<string, unknown>
  created_at: string
}

const authStore = useAuthStore()
const isSuperAdmin = computed(() => authStore.user?.role === 'super_admin')
const visibleCampusKeys = computed(() => {
  if (isSuperAdmin.value) return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const campusFilter = ref('')
const entries = ref<AuditEntry[]>([])

async function load() {
  const params = campusFilter.value ? `?campus_key=${campusFilter.value}` : ''
  entries.value = await api.get<AuditEntry[]>(`/admin/audit-log${params}`)
}

watch(campusFilter, load)

onMounted(() => {
  if (!isSuperAdmin.value && visibleCampusKeys.value.length > 0) {
    campusFilter.value = visibleCampusKeys.value[0]
  } else {
    load()
  }
})
</script>

<template>
  <div>
    <h2>操作紀錄</h2>
    <el-select v-model="campusFilter" placeholder="全部校區" clearable style="margin-bottom: 1rem">
      <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
    </el-select>

    <el-table :data="entries">
      <el-table-column prop="action" label="操作" />
      <el-table-column prop="target_type" label="對象類型" />
      <el-table-column prop="campus_key" label="校區" />
      <el-table-column prop="created_at" label="時間" />
    </el-table>
  </div>
</template>
