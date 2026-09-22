<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'
import { resolveBookingAction } from '~/utils/booking-action'
import { responsiveImage } from '~/utils/responsive-image'
import { normalizeVisitPhone, validateVisitContact, type VisitErrors, type VisitField } from '~/utils/visit-form'

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

const step = ref<1 | 2>(props.initialCampus ? 2 : 1)
const stageRef = ref<HTMLElement | null>(null)
const pickerRef = ref<HTMLElement | null>(null)
const formRef = ref<HTMLFormElement | null>(null)
const errorRef = ref<HTMLElement | null>(null)
const resultRef = ref<HTMLElement | null>(null)
const campusError = ref('')
const fieldErrors = ref<VisitErrors>({})
const optionalOpen = ref(false)

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
    title: '參觀需求已送出',
    body: '園所會再以電話與你聯繫，確認合適的參觀時間。時間經園所確認後，預約才會成立。'
  }
})
const submitting = ref(false)
const submitError = ref<string | null>(null)
// 同一次填寫用同一個 idempotency key；重送（例如網路重試）會安全地
// 回到同一筆案件，不會建立第二筆。只有成功後才換新的 key。
const idempotencyKey = ref(crypto.randomUUID())

const selectedCampus = computed(() => props.campuses.find((c) => c.key === form.campus))
const storyCampus = computed(() => selectedCampus.value || props.campuses[0])
const ageOptions = computed(() => props.booking.fields.find((field) => field.name === 'age')?.options ?? [])
const timeOptions = computed(() => props.booking.fields.find((field) => field.name === 'time')?.options ?? [])
const nextLabel = computed(() => bookingPending.value ? '正在確認參觀方式…' : action.value.kind === 'form' || !selectedCampus.value ? '下一步：聯絡方式' : '下一步：查看參觀方式')

async function focusStage() {
  await nextTick()
  stageRef.value?.focus({ preventScroll: true })
  stageRef.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
}

async function goNext() {
  if (submitting.value || bookingPending.value) return
  if (!selectedCampus.value) {
    campusError.value = '請先選擇想參觀的校區。'
    await nextTick()
    pickerRef.value?.querySelector<HTMLInputElement>('input')?.focus()
    return
  }
  step.value = 2
  await focusStage()
}

async function changeCampus() {
  if (submitting.value) return
  step.value = 1
  await focusStage()
  pickerRef.value?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
}

function clearFieldError(field: VisitField) {
  delete fieldErrors.value[field]
}

function checkField(field: VisitField) {
  if (field === 'phone') form.phone = normalizeVisitPhone(form.phone)
  const message = validateVisitContact(form)[field]
  if (message) fieldErrors.value[field] = message
  else clearFieldError(field)
}

async function focusError() {
  await nextTick()
  errorRef.value?.focus()
}

watch(() => form.campus, () => {
  submitError.value = null
  selectedSlotId.value = ''
  campusError.value = ''
  fieldErrors.value = {}
})

async function onSubmit() {
  if (submitting.value || bookingPending.value || action.value.kind !== 'form' || !selectedCampus.value) return
  submitError.value = null
  form.parentName = form.parentName.trim()
  form.phone = normalizeVisitPhone(form.phone)
  fieldErrors.value = validateVisitContact(form)
  if (Object.keys(fieldErrors.value).length) {
    await nextTick()
    formRef.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
    return
  }

  if (bookingConfig.value?.mode === 'slots' && !selectedSlotId.value) {
    submitError.value = '請先選擇一個時段'
    await focusError()
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
    await nextTick()
    resultRef.value?.focus()
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
    await focusError()
  } finally {
    submitting.value = false
  }
}

</script>

<template>
  <section class="visit-page visit-a" :data-campus-key="form.campus" :data-step="submitted ? 'result' : step">
    <div class="container visit-content">
      <div class="visit-shell">
        <aside class="visit-story" aria-labelledby="visit-title">
          <div class="visit-story-copy">
            <span class="visit-kicker">預約校園參觀 <span lang="en">VISIT IVY</span></span>
            <h1 id="visit-title"><span class="visit-invitation">帶著好奇，<br>來校園<em>走走。</em></span><span class="visit-compact-title">預約校園參觀</span></h1>
            <p>看看孩子未來的日常，也和我們聊聊你的期待。<br>從一所離生活近一點的校園開始。</p>
            <ol class="visit-expectations" aria-label="參觀安排流程">
              <li><span aria-hidden="true">01</span> 選擇想認識的校園</li>
              <li><span aria-hidden="true">02</span> 由園所聯繫，一起確認時間</li>
            </ol>
          </div>
          <figure v-if="storyCampus" class="visit-story-photo">
            <img v-bind="responsiveImage(storyCampus.image, '(max-width: 760px) 1px, (max-width: 1100px) 40vw, 500px')" :alt="`${storyCampus.name}校園圖像`" :style="{ objectPosition: storyCampus.panoramaPos || 'center 55%' }" decoding="async">
            <figcaption><span>在常春藤，遇見成長的下一站。</span><span>{{ storyCampus.name }}</span></figcaption>
          </figure>
        </aside>

        <div ref="stageRef" class="visit-stage" tabindex="-1">
          <template v-if="!submitted">
            <ol class="visit-steps" aria-label="預約步驟">
              <li :aria-current="step === 1 ? 'step' : undefined" :class="{ 'is-complete': step === 2 }">
                <button type="button" :disabled="step === 1 || submitting" @click="changeCampus"><span class="visit-step-number">{{ step === 2 ? '✓' : '1' }}</span>選擇校園</button>
              </li>
              <li :aria-current="step === 2 ? 'step' : undefined"><span class="visit-step-number">2</span>聯絡與安排</li>
            </ol>

            <section v-if="step === 1" class="visit-pick-step" aria-labelledby="visit-choose-title">
              <h2 id="visit-choose-title">想先認識哪所校園？</h2>
              <p class="visit-step-copy">依照你的生活圈與接送路線選擇。</p>
              <fieldset ref="pickerRef" class="visit-campus-list" :disabled="submitting" aria-describedby="visit-campus-error">
                <legend class="sr-only">想參觀的校區</legend>
                <label v-for="campus in campuses" :key="campus.key" class="visit-campus-choice">
                  <input v-model="form.campus" type="radio" name="campus" :value="campus.key" :aria-label="`${campus.name} · ${campus.district}`">
                  <span class="visit-campus-card">
                    <img v-bind="responsiveImage(campus.image, '(max-width: 760px) 72px, 88px')" alt="" decoding="async">
                    <span class="visit-campus-copy"><span class="visit-campus-heading"><strong>{{ campus.name }}</strong><small>{{ campus.district }}</small></span><span class="visit-campus-address">{{ campus.address.replace(/^高雄市/, '') }}</span></span>
                    <span class="visit-choice-mark" aria-hidden="true"><svg class="icon"><use href="#i-check" /></svg></span>
                  </span>
                </label>
              </fieldset>
              <p v-if="!campuses.length" class="visit-status" role="status">目前沒有可供選擇的校區，請稍後再來查看。</p>
              <p id="visit-campus-error" class="visit-field-error" role="alert">{{ campusError }}</p>
              <div class="visit-next-row">
                <p role="status">{{ selectedCampus ? `已選擇${selectedCampus.name}` : '選好校園後，查看參觀方式。' }}</p>
                <button class="button primary visit-next" type="button" :disabled="bookingPending || !campuses.length" :aria-busy="bookingPending" @click="goNext">{{ nextLabel }}<span v-if="!bookingPending" aria-hidden="true">→</span></button>
              </div>
            </section>

            <template v-else>
              <div v-if="selectedCampus" class="visit-selected-campus">
                <img v-bind="responsiveImage(selectedCampus.image, '80px')" alt="" decoding="async">
                <div><strong>{{ selectedCampus.name }}</strong><p>{{ selectedCampus.address }}</p></div>
                <button class="visit-change" type="button" :disabled="submitting" @click="changeCampus">更換校區</button>
              </div>

              <p v-if="submitError" ref="errorRef" class="visit-submit-error" role="alert" tabindex="-1">{{ submitError }}</p>
              <p v-if="bookingPending" class="visit-status visit-loading" role="status">正在確認{{ selectedCampus?.name }}的參觀方式…</p>
              <div v-else-if="!selectedCampus" class="visit-status"><p>請先選擇想參觀的校區。</p><button class="button outline" type="button" @click="changeCampus">選擇校區</button></div>
              <section v-else-if="action.kind !== 'form'" class="booking-alt-cta visit-contact-step" aria-labelledby="visit-contact-title">
                <span class="visit-contact-kicker">參觀方式</span>
                <h2 id="visit-contact-title">歡迎與{{ selectedCampus.name }}聯絡</h2>
                <p class="visit-status" role="status">{{ action.message || (action.href ? `透過以下方式聯絡園所，一起安排合適的參觀時間。` : '目前無法使用線上表單，請直接聯絡園所確認參觀安排。') }}</p>
                <div class="visit-contact-actions">
                  <a v-if="action.href && action.kind !== 'phone'" class="button primary" :href="action.href" target="_blank" rel="noopener noreferrer">{{ action.label }} <span aria-hidden="true">↗</span></a>
                  <a v-else-if="action.href" class="button primary" :href="action.href"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ action.label }}</a>
                  <a v-if="selectedCampus.phone && (action.kind !== 'phone' || !action.href)" class="button" :class="action.href ? 'outline' : 'primary'" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}<span>{{ selectedCampus.phone }}</span></a>
                  <a v-if="selectedCampus.line && selectedCampus.line !== action.href" class="visit-inline-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a>
                </div>
                <div class="visit-contact-foot"><p>想先看看校園環境？</p><NuxtLink class="visit-inline-link" :to="`/campuses/${selectedCampus.key}`">認識{{ selectedCampus.name }}</NuxtLink></div>
              </section>

              <form v-else ref="formRef" class="booking-form visit-contact-form" novalidate :aria-busy="submitting" @submit.prevent="onSubmit">
                <h2>留下聯絡方式</h2>
                <p class="visit-step-copy">{{ selectedCampus.name }}將與你聯繫，一起確認參觀時間。</p>
                <p v-if="action.message" class="visit-config-note">{{ action.message }}</p>
                <fieldset class="visit-form-fields" :disabled="submitting">
                  <legend class="sr-only">家長聯絡資料</legend>
                  <fieldset v-if="bookingConfig?.mode === 'slots'" class="visit-slot-list">
                    <legend>選擇參觀時段</legend>
                    <label v-for="slot in availableSlots" :key="slot.id"><input v-model="selectedSlotId" type="radio" name="slot" :value="slot.id" required><span>{{ slot.slot_date }} {{ slot.start_time }}–{{ slot.end_time }}<small>剩餘 {{ slot.remaining }} 位</small></span></label>
                    <p v-if="!availableSlots.length">目前沒有開放中的時段，請改用其他聯絡方式。</p>
                  </fieldset>
                  <div class="visit-field-grid">
                    <div class="visit-field"><label for="parent-name">家長稱呼<small>必填</small></label><input id="parent-name" v-model="form.parentName" name="parentName" autocomplete="name" maxlength="40" required placeholder="例如：陳媽媽" :aria-invalid="Boolean(fieldErrors.parentName)" aria-describedby="visit-name-error" @blur="checkField('parentName')" @input="clearFieldError('parentName')"><p id="visit-name-error" class="visit-field-error">{{ fieldErrors.parentName }}</p></div>
                    <div class="visit-field"><label for="parent-phone">手機號碼<small>必填</small></label><input id="parent-phone" v-model="form.phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="16" required pattern="09[0-9]{8}" placeholder="09xxxxxxxx" :aria-invalid="Boolean(fieldErrors.phone)" aria-describedby="phone-hint visit-phone-error" @blur="checkField('phone')" @input="clearFieldError('phone')"><small id="phone-hint" class="visit-field-hint">09 開頭的 10 碼手機號碼</small><p id="visit-phone-error" class="visit-field-error">{{ fieldErrors.phone }}</p></div>
                  </div>
                  <details class="visit-optional" :open="optionalOpen" @toggle="optionalOpen = ($event.target as HTMLDetailsElement).open">
                    <summary>多告訴我們一點<span>選填 <span class="visit-expand-mark" aria-hidden="true">＋</span></span></summary>
                    <div class="visit-field-grid">
                      <div class="visit-field"><label for="child-age">孩子年齡</label><select id="child-age" v-model="form.age" name="age"><option value="">請選擇（選填）</option><option v-for="option in ageOptions" :key="option" :value="option">{{ option }}</option></select></div>
                      <div class="visit-field"><label for="contact-time">方便接電話的時段</label><select id="contact-time" v-model="form.time" name="time" aria-describedby="visit-time-hint"><option value="">請選擇（選填）</option><option v-for="option in timeOptions" :key="option" :value="option">{{ option }}</option></select><p id="visit-time-hint" class="visit-field-hint">這是聯絡時段，參觀時間將另行確認。</p></div>
                      <div class="visit-field visit-full"><label for="questions">有沒有想先了解的事？</label><textarea id="questions" v-model="form.questions" name="questions" maxlength="500" rows="3" placeholder="例如：課程安排、生活照顧、入學準備……" /></div>
                    </div>
                  </details>
                  <label class="visit-consent"><input v-model="form.consent" name="consent" type="checkbox" required :aria-invalid="Boolean(fieldErrors.consent)" aria-describedby="visit-consent-error" @change="checkField('consent')"><span>{{ booking.consentText }}</span></label>
                  <p id="visit-consent-error" class="visit-field-error">{{ fieldErrors.consent }}</p>
                </fieldset>
                <p v-if="Object.keys(fieldErrors).length" class="sr-only" role="alert">請確認標示的欄位：{{ Object.values(fieldErrors).join(' ') }}</p>
                <div class="visit-submit-row"><p>送出後，由園所聯繫確認。<br>尚不代表預約成立。</p><button type="submit" class="button primary" :disabled="submitting">{{ submitting ? '正在送出…' : '送出參觀需求' }}<span v-if="!submitting" aria-hidden="true">→</span></button></div>
              </form>
            </template>
          </template>

          <section v-else id="booking-result" ref="resultRef" class="visit-result" tabindex="-1" aria-labelledby="visit-result-title">
            <span class="visit-result-status"><svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>{{ resultCopy.eyebrow }}</span>
            <h2 id="visit-result-title">{{ resultCopy.title }}</h2>
            <p class="visit-step-copy">{{ resultCopy.body }}</p>
            <dl class="visit-result-list"><div><dt>意向校區</dt><dd>{{ selectedCampus?.name }}</dd></div><div><dt>家長稱呼</dt><dd>{{ form.parentName }}</dd></div><div><dt>手機號碼</dt><dd>{{ form.phone }}</dd></div><div><dt>接電話時段</dt><dd>{{ form.time || '未指定' }}</dd></div><div v-if="form.age"><dt>孩子年齡</dt><dd>{{ form.age }}</dd></div><div v-if="form.questions.trim()"><dt>想了解的事</dt><dd>{{ form.questions }}</dd></div></dl>
            <div class="visit-result-next"><h3>接下來，等園所與你聯繫。</h3><p>需要補充、更正資料或調整安排，請直接聯絡{{ selectedCampus?.name }}。</p><div class="visit-contact-actions"><a v-if="selectedCampus?.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}</a><a v-if="selectedCampus?.line" class="visit-inline-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a></div></div>
            <NuxtLink class="visit-inline-link visit-home" to="/">回到首頁</NuxtLink>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="../assets/css/visit-booking.css"></style>
