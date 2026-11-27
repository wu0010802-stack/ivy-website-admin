<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ClassCreate, ClassUpdate, RosterClass } from '../../../api/roster'
import { GRADE_ORDER } from '../../../admissions/roster'

// 新增班級與修改班級（2026-11-15，規格 §8.1）。修改時年級不能改，只送有改的欄位；
// 班上沒有幼生才顯示「刪除班級」（確認框與 API 由 RosterTab 處理）。busy：送出中，送出與刪除停用，連點不會建兩班。
const props = defineProps<{ modelValue: boolean; schoolYear: number; room: RosterClass | null; memberCount: number; busy?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [body: ClassCreate | Omit<ClassUpdate, 'expected_version'>]
  delete: []
}>()

type Form = { grade: string; class_code: string; name: string; english_name: string; head_teacher: string; assistant_teacher: string; english_teacher: string; target_seats: string | number }
const blank = (): Form => ({ grade: '大班', class_code: '', name: '', english_name: '', head_teacher: '', assistant_teacher: '', english_teacher: '', target_seats: '' })
const form = reactive<Form>(blank())
const error = ref('')
const editing = computed(() => props.room !== null)

watch(() => [props.modelValue, props.room?.id], () => {
  if (!props.modelValue) return
  error.value = ''
  const room = props.room
  Object.assign(form, room
    ? {
        grade: room.grade, class_code: room.class_code, name: room.name, english_name: room.english_name ?? '',
        head_teacher: room.head_teacher ?? '', assistant_teacher: room.assistant_teacher ?? '',
        english_teacher: room.english_teacher ?? '', target_seats: room.target_seats === null ? '' : String(room.target_seats),
      }
    : blank())
}, { immediate: true })

const TEXT_FIELDS = ['english_name', 'head_teacher', 'assistant_teacher', 'english_teacher'] as const
// type=number 的 v-model 會把有填的值轉成數字，沒填是空字串。
const seats = () => (String(form.target_seats).trim() === '' ? null : Math.max(0, Math.trunc(Number(form.target_seats))))

function submit() {
  const code = form.class_code.trim()
  const name = form.name.trim()
  if (!code || !name) {
    error.value = '請填班序與班級名稱'
    return
  }
  const target = seats()
  if (target !== null && Number.isNaN(target)) {
    error.value = '目標人數要填數字'
    return
  }
  const room = props.room
  if (!room) {
    const body: ClassCreate = { school_year: props.schoolYear, grade: form.grade as ClassCreate['grade'], name, class_code: code }
    for (const key of TEXT_FIELDS) if (form[key].trim()) body[key] = form[key].trim()
    if (target !== null) body.target_seats = target
    emit('save', body)
    return
  }
  const body: Omit<ClassUpdate, 'expected_version'> = {}
  if (name !== room.name) body.name = name
  if (code !== room.class_code) body.class_code = code
  for (const key of TEXT_FIELDS) {
    const next = form[key].trim() || null
    if (next !== room[key]) body[key] = next
  }
  if (target !== room.target_seats) body.target_seats = target
  emit('save', body)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="editing ? `修改班級　${room!.name}` : '新增班級'"
    width="520px"
    class="roster-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="roster-form">
      <label>年級
        <select v-model="form.grade" :disabled="editing">
          <option v-for="grade in GRADE_ORDER" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </label>
      <div class="roster-form__row">
        <label>班序<input v-model="form.class_code" maxlength="20" placeholder="例：大1" /></label>
        <label>班級名稱<input v-model="form.name" maxlength="50" placeholder="例：大一班" /></label>
      </div>
      <label>英文班名<input v-model="form.english_name" maxlength="50" /></label>
      <div class="roster-form__row">
        <label>班導<input v-model="form.head_teacher" maxlength="50" /></label>
        <label>副班導<input v-model="form.assistant_teacher" maxlength="50" /></label>
      </div>
      <div class="roster-form__row">
        <label>美師<input v-model="form.english_teacher" maxlength="50" /></label>
        <label>目標人數<input v-model="form.target_seats" type="number" min="0" inputmode="numeric" /></label>
      </div>
      <p v-if="error" class="roster-form__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button v-if="editing && memberCount === 0" type="button" class="roster-form__delete" :disabled="busy" @click="emit('delete')">刪除班級</button>
      <button type="button" class="roster-form__cancel" @click="emit('update:modelValue', false)">取消</button>
      <button type="button" class="roster-form__primary" :disabled="busy" :aria-busy="busy" @click="submit">{{ editing ? '儲存' : '新增班級' }}</button>
    </template>
  </el-dialog>
</template>

<style src="./rosterForm.css"></style>
