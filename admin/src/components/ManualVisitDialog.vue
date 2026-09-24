<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { VisitRequestDetailOut, VisitRequestManualCreate, VisitSlotOut } from '../api/types'
import { MANUAL_VISIT_SOURCES, VISIT_SOURCE_LABELS, formatSlotWhen } from '../api/labels'
import CampusSelect from './CampusSelect.vue'

// 人工補登：家長打電話、傳 LINE、直接到園或從外部網站來的參觀需求。
// 預設只建成「待處理」；當場談好時間可以直接選時段，送出即確認。
const props = defineProps<{ campusKeys: readonly string[]; defaultCampus?: string }>()
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
    preferred_time: '',
    questions: '',
    note: '',
    slot_id: '',
    consent_given: false,
  }
}

const form = reactive(blank())
const slots = ref<VisitSlotOut[]>([])
const slotsLoading = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
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
  error.value = null
  idempotencyKey = newKey()
  void loadSlots()
})

watch(() => form.campus_key, () => {
  form.slot_id = ''
  if (open.value) void loadSlots()
})

// 內容一改就換 key：改過的表單是新的一次送出，不能被當成重播而撞 409。
watch(form, () => { if (!submitting.value) idempotencyKey = newKey() }, { deep: true })

async function loadSlots() {
  if (!form.campus_key) return
  slotsLoading.value = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const params = new URLSearchParams({ campus_key: form.campus_key, date_from: today, date_to: future })
    slots.value = await api.get<VisitSlotOut[]>(`/admin/slots?${params}`)
  } catch {
    slots.value = []
  } finally {
    slotsLoading.value = false
  }
}

const openSlots = computed(() => slots.value.filter((s) => !s.closed && s.booked_count < s.capacity))
const phoneDigits = computed(() => form.phone.replace(/[\s\-－]/g, ''))
const phoneValid = computed(() => /^09\d{8}$/.test(phoneDigits.value))
const canSubmit = computed(
  () => Boolean(form.campus_key && form.parent_name.trim() && phoneValid.value && form.consent_given),
)

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
    preferred_time: form.preferred_time.trim() || null,
    questions: form.questions.trim() || null,
    note: form.note.trim() || null,
    slot_id: form.slot_id || null,
    consent_given: form.consent_given,
  }
  try {
    const created = await api.post<VisitRequestDetailOut>('/admin/visit-requests', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    ElMessage.success(created.status === 'confirmed' ? `已補登並確認，參觀時間 ${formatSlotWhen(created.slot)}` : '已補登，案件狀態為待處理')
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
  <el-dialog v-model="open" title="補登參觀案件" width="min(560px, calc(100vw - 32px))" top="5vh" append-to-body :close-on-click-modal="false">
    <p class="hint manual__lead">家長打電話、傳 LINE 或直接到園詢問時，在這裡登錄，之後就跟官網送來的案件一起追蹤。</p>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="manual__alert" />

    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item label="校區" required>
        <CampusSelect v-model="form.campus_key" :keys="campusKeys" />
      </el-form-item>
      <el-form-item label="家長從哪裡聯絡" required>
        <el-radio-group v-model="form.source">
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
        </el-form-item>
        <el-form-item label="方便聯絡時段">
          <el-input v-model="form.preferred_time" maxlength="32" placeholder="例如：平日下午" />
        </el-form-item>
      </div>

      <el-form-item label="家長想了解的事">
        <el-input v-model="form.questions" type="textarea" maxlength="1000" :autosize="{ minRows: 2, maxRows: 5 }" />
      </el-form-item>

      <el-form-item label="聯絡紀錄">
        <el-input v-model="form.note" type="textarea" maxlength="1000" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="例如：家長來電，希望週六上午參觀" />
      </el-form-item>

      <el-form-item label="直接排入時段（選填）">
        <el-select v-model="form.slot_id" clearable :loading="slotsLoading" placeholder="還沒談好時間就留空" style="width: 100%">
          <el-option v-for="slot in openSlots" :key="slot.id" :value="slot.id" :label="`${formatSlotWhen(slot)}，剩 ${slot.capacity - slot.booked_count} 位`" />
        </el-select>
        <span class="field-help">選了時段，送出後案件直接成為「已確認」。</span>
      </el-form-item>

      <el-checkbox v-model="form.consent_given" class="manual__consent">
        已向家長說明，並取得同意留存聯絡資料
      </el-checkbox>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="open = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
        {{ form.slot_id ? '補登並確認時段' : '補登案件' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.manual__lead { margin: 0 0 16px; }
.manual__alert { margin-bottom: 16px; }
.manual__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.manual__consent { white-space: normal; height: auto; align-items: flex-start; }
@media (max-width: 560px) {
  .manual__row { grid-template-columns: minmax(0, 1fr); }
}
</style>
