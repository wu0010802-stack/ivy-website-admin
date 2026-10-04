<script setup lang="ts">
import { FOLLOW_UP_SHORTCUTS, CLOSED_STAGE_HINT, type NextFollowUpChoice } from '../../admissions/followUp'

// 「下次聯絡」的選擇（記錄聯絡、改期共用）：快捷時間、自選時間、不用再追。
// closed（已註冊、已退出）時只能選「不用再追」。值的換算在 followUp.resolveNextFollowUp。
const props = withDefaults(defineProps<{ closed?: boolean; noneLabel?: string; disabled?: boolean }>(), {
  closed: false,
  noneLabel: '不用再追',
  disabled: false,
})
const choice = defineModel<NextFollowUpChoice>({ required: true })
const custom = defineModel<string | null>('custom', { required: true })

// 日期選擇器不給過去的日子：下次聯絡記在昨天沒有意義（後端也會擋 FOLLOW_UP_IN_PAST）。
function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}
</script>

<template>
  <div class="next-follow-up">
    <el-radio-group v-model="choice" :disabled="props.disabled" aria-label="下次聯絡" class="next-follow-up__choices">
      <el-radio-button v-for="item in FOLLOW_UP_SHORTCUTS" :key="item.key" :value="item.key" :disabled="props.closed">{{ item.label }}</el-radio-button>
      <el-radio-button value="custom" :disabled="props.closed">自選時間</el-radio-button>
      <el-radio-button value="none">{{ props.noneLabel }}</el-radio-button>
    </el-radio-group>
    <el-date-picker
      v-if="choice === 'custom'"
      v-model="custom"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ss+08:00"
      format="YYYY/MM/DD HH:mm"
      placeholder="選日期與時間"
      aria-label="自選下次聯絡時間"
      :disabled-date="disablePast"
      :default-time="new Date(2000, 0, 1, 10, 0, 0)"
      :disabled="props.disabled"
      class="next-follow-up__custom"
    />
    <p v-if="props.closed" class="field-help">{{ CLOSED_STAGE_HINT }}</p>
  </div>
</template>

<style scoped>
.next-follow-up {
  display: grid;
  gap: 8px;
  min-width: 0;
}

/* 快捷鍵在手機上自動換行，不撐寬對話框。 */
.next-follow-up__choices {
  display: flex;
  flex-wrap: wrap;
  row-gap: 6px;
}

.next-follow-up__custom {
  width: 100%;
  max-width: 240px;
}
</style>
