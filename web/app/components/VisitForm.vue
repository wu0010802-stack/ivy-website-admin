<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'
import { resolveBookingAction } from '~/utils/booking-action'
import { responsiveImage } from '~/utils/responsive-image'
import { CONTACT_TIME_OPTIONS, contactTimeLabel, normalizeVisitPhone, PARTY_SIZE_OPTIONS, validateVisitContact, REFERRAL_OPTIONS, taipeiDate, visitDateLabel, type VisitErrors, type VisitField } from '~/utils/visit-form'

const props = defineProps<{
  booking: BookingContent
  campuses: Campus[]
  initialCampus?: string
}>()

const form = reactive({
  campus: props.initialCampus || '',
  parentName: '',
  phone: '',
  childName: '',
  childBirthdate: '',
  email: '',
  // 參觀人數：下拉選單預設不選（空字串），送出前必填 1–10。
  partySize: '',
  referralSources: [] as string[],
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
const { data: bookingConfig, pending: bookingPending, error: bookingError, refresh: refreshBookingConfig } = useCampusBooking(selectedCampusKey)
const action = computed(() => resolveBookingAction(form.campus || null, bookingConfig.value ?? null, Boolean(bookingError.value)))
// 規格 L196：勾選框顯示的是公開預約設定回傳的那一版同意文字，送單帶同一個
// 版本 id；讀不到（舊版 API）才退回站台內容的文字。
const consentText = computed(() => bookingConfig.value?.consent_text || props.booking.consentText)
const privacyNotice = computed(() => bookingConfig.value?.privacy_notice ?? null)

interface PublicVisitSlot { id: string; slot_date: string; start_time: string; end_time: string; remaining: number }
const availableSlots = ref<PublicVisitSlot[]>([])
// SSR 與 hydration 首幀共用載入狀態；掛載後才查場次，避免伺服器先
// 顯示「沒有場次」、瀏覽器卻先顯示載入中而造成節點不一致。
const slotsPending = ref(true)
const slotsError = ref('')
const selectedVisitDate = ref('')
const selectedSlotId = ref('')
const submittedSlot = ref<PublicVisitSlot | null>(null)
const today = ref(taipeiDate())
const slotDates = computed(() => [...new Set(availableSlots.value.map(slot => slot.slot_date))].sort())
const daySlots = computed(() => availableSlots.value.filter(slot => slot.slot_date === selectedVisitDate.value))
const selectedSlot = computed(() => availableSlots.value.find(slot => slot.id === selectedSlotId.value))
const slotTime = (slot: PublicVisitSlot) => `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
let slotRequest = 0

async function loadSlots() {
  const request = ++slotRequest
  const campusKey = form.campus
  slotsError.value = ''
  if (action.value.kind !== 'form' || bookingConfig.value?.mode !== 'slots') {
    availableSlots.value = []
    slotsPending.value = false
    return
  }
  slotsPending.value = true
  today.value = taipeiDate()
  try {
    const slots = await $fetch<PublicVisitSlot[]>('/api/website/v1/public/slots', {
      query: { campus_key: campusKey, date_from: today.value, date_to: taipeiDate(new Date(Date.now() + 60 * 86400000)) }
    })
    if (request !== slotRequest) return
    availableSlots.value = slots.filter(slot => slot.remaining > 0).sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`))
    if (!slotDates.value.includes(selectedVisitDate.value)) selectedVisitDate.value = ''
    if (!availableSlots.value.some(slot => slot.id === selectedSlotId.value)) selectedSlotId.value = ''
  } catch {
    if (request !== slotRequest) return
    availableSlots.value = []
    selectedSlotId.value = ''
    slotsError.value = '場次暫時無法讀取，請重新載入，或直接聯絡園所。'
  } finally {
    if (request === slotRequest) slotsPending.value = false
  }
}

let slotsMounted = false
onMounted(() => { slotsMounted = true; void loadSlots() })
watch([() => form.campus, () => bookingConfig.value?.mode], () => {
  if (slotsMounted) void loadSlots()
})
watch(selectedVisitDate, () => { selectedSlotId.value = ''; clearFieldError('visitDate'); clearFieldError('slotId') })
onBeforeUnmount(() => { slotsMounted = false; slotRequest++ })

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
// 第一步是薄荷色帶的迎賓區＋照片卡選校；第二步與送出後收成一行頁名，左側改放所選校園。
const isPicking = computed(() => step.value === 1 && !submitted.value)
// 選項固定（規格 190），不讀 fixture 的中文清單：送出的是代碼。
const timeOptions = CONTACT_TIME_OPTIONS
const nextLabel = computed(() => bookingPending.value ? '正在確認參觀方式…' : action.value.kind === 'form' || !selectedCampus.value ? '下一步：填寫資料' : '下一步：查看參觀方式')

async function focusStage() {
  await nextTick()
  stageRef.value?.focus({ preventScroll: true })
  stageRef.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
}

async function retryBookingConfig() {
  await refreshBookingConfig()
  await loadSlots()
  await focusStage()
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
  selectedVisitDate.value = ''
  campusError.value = ''
  fieldErrors.value = {}
})

async function onSubmit() {
  if (submitting.value || bookingPending.value || slotsPending.value || action.value.kind !== 'form' || !selectedCampus.value) return
  submitError.value = null
  form.parentName = form.parentName.trim()
  form.childName = form.childName.trim()
  form.email = form.email.trim()
  form.phone = normalizeVisitPhone(form.phone)
  fieldErrors.value = validateVisitContact(form, taipeiDate())
  if (bookingConfig.value?.mode === 'slots') {
    if (!selectedVisitDate.value) fieldErrors.value.visitDate = '請選擇參觀日期。'
    else if (!selectedSlot.value || selectedSlot.value.slot_date !== selectedVisitDate.value) fieldErrors.value.slotId = '請選擇這一天的參觀場次。'
  }
  if (Object.keys(fieldErrors.value).length) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
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
        child_name: form.childName,
        child_birthdate: form.childBirthdate,
        email: form.email || null,
        party_size: Number(form.partySize),
        referral_sources: form.referralSources,
        preferred_time: form.time || null,
        questions: form.questions || null,
        consent_given: form.consent,
        consent_revision_id: bookingConfig.value?.consent_revision_id ?? null,
        slot_id: bookingConfig.value?.mode === 'slots' ? selectedSlotId.value : undefined
      }
    })
    // 用 server 回的實際狀態決定文案，不要從 mode 推斷。slots 可以是
    // 「待園方確認」（規格預設）也可以是自動確認，只有 confirmed 才能
    // 說「預約成立」——規格 197。
    submittedSlot.value = selectedSlot.value ? { ...selectedSlot.value } : null
    resultStatus.value = created?.status ?? null
    submitted.value = true
    idempotencyKey.value = crypto.randomUUID()
    await nextTick()
    resultRef.value?.focus()
  } catch (err: any) {
    const detail = err?.data?.detail
    const code = typeof detail === 'object' ? detail.code : null
    if (code === 'CONSENT_VERSION_CHANGED') {
      // 園方剛改了同意說明：換上新的文字，請家長重新閱讀、勾選，其他欄位都保留。
      form.consent = false
      await refreshBookingConfig()
      submitError.value = '同意說明剛剛更新了，請閱讀下方新的說明並重新勾選同意後再送出。'
    } else if (code === 'BOOKING_CONFIG_CHANGED') {
      submitError.value = '這個校區的預約設定剛剛更新了，請確認以下資訊後再送出一次。'
      await refreshBookingConfig()
      await loadSlots()
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
      await loadSlots()
    } else if (err?.response?.status === 429) {
      submitError.value = '送出太多次了，請稍後再試一次。'
    } else if (err?.response?.status === 422) {
      submitError.value = '部分資料格式有誤，請檢查孩子生日、Email、聯絡電話與必填欄位。'
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
  <section class="visit-page" :data-campus-key="form.campus" :data-step="submitted ? 'result' : step">
    <div v-if="isPicking" class="visit-ghost" aria-hidden="true"><span>預約</span><span>參觀</span></div>
    <header class="visit-welcome">
      <div class="container visit-welcome-inner">
        <div class="visit-welcome-copy">
          <p v-if="isPicking" class="visit-eyebrow" lang="en">VISIT IVY</p>
          <h1 id="visit-title"><template v-if="isPicking">帶著好奇，<br>來校園走走。</template><template v-else>預約校園參觀</template></h1>
          <p v-if="isPicking" class="visit-lead">看看孩子未來的日常，也和我們聊聊你的期待。<br>從一所離生活近一點的校園開始。</p>
        </div>
        <figure v-if="isPicking" class="visit-welcome-photo">
          <img v-bind="responsiveImage('about-curious', '(max-width: 760px) calc(100vw - 40px), 40vw')" alt="孩子們笑著指向前方" decoding="async">
          <figcaption>在常春藤，遇見成長的下一站。</figcaption>
        </figure>
      </div>
    </header>
    <div class="container visit-content">
      <div class="visit-shell">
        <aside v-if="!isPicking && selectedCampus" class="visit-campus-aside" aria-label="所選校園">
          <div class="visit-aside-card">
            <span class="visit-aside-photo"><img :key="selectedCampus.key" v-bind="responsiveImage(selectedCampus.image, '(max-width: 960px) 96px, 420px')" alt="" decoding="async" :style="{ objectPosition: selectedCampus.panoramaPos || 'center 55%' }"></span>
            <span class="visit-aside-caption">
              <span class="visit-aside-district">高雄 · {{ selectedCampus.district }}</span>
              <strong class="visit-aside-name">{{ selectedCampus.name }}</strong>
              <span class="visit-aside-en" lang="en">{{ selectedCampus.key.toUpperCase() }} CAMPUS</span>
            </span>
          </div>
          <div class="visit-aside-info">
            <p><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>{{ selectedCampus.address }}</p>
            <a v-if="selectedCampus.phone" class="visit-aside-phone" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ selectedCampus.phone }}</a>
            <button v-if="!submitted" class="visit-change" type="button" :disabled="submitting" @click="changeCampus">更換校區</button>
          </div>
        </aside>

        <div ref="stageRef" class="visit-stage" tabindex="-1">
          <template v-if="!submitted">
            <ol class="visit-steps" aria-label="預約步驟">
              <li :aria-current="step === 1 ? 'step' : undefined" :class="{ 'is-complete': step === 2 }">
                <button type="button" :disabled="step === 1 || submitting" @click="changeCampus"><span class="visit-step-number">{{ step === 2 ? '✓' : '1' }}</span>選擇校園</button>
              </li>
              <li :aria-current="step === 2 ? 'step' : undefined"><span class="visit-step-number">2</span>參觀資料</li>
            </ol>

            <section v-if="step === 1" class="visit-pick-step" aria-labelledby="visit-choose-title">
              <h2 id="visit-choose-title">想先認識哪所校園？</h2>
              <p class="visit-step-copy">依照你的生活圈與接送路線選擇。</p>
              <fieldset ref="pickerRef" class="visit-campus-list" :disabled="submitting" aria-describedby="visit-campus-error">
                <legend class="sr-only">想參觀的校區</legend>
                <label v-for="campus in campuses" :key="campus.key" class="visit-campus-choice">
                  <input v-model="form.campus" type="radio" name="campus" :value="campus.key" :aria-label="`${campus.name} · ${campus.district}`">
                  <span class="visit-campus-card">
                    <span class="visit-campus-photo"><img v-bind="responsiveImage(campus.image, '(max-width: 760px) calc(100vw - 40px), (max-width: 960px) 30vw, 260px')" alt="" decoding="async" :style="{ objectPosition: campus.panoramaPos || 'center 55%' }"></span>
                    <span class="visit-campus-copy"><strong>{{ campus.name }}</strong><small>{{ campus.district }}</small></span>
                    <span class="visit-campus-check" aria-hidden="true"><svg class="icon"><use href="#i-check" /></svg></span>
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
              <p v-if="submitError" ref="errorRef" class="visit-submit-error" role="alert" tabindex="-1">{{ submitError }}</p>
              <p v-if="bookingPending" class="visit-status visit-loading" role="status">正在確認{{ selectedCampus?.name }}的參觀方式…</p>
              <div v-else-if="!selectedCampus" class="visit-status"><p>請先選擇想參觀的校區。</p><button class="button outline" type="button" @click="changeCampus">選擇校區</button></div>
              <section v-else-if="action.kind !== 'form'" class="booking-alt-cta visit-contact-step" aria-labelledby="visit-contact-title">
                <span class="visit-contact-kicker">參觀方式</span>
                <h2 id="visit-contact-title">{{ action.kind === 'unavailable' ? '參觀方式暫時無法載入' : `歡迎與${selectedCampus.name}聯絡` }}</h2>
                <p class="visit-status" role="status">{{ action.message || (action.href ? `透過以下方式聯絡園所，一起安排合適的參觀時間。` : '目前無法使用線上表單，請直接聯絡園所確認參觀安排。') }}</p>
                <div class="visit-contact-actions">
                  <button v-if="action.kind === 'unavailable'" type="button" class="button primary" @click="retryBookingConfig">重新載入參觀方式</button>
                  <a v-if="action.href && action.kind !== 'phone'" class="button primary" :href="action.href" target="_blank" rel="noopener noreferrer">{{ action.label }} <span aria-hidden="true">↗</span></a>
                  <a v-else-if="action.href" class="button primary" :href="action.href"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ action.label }}</a>
                  <a v-if="selectedCampus.phone && (action.kind !== 'phone' || !action.href)" class="button" :class="action.href ? 'outline' : 'primary'" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}<span>{{ selectedCampus.phone }}</span></a>
                  <a v-if="selectedCampus.line && selectedCampus.line !== action.href" class="visit-inline-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a>
                </div>
                <div class="visit-contact-foot"><p>想先看看校園環境？</p><NuxtLink class="visit-inline-link" :to="`/campuses/${selectedCampus.key}`">認識{{ selectedCampus.name }}</NuxtLink></div>
              </section>

              <form v-else ref="formRef" class="booking-form visit-contact-form" novalidate :aria-busy="submitting" @submit.prevent="onSubmit">
                <h2>填寫參觀資料</h2>
                <p class="visit-step-copy">讓{{ selectedCampus.name }}先認識孩子，也為這次見面做好準備。</p>
                <p v-if="action.message" class="visit-config-note">{{ action.message }}</p>
                <fieldset class="visit-form-fields" :disabled="submitting">
                  <legend class="sr-only">孩子與家長資料</legend>
                  <section v-if="bookingConfig?.mode === 'slots'" class="visit-form-section" aria-labelledby="visit-schedule-title">
                    <h3 id="visit-schedule-title">參觀安排</h3>
                    <p class="visit-field-hint">僅列出{{ selectedCampus.name }}目前開放的日期與場次。</p>
                    <p v-if="slotsPending" class="visit-status" role="status">正在讀取可預約場次…</p>
                    <div v-else-if="slotsError || !availableSlots.length" class="visit-slots-empty" role="status">
                      <p>{{ slotsError || '目前沒有開放的參觀場次，歡迎直接聯絡園所安排。' }}</p>
                      <div class="visit-contact-actions"><button type="button" class="button outline" @click="loadSlots">重新載入場次</button><a v-if="selectedCampus.phone" class="visit-inline-link" :href="`tel:${selectedCampus.phone}`">致電{{ selectedCampus.name }}</a></div>
                    </div>
                    <div v-else class="visit-schedule-fields">
                      <div class="visit-field"><label for="visit-date">預約日期<small>必填</small></label><select id="visit-date" v-model="selectedVisitDate" name="visitDate" required :aria-invalid="Boolean(fieldErrors.visitDate)" aria-describedby="visit-date-error"><option value="">請選擇參觀日期</option><option v-for="date in slotDates" :key="date" :value="date">{{ visitDateLabel(date) }}</option></select><p id="visit-date-error" class="visit-field-error">{{ fieldErrors.visitDate }}</p></div>
                      <fieldset class="visit-slot-list" aria-describedby="visit-slot-error"><legend>預約場次<small>必填</small></legend><p v-if="!selectedVisitDate" class="visit-field-hint">先選擇日期，再查看當天可預約的場次。</p><div v-else class="visit-slot-options"><label v-for="slot in daySlots" :key="slot.id"><input v-model="selectedSlotId" type="radio" name="slotId" :value="slot.id" required :aria-invalid="Boolean(fieldErrors.slotId)" @change="clearFieldError('slotId')"><span>{{ slotTime(slot) }}<small>尚可預約 {{ slot.remaining }} 組</small></span></label></div><p id="visit-slot-error" class="visit-field-error">{{ fieldErrors.slotId }}</p></fieldset>
                    </div>
                  </section>
                  <p v-else class="visit-config-note">{{ selectedCampus.name }}將與你聯繫，另行確認參觀日期與場次。</p>

                  <section class="visit-form-section" aria-labelledby="visit-child-title">
                    <h3 id="visit-child-title">孩子資料</h3>
                    <div class="visit-field-grid">
                      <div class="visit-field"><label for="child-name">孩子姓名<small>必填</small></label><input id="child-name" v-model="form.childName" name="childName" autocomplete="off" maxlength="64" required placeholder="請填寫孩子姓名" :aria-invalid="Boolean(fieldErrors.childName)" aria-describedby="visit-child-name-error" @blur="checkField('childName')" @input="clearFieldError('childName')"><p id="visit-child-name-error" class="visit-field-error">{{ fieldErrors.childName }}</p></div>
                      <div class="visit-field"><label for="child-birthdate">孩子出生年月日<small>必填</small></label><input id="child-birthdate" v-model="form.childBirthdate" name="childBirthdate" type="date" autocomplete="off" :max="today" required :aria-invalid="Boolean(fieldErrors.childBirthdate)" aria-describedby="visit-birthdate-hint visit-birthdate-error" @blur="checkField('childBirthdate')" @input="clearFieldError('childBirthdate')"><small id="visit-birthdate-hint" class="visit-field-hint">依孩子生日，協助了解適齡班別。</small><p id="visit-birthdate-error" class="visit-field-error">{{ fieldErrors.childBirthdate }}</p></div>
                    </div>
                  </section>

                  <section class="visit-form-section" aria-labelledby="visit-parent-title">
                    <h3 id="visit-parent-title">家長聯絡方式</h3>
                    <div class="visit-field-grid">
                      <div class="visit-field"><label for="parent-name">家長稱呼<small>必填</small></label><input id="parent-name" v-model="form.parentName" name="parentName" autocomplete="section-parent name" maxlength="40" required placeholder="例如：陳媽媽" :aria-invalid="Boolean(fieldErrors.parentName)" aria-describedby="visit-name-error" @blur="checkField('parentName')" @input="clearFieldError('parentName')"><p id="visit-name-error" class="visit-field-error">{{ fieldErrors.parentName }}</p></div>
                      <div class="visit-field"><label for="parent-phone">聯絡電話<small>必填</small></label><input id="parent-phone" v-model="form.phone" name="phone" type="tel" inputmode="tel" autocomplete="section-parent tel-national" maxlength="16" required pattern="09[0-9]{8}" placeholder="09xxxxxxxx" :aria-invalid="Boolean(fieldErrors.phone)" aria-describedby="phone-hint visit-phone-error" @blur="checkField('phone')" @input="clearFieldError('phone')"><small id="phone-hint" class="visit-field-hint">09 開頭的 10 碼手機號碼</small><p id="visit-phone-error" class="visit-field-error">{{ fieldErrors.phone }}</p></div>
                      <div class="visit-field"><label for="party-size">參觀人數<small>必填</small></label><select id="party-size" v-model="form.partySize" name="partySize" required :aria-invalid="Boolean(fieldErrors.partySize)" aria-describedby="visit-party-hint visit-party-error" @change="checkField('partySize')"><option value="">請選擇</option><option v-for="size in PARTY_SIZE_OPTIONS" :key="size" :value="String(size)">{{ size }} 位</option></select><small id="visit-party-hint" class="visit-field-hint">含大人與孩子，方便園所準備接待。</small><p id="visit-party-error" class="visit-field-error">{{ fieldErrors.partySize }}</p></div>
                      <div class="visit-field visit-full"><label for="parent-email">聯絡 Email<small>選填</small></label><input id="parent-email" v-model="form.email" name="email" type="email" inputmode="email" autocomplete="section-parent email" maxlength="254" placeholder="name@example.com" :aria-invalid="Boolean(fieldErrors.email)" aria-describedby="visit-email-error" @blur="checkField('email')" @input="clearFieldError('email')"><p id="visit-email-error" class="visit-field-error">{{ fieldErrors.email }}</p></div>
                    </div>
                  </section>

                  <fieldset class="visit-referrals"><legend>如何知道常春藤幼兒園？<small>可複選・選填</small></legend><div><label v-for="source in REFERRAL_OPTIONS" :key="source.value"><input v-model="form.referralSources" type="checkbox" name="referralSources" :value="source.value"><span>{{ source.label }}</span></label></div></fieldset>
                  <details class="visit-optional" :open="optionalOpen" @toggle="optionalOpen = ($event.target as HTMLDetailsElement).open">
                    <summary>其他想告訴我們的事<span>選填 <span class="visit-expand-mark" aria-hidden="true">＋</span></span></summary>
                    <div class="visit-field-grid">
                      <div class="visit-field visit-full"><label for="contact-time">方便接電話的時段</label><select id="contact-time" v-model="form.time" name="time" aria-describedby="visit-time-hint"><option value="">請選擇（選填）</option><option v-for="option in timeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select><p id="visit-time-hint" class="visit-field-hint">這是聯絡時段，與參觀場次分開。</p></div>
                      <div class="visit-field visit-full"><label for="questions">有沒有想先了解的事？</label><textarea id="questions" v-model="form.questions" name="questions" maxlength="500" rows="3" placeholder="例如：課程安排、生活照顧、入學準備……" /></div>
                    </div>
                  </details>
                  <label class="visit-consent"><input v-model="form.consent" name="consent" type="checkbox" required :aria-invalid="Boolean(fieldErrors.consent)" aria-describedby="visit-consent-error" @change="checkField('consent')"><span>{{ consentText }}</span></label>
                  <PrivacyNoticeDialog v-if="privacyNotice" :notice="privacyNotice" label="閱讀個資使用說明" trigger-class="visit-privacy-link" />
                  <p id="visit-consent-error" class="visit-field-error">{{ fieldErrors.consent }}</p>
                </fieldset>
                <p v-if="Object.keys(fieldErrors).length" class="sr-only" role="alert">請確認標示的欄位：{{ Object.values(fieldErrors).join(' ') }}</p>
                <div class="visit-submit-row"><p>送出後，請查看確認結果。<br>參觀時間以園所確認為準。</p><button type="submit" class="button primary" :disabled="submitting || slotsPending || (bookingConfig?.mode === 'slots' && (!availableSlots.length || Boolean(slotsError)))">{{ submitting ? '正在送出…' : '送出參觀需求' }}<span v-if="!submitting" aria-hidden="true">→</span></button></div>
              </form>
            </template>
          </template>

          <section v-else id="booking-result" ref="resultRef" class="visit-result" tabindex="-1" aria-labelledby="visit-result-title">
            <img v-if="selectedCampus" class="visit-result-art" v-bind="responsiveImage(`campus-line-art-${selectedCampus.key}`, '240px')" alt="" decoding="async">
            <span class="visit-result-status"><svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>{{ resultCopy.eyebrow }}</span>
            <h2 id="visit-result-title">{{ resultCopy.title }}</h2>
            <p class="visit-step-copy">{{ resultCopy.body }}</p>
            <dl class="visit-result-list"><div><dt>意向校區</dt><dd>{{ selectedCampus?.name }}</dd></div><div v-if="submittedSlot"><dt>預約日期</dt><dd>{{ visitDateLabel(submittedSlot.slot_date) }}</dd></div><div v-if="submittedSlot"><dt>預約場次</dt><dd>{{ slotTime(submittedSlot) }}</dd></div><div><dt>孩子姓名</dt><dd>{{ form.childName }}</dd></div><div><dt>出生年月日</dt><dd>{{ form.childBirthdate }}</dd></div><div><dt>家長稱呼</dt><dd>{{ form.parentName }}</dd></div><div><dt>聯絡電話</dt><dd>{{ form.phone }}</dd></div><div v-if="form.partySize"><dt>參觀人數</dt><dd>{{ form.partySize }} 位</dd></div><div v-if="form.email"><dt>聯絡 Email</dt><dd>{{ form.email }}</dd></div><div v-if="form.referralSources.length"><dt>得知管道</dt><dd>{{ REFERRAL_OPTIONS.filter(source => form.referralSources.includes(source.value)).map(source => source.label).join('、') }}</dd></div><div v-if="form.time"><dt>接電話時段</dt><dd>{{ contactTimeLabel(form.time) }}</dd></div><div v-if="form.questions.trim()"><dt>想了解的事</dt><dd>{{ form.questions }}</dd></div></dl>
            <div class="visit-result-next"><h3>接下來，等園所與你聯繫。</h3><p>需要補充、更正資料或調整安排，請直接聯絡{{ selectedCampus?.name }}。</p><div class="visit-contact-actions"><a v-if="selectedCampus?.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}</a><a v-if="selectedCampus?.line" class="visit-inline-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a></div></div>
            <NuxtLink class="visit-inline-link visit-home" to="/">回到首頁</NuxtLink>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="../assets/css/visit-booking.css"></style>
