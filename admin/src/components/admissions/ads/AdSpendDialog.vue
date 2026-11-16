<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { apiErrorMessage } from '../../../api/errors'
import { putAdSpend } from '../../../api/admissions'
import type { AdSpendEntry, AdSpendPlatform } from '../../../api/types'
import { AD_ROW_LABELS, AD_SPEND_PLATFORMS } from '../../../admissions/adRoiFormat'
import { notifyError } from '../../../composables/notify'

// 每月廣告花費（手填）：新增或編輯一個月份＋平台的金額。編輯時月份與平台不能改。
const props = defineProps<{ modelValue: boolean; entry: AdSpendEntry | null; thisMonth: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()

const month = ref('')
const platform = ref<AdSpendPlatform | ''>('')
const amount = ref<number | null>(null)
const note = ref('')
const saving = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  month.value = props.entry?.month ?? props.thisMonth
  platform.value = (props.entry?.platform as AdSpendPlatform | undefined) ?? ''
  amount.value = props.entry?.amount ?? null
  note.value = props.entry?.note ?? ''
})

const editing = computed(() => props.entry !== null)
const canSave = computed(() => !!month.value && !!platform.value && amount.value !== null && amount.value >= 0 && !saving.value)
const disabledMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` > props.thisMonth

async function save() {
  if (!canSave.value || !platform.value || amount.value === null) return
  saving.value = true
  error.value = ''
  try {
    await putAdSpend(month.value, platform.value, { amount: amount.value, note: note.value.trim() || null })
    emit('update:modelValue', false)
    emit('saved')
  } catch (err) {
    const message = apiErrorMessage(err, '儲存失敗，請再試一次。')
    error.value = message
    notifyError(message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="editing ? '編輯花費' : '新增花費'" width="min(440px, 92vw)" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="月份">
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" :disabled="editing" :disabled-date="disabledMonth" />
      </el-form-item>
      <el-form-item label="平台">
        <el-select v-model="platform" placeholder="請選擇" :disabled="editing">
          <el-option v-for="key in AD_SPEND_PLATFORMS" :key="key" :label="AD_ROW_LABELS[key]" :value="key" />
        </el-select>
      </el-form-item>
      <el-form-item label="花費（新台幣）">
        <el-input-number v-model="amount" data-test="ads-amount" :min="0" :precision="0" :controls="false" />
      </el-form-item>
      <el-form-item label="備註">
        <el-input v-model="note" maxlength="200" />
      </el-form-item>
      <p v-if="error" class="ads-dialog__error" role="alert">{{ error }}</p>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" data-test="ads-save" :loading="saving" :disabled="!canSave" @click="save">儲存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ads-dialog__error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
