<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'
import { campusVisitCta, resolveBookingAction, type BookingAction } from '~/utils/booking-action'
import { loadCampusBooking } from '~/composables/useCampusBooking'
import { responsiveImage } from '~/utils/responsive-image'
import { lineArtBlends, lineArtInkImage, pickImage } from '~/utils/media-image'
import { apiFieldErrors, focusFirstInvalidField, focusNextFieldOnEnter, normalizeVisitPhone, validateVisitContact, REFERRAL_OPTIONS, expectedStartOptions, taipeiDate, newBookingSlotsQuery, visitDateLabel, slotUnavailableMessage, type VisitErrors, type VisitField } from '~/utils/visit-form'
import { slotRange } from '~/utils/visit-session'
import { shortDateLabel, slotCountsByDate } from '~/utils/visit-month'
import { visitResultCopy, visitResultKind } from '~/utils/visit-result'
import { reportBookingActionClick } from '~/utils/cta-analytics'
import { newIdempotencyKey } from '~/utils/idempotency-key'
import { formPrivacyEntry } from '~/utils/privacy-policy'
import { loadTurnstile, serverMessage, type TurnstileApi } from '~/utils/turnstile'

const props = defineProps<{
  booking: BookingContent
  campuses: Campus[]
  /** 網址上的校區（/visit/<校>）；有值就是第二步，空字串是 /visit 選校（2026-10-29 步驟跟著網址走） */
  routeCampus?: string
  /** 隱私權政策已發布時由頁面傳 '/privacy'（沒發布傳 null） */
  policyPath?: string | null
}>()

const form = reactive({
  campus: props.routeCampus || '',
  parentName: '',
  phone: '',
  childName: '',
  childBirthdate: '',
  email: '',
  expectedStart: '',
  referralSources: [] as string[]
})

// 第幾步由網址決定（2026-10-29）：原本「下一步」只在元件裡切換，網址停在 /visit，重新整理回到第一步、
// 上一頁直接離開預約頁。現在下一步＝換到 /visit/<校>、更換校區＝回 /visit，頁面元件不重掛（pages/visit/[[key]].vue）。
const step = computed<1 | 2>(() => props.routeCampus ? 2 : 1)
const router = useRouter()
const stageRef = ref<HTMLElement | null>(null)
const titleRef = ref<HTMLElement | null>(null)
const asideRef = ref<HTMLElement | null>(null)
const pickerRef = ref<HTMLElement | null>(null)
const formRef = ref<HTMLFormElement | null>(null)
const errorRef = ref<HTMLElement | null>(null)
const resultRef = ref<HTMLElement | null>(null)
const campusError = ref('')
const campusErrorRef = ref<HTMLElement | null>(null)
const fieldErrors = ref<VisitErrors>({})

const selectedCampusKey = computed(() => form.campus)
const { data: bookingConfig, pending: bookingPending, error: bookingError, refresh: refreshBookingConfig } = useCampusBooking(selectedCampusKey)
const action = computed(() => resolveBookingAction(form.campus || null, bookingConfig.value ?? null, Boolean(bookingError.value)))
const runtimeConfig = useRuntimeConfig()
// 聯絡步驟的主要按鈕（LINE／電話／外部網站）和 BookingCta 一樣自己回報
// 點擊並標 data-booking-cta：外部網站的網址全站點擊統計認不出來。
function trackContactAction(event: MouseEvent) {
  reportBookingActionClick(action.value.kind, form.campus || null, event.currentTarget as Element | null, runtimeConfig.public.telemetryEnabled)
}
// 2026-10-02 業主裁定官網預約不用勾選同意；預約文案發布了個資使用說明時，表單仍給閱讀入口。
const privacyNotice = computed(() => bookingConfig.value?.privacy_notice ?? null)
const privacyEntry = computed(() => formPrivacyEntry(Boolean(props.policyPath), Boolean(privacyNotice.value)))

// 機器人驗證（Cloudflare Turnstile，使用者 2026-09-29 裁定）：部署設定了
// site key，公開預約設定才會帶出來；沒有就完全不載入、表單維持原樣。token
// 只能用一次，送出失敗就重置元件，讓家長重新驗證後再送。
const turnstileSiteKey = computed(() => bookingConfig.value?.turnstile_site_key ?? null)
const turnstileRef = ref<HTMLElement | null>(null)
const turnstileToken = ref('')
const turnstileLoadError = ref('')
let turnstileApi: TurnstileApi | null = null
let turnstileWidgetId: string | null = null
let turnstileHost: HTMLElement | null = null
// 正在載入腳本、準備渲染的容器：onMounted 與 watch 可能同時觸發，不能渲染兩次。
let turnstileMounting: HTMLElement | null = null
let turnstileActive = false

function removeTurnstile() {
  if (turnstileApi && turnstileWidgetId) turnstileApi.remove(turnstileWidgetId)
  turnstileWidgetId = null
  turnstileHost = null
  turnstileMounting = null
  turnstileToken.value = ''
}

async function mountTurnstile() {
  const host = turnstileRef.value
  const sitekey = turnstileSiteKey.value
  if (!turnstileActive || !host || !sitekey) { removeTurnstile(); return }
  if (turnstileHost === host || turnstileMounting === host) return
  removeTurnstile()
  turnstileMounting = host
  turnstileLoadError.value = ''
  try {
    const api = await loadTurnstile()
    // 載入期間可能已換校、表單被收起或元件卸載。
    if (turnstileMounting !== host || !turnstileActive || turnstileRef.value !== host || turnstileSiteKey.value !== sitekey) return
    turnstileApi = api
    turnstileWidgetId = api.render(host, {
      sitekey,
      language: 'zh-tw',
      theme: 'light',
      size: 'flexible',
      callback: (token) => { turnstileToken.value = token },
      'expired-callback': () => { turnstileToken.value = '' },
      'timeout-callback': () => { turnstileToken.value = '' },
      'error-callback': () => { turnstileToken.value = '' }
    }) ?? null
    turnstileHost = host
  } catch {
    if (turnstileMounting === host) turnstileLoadError.value = '機器人驗證載入失敗，請重新整理頁面後再送出，或直接聯絡園所。'
  } finally {
    if (turnstileMounting === host) turnstileMounting = null
  }
}

function resetTurnstile() {
  turnstileToken.value = ''
  if (turnstileApi && turnstileWidgetId) turnstileApi.reset(turnstileWidgetId)
}

onMounted(() => { turnstileActive = true; void mountTurnstile() })
onBeforeUnmount(() => { turnstileActive = false; removeTurnstile() })
watch([turnstileRef, turnstileSiteKey], () => { void mountTurnstile() }, { flush: 'post' })

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
const expectedStartChoices = computed(() => expectedStartOptions(today.value))
// 預計入學時間是單選、選填：再點一次已選的那一個就取消（規格 X3）。已勾選的 radio 按 Space 不會觸發 click，
// 鍵盤要靠 radio 上另掛的 @keydown.space.prevent 才取消得掉（prevent 擋掉瀏覽器自己的 click，避免連觸發兩次）。
// Gecko 在 keyup 才合成 click，keydown 的 prevent 不一定擋得住（未選的會先選上、再被 click 取消），
// 所以 @keyup.space.prevent 也要掛，只擋預設行為、不呼叫 toggle（否則一次按鍵切換兩次）。
function toggleExpectedStart(value: string) {
  form.expectedStart = form.expectedStart === value ? '' : value
  clearFieldError('expectedStart')
}
const slotDates = computed(() => [...new Set(availableSlots.value.map(slot => slot.slot_date))].sort())
const slotCounts = computed(() => slotCountsByDate(availableSlots.value))
const daySlots = computed(() => availableSlots.value.filter(slot => slot.slot_date === selectedVisitDate.value))
const selectedSlot = computed(() => availableSlots.value.find(slot => slot.id === selectedSlotId.value))
const slotTime = (slot: PublicVisitSlot) => slotRange(slot)
let slotRequest = 0

// 填到一半的資料暫存在這個分頁（sessionStorage，2026-10-29）：手機切去別的 App 回來被瀏覽器重新載入、
// 或不小心重新整理，孩子與家長資料、選好的日期場次都還在。關掉分頁就沒了，預約成功立刻清掉。
// 校區看網址，不從暫存還原；日期場次只在同一校、而且重新讀到的場次裡還有時才放回去。
const DRAFT_KEY = 'ivy-visit-draft'
type DraftFields = Omit<typeof form, 'campus'>
interface VisitDraft extends DraftFields { campus: string; visitDate: string; slotId: string }
let draftSlot: { campus: string; date: string; slotId: string } | null = null
let draftReady = false
function readDraft(): Partial<VisitDraft> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}
function saveDraft() {
  if (!draftReady || submitted.value) return
  const draft: VisitDraft = { ...form, referralSources: [...form.referralSources], visitDate: selectedVisitDate.value, slotId: selectedSlotId.value }
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch {}
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY) } catch {}
}
function restoreDraft() {
  const draft = readDraft()
  if (draft) {
    for (const key of ['childName', 'childBirthdate', 'expectedStart', 'parentName', 'phone', 'email'] as const) {
      const value = draft[key]
      if (typeof value === 'string' && !form[key]) form[key] = value
    }
    if (Array.isArray(draft.referralSources) && !form.referralSources.length) {
      form.referralSources = draft.referralSources.filter((value): value is string => typeof value === 'string')
    }
    if (typeof draft.campus === 'string' && typeof draft.visitDate === 'string' && typeof draft.slotId === 'string' && draft.visitDate) {
      draftSlot = { campus: draft.campus, date: draft.visitDate, slotId: draft.slotId }
    }
  }
  draftReady = true
}
// 放回暫存的日期與場次：換日期會清掉場次（下面的 watch），所以先放日期、等 watch 跑完再放場次。
async function restoreDraftSlot(campusKey: string) {
  const saved = draftSlot
  draftSlot = null
  if (!saved || saved.campus !== campusKey || !slotDates.value.includes(saved.date)) return
  selectedVisitDate.value = saved.date
  await nextTick()
  if (availableSlots.value.some(slot => slot.id === saved.slotId && slot.slot_date === saved.date)) selectedSlotId.value = saved.slotId
}
onMounted(restoreDraft)

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
      query: newBookingSlotsQuery(campusKey, today.value)
    })
    if (request !== slotRequest) return
    availableSlots.value = slots.filter(slot => slot.remaining > 0).sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`))
    if (!slotDates.value.includes(selectedVisitDate.value)) selectedVisitDate.value = ''
    if (!availableSlots.value.some(slot => slot.id === selectedSlotId.value)) selectedSlotId.value = ''
    if (draftSlot) await restoreDraftSlot(campusKey)
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
const receiptId = ref('')
const managePath = ref<string | null>(null)
const linkCopied = ref(false)
// LINE 等內建瀏覽器可能不給寫剪貼簿：失敗時把完整網址印出來讓家長長按複製（2026-10-12）。
const linkCopyFailed = ref(false)
const manageUrl = computed(() => managePath.value && import.meta.client ? new URL(managePath.value, window.location.origin).href : '')
const resultKind = computed(() => visitResultKind(resultStatus.value))
const resultCopy = computed(() => visitResultCopy(resultKind.value, {
  emailEnabled: Boolean(bookingConfig.value?.parent_email_enabled),
  email: form.email,
  hasLink: Boolean(managePath.value)
}))

async function copyManageLink() {
  if (!managePath.value) return
  try {
    await navigator.clipboard.writeText(manageUrl.value)
    linkCopied.value = true
    linkCopyFailed.value = false
  } catch {
    linkCopied.value = false
    linkCopyFailed.value = true
  }
}
function selectManageUrl(event: FocusEvent) {
  (event.target as HTMLInputElement).select()
}
const submitting = ref(false)
const submitError = ref<string | null>(null)
// 連線或伺服器失敗時，錯誤在表單頂端、送出鈕在一千多 px 以下：鈕旁再補一行（視覺用，
// 頂端的 role=alert 已經朗讀過）。只給「原封不動再按一次」就好的失敗，稍後再試、
// 其實已送出等情況不顯示。
const submitRetryHint = ref(false)
const submitButtonRef = ref<HTMLButtonElement | null>(null)
// 同一次填寫用同一個 idempotency key；重送（例如網路重試）會安全地
// 回到同一筆案件，不會建立第二筆。只有成功後才換新的 key。
const idempotencyKey = ref(newIdempotencyKey())

const selectedCampus = computed(() => props.campuses.find((c) => c.key === form.campus))
// 選校卡寫短地址（去掉「高雄市」）：第一步請家長「依生活圈與接送路線選擇」，只給區名比不出來（2026-09-29 評析）。
const shortAddress = (campus: Campus) => campus.address?.replace(/^高雄市/, '') || campus.district
// 送出失敗時的退路：直接打給所選校區。
const callFallback = computed(() => selectedCampus.value?.phone ? `也可以直接致電${selectedCampus.value.name} ${selectedCampus.value.phone}。` : '')
// 第一步是薄荷色帶的迎賓區＋照片卡選校；第二步與送出後收成一行頁名，左側改放所選校園。
const isPicking = computed(() => step.value === 1 && !submitted.value)
const nextLabel = computed(() => bookingPending.value ? '正在確認參觀方式…' : action.value.kind === 'form' || !selectedCampus.value ? '下一步：填寫資料' : '下一步：查看參觀方式')
// 選好的校區不開放線上預約時，第二步是聯絡方式，不是表單。
const secondStepLabel = computed(() => selectedCampus.value && bookingConfig.value && action.value.kind !== 'form' ? '參觀方式' : '參觀資料')

// 選校卡標出各校的參觀方式（2026-10-02）：五校不一定都開放線上選場次，家長在比較校區時
// 就該知道，不必點進第二步才發現要來電。只在瀏覽器讀（SSR 與 hydration 首幀都是空的），
// 文字行先保留高度，讀到之後不推動版面；讀不到的校就不標。
// 讀到的設定放進 useCampusBooking 同一個快取 key（2026-10-20）：選定校區後第二步不再重抓同一校。
const campusActions = ref<Record<string, BookingAction>>({})
const nuxtApp = useNuxtApp()
let campusModesRequested = false
async function loadCampusModes() {
  if (campusModesRequested || !props.campuses.length) return
  campusModesRequested = true
  const entries = await Promise.all(props.campuses.map(async (campus) => {
    try {
      const config = await loadCampusBooking(nuxtApp, campus.key)
      return [campus.key, resolveBookingAction(campus.key, config)] as const
    } catch {
      return [campus.key, null] as const
    }
  }))
  campusActions.value = Object.fromEntries(entries.filter((entry): entry is readonly [string, BookingAction] => Boolean(entry[1])))
}
onMounted(() => {
  watch(isPicking, (picking) => { if (picking) void loadCampusModes() }, { immediate: true })
})
function campusModeLabel(campus: Campus): string {
  const kind = campusActions.value[campus.key]?.kind
  if (kind === 'form') return '可線上預約'
  if (kind === 'line') return 'LINE 洽詢'
  if (kind === 'external') return '外部網站預約'
  if (kind === 'phone' || kind === 'paused') return campus.phone ? '來電洽詢' : ''
  return ''
}
const campusChoiceLabel = (campus: Campus) => [campus.name, campus.address || campus.district, campusModeLabel(campus)].filter(Boolean).join('，')
// 來電或暫停線上預約的校區，卡片上直接給撥號（2026-10-29）：原本要先選卡、按「下一步」才看到致電鈕，
// 正式站五校只有義華開放線上選場次。號碼的取法同首頁五校卡（campusVisitCta：預約設定的號碼優先，
// 沒有才用五校介紹的電話）。卡片本身照舊可以選、進第二步。LINE 與外部網站仍在第二步，說明文字放得下。
function campusCall(campus: Campus): { href: string; number: string } | null {
  const action = campusActions.value[campus.key]
  if (action?.kind !== 'phone' && action?.kind !== 'paused') return null
  const cta = campusVisitCta(campus, action)
  return cta.kind === 'phone' ? { href: cta.href, number: cta.href.replace(/^tel:/, '') } : null
}

// 送出列直接寫出這次要預約的日期與場次，按下前最後確認一次。
const bookingSummary = computed(() => selectedSlot.value
  ? [shortDateLabel(selectedSlot.value.slot_date), slotTime(selectedSlot.value)]
  : [])
// 線上 parent_email_enabled 為 false 時不會寄信：欄位說明不能承諾確認信。
const emailHint = computed(() => bookingConfig.value?.parent_email_enabled
  ? '確認信與修改連結會寄到這裡。'
  : '園所會用這個 Email 聯絡你；修改連結會顯示在預約完成頁。')

async function focusStage() {
  await nextTick()
  stageRef.value?.focus({ preventScroll: true })
  // 960px 以下側欄收成表單上方一條：捲到側欄上面那行頁名（「預約校園參觀」，它和側欄都沒有 scroll-margin，
  // 只讓出 html 的 scroll-padding），頁名、所選校區與「更換校區」才不會卡在頁首膠囊底下；.visit-stage 的
  // scroll-margin 再疊上去會多捲一段、把側欄捲走。桌機兩欄照舊捲 stage。
  // 2026-10-13：原本捲到側欄本身，390 寬按「下一步」後頁名剛好一半壓在浮動膠囊底下。
  const target = !isPicking.value && asideRef.value && matchMedia('(max-width: 960px)').matches ? (titleRef.value ?? asideRef.value) : stageRef.value
  target?.scrollIntoView({ block: 'start', behavior: 'instant' })
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
    // 焦點仍給第一張卡，但捲動對準這一步的標題：直接 focus() 會把卡片頂到頁首正下方，
    // 錯誤剛好被桌機頁首蓋住；只捲到錯誤本身，上一行說明又會被頁首切一半。標題、說明、錯誤、第一張卡依序往下排。
    pickerRef.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    const stepTitle = campusErrorRef.value?.parentElement?.querySelector('h2') ?? campusErrorRef.value
    stepTitle?.scrollIntoView({ block: 'start', behavior: 'instant' })
    return
  }
  await openCampus(selectedCampus.value.key)
}

/** 進第二步＝換到 /visit/<校>；網址一變，下面的 watch 換校區、聚焦第二步。 */
async function openCampus(key: string) {
  if (submitting.value) return
  await router.push(`/visit/${key}`)
}

async function changeCampus() {
  if (submitting.value) return
  await router.push('/visit')
}

async function focusPicker() {
  await focusStage()
  const checked = pickerRef.value?.querySelector<HTMLInputElement>('input:checked')
  checked?.focus({ preventScroll: true })
  // 矮螢幕（320x568）捲到 stage 頂端後，已選的卡（例如第三張）還在畫面下方：補捲到看得見為止。
  checked?.closest('.visit-campus-choice')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

// 送出成功後又換了網址（上一頁回選校、下一頁、更換校區）：收起結果、重新讀場次，填過的資料留著，
// 要再約另一校不必重打。暫存已在成功時清掉，這時再改欄位才會重新存。
function resetResult() {
  submitted.value = false
  resultStatus.value = null
  receiptId.value = ''
  managePath.value = null
  submittedSlot.value = null
  linkCopied.value = false
  linkCopyFailed.value = false
  selectedVisitDate.value = ''
  selectedSlotId.value = ''
}

watch(() => props.routeCampus, async (key) => {
  if (submitted.value) {
    resetResult()
    void loadSlots()
  }
  if (key) {
    form.campus = key
    await focusStage()
  } else {
    await focusPicker()
  }
})

// 結果不是「預約成功」（例如最後一個名額剛被約走）時，回到同一校的表單重選場次；網址本來就是 /visit/<校>。
async function bookAgain() {
  resetResult()
  await loadSlots()
  await focusStage()
}

// 手機直拿時月曆在上、場次在下：點了月曆下半的日子，場次常在畫面外（390×844 點第一列就在約 1028px）。
// 選好日子後把第一個場次捲進畫面；已經看得到就不動（桌機兩欄並排，場次本來就在旁邊）。
const slotListRef = ref<HTMLElement | null>(null)
async function revealSlots() {
  await nextTick()
  const list = slotListRef.value
  const first = list?.querySelector<HTMLElement>('.visit-slot-options label') ?? list
  if (!list || !first || first.getBoundingClientRect().bottom <= window.innerHeight) return
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
  list.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'instant' })
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

// 點下一個控制項時，輸入框在按下（mousedown，觸控點擊也會補發）的當下就 blur：這時插入
// 錯誤訊息，下方版面被推下約 31px，放開時已不在按下的位置，那次點擊落空——電話填錯直接點
// 同意框要點兩次、Email 填錯直接按送出沒反應（2026-09-30 E2E）。按住期間先記下要驗的欄位，
// 放開、click 跑完再驗。送出時 onSubmit 會整份重驗，不靠這裡。
let pointerHeld = false
const heldChecks = new Set<VisitField>()
function holdPointer(event: MouseEvent) { if (event.button === 0) pointerHeld = true }
function releasePointer() {
  if (!pointerHeld) return
  pointerHeld = false
  setTimeout(() => {
    for (const field of heldChecks) checkField(field)
    heldChecks.clear()
  })
}
function checkFieldOnBlur(field: VisitField) {
  if (pointerHeld) heldChecks.add(field)
  else checkField(field)
}
// 從連結或圖片拖出去不會有 mouseup，只有 dragend；Mac 的 Ctrl+點開出右鍵選單也會吞掉 mouseup。
const pointerListeners = [['mousedown', holdPointer], ['mouseup', releasePointer], ['dragend', releasePointer], ['contextmenu', releasePointer]] as const
onMounted(() => { for (const [type, listener] of pointerListeners) document.addEventListener(type, listener, true) })
onBeforeUnmount(() => { for (const [type, listener] of pointerListeners) document.removeEventListener(type, listener, true) })

// 手機鍵盤的「前往／Enter」會隱式送出表單，還沒填的欄位一次全變紅：觸控裝置上改成
// 跳到下一欄（最後一欄就收起鍵盤），只有按「確認預約」才送出。桌機鍵盤維持
// Enter 送出。注音、倉頡選字也用 Enter 確認，組字中（Safari 的 keyCode 229）不攔。
function onEnterKey(event: KeyboardEvent) {
  focusNextFieldOnEnter(event, formRef.value)
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
watch([form, selectedVisitDate, selectedSlotId], saveDraft, { deep: true })

async function onSubmit() {
  if (submitting.value || bookingPending.value || slotsPending.value || action.value.kind !== 'form' || !selectedCampus.value) return
  submitError.value = null
  submitRetryHint.value = false
  form.parentName = form.parentName.trim()
  form.childName = form.childName.trim()
  form.email = form.email.trim()
  form.phone = normalizeVisitPhone(form.phone)
  fieldErrors.value = validateVisitContact(form, taipeiDate())
  if (!selectedVisitDate.value) fieldErrors.value.visitDate = '請選擇參觀日期。'
  else if (!selectedSlot.value || selectedSlot.value.slot_date !== selectedVisitDate.value) fieldErrors.value.slotId = '請選擇這一天的參觀場次。'
  if (Object.keys(fieldErrors.value).length) {
    await nextTick()
    focusFirstInvalidField(formRef.value)
    return
  }
  if (turnstileSiteKey.value && !turnstileToken.value) {
    submitError.value = turnstileLoadError.value || '請先完成下方的機器人驗證，再確認預約。'
    await focusError()
    return
  }

  submitting.value = true
  // 伺服器 422 指出欄位時，等送出中的 fieldset 解除 disabled 再把焦點交給第一個出錯的欄位（比照上面的前端驗證）。
  let focusInvalidField = false
  try {
    const created = await $fetch<{ receipt_id: string; status: string; manage_path: string | null }>('/api/website/v1/public/visit-requests', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.value },
      body: {
        campus_key: form.campus,
        config_version: bookingConfig.value?.version ?? 0,
        parent_name: form.parentName,
        phone: form.phone,
        child_name: form.childName,
        child_birthdate: form.childBirthdate,
        email: form.email,
        referral_sources: form.referralSources,
        ...(form.expectedStart ? { expected_start: form.expectedStart } : {}),
        slot_id: selectedSlotId.value,
        turnstile_token: turnstileSiteKey.value ? turnstileToken.value : undefined
      }
    })
    // 用 server 回的實際狀態決定文案，不要從 mode 推斷：只有 confirmed 才能
    // 說「預約成立」——規格 197。
    submittedSlot.value = selectedSlot.value ? { ...selectedSlot.value } : null
    resultStatus.value = created?.status ?? null
    receiptId.value = created?.receipt_id || idempotencyKey.value
    managePath.value = created?.manage_path ?? null
    linkCopied.value = false
    linkCopyFailed.value = false
    submitted.value = true
    clearDraft()
    idempotencyKey.value = newIdempotencyKey()
    await nextTick()
    // 結果區塊比一屏高：直接 focus() 會被瀏覽器捲到置中，狀態與標題落在膠囊底下或畫面外。
    // 比照 focusStage，先不捲動地聚焦，再把頂端對齊到頁首下方（.visit-result 手機不另加 scroll-margin）。
    resultRef.value?.focus({ preventScroll: true })
    resultRef.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
  } catch (err: any) {
    const detail = err?.data?.detail
    const code = typeof detail === 'object' ? detail.code : null
    if (code === 'BOOKING_CONFIG_CHANGED') {
      submitError.value = '這個校區的預約設定剛剛更新了，請確認以下資訊後再送出一次。'
      await refreshBookingConfig()
      await loadSlots()
    } else if (slotUnavailableMessage(code)) {
      submitError.value = slotUnavailableMessage(code)!
      await loadSlots()
      selectedSlotId.value = ''
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      // 同一把 key 但內容不同：代表前一次其實已經送出成功了。叫使用者
      // 「再試一次」只會永遠卡住，要換一把新 key 才送得出去。
      idempotencyKey.value = newIdempotencyKey()
      submitError.value =
        (bookingConfig.value?.parent_email_enabled
          ? '你先前那一次其實已經預約成功了，請從確認信裡的連結管理預約。要更正內容請用那條連結，不要重複送出。'
          : '你先前那一次其實已經預約成功了。要更正內容請直接聯絡園所，不要重複送出。') + callFallback.value
    } else if (code === 'BOT_CHECK_FAILED') {
      submitError.value = serverMessage(detail, '請完成機器人驗證後再送出。')
    } else if (code === 'BOOKING_LIMIT') {
      // 每個網路的時段占位上限或每校每小時上限；伺服器的訊息會說是哪一種。
      submitError.value = serverMessage(detail, '目前線上預約人數較多，請稍後再試，或直接來電洽詢園所。')
    } else if (code === 'RATE_LIMITED') {
      submitError.value = `送出太多次了，請稍後再試一次。${callFallback.value}`
    } else if (code === 'BOOKING_UNAVAILABLE') {
      submitError.value = '這個校區目前不接受線上預約表單，請改用其他聯絡方式。'
      await refreshBookingConfig()
      await loadSlots()
    } else if (err?.response?.status === 429) {
      submitError.value = `送出太多次了，請稍後再試一次。${callFallback.value}`
    } else if (err?.response?.status === 422) {
      const fields = apiFieldErrors(detail)
      if (Object.keys(fields).length) {
        fieldErrors.value = { ...fieldErrors.value, ...fields }
        submitError.value = '有幾個欄位需要修正，請看標示的地方。'
        focusInvalidField = true
      } else {
        submitError.value = '部分資料格式有誤，請檢查孩子生日、Email、聯絡電話與必填欄位。'
      }
    } else {
      submitError.value = `送出失敗，請稍後再試一次；你填寫的內容還保留著。${callFallback.value}`
      submitRetryHint.value = true
    }
    // 失敗時完全不清空 form 的任何欄位——使用者不用重打一次。Turnstile
    // token 只能用一次（伺服器可能已經驗過），重置元件讓家長重新驗證。
    resetTurnstile()
    if (!submitRetryHint.value && !focusInvalidField) await focusError()
  } finally {
    submitting.value = false
  }
  if (focusInvalidField) {
    await nextTick()
    if (!focusFirstInvalidField(formRef.value)) await focusError()
  }
  // 原封不動再按一次就好的失敗：焦點留在送出鈕（鈕旁有提示，頂端 role=alert 照樣朗讀）。
  // 焦點跳到頂端錯誤會把手機畫面往上捲一千八百多 px，要再捲回來才按得到送出（2026-10-12）。
  // 送出中按鈕是 disabled、focus 不進去，所以等 submitting 解除才聚焦。
  if (submitRetryHint.value && submitError.value) {
    await nextTick()
    submitButtonRef.value?.focus()
  }
}

</script>

<template>
  <section class="visit-page" data-cta-entry="visit_page" :data-campus-key="form.campus" :data-step="submitted ? 'result' : step">
    <header class="visit-welcome">
      <div class="container visit-welcome-inner">
        <div class="visit-welcome-copy">
          <p v-if="isPicking" class="ivy-kicker visit-eyebrow">預約校園參觀</p>
          <h1 id="visit-title" ref="titleRef"><template v-if="isPicking">帶著好奇，<br>來校園走走。</template><template v-else>預約校園參觀</template></h1>
          <p v-if="isPicking" class="visit-lead">看看孩子未來的日常，也和我們聊聊你的期待。<br>從一所離生活近一點的校園開始。</p>
        </div>
        <figure v-if="isPicking" class="visit-welcome-photo">
          <!-- 手機與橫拿手機把照片藏起來（visit-booking.css），這時換成 1×1 透明圖，不下載原圖。
               不用 loading="lazy"：桌機這張是 LCP，lazy 會延後抓取、降低優先權。 -->
          <picture>
            <source media="(max-width: 760px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape)" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
            <img v-bind="responsiveImage('about-curious', '(max-width: 760px) calc(100vw - 40px), 40vw')" class="ivy-photo" alt="孩子們笑著指向前方" decoding="async">
          </picture>
          <figcaption>在常春藤，遇見成長的下一站。</figcaption>
        </figure>
      </div>
    </header>
    <div class="container visit-content">
      <div class="visit-shell">
        <aside v-if="!isPicking && selectedCampus" ref="asideRef" class="visit-campus-aside" aria-label="所選校園">
          <div class="visit-aside-card">
            <span class="visit-aside-photo ivy-photo"><img :key="selectedCampus.key" v-bind="pickImage(selectedCampus.image, selectedCampus.imageMedia, '(max-width: 960px) 96px, 420px')" alt="" decoding="async" :style="{ objectPosition: selectedCampus.panoramaPos || 'center 55%' }"></span>
            <span class="visit-aside-caption">
              <span class="visit-aside-district">高雄 · {{ selectedCampus.district }}</span>
              <strong class="visit-aside-name">{{ selectedCampus.name }}</strong>
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
              <li :aria-current="step === 2 ? 'step' : undefined"><span class="visit-step-number">2</span>{{ secondStepLabel }}</li>
            </ol>

            <section v-if="step === 1" class="visit-pick-step" aria-labelledby="visit-choose-title">
              <h2 id="visit-choose-title">想先認識哪所校園？</h2>
              <p class="visit-step-copy">依照你的生活圈與接送路線選擇。</p>
              <!-- 放在選校清單前面：沒選校按「下一步」會聚焦第一張卡，錯誤要在卡片正上方才看得到。 -->
              <p id="visit-campus-error" ref="campusErrorRef" class="visit-field-error" role="alert">{{ campusError }}</p>
              <fieldset ref="pickerRef" class="visit-campus-list" :disabled="submitting" aria-describedby="visit-campus-error">
                <legend class="sr-only">想參觀的校區</legend>
                <!-- 手機版卡片是左圖右字的一列，五張都在首屏附近、lazy 也擋不住。
                     2026-10-29 視覺方向 B 改成白框相片：照片是 4:3、文字在照片下方（手機與橫拿手機是左圖右字的一列）。
                     橫幅外觀照（約 1.9:1）cover 進 4:3 要畫的寬度是「框寬 × 1.43」：桌機框寬約 220px → 340px；
                     761–960 一列三張、框寬約 30vw → 45vw；手機左側小圖約 (100vw − 40px) × .34 → × .5；橫拿一列兩張 → 25vw。
                     第一張是 LCP，給 high（其他頁的首圖都有）：預設 Low 時和其他四張同時排隊，手機慢速 4G 量到 3.8 s（2026-10-21）。
                     網址帶校區時直接進第二步、卡片不在首屏，就不搶。 -->
                <label v-for="(campus, i) in campuses" :key="campus.key" class="visit-campus-choice">
                  <input v-model="form.campus" type="radio" name="campus" :value="campus.key" :aria-label="campusChoiceLabel(campus)">
                  <span class="visit-campus-card">
                    <span class="visit-campus-photo"><img v-bind="pickImage(campus.image, campus.imageMedia, '(max-width: 760px) calc((100vw - 40px) * .5), (max-width: 960px) and (max-height: 500px) and (orientation: landscape) 25vw, (max-width: 960px) 45vw, 340px')" alt="" decoding="async" :fetchpriority="i === 0 && !routeCampus ? 'high' : undefined" :style="{ objectPosition: campus.panoramaPos || 'center 55%' }"></span>
                    <!-- 來電的校區把「來電洽詢」換成撥號連結：連結在 label 裡，點它只撥號、不會選到這張卡（HTML 規定 label
                         遇到裡面的互動元素不轉送點擊）。radio 的名稱已含「來電洽詢」，連結另外唸校名與號碼。 -->
                    <span class="visit-campus-copy"><strong>{{ campus.name }}</strong><small>{{ shortAddress(campus) }}</small><a v-if="campusCall(campus)" class="visit-campus-mode is-call" :href="campusCall(campus)!.href" :data-campus-key="campus.key" :aria-label="`致電${campus.name}預約參觀 ${campusCall(campus)!.number}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ campusCall(campus)!.number }}</a><span v-else class="visit-campus-mode" :class="{ 'is-online': campusActions[campus.key]?.kind === 'form' }" aria-hidden="true">{{ campusModeLabel(campus) }}</span></span>
                    <span class="visit-campus-check" aria-hidden="true"><svg class="icon"><use href="#i-check" /></svg></span>
                  </span>
                </label>
              </fieldset>
              <p v-if="!campuses.length" class="visit-status" role="status">目前沒有可供選擇的校區，請稍後再來查看。</p>
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
                <!-- 讀不到參觀方式時標題也寫「歡迎與○○聯絡」：原本標題「參觀方式暫時無法載入」和底下的說明幾乎同一句。
                     這時打電話一定有用、重新載入不一定，致電是主要按鈕、重新載入改外框鈕排在後面（2026-10-13）。 -->
                <h2 id="visit-contact-title">歡迎與{{ selectedCampus.name }}聯絡</h2>
                <p class="visit-status" role="status">{{ action.message || (action.href ? `透過以下方式聯絡園所，一起安排合適的參觀時間。` : '目前無法使用線上表單，請直接聯絡園所確認參觀安排。') }}</p>
                <div class="visit-contact-actions">
                  <a v-if="action.href && action.kind !== 'phone'" data-booking-cta class="button primary" :href="action.href" target="_blank" rel="noopener noreferrer" @click="trackContactAction">{{ action.label }} <span aria-hidden="true">↗</span></a>
                  <a v-else-if="action.href" data-booking-cta class="button primary" :href="action.href" @click="trackContactAction"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ action.label }}</a>
                  <a v-if="selectedCampus.phone && (action.kind !== 'phone' || !action.href)" class="button" :class="action.href ? 'outline' : 'primary'" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}<span class="visit-call-number">{{ selectedCampus.phone }}</span></a>
                  <button v-if="action.kind === 'unavailable'" type="button" class="button" :class="selectedCampus.phone ? 'outline' : 'primary'" @click="retryBookingConfig">重新載入參觀方式</button>
                  <a v-if="selectedCampus.line && selectedCampus.line !== action.href" class="visit-inline-link" :href="selectedCampus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ selectedCampus.name }} ↗</a>
                </div>
              </section>

              <form v-else ref="formRef" class="booking-form visit-contact-form" novalidate :aria-busy="submitting" @submit.prevent="onSubmit" @keydown.enter="onEnterKey">
                <h2>填寫參觀資料</h2>
                <p class="visit-step-copy">讓{{ selectedCampus.name }}先認識孩子，也為這次見面做好準備。</p>
                <p v-if="action.message" class="visit-config-note">{{ action.message }}</p>
                <fieldset class="visit-form-fields" :disabled="submitting">
                  <legend class="sr-only">孩子與家長資料</legend>
                  <section v-if="bookingConfig?.mode === 'slots'" class="visit-form-section visit-schedule-section" aria-labelledby="visit-schedule-title">
                    <h3 id="visit-schedule-title">參觀安排</h3>
                    <p class="visit-field-hint">僅列出{{ selectedCampus.name }}目前開放的日期與場次。</p>
                    <p v-if="slotsPending" class="visit-status visit-slots-loading" role="status">正在讀取可預約場次…</p>
                    <!-- 沒有場次時重新載入幫不上忙：只給寫出號碼的致電主要按鈕；讀取失敗才加「重新載入場次」外框鈕。
                         說明放進和參觀方式步驟同一種淡色底塊（2026-10-13，原本是一行灰字＋大外框鈕＋沒有號碼的小連結）。 -->
                    <div v-else-if="slotsError || !availableSlots.length" class="visit-slots-empty" role="status">
                      <p>{{ slotsError || '目前沒有開放的參觀場次，歡迎直接聯絡園所安排。' }}</p>
                      <div v-if="selectedCampus.phone || slotsError" class="visit-contact-actions"><a v-if="selectedCampus.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}<span class="visit-call-number">{{ selectedCampus.phone }}</span></a><button v-if="slotsError" type="button" class="button" :class="selectedCampus.phone ? 'outline' : 'primary'" @click="loadSlots">重新載入場次</button></div>
                    </div>
                    <div v-else class="visit-schedule-fields">
                      <div class="visit-date-field"><VisitDatePicker v-model="selectedVisitDate" :counts="slotCounts" :invalid="Boolean(fieldErrors.visitDate)" describedby="visit-date-error" @update:model-value="revealSlots" /><p id="visit-date-error" class="visit-field-error">{{ fieldErrors.visitDate }}</p></div>
                      <fieldset ref="slotListRef" class="visit-slot-list" aria-describedby="visit-slot-error"><legend>預約場次<small>必填</small></legend><p v-if="!selectedVisitDate" class="visit-field-hint">先在月曆選一天，再選當天的場次。</p><div v-else class="visit-slot-options"><label v-for="slot in daySlots" :key="slot.id"><input v-model="selectedSlotId" type="radio" name="slotId" :value="slot.id" required :aria-invalid="Boolean(fieldErrors.slotId)" @change="clearFieldError('slotId')"><span>{{ slotTime(slot) }}<small>尚可預約 {{ slot.remaining }} 組</small></span></label></div><p id="visit-slot-error" class="visit-field-error">{{ fieldErrors.slotId }}</p></fieldset>
                    </div>
                  </section>
                  <p v-else class="visit-config-note">{{ selectedCampus.name }}將與你聯繫，另行確認參觀日期與場次。</p>

                  <section class="visit-form-section" aria-labelledby="visit-child-title">
                    <h3 id="visit-child-title">孩子資料</h3>
                    <div class="visit-field-grid">
                      <div class="visit-field"><label for="child-name">孩子姓名<small>必填</small></label><input id="child-name" v-model="form.childName" name="childName" autocomplete="off" maxlength="64" enterkeyhint="next" required placeholder="請填寫孩子姓名" :aria-invalid="Boolean(fieldErrors.childName)" aria-describedby="visit-child-name-error" @blur="checkFieldOnBlur('childName')" @input="clearFieldError('childName')"><p id="visit-child-name-error" class="visit-field-error">{{ fieldErrors.childName }}</p></div>
                      <div class="visit-field"><label for="child-birthdate">孩子出生年月日<small>必填</small></label><input id="child-birthdate" v-model="form.childBirthdate" name="childBirthdate" type="date" autocomplete="off" :max="today" required :aria-invalid="Boolean(fieldErrors.childBirthdate)" aria-describedby="visit-birthdate-hint visit-birthdate-error" @blur="checkFieldOnBlur('childBirthdate')" @input="clearFieldError('childBirthdate')"><small id="visit-birthdate-hint" class="visit-field-hint">依孩子生日，協助了解適齡班別。</small><p id="visit-birthdate-error" class="visit-field-error">{{ fieldErrors.childBirthdate }}</p></div>
                    </div>
                    <fieldset class="visit-referrals visit-expected-start" aria-describedby="visit-expected-start-error"><legend>預計入學時間<small>選填</small></legend><div><label v-for="option in expectedStartChoices" :key="option.value"><input type="radio" name="expectedStart" :value="option.value" :checked="form.expectedStart === option.value" @click="toggleExpectedStart(option.value)" @keydown.space.prevent="toggleExpectedStart(option.value)" @keyup.space.prevent><span>{{ option.label }}</span></label></div><p id="visit-expected-start-error" class="visit-field-error">{{ fieldErrors.expectedStart }}</p></fieldset>
                  </section>

                  <section class="visit-form-section" aria-labelledby="visit-parent-title">
                    <h3 id="visit-parent-title">家長聯絡方式</h3>
                    <div class="visit-field-grid">
                      <div class="visit-field"><label for="parent-name">家長稱呼<small>必填</small></label><input id="parent-name" v-model="form.parentName" name="parentName" autocomplete="section-parent name" maxlength="40" enterkeyhint="next" required placeholder="例如：陳媽媽" :aria-invalid="Boolean(fieldErrors.parentName)" aria-describedby="visit-name-error" @blur="checkFieldOnBlur('parentName')" @input="clearFieldError('parentName')"><p id="visit-name-error" class="visit-field-error">{{ fieldErrors.parentName }}</p></div>
                      <div class="visit-field"><label for="parent-phone">聯絡電話<small>必填</small></label><input id="parent-phone" v-model="form.phone" name="phone" type="tel" inputmode="tel" autocomplete="section-parent tel-national" maxlength="16" enterkeyhint="next" required pattern="09[0-9]{8}" placeholder="09xxxxxxxx" :aria-invalid="Boolean(fieldErrors.phone)" aria-describedby="phone-hint visit-phone-error" @blur="checkFieldOnBlur('phone')" @input="clearFieldError('phone')"><small id="phone-hint" class="visit-field-hint">09 開頭的 10 碼手機號碼</small><p id="visit-phone-error" class="visit-field-error">{{ fieldErrors.phone }}</p></div>
                      <div class="visit-field visit-full"><label for="parent-email">聯絡 Email<small>必填</small></label><input id="parent-email" required v-model="form.email" name="email" type="email" inputmode="email" autocomplete="section-parent email" maxlength="254" enterkeyhint="done" placeholder="name@example.com" :aria-invalid="Boolean(fieldErrors.email)" aria-describedby="visit-email-hint visit-email-error" @blur="checkFieldOnBlur('email')" @input="clearFieldError('email')"><p id="visit-email-hint" class="visit-field-hint">{{ emailHint }}</p><p id="visit-email-error" class="visit-field-error">{{ fieldErrors.email }}</p></div>
                    </div>
                  </section>

                  <fieldset class="visit-referrals"><legend>如何知道常春藤幼兒園？<small>可複選・選填</small></legend><div><label v-for="source in REFERRAL_OPTIONS" :key="source.value"><input v-model="form.referralSources" type="checkbox" name="referralSources" :value="source.value"><span>{{ source.label }}</span></label></div></fieldset>
                  <PrivacyNoticeDialog
                    v-if="privacyNotice && (privacyEntry === 'dialog' || privacyEntry === 'dialog-with-policy')"
                    :notice="privacyNotice"
                    label="閱讀個資使用說明"
                    trigger-class="visit-privacy-link"
                    :policy-href="privacyEntry === 'dialog-with-policy' ? policyPath : null"
                  />
                  <a v-else-if="privacyEntry === 'policy-link'" class="visit-privacy-link" href="/privacy" target="_blank" rel="noopener noreferrer">隱私權政策<span class="sr-only">（另開新視窗）</span></a>
                </fieldset>
                <p v-if="Object.keys(fieldErrors).length" class="sr-only" role="alert">請確認標示的欄位：{{ Object.values(fieldErrors).join(' ') }}</p>
                <div v-if="turnstileSiteKey" class="visit-turnstile">
                  <div ref="turnstileRef" class="visit-turnstile-widget" />
                  <p v-if="turnstileLoadError" class="visit-field-error" role="alert">{{ turnstileLoadError }}</p>
                </div>
                <div class="visit-submit-row"><div class="visit-submit-summary"><template v-if="bookingSummary.length"><p class="visit-summary-what"><strong>{{ selectedCampus.name }}</strong><span v-for="(part, index) in bookingSummary" :key="index" class="visit-nowrap">{{ part }}{{ index < bookingSummary.length - 1 ? '・' : '' }}</span></p><p>按下就完成預約，之後可以用修改連結改時間或取消。</p></template><p v-else>還沒選參觀日期與場次。</p></div><p v-if="submitRetryHint && submitError" class="visit-submit-retry" aria-hidden="true">{{ turnstileSiteKey ? '送出沒有成功，機器人驗證重新完成後再按一次。' : '送出沒有成功，可以直接再按一次。' }}{{ callFallback }}</p><button ref="submitButtonRef" type="submit" class="button primary" :disabled="submitting || slotsPending || (bookingConfig?.mode === 'slots' && (!availableSlots.length || Boolean(slotsError)))">{{ submitting ? '正在預約…' : '確認預約' }}<span v-if="!submitting" aria-hidden="true">→</span></button></div>
              </form>
            </template>
          </template>

          <section v-else id="booking-result" ref="resultRef" class="visit-result" tabindex="-1" aria-labelledby="visit-result-title">
            <img v-if="selectedCampus" class="visit-result-art" :class="{ 'is-blend': lineArtBlends(selectedCampus) }" v-bind="lineArtInkImage(selectedCampus, '220px')" alt="" decoding="async">
            <span class="visit-result-status" :data-status="resultKind === 'booked' ? 'confirmed' : 'closed'"><svg class="icon" aria-hidden="true"><use :href="resultKind === 'booked' ? '#i-check' : '#i-x'" /></svg>{{ resultCopy.eyebrow }}</span>
            <h2 id="visit-result-title">{{ resultCopy.title }}</h2>
            <p v-if="resultKind === 'booked' && submittedSlot" class="visit-result-when"><span class="visit-nowrap">{{ shortDateLabel(submittedSlot.slot_date) }}</span> <span class="visit-nowrap">{{ slotTime(submittedSlot) }}</span><span class="visit-result-where">{{ selectedCampus?.name }}・{{ selectedCampus?.address }}</span></p>
            <p class="visit-step-copy">{{ resultCopy.body }}</p>
            <VisitCalendarActions
              v-if="resultKind === 'booked' && submittedSlot && selectedCampus"
              :campus="selectedCampus" :slot="submittedSlot" :uid="`visit-${receiptId}@ivy-website`"
            />
            <div v-if="resultKind === 'booked' && managePath" class="visit-result-next">
              <h3>之後要改時間或取消</h3>
              <p>用這個連結就能改場次、修改資料或取消預約，請收藏起來，不要轉給其他人。</p>
              <div class="visit-contact-actions">
                <!-- 整頁導覽：client 端導覽會把含 token 的網址存進 router 的 history.state。 -->
                <a class="button primary" :href="managePath">修改或取消預約</a>
                <button type="button" class="button outline" @click="copyManageLink">{{ linkCopied ? '已複製連結' : '複製連結' }}</button>
              </div>
              <p class="visit-copy-feedback" role="status">{{ linkCopyFailed ? '沒有複製成功，請長按下面的網址複製。' : '' }}</p>
              <input v-if="linkCopyFailed" class="visit-copy-url" type="url" readonly :value="manageUrl" aria-label="修改或取消預約的連結" @focus="selectManageUrl">
            </div>
            <div v-else class="visit-result-next">
              <h3>需要協助？</h3>
              <p>請直接聯絡{{ selectedCampus?.name }}。</p>
              <div class="visit-contact-actions"><a v-if="selectedCampus?.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}</a><button v-if="selectedCampus" type="button" class="visit-inline-link" @click="bookAgain">重新選擇場次</button></div>
            </div>
            <!-- 填寫內容放在下一步之後：正式站不寄確認信時，修改連結是家長唯一的管理入口，手機上原本要捲近兩屏才看到（2026-10-12）。 -->
            <dl class="visit-result-list"><div><dt>參觀校區</dt><dd>{{ selectedCampus?.name }}</dd></div><div v-if="submittedSlot && resultKind !== 'booked'"><dt>預約日期</dt><dd>{{ visitDateLabel(submittedSlot.slot_date) }}</dd></div><div v-if="submittedSlot && resultKind !== 'booked'"><dt>預約場次</dt><dd>{{ slotTime(submittedSlot) }}</dd></div><div><dt>孩子姓名</dt><dd>{{ form.childName }}</dd></div><div><dt>出生年月日</dt><dd>{{ form.childBirthdate }}</dd></div><div><dt>家長稱呼</dt><dd>{{ form.parentName }}</dd></div><div><dt>聯絡電話</dt><dd>{{ form.phone }}</dd></div><div><dt>聯絡 Email</dt><dd>{{ form.email }}</dd></div><div v-if="form.expectedStart"><dt>預計入學</dt><dd>{{ expectedStartChoices.find(option => option.value === form.expectedStart)?.label }}</dd></div><div v-if="form.referralSources.length"><dt>得知管道</dt><dd>{{ REFERRAL_OPTIONS.filter(source => form.referralSources.includes(source.value)).map(source => source.label).join('、') }}</dd></div></dl>
            <NuxtLink class="visit-inline-link visit-home" to="/">回到首頁</NuxtLink>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="../assets/css/visit-booking.css"></style>
<style scoped>
/* Turnstile 的 iframe 由 Cloudflare 插入：先保留元件高度，載入時送出列不跳動。 */
.visit-turnstile {margin-top:21px}
.visit-turnstile-widget {min-height:65px;max-width:400px}
</style>
