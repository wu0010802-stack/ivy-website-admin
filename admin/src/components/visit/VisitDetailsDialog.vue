<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorCode, apiErrorMessage, apiFieldError, isVersionConflict } from '../../api/errors'
import type { AdminDetailsUpdate, AdminDetailsUpdateOut, VisitRequestFullOut } from '../../api/types'
import { detailsNotices, emailError, normalizePhoneInput, phoneError, updateVisitDetails } from '../../api/visitDetails'
import { notifyWarning } from '../../composables/notify'

// 預約明細的「修改」（2026-10-12 規格 3.3）：園方人員代家長改稱呼、手機、Email、孩子姓名與生日。
// 只送有改的欄位，帶開啟當下的 details_version；家長同時用修改連結改過就會 409，不蓋掉對方。
// emailEnabled：該校有沒有設定寄信（vc.emailEnabled，讀不到是 null），決定怎麼講變更通知。
const props = withDefaults(defineProps<{ detail: VisitRequestFullOut; emailEnabled?: boolean | null }>(), { emailEnabled: null })
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [result: AdminDetailsUpdateOut]; reload: [] }>()

type FieldName = 'parent_name' | 'phone' | 'child_name' | 'child_birthdate' | 'email'
const FIELDS: FieldName[] = ['parent_name', 'phone', 'child_name', 'child_birthdate', 'email']

function snapshot() {
  const d = props.detail
  return {
    id: d.id,
    version: d.details_version,
    parent_name: d.parent_name,
    phone: d.phone,
    child_name: d.child_name ?? '',
    child_birthdate: d.child_birthdate ?? null,
    email: d.email ?? '',
  }
}

// 開啟當下的案件值與版本：背景重讀換掉 detail 時，打到一半的表單不跟著變，送出時由後端比版本。
const base = ref(snapshot())
const form = reactive({ parent_name: '', phone: '', child_name: '', child_birthdate: null as string | null, email: '' })
const submitting = ref(false)
const error = ref<string | null>(null)
const serverErrors = reactive<Partial<Record<FieldName, string>>>({})

watch(open, (value) => {
  if (!value) return
  base.value = snapshot()
  const { parent_name, phone, child_name, child_birthdate, email } = base.value
  Object.assign(form, { parent_name, phone, child_name, child_birthdate, email })
  error.value = null
  for (const field of FIELDS) delete serverErrors[field]
}, { immediate: true })

// 一動欄位就清掉後端上一次對該欄的意見。
watch(form, () => { for (const field of FIELDS) delete serverErrors[field] })

const trimmed = computed(() => ({
  parent_name: form.parent_name.trim(),
  phone: normalizePhoneInput(form.phone),
  child_name: form.child_name.trim(),
  child_birthdate: form.child_birthdate || null,
  email: form.email.trim(),
}))

// 和開啟時不同的欄位。Email、孩子姓名、孩子生日清空送 null；稱呼與手機不能清（下面檢查）。
const changes = computed(() => {
  const b = base.value
  const t = trimmed.value
  const out: Partial<Record<FieldName, string | null>> = {}
  if (t.parent_name !== b.parent_name) out.parent_name = t.parent_name
  if (t.phone !== b.phone) out.phone = t.phone
  if (t.child_name !== b.child_name) out.child_name = t.child_name || null
  if (t.child_birthdate !== b.child_birthdate) out.child_birthdate = t.child_birthdate
  if (t.email !== b.email) out.email = t.email || null
  return out
})

// 只檢查有改的欄位：沒動的欄位送不出去，舊資料格式不合新規則也不該擋住別的修改。
const errors = computed<Record<FieldName, string>>(() => {
  const t = trimmed.value
  const changed = changes.value
  return {
    parent_name: 'parent_name' in changed && !t.parent_name ? '請填家長稱呼' : '',
    phone: 'phone' in changed ? phoneError(t.phone) : '',
    child_name: '',
    child_birthdate: '',
    email: 'email' in changed && t.email ? emailError(t.email) : '',
  }
})
const fieldError = (field: FieldName) => errors.value[field] || serverErrors[field] || ''
const valid = computed(() => FIELDS.every((field) => !errors.value[field]))

function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

function announce(result: AdminDetailsUpdateOut) {
  const { success, warnings } = detailsNotices(result, props.emailEnabled)
  ElMessage.success({ message: success.join('。'), duration: success.length > 1 ? 6000 : 3000 })
  for (const warning of warnings) notifyWarning(warning)
}

async function submit() {
  if (submitting.value) return
  const diff = changes.value
  // 沒改任何欄位：不送、直接關。
  if (!Object.keys(diff).length) {
    open.value = false
    return
  }
  if (!valid.value) return
  submitting.value = true
  error.value = null
  try {
    const result = await updateVisitDetails(base.value.id, { expected_version: base.value.version, ...diff } as AdminDetailsUpdate)
    open.value = false
    announce(result)
    emit('saved', result)
  } catch (err) {
    if (isVersionConflict(err)) {
      open.value = false
      notifyWarning('家長或同事剛改過資料，已重新載入')
      emit('reload')
      return
    }
    if (apiErrorCode(err) === 'VISIT_REQUEST_ANONYMIZED') {
      open.value = false
      notifyWarning('這筆預約已依保存政策匿名化，不能再修改資料')
      emit('reload')
      return
    }
    // 422 指到哪一欄就寫在那一欄下面；其他錯誤（找不到、沒有權限、系統錯誤）寫在表單上方。
    let flagged = false
    for (const field of FIELDS) {
      const message = apiFieldError(err, field)
      if (message) {
        serverErrors[field] = message
        flagged = true
      }
    }
    if (!flagged) error.value = apiErrorMessage(err, '儲存失敗，請稍後再試')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="details-dialog"
    title="修改家長資料"
    width="min(520px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="details__alert" />

    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <div class="details__row">
        <el-form-item label="家長稱呼" required :error="fieldError('parent_name')">
          <el-input v-model="form.parent_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="手機" required :error="fieldError('phone')">
          <el-input v-model="form.phone" inputmode="tel" placeholder="0912345678" />
        </el-form-item>
      </div>
      <div class="details__row">
        <el-form-item label="孩子姓名" :error="fieldError('child_name')">
          <el-input v-model="form.child_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="孩子生日" :error="fieldError('child_birthdate')">
          <el-date-picker v-model="form.child_birthdate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableFuture" style="width: 100%" />
        </el-form-item>
      </div>
      <el-form-item label="Email" class="details__last" :error="fieldError('email')">
        <el-input v-model="form.email" type="email" maxlength="254" />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="details__buttons">
        <el-button :disabled="submitting" @click="open = false">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!valid" @click="submit">儲存</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.details__alert { margin-bottom: 16px; }
.details__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.details__last { margin-bottom: 0; }
.details__buttons { display: flex; justify-content: flex-end; gap: 8px; }
.details__buttons .el-button + .el-button { margin-left: 0; }
@media (max-width: 560px) {
  .details__row { grid-template-columns: minmax(0, 1fr); }
}
</style>
