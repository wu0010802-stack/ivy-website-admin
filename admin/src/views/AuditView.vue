<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { auditActionLabel, auditMetadataDetails, auditTargetLabel, campusLabel, contentEditorPath, formatDateTime, type AuditDetails, type StaffPerson, staffEmail, staffLabel, staffOf } from '../api/labels'
import type { AuditLogEntryOut } from '../api/types'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { describeUserAgent } from '../utils/userAgent'

type AuditEntry = AuditLogEntryOut

// 後端 list_recent 一次回 100 筆（backend/app/operations/audit_service.py）；
// 回滿 100 筆就可能還有更早的，用最後一筆當游標再讀下一批。
const AUDIT_LIMIT = 100

const { isSuperAdmin, visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
// 每人每天都有的登入登出，勾了就不列（登入失敗、帳號鎖定照列）。預設照舊全部列出。
const hideLogins = ref(false)
const hasMore = ref(false)
const loadingMore = ref(false)
const moreError = ref<string | null>(null)
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

// 誰做的：讀取時由後端 join 帳號查出來（紀錄本身不存名字與 Email）。沒有操作者
// 是排程發布、每天清理這類系統自己做的事；有 id 卻查不到是帳號已刪除。
function actorText(entry: AuditEntry): string {
  return staffLabel(staffOf(entry, 'actor'), entry.actor_user_id ? '已移除的帳號' : '系統')
}
function actorEmail(entry: AuditEntry): string {
  return staffEmail(staffOf(entry, 'actor'))
}

// 從哪裡做的：裝置（由 User-Agent 解析）與 IP。IP 只有總部拿得到，其他人
// 後端回 null；改版前的紀錄與系統動作兩個都沒有，就不多寫一行。
function sourceText(entry: AuditEntry): string {
  return [describeUserAgent(entry.user_agent), entry.ip_address].filter(Boolean).join('・')
}

// 對哪個帳號（新增帳號、重設密碼、改角色……）：後端給對方的顯示名稱，沒有時
// 給 Email；Email 和其他地方一樣只寫 @ 前面那段，完整的放在 title。
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+$/
function targetPerson(entry: AuditEntry): StaffPerson | null {
  const label = entry.target_label?.trim()
  if (!label) return null
  return EMAIL_LIKE.test(label) ? { email: label } : { display_name: label }
}
function targetText(entry: AuditEntry): string {
  const person = targetPerson(entry)
  return person ? staffLabel(person) : ''
}

// 「查看案件」：只連到後端確認還在的案件（target_exists 是讀取時查的，個資
// 清理刪掉的為 false）。不顯示家長姓名或案件編號，紀錄裡不含家長個資。
function caseLink(entry: AuditEntry): string | null {
  return entry.target_type === 'visit_request' && entry.target_exists === true ? `/visit-requests/${entry.target_id}` : null
}
function caseRemoved(entry: AuditEntry): boolean {
  return entry.target_type === 'visit_request' && entry.target_exists === false
}
// 內容類連到那項內容的編輯頁（target_id 是內容項的 UUID，編輯頁看種類與校區）。
function contentLink(entry: AuditEntry): string | null {
  const kind = entry.metadata?.kind
  return entry.target_type === 'content_item' && typeof kind === 'string' ? contentEditorPath(kind, entry.campus_key) : null
}

const visibleEntries = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return entries.value.filter(entry => {
    const { lines, others } = details(entry)
    const who = [actorText(entry), actorEmail(entry), targetText(entry), staffEmail(targetPerson(entry))]
    return [auditActionLabel(entry.action), auditTargetLabel(entry.target_type), ...who, sourceText(entry), ...lines, ...others, campusText(entry)].join(' ').toLocaleLowerCase().includes(keyword)
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

function auditPath(before?: AuditEntry): string {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  if (hideLogins.value) params.set('exclude_login', 'true')
  if (before) {
    params.set('before', before.created_at)
    params.set('before_id', before.id)
  }
  const query = params.toString()
  return `/admin/audit-log${query ? `?${query}` : ''}`
}

async function load() {
  const request = requests.begin()
  entries.value = []
  hasMore.value = false
  moreError.value = null
  loadingMore.value = false
  if (!isSuperAdmin.value && !campusFilter.value) { loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    const result = await api.get<AuditEntry[]>(auditPath())
    if (requests.isCurrent(request)) {
      entries.value = result
      hasMore.value = result.length >= AUDIT_LIMIT
    }
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取操作紀錄，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 接著讀更早的 100 筆，接在目前清單後面。途中換校區或重新整理，舊的回應不寫回。
async function loadMore() {
  const last = entries.value[entries.value.length - 1]
  if (!last || loadingMore.value) return
  const request = requests.begin()
  loadingMore.value = true
  moreError.value = null
  try {
    const result = await api.get<AuditEntry[]>(auditPath(last))
    if (requests.isCurrent(request)) {
      entries.value = [...entries.value, ...result]
      hasMore.value = result.length >= AUDIT_LIMIT
    }
  } catch {
    if (requests.isCurrent(request)) moreError.value = '讀不到更早的紀錄，請再試一次。'
  } finally {
    if (requests.isCurrent(request)) loadingMore.value = false
  }
}

watch([campusFilter, hideLogins], load)

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
    <PageHeader lead="誰在什麼時候改了什麼。" more="包含預約設定與案件處理、內容發布、素材、帳號與授權、個資清理等。紀錄裡不含家長個資。" />

    <div class="filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="isSuperAdmin ? '全部校區' : undefined" /></label>
      <label class="filter-field filter-search"><span>搜尋已載入的紀錄</span><el-input v-model="search" placeholder="操作、操作者、內容類型或細節" clearable /></label>
      <el-checkbox v-model="hideLogins" class="filter-check" data-test="audit-hide-logins">不列登入登出</el-checkbox>
    </div>
    <div class="list-summary" role="status">
      <span>{{ loading ? '正在讀取操作紀錄…' : error ? '操作紀錄尚未載入' : search ? `符合 ${visibleEntries.length} 筆・已載入 ${entries.length} 筆` : `已載入 ${entries.length} 筆` }}</span>
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
            <el-table-column label="操作者" min-width="140">
              <template #default="{ row }: { row: AuditEntry }">
                <span class="audit-actor" :class="{ muted: !row.actor_user_id }" :title="actorEmail(row) || undefined" data-test="audit-actor">{{ actorText(row) }}</span>
                <span v-if="sourceText(row)" class="audit-source" :title="row.user_agent || undefined" data-test="audit-source">{{ sourceText(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="200">
              <template #default="{ row }: { row: AuditEntry }">
                <strong>{{ auditActionLabel(row.action) }}</strong>
                <span class="muted">・{{ auditTargetLabel(row.target_type) }}<template v-if="targetText(row)">「<span :title="staffEmail(targetPerson(row)) || undefined" data-test="audit-target">{{ targetText(row) }}</span>」</template></span>
                <router-link v-if="caseLink(row)" :to="caseLink(row)!" class="audit-link" data-test="audit-case-link">查看案件</router-link>
                <span v-else-if="caseRemoved(row)" class="audit-link muted">案件已清除</span>
                <router-link v-else-if="contentLink(row)" :to="contentLink(row)!" class="audit-link">開啟內容</router-link>
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
            <li v-for="entry in group.entries" :key="entry.id" class="mobile-record audit-record">
              <div class="record-heading">
                <p class="audit-record__title">
                  <strong>{{ auditActionLabel(entry.action) }}</strong>
                  <span class="muted">・{{ auditTargetLabel(entry.target_type) }}<template v-if="targetText(entry)">「<span :title="staffEmail(targetPerson(entry)) || undefined">{{ targetText(entry) }}</span>」</template></span>
                </p>
                <el-tag type="info">{{ campusText(entry) }}</el-tag>
              </div>
              <p class="audit-record__meta">
                <span class="num">{{ entryTime(entry) }}</span> · <span :class="{ muted: !entry.actor_user_id }" :title="actorEmail(entry) || undefined" data-test="audit-actor-mobile">{{ actorText(entry) }}</span><template v-if="sourceText(entry)"> · <span :title="entry.user_agent || undefined" data-test="audit-source-mobile">{{ sourceText(entry) }}</span></template>
                <router-link v-if="caseLink(entry)" :to="caseLink(entry)!" class="audit-link">查看案件</router-link>
                <span v-else-if="caseRemoved(entry)" class="audit-link muted">案件已清除</span>
                <router-link v-else-if="contentLink(entry)" :to="contentLink(entry)!" class="audit-link">開啟內容</router-link>
              </p>
              <p v-if="detailText(entry)" class="audit-detail" data-test="audit-detail-mobile">{{ detailText(entry) }}</p>
              <details v-if="details(entry).others.length" class="audit-others">
                <summary>其他細節</summary>
                <ul><li v-for="line in details(entry).others" :key="line">{{ line }}</li></ul>
              </details>
            </li>
          </ul>
        </div>
      </section>
      <div v-if="hasMore || moreError" class="audit-more">
        <el-alert v-if="moreError" class="inline-error" type="error" :closable="false" show-icon :title="moreError" />
        <el-button :loading="loadingMore" data-test="audit-load-more" @click="loadMore">載入更早的紀錄</el-button>
      </div>
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
  font-size: var(--text-md);
  font-weight: 600;
}

.audit-day__count {
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: 400;
}

.audit-detail,
.audit-actor {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.audit-actor.muted {
  color: var(--ink-3);
}

.audit-source {
  display: block;
  color: var(--ink-3);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.audit-link {
  margin-left: 8px;
  white-space: nowrap;
}

.audit-link.muted {
  color: var(--ink-3);
}

/* 和旁邊的輸入框一樣高，底線對齊。 */
.filter-check {
  min-height: var(--control-h);
}

.audit-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* 手機一筆兩三行：動作＋對象／時間・操作者／細節（有才寫）。 */
.audit-record__title,
.audit-record__meta {
  margin: 0;
  overflow-wrap: anywhere;
}

.audit-record__meta {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.audit-record .audit-detail {
  margin: 4px 0 0;
  font-size: var(--text-base);
}

.audit-others {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: var(--text-sm);
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

  .audit-record__meta .audit-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}
</style>
