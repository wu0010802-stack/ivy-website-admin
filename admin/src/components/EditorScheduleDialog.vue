<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// 內容編輯頁的「排程發布」對話框（2026-10-20 從 ContentEditor.vue 抽出，行為不變）。
// 送出交給 schedule（useContentItem 的 editor.schedule：有修改先存草稿再排程），成功才關掉。
const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  schedule?: (publishAt: string) => Promise<boolean>
  publishing: boolean
  isDirty: boolean
}>()

const scheduleAt = ref<string | null>(null)
// 「明天 09:00」是最常排的時間，一鍵帶入。
const scheduleShortcuts = [
  {
    text: '明天 09:00',
    value: () => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return date
    },
  },
]

function disablePastDay(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

// 日期選單只擋得住過去的日子；今天已經過去的時間在送出前先擋，不要等存完草稿才被後端退回。
// 「現在」在開對話框、改時間、按排程時各取一次：選好時間後停在對話框裡等到
// 時間過了，按下去也會顯示提示，不會沒反應。
const scheduleNow = ref(Date.now())
watch([open, scheduleAt], () => {
  scheduleNow.value = Date.now()
})
const scheduleInPast = computed(() => Boolean(scheduleAt.value) && new Date(scheduleAt.value!).getTime() <= scheduleNow.value)

async function submitSchedule() {
  scheduleNow.value = Date.now()
  if (!scheduleAt.value || !props.schedule || scheduleInPast.value) return
  if (await props.schedule(scheduleAt.value)) open.value = false
}
</script>

<template>
  <el-dialog v-model="open" title="排程發布" width="400px" append-to-body>
    <p class="hint">選一個時間，到時自動把{{ isDirty ? '儲存後的' : '目前最新的' }}這一版發布到官網。之後再改內容不會影響這次排程。</p>
    <el-date-picker
      v-model="scheduleAt"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ss+08:00"
      format="YYYY/MM/DD HH:mm"
      :disabled-date="disablePastDay"
      :default-time="new Date(2000, 0, 1, 9, 0, 0)"
      :shortcuts="scheduleShortcuts"
      placeholder="發布時間（台灣時間）"
      style="width: 100%"
    />
    <p v-if="scheduleInPast" class="editor__schedule-error" role="alert">這個時間已經過了，請選現在之後的時間。</p>
    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="publishing" :disabled="!scheduleAt || scheduleInPast" @click="submitSchedule">{{ isDirty ? '儲存並排程' : '排程' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.editor__schedule-error { margin: 8px 0 0; font-size: var(--text-sm); color: var(--el-color-danger); }
</style>
