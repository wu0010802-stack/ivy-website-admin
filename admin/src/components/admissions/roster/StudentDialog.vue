<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { RosterStudent, StudentUpdate } from '../../../api/roster'
import { GRADE_ORDER } from '../../../admissions/roster'

// 編輯幼生資料（2026-11-15，規格 §8.1）。欄位照幼生的狀態出現：在籍有入園日、預繳未入園有預定入園日與預繳日期、
// 還沒編班的可以改班別與入學學期。自動認定的新生與有生日的不足齡不能手動改。只送有改的欄位。
const props = defineProps<{ modelValue: boolean; student: RosterStudent; schoolYear: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; save: [body: Omit<StudentUpdate, 'expected_version'>] }>()

type Form = {
  child_name: string; birthday: string; note: string; enrollment_date: string; planned_entry_date: string; deposit_date: string
  grade: string; term: string; is_special_education: boolean; is_indigenous: boolean; is_new_manual: boolean; underage_manual: boolean; next_year: string
}
const form = reactive<Form>({
  child_name: '', birthday: '', note: '', enrollment_date: '', planned_entry_date: '', deposit_date: '', grade: '', term: '',
  is_special_education: false, is_indigenous: false, is_new_manual: false, underage_manual: false, next_year: 'continue',
})
const error = ref('')

const termOf = (s: RosterStudent) => (s.target_school_year !== null && s.target_semester !== null ? `${s.target_school_year}-${s.target_semester}` : '')

watch(() => [props.modelValue, props.student.id, props.student.version], () => {
  if (!props.modelValue) return
  const s = props.student
  error.value = ''
  Object.assign(form, {
    child_name: s.child_name, birthday: s.birthday ?? '', note: s.note ?? '', enrollment_date: s.enrollment_date ?? '',
    planned_entry_date: s.planned_entry_date ?? '', deposit_date: s.deposit_date ?? '', grade: s.grade ?? '', term: termOf(s),
    is_special_education: s.is_special_education, is_indigenous: s.is_indigenous, is_new_manual: s.is_new_manual,
    underage_manual: s.underage_manual, next_year: s.next_year,
  })
}, { immediate: true })

const enrolled = computed(() => props.student.status === 'enrolled')
const pending = computed(() => props.student.status === 'pending')
const unassigned = computed(() => props.student.class_id === null)
const grade = computed(() => props.student.grade ?? form.grade)
const nextYearTerm = computed(() => props.student.target_school_year === props.schoolYear + 1 && props.student.target_semester === 1)
const gradeLabel = computed(() => (nextYearTerm.value ? `${props.schoolYear + 1} 學年的班別` : '班別'))
const termOptions = computed(() => [
  { value: `${props.schoolYear}-1`, label: `${props.schoolYear} 上學期（12–1月入園）` },
  { value: `${props.schoolYear}-2`, label: `${props.schoolYear} 下學期（2–7月入園）` },
  { value: `${props.schoolYear + 1}-1`, label: `${props.schoolYear + 1} 上學期（8月入園）` },
])
// 自動認定的新生（曾預繳、本學年才入園）不能手動改；有生日的不足齡一律由生日判定。
const newLocked = computed(() => props.student.is_new && !props.student.is_new_manual)
const underageLocked = computed(() => form.birthday !== '')
const underageChecked = computed(() => (underageLocked.value ? props.student.birthday !== null && props.student.is_underage === true : form.underage_manual))
const nextYearOptions = computed(() =>
  grade.value === '大班'
    ? [{ value: 'continue', label: '畢業' }, { value: 'repeat', label: '重讀大班' }]
    : [{ value: 'continue', label: '續讀' }, { value: 'leave', label: '不讀' }],
)

function submit() {
  const s = props.student
  const name = form.child_name.trim()
  if (!name) {
    error.value = '請填幼生姓名'
    return
  }
  const body: Omit<StudentUpdate, 'expected_version'> = {}
  const blank = (value: string) => value || null
  if (name !== s.child_name) body.child_name = name
  if (blank(form.birthday) !== s.birthday) body.birthday = blank(form.birthday)
  if ((form.note.trim() || null) !== s.note) body.note = form.note.trim() || null
  if (enrolled.value && blank(form.enrollment_date) !== s.enrollment_date) body.enrollment_date = blank(form.enrollment_date)
  if (pending.value) {
    if (blank(form.planned_entry_date) !== s.planned_entry_date) body.planned_entry_date = blank(form.planned_entry_date)
    if (form.deposit_date && form.deposit_date !== s.deposit_date) body.deposit_date = form.deposit_date
    if (!form.deposit_date) {
      error.value = '請填預繳日期'
      return
    }
  }
  if (unassigned.value && form.grade && form.grade !== s.grade) body.grade = form.grade as StudentUpdate['grade']
  if (pending.value && form.term && form.term !== termOf(s)) {
    const [year, semester] = form.term.split('-').map(Number)
    if (year !== s.target_school_year) body.target_school_year = year
    if (semester !== s.target_semester) body.target_semester = semester
  }
  if (form.is_special_education !== s.is_special_education) body.is_special_education = form.is_special_education
  if (form.is_indigenous !== s.is_indigenous) body.is_indigenous = form.is_indigenous
  if (!newLocked.value && form.is_new_manual !== s.is_new_manual) body.is_new_manual = form.is_new_manual
  if (!underageLocked.value && form.underage_manual !== s.underage_manual) body.underage_manual = form.underage_manual
  if (form.next_year !== s.next_year) body.next_year = form.next_year as StudentUpdate['next_year']
  emit('save', body)
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="`編輯資料　${student.child_name}`" width="560px" class="roster-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="roster-form">
      <div class="roster-form__row">
        <label>幼生姓名<input v-model="form.child_name" maxlength="50" /></label>
        <label>生日<input v-model="form.birthday" type="date" /></label>
      </div>
      <div v-if="enrolled" class="roster-form__row">
        <label>入園日<input v-model="form.enrollment_date" type="date" /></label>
        <p class="roster-form__hint">開學前就在的舊生不用填。</p>
      </div>
      <template v-if="pending">
        <div class="roster-form__row">
          <label>預定入園日<input v-model="form.planned_entry_date" type="date" /></label>
          <label>預繳日期<input v-model="form.deposit_date" type="date" /></label>
        </div>
        <p class="roster-form__hint">填了預定入園日，入學學期就由日期決定。</p>
      </template>
      <div v-if="unassigned || (pending && !nextYearTerm)" class="roster-form__row">
        <label v-if="unassigned">{{ gradeLabel }}
          <select v-model="form.grade">
            <option v-if="!form.grade" value="">請選擇</option>
            <option v-for="g in GRADE_ORDER" :key="g" :value="g">{{ g }}</option>
          </select>
        </label>
        <label v-if="pending && !nextYearTerm">入學學期
          <select v-model="form.term" :disabled="form.planned_entry_date !== ''">
            <option v-if="!form.term" value="">請選擇</option>
            <option v-for="term in termOptions" :key="term.value" :value="term.value">{{ term.label }}</option>
          </select>
        </label>
      </div>
      <label>備註<textarea v-model="form.note" maxlength="1000" placeholder="例：12 或 2 月入園" /></label>
      <div class="roster-form__checks">
        <el-checkbox :model-value="newLocked ? true : form.is_new_manual" :disabled="newLocked" @update:model-value="form.is_new_manual = Boolean($event)">新生</el-checkbox>
        <el-checkbox v-model="form.is_special_education">特教生</el-checkbox>
        <el-checkbox v-model="form.is_indigenous">原住民</el-checkbox>
        <el-checkbox v-if="grade === '幼幼班'" :model-value="underageChecked" :disabled="underageLocked" @update:model-value="form.underage_manual = Boolean($event)">不足齡</el-checkbox>
      </div>
      <label>下學年
        <select v-model="form.next_year">
          <option v-for="option in nextYearOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <p v-if="error" class="roster-form__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="roster-form__cancel" @click="emit('update:modelValue', false)">取消</button>
      <button type="button" class="roster-form__primary" @click="submit">儲存</button>
    </template>
  </el-dialog>
</template>

<style src="./rosterForm.css"></style>
