<script setup lang="ts">
// 分校停用／重新啟用（規格 3.2）。只有總管理者看得到。停用後官網預約
// 顯示暫停、送單被擋；歷史案件、素材與紀錄都保留，進行中的案件不會被取消。
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { attentionListPath, campusLabel, formatDateTime } from '../api/labels'

interface CampusStatus {
  key: string
  name: string
  active: boolean
  deactivated_at?: string | null
  deactivated_reason?: string | null
  open_requests?: number
}

const props = defineProps<{ campusKey: string }>()
const router = useRouter()
const campus = ref<CampusStatus | null>(null)
const busy = ref(false)

async function load() {
  campus.value = null
  if (!props.campusKey) return
  try {
    campus.value = await api.get<CampusStatus>(`/admin/campuses/${props.campusKey}`)
  } catch {
    campus.value = null
  }
}
watch(() => props.campusKey, load, { immediate: true })

async function deactivate() {
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(
      '官網的預約按鈕會改成暫停說明，家長無法再送出需求。已收到的案件不會被取消，會列入參觀案件的「待人工處理」，需要另外聯絡。',
      `停用${campusLabel(props.campusKey)}校？`,
      { confirmButtonText: '停用', cancelButtonText: '先不要', inputPlaceholder: '原因（選填），例如：整修中', type: 'warning', inputValidator: (v: string) => (v ?? '').length <= 200 || '最多 200 字' },
    )
    reason = (result as { value: string }).value ?? ''
  } catch {
    return
  }
  await update(false, reason.trim() || null)
}

async function update(active: boolean, reason: string | null) {
  busy.value = true
  try {
    const result = await api.patch<CampusStatus>(`/admin/campuses/${props.campusKey}/status`, { active, reason })
    campus.value = result
    if (!active && (result.open_requests ?? 0) > 0) {
      ElMessage.warning(`已停用。還有 ${result.open_requests} 件進行中的案件，已列入「待人工處理」，請逐一聯絡。`)
    } else {
      ElMessage.success(active ? '已重新啟用，官網依原本的預約方式開放' : '已停用')
    }
  } catch {
    ElMessage.error('更新失敗')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="campus" class="panel campus-status" :class="{ 'is-off': !campus.active }">
    <div class="panel__body campus-status__body">
      <div>
        <strong>{{ campus.active ? '分校啟用中' : '分校已停用' }}</strong>
        <p v-if="!campus.active" class="hint">
          {{ campus.deactivated_at ? `${formatDateTime(campus.deactivated_at)} 停用` : '已停用' }}{{ campus.deactivated_reason ? `・${campus.deactivated_reason}` : '' }}。官網顯示暫停預約，下面的設定會在重新啟用後生效。
        </p>
        <p v-else class="hint">停用後官網停止收件，歷史案件與內容都會保留。</p>
      </div>
      <div class="campus-status__actions">
        <el-button v-if="!campus.active" text @click="router.push(attentionListPath(campus.key))">看待人工處理的案件</el-button>
        <el-button v-if="campus.active" :loading="busy" type="danger" plain @click="deactivate">停用分校</el-button>
        <el-button v-else :loading="busy" type="primary" @click="update(true, null)">重新啟用</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.campus-status { margin-bottom: 16px; }
.campus-status.is-off { border-color: var(--brand-gold); }
.campus-status__body { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.campus-status__body p { margin: 4px 0 0; }
.campus-status__actions { display: flex; gap: 8px; }
</style>
