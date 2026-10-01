<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { transition, transitionRequest } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage } from '../../api/errors'
import type { RecruitmentVisit } from '../../api/types'
import { currentTerm, outsideRocRange, schoolYearOptions, taipeiToday } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, GRADES, SEMESTER_LABELS, STAGE_LABELS, transitionMode, transitionWarning, type Grade, type TransitionTarget } from '../../admissions/constants'

// 狀態轉換確認框（園務 TransitionConfirmDialog）。標題「{起} → {迄}」、首行幼生姓名、四種模式：
// 預繳記收預繳人員；註冊填註冊日期、年級、入學學年學期（官網沒有班級，取代園務的選班）；
// 退出與從已註冊往回要原因；其餘只確認。提到學費管理、學生檔的文案改寫（本檔調整第 9 條）。
const props = defineProps<{ target: TransitionTarget | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [visit: RecruitmentVisit]; stale: [] }>()

const collector = ref('')
const reason = ref('')
const enrolledOn = ref<string | null>(null)
const grade = ref<Grade | null>(null)
const year = ref<number | null>(null)
const semester = ref<1 | 2>(1)
const submitting = ref(false)

const mode = computed(() => (props.target ? transitionMode(props.target.from, props.target.to) : 'confirm'))
const warning = computed(() => (props.target ? transitionWarning(props.target.from, props.target.to) : ''))
const title = computed(() => (props.target ? `${STAGE_LABELS[props.target.from]} → ${STAGE_LABELS[props.target.to]}` : ''))
const defaultYear = currentTerm().schoolYear
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [1, 0, -1])
  return year.value && !years.includes(year.value) ? [...years, year.value].sort((a, b) => b - a) : years
})

watch(open, (value) => {
  const card = props.target?.card
  if (!value || !card) return
  collector.value = ''
  reason.value = ''
  enrolledOn.value = taipeiToday()
  // 註冊年級預設保留座位的年級，沒有就用適讀班級（名額規劃的已註冊以 COALESCE(provisional_grade, grade) 歸列）。
  grade.value = ((card.provisional_grade ?? card.grade) as Grade | null | undefined) ?? null
  year.value = card.target_school_year ?? defaultYear
  semester.value = card.target_semester === 2 ? 2 : 1
})

const ready = computed(() => {
  if (mode.value === 'enroll') return Boolean(enrolledOn.value && grade.value && year.value)
  if (mode.value === 'destructive') return reason.value.trim() !== ''
  return true
})

function fields() {
  if (mode.value === 'deposit') return { deposit_collector: collector.value.trim() || null }
  if (mode.value === 'enroll') {
    return { enrolled_on: enrolledOn.value, grade: grade.value, target_school_year: year.value, target_semester: semester.value }
  }
  if (mode.value === 'destructive') return { reason: reason.value.trim() }
  return {}
}

async function submit() {
  const target = props.target
  if (!target || !ready.value || submitting.value) return
  submitting.value = true
  try {
    const visit = await transition(target.card.id, transitionRequest(target.to, target.card.version, fields()))
    ElMessage.success('已更新階段')
    open.value = false
    emit('done', visit)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // 後端先比對版本再判權限（A 調整第 10 條）：別人剛改過一律 409。園務同樣強制重載看板。
      // 已依保存政策匿名化的訪視也是 409，但原因不同，另外說明（R5）。
      if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') ElMessage.warning(ANONYMIZED_CONFLICT_TEXT)
      else ElMessage.info('狀態已被其他人變更，已自動重新載入')
      open.value = false
      emit('stale')
    } else if (err instanceof ApiError && err.status === 403) {
      ElMessage.warning('無權限執行此操作')
    } else {
      ElMessage.error(apiErrorMessage(err, '操作失敗，請稍後再試'))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="transition-dialog"
    :title="title"
    width="min(480px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <p class="transition__child">幼生：{{ target?.card.child_name }}</p>
    <el-alert v-if="warning" :type="mode === 'destructive' ? 'warning' : 'info'" :closable="false" show-icon :title="warning" class="transition__warning" />
    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item v-if="mode === 'deposit'" label="收預繳人員">
        <el-input v-model="collector" maxlength="50" placeholder="誰收的（選填）" aria-label="收預繳人員" />
        <span class="field-help">這裡只記錄招生端的預繳狀態，實際收款與收據照園內原本的方式處理。</span>
      </el-form-item>
      <template v-else-if="mode === 'enroll'">
        <el-form-item label="註冊日期" required>
          <el-date-picker v-model="enrolledOn" type="date" value-format="YYYY-MM-DD" placeholder="選擇註冊日期" aria-label="註冊日期" :disabled-date="outsideRocRange" style="width: 100%" />
        </el-form-item>
        <el-form-item label="年級" required>
          <el-select v-model="grade" placeholder="請選擇年級" aria-label="年級" style="width: 100%">
            <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="入學學期" required>
          <div class="transition__term">
            <el-select v-model="year" placeholder="學年" aria-label="入學學年">
              <el-option v-for="item in yearChoices" :key="item" :label="`${item} 學年`" :value="item" />
            </el-select>
            <el-radio-group v-model="semester" aria-label="入學學期">
              <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
              <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
            </el-radio-group>
          </div>
          <span class="field-help">標記後會算進這個學期名額規劃的「已註冊」。官網沒有學生資料，學號與編班等併入園務系統後再處理。</span>
        </el-form-item>
      </template>
      <el-form-item v-else-if="mode === 'destructive'" label="原因（必填）">
        <el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" placeholder="請說明退回原因" aria-label="原因" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="submitting" @click="open = false">取消</el-button>
      <el-button :type="mode === 'destructive' ? 'danger' : 'primary'" :loading="submitting" :disabled="!ready" @click="submit">確認</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.transition__child {
  margin: 0 0 12px;
  color: var(--ink);
  font-weight: 500;
}

.transition__warning {
  margin-bottom: 16px;
}

.transition__term {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.transition__term .el-select {
  width: 120px;
}
</style>
