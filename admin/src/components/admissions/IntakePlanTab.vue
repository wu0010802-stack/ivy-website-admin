<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getIntakePlan, saveIntakeTargets } from '../../api/admissions'
import { apiErrorMessage } from '../../api/errors'
import type { IntakePlan, IntakePlanRow } from '../../api/types'
import { currentTerm, termLabel } from '../../admissions/academic'
import { GRADES } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 名額規劃（園務 IntakePlanPanel；規格第 8 節）。條件是校區 × 學年 × 學期，取頁首的篩選；
// 頁首「不限學年」用目前學年、沒選學期用上學期（園務父層未指定時也是上學期），並說明（本檔調整第 18 條）。
// 沒有計畫列＝「未設定」，與 0 分開；剩餘在未設定時是「—」。超額園務只有紅底，官網另加文字（本檔調整第 24 條）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const defaultYear = currentTerm().schoolYear
const planYear = computed(() => props.schoolYear ?? defaultYear)
const planSemester = computed<Semester>(() => props.semester ?? 1)
const term = computed(() => termLabel(planYear.value, planSemester.value))

const plan = ref<IntakePlan | null>(null)
const drafts = ref<Record<string, number | null>>({})
const loading = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)
const requests = useRequestSequence()

function emptyRow(grade: string): IntakePlanRow {
  return { grade, target_seats: null, reserved: 0, enrolled: 0, remaining: null, over_capacity: false } as IntakePlanRow
}

// 以四個年級為主軸，後端沒回的年級補「未設定」列（園務補 0 列；官網補未設定，不顯示假的 0）。
const rows = computed<IntakePlanRow[]>(() => GRADES.map((grade) => plan.value?.rows?.find((row) => row.grade === grade) ?? emptyRow(grade)))
const anyTarget = computed(() => rows.value.some((row) => row.target_seats !== null && row.target_seats !== undefined))

function resetDrafts() {
  drafts.value = Object.fromEntries(rows.value.map((row) => [row.grade, row.target_seats ?? null]))
}

const changedGrades = computed(() => rows.value.map((row) => row.grade).filter((grade) => (drafts.value[grade] ?? null) !== (rows.value.find((row) => row.grade === grade)?.target_seats ?? null)))
const dirty = computed(() => changedGrades.value.length > 0)

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) plan.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getIntakePlan(props.campusKey, planYear.value, planSemester.value)
    if (!requests.isCurrent(request)) return
    plan.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
    resetDrafts()
  } catch {
    if (!requests.isCurrent(request)) return
    plan.value = null
    error.value = '無法讀取名額規劃，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => [props.campusKey, planYear.value, planSemester.value], () => void load(), { immediate: true })

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  // 記下這次儲存的對象；回應回來時若已切到別的校區／學期，就不能寫進現在的畫面。
  const scope = `${props.campusKey}|${planYear.value}|${planSemester.value}`
  const sameScope = () => scope === `${props.campusKey}|${planYear.value}|${planSemester.value}`
  try {
    const targets = Object.fromEntries(changedGrades.value.map((grade) => [grade, drafts.value[grade] ?? null]))
    const result = await saveIntakeTargets(props.campusKey, { school_year: planYear.value, semester: planSemester.value, targets })
    if (sameScope()) {
      plan.value = result
      resetDrafts()
    }
    ElMessage.success('已儲存計畫名額')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '儲存招生名額計畫失敗'))
  } finally {
    saving.value = false
  }
}

const seats = (value: number | null | undefined) => (value === null || value === undefined ? '未設定' : String(value))
const remainingText = (value: number | null | undefined) => (value === null || value === undefined ? '—' : String(value))

function rowClass({ row }: { row: IntakePlanRow }): string {
  return row.over_capacity ? 'intake-row--over' : ''
}
</script>

<template>
  <section class="intake">
    <div v-if="schoolYear === null || semester === null" class="intake__notes">
      <p v-if="schoolYear === null" class="hint">名額規劃一次看一個學期：頁首選了「不限學年」，先顯示 {{ defaultYear }} 學年。</p>
      <p v-if="semester === null" class="hint">頁首沒選入學學期，先顯示上學期；要看下學期請在上方選「下學期」。</p>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!plan" :rows="5" animated />

    <div v-else class="panel" :aria-busy="loading">
      <div class="panel__head">
        <h2>{{ term }}的計畫名額</h2>
        <div v-if="canWrite" class="intake__actions">
          <span v-if="dirty" class="dirty-note">有修改還沒儲存，剩餘會在儲存後重算</span>
          <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">儲存計畫名額</el-button>
        </div>
      </div>
      <p v-if="!anyTarget" class="hint intake__empty">
        {{ term }}還沒有設定計畫名額。{{ canWrite ? '在「計畫名額」欄填人數後按「儲存計畫名額」；留空代表未設定。' : '請校區管理者設定。' }}
      </p>
      <el-table :data="rows" class="intake-table" :row-class-name="rowClass">
        <el-table-column label="年級" min-width="96" prop="grade" />
        <el-table-column label="計畫名額" min-width="152">
          <template #default="{ row }: { row: IntakePlanRow }">
            <el-input-number
              v-if="canWrite"
              v-model="drafts[row.grade]"
              :min="0"
              :max="999"
              :step="1"
              :value-on-clear="null"
              :disabled="saving"
              controls-position="right"
              size="small"
              placeholder="未設定"
              :aria-label="`${row.grade}計畫名額`"
              class="intake__input"
            />
            <span v-else class="num" :class="{ muted: row.target_seats === null }">{{ seats(row.target_seats) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="已保留" min-width="88">
          <template #default="{ row }: { row: IntakePlanRow }"><span class="num">{{ row.reserved }}</span></template>
        </el-table-column>
        <el-table-column label="已註冊" min-width="88">
          <template #default="{ row }: { row: IntakePlanRow }"><span class="num">{{ row.enrolled }}</span></template>
        </el-table-column>
        <el-table-column label="剩餘" min-width="150">
          <template #default="{ row }: { row: IntakePlanRow }">
            <span class="num" :class="{ 'intake__negative': (row.remaining ?? 0) < 0 }">{{ remainingText(row.remaining) }}</span>
            <el-tag v-if="row.over_capacity" type="danger" size="small" effect="light" class="intake__over">超過計畫名額</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <p class="intake__totals">
        <strong>合計</strong>
        <span>計畫 <b class="num">{{ seats(plan.totals?.target_seats) }}</b></span>
        <span>保留 <b class="num">{{ plan.totals?.reserved ?? 0 }}</b></span>
        <span>註冊 <b class="num">{{ plan.totals?.enrolled ?? 0 }}</b></span>
        <span>剩餘 <b class="num" :class="{ 'intake__negative': (plan.totals?.remaining ?? 0) < 0 }">{{ remainingText(plan.totals?.remaining) }}</b></span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.intake__notes {
  margin-bottom: 12px;
}

.intake__notes p {
  margin: 0 0 4px;
}

.intake__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 12px;
}

.intake__empty {
  margin: 0;
  padding: 12px 24px 0;
}

.intake__input {
  width: 120px;
}

/* 超額整列淡紅底（園務 over-capacity），剩餘負數紅字加粗。 */
.intake-table :deep(.intake-row--over) td.el-table__cell {
  background: var(--el-color-danger-light-9);
}

.intake__negative {
  color: var(--el-color-danger);
  font-weight: 600;
}

.intake__over {
  margin-left: 8px;
}

.intake__totals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 0;
  padding: 12px 24px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}

.intake__totals b {
  color: var(--ink);
  font-weight: 600;
}

@media (max-width: 720px) {
  .intake__empty,
  .intake__totals {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
