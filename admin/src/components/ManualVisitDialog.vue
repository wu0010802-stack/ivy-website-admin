<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyWarning } from '../composables/notify'
import { api, ApiError } from '../api/client'
import type { VisitRequestDetailOut, VisitRequestManualCreate, VisitSlotOut } from '../api/types'
import { MANUAL_VISIT_SOURCES, PARTY_SIZE_OPTIONS, VISIT_SOURCE_LABELS, formatSlotWhen, slotStarted } from '../api/labels'
import { groupSlotsByDay, slotChoiceTime } from '../utils/sessions'
import CampusSelect from './CampusSelect.vue'

// 人工補登：家長打電話、傳 LINE、直接到園或從外部網站來的參觀需求。
// 一定要選場次（2026-09-30 家長自選場次裁定），送出即「預約正常」。
const props = defineProps<{
  campusKeys: readonly string[]
  defaultCampus?: string
  /** 結案後重新預約：帶入舊案資料，新案會關聯舊案（跨校需總管理者） */
  relatedFrom?: VisitRequestDetailOut | null
}>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [request: VisitRequestDetailOut] }>()

type ManualSource = VisitRequestManualCreate['source']

function blank() {
  return {
    campus_key: props.defaultCampus || props.campusKeys[0] || '',
    source: 'phone' as ManualSource,
    parent_name: '',
    phone: '',
    child_name: '',
    child_birthdate: null as string | null,
    email: '',
    // 參觀人數 1–10；電話裡沒問到可以留空（明細顯示「未填寫」）。
    party_size: null as number | null,
    questions: '',
    note: '',
    slot_id: '',
  }
}

const form = reactive(blank())
const slots = ref<VisitSlotOut[]>([])
const slotsLoading = ref(false)
const slotsError = ref(false)
// 該校有沒有設定寄信（預約設定 parent_email_enabled）；null＝讀不到（例如沒有權限）或還在讀。
const emailEnabled = ref<boolean | null>(null)
const submitting = ref(false)
const error = ref<string | null>(null)
// 打開當下的表單內容（重新預約會先帶入舊案資料）；和它不同就是有輸入，關閉前要先問。
const initial = ref('')
// 同一次補登共用同一把 key：網路逾時重按不會建出兩筆。重開對話框才換新的。
let idempotencyKey = ''

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

watch(open, (value) => {
  if (!value) return
  Object.assign(form, blank())
  const from = props.relatedFrom
  if (from) {
    form.campus_key = from.campus_key
    form.parent_name = from.parent_name
    form.phone = from.phone
    form.child_name = from.child_name ?? ''
    form.child_birthdate = from.child_birthdate ?? null
    form.email = from.email ?? ''
    form.party_size = from.party_size ?? null
  }
  initial.value = JSON.stringify(form)
  error.value = null
  idempotencyKey = newKey()
  void loadSlots()
  void loadEmailEnabled()
})

watch(() => form.campus_key, () => {
  form.slot_id = ''
  if (open.value) {
    void loadSlots()
    void loadEmailEnabled()
  }
})

async function loadEmailEnabled() {
  const campus = form.campus_key
  emailEnabled.value = null
  if (!campus) return
  try {
    const config = await api.get<{ parent_email_enabled?: boolean }>(`/admin/booking-config/${campus}`)
    if (form.campus_key === campus && typeof config?.parent_email_enabled === 'boolean') emailEnabled.value = config.parent_email_enabled
  } catch {
    emailEnabled.value = null
  }
}

// Email 欄的說明跟著寄信設定走：沒設定時不能說會寄信（DESIGN.md 2026-10-02）。
const emailHelp = computed(() => {
  if (emailEnabled.value === true) return '有填會寄確認信與修改連結給家長。'
  if (emailEnabled.value === false) return '尚未設定寄信。補登後請到案件頁產生家長管理連結，用簡訊或 LINE 交給家長。'
  return '設定寄信後會寄確認信與修改連結；沒設定時請到案件頁產生連結交給家長。'
})

// 選好後在選單下面整行寫出完整場次，選單收起來時被截斷也看得到。
const chosenSlot = computed(() => openSlots.value.find((s) => s.id === form.slot_id) ?? null)
const slotOptionLabel = (slot: VisitSlotOut) => `${formatSlotWhen(slot)}，剩 ${slot.capacity - slot.booked_count} 組`

// 內容一改就換 key：改過的表單是新的一次送出，不能被當成重播而撞 409。
watch(form, () => { if (!submitting.value) idempotencyKey = newKey() }, { deep: true })

async function loadSlots() {
  if (!form.campus_key) return
  slotsLoading.value = true
  slotsError.value = false
  try {
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const params = new URLSearchParams({ campus_key: form.campus_key, date_from: today, date_to: future })
    slots.value = await api.get<VisitSlotOut[]>(`/admin/slots?${params}`)
  } catch {
    slots.value = []
    slotsError.value = true
  } finally {
    slotsLoading.value = false
  }
}

// 和案件明細同一個規則：已經開始的場次不能再排人（後端也會拒絕），名額滿或關閉的也不列。
const openSlots = computed(() => slots.value.filter((s) => !s.closed && s.booked_count < s.capacity && !slotStarted(s)))
const phoneDigits = computed(() => form.phone.replace(/[\s\-－]/g, ''))
const phoneValid = computed(() => /^09\d{8}$/.test(phoneDigits.value))
const canSubmit = computed(
  () => Boolean(form.campus_key && form.parent_name.trim() && phoneValid.value && form.slot_id),
)

// 送出鈕停用時說清楚還差什麼。2026-10-02 起補登不用勾選「已向家長說明並取得同意」。
const missing = computed(() => {
  const empty = [
    form.campus_key ? '' : '校區',
    form.parent_name.trim() ? '' : '家長稱呼',
    phoneDigits.value ? '' : '手機',
    form.slot_id ? '' : '參觀場次',
  ].filter(Boolean)
  return [
    empty.length ? `還沒填${empty.join('、')}` : '',
    phoneDigits.value && !phoneValid.value ? '手機號碼格式不對' : '',
  ].filter(Boolean).join('；')
})

const dirty = computed(() => open.value && JSON.stringify(form) !== initial.value)

// 邊講電話邊填，誤按 Esc、右上角 X 或「取消」不能讓整筆消失；送出中不能關。
async function beforeClose(done: () => void) {
  if (submitting.value) return
  if (!dirty.value) {
    done()
    return
  }
  try {
    await ElMessageBox.confirm('已經填的內容會清掉，下次打開要重新填。', props.relatedFrom ? '放棄這次重新預約？' : '放棄這筆補登？', {
      confirmButtonText: '放棄填寫',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
      autofocus: false,
    })
  } catch {
    return
  }
  done()
}

function requestClose() {
  void beforeClose(() => { open.value = false })
}

function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const d = err.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) {
      const msgs = d
        .map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : ''))
        .filter(Boolean)
        .map((m) => m.replace(/^Value error,\s*/, ''))
      if (msgs.length) return msgs.join('；')
    }
    if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message)
  }
  return '補登失敗，請稍後再試'
}

async function submit() {
  if (!form.slot_id) {
    notifyWarning('請選擇參觀場次')
    return
  }
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  const body: VisitRequestManualCreate = {
    campus_key: form.campus_key,
    source: form.source,
    parent_name: form.parent_name.trim(),
    phone: phoneDigits.value,
    child_name: form.child_name.trim() || null,
    child_birthdate: form.child_birthdate || null,
    email: form.email.trim() || null,
    // 家長自選場次之後不再問方便接電話時段（DESIGN.md 2026-09-30）；欄位仍在 API 上，一律不送值。
    preferred_time: null,
    party_size: form.party_size,
    questions: form.questions.trim() || null,
    note: form.note.trim() || null,
    slot_id: form.slot_id,
    // 2026-10-02 起補登不用勾選同意，明確送 false（案件明細寫「補登不需勾選同意」）。
    consent_given: false,
    related_request_id: props.relatedFrom?.id ?? null,
  }
  try {
    const created = await api.post<VisitRequestDetailOut>('/admin/visit-requests', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    ElMessage.success(`已補登，參觀時間 ${formatSlotWhen(created.slot)}`)
    open.value = false
    emit('created', created)
  } catch (err) {
    error.value = messageOf(err)
    if (err instanceof ApiError && err.status === 409) void loadSlots()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- 內容區自己捲動、底部（送出列）固定在對話框下緣，欄位再多也不用捲到最底才找得到。 -->
  <el-dialog
    v-model="open"
    class="manual-dialog"
    :title="relatedFrom ? '重新預約（另建新案）' : '補登參觀案件'"
    width="min(560px, calc(100vw - 32px))"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    :before-close="beforeClose"
  >
    <p class="hint manual__lead">{{ relatedFrom ? '舊案保持結案，新案會記下是從哪一筆重新預約。換到別校需要總管理者。' : '家長打電話、傳 LINE 或直接到園詢問時，在這裡登錄，之後就跟官網送來的案件一起追蹤。' }}</p>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="manual__alert" />

    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item label="校區" required>
        <CampusSelect v-model="form.campus_key" :keys="campusKeys" />
      </el-form-item>
      <el-form-item label="家長從哪裡聯絡" required>
        <el-radio-group v-model="form.source" class="manual__sources">
          <el-radio-button v-for="s in MANUAL_VISIT_SOURCES" :key="s" :value="s">{{ VISIT_SOURCE_LABELS[s] }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <div class="manual__row">
        <el-form-item label="家長稱呼" required>
          <el-input v-model="form.parent_name" maxlength="64" placeholder="例如：王媽媽" />
        </el-form-item>
        <el-form-item label="手機" required :error="form.phone && !phoneValid ? '請輸入 09 開頭的 10 碼手機' : ''">
          <el-input v-model="form.phone" inputmode="tel" placeholder="0912345678" />
        </el-form-item>
      </div>

      <!-- 當場談好時間是送出前最重要的決定，排在必填欄位後面，選填的孩子資料再往下。 -->
      <el-form-item label="參觀場次" required>
        <el-select v-model="form.slot_id" :loading="slotsLoading" placeholder="選擇場次" filterable style="width: 100%">
          <el-option-group v-for="group in groupSlotsByDay(openSlots)" :key="group.day" :label="group.label">
            <el-option v-for="slot in group.slots" :key="slot.id" :value="slot.id" :label="slotOptionLabel(slot)">{{ slotChoiceTime(slot) }}</el-option>
          </el-option-group>
        </el-select>
        <span v-if="slotsError" class="field-help">
          讀不到這個校區的場次。<el-button link type="primary" @click="loadSlots">重新讀取</el-button>
        </span>
        <span v-else-if="!slotsLoading && openSlots.length === 0" class="field-help">未來 60 天沒有可以排入的場次，請先到「參觀場次」開放場次。</span>
        <span v-else-if="chosenSlot" class="field-help">已選：{{ slotOptionLabel(chosenSlot) }}。送出後案件直接成為「預約正常」。</span>
        <span v-else class="field-help">送出後案件直接成為「預約正常」。</span>
      </el-form-item>

      <div class="manual__row">
        <el-form-item label="孩子姓名">
          <el-input v-model="form.child_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="孩子生日">
          <el-date-picker v-model="form.child_birthdate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableFuture" style="width: 100%" />
        </el-form-item>
      </div>

      <div class="manual__row">
        <el-form-item label="Email">
          <el-input v-model="form.email" type="email" maxlength="254" />
          <span class="field-help">{{ emailHelp }}</span>
        </el-form-item>
        <el-form-item label="參觀人數">
          <el-select v-model="form.party_size" clearable placeholder="選填，含大人與孩子" style="width: 100%">
            <el-option v-for="size in PARTY_SIZE_OPTIONS" :key="size" :label="`${size} 位`" :value="size" />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="家長想了解的事">
        <el-input v-model="form.questions" type="textarea" maxlength="500" show-word-limit :autosize="{ minRows: 2, maxRows: 5 }" />
      </el-form-item>

      <el-form-item label="聯絡紀錄" class="manual__last">
        <el-input v-model="form.note" type="textarea" maxlength="1000" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="例如：家長來電，希望週六上午參觀" />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="manual__footer">
        <div class="manual__submit">
          <p class="manual__missing" aria-live="polite">{{ missing ? `還不能送出：${missing}` : '' }}</p>
          <div class="manual__buttons">
            <el-button :disabled="submitting" @click="requestClose">取消</el-button>
            <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
              補登案件
            </el-button>
          </div>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.manual__lead { margin: 0 0 16px; }
.manual__alert { margin-bottom: 16px; }
.manual__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.manual__last { margin-bottom: 0; }
.manual__footer { display: grid; gap: 10px; width: 100%; text-align: left; }
.manual__submit { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; }
.manual__missing { flex: 1 1 200px; margin: 0; color: var(--ink-3); font-size: var(--text-sm); line-height: 1.5; text-wrap: pretty; }
/* 沒有要說的時候不占寬度，但仍留在頁面上：報讀區被 display: none 拿掉後再出現，報讀軟體常常不念。 */
.manual__missing:empty { flex-basis: 0; }
.manual__buttons { display: flex; gap: 8px; margin-left: auto; }
.manual__buttons .el-button + .el-button { margin-left: 0; }
@media (max-width: 560px) {
  .manual__row { grid-template-columns: minmax(0, 1fr); }
  /* 四個來源在窄螢幕排成兩欄，每顆都有完整框線，不會斷成殘缺的分段按鈕。Element Plus 用
     outline 畫分段框線，畫在按鈕外側會被對話框的捲動區切掉，這裡改回 border 畫在內側。 */
  .manual__sources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
  .manual__sources :deep(.el-radio-button__inner) { width: 100%; justify-content: center; border: var(--el-border); outline: none; border-radius: var(--radius); }
  .manual__sources :deep(.el-radio-button.is-active .el-radio-button__inner) { box-shadow: none; }
  .manual__sources :deep(.el-radio-button__original-radio:focus-visible + .el-radio-button__inner) { outline: 2px solid var(--el-color-primary); outline-offset: -4px; }
}
@media (max-width: 720px) {
  .manual__missing { font-size: var(--text-base); }
}
</style>

<style>
/* 對話框本體是 Element Plus 產生、掛在 body 下，scoped 樣式碰不到，用自己的 class 限定。 */
.manual-dialog.el-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100svh - 10vh);
  margin-bottom: 5vh;
}

.manual-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.manual-dialog .el-dialog__footer {
  flex: none;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

@media (max-width: 720px) {
  .manual-dialog.el-dialog {
    max-height: calc(100svh - 12svh);
    margin-bottom: 4svh;
  }
}
</style>
