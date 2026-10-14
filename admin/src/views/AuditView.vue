<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { auditActionLabel, auditMetadataDetails, auditSearchTerms, auditTargetLabel, campusLabel, contentEditorPath, formatDateTime, type AuditDetails, staffEmail, staffLabel } from '../api/labels'
import { apiErrorMessage } from '../api/errors'
import type { AuditActorOut, AuditLogEntryOut } from '../api/types'
import { taipeiToday } from '../admissions/academic'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import { notifyError, notifyWarning } from '../composables/notify'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { Download } from '@element-plus/icons-vue'
import {
  auditActorEmail as actorEmail, auditActorText as actorText, auditCampusText as campusText, auditCsvHeader, auditCsvRow,
  auditSourceText as sourceText, auditTargetPerson as targetPerson, auditTargetText as targetText,
} from '../utils/auditFormat'
import { buildCsv, csvFilename, downloadCsv } from '../utils/csv'

type AuditEntry = AuditLogEntryOut

// 後端 list_recent 一次回 100 筆（backend/app/operations/audit_service.py）；
// 回滿 100 筆就可能還有更早的，用最後一筆當游標再讀下一批。
const AUDIT_LIMIT = 100

const { isSuperAdmin, visibleCampusKeys, selected: campusFilter } = useCampusScope({ autoSelect: false })
const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
// 2026-10-14 起搜尋由後端比對全部紀錄（不只已載入的）。打字停 300 ms 才重讀；appliedSearch 是
// 目前清單實際套用的搜尋字，清單、筆數說明與匯出都看它，打到一半時不會跟畫面對不上。
const AUDIT_SEARCH_DEBOUNCE_MS = 300
const appliedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
// 操作者篩選：''＝全部、'system'＝系統（排程發布、每天清理等），其他是帳號 id。選項是這個校區範圍內出現過的人。
const actorFilter = ref('')
const actorOptions = ref<AuditActorOut[]>([])
// 每人每天都有的登入登出，勾了就不列（登入失敗、帳號鎖定照列）。預設照舊全部列出。
const hideLogins = ref(false)
// 期間（台灣日期，含頭含尾）：清單與匯出用同一組條件。
const period = ref<[string, string] | null>(null)
function isFutureDate(date: Date): boolean {
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return local > taipeiToday()
}
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
// 一筆的文字（操作者、裝置與 IP、對象、搜尋用整段）抽在 utils/auditFormat.ts，畫面與匯出共用。

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

// 清單就是後端篩好的結果（搜尋與操作者都在後端比對），前端不再二次過濾。
const visibleEntries = computed(() => entries.value)

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

// 清單與匯出共用的條件。匯出逐頁讀，途中使用者改了篩選也不能讓後面幾頁換條件，所以按下去時先存一份。
interface AuditFilters { campus: string; hideLogins: boolean; period: [string, string] | null; actor: string; search: string }
function currentFilters(): AuditFilters {
  return { campus: campusFilter.value, hideLogins: hideLogins.value, period: period.value, actor: actorFilter.value, search: appliedSearch.value }
}

function auditPath(filters: AuditFilters, before?: AuditEntry, limit?: number): string {
  const params = new URLSearchParams()
  if (filters.campus) params.set('campus_key', filters.campus)
  if (filters.hideLogins) params.set('exclude_login', 'true')
  if (filters.actor) params.set('actor', filters.actor)
  for (const term of auditSearchTerms(filters.search)) params.append('q', term)
  if (filters.period) {
    params.set('created_from', filters.period[0])
    params.set('created_to', filters.period[1])
  }
  if (limit) params.set('limit', String(limit))
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
    const result = await api.get<AuditEntry[]>(auditPath(currentFilters()))
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
    const result = await api.get<AuditEntry[]>(auditPath(currentFilters(), last))
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

// 匯出：照目前校區、操作者、期間與搜尋（後端篩），從最新的往前逐頁讀完（每次 500 筆），不只已載入的。超過
// EXPORT_MAX 筆就停下、不產生半份檔案（半份的名單會被當成完整的）。紀錄不含家長個資，匯出本身不另寫稽核。
// 裝置欄人人有；IP 欄只有總部（後端只給總部 IP），其他人的檔案沒有這一欄。
const EXPORT_PAGE = 500
const EXPORT_MAX = 5000
const exporting = ref(false)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    const filters = currentFilters()
    const withIp = isSuperAdmin.value
    const all: AuditEntry[] = []
    let before: AuditEntry | undefined
    for (;;) {
      const page = await api.get<AuditEntry[]>(auditPath(filters, before, EXPORT_PAGE))
      all.push(...page)
      if (all.length > EXPORT_MAX) {
        notifyWarning(`符合的紀錄超過 ${EXPORT_MAX.toLocaleString('zh-TW')} 筆，請縮短期間或選定校區再匯出。`)
        return
      }
      if (page.length < EXPORT_PAGE) break
      before = page[page.length - 1]
    }
    const rows = all.map(entry => auditCsvRow(entry, auditMetadataDetails(entry.metadata, entry.action), withIp))
    const campus = filters.campus ? campusLabel(filters.campus) : '全部校區'
    const range = filters.period ? `${filters.period[0]}至${filters.period[1]}` : '全部期間'
    downloadCsv(csvFilename('操作紀錄', campus, range, taipeiToday()), buildCsv(auditCsvHeader(withIp), rows))
  } catch (err) {
    notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
  } finally {
    exporting.value = false
  }
}

// 操作者選項：這個範圍內出現過的人（最近操作的在前）。讀不到就只留「全部」「系統」，不擋清單。
const actorRequests = useRequestSequence()
async function loadActors() {
  const request = actorRequests.begin()
  if (!isSuperAdmin.value && !campusFilter.value) { actorOptions.value = []; return }
  try {
    const path = campusFilter.value ? `/admin/audit-log/actors?campus_key=${encodeURIComponent(campusFilter.value)}` : '/admin/audit-log/actors'
    const result = await api.get<AuditActorOut[]>(path)
    if (actorRequests.isCurrent(request)) actorOptions.value = Array.isArray(result) ? result.filter(row => row && 'actor_user_id' in row) : []
  } catch {
    if (actorRequests.isCurrent(request)) actorOptions.value = []
  }
}
const accountOptions = computed(() =>
  actorOptions.value
    .filter((row): row is AuditActorOut & { actor_user_id: string } => Boolean(row.actor_user_id))
    .map(row => ({ value: row.actor_user_id, label: staffLabel(row), email: row.email ?? '' })),
)
const hasSystemActor = computed(() => actorOptions.value.some(row => !row.actor_user_id))

watch(search, value => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { appliedSearch.value = value.trim() }, AUDIT_SEARCH_DEBOUNCE_MS)
})
// 換校區：操作者選項跟著換；原本選的人不在新範圍就回到「全部」（否則會篩成空白）。
watch(campusFilter, () => {
  void loadActors()
})
watch(actorOptions, options => {
  if (actorFilter.value && actorFilter.value !== 'system' && !options.some(row => row.actor_user_id === actorFilter.value)) actorFilter.value = ''
})
watch([campusFilter, hideLogins, period, actorFilter, appliedSearch], load)
onBeforeUnmount(() => clearTimeout(searchTimer))

onMounted(() => {
  if (!isSuperAdmin.value && visibleCampusKeys.value.length > 0) {
    campusFilter.value = visibleCampusKeys.value[0]!
  } else {
    void loadActors()
    load()
  }
})
</script>

<template>
  <div class="page">
    <PageHeader lead="誰在什麼時候改了什麼。" more="包含預約設定與案件處理、內容發布、素材、帳號與授權、個資清理等。紀錄裡不含家長個資。" />

    <div class="filter-bar" data-test="audit-filter-bar">
      <label class="filter-field"><span>校區</span><CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="isSuperAdmin ? '全部校區' : undefined" /></label>
      <label class="filter-field filter-search"><span>搜尋紀錄</span><el-input v-model="search" placeholder="操作、操作者、校區、內容種類或細節" clearable /></label>
      <label class="filter-field audit-actor-filter"><span>操作者</span>
        <el-select v-model="actorFilter" filterable placeholder="全部操作者" aria-label="操作者" data-test="audit-actor-filter">
          <el-option label="全部操作者" value="" />
          <el-option v-if="hasSystemActor" label="系統（排程、自動清理）" value="system" />
          <el-option v-for="option in accountOptions" :key="option.value" :label="option.label" :value="option.value"><span>{{ option.label }}</span><span v-if="option.email" class="audit-actor-option__email">{{ option.email }}</span></el-option>
        </el-select>
      </label>
      <label class="filter-field audit-period"><span>期間</span><el-date-picker v-model="period" type="daterange" value-format="YYYY-MM-DD" :disabled-date="isFutureDate" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="期間" data-test="audit-period" /></label>
      <el-checkbox v-model="hideLogins" class="filter-check" data-test="audit-hide-logins">不列登入登出</el-checkbox>
    </div>
    <!-- 只有筆數這句會隨載入與搜尋變動，才放進 live region；按鈕與匯出範圍說明是固定內容，不然切換校區讀屏會把整串再念一次。 -->
    <div class="list-summary">
      <span role="status">{{ loading ? '正在讀取操作紀錄…' : error ? '操作紀錄尚未載入' : appliedSearch || actorFilter ? `符合 ${entries.length} 筆${hasMore ? '（還有更早的，按「載入更早的紀錄」）' : ''}` : `已載入 ${entries.length} 筆` }}</span>
      <span class="audit-actions">
        <el-button :loading="loading" @click="load">重新整理</el-button>
        <el-button v-if="isSuperAdmin || campusFilter" :icon="Download" :loading="exporting" aria-describedby="audit-export-scope" data-test="audit-export" @click="exportCsv">匯出 CSV</el-button>
      </span>
      <span v-if="isSuperAdmin || campusFilter" id="audit-export-scope" class="hint audit-export-scope">匯出範圍：目前校區、操作者、期間與搜尋的全部紀錄（不只已載入的）</span>
    </div>
    <el-empty v-if="!isSuperAdmin && !visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" class="inline-error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else-if="loading" class="panel list-skeleton"><el-skeleton animated :rows="5" /></div>
    <div v-else-if="!visibleEntries.length" class="panel">
      <el-empty :description="appliedSearch || actorFilter ? '找不到符合條件的紀錄' : '還沒有操作紀錄'">
        <el-button v-if="appliedSearch" @click="search = ''">清除搜尋</el-button>
        <el-button v-if="actorFilter" @click="actorFilter = ''">看全部操作者</el-button>
      </el-empty>
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

/* 重新整理與匯出併成一組靠右，匯出範圍的說明另起一行。 */
.audit-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.audit-export-scope {
  flex-basis: 100%;
  margin-top: -4px;
}

/* 操作者選項：名字在前，完整 Email 灰字在後。 */
.audit-actor-option__email {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: var(--text-sm);
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
  /* 日期範圍選擇器預設固定 350px，比手機的篩選卡片寬：跟著自己的欄位寬。 */
  .audit-period :deep(.el-date-editor) {
    width: 100%;
  }

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
