<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { listAdmissionsStaff, updateFollowUp } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsStaff, FollowUpUpdate, RecruitmentVisit } from '../../api/types'
import { ANONYMIZED_CONFLICT_TEXT } from '../../admissions/constants'
import { followUpText, isOpenStage, resolveNextFollowUp, type NextFollowUpChoice } from '../../admissions/followUp'
import { notifyError, notifyWarning } from '../../composables/notify'
import NextFollowUpPicker from './NextFollowUpPicker.vue'

// 只改下次聯絡或追蹤負責人，不記聯絡（docs/specs/2026-10-04-admissions-follow-up-design.md 6.4）。
// 沒動的欄位不送：只換負責人時下次聯絡維持原樣。
export type FollowUpTarget = {
  id: string
  version: number
  child_name: string
  stage: string
  follow_up_at: string | null
  follow_up_owner_id: string | null
}

const props = defineProps<{ target: FollowUpTarget | null; campusKey: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

const staff = ref<AdmissionsStaff[]>([])
const staffError = ref(false)
const nextChoice = ref<NextFollowUpChoice>('')
const nextCustom = ref<string | null>(null)
const owner = ref<string | null>(null)
const pending = ref(false)

const closed = computed(() => !isOpenStage(props.target?.stage))
const title = computed(() => (props.target?.follow_up_at ? '改下次聯絡或負責人' : '排下次聯絡'))
const nextValue = computed(() => resolveNextFollowUp(nextChoice.value, nextCustom.value))
// 負責人已停用或不在可指派清單：選單裡另外列出目前的值，才不會顯示成一串 id。
const ownerMissing = computed(() => Boolean(props.target?.follow_up_owner_id && !staff.value.some((s) => s.id === props.target?.follow_up_owner_id)))
const ownerChanged = computed(() => (owner.value ?? null) !== (props.target?.follow_up_owner_id ?? null))
const followUpChanged = computed(() => nextChoice.value !== '' && nextValue.value !== undefined)
const canSubmit = computed(() => !pending.value && (ownerChanged.value || followUpChanged.value))

async function loadStaff() {
  staffError.value = false
  try {
    const result = await listAdmissionsStaff(props.campusKey)
    staff.value = Array.isArray(result) ? result : []
  } catch {
    staff.value = []
    staffError.value = true
  }
}

watch(open, (value) => {
  if (!value) return
  nextChoice.value = ''
  nextCustom.value = null
  owner.value = props.target?.follow_up_owner_id ?? null
  void loadStaff()
})

async function submit() {
  const target = props.target
  if (!target || !canSubmit.value) return
  const body: FollowUpUpdate = { expected_version: target.version }
  if (followUpChanged.value) body.follow_up_at = nextValue.value ?? null
  if (ownerChanged.value) body.follow_up_owner_id = owner.value ?? null
  pending.value = true
  try {
    const visit = await updateFollowUp(target.id, body)
    if (followUpChanged.value) {
      ElMessage.success(visit.follow_up_at ? `已排下次聯絡 ${followUpText(visit.follow_up_at)}` : '已清除下次聯絡，不再列入待追蹤')
    } else {
      ElMessage.success('已換追蹤負責人')
    }
    open.value = false
    emit('saved', visit)
  } catch (err) {
    if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
      notifyWarning(ANONYMIZED_CONFLICT_TEXT)
      open.value = false
      emit('stale')
    } else if (isVersionConflict(err) || (err instanceof ApiError && err.status === 404)) {
      ElMessage.info('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
      open.value = false
      emit('stale')
    } else {
      notifyError(apiErrorMessage(err, '儲存失敗'))
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="follow-up-dialog"
    :title="title"
    width="min(580px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!pending"
    :show-close="!pending"
  >
    <p class="follow-up__child">幼生：{{ target?.child_name }}</p>
    <el-form label-position="top" :disabled="pending" @submit.prevent>
      <el-form-item label="下次聯絡">
        <NextFollowUpPicker
          v-model="nextChoice"
          v-model:custom="nextCustom"
          :closed="closed"
          :none-label="target?.follow_up_at ? '清除（不用再追）' : '不排'"
        />
        <p class="field-help follow-up__current">
          {{ target?.follow_up_at ? `不選＝維持目前的 ${followUpText(target.follow_up_at)}` : '目前沒有排下次聯絡' }}
        </p>
      </el-form-item>
      <el-form-item label="追蹤負責人">
        <el-select v-model="owner" clearable placeholder="未指派" aria-label="追蹤負責人" class="follow-up__owner">
          <el-option v-if="ownerMissing && target?.follow_up_owner_id" :value="target.follow_up_owner_id" label="目前的負責人（已停用）" disabled />
          <el-option v-for="person in staff" :key="person.id" :value="person.id" :label="person.display_name || person.email" />
        </el-select>
        <p v-if="staffError" class="field-help">讀不到可指派的同事，請稍後再試。</p>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="pending" @click="open = false">取消</el-button>
      <el-button type="primary" :loading="pending" :disabled="!canSubmit" @click="submit">儲存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.follow-up__child {
  margin: 0 0 12px;
  font-weight: 600;
}

.follow-up__current {
  margin: 4px 0 0;
}

.follow-up__owner {
  width: 100%;
}
</style>
