<script setup lang="ts">
// 人工補登（規格 6.2）：電話、LINE、現場或外部預約網站來的參觀需求，
// 由園方在後台建案並記錄建立人。欄位規則與官網表單相同。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { MANUAL_VISIT_SOURCES, VISIT_SOURCE_LABELS } from '../api/labels'
import CampusSelect from './CampusSelect.vue'

const props = defineProps<{
  modelValue: boolean
  campusKeys: readonly string[]
  /** 重新預約時帶入舊案，預填校區與家長資料並建立關聯 */
  relatedFrom?: VisitRequestDetailOut | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'created', value: VisitRequestDetailOut): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

function blank() {
  return {
    campus_key: '',
    source: 'phone' as (typeof MANUAL_VISIT_SOURCES)[number],
    parent_name: '',
    phone: '',
    child_name: '',
    child_birthdate: null as string | null,
    email: '',
    preferred_time: '',
    questions: '',
  }
}

const form = reactive(blank())
const saving = ref(false)
const fieldError = ref<string | null>(null)

watch(visible, (open) => {
  if (!open) return
  Object.assign(form, blank())
  fieldError.value = null
  const from = props.relatedFrom
  if (from) {
    form.campus_key = from.campus_key
    form.parent_name = from.parent_name
    form.phone = from.phone
    form.child_name = from.child_name ?? ''
    form.child_birthdate = from.child_birthdate ?? null
    form.email = from.email ?? ''
  } else if (props.campusKeys.length === 1) {
    form.campus_key = props.campusKeys[0]!
  }
})

const canSubmit = computed(() => Boolean(form.campus_key && form.parent_name.trim() && form.phone.trim()))

function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  fieldError.value = null
  try {
    const created = await api.post<VisitRequestDetailOut>('/admin/visit-requests', {
      campus_key: form.campus_key,
      source: form.source,
      parent_name: form.parent_name.trim(),
      phone: form.phone.trim(),
      child_name: form.child_name.trim() || null,
      child_birthdate: form.child_birthdate || null,
      email: form.email.trim() || null,
      preferred_time: form.preferred_time.trim() || null,
      questions: form.questions.trim() || null,
      related_request_id: props.relatedFrom?.id ?? null,
    })
    ElMessage.success('已建立案件')
    visible.value = false
    emit('created', created)
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      fieldError.value = '有欄位格式不對：手機需為 09 開頭的 10 碼，Email 要是完整地址。'
    } else if (err instanceof ApiError && typeof err.detail === 'string') {
      fieldError.value = err.detail
    } else {
      fieldError.value = '建立失敗，請稍後再試。'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="relatedFrom ? '重新預約（另建新案）' : '人工補登參觀需求'" width="520px" append-to-body>
    <p class="hint dialog-lead">
      {{ relatedFrom ? '舊案保持結案，新案會記下是從哪一筆重新預約。換到別校需要總管理者。' : '家長打電話、傳 LINE 或直接到園時，在這裡建案，之後照一般案件處理。' }}
    </p>
    <el-form label-position="top" @submit.prevent="submit">
      <div class="form-row">
        <el-form-item label="校區" required>
          <CampusSelect v-model="form.campus_key" :keys="campusKeys" />
        </el-form-item>
        <el-form-item label="來源" required>
          <el-select v-model="form.source">
            <el-option v-for="s in MANUAL_VISIT_SOURCES" :key="s" :label="VISIT_SOURCE_LABELS[s]" :value="s" />
          </el-select>
        </el-form-item>
      </div>
      <div class="form-row">
        <el-form-item label="家長稱呼" required>
          <el-input v-model="form.parent_name" maxlength="40" />
        </el-form-item>
        <el-form-item label="手機" required>
          <el-input v-model="form.phone" inputmode="tel" placeholder="0912345678" />
        </el-form-item>
      </div>
      <div class="form-row">
        <el-form-item label="孩子姓名">
          <el-input v-model="form.child_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="出生年月日">
          <el-date-picker v-model="form.child_birthdate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableFuture" style="width: 100%" />
        </el-form-item>
      </div>
      <el-form-item label="Email">
        <el-input v-model="form.email" type="email" />
      </el-form-item>
      <el-form-item label="方便聯絡時段">
        <el-input v-model="form.preferred_time" maxlength="32" placeholder="例如：平日上午" />
      </el-form-item>
      <el-form-item label="想了解的事">
        <el-input v-model="form.questions" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="1000" />
      </el-form-item>
      <el-alert v-if="fieldError" type="error" :closable="false" show-icon :title="fieldError" />
    </el-form>
    <template #footer>
      <el-button @click="visible = false">先不要</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">建立案件</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-lead { margin: 0 0 12px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .form-row { grid-template-columns: 1fr; } }
</style>
