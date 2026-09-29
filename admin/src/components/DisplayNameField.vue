<script setup lang="ts">
import { computed, ref } from 'vue'
import { DISPLAY_NAME_MAX_LENGTH, displayNameError, displayNameLength } from '../api/labels'

// 顯示名稱欄：新增帳號、總管理者修改同事、本人在「我的帳號」修改共用。
// 規則和後端相同（labels.displayNameError）：邊打邊算字數，超過 12 字或有換行、
// 看不見的字元時直接在欄位下方寫原因；後端另外回的錯誤由 serverError 帶進來。
const props = defineProps<{
  inputId: string
  /** 後端 422 指到 display_name 時的訊息（已翻成中文），使用者一改就由外層清掉 */
  serverError?: string
  /** 欄位下方的說明；不給就用預設（誰會看到、留空會怎樣） */
  help?: string
}>()
const model = defineModel<string>({ required: true })
const input = ref<{ focus: () => void } | null>(null)
const length = computed(() => displayNameLength(model.value))
const error = computed(() => displayNameError(model.value) || props.serverError || '')
const helpText = computed(() => props.help ?? '同事在承辦人、聯絡紀錄、發布紀錄與操作紀錄看到的名字。留空就用 Email @ 前面那段。')

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <el-form-item :label="`顯示名稱（選填，最多 ${DISPLAY_NAME_MAX_LENGTH} 字）`" :for="inputId" :error="error" :show-message="false">
    <el-input
      :id="inputId"
      ref="input"
      v-model="model"
      autocomplete="off"
      placeholder="例如：王小美"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="`${inputId}-count${error ? ` ${inputId}-error` : ''}`"
    />
    <p v-if="error" :id="`${inputId}-error`" class="display-name__error" data-test="display-name-error">{{ error }}</p>
    <span :id="`${inputId}-count`" class="field-help display-name__count" :class="{ 'is-over': length > DISPLAY_NAME_MAX_LENGTH }" data-test="display-name-count">
      目前 {{ length }}／{{ DISPLAY_NAME_MAX_LENGTH }} 字
    </span>
    <span class="field-help">{{ helpText }}</span>
  </el-form-item>
</template>

<style scoped>
.display-name__error {
  flex-basis: 100%;
  margin: 0;
  padding-top: 4px;
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.45;
}

.display-name__count.is-over {
  color: var(--el-color-danger);
}
</style>
