<script setup lang="ts">
// 分校停用／重新啟用（規格 3.2）。只有總管理者看得到。停用＝整校從官網下架：
// 分校網址顯示找不到頁面，首頁五校區塊、選單與頁尾都不再列出這一校，家長也
// 不能再送出預約（後端 content/service.py 排除停用校區的內容）。歷史案件、
// 素材與紀錄都保留，進行中的案件不會被取消。
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
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
// 讀到的啟用狀態（讀不到是 null）：預約方式頁依此決定卡片放頁首還是頁尾。
const emit = defineEmits<{ (e: 'status', active: boolean | null): void }>()
const router = useRouter()
const campus = ref<CampusStatus | null>(null)
const loading = ref(false)
const loadError = ref(false)
const busy = ref(false)
let loadVersion = 0

async function load() {
  const version = ++loadVersion
  campus.value = null
  loadError.value = false
  if (!props.campusKey) return
  loading.value = true
  try {
    const result = await api.get<CampusStatus>(`/admin/campuses/${props.campusKey}`)
    if (version !== loadVersion) return
    if (!result || typeof result.active !== 'boolean') throw new Error('unexpected campus status')
    campus.value = result
    emit('status', result.active)
  } catch {
    // 讀不到時不要整張卡默默消失：停用與否是大事，留下原因與重試入口。
    if (version === loadVersion) {
      loadError.value = true
      emit('status', null)
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}
watch(() => props.campusKey, load, { immediate: true })

async function deactivate() {
  const name = `${campusLabel(props.campusKey)}校`
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(
      `停用後${name}會從官網下架：分校網址會顯示找不到頁面，首頁五校區塊、選單與頁尾都不再列出，家長也不能再預約。已收到的案件不會被取消，會列入參觀案件的「待人工處理」，需要另外聯絡。重新啟用後恢復顯示。`,
      `停用${name}？`,
      { confirmButtonText: '停用分校', cancelButtonText: '先不要', confirmButtonClass: 'el-button--danger', inputPlaceholder: '原因（選填），例如：整修中', type: 'warning', inputValidator: (v: string) => (v ?? '').length <= 200 || '最多 200 字' },
    )
    reason = (result as { value: string }).value ?? ''
  } catch {
    return
  }
  await update(false, reason.trim() || null)
}

async function update(active: boolean, reason: string | null) {
  busy.value = true
  const name = `${campusLabel(props.campusKey)}校`
  try {
    const result = await api.patch<CampusStatus>(`/admin/campuses/${props.campusKey}/status`, { active, reason })
    campus.value = result
    if (!active && (result.open_requests ?? 0) > 0) {
      ElMessage.warning(`已停用，${name}已從官網下架。還有 ${result.open_requests} 件進行中的案件，已列入「待人工處理」，請逐一聯絡。`)
    } else {
      ElMessage.success(active ? `已重新啟用，官網恢復顯示${name}，並依原本的預約方式開放` : `已停用，${name}已從官網下架`)
    }
    emit('status', typeof result.active === 'boolean' ? result.active : active)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '更新失敗，請再試一次'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="loadError" class="panel campus-status">
    <div class="panel__body campus-status__body">
      <p class="hint">無法讀取分校目前是啟用還是停用。</p>
      <el-button :loading="loading" @click="load">重新載入</el-button>
    </div>
  </div>
  <div v-else-if="campus" class="panel campus-status" :class="{ 'is-off': !campus.active }">
    <div class="panel__body campus-status__body">
      <div class="campus-status__text">
        <strong>{{ campus.active ? '分校啟用中' : '分校已停用' }}</strong>
        <p v-if="!campus.active" class="hint">
          {{ campus.deactivated_at ? `${formatDateTime(campus.deactivated_at)} 停用` : '已停用' }}{{ campus.deactivated_reason ? `・${campus.deactivated_reason}` : '' }}。這一校已從官網下架：分校網址顯示找不到頁面，首頁五校區塊、選單與頁尾都不列出，家長不能預約。下面的預約設定會在重新啟用後生效。
        </p>
        <p v-else class="hint">停用後這一校會從官網下架：分校頁、首頁五校區塊、選單與頁尾都不再顯示，分校網址會顯示找不到頁面，家長也不能再預約。已收到的案件與內容都會保留，重新啟用後恢復。</p>
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
.campus-status__text { flex: 1 1 320px; min-width: 0; }
.campus-status__body p { margin: 4px 0 0; }
.campus-status__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.campus-status__actions .el-button + .el-button { margin-left: 0; }
</style>
