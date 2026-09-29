<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { auditActionLabel, auditMetadataDetails, auditTargetLabel, campusLabel, formatDateTime, type AuditDetails } from '../api/labels'
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

// 後端 list_recent 一次只回最近 100 筆（backend/app/operations/audit_service.py）。
const AUDIT_LIMIT = 100

const { isSuperAdmin, visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const requests = useRequestSequence()

// 預約設定、開放規則這類有修改前後值的紀錄直接列出改了什麼；授權變更講清楚
// 是授予還是收回哪一項；識別碼不顯示，還沒有中文寫法的新欄位收進「其他細節」
// （auditMetadataDetails）。每筆只算一次，搜尋與畫面共用。
const detailsById = computed(() => new Map<string, AuditDetails>(entries.value.map(entry => [entry.id, auditMetadataDetails(entry.metadata, entry.action)])))
function details(entry: AuditEntry): AuditDetails {
  return detailsById.value.get(entry.id) ?? { lines: [], others: [] }
}
function detailText(entry: AuditEntry): string {
  return details(entry).lines.join('，')
}
function campusText(entry: AuditEntry): string {
  return entry.campus_key ? campusLabel(entry.campus_key) : '全站'
}

const visibleEntries = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return entries.value.filter(entry => {
    const { lines, others } = details(entry)
    return [auditActionLabel(entry.action), auditTargetLabel(entry.target_type), ...lines, ...others, campusText(entry)].join(' ').toLocaleLowerCase().includes(keyword)
  })
})

// 依台灣日期分段，日期標題捲動時固定在頁首下方；同一天裡的時間只寫時分。
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayLabel = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' })
const timeLabel = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })

function entryTime(entry: AuditEntry): string {
  const d = new Date(entry.created_at)
  return Number.isNaN(d.getTime()) ? formatDateTime(entry.created_at) : timeLabel.format(d)
}

const groups = computed(() => {
  const result: { key: string; label: string; entries: AuditEntry[] }[] = []
  for (const entry of visibleEntries.value) {
    const d = new Date(entry.created_at)
    const valid = !Number.isNaN(d.getTime())
    const key = valid ? dayKey.format(d) : 'unknown'
    let group = result[result.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: valid ? dayLabel.format(d) : '日期不明', entries: [] }
      result.push(group)
    }
    group.entries.push(entry)
  }
  return result
})

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
</script>

<template>
  <div class="page">
    <PageHeader lead="誰在什麼時候改了什麼：預約設定與案件處理、內容發布、素材、帳號與授權、個資清理等。紀錄裡不含家長個資。" />

    <div class="filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="isSuperAdmin ? '全部校區' : undefined" /></label>
      <label class="filter-field filter-search"><span>搜尋已載入的紀錄</span><el-input v-model="search" placeholder="操作、內容類型或細節" clearable /></label>
    </div>
    <div class="list-summary" role="status">
      <span>{{ loading ? '正在讀取操作紀錄…' : error ? '操作紀錄尚未載入' : `顯示 ${visibleEntries.length} / ${entries.length} 筆已載入紀錄・只載入最近 ${AUDIT_LIMIT} 筆，更早的不會列出` }}</span>
      <el-button :loading="loading" @click="load">重新整理</el-button>
    </div>
    <el-empty v-if="!isSuperAdmin && !visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" class="inline-error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else-if="loading" class="panel list-skeleton"><el-skeleton animated :rows="5" /></div>
    <div v-else-if="!visibleEntries.length" class="panel">
      <el-empty :description="search ? '找不到符合條件的紀錄' : '還沒有操作紀錄'"><el-button v-if="search" @click="search = ''">清除搜尋</el-button></el-empty>
    </div>
    <template v-else>
      <section v-for="(group, index) in groups" :key="group.key" class="audit-day" :aria-labelledby="`audit-day-${group.key}`">
        <h2 :id="`audit-day-${group.key}`" class="audit-day__head">{{ group.label }}<span class="audit-day__count">{{ group.entries.length }} 筆</span></h2>
        <div class="panel">
          <el-table class="data-table" :data="group.entries" :show-header="index === 0">
            <el-table-column label="時間" width="90">
              <template #default="{ row }: { row: AuditEntry }"><span class="num">{{ entryTime(row) }}</span></template>
            </el-table-column>
            <el-table-column label="操作" min-width="200">
              <template #default="{ row }: { row: AuditEntry }">
                <strong>{{ auditActionLabel(row.action) }}</strong>
                <span class="muted">・{{ auditTargetLabel(row.target_type) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="校區" width="90">
              <template #default="{ row }: { row: AuditEntry }">{{ campusText(row) }}</template>
            </el-table-column>
            <el-table-column label="細節" min-width="300">
              <template #default="{ row }: { row: AuditEntry }">
                <span class="audit-detail">{{ detailText(row) || '—' }}</span>
                <details v-if="details(row).others.length" class="audit-others">
                  <summary>其他細節</summary>
                  <ul><li v-for="line in details(row).others" :key="line">{{ line }}</li></ul>
                </details>
              </template>
            </el-table-column>
          </el-table>
          <ul class="mobile-records" :aria-label="`${group.label}的操作紀錄`">
            <li v-for="entry in group.entries" :key="entry.id" class="mobile-record">
              <div class="record-heading"><strong>{{ auditActionLabel(entry.action) }}</strong><el-tag type="info">{{ campusText(entry) }}</el-tag></div>
              <dl class="record-meta">
                <dt>時間</dt><dd class="num">{{ entryTime(entry) }}</dd>
                <dt>操作項目</dt><dd>{{ auditTargetLabel(entry.target_type) }}</dd>
                <dt>細節</dt>
                <dd>
                  {{ detailText(entry) || '—' }}
                  <details v-if="details(entry).others.length" class="audit-others">
                    <summary>其他細節</summary>
                    <ul><li v-for="line in details(entry).others" :key="line">{{ line }}</li></ul>
                  </details>
                </dd>
              </dl>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.audit-day + .audit-day {
  margin-top: 20px;
}

/* 日期標題捲動時貼在頁首下方，長長一串紀錄也看得出是哪一天。 */
.audit-day__head {
  position: sticky;
  top: var(--top-h);
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 8px 0;
  background: var(--surface-2);
  font-size: 15px;
  font-weight: 600;
}

.audit-day__count {
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 400;
}

.audit-detail {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.audit-others {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 13px;
}

.audit-others summary {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.audit-others ul {
  margin: 0;
  padding-left: 18px;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .audit-others summary {
    min-height: 44px;
  }
}
</style>
