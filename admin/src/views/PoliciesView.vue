<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'

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
const savingSettings = ref(false)

const retentionDays = ref(365)
const retentionReport = ref<RetentionReport | null>(null)
const runningRetention = ref(false)

async function loadSettings() {
  settings.value = await api.get<SiteSettingsOut>('/admin/site-settings')
}

async function saveSettings() {
  savingSettings.value = true
  try {
    settings.value = await api.patch<SiteSettingsOut>('/admin/site-settings', settings.value)
    ElMessage.success('已更新全站設定')
  } catch {
    ElMessage.error('更新失敗（可能沒有總管理者權限）')
  } finally {
    savingSettings.value = false
  }
}

async function dryRunRetention() {
  runningRetention.value = true
  try {
    retentionReport.value = await api.post<RetentionReport>(
      `/admin/retention/dry-run?older_than_days=${retentionDays.value}`
    )
  } catch {
    ElMessage.error('查詢失敗')
  } finally {
    runningRetention.value = false
  }
}

async function runRetention() {
  runningRetention.value = true
  try {
    await api.post(`/admin/retention/run?older_than_days=${retentionDays.value}`)
    ElMessage.success('已執行清理')
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.warning(
        typeof detail === 'object' ? (detail.message ?? '預設不開放真正清理') : detail
      )
    }
  } finally {
    runningRetention.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div style="max-width: 640px">
    <h2>全站設定與保存政策</h2>

    <h3>SEO / 全站設定</h3>
    <el-form label-position="top">
      <el-form-item label="標題">
        <el-input v-model="settings.title" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="settings.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="不索引（noindex）">
        <el-switch v-model="settings.noindex" />
      </el-form-item>
      <el-form-item label="隱私政策版本">
        <el-input v-model="settings.privacy_policy_version" />
      </el-form-item>
      <el-button type="primary" :loading="savingSettings" @click="saveSettings">儲存</el-button>
    </el-form>

    <h3 style="margin-top: 2rem">保存政策 / 資料清理</h3>
    <p style="color: var(--el-text-color-secondary)">
      只清理已取消／未到場、超過天數的案件，改成匿名化文字；還在進行中的案件不會被動到。預設不開放真正執行，只能先 dry-run。
    </p>
    <el-input-number v-model="retentionDays" :min="1" style="margin-bottom: 1rem" /> 天前
    <div>
      <el-button :loading="runningRetention" @click="dryRunRetention">Dry-run 檢查</el-button>
      <el-button type="danger" :loading="runningRetention" @click="runRetention">執行清理</el-button>
    </div>
    <el-descriptions v-if="retentionReport" :column="1" border style="margin-top: 1rem">
      <el-descriptions-item label="符合清理條件的案件數">
        {{ retentionReport.candidate_count }}
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>
