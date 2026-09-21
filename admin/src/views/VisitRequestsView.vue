<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Download } from '@element-plus/icons-vue'
import { api, BASE_URL } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, formatDateTime, VISIT_STATUS, VISIT_STATUS_ORDER, visitStatus } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import StatusTag from '../components/StatusTag.vue'

const router = useRouter()
const route = useRoute()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })

const campusFilter = ref('')
const statusFilter = ref(typeof route.query.status === 'string' ? route.query.status : '')
const page = ref(1)
const pageSize = 20
const requests = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const hasNext = computed(() => requests.value.length === pageSize)

async function load() {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) })
    if (campusFilter.value) params.set('campus_key', campusFilter.value)
    if (statusFilter.value) params.set('status', statusFilter.value)
    requests.value = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
  } catch {
    error.value = '無法讀取案件列表'
  } finally {
    loading.value = false
  }
}

watch([campusFilter, statusFilter], () => {
  page.value = 1
  load()
})
watch(page, load)

function exportCsv() {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  window.open(`${BASE_URL}/admin/visit-requests/export?${params}`, '_blank')
}

function openDetail(row: VisitRequestDetailOut) {
  router.push(`/visit-requests/${row.id}`)
}

const emptyText = computed(() => {
  if (statusFilter.value) return `沒有「${VISIT_STATUS[statusFilter.value]?.label ?? statusFilter.value}」的案件`
  return '還沒有任何參觀需求'
})

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader lead="家長從官網送出的參觀需求。狀態「待處理」代表園方尚未聯絡，確認並排入時段後才算預約成立。">
      <template #actions>
        <el-button :icon="Download" @click="exportCsv">匯出 CSV</el-button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
      <el-select v-model="statusFilter" placeholder="全部狀態" clearable aria-label="狀態">
        <el-option v-for="s in VISIT_STATUS_ORDER" :key="s" :label="VISIT_STATUS[s]!.label" :value="s" />
      </el-select>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div class="panel">
      <el-table
        :data="requests"
        v-loading="loading"
        class="el-table--clickable"
        :empty-text="emptyText"
        @row-click="openDetail"
      >
        <el-table-column label="狀態" width="110">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <StatusTag :meta="visitStatus(row.status)" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="校區" width="90">
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ campusLabel(row.campus_key) }}</template>
        </el-table-column>
        <el-table-column prop="parent_name" label="家長" min-width="120" />
        <el-table-column label="電話" width="140">
          <template #default="{ row }: { row: VisitRequestDetailOut }"><span class="num">{{ row.phone }}</span></template>
        </el-table-column>
        <el-table-column label="孩子年齡" width="90">
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ row.age ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="方便時段" min-width="140" show-overflow-tooltip>
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ row.preferred_time || '—' }}</template>
        </el-table-column>
        <el-table-column label="送出時間" width="150">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span class="num">{{ formatDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager" v-if="page > 1 || hasNext">
        <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint">第 {{ page }} 頁</span>
        <el-button size="small" :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}
</style>
