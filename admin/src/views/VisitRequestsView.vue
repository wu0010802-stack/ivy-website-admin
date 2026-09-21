<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, BASE_URL } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { VisitRequestDetailOut } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const campusFilter = ref('')
const statusFilter = ref('')
const page = ref(1)
const pageSize = 20
const requests = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)

const STATUS_OPTIONS = ['new', 'confirmed', 'cancelled', 'no_show', 'completed']

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) })
    if (campusFilter.value) params.set('campus_key', campusFilter.value)
    if (statusFilter.value) params.set('status', statusFilter.value)
    requests.value = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
  } finally {
    loading.value = false
  }
}

watch([campusFilter, statusFilter, page], load)

function exportCsv() {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  window.open(`${BASE_URL}/admin/visit-requests/export?${params}`, '_blank')
}

function openDetail(id: string) {
  router.push(`/visit-requests/${id}`)
}

onMounted(load)
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h2>參觀預約案件</h2>
      <el-button @click="exportCsv">匯出 CSV</el-button>
    </div>

    <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
      <el-select v-model="campusFilter" placeholder="全部校區" clearable>
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部狀態" clearable>
        <el-option v-for="s in STATUS_OPTIONS" :key="s" :label="s" :value="s" />
      </el-select>
    </div>

    <el-table :data="requests" v-loading="loading" @row-click="(row: VisitRequestDetailOut) => openDetail(row.id)" style="cursor: pointer">
      <el-table-column prop="campus_key" label="校區" width="100" />
      <el-table-column prop="parent_name" label="家長稱呼" />
      <el-table-column prop="phone" label="電話" />
      <el-table-column label="狀態">
        <template #default="{ row }: { row: VisitRequestDetailOut }">
          <el-tag>{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="建立時間" />
    </el-table>

    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      layout="prev, pager, next"
      style="margin-top: 1rem"
    />
  </div>
</template>
