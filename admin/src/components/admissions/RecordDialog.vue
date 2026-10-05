<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyWarning } from '../../composables/notify'
import { createRecord, getRecord, updateRecord } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsOptions, RecruitmentVisit, RecruitmentVisitCreate, RecruitmentVisitUpdate } from '../../api/types'
import { currentTerm, gradeForBirthday, outsideRocRange, rocDate, rocMonth, schoolYearOptions, taipeiToday } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, GRADES, NO_DEPOSIT_REASONS, SEMESTER_LABELS, stageLabel, type Grade } from '../../admissions/constants'

// 訪視表單（園務 RecruitmentRecordDialog，分區同園務：基本資料、聯絡與來源、預繳狀態、備註）。
// 官網第一版不放來源分類、帶參觀老師、娃娃車、地址分析同意（本檔調整第 10 條）；2026-10-05 照園方紙本
// 放回前三個（帶參觀老師只打名字、不選帳號），另加英文名字、父母職業（官網延伸，園務沒有）。
// 預繳、註冊、退出只能走狀態轉換（園務 stateLocked）；這些欄位一律不送，後端 extra="forbid"。
// 生日只有新增時必填：預約到場自動建立的訪視可能沒有生日，編輯時不擋（本檔調整第 17 條）。
const props = defineProps<{
  mode: 'add' | 'edit'
  campusKey: string
  record?: RecruitmentVisit | null
  options?: AdmissionsOptions | null
}>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

type Semester = 1 | 2
// 年級與未預繳原因用列舉型別：後端 schema 若是 Literal，產生的 TS 型別就是字面值聯集。
type NoDepositReason = (typeof NO_DEPOSIT_REASONS)[number]
type SourceCategory = NonNullable<RecruitmentVisit['source_category']>

interface FormState {
  child_name: string
  english_name: string
  birthday: string | null
  contact_name: string
  phone: string
  visit_date: string | null
  tour_guide_name: string
  target_school_year: number | null
  target_semester: Semester | null
  rides_bus: boolean
  grade: Grade | null
  address: string
  father_occupation: string
  mother_occupation: string
  source_category: SourceCategory | null
  source: string
  referrer: string
  deposit_collector: string
  transfer_term: boolean
  no_deposit_reason: NoDepositReason | null
  no_deposit_reason_detail: string
  notes: string
  parent_response: string
}

function blank(term?: { year: number | null; semester: Semester | null }): FormState {
  const now = currentTerm()
  return {
    child_name: '', english_name: '', birthday: null, contact_name: '', phone: '',
    // 園務：參觀日期預設今天（九成是當天登記）；入學學期預設當前學期，可改。
    visit_date: taipeiToday(), tour_guide_name: '',
    target_school_year: term ? term.year : now.schoolYear,
    target_semester: term ? term.semester : now.semester,
    rides_bus: false, grade: null, address: '', father_occupation: '', mother_occupation: '', source_category: null,
    source: '', referrer: '', deposit_collector: '', transfer_term: false,
    no_deposit_reason: null, no_deposit_reason_detail: '', notes: '', parent_response: '',
  }
}

function fromRecord(record: RecruitmentVisit): FormState {
  return {
    child_name: record.child_name,
    english_name: record.english_name ?? '',
    birthday: record.birthday ?? null,
    contact_name: record.contact_name ?? '',
    phone: record.phone ?? '',
    visit_date: record.visit_date,
    tour_guide_name: record.tour_guide_name ?? '',
    target_school_year: record.target_school_year ?? null,
    target_semester: record.target_semester === 1 || record.target_semester === 2 ? record.target_semester : null,
    rides_bus: record.rides_bus,
    grade: (record.grade as Grade | null | undefined) ?? null,
    address: record.address ?? '',
    father_occupation: record.father_occupation ?? '',
    mother_occupation: record.mother_occupation ?? '',
    source_category: record.source_category ?? null,
    source: record.source ?? '',
    referrer: record.referrer ?? '',
    deposit_collector: record.deposit_collector ?? '',
    transfer_term: record.transfer_term,
    no_deposit_reason: (record.no_deposit_reason as NoDepositReason | null | undefined) ?? null,
    no_deposit_reason_detail: record.no_deposit_reason_detail ?? '',
    notes: record.notes ?? '',
    parent_response: record.parent_response ?? '',
  }
}

const form = reactive<FormState>(blank())
const current = ref<RecruitmentVisit | null>(null)
const initial = ref('')
const autoGrade = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const sections = ref<string[]>([])

function reset(state: FormState) {
  Object.assign(form, state)
  initial.value = JSON.stringify(form)
  autoGrade.value = false
  error.value = null
}

watch(open, (value) => {
  if (!value) return
  current.value = props.mode === 'edit' ? (props.record ?? null) : null
  reset(current.value ? fromRecord(current.value) : blank())
  sections.value = []
})

const hasDeposit = computed(() => Boolean(current.value?.has_deposit))
const defaultYear = currentTerm().schoolYear
// 園務表單的學年選項：今年 +3、+2、+1、今年、−1；編輯舊資料時把它原本的學年也放進來。
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [3, 2, 1, 0, -1])
  const own = form.target_school_year
  return own && !years.includes(own) ? [...years, own].sort((a, b) => b - a) : years
})

// 生日 × 入學學年自動判定適讀班級：只在班級空著、或上次是自動帶入時覆寫（園務 :405-422）。
function autoFillGrade() {
  const grade = gradeForBirthday(form.birthday, form.target_school_year)
  if (!grade) return
  if (!form.grade || autoGrade.value) {
    form.grade = grade
    autoGrade.value = true
  }
}
function setBirthday(value: string | null | undefined) {
  form.birthday = value || null
  autoFillGrade()
}
function setYear(value: number | null | undefined) {
  form.target_school_year = value ?? null
  autoFillGrade()
}
function onGradeChange() {
  autoGrade.value = false
}

const visitDateHint = computed(() => (form.visit_date ? `民國：${rocDate(form.visit_date)}（月份：${rocMonth(form.visit_date)}）` : ''))

const missing = computed(() => [
  form.child_name.trim() ? '' : '幼生姓名',
  props.mode === 'add' && !form.birthday ? '生日' : '',
  form.visit_date ? '' : '參觀日期',
  form.target_school_year && form.target_semester ? '' : '入學學期',
].filter(Boolean))

const filled = (values: unknown[]) => values.filter((value) => typeof value === 'string' && value.trim()).length
const contactSummary = computed(() => {
  const count = filled([form.address, form.father_occupation, form.mother_occupation, form.source_category, form.source, form.referrer])
  return count ? `已填 ${count} 項` : '未填'
})
const sourceCategories = computed(() => Object.entries(props.options?.source_categories ?? {}))
const notesSummary = computed(() => {
  const count = filled([form.notes, form.parent_response])
  return count ? `已填 ${count} 項` : '未填'
})

const text = (value: string) => value.trim() || null

// 新增與編輯共用的欄位（不含狀態欄位）；編輯時拿原值也跑一次，比對出真的改過的欄位。
function payload(state: FormState) {
  return {
    child_name: state.child_name.trim(),
    english_name: text(state.english_name),
    birthday: state.birthday,
    contact_name: text(state.contact_name),
    phone: text(state.phone),
    visit_date: state.visit_date ?? '',
    tour_guide_name: text(state.tour_guide_name),
    target_school_year: state.target_school_year,
    target_semester: state.target_semester,
    rides_bus: state.rides_bus,
    grade: state.grade,
    address: text(state.address),
    father_occupation: text(state.father_occupation),
    mother_occupation: text(state.mother_occupation),
    source_category: state.source_category || null,
    source: text(state.source),
    referrer: text(state.referrer),
    transfer_term: state.transfer_term,
    no_deposit_reason: state.no_deposit_reason || null,
    no_deposit_reason_detail: text(state.no_deposit_reason_detail),
    notes: text(state.notes),
    parent_response: text(state.parent_response),
  }
}

function changes(record: RecruitmentVisit): Record<string, unknown> {
  const before: Record<string, unknown> = { ...payload(fromRecord(record)) }
  const after: Record<string, unknown> = { ...payload(form) }
  // 收預繳人員只在已預繳時可改；未預繳原因只在未預繳時顯示，已預繳就不動它。
  if (record.has_deposit) {
    before.deposit_collector = record.deposit_collector ?? null
    after.deposit_collector = text(form.deposit_collector)
    delete before.no_deposit_reason
    delete before.no_deposit_reason_detail
    delete after.no_deposit_reason
    delete after.no_deposit_reason_detail
  }
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => (before[key] ?? null) !== (value ?? null)))
}

async function save(next = false) {
  if (missing.value.length || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    if (props.mode === 'add') {
      // missing 已擋下空值，這裡收窄型別（新增時這三欄必填，schema 可能不接受 null）。
      const body: RecruitmentVisitCreate = {
        ...payload(form), birthday: form.birthday!, target_school_year: form.target_school_year!, target_semester: form.target_semester!,
      }
      const created = await createRecord(props.campusKey, body)
      emit('saved', created)
      if (next) {
        // 儲存並新增下一筆：不關窗，換空白表單，沿用上一筆的入學學年學期（園務 FunnelAddVisit）。
        ElMessage.success('已儲存，可繼續新增下一筆')
        reset(blank({ year: form.target_school_year, semester: form.target_semester }))
      } else {
        ElMessage.success('新增成功')
        open.value = false
      }
      return
    }
    const record = current.value
    if (!record) return
    const changed = changes(record)
    if (Object.keys(changed).length === 0) {
      open.value = false
      return
    }
    // 只送改過的欄位：後端以 model_fields_set 區分「沒送」與「清空」。
    const body = { ...changed, expected_version: record.version } as RecruitmentVisitUpdate
    const updated = await updateRecord(record.id, body)
    ElMessage.success('更新成功')
    open.value = false
    emit('saved', updated)
  } catch (err) {
    if (props.mode === 'edit' && apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
      // 已依保存政策匿名化：不能再改。關閉表單並通知列表重讀。
      notifyWarning(ANONYMIZED_CONFLICT_TEXT)
      emit('stale')
      open.value = false
    } else if (props.mode === 'edit' && err instanceof ApiError && err.status === 404) {
      // 別人剛把這筆刪掉：不顯示錯誤，關閉表單並通知列表重讀。
      notifyWarning('這筆招生訪視已被刪除，已重新載入')
      emit('stale')
      open.value = false
    } else if (isVersionConflict(err) && current.value) {
      notifyWarning('這筆招生訪視剛被其他人修改，已載入最新的內容；你的修改沒有儲存，請確認後再改')
      emit('stale')
      try {
        current.value = await getRecord(current.value.id)
        reset(fromRecord(current.value))
      } catch {
        open.value = false
      }
    } else {
      error.value = apiErrorMessage(err, '儲存失敗')
    }
  } finally {
    submitting.value = false
  }
}

const dirty = computed(() => open.value && JSON.stringify(form) !== initial.value)

// 邊講電話邊填，誤按 Esc、右上角 X 或「取消」不能讓整筆消失；送出中不能關（同 ManualVisitDialog）。
async function beforeClose(done: () => void) {
  if (submitting.value) return
  if (!dirty.value) {
    done()
    return
  }
  try {
    await ElMessageBox.confirm('已經填的內容會清掉。', props.mode === 'add' ? '放棄這筆訪視紀錄？' : '放棄這次修改？', {
      confirmButtonText: '放棄填寫',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  done()
}

function requestClose() {
  void beforeClose(() => {
    open.value = false
  })
}

function disableVisitDate(date: Date): boolean {
  return outsideRocRange(date)
}

function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

function suggest(list: readonly string[] | undefined) {
  return (query: string, callback: (items: { value: string }[]) => void) => {
    const keyword = query.trim()
    callback((list ?? []).filter((item) => !keyword || item.includes(keyword)).map((value) => ({ value })))
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="record-dialog"
    width="min(680px, calc(100vw - 32px))"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    :before-close="beforeClose"
  >
    <template #header>
      <div class="record-dialog__head">
        <h2 class="record-dialog__title">{{ mode === 'add' ? '新增訪視紀錄' : '編輯訪視紀錄' }}</h2>
        <!-- 序號由後端依同校同月份配號，不是輸入欄（園務同樣只顯示）。 -->
        <span class="record-dialog__seq">{{ mode === 'add' ? '存檔後自動編號' : `序號 ${current?.seq_no || '—'}` }}</span>
      </div>
    </template>

    <p class="hint record-dialog__lead">* 為必填，其餘可日後補。</p>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="record-dialog__alert" />

    <el-form label-position="top" :disabled="submitting" @submit.prevent>
      <div class="record-dialog__row">
        <el-form-item label="幼生姓名" required>
          <el-input v-model="form.child_name" maxlength="50" aria-label="幼生姓名" />
        </el-form-item>
        <el-form-item label="英文名字">
          <el-input v-model="form.english_name" maxlength="50" aria-label="英文名字" />
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="生日" :required="mode === 'add'">
          <el-date-picker :model-value="form.birthday" type="date" value-format="YYYY-MM-DD" placeholder="選擇生日" :disabled-date="disableFuture" aria-label="生日" style="width: 100%" @update:model-value="setBirthday" />
        </el-form-item>
        <el-form-item label="適讀班級">
          <el-select v-model="form.grade" clearable placeholder="請選擇班別" aria-label="適讀班級" @change="onGradeChange">
            <el-option v-for="grade in GRADES" :key="grade" :label="grade" :value="grade" />
          </el-select>
          <span v-if="autoGrade" class="field-help record-dialog__auto">✓ 已依生日 × {{ form.target_school_year }} 學年自動判定，可手動修改</span>
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="聯絡人姓名">
          <el-input v-model="form.contact_name" maxlength="50" placeholder="家長或主要照顧者" aria-label="聯絡人姓名" />
        </el-form-item>
        <el-form-item label="電話">
          <el-input v-model="form.phone" maxlength="100" inputmode="tel" aria-label="電話" />
          <span class="field-help">例：0912-345-678</span>
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="參觀日期" required>
          <el-date-picker v-model="form.visit_date" type="date" value-format="YYYY-MM-DD" placeholder="選擇參觀日期（年月日）" :disabled-date="disableVisitDate" aria-label="參觀日期" style="width: 100%" />
          <span v-if="visitDateHint" class="field-help num">{{ visitDateHint }}</span>
        </el-form-item>
        <el-form-item label="帶參觀老師">
          <el-autocomplete v-model="form.tour_guide_name" :fetch-suggestions="suggest(options?.tour_guides)" maxlength="50" aria-label="帶參觀老師" style="width: 100%" />
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="入學學期" required>
          <div class="record-dialog__term">
            <el-select :model-value="form.target_school_year ?? undefined" placeholder="學年" aria-label="入學學年" @update:model-value="setYear">
              <el-option v-for="year in yearChoices" :key="year" :label="`${year} 學年`" :value="year" />
            </el-select>
            <el-radio-group v-model="form.target_semester" aria-label="入學學期">
              <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
              <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
            </el-radio-group>
          </div>
          <span class="field-help">小孩預計入學的學期（預設當前學期，可改）。</span>
        </el-form-item>
        <el-form-item label="搭娃娃車">
          <el-switch v-model="form.rides_bus" active-text="要搭" inactive-text="不搭" aria-label="搭娃娃車" />
        </el-form-item>
      </div>

      <el-collapse v-model="sections" class="record-dialog__sections">
        <el-collapse-item name="contact">
          <template #title>
            <span class="record-dialog__section">聯絡與來源</span><span class="record-dialog__summary">{{ contactSummary }}</span>
          </template>
          <el-form-item label="地址">
            <el-input v-model="form.address" maxlength="200" aria-label="地址" />
          </el-form-item>
          <div class="record-dialog__row">
            <el-form-item label="父親職業">
              <el-input v-model="form.father_occupation" maxlength="50" aria-label="父親職業" />
            </el-form-item>
            <el-form-item label="母親職業">
              <el-input v-model="form.mother_occupation" maxlength="50" aria-label="母親職業" />
            </el-form-item>
          </div>
          <div class="record-dialog__row">
            <el-form-item label="來源分類">
              <el-select v-model="form.source_category" clearable placeholder="請選擇來源分類" aria-label="來源分類" style="width: 100%">
                <el-option v-for="[value, label] in sourceCategories" :key="value" :label="label" :value="value" />
              </el-select>
            </el-form-item>
            <el-form-item label="來源備註">
              <el-autocomplete v-model="form.source" :fetch-suggestions="suggest(options?.sources)" maxlength="50" placeholder="例如：哥哥姓名、朋友姓名、看到傳單" aria-label="來源備註" style="width: 100%" />
            </el-form-item>
          </div>
          <div class="record-dialog__row">
            <el-form-item label="介紹者">
              <el-autocomplete v-model="form.referrer" :fetch-suggestions="suggest(options?.referrers)" maxlength="50" aria-label="介紹者" style="width: 100%" />
              <span class="field-help">統計分析的「接待人員」看的就是這一欄。</span>
            </el-form-item>
          </div>
        </el-collapse-item>

        <el-collapse-item name="deposit">
          <template #title><span class="record-dialog__section">預繳狀態</span></template>
          <p class="record-dialog__stage">目前階段：{{ stageLabel(current?.stage ?? 'visited') }}</p>
          <p class="field-help record-dialog__locked">預繳、註冊與退出請用明細列的「標記預繳」「標記註冊」或「更多」，或在漏斗看板拖曳卡片，才會留下紀錄與原因。</p>
          <div class="record-dialog__row">
            <el-form-item v-if="hasDeposit" label="收預繳人員">
              <el-input v-model="form.deposit_collector" maxlength="50" placeholder="預繳時填寫" aria-label="收預繳人員" />
            </el-form-item>
            <el-form-item label="轉其他學期">
              <el-switch v-model="form.transfer_term" active-text="是" inactive-text="否" aria-label="轉其他學期" />
            </el-form-item>
          </div>
          <template v-if="!hasDeposit">
            <el-form-item label="未預繳原因">
              <el-select v-model="form.no_deposit_reason" clearable placeholder="請選擇原因" aria-label="未預繳原因" style="width: 100%">
                <el-option v-for="reason in NO_DEPOSIT_REASONS" :key="reason" :label="reason" :value="reason" />
              </el-select>
            </el-form-item>
            <el-form-item label="原因說明">
              <el-input v-model="form.no_deposit_reason_detail" type="textarea" :rows="2" maxlength="2000" placeholder="詳細說明（選填）" aria-label="原因說明" />
            </el-form-item>
          </template>
        </el-collapse-item>

        <el-collapse-item name="notes">
          <template #title>
            <span class="record-dialog__section">備註</span><span class="record-dialog__summary">{{ notesSummary }}</span>
          </template>
          <el-form-item label="備註">
            <el-input v-model="form.notes" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="2000" aria-label="備註" />
          </el-form-item>
          <el-form-item label="電訪回應" class="record-dialog__last">
            <el-input v-model="form.parent_response" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="2000" aria-label="電訪回應" />
          </el-form-item>
        </el-collapse-item>
      </el-collapse>
    </el-form>

    <template #footer>
      <div class="record-dialog__footer">
        <p class="record-dialog__missing" aria-live="polite">{{ missing.length ? `還不能儲存：還沒填${missing.join('、')}` : '' }}</p>
        <div class="record-dialog__buttons">
          <el-button :disabled="submitting" @click="requestClose">取消</el-button>
          <el-button v-if="mode === 'add'" :disabled="missing.length > 0 || submitting" @click="save(true)">儲存並新增下一筆</el-button>
          <el-button type="primary" :loading="submitting" :disabled="missing.length > 0" @click="save()">儲存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.record-dialog__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.record-dialog__title {
  font-size: var(--text-xl);
}

.record-dialog__seq {
  padding: 2px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.record-dialog__lead {
  margin: 0 0 12px;
}

.record-dialog__alert {
  margin-bottom: 16px;
}

.record-dialog__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.record-dialog__term {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.record-dialog__term .el-select {
  width: 120px;
}

.record-dialog__auto {
  color: var(--el-color-success);
}

.record-dialog__sections {
  margin-top: 8px;
}

.record-dialog__section {
  font-weight: 600;
}

.record-dialog__summary {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: 400;
}

.record-dialog__stage {
  margin: 0;
  color: var(--ink);
  font-weight: 500;
}

.record-dialog__locked {
  margin: 0 0 12px;
}

.record-dialog__last {
  margin-bottom: 0;
}

.record-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 12px;
  width: 100%;
}

.record-dialog__missing {
  flex: 1 1 200px;
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
  text-align: left;
}

.record-dialog__missing:empty {
  flex-basis: 0;
}

.record-dialog__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.record-dialog__buttons .el-button + .el-button {
  margin-left: 0;
}

@media (max-width: 720px) {
  .record-dialog__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .record-dialog__missing {
    font-size: var(--text-base);
  }
}
</style>

<style>
/* 對話框本體掛在 body 下，scoped 碰不到：內容區自己捲動，按鈕固定在下緣（同 manual-dialog）。 */
.record-dialog.el-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100svh - 10vh);
  margin-bottom: 5vh;
}

.record-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.record-dialog .el-dialog__footer {
  flex: none;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
