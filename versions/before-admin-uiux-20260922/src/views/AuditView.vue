<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { auditActionLabel, auditTargetLabel, campusLabel, formatDateTime } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'

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

const { isSuperAdmin, visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const params = campusFilter.value ? `?campus_key=${campusFilter.value}` : ''
    entries.value = await api.get<AuditEntry[]>(`/admin/audit-log${params}`)
  } catch {
    error.value = '無法讀取操作紀錄'
  } finally {
    loading.value = false
  }
}

watch(campusFilter, load)

onMounted(() => {
  if (!isSuperAdmin.value && visibleCampusKeys.value.length > 0) {
    campusFilter.value = visibleCampusKeys.value[0]!
  } else {
    load()
  }
})

function metaSummary(m: Record<string, unknown>): string {
  return Object.entries(m ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('，')
}
</script>

<template>
  <div class="page">
    <PageHeader lead="誰在什麼時候改了什麼。目前涵蓋預約設定、內容發布、全站設定與帳號啟用，紀錄裡不含家長個資。" />

    <div class="toolbar">
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="isSuperAdmin ? '全部校區' : undefined" />
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px" />

    <div class="panel">
      <el-table :data="entries" v-loading="loading" empty-text="還沒有紀錄">
        <el-table-column label="時間" width="160">
          <template #default="{ row }: { row: AuditEntry }"><span class="num">{{ formatDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" min-width="180">
          <template #default="{ row }: { row: AuditEntry }">
            <strong>{{ auditActionLabel(row.action) }}</strong>
            <span class="muted">・{{ auditTargetLabel(row.target_type) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="校區" width="90">
          <template #default="{ row }: { row: AuditEntry }">{{ row.campus_key ? campusLabel(row.campus_key) : '—' }}</template>
        </el-table-column>
        <el-table-column label="細節" min-width="240" show-overflow-tooltip>
          <template #default="{ row }: { row: AuditEntry }"><span class="mono muted">{{ metaSummary(row.metadata) || '—' }}</span></template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
