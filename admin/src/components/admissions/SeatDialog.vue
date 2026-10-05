<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../../composables/notify'
import { setSeat } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { RecruitmentVisit } from '../../api/types'
import { currentTerm, schoolYearOptions, termLabel } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, GRADES, SEMESTER_LABELS, type Grade } from '../../admissions/constants'

// 保留座位（園務 ReserveSeatDialog；規格 6.5）。只有已預繳、未註冊、未退出的訪視會開到這裡
// （明細「更多」只在已預繳列出現）。超過計畫名額只提醒不擋：後端回 capacity_warning（A 調整第 12 條），
// 園務前端沒有顯示這個警示，官網用提醒框講清楚（本檔調整第 24 條，文案自擬）。
const props = defineProps<{ record: RecruitmentVisit | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

const grade = ref<Grade | null>(null)
const year = ref<number | null>(null)
const semester = ref<1 | 2>(1)
const pending = ref<'reserve' | 'release' | null>(null)

const defaultYear = currentTerm().schoolYear
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [1, 0, -1])
  return year.value && !years.includes(year.value) ? [...years, year.value].sort((a, b) => b - a) : years
})
const hasSeat = computed(() => Boolean(props.record?.provisional_grade))

watch(open, (value) => {
  const record = props.record
  if (!value || !record) return
  grade.value = ((record.provisional_grade ?? record.grade) as Grade | null | undefined) ?? null
  year.value = record.target_school_year ?? defaultYear
  semester.value = record.target_semester === 2 ? 2 : 1
})

function handleError(err: unknown, fallback: string) {
  // 已依保存政策匿名化的訪視也是 409，原因不同，另外說明（R4）；排在版本衝突前面。
  if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
    notifyWarning(ANONYMIZED_CONFLICT_TEXT)
    open.value = false
    emit('stale')
    return
  }
  if (isVersionConflict(err)) {
    ElMessage.info('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    open.value = false
    emit('stale')
    return
  }
  // 別人剛把這筆刪掉：不顯示錯誤，關閉並請父層重讀。
  if (err instanceof ApiError && err.status === 404) {
    notifyWarning('這筆招生訪視已被刪除，已重新載入')
    open.value = false
    emit('stale')
    return
  }
  // 後端的拒絕原因（例如「未預繳的訪視不可保留座位」）直接顯示。
  notifyError(apiErrorMessage(err, fallback))
}

async function reserve() {
  const record = props.record
  if (!record || !grade.value || !year.value || pending.value) return
  pending.value = 'reserve'
  const chosen = { grade: grade.value, year: year.value, semester: semester.value }
  try {
    const result = await setSeat(record.id, {
      grade: chosen.grade, target_school_year: chosen.year, target_semester: chosen.semester, expected_version: record.version,
    })
    open.value = false
    emit('saved', result.visit)
    if (result.capacity_warning) {
      await ElMessageBox.alert(
        `已保留座位，但 ${chosen.grade}（${termLabel(chosen.year, chosen.semester)}）的已保留加已註冊超過計畫名額。超收是否可行請與園長確認；計畫名額可在「名額規劃」調整。`,
        '已保留，但超過計畫名額',
        { type: 'warning', confirmButtonText: '知道了' },
      ).catch(() => undefined)
    } else {
      ElMessage.success('已保留座位')
    }
  } catch (err) {
    handleError(err, '保留座位失敗')
  } finally {
    pending.value = null
  }
}

// 釋放只清年級，入學學年學期不動（園務：否則卡片會從看板消失）。
async function release() {
  const record = props.record
  if (!record || pending.value) return
  pending.value = 'release'
  try {
    const result = await setSeat(record.id, {
      grade: null,
      target_school_year: record.target_school_year ?? year.value,
      target_semester: record.target_semester ?? semester.value,
      expected_version: record.version,
    })
    ElMessage.success('已釋放保留')
    open.value = false
    emit('saved', result.visit)
  } catch (err) {
    handleError(err, '釋放保留名額失敗')
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="seat-dialog"
    title="保留座位"
    width="min(420px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="pending === null"
    :show-close="pending === null"
  >
    <p class="seat__child">幼生：{{ record?.child_name }}</p>
    <p class="hint seat__lead">保留後算進名額規劃的「已保留」。超過計畫名額只會提醒，不會擋。</p>
    <el-form label-position="top" :disabled="pending !== null" @submit.prevent>
      <el-form-item label="暫定年級" required>
        <el-select v-model="grade" placeholder="請選擇年級" aria-label="暫定年級" style="width: 100%">
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="目標學年（民國）" required>
        <el-select v-model="year" placeholder="學年" aria-label="目標學年" style="width: 100%">
          <el-option v-for="item in yearChoices" :key="item" :label="`${item} 學年`" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="目標學期">
        <el-radio-group v-model="semester" aria-label="目標學期">
          <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
          <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="seat__footer">
        <el-button v-if="hasSeat" type="warning" plain :loading="pending === 'release'" :disabled="pending !== null" @click="release">釋放保留</el-button>
        <span class="seat__spacer" />
        <el-button :disabled="pending !== null" @click="open = false">取消</el-button>
        <el-button type="primary" :loading="pending === 'reserve'" :disabled="!grade || !year || pending !== null" @click="reserve">確認保留</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.seat__child {
  margin: 0 0 4px;
  color: var(--ink);
  font-weight: 500;
}

.seat__lead {
  margin: 0 0 16px;
}

.seat__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.seat__footer .el-button + .el-button {
  margin-left: 0;
}

.seat__spacer {
  flex: 1;
}
</style>
