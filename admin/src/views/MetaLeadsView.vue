<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { campusLabel, formatDateTime } from '../api/labels'
import type { MetaLeadListOut, MetaLeadOut } from '../api/types'
import type { MetaLeadState } from '../../../contracts/generated/state-machines'
import CampusSelect from '../components/CampusSelect.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import { notifyError, notifyWarning } from '../composables/notify'
import { useCampusScope } from '../composables/useCampusScope'
import { usePermissions } from '../composables/usePermissions'
import { useRequestSequence } from '../composables/useRequestSequence'

// Meta 名單型廣告（即時表單）收進來的名單（docs/specs/2026-11-26-meta-lead-inbox-design.md）：
// 家長在廣告上填完表單就進這裡，由人挑要跟進的轉成參觀案件，不需要的略過。
// 轉成案件走補登對話框（POST /admin/visit-requests 帶 meta_lead_id），同一個交易裡名單改成「已轉案件」並清掉個資。
type Status = MetaLeadState
const STATUS_LABELS: Record<Status, string> = { new: '新名單', converted: '已轉案件', dismissed: '已略過' }
const PLATFORM_LABELS: Record<string, string> = { fb: 'Facebook', ig: 'Instagram' }

const route = useRoute()
const router = useRouter()
const { visibleCampusKeys, selected } = useCampusScope()
const { can } = usePermissions()
const canHandle = computed(() => can('booking.handle'))

// LINE 通知連結會帶 ?campus=，有給而且看得到才預選。
const linked = route.query.campus
const campus = ref(typeof linked === 'string' && visibleCampusKeys.value.includes(linked) ? linked : selected.value)
const status = ref<Status>('new')
const data = ref<MetaLeadListOut | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
// 正在做的動作：同步、或對某一筆略過／放回；同時只做一件，避免連點。
type Busy = { kind: 'sync' } | { kind: 'dismiss' | 'restore'; id: string } | null
const busy = ref<Busy>(null)
// 轉成案件的補登對話框：打開時帶入這一筆名單。
const converting = ref<MetaLeadOut | null>(null)
const dialogOpen = ref(false)

const intervalText = computed(() => {
  const seconds = data.value?.sync_seconds ?? 3600
  if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小時`
  return seconds >= 60 ? `每 ${Math.round(seconds / 60)} 分鐘` : `每 ${seconds} 秒`
})

const requests = useRequestSequence()

async function load() {
  if (!campus.value) return
  const request = requests.begin()
  loading.value = true
  loadError.value = null
  try {
    const result = await api.get<MetaLeadListOut>(
      `/admin/meta-leads?campus_key=${encodeURIComponent(campus.value)}&status=${status.value}`,
    )
    // 載入途中換了校區或頁籤：丟掉舊的回應，不然清單會和選中的頁籤對不上。
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (requests.isCurrent(request)) loadError.value = apiErrorMessage(err, '讀不到廣告名單，請重新載入')
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([campus, status], () => { void load() }, { immediate: true })

// 目前的校區寫在網址 ?campus=，重新整理或分享連結都停在同一校。
watch(campus, (key) => {
  if (key && route.query.campus !== key) void router.replace({ query: { ...route.query, campus: key } })
}, { immediate: true })

async function syncNow() {
  busy.value = { kind: 'sync' }
  try {
    const result = await api.post<MetaLeadListOut>('/admin/meta-leads/sync', { campus_key: campus.value })
    // 回應是這校的新名單分頁。
    if (status.value !== 'new') status.value = 'new'
    data.value = result
    if (result.sync?.last_error) notifyWarning(`同步失敗：${result.sync.last_error}`)
    else ElMessage.success(`已同步，讀到 ${result.sync?.last_count ?? 0} 筆名單`)
  } catch (err) {
    notifyError(apiErrorMessage(err, '同步失敗，請稍後再試'))
  } finally {
    busy.value = null
  }
}

async function setStatus(lead: MetaLeadOut, action: 'dismiss' | 'restore') {
  busy.value = { kind: action, id: lead.id }
  try {
    await api.post<MetaLeadOut>(`/admin/meta-leads/${lead.id}/${action}`)
    await load()
  } catch (err) {
    notifyError(apiErrorMessage(err, '沒有成功，請重新整理後再試'))
  } finally {
    busy.value = null
  }
}

function convert(lead: MetaLeadOut) {
  converting.value = lead
  dialogOpen.value = true
}

// 補登對話框已經提示「已補登」；這裡只重新讀這一頁，名單會移到「已轉案件」。
async function onCreated() {
  await load()
}

const isBusy = (lead: MetaLeadOut, kind: 'dismiss' | 'restore') =>
  busy.value !== null && busy.value.kind === kind && busy.value.id === lead.id
const platformLabel = (platform: string | null) => (platform ? PLATFORM_LABELS[platform] ?? platform : null)
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="家長在 Meta（Facebook、Instagram）名單型廣告填的表單會收進這裡。挑要跟進的轉成參觀案件，家長資料會帶進補登表單；不需要的就略過。">
      <template #actions>
        <CampusSelect v-model="campus" class="ml-campus" :keys="visibleCampusKeys" />
        <el-button
          v-if="canHandle && data?.configured"
          :loading="busy?.kind === 'sync'"
          :disabled="loading || (busy !== null && busy.kind !== 'sync')"
          @click="syncNow"
        >立即同步</el-button>
      </template>
    </PageHeader>

    <p v-if="visibleCampusKeys.length === 0" class="hint">你的帳號沒有可看的校區。</p>

    <el-alert v-else-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="6" />

    <template v-else-if="data">
      <el-empty
        v-if="!data.configured"
        class="ml-empty"
        :description="`${campusLabel(campus)}還沒接上 Meta 名單型廣告，請總管理者設定。`"
      />
      <template v-else>
        <!-- 寫成一行：分行的話逗號和「之後」中間會多一個空白。 -->
        <p class="ml-sync hint" role="status">{{ data.sync?.last_success_at ? `上次同步 ${formatDateTime(data.sync.last_success_at)}，讀到 ${data.sync.last_count ?? 0} 筆名單，` : '還沒同步成功過，' }}之後{{ intervalText }}自動同步一次。</p>
        <el-alert
          v-if="data.sync?.last_error"
          type="warning"
          :closable="false"
          show-icon
          :title="`最近一次同步失敗（${formatDateTime(data.sync.last_attempt_at)}）`"
          :description="`${data.sync.last_error}。多半是權杖缺 leads_retrieval／pages_manage_ads 權限或已過期，請技術人員檢查 Meta 的設定。`"
        />

        <div class="ml-filters">
          <el-radio-group v-model="status" class="ml-tabs" aria-label="名單狀態">
            <el-radio-button v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">
              {{ label }} {{ data.counts[key] }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <p v-if="!data.leads.length" class="hint ml-none">
          {{ status === 'new' ? '沒有新名單。' : `沒有${STATUS_LABELS[status]}的名單。` }}
        </p>
        <ul v-else class="ml-list" :aria-busy="loading">
          <li v-for="lead in data.leads" :key="lead.id" class="panel ml-lead" :data-lead="lead.id">
            <div class="ml-lead__head">
              <template v-if="lead.status !== 'converted'">
                <strong class="ml-lead__name">{{ lead.parent_name || '（沒有填姓名）' }}</strong>
                <a v-if="lead.phone" class="ml-lead__phone" :href="`tel:${lead.phone}`">{{ lead.phone }}</a>
                <span v-else class="hint">（沒有填電話）</span>
              </template>
              <strong v-else class="ml-lead__name">已轉成參觀案件</strong>
            </div>
            <div class="ml-lead__meta">
              <time :datetime="lead.created_at">送出 {{ formatDateTime(lead.created_at) }}</time>
              <span v-if="lead.form_name">表單：{{ lead.form_name }}</span>
              <el-tag v-if="platformLabel(lead.platform)" size="small" effect="plain" type="info">{{ platformLabel(lead.platform) }}</el-tag>
              <el-tag v-if="lead.is_organic" size="small" effect="plain" type="info">自然流量</el-tag>
            </div>
            <dl v-if="lead.answers.length" class="ml-lead__answers">
              <div v-for="(item, index) in lead.answers" :key="index" class="ml-lead__answer">
                <dt>{{ item.question }}</dt>
                <dd>{{ item.answer }}</dd>
              </div>
            </dl>
            <div class="ml-lead__actions">
              <template v-if="lead.status === 'converted'">
                <span class="hint">
                  {{ formatDateTime(lead.handled_at) }} 已轉成案件，家長資料已移到案件裡，這裡不再保留。
                  <router-link v-if="lead.visit_request_id" :to="`/visit-requests/${lead.visit_request_id}`">到案件頁</router-link>
                </span>
              </template>
              <template v-else-if="canHandle">
                <el-button type="primary" :disabled="busy !== null" @click="convert(lead)">轉成參觀案件</el-button>
                <el-button
                  v-if="lead.status === 'new'"
                  :loading="isBusy(lead, 'dismiss')"
                  :disabled="busy !== null"
                  @click="setStatus(lead, 'dismiss')"
                >略過</el-button>
                <el-button
                  v-else
                  :loading="isBusy(lead, 'restore')"
                  :disabled="busy !== null"
                  @click="setStatus(lead, 'restore')"
                >放回</el-button>
              </template>
            </div>
          </li>
        </ul>
      </template>
    </template>

    <ManualVisitDialog
      v-model="dialogOpen"
      :campus-keys="visibleCampusKeys"
      :default-campus="campus"
      :meta-lead="converting"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
/* 頁首動作區的寬度跟著內容走：沒接上的分校沒有「立即同步」鈕，下拉不給寬度會縮到只剩箭頭。 */
.ml-campus.el-select { width: 160px; }

.ml-sync {
  margin: 0 0 12px;
}

.ml-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.ml-none {
  margin-top: 16px;
}

.ml-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.ml-lead {
  display: grid;
  gap: 8px;
  padding: 16px;
  margin: 0;
}

.ml-lead__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.ml-lead__name {
  color: var(--ink);
  overflow-wrap: anywhere;
}

.ml-lead__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.ml-lead__answers {
  margin: 0;
  display: grid;
  gap: 4px;
  font-size: var(--text-sm);
}

.ml-lead__answer {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
}

.ml-lead__answer dt {
  color: var(--ink-2);
}

.ml-lead__answer dt::after {
  content: '：';
}

.ml-lead__answer dd {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.ml-lead__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

/* 頁首在 720px 以下改直排（PageHeader），下拉跟「立即同步」一樣佔滿一行。 */
@media (max-width: 720px) {
  .ml-campus.el-select { width: 100%; }
}
</style>
