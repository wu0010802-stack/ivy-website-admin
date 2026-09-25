<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { auditActionLabel, auditMetadataSummary, auditTargetLabel, campusLabel, formatDateTime } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
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
const search = ref('')
const requests = useRequestSequence()
const visibleEntries = computed(() => entries.value.filter(entry => [auditActionLabel(entry.action), auditTargetLabel(entry.target_type), metaSummary(entry.metadata), entry.campus_key ? campusLabel(entry.campus_key) : '全站'].join(' ').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))

async function load() {
  const request = requests.begin()
  entries.value = []
  if (!isSuperAdmin.value && !campusFilter.value) { loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    const params = campusFilter.value ? `?campus_key=${campusFilter.value}` : ''
    const result = await api.get<AuditEntry[]>(`/admin/audit-log${params}`)
    if (requests.isCurrent(request)) entries.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取操作紀錄，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
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

// 預約設定、開放規則這類有修改前後值的紀錄直接列出改了什麼；授權變更講清楚
// 是授予還是收回哪一項（auditMetadataSummary）。
function metaSummary(m: Record<string, unknown>): string {
  return auditMetadataSummary(m)
}
</script>

<template>
  <div class="page">
    <PageHeader lead="誰在什麼時候改了什麼。目前涵蓋預約設定、內容發布、全站設定與帳號啟用，紀錄裡不含家長個資。" />

    <div class="filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="isSuperAdmin ? '全部校區' : undefined" /></label>
      <label class="filter-field filter-search"><span>搜尋已載入的紀錄</span><el-input v-model="search" placeholder="操作、內容類型或細節" clearable /></label>
    </div>
    <div class="list-summary" role="status"><span>{{ loading ? '正在讀取操作紀錄…' : error ? '操作紀錄尚未載入' : `顯示 ${visibleEntries.length} / ${entries.length} 筆已載入紀錄` }}</span><el-button :loading="loading" @click="load">重新整理</el-button></div>
    <el-empty v-if="!isSuperAdmin && !visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" class="inline-error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else-if="loading" class="panel list-skeleton"><el-skeleton animated :rows="5" /></div>
    <div v-else class="panel">
      <el-empty v-if="!visibleEntries.length" :description="search ? '找不到符合條件的紀錄' : '還沒有操作紀錄'"><el-button v-if="search" @click="search = ''">清除搜尋</el-button></el-empty>
      <template v-else>
      <el-table class="data-table" :data="visibleEntries">
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
      <ul class="mobile-records" aria-label="操作紀錄">
        <li v-for="entry in visibleEntries" :key="entry.id" class="mobile-record">
          <div class="record-heading"><strong>{{ auditActionLabel(entry.action) }}</strong><el-tag type="info">{{ entry.campus_key ? campusLabel(entry.campus_key) : '全站' }}</el-tag></div>
          <dl class="record-meta"><dt>時間</dt><dd>{{ formatDateTime(entry.created_at) }}</dd><dt>操作項目</dt><dd>{{ auditTargetLabel(entry.target_type) }}</dd><dt>細節</dt><dd>{{ metaSummary(entry.metadata) || '—' }}</dd></dl>
        </li>
      </ul>
      </template>
    </div>
  </div>
</template>
