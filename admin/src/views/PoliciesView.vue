<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import PageHeader from '../components/PageHeader.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

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
const loadError = ref<string | null>(null)
const isDirty = computed(() => Boolean(snapshot.value) && JSON.stringify(settings.value) !== snapshot.value)
useUnsavedChanges(isDirty, computed(() => savingSettings.value || runningRetention.value))

const retentionDays = ref(365)
const retentionReport = ref<RetentionReport | null>(null)
const checkedDays = ref<number | null>(null)
const runningRetention = ref(false)
watch(retentionDays, () => { retentionReport.value = null; checkedDays.value = null })

async function loadSettings() {
  loading.value = true
  loadError.value = null
  try {
    settings.value = await api.get<SiteSettingsOut>('/admin/site-settings')
    snapshot.value = JSON.stringify(settings.value)
  } catch {
    loadError.value = '無法讀取全站設定，請重新載入。'
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (loading.value || loadError.value || savingSettings.value || !isDirty.value) return
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
    <PageHeader lead="搜尋引擎相關設定與個資保存政策，只有總管理者可以修改。這一頁不經過草稿，儲存後官網立即生效。" />

    <section class="panel">
      <div class="panel__head"><h2>搜尋與分享</h2></div>
      <div class="panel__body">
        <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button @click="loadSettings">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="loading" animated :rows="4" />
        <el-form v-else label-position="top" :disabled="savingSettings" :aria-busy="savingSettings" @submit.prevent="saveSettings">
          <el-form-item label="站名（後台識別用）">
            <el-input v-model="settings.title" />
            <span class="field-help">官網分頁標題在 <router-link to="/content/site-meta">網站標題與電話</router-link> 修改。</span>
          </el-form-item>
          <el-form-item label="預設描述">
            <el-input v-model="settings.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
          </el-form-item>
          <el-form-item label="搜尋引擎" class="stacked-field">
            <el-checkbox v-model="settings.noindex">暫時不讓 Google 收錄（上線前）</el-checkbox>
            <span class="field-help">
              {{ settings.noindex ? '目前搜尋不到官網。正式上線時要取消勾選，家長才找得到。' : '官網可以被搜尋引擎收錄。' }}
            </span>
          </el-form-item>
          <el-form-item label="隱私政策版本">
            <el-input v-model="settings.privacy_policy_version" placeholder="例如：2026-09" />
            <span class="field-help">改版後家長送出表單時會記錄同意的是哪一版。</span>
          </el-form-item>
          <div class="save-row">
            <el-button type="primary" :loading="savingSettings" :disabled="!isDirty" @click="saveSettings">
              儲存並套用到官網
            </el-button>
            <span class="live-note">沒有草稿階段，儲存後官網立即套用。</span>
            <span v-if="isDirty" class="dirty-note" role="status">有未儲存的修改</span>
          </div>
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
/* 勾選框是 inline，說明會被排到同一行；其他欄位的說明都在下方，統一成直排。 */
.stacked-field :deep(.el-form-item__content) {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
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
