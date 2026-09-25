<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import PageHeader from '../components/PageHeader.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

// 官網的描述、分享圖與是否允許收錄只以「網站標題與電話」（site_meta）為準，
// 有草稿與發布流程；這裡只讀官網目前發布中的值給總管理者核對。舊的
// /admin/site-settings 官網從來不讀，已不再使用。
interface PublishedSiteMeta {
  description?: string
  share_image?: string
  allow_indexing?: boolean
}

interface RetentionReport {
  candidate_count: number
  candidate_ids: string[]
}

const siteMeta = ref<PublishedSiteMeta | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const retentionDays = ref(365)
const retentionReport = ref<RetentionReport | null>(null)
const checkedDays = ref<number | null>(null)
const runningRetention = ref(false)
useUnsavedChanges(computed(() => false), runningRetention)
watch(retentionDays, () => { retentionReport.value = null; checkedDays.value = null })

async function loadSettings() {
  loading.value = true
  loadError.value = null
  try {
    const site = await api.get<{ content?: { site_meta?: PublishedSiteMeta } }>('/public/site')
    siteMeta.value = site.content?.site_meta ?? null
  } catch {
    loadError.value = '無法讀取官網目前的設定，請重新載入。'
  } finally {
    loading.value = false
  }
}

// 官網沒有發布過 site_meta 時沿用內建設定：允許收錄（仍受部署設定限制）。
const allowIndexing = computed(() => siteMeta.value?.allow_indexing !== false)

async function dryRunRetention() {
  if (runningRetention.value) return
  const days = retentionDays.value
  retentionReport.value = null
  checkedDays.value = null
  runningRetention.value = true
  try {
    retentionReport.value = await api.post<RetentionReport>(`/admin/retention/dry-run?older_than_days=${days}`)
    checkedDays.value = days
  } catch {
    ElMessage.error('查詢失敗')
  } finally {
    runningRetention.value = false
  }
}

async function runRetention() {
  if (!retentionReport.value || runningRetention.value || checkedDays.value !== retentionDays.value) return
  const days = checkedDays.value
  runningRetention.value = true
  try {
    await ElMessageBox.confirm(
      `將把 ${retentionReport.value.candidate_count} 筆超過 ${checkedDays.value} 天的已取消／未到場案件的姓名、電話、問題改成匿名文字，無法復原。`,
      '確定執行清理？',
      { confirmButtonText: '執行清理', cancelButtonText: '先不要', type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    runningRetention.value = false
    return
  }
  try {
    await api.post(`/admin/retention/run?older_than_days=${days}`)
    ElMessage.success('已執行清理')
    retentionReport.value = null
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.warning(detail !== null && typeof detail === 'object' ? (detail.message ?? '無法確認清理結果，請重新檢查數量。') : typeof detail === 'string' ? detail : '無法確認清理結果，請重新檢查數量。')
    } else {
      ElMessage.error('無法確認清理結果，請重新檢查數量後再操作。')
    }
  } finally {
    retentionReport.value = null
    checkedDays.value = null
    runningRetention.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="個資保存政策，以及官網搜尋與分享設定的總覽。個資清理只有總管理者可以執行。" />

    <section class="panel">
      <div class="panel__head"><h2>搜尋與分享</h2></div>
      <div class="panel__body">
        <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button @click="loadSettings">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="loading" animated :rows="4" />
        <template v-else>
          <p class="page-lead">
            官網的網站描述、社群分享圖與是否允許搜尋引擎收錄，都在<router-link to="/content/site-meta">網站標題與電話</router-link>修改，發布後才會套用到官網。這裡顯示的是官網目前發布中的設定。
          </p>
          <dl class="seo-summary">
            <div>
              <dt>搜尋引擎收錄</dt>
              <dd>
                <strong>{{ allowIndexing ? '允許收錄' : '不允許收錄' }}</strong>
                <span class="field-help">要同時符合兩個條件官網才會被收錄：部署設定開啟正式索引，而且這裡是允許收錄。任一個關閉，各頁、robots.txt 與 sitemap.xml 都會請搜尋引擎不要收錄。</span>
              </dd>
            </div>
            <div>
              <dt>網站描述</dt>
              <dd>{{ siteMeta?.description || '沿用官網內建的描述' }}</dd>
            </div>
            <div>
              <dt>社群分享圖</dt>
              <dd>{{ siteMeta?.share_image ? '已選擇分享圖' : '沿用首頁大圖' }}</dd>
            </div>
            <div>
              <dt>家長同意的版本</dt>
              <dd>家長送出參觀需求時，案件會記錄當時發布中的<router-link to="/content/booking-content">預約文案</router-link>同意說明版本，在案件明細可以看到。</dd>
            </div>
          </dl>
          <p v-if="!siteMeta" class="field-help">官網還沒發布過網站標題與電話，目前沿用內建設定。</p>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h2>個資清理</h2></div>
      <div class="panel__body">
        <p class="page-lead">
          只處理已取消或未到場、且超過指定天數的案件，把姓名、電話、問題改成匿名文字；進行中的案件不受影響。先檢查數量，確認後才真的執行。
        </p>
        <div class="retention">
          <span>清理</span>
          <el-input-number v-model="retentionDays" :disabled="runningRetention" :min="30" :max="3650" :step="30" aria-label="天數" />
          <span>天前結案的案件</span>
          <el-button :loading="runningRetention" @click="dryRunRetention">檢查數量</el-button>
        </div>
        <div v-if="retentionReport" class="retention__result">
          <p>
            超過 <strong class="num">{{ checkedDays }}</strong> 天的案件共
            <strong class="num">{{ retentionReport.candidate_count }}</strong> 筆符合清理條件。
          </p>
          <el-button
            type="danger"
            plain
            :loading="runningRetention"
            :disabled="retentionReport.candidate_count === 0"
            @click="runRetention"
          >
            執行清理
          </el-button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.seo-summary {
  display: grid;
  gap: 12px;
  margin: 0 0 16px;
}

.seo-summary > div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
}

.seo-summary dt {
  color: var(--ink-3);
}

.seo-summary dd {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  .seo-summary > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}

.retention {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.retention__result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}
</style>
