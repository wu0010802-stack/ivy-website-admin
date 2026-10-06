<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createContactLog, listContactLogs } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import { CONTACT_CHANNEL_LABELS } from '../../api/labels'
import type { ContactLog, RecruitmentVisit } from '../../api/types'
import { ANONYMIZED_CONFLICT_TEXT } from '../../admissions/constants'
import { followUpText, isOpenStage, lastContactText, resolveNextFollowUp, type NextFollowUpChoice } from '../../admissions/followUp'
import { notifyError, notifyWarning } from '../../composables/notify'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { useRequestSequence } from '../../composables/useRequestSequence'
import NextFollowUpPicker from './NextFollowUpPicker.vue'

// 記錄參觀後的一次聯絡（docs/specs/2026-10-04-admissions-follow-up-design.md 6.3、7.2）。
// 歷程抽屜、預約明細共用。一定要決定下次聯絡（時間或不用再追），已到期的
// 訪視記完才會離開明細的「追蹤：已到期」。409 時不關對話框、內容保留，請父層重讀後讓使用者再送一次。
// grade、contact_name、phone 選填：有傳才在抬頭顯示（歷程抽屜與預約明細沒有就不顯示）。
export type ContactTarget = {
  id: string
  version: number
  child_name: string
  stage: string
  grade?: string | null
  contact_name?: string | null
  phone?: string | null
}

const props = defineProps<{ target: ContactTarget | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit, log: ContactLog]; stale: [] }>()

const CHANNELS = Object.entries(CONTACT_CHANNEL_LABELS)
// 手機滿版（規格 7.2）。
const narrow = useNarrowScreen()

const contactedAt = ref<string | null>(null)
const channel = ref('phone')
const reached = ref<boolean | null>(null)
const note = ref('')
const updateParentResponse = ref(true)
const nextChoice = ref<NextFollowUpChoice>('')
const nextCustom = ref<string | null>(null)
const pending = ref(false)
const staleNotice = ref(false)
// 使用者自己點過「下次聯絡」之後，切換聯絡結果不再改它的預設。
let nextTouched = false

const closed = computed(() => !isOpenStage(props.target?.stage))
const nextValue = computed(() => resolveNextFollowUp(nextChoice.value, nextCustom.value))
const noteRequired = computed(() => reached.value === true)
const canSubmit = computed(
  () =>
    !pending.value &&
    reached.value !== null &&
    (!noteRequired.value || note.value.trim().length > 0) &&
    nextValue.value !== undefined,
)
// 還缺什麼：停用「記下來」時在 footer 說明，不讓人猜。
const missing = computed(() => {
  const items: string[] = []
  if (reached.value === null) items.push('選結果')
  if (noteRequired.value && !note.value.trim()) items.push('填內容')
  if (nextValue.value === undefined) items.push('選下次聯絡')
  return items
})
const dirty = computed(() => reached.value !== null || note.value.trim().length > 0 || nextChoice.value !== '')

// 上一次聯絡：開啟後才背景讀取，失敗或沒有紀錄就不顯示，不擋對話框也不跳錯誤。
const lastLog = ref<ContactLog | null>(null)
const lastLogRequests = useRequestSequence()
const lastLogText = computed(() => {
  const log = lastLog.value
  return log ? `上次：${lastContactText(log.contacted_at, log.channel, log.reached).replace('・', ' ')}` : ''
})
const lastLogNote = computed(() => lastLog.value?.note?.trim() ?? '')

async function loadLastLog(id: string) {
  const request = lastLogRequests.begin()
  lastLog.value = null
  try {
    const logs = await listContactLogs(id)
    if (!lastLogRequests.isCurrent(request) || !Array.isArray(logs) || !logs.length) return
    lastLog.value = logs.reduce((latest, log) => (new Date(log.contacted_at).getTime() > new Date(latest.contacted_at).getTime() ? log : latest))
  } catch {
    // 讀不到就不顯示這一行
  }
}

watch(open, (value) => {
  if (!value) return
  if (props.target) void loadLastLog(props.target.id)
  else lastLog.value = null
  contactedAt.value = null
  channel.value = 'phone'
  reached.value = null
  note.value = ''
  updateParentResponse.value = true
  nextChoice.value = closed.value ? 'none' : ''
  nextCustom.value = null
  staleNotice.value = false
  nextTouched = false
})

// 預設：沒聯絡到→明天 10:00；聯絡到→不預選，由使用者決定（規格 7.2）。
watch(reached, (value) => {
  if (nextTouched || closed.value) return
  nextChoice.value = value === false ? 'tomorrow' : ''
})

function chooseNext(value: NextFollowUpChoice) {
  nextTouched = true
  nextChoice.value = value
}

// 不能選未來的聯絡時間（後端 CONTACTED_AT_IN_FUTURE）。
function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

async function beforeClose(done: () => void) {
  if (pending.value) return
  if (!dirty.value) return done()
  try {
    await ElMessageBox.confirm('這筆聯絡紀錄還沒送出，要放棄嗎？', '放棄填寫？', {
      confirmButtonText: '放棄填寫',
      cancelButtonText: '繼續填寫',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
      autofocus: false,
    })
    done()
  } catch {
    // 留在對話框
  }
}

async function submit() {
  const target = props.target
  const next = nextValue.value
  if (!target || !canSubmit.value || next === undefined || reached.value === null) return
  pending.value = true
  try {
    const result = await createContactLog(target.id, {
      expected_version: target.version,
      contacted_at: contactedAt.value ? new Date(contactedAt.value).toISOString() : null,
      channel: channel.value as 'phone',
      reached: reached.value,
      note: note.value.trim() || null,
      next_follow_up_at: next,
      update_parent_response: reached.value && updateParentResponse.value,
    })
    ElMessage.success(next ? `已記下，下次聯絡 ${followUpText(next)}` : '已記下，不用再追')
    open.value = false
    emit('saved', result.visit, result.log)
  } catch (err) {
    if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
      notifyWarning(ANONYMIZED_CONFLICT_TEXT)
      open.value = false
      emit('stale')
    } else if (isVersionConflict(err)) {
      // 不關對話框、內容保留：父層重讀後 target 帶新版本，使用者確認後再送一次。
      staleNotice.value = true
      ElMessage.info('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
      emit('stale')
    } else if (err instanceof ApiError && err.status === 404) {
      notifyWarning('這筆招生訪視已被刪除，已重新載入')
      open.value = false
      emit('stale')
    } else {
      notifyError(apiErrorMessage(err, '記錄聯絡失敗'))
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="contact-log-dialog"
    title="記錄聯絡"
    width="min(580px, calc(100vw - 32px))"
    :fullscreen="narrow"
    append-to-body
    :close-on-click-modal="false"
    :before-close="beforeClose"
  >
    <div class="contact-log__who">
      <span class="contact-log__child">幼生：{{ target?.child_name }}<template v-if="target?.grade">（{{ target.grade }}）</template></span>
      <span v-if="target?.contact_name">家長：{{ target.contact_name }}</span>
      <a v-if="target?.phone" :href="`tel:${target.phone}`" class="num contact-log__phone" :aria-label="`撥打 ${target.phone}`">{{ target.phone }}</a>
    </div>
    <p v-if="lastLogText" class="contact-log__last">
      {{ lastLogText }}
      <span v-if="lastLogNote" class="contact-log__last-note" :title="lastLogNote">{{ lastLogNote }}</span>
    </p>
    <el-alert v-if="staleNotice" type="info" :closable="false" show-icon title="你的紀錄還沒送出：這筆剛被其他人修改，已重新載入。確認內容後再按一次「記下來」。" class="contact-log__stale" />
    <el-form label-position="top" :disabled="pending" @submit.prevent>
      <div class="contact-log__row">
        <el-form-item label="聯絡時間">
          <el-date-picker
            v-model="contactedAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss+08:00"
            format="YYYY/MM/DD HH:mm"
            placeholder="現在"
            aria-label="聯絡時間"
            :disabled-date="disableFuture"
            clearable
            class="contact-log__when"
          />
        </el-form-item>
        <el-form-item label="方式">
          <el-radio-group v-model="channel" aria-label="聯絡方式">
            <el-radio-button v-for="[value, label] in CHANNELS" :key="value" :value="value">{{ label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </div>
      <el-form-item label="結果" required>
        <el-radio-group v-model="reached" aria-label="聯絡結果">
          <el-radio-button :value="true">聯絡到了</el-radio-button>
          <el-radio-button :value="false">沒聯絡到</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="內容" :required="noteRequired">
        <el-input
          v-model="note"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          maxlength="1000"
          show-word-limit
          :placeholder="reached === false ? '例如：沒接、轉語音信箱' : '家長怎麼說'"
          aria-label="聯絡內容"
        />
      </el-form-item>
      <el-form-item v-if="reached === true" class="contact-log__sync">
        <el-checkbox v-model="updateParentResponse">寫進電訪回應</el-checkbox>
        <p class="field-help">會取代目前的電訪回應；統計的未預繳名單顯示的就是電訪回應。</p>
      </el-form-item>
      <el-form-item label="下次聯絡" required>
        <NextFollowUpPicker
          :model-value="nextChoice"
          v-model:custom="nextCustom"
          :closed="closed"
          @update:model-value="chooseNext"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="contact-log__footer">
        <p class="contact-log__missing" aria-live="polite">{{ missing.length ? `還不能記下：還沒${missing.join('、')}` : '' }}</p>
        <div class="contact-log__buttons">
          <el-button :disabled="pending" @click="open = false">取消</el-button>
          <el-button type="primary" :loading="pending" :disabled="!canSubmit" @click="submit">記下來</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.contact-log__who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin: 0 0 12px;
}

.contact-log__child {
  font-weight: 600;
}

.contact-log__phone {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.contact-log__last {
  margin: -4px 0 12px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.contact-log__last-note {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.contact-log__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 16px;
}

.contact-log__missing {
  flex: 1 1 200px;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: left;
}

.contact-log__buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.contact-log__stale {
  margin-bottom: 12px;
}

.contact-log__row {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
}

.contact-log__when {
  width: 200px;
}

.contact-log__sync :deep(.el-form-item__content) {
  display: block;
}

.contact-log__sync .field-help {
  margin: 2px 0 0;
}

@media (max-width: 720px) {
  .contact-log__when {
    width: 100%;
  }

  .contact-log__phone {
    min-height: 44px;
  }
}
</style>

