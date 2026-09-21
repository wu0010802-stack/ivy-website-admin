<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import PageHeader from '../components/PageHeader.vue'

interface SiteSettingsOut {
  title: string
  description: string
  share_image: string | null
  noindex: boolean
  privacy_policy_version: string
}

interface RetentionReport {
  candidate_count: number
  candidate_ids: string[]
}

const settings = ref<SiteSettingsOut>({
  title: '',
  description: '',
  share_image: null,
  noindex: true,
  privacy_policy_version: '',
})
const snapshot = ref('')
const loading = ref(true)
const savingSettings = ref(false)
const isDirty = computed(() => JSON.stringify(settings.value) !== snapshot.value)

const retentionDays = ref(365)
const retentionReport = ref<RetentionReport | null>(null)
const checkedDays = ref<number | null>(null)
const runningRetention = ref(false)

async function loadSettings() {
  loading.value = true
  try {
    settings.value = await api.get<SiteSettingsOut>('/admin/site-settings')
    snapshot.value = JSON.stringify(settings.value)
  } catch {
    ElMessage.error('無法讀取全站設定')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    settings.value = await api.patch<SiteSettingsOut>('/admin/site-settings', settings.value)
    snapshot.value = JSON.stringify(settings.value)
    ElMessage.success('已更新全站設定')
  } catch (err) {
    ElMessage.error(err instanceof ApiError && err.status === 403 ? '只有總管理者可以修改全站設定' : '更新失敗')
  } finally {
    savingSettings.value = false
  }
}

async function dryRunRetention() {
  runningRetention.value = true
  try {
    retentionReport.value = await api.post<RetentionReport>(`/admin/retention/dry-run?older_than_days=${retentionDays.value}`)
    checkedDays.value = retentionDays.value
  } catch {
    ElMessage.error('查詢失敗')
  } finally {
    runningRetention.value = false
  }
}

async function runRetention() {
  if (!retentionReport.value) return
  try {
    await ElMessageBox.confirm(
      `將把 ${retentionReport.value.candidate_count} 筆超過 ${checkedDays.value} 天的已取消／未到場案件的姓名、電話、問題改成匿名文字，無法復原。`,
      '確定執行清理？',
      { confirmButtonText: '執行清理', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  runningRetention.value = true
  try {
    await api.post(`/admin/retention/run?older_than_days=${checkedDays.value}`)
    ElMessage.success('已執行清理')
    retentionReport.value = null
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.warning(typeof detail === 'object' ? (detail.message ?? '此環境未開放真正清理') : detail)
    }
  } finally {
    runningRetention.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="搜尋引擎相關設定與個資保存政策，只有總管理者可以修改。" />

    <section class="panel">
      <div class="panel__head"><h2>搜尋與分享</h2></div>
      <div class="panel__body">
        <el-skeleton v-if="loading" animated :rows="4" />
        <el-form v-else label-position="top" @submit.prevent="saveSettings">
          <el-form-item label="站名（後台識別用）">
            <el-input v-model="settings.title" />
            <span class="field-help">官網分頁標題在 <router-link to="/content/site-meta">網站標題與電話</router-link> 修改。</span>
          </el-form-item>
          <el-form-item label="預設描述">
            <el-input v-model="settings.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
          </el-form-item>
          <el-form-item label="搜尋引擎">
            <el-switch v-model="settings.noindex" active-text="不索引（上線前）" inactive-text="允許索引" />
            <span class="field-help">
              {{ settings.noindex ? '目前 Google 不會收錄官網，正式上線時記得關閉。' : '官網可被搜尋引擎收錄。' }}
            </span>
          </el-form-item>
          <el-form-item label="隱私政策版本">
            <el-input v-model="settings.privacy_policy_version" placeholder="例如：2026-09" />
            <span class="field-help">改版後家長送出表單時會記錄同意的是哪一版。</span>
          </el-form-item>
          <el-button type="primary" :loading="savingSettings" :disabled="!isDirty" @click="saveSettings">儲存</el-button>
        </el-form>
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
          <el-input-number v-model="retentionDays" :min="30" :max="3650" :step="30" aria-label="天數" />
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
