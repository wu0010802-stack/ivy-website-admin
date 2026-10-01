<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { formatDateTime, parentDeadlineLabel } from '../api/labels'
import type { ParentAccessLinkCreatedOut } from '../api/types'

// 家長管理連結（規格 6.4）：家長用它查看預約、改場次、修改資料或取消。完整網址只在
// 產生當下顯示一次（資料庫只存 hash），所以這裡只知道「有沒有、何時到期」；
// 遺失就重新產生並寄到家長信箱，舊連結同時失效。
const props = defineProps<{
  visitId: string
  accessLink: { created_at: string; expires_at: string } | null | undefined
  canHandle: boolean
  status: string
  email: string | null
  // 該校設定的線上異動期限（參觀前幾小時）；舊版 API 沒回時只講依本校設定。
  deadlineHours?: number | null
}>()
const emit = defineEmits<{ changed: [] }>()

const created = ref<ParentAccessLinkCreatedOut | null>(null)
const busy = ref(false)

// 換到另一筆案件時，不能留著上一筆的連結。
watch(() => props.visitId, () => { created.value = null })

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { message?: string } | string | null
    if (detail && typeof detail === 'object' && detail.message) return detail.message
    if (typeof detail === 'string') return detail
  }
  return fallback
}

async function generate() {
  if (props.accessLink || created.value) {
    try {
      await ElMessageBox.confirm(props.status === 'confirmed' && props.email ? '重新產生後，舊連結會立即失效，新連結會寄到家長信箱。' : '重新產生後，舊連結會立即失效，請把新連結直接交給家長。', '重新產生家長管理連結？', {
        confirmButtonText: '重新產生',
        cancelButtonText: '先不要',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  busy.value = true
  try {
    created.value = await api.post<ParentAccessLinkCreatedOut>(`/admin/visit-requests/${props.visitId}/access-link`)
    if (created.value.emailed) ElMessage.success('新連結已寄到家長信箱')
    emit('changed')
  } catch (err) {
    ElMessage.error(errorText(err, '產生連結失敗'))
  } finally {
    busy.value = false
  }
}

async function resend() {
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${props.visitId}/resend-confirmation`)
    ElMessage.success('已排入寄送，約一分鐘內寄到家長信箱')
  } catch (err) {
    ElMessage.error(errorText(err, '重寄失敗，請稍後再試'))
  } finally {
    busy.value = false
  }
}

async function revoke() {
  try {
    await ElMessageBox.confirm('撤銷後家長打開這條連結會看到「連結已失效」；需要時可以再產生新的。', '撤銷家長管理連結？', {
      confirmButtonText: '撤銷連結',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${props.visitId}/revoke-access`)
    created.value = null
    ElMessage.success('已撤銷，舊連結不能再使用')
    emit('changed')
  } catch (err) {
    ElMessage.error(errorText(err, '撤銷失敗'))
  } finally {
    busy.value = false
  }
}

function linkText(): string {
  return created.value?.manage_url ?? created.value?.manage_url_fragment ?? ''
}

async function copy() {
  try {
    await navigator.clipboard.writeText(linkText())
    ElMessage.success('已複製，可以貼到簡訊、LINE 或 Email 給家長')
  } catch {
    ElMessage.warning('無法自動複製，請選取連結後手動複製')
  }
}
</script>

<template>
  <section class="section access">
    <div class="section__title"><h2>家長管理連結</h2></div>
    <p class="hint">家長送出預約時已收到這條連結{{ email ? '（也寄到信箱）' : '' }}，可以改場次、修改資料或取消（{{ deadlineHours ? `${parentDeadlineLabel(deadlineHours)}截止` : '截止時間依本校預約設定' }}）。</p>

    <div v-if="created" class="access__created">
      <el-alert type="warning" :closable="false" show-icon title="連結只顯示這一次" description="離開這頁就看不到了；遺失請重新產生，舊連結會同時失效。" />
      <div class="access__copy">
        <el-input :model-value="linkText()" readonly aria-label="家長管理連結" @focus="(e: FocusEvent) => (e.target as HTMLInputElement).select()" />
        <el-button type="primary" @click="copy">複製連結</el-button>
      </div>
      <p v-if="!created.emailed" class="field-help">這次沒有寄信，請把連結直接交給家長（簡訊、LINE 或 Email）。</p>
      <p v-if="!created.manage_url" class="field-help">部署設定缺少 WEBSITE_ADMIN_ORIGIN，無法產生完整網址；請在官網網址後面接上這段再給家長。</p>
      <p class="hint">有效到 <span class="num">{{ formatDateTime(created.expires_at) }}</span></p>
    </div>
    <p v-else-if="accessLink" class="hint">
      目前連結有效到 {{ formatDateTime(accessLink.expires_at) }}（{{ formatDateTime(accessLink.created_at) }} 產生）。網址不會保存，要再給家長請重新產生。
    </p>
    <p v-else class="hint">還沒有產生連結。</p>

    <div v-if="canHandle" class="access__actions">
      <el-button v-if="status === 'confirmed' && email" :loading="busy" @click="resend">重寄確認信</el-button>
      <el-button :loading="busy" @click="generate">{{ accessLink || created ? '重新產生連結並寄出' : '產生連結' }}</el-button>
      <el-button v-if="accessLink || created" text type="danger" :disabled="busy" @click="revoke">撤銷連結</el-button>
    </div>
  </section>
</template>

<style scoped>
.access__created {
  display: grid;
  gap: 8px;
  margin: 8px 0;
}

.access__copy {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.access__copy .el-input {
  flex: 1;
  min-width: 0;
}

.access__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 480px) {
  .access__copy {
    flex-direction: column;
  }
}
</style>
