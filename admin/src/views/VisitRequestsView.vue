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
let loadVersion = 0
const hasFilters = computed(() => Boolean(campusFilter.value || statusFilter.value))
function clearFilters() {
  campusFilter.value = ''
  statusFilter.value = ''
}

const hasNext = computed(() => requests.value.length === pageSize)

async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) })
    if (campusFilter.value) params.set('campus_key', campusFilter.value)
    if (statusFilter.value) params.set('status', statusFilter.value)
    const result = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
    if (version === loadVersion) requests.value = result
  } catch {
    if (version === loadVersion) {
      error.value = '無法讀取案件列表，請重新載入。'
      requests.value = []
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

watch([campusFilter, statusFilter], () => {
  page.value = 1
  load()
})
watch(page, load)
watch(() => route.query.status, status => {
  statusFilter.value = typeof status === 'string' ? status : ''
})

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
      <div class="filter-field"><span>校區</span>
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
      </div>
      <div class="filter-field"><span>案件狀態</span>
      <el-select v-model="statusFilter" placeholder="全部狀態" clearable aria-label="狀態">
        <el-option v-for="s in VISIT_STATUS_ORDER" :key="s" :label="VISIT_STATUS[s]!.label" :value="s" />
      </el-select>
      </div>
      <el-button v-if="hasFilters" text @click="clearFilters">清除篩選</el-button>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div v-if="!error" class="panel" :aria-busy="loading">
      <div class="panel__head"><h2>參觀需求</h2><span class="hint">{{ loading ? '載入中…' : `本頁 ${requests.length} 件` }}</span></div>
      <el-table
        :data="requests"
        v-loading="loading"
        class="el-table--clickable requests-table"
        :empty-text="emptyText"
        @row-click="openDetail"
      >
        <template #empty><div v-if="!loading" class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後會顯示在這裡，可查看聯絡資訊並安排參觀。' }}</p><el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button></div></template>
        <el-table-column label="狀態" width="110">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <StatusTag :meta="visitStatus(row.status)" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="校區" width="90">
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ campusLabel(row.campus_key) }}</template>
        </el-table-column>
        <el-table-column label="家長" min-width="120"><template #default="{ row }: { row: VisitRequestDetailOut }"><router-link :to="`/visit-requests/${row.id}`" @click.stop>{{ row.parent_name }}</router-link></template></el-table-column>
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

      <div class="requests-mobile">
        <el-skeleton v-if="loading" animated :rows="4" class="panel__body" />
        <ul v-else-if="requests.length" class="request-list">
          <li v-for="request in requests" :key="request.id">
            <div class="request-list__head"><router-link :to="`/visit-requests/${request.id}`">{{ request.parent_name }}<span aria-hidden="true"> →</span></router-link><StatusTag :meta="visitStatus(request.status)" /></div>
            <p>{{ campusLabel(request.campus_key) }}校 · 孩子 {{ request.age ?? '年齡未填' }}<template v-if="request.age != null"> 歲</template></p>
            <a class="request-list__phone" :href="`tel:${request.phone}`">{{ request.phone }}</a>
            <p>方便時段：{{ request.preferred_time || '未填寫' }}</p>
            <span class="hint">{{ formatDateTime(request.created_at) }} 送出</span>
          </li>
        </ul>
        <div v-else class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後，可在這裡聯絡並安排參觀。' }}</p><el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button></div>
      </div>

      <div class="pager" v-if="page > 1 || hasNext">
        <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint">第 {{ page }} 頁</span>
        <el-button size="small" :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar { align-items: flex-end; }
.filter-field { display: grid; gap: 6px; font-size: 13px; color: var(--ink-2); }
.requests-empty { padding: 32px 16px; text-align: center; color: var(--ink-2); }
.requests-empty strong { font-size: 16px; color: var(--ink); }
.requests-empty p { margin: 8px auto 16px; max-width: 50ch; }
.requests-mobile { display: none; }
.request-list { list-style: none; margin: 0; padding: 0; }
.request-list li { padding: 20px 16px; }
.request-list li + li { border-top: 1px solid var(--line); }
.request-list__head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 4px; }
.request-list__head a { display: inline-flex; align-items: center; min-height: 44px; font-size: 17px; font-weight: 600; }
.request-list p { color: var(--ink-2); margin-bottom: 6px; overflow-wrap: anywhere; }
.request-list__phone { display: inline-flex; min-height: 44px; align-items: center; text-decoration: underline; font-variant-numeric: tabular-nums; }
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}
@media (max-width: 720px) {
  .requests-table { display: none; }
  .requests-mobile { display: block; }
  .filter-field { flex: 1 1 130px; min-width: 0; font-size: 14px; }
}
</style>
