<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { transition, transitionRequest } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage } from '../../api/errors'
import type { RecruitmentVisit } from '../../api/types'
import { currentTerm, outsideRocRange, schoolYearOptions, taipeiToday } from '../../admissions/academic'
import {
  ANONYMIZED_CONFLICT_TEXT, GRADES, SEMESTER_LABELS, STAGE_LABELS, WITHDRAWN_FROM_LABELS, transitionMode, transitionWarning,
  type Grade, type Stage, type TransitionCard, type TransitionTarget,
} from '../../admissions/constants'
import { notifyError, notifyWarning } from '../../composables/notify'

// 狀態轉換確認框（園務 TransitionConfirmDialog）。標題「{起} → {迄}」、首行幼生姓名、四種模式：
// 預繳記收預繳人員；註冊填註冊日期、年級、入學學年學期（官網沒有班級，取代園務的選班）；
// 退出與從已註冊往回要原因；其餘只確認。提到學費管理、學生檔的文案改寫（本檔調整第 9 條）。
// 退出欄標題寫具體的退預繳或退註冊；確認鍵寫出這一步做什麼，不只寫「確認」。
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

// 看板卡片與訪視資料都帶 withdrawn_from；確認框的介面只要求 TransitionCard，讀得到才用。
type CardWithWithdrawal = TransitionCard & { withdrawn_from?: string | null }

/** 退出欄寫成「退預繳」或「退註冊」：往退出移看來源欄，從退出移出看卡片原本從哪裡退。 */
function sideLabel(stage: Stage, withdrawnFrom: string | null | undefined): string {
  if (stage === 'withdrawn' && withdrawnFrom) return WITHDRAWN_FROM_LABELS[withdrawnFrom] ?? STAGE_LABELS.withdrawn
  return STAGE_LABELS[stage]
}
const title = computed(() => {
  const target = props.target
  if (!target) return ''
  const card = target.card as CardWithWithdrawal
  return `${sideLabel(target.from, card.withdrawn_from)} → ${sideLabel(target.to, target.from)}`
})

// 往回的寫「退回／回到」，不寫「取消…」，免得和旁邊的「取消」鍵撞字。
const CONFIRM_TEXT: Partial<Record<`${Stage}>${Stage}`, string>> = {
  'visited>deposited': '移到已預繳',
  'deposited>visited': '退回已訪視',
  'deposited>enrolled': '標記註冊',
  'enrolled>deposited': '退回已預繳',
  'enrolled>visited': '退回已訪視',
  'deposited>withdrawn': '標記退預繳',
  'enrolled>withdrawn': '標記退註冊',
  'withdrawn>visited': '回到已訪視',
  'withdrawn>deposited': '回到已預繳',
}
const confirmText = computed(() => (props.target ? CONFIRM_TEXT[`${props.target.from}>${props.target.to}`] : undefined) ?? '確認')
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
  // 註冊年級預設保留座位的年級，沒有就用適讀班級。
  grade.value = ((card.provisional_grade ?? card.grade) as Grade | null | undefined) ?? null
  year.value = card.target_school_year ?? defaultYear
  semester.value = card.target_semester === 2 ? 2 : 1
})

// 開啟後焦點放進對話框：第一個輸入框；只確認的放確認鍵。要填原因的危險動作一定有原因框，
// 不會落在確認鍵。註冊日期關掉聚焦就彈出月曆（已預設今天），按 Enter 或點了才開。
const collectorInput = ref<{ focus: () => void } | null>(null)
const enrolledOnPicker = ref<{ focus: () => void } | null>(null)
const reasonInput = ref<{ focus: () => void } | null>(null)
const confirmButton = ref<{ ref?: HTMLButtonElement } | null>(null)

function focusFirst() {
  if (mode.value === 'deposit') collectorInput.value?.focus()
  else if (mode.value === 'enroll') enrolledOnPicker.value?.focus()
  else if (mode.value === 'destructive') reasonInput.value?.focus()
  else confirmButton.value?.ref?.focus()
}

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
      if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') notifyWarning(ANONYMIZED_CONFLICT_TEXT)
      else ElMessage.info('狀態已被其他人變更，已自動重新載入')
      open.value = false
      emit('stale')
    } else if (err instanceof ApiError && err.status === 404) {
      // 別人剛把這筆刪掉：不顯示錯誤，關閉並請父層重讀（同訪視明細的 reportError）。
      notifyWarning('這筆招生訪視已被刪除，已重新載入')
      open.value = false
      emit('stale')
    } else if (err instanceof ApiError && err.status === 403) {
      notifyWarning('無權限執行此操作')
    } else {
      notifyError(apiErrorMessage(err, '操作失敗，請稍後再試'))
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
    @opened="focusFirst"
  >
    <p class="transition__child">幼生：{{ target?.card.child_name }}</p>
    <el-alert v-if="warning" :type="mode === 'destructive' ? 'warning' : 'info'" :closable="false" show-icon :title="warning" class="transition__warning" />
    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item v-if="mode === 'deposit'" label="收預繳人員">
        <el-input ref="collectorInput" v-model="collector" maxlength="50" placeholder="誰收的（選填）" aria-label="收預繳人員" />
        <span class="field-help">這裡只記錄招生端的預繳狀態，實際收款與收據照園內原本的方式處理。</span>
      </el-form-item>
      <template v-else-if="mode === 'enroll'">
        <el-form-item label="註冊日期" required>
          <el-date-picker
            ref="enrolledOnPicker"
            v-model="enrolledOn"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="選擇註冊日期"
            aria-label="註冊日期"
            :automatic-dropdown="false"
            :disabled-date="outsideRocRange"
            style="width: 100%"
          />
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
          <span class="field-help">學號與編班照園內原本的方式處理。</span>
        </el-form-item>
      </template>
      <el-form-item v-else-if="mode === 'destructive'" label="原因（必填）">
        <el-input ref="reasonInput" v-model="reason" type="textarea" :rows="3" maxlength="2000" placeholder="請說明退回原因" aria-label="原因" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="submitting" @click="open = false">{{ mode === 'destructive' ? '先不要' : '取消' }}</el-button>
      <el-button ref="confirmButton" :type="mode === 'destructive' ? 'danger' : 'primary'" :loading="submitting" :disabled="!ready" @click="submit">
        {{ confirmText }}
      </el-button>
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
