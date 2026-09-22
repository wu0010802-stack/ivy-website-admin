<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'
import { resolveBookingAction } from '~/utils/booking-action'

const props = defineProps<{
  booking: BookingContent
  campuses: Campus[]
  initialCampus?: string
}>()

const form = reactive({
  campus: props.initialCampus || '',
  parentName: '',
  phone: '',
  age: '',
  time: '',
  questions: '',
  consent: false
})

const selectedCampusKey = computed(() => form.campus)
const { data: bookingConfig, pending: bookingPending, refresh: refreshBookingConfig } = useCampusBooking(selectedCampusKey)
const action = computed(() => resolveBookingAction(form.campus || null, bookingConfig.value ?? null))

const availableSlots = ref<
  { id: string; slot_date: string; start_time: string; end_time: string; remaining: number }[]
>([])
const selectedSlotId = ref('')

async function loadSlots() {
  if (action.value.kind !== 'form' || bookingConfig.value?.mode !== 'slots') {
    availableSlots.value = []
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  try {
    availableSlots.value = await $fetch(
      `/api/website/v1/public/slots?campus_key=${form.campus}&date_from=${today}&date_to=${future}`
    )
  } catch {
    availableSlots.value = []
  }
}

watch(() => form.campus, loadSlots, { immediate: true })

const submitted = ref(false)
const resultStatus = ref<string | null>(null)

// 三種語意不能混用（規格 197）：inquiry 是「已收到需求」、slots 人工
// 確認是「待園方確認」、只有自動確認成功才叫「預約成立」。
const resultCopy = computed(() => {
  if (resultStatus.value === 'confirmed') {
    return {
      eyebrow: '預約成立',
      title: '已經幫你保留時段了',
      body: '已經幫你保留這個時段，園所會再與你確認參觀當天的細節。'
    }
  }
  if (resultStatus.value === 'pending_confirmation') {
    return {
      eyebrow: '待園方確認',
      title: '已經收到你的時段申請',
      body: '這個時段已先為你保留，但尚未確認成立；園所確認後會再通知你。'
    }
  }
  return {
    eyebrow: '已收到需求',
    title: '我們已經收到你的需求',
    body: '感謝你的預約需求，這只是「已收到需求」，園所會再與你聯繫確認時段。'
  }
})
const submitting = ref(false)
const submitError = ref<string | null>(null)
// 同一次填寫用同一個 idempotency key；重送（例如網路重試）會安全地
// 回到同一筆案件，不會建立第二筆。只有成功後才換新的 key。
const idempotencyKey = ref(crypto.randomUUID())

const selectedCampus = computed(() => props.campuses.find((c) => c.key === form.campus))

watch(() => form.campus, () => {
  submitError.value = null
  selectedSlotId.value = ''
})

async function onSubmit() {
  if (submitting.value || bookingPending.value || action.value.kind !== 'form' || !selectedCampus.value) return
  submitError.value = null

  if (bookingConfig.value?.mode === 'slots' && !selectedSlotId.value) {
    submitError.value = '請先選擇一個時段'
    return
  }

  submitting.value = true
  try {
    const created = await $fetch<{ receipt_id: string; status: string }>('/api/website/v1/public/visit-requests', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.value },
      body: {
        campus_key: form.campus,
        config_version: bookingConfig.value?.version ?? 0,
        parent_name: form.parentName,
        phone: form.phone,
        age: form.age || null,
        preferred_time: form.time || null,
        questions: form.questions || null,
        consent_given: form.consent,
        slot_id: bookingConfig.value?.mode === 'slots' ? selectedSlotId.value : undefined
      }
    })
    // 用 server 回的實際狀態決定文案，不要從 mode 推斷。slots 可以是
    // 「待園方確認」（規格預設）也可以是自動確認，只有 confirmed 才能
    // 說「預約成立」——規格 197。
    resultStatus.value = created?.status ?? null
    submitted.value = true
    idempotencyKey.value = crypto.randomUUID()
  } catch (err: any) {
    const detail = err?.data?.detail
    const code = typeof detail === 'object' ? detail.code : null
    if (code === 'BOOKING_CONFIG_CHANGED') {
      submitError.value = '這個校區的預約設定剛剛更新了，請確認以下資訊後再送出一次。'
      await refreshBookingConfig()
    } else if (code === 'SLOT_FULL') {
      submitError.value = '這個時段名額剛好滿了，請選擇其他時段。'
      await loadSlots()
      selectedSlotId.value = ''
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      // 同一把 key 但內容不同：代表前一次其實已經送出成功了。叫使用者
      // 「再試一次」只會永遠卡住，要換一把新 key 才送得出去。
      idempotencyKey.value = crypto.randomUUID()
      submitError.value =
        '你先前那一次其實已經送出成功了，園所會用第一次填的資料與你聯繫。如果要用修改後的內容再送一筆，請再按一次送出。'
    } else if (code === 'SLOT_NOT_BOOKABLE') {
      submitError.value = '這個時段已經無法預約了，請選擇其他時段。'
      await loadSlots()
      selectedSlotId.value = ''
    } else if (code === 'RATE_LIMITED') {
      submitError.value = '送出太多次了，請稍後再試一次。'
    } else if (code === 'BOOKING_UNAVAILABLE') {
      submitError.value = '這個校區目前不接受線上預約表單，請改用其他聯絡方式。'
      await refreshBookingConfig()
    } else if (err?.response?.status === 429) {
      submitError.value = '送出太多次了，請稍後再試一次。'
    } else if (err?.response?.status === 422) {
      submitError.value = '表單內容格式有誤，請檢查手機號碼與必填欄位。'
    } else {
      submitError.value = '送出失敗，請稍後再試一次；你填寫的內容還保留著。'
    }
    // 失敗時完全不清空 form 的任何欄位——使用者不用重打一次。
  } finally {
    submitting.value = false
  }
}

function reset() {
  submitted.value = false
  resultStatus.value = null
}
</script>

<template>
  <section class="visit-page" :data-campus-key="form.campus">
    <div class="container visit-content">
      <!-- booking.demoNote 是尚未接上真實 API 前的示範提示文字
           （「不會送出/不會建立預約」），現在表單已經打真的後端，
           不能再顯示這段話誤導家長——這段內容還沒搬進 typed content
           系統（booking 目前只有欄位定義被拿來重用），暫時直接在這裡
           蓋掉，见 docs/website-admin/acceptance.md Task 8 小結。 -->

      <template v-if="!submitted">
        <div class="visit-heading">
          <h1>預約校園參觀</h1>
          <p>選擇想參觀的校區，查看目前的預約與聯絡方式。</p>
        </div>
        <div class="visit-campus-picker field">
          <label for="visit-campus">想參觀的校區</label>
          <select id="visit-campus" v-model="form.campus" name="campus" :disabled="submitting" aria-describedby="visit-campus-hint">
            <option value="" disabled>請選擇校區</option>
            <option v-for="c in campuses" :key="c.key" :value="c.key">{{ c.name }} · {{ c.district }}</option>
          </select>
          <p id="visit-campus-hint" class="visit-campus-hint">{{ selectedCampus ? selectedCampus.address : '各校的參觀方式可能不同，選校後即可查看。' }}</p>
        </div>

        <p v-if="!selectedCampus" class="visit-status" role="status">請先選擇想參觀的校區。</p>
        <p v-else-if="bookingPending" class="visit-status" role="status">正在確認{{ selectedCampus.name }}的參觀方式…</p>
        <div v-else-if="action.kind !== 'form'" class="booking-alt-cta">
          <p class="visit-status" role="status">{{ action.message || (action.href ? `請使用以下方式聯絡${selectedCampus.name}，確認參觀安排。` : '目前無法使用線上預約，請直接聯絡園所。') }}</p>
          <div class="visit-contact-actions">
          <a v-if="action.href && action.kind !== 'phone'" class="button primary" :href="action.href" target="_blank" rel="noopener noreferrer">
            {{ action.label }}
          </a>
          <a v-else-if="action.href" class="button primary" :href="action.href">{{ action.label }}</a>
          <a v-if="selectedCampus.phone && (action.kind !== 'phone' || !action.href)" class="button outline" :href="`tel:${selectedCampus.phone}`">
            <svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}
          </a>
          <a v-if="selectedCampus.line && selectedCampus.line !== action.href" class="text-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a>
          </div>
          <NuxtLink class="text-link visit-campus-detail" :to="`/campuses/${selectedCampus.key}`">認識{{ selectedCampus.name }}</NuxtLink>
        </div>

        <form v-else class="booking-form" @submit.prevent="onSubmit">
          <p class="visit-form-note">留下聯絡方式，園所會再與你確認參觀時間。</p>

          <p v-if="bookingConfig?.mode === 'slots'" class="section-copy">
            此校區採時段預約，請選擇一個時段：
          </p>
          <fieldset v-if="bookingConfig?.mode === 'slots'" class="campus-options">
            <label v-for="slot in availableSlots" :key="slot.id" class="campus-option">
              <input type="radio" name="slot" :value="slot.id" v-model="selectedSlotId" required>
              <span>
                <strong>{{ slot.slot_date }} {{ slot.start_time }}–{{ slot.end_time }}</strong>
                <small>剩餘 {{ slot.remaining }} 位</small>
              </span>
            </label>
            <p v-if="availableSlots.length === 0" class="section-copy">目前沒有開放中的時段，請改用其他聯絡方式。</p>
          </fieldset>

          <div class="field-grid">
            <div class="field">
              <label for="parent-name">家長稱呼<span class="required">必填</span></label>
              <input id="parent-name" v-model="form.parentName" maxlength="40" required placeholder="例如：陳媽媽">
            </div>
            <div class="field">
              <label for="parent-phone">手機號碼<span class="required">必填</span></label>
              <input
                id="parent-phone"
                v-model="form.phone"
                type="tel"
                inputmode="tel"
                maxlength="16"
                required
                pattern="09[0-9]{8}"
                placeholder="09xxxxxxxx"
                aria-describedby="phone-hint"
              >
              <small id="phone-hint">請填寫 09 開頭的 10 碼手機號碼。</small>
            </div>
            <div class="field">
              <label for="child-age">孩子年齡</label>
              <select id="child-age" v-model="form.age">
                <option v-for="opt in booking.fields.find((f) => f.name === 'age')?.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </div>
            <div class="field">
              <label for="contact-time">方便聯絡的時段</label>
              <select id="contact-time" v-model="form.time">
                <option v-for="opt in booking.fields.find((f) => f.name === 'time')?.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </div>
            <div class="field full">
              <label for="questions">有沒有想先了解的事？<span class="required">選填</span></label>
              <textarea id="questions" v-model="form.questions" maxlength="500" placeholder="例如：課程安排、生活照顧、入學準備……" />
            </div>
          </div>

          <label class="consent">
            <input type="checkbox" v-model="form.consent" required>
            <span>{{ booking.consentText }}</span>
          </label>

          <p v-if="submitError" class="form-error" role="alert">{{ submitError }}</p>

          <div class="form-buttons">
            <button type="submit" class="button primary" :disabled="submitting">
              {{ submitting ? '送出中…' : '送出預約需求' }}
            </button>
          </div>
        </form>
      </template>

      <section v-else id="booking-result">
        <div class="result-mark" aria-hidden="true">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-check" /></svg>
        </div>
        <span class="eyebrow">{{ resultCopy.eyebrow }}</span>
        <h2>{{ resultCopy.title }}</h2>
        <p>{{ resultCopy.body }}</p>
        <dl class="result-list">
          <div><dt>想參觀的校區</dt><dd>{{ selectedCampus?.name }}</dd></div>
          <div><dt>家長稱呼</dt><dd>{{ form.parentName }}</dd></div>
          <div><dt>手機號碼</dt><dd>{{ form.phone }}</dd></div>
          <div><dt>孩子年齡</dt><dd>{{ form.age || '未填寫' }}</dd></div>
          <div><dt>方便聯絡時段</dt><dd>{{ form.time || '未填寫' }}</dd></div>
          <div><dt>想了解的事</dt><dd>{{ form.questions.trim() || '未填寫' }}</dd></div>
        </dl>
        <div class="form-buttons">
          <button class="button outline" type="button" @click="reset">修改內容</button>
          <a class="button primary" :href="`tel:${selectedCampus?.phone}`">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>致電園所
          </a>
        </div>
        <NuxtLink class="text-link" style="margin-top: 24px" to="/">回到首頁</NuxtLink>
      </section>
    </div>
  </section>
</template>

<style scoped>
.visit-content{max-width:760px}
.visit-heading{margin-bottom:28px}
.visit-heading h1{font-size:clamp(1.75rem,4vw,2.5rem);color:var(--green)}
.visit-heading p,.visit-campus-hint,.visit-form-note{color:var(--muted);font-size:.9375rem}
.visit-heading p{margin-top:12px}
.visit-campus-picker{margin-bottom:24px}
.visit-campus-picker select{width:100%;min-height:52px;font-size:1rem}
.visit-campus-hint{margin-top:8px}
.visit-status{line-height:1.85}
.visit-contact-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:20px}
.visit-campus-detail{margin-top:20px;font-size:.9375rem}
.visit-form-note{margin-bottom:24px}
@media(max-width:760px){
  .visit-page{padding-block:32px 56px;min-height:calc(100svh - 138px)}
  .visit-heading{margin-bottom:24px}
  .visit-contact-actions .button{width:100%;min-height:48px}
}
</style>
