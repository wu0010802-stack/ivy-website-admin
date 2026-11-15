<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { StudentsCreate } from '../../../api/roster'
import { GRADE_ORDER } from '../../../admissions/roster'

// 補登預繳（2026-11-15，規格 §7 補登、§8.2）：一次貼上多個姓名（一行一位），共用同一組入學學期、班別與預繳日期；
// 生日只有一位時才能填，其餘之後逐位補。不建看板紀錄、不影響招生統計。
const props = defineProps<{ modelValue: boolean; schoolYear: number; today: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; save: [body: StudentsCreate] }>()

const form = reactive({ names: '', term: '', grade: '', deposit_date: '', planned_entry_date: '', birthday: '' })
const error = ref('')

const terms = computed(() => [
  { value: `${props.schoolYear}-1`, label: `${props.schoolYear}上預繳（12–1月入園）` },
  { value: `${props.schoolYear}-2`, label: `${props.schoolYear}下預繳（2–7月入園）` },
  { value: `${props.schoolYear + 1}-1`, label: `${props.schoolYear + 1}上預繳（8月入園）` },
])
// 送出的是原始每一行（含空白行），後端回報「第 N 行」才對得上貼上的內容。
const MAX_LINES = 60
const lines = computed(() => form.names.replace(/\r/g, '').replace(/\n+$/, '').split('\n'))
const names = computed(() => lines.value.map((name) => name.trim()).filter(Boolean))
const gradeLabel = computed(() => (form.term === `${props.schoolYear + 1}-1` ? `${props.schoolYear + 1} 學年的班別` : '班別'))

watch(() => props.modelValue, (open) => {
  if (!open) return
  Object.assign(form, { names: '', term: `${props.schoolYear}-1`, grade: '', deposit_date: props.today, planned_entry_date: '', birthday: '' })
  error.value = ''
}, { immediate: true })

function submit() {
  if (!names.value.length) return void (error.value = '請至少填一位幼生的姓名')
  if (lines.value.length > MAX_LINES) return void (error.value = `一次最多 ${MAX_LINES} 行，請分批補登`)
  if (!form.grade) return void (error.value = '請選班別')
  if (!form.deposit_date) return void (error.value = '請填預繳日期')
  const [year, semester] = form.term.split('-').map(Number)
  const pending: StudentsCreate['pending'] = {
    grade: form.grade as NonNullable<StudentsCreate['pending']>['grade'],
    target_school_year: year!,
    target_semester: semester!,
    deposit_date: form.deposit_date,
  }
  if (form.planned_entry_date) pending.planned_entry_date = form.planned_entry_date
  if (names.value.length === 1 && form.birthday) pending.birthday = form.birthday
  emit('save', { school_year: props.schoolYear, names: lines.value, pending })
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="補登預繳" width="520px" class="roster-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="roster-form">
      <label>姓名（一行一位，可以貼上整欄）
        <textarea v-model="form.names" rows="4" />
      </label>
      <div class="roster-form__terms" role="radiogroup" aria-label="入學時段">
        <label v-for="term in terms" :key="term.value">
          <input v-model="form.term" type="radio" name="roster-term" :value="term.value" />{{ term.label }}
        </label>
      </div>
      <div class="roster-form__row">
        <label>{{ gradeLabel }}
          <select v-model="form.grade">
            <option value="">請選擇</option>
            <option v-for="grade in GRADE_ORDER" :key="grade" :value="grade">{{ grade }}</option>
          </select>
        </label>
        <label>預繳日期<input v-model="form.deposit_date" type="date" /></label>
      </div>
      <div class="roster-form__row">
        <label>預定入園日（選填）<input v-model="form.planned_entry_date" type="date" /></label>
        <label>生日（選填）<input v-model="form.birthday" type="date" :disabled="names.length !== 1" /></label>
      </div>
      <p class="roster-form__hint">填了預定入園日，入學學期就由日期決定。一次貼上多位時生日之後再逐位補。</p>
      <p v-if="error" class="roster-form__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="roster-form__cancel" @click="emit('update:modelValue', false)">取消</button>
      <button type="button" class="roster-form__primary" @click="submit">補登</button>
    </template>
  </el-dialog>
</template>

<style src="./rosterForm.css"></style>
