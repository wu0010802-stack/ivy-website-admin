<script setup lang="ts">
import { useParentVisit } from '~/composables/useParentVisit'
import { changeDeadlineRule, taipeiDate, type VisitErrors } from '~/utils/visit-form'
import { slotRange, slotWhen } from '~/utils/visit-session'
import { shortDateLabel, slotCountsByDate } from '~/utils/visit-month'
import { editBaseFrom, editedChanges, rebaseEdit, validateEdit, type EditForm } from '~/utils/visit-edit'
import { parentVisitCampus } from '~/utils/parent-visit'

const { data } = await usePublishedSite()
const route = useRoute()
const router = useRouter()
const {
  visit, pending, busy, unavailable, error, notice, slots, slotsPending, slotsError, detailErrors,
  initialize, reload, loadSlots, cancelVisit, reschedule, updateDetails, dispose
} = useParentVisit()
const showCancel = ref(false)
const showReschedule = ref(false)
const showEdit = ref(false)
const selectedSlotId = ref('')
const slotError = ref('')
const feedback = ref<HTMLElement | null>(null)
const cancelPanel = ref<HTMLElement | null>(null)
const rescheduleForm = ref<HTMLFormElement | null>(null)
// 改場次和預約頁同一個月曆（2026-10-02 取代列出全部場次的下拉）：先選一天，再選當天的場次。
const selectedDate = ref('')
const slotCounts = computed(() => slotCountsByDate(slots.value))
const daySlots = computed(() => slots.value.filter(slot => slot.slot_date === selectedDate.value))
const selectedNewSlot = computed(() => slots.value.find(slot => slot.id === selectedSlotId.value))
// 停用的分校不在公開內容裡：校名、電話改用預約回應帶的，不改列其他校區。
const visitCampus = computed(() => parentVisitCampus(visit.value, data.value?.content.campuses))
// 預約成立才給「加入行事曆／導航」（規格 197）。地址只取公開中的分校資料；停用的分校沒有地址，就只給行事曆。
const calendarCampus = computed(() => {
  if (visit.value?.status !== 'confirmed' || !visit.value.slot || !visitCampus.value?.name) return null
  const published = visitCampus.value.listed ? data.value?.content.campuses.find(campus => campus.key === visitCampus.value!.key) : undefined
  return { name: visitCampus.value.name, phone: visitCampus.value.phone, address: published?.address ?? null }
})
const statusLabels: Record<string, string> = {
  confirmed: '預約成功', cancelled: '預約已取消', completed: '已完成參觀', no_show: '未完成參觀'
}
const statusLabel = computed(() => statusLabels[visit.value?.status || ''] || '請聯絡園所確認')
const deadlineLabel = computed(() => visit.value?.change_deadline
  ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(visit.value.change_deadline))
  : '')
// 期限依各校設定，文案不寫死小時數。
const deadlineRule = computed(() => changeDeadlineRule(visit.value?.change_deadline_hours))
// 面板實際顯示的條件。送出途中權限可能變了（例如送出改期時剛好過了異動截止），面板收起後
// 操作列要回來；原本操作列只看 showCancel／showReschedule，面板卻多看權限，兩邊都不顯示，
// 重新載入與返回都消失（2026-09-30 E2E）。
const cancelOpen = computed(() => showCancel.value && Boolean(visit.value?.can_cancel))
const rescheduleOpen = computed(() => showReschedule.value && Boolean(visit.value?.can_reschedule))
const editOpen = computed(() => showEdit.value && Boolean(visit.value?.can_edit))
const changeClosed = computed(() => visit.value && !visit.value.can_cancel && visit.value.status === 'confirmed')
const slotLabel = slotWhen
const campusPhone = computed(() => visitCampus.value?.phone || visit.value?.campus_phone || '')

useHead({
  title: '管理參觀預約｜常春藤幼兒園',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }]
})

let mounted = false
function consumeLink(initial = false) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (!initial && !token) return
  // fragment 只用來交換 HttpOnly session。用 router.replace 清掉：router 自己記著目前位置（含 token），
  // 只改瀏覽器網址的話，之後任何導覽寫進 history.state 的 back／current 還是帶著 token。
  if (window.location.hash) void router.replace({ path: route.path, query: route.query, hash: '' })
  showCancel.value = false
  showReschedule.value = false
  showEdit.value = false
  selectedDate.value = ''
  selectedSlotId.value = ''
  slotError.value = ''
  void initialize(token)
}
const onHashChange = () => consumeLink()
onMounted(() => {
  mounted = true
  window.addEventListener('hashchange', onHashChange)
  consumeLink(true)
})
watch(() => route.hash, () => { if (mounted) consumeLink() })
onBeforeUnmount(() => {
  mounted = false
  window.removeEventListener('hashchange', onHashChange)
  dispose()
})
watch(slots, () => {
  if (!slotCounts.value[selectedDate.value]) selectedDate.value = ''
  if (!slots.value.some(slot => slot.id === selectedSlotId.value)) selectedSlotId.value = ''
})
watch(selectedDate, () => { selectedSlotId.value = ''; slotError.value = '' })
const firstInput = (name: string) => rescheduleForm.value?.querySelector<HTMLInputElement>(`input[name="${name}"]`)

async function focusFeedback() {
  await nextTick()
  feedback.value?.focus()
}
async function openCancel() {
  showCancel.value = true
  showReschedule.value = false
  showEdit.value = false
  await nextTick()
  cancelPanel.value?.focus()
}
async function confirmCancel() {
  await cancelVisit()
  showCancel.value = false
  await focusFeedback()
}
async function openReschedule() {
  showReschedule.value = true
  showCancel.value = false
  showEdit.value = false
  await loadSlots()
  await nextTick()
  firstInput('visitDate')?.focus()
}
async function submitReschedule() {
  if (!selectedNewSlot.value) {
    slotError.value = selectedDate.value ? '請選擇這一天的場次。' : '請先在月曆選一天。'
    firstInput(selectedDate.value ? 'newSlotId' : 'visitDate')?.focus()
    return
  }
  slotError.value = ''
  const done = await reschedule(selectedSlotId.value)
  if (done) showReschedule.value = false
  await focusFeedback()
}

const editForm = reactive<EditForm>({ parentName: '', phone: '', email: '', childName: '', childBirthdate: '' })
let editBase: EditForm = { ...editForm }
const editErrors = ref<VisitErrors>({})
const editPanel = ref<HTMLElement | null>(null)

async function openEdit() {
  if (!visit.value) return
  editBase = editBaseFrom(visit.value)
  Object.assign(editForm, editBase)
  editErrors.value = {}
  showEdit.value = true
  showCancel.value = false
  showReschedule.value = false
  await nextTick()
  editPanel.value?.querySelector<HTMLElement>('input')?.focus()
}

async function submitEdit() {
  editErrors.value = validateEdit(visit.value!, editForm, editBase, taipeiDate())
  if (Object.keys(editErrors.value).length) {
    await nextTick()
    editPanel.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  const versionBefore = visit.value?.version
  const done = await updateDetails(editedChanges(visit.value!, editForm, editBase))
  if (done) showEdit.value = false
  else if (Object.keys(detailErrors.value).length) {
    editErrors.value = { ...detailErrors.value }
    await nextTick()
    editPanel.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  } else if (visit.value && visit.value.version !== versionBefore) {
    // 版本衝突：換成最新資料為底，保留家長自己改過的欄位，再次儲存不會把別人的修改改回去。
    const next = rebaseEdit(editForm, editBase, visit.value)
    editBase = next.base
    Object.assign(editForm, next.form)
  }
  await focusFeedback()
}
</script>

<template>
  <div>
    <SiteHeader v-if="data" :content="data.content" />
    <main id="main" class="parent-visit" tabindex="-1" data-cta-entry="visit_manage">
      <div class="parent-visit-shell">
        <NuxtLink class="text-link" to="/">回官網首頁</NuxtLink>
        <header class="parent-visit-heading">
          <p class="eyebrow">校園參觀</p>
          <h1>管理參觀預約</h1>
          <p>查看預約進度，或調整你的參觀安排。</p>
        </header>

        <p v-if="pending" class="parent-visit-card" role="status">正在讀取你的預約…</p>
        <div v-else class="parent-visit-card" :aria-busy="busy">
          <div ref="feedback" tabindex="-1">
            <p v-if="error" class="parent-visit-error" role="alert">{{ error }}</p>
            <p v-if="notice" class="parent-visit-notice" role="status">{{ notice }}</p>
          </div>
          <template v-if="visit">
            <div class="parent-visit-summary">
              <h2>{{ visitCampus?.name || '參觀預約' }}</h2>
              <strong class="parent-visit-status">{{ statusLabel }}</strong>
            </div>
            <dl class="parent-visit-details">
              <div><dt>{{ visit.status === 'cancelled' ? '原參觀場次' : '參觀場次' }}</dt><dd>{{ visit.slot ? slotLabel(visit.slot) : '尚未排定，請聯絡園所' }}</dd></div>
              <div v-if="visit.party_size"><dt>參觀人數</dt><dd>{{ visit.party_size }} 位</dd></div>
              <div><dt>家長稱呼</dt><dd>{{ visit.parent_name }}</dd></div>
              <div><dt>聯絡手機</dt><dd>{{ visit.phone }}</dd></div>
              <div v-if="visit.email"><dt>Email</dt><dd>{{ visit.email }}</dd></div>
              <div v-if="visit.child_name"><dt>孩子姓名</dt><dd>{{ visit.child_name }}</dd></div>
              <div v-if="visit.child_birthdate"><dt>出生年月日</dt><dd>{{ visit.child_birthdate }}</dd></div>
              <div v-if="visit.questions"><dt>想了解的事</dt><dd>{{ visit.questions }}</dd></div>
            </dl>
            <p v-if="visitCampus?.paused" class="parent-visit-notice">
              {{ visitCampus.name || '這所分校' }}目前暫停開放，暫不受理線上預約與改期。<template v-if="visitCampus.phone">如需協助，請來電 <a :data-campus-key="visitCampus.key" :href="`tel:${visitCampus.phone}`">{{ visitCampus.phone }}</a>。</template><template v-else>如需協助，請直接聯絡園所。</template>
            </p>
            <VisitCalendarActions v-if="calendarCampus && visit.slot" :campus="calendarCampus" :slot="visit.slot" :uid="`visit-${visit.id}@ivy-website`" />
            <p v-if="visit.can_edit && !visit.can_reschedule" class="parent-visit-muted">目前不開放線上改場次，要改時間請來電<template v-if="campusPhone"> <a :href="`tel:${campusPhone}`">{{ campusPhone }}</a></template><template v-else>聯絡園所</template>；資料修改與取消仍可在這裡進行。</p>
            <p v-if="changeClosed" class="parent-visit-muted">已超過線上修改時間{{ deadlineRule ? `（${deadlineRule}截止）` : '' }}。要更改請來電<template v-if="campusPhone"> <a :href="`tel:${campusPhone}`">{{ campusPhone }}</a></template><template v-else>聯絡園所</template>。</p>
            <p v-else-if="deadlineLabel && visit.can_cancel" class="parent-visit-muted">線上修改截止：{{ deadlineLabel }}（台灣時間）。</p>

            <div v-if="!cancelOpen && !rescheduleOpen && !editOpen" class="parent-visit-actions">
              <button v-if="visit.can_reschedule" type="button" class="button primary" :disabled="busy" @click="openReschedule">改場次</button>
              <button v-if="visit.can_edit" type="button" class="button outline" :disabled="busy" @click="openEdit">修改資料</button>
              <button v-if="visit.can_cancel" type="button" class="button outline" :disabled="busy" @click="openCancel">取消預約</button>
              <button v-if="visit.status !== 'cancelled'" type="button" class="button outline" :disabled="busy" @click="reload">重新載入預約</button>
              <NuxtLink v-if="visit.status === 'cancelled' && visitCampus?.listed" class="button primary" :to="`/visit/${visit.campus_key}`">重新預約</NuxtLink>
            </div>

            <section v-if="cancelOpen" ref="cancelPanel" class="parent-visit-confirm" tabindex="-1" aria-labelledby="parent-cancel-title">
              <h3 id="parent-cancel-title">確定要取消這次預約嗎？</h3>
              <p>取消後這個場次會釋出給其他家長，這條連結也會失效。</p>
              <div class="parent-visit-actions">
                <button class="button outline" type="button" :disabled="busy" @click="showCancel = false">保留預約</button>
                <button class="button primary" type="button" :disabled="busy" @click="confirmCancel">{{ busy ? '正在取消…' : '確認取消預約' }}</button>
              </div>
            </section>

            <form v-if="rescheduleOpen" ref="rescheduleForm" class="parent-visit-confirm parent-visit-reschedule" novalidate @submit.prevent="submitReschedule">
              <h3>選擇新的場次</h3>
              <p>按下確認就會改好，原本的場次會釋出。</p>
              <p v-if="slotsPending" role="status">正在讀取其他場次…</p>
              <div v-else-if="slotsError">
                <p class="parent-visit-error" role="alert">{{ slotsError }}</p>
                <button type="button" class="button outline" :disabled="busy" @click="loadSlots">重新載入場次</button>
              </div>
              <fieldset v-else-if="slots.length" class="parent-visit-pick" :disabled="busy">
                <VisitDatePicker v-model="selectedDate" :counts="slotCounts" :invalid="Boolean(slotError) && !selectedDate" describedby="parent-slot-error" />
                <fieldset v-if="selectedDate" class="parent-visit-slots" aria-describedby="parent-slot-error">
                  <legend>新的場次</legend>
                  <label v-for="slot in daySlots" :key="slot.id"><input v-model="selectedSlotId" type="radio" name="newSlotId" :value="slot.id" :aria-invalid="Boolean(slotError)" @change="slotError = ''"><span>{{ slotRange(slot) }}<small>尚可預約 {{ slot.remaining }} 組</small></span></label>
                </fieldset>
                <p v-if="selectedNewSlot" class="parent-visit-moving">改到 <strong><span>{{ shortDateLabel(selectedNewSlot.slot_date) }}</span> <span>{{ slotRange(selectedNewSlot) }}</span></strong></p>
                <p id="parent-slot-error" class="parent-visit-error" role="alert">{{ slotError }}</p>
              </fieldset>
              <p v-else role="status">目前沒有其他可選的場次，請直接聯絡園所。</p>
              <div class="parent-visit-actions">
                <button class="button primary" type="submit" :disabled="busy || slotsPending || Boolean(slotsError) || !slots.length">{{ busy ? '正在改…' : '確認改到這個場次' }}</button>
                <button class="button outline" type="button" :disabled="busy" @click="showReschedule = false">返回預約</button>
              </div>
            </form>

            <form v-if="editOpen" ref="editPanel" class="parent-visit-confirm parent-visit-edit" novalidate @submit.prevent="submitEdit">
              <h3>修改預約資料</h3>
              <div class="parent-visit-fields">
                <label>家長稱呼<input v-model="editForm.parentName" autocomplete="name" maxlength="40" :aria-invalid="Boolean(editErrors.parentName)"></label>
                <p class="parent-visit-error">{{ editErrors.parentName }}</p>
                <label>聯絡手機<input v-model="editForm.phone" type="tel" inputmode="tel" autocomplete="tel" :aria-invalid="Boolean(editErrors.phone)"></label>
                <p class="parent-visit-error">{{ editErrors.phone }}</p>
                <label>Email<input v-model="editForm.email" type="email" inputmode="email" autocomplete="email" maxlength="254" :aria-invalid="Boolean(editErrors.email)"></label>
                <p class="parent-visit-error">{{ editErrors.email }}</p>
                <label>孩子姓名<input v-model="editForm.childName" maxlength="64" :aria-invalid="Boolean(editErrors.childName)"></label>
                <p class="parent-visit-error">{{ editErrors.childName }}</p>
                <label>孩子出生年月日<input v-model="editForm.childBirthdate" type="date" :max="taipeiDate()" :aria-invalid="Boolean(editErrors.childBirthdate)"></label>
                <p class="parent-visit-error">{{ editErrors.childBirthdate }}</p>
              </div>
              <div class="parent-visit-actions">
                <button class="button primary" type="submit" :disabled="busy">{{ busy ? '正在儲存…' : '儲存修改' }}</button>
                <button class="button outline" type="button" :disabled="busy" @click="showEdit = false">返回預約</button>
              </div>
            </form>
          </template>
          <div v-else-if="!unavailable" class="parent-visit-actions">
            <button class="button primary" type="button" @click="reload">重新載入預約</button>
          </div>
        </div>

        <aside class="parent-visit-contact" aria-labelledby="parent-contact-title">
          <h2 id="parent-contact-title">需要園所協助？</h2>
          <p>若連結失效，或需要其他協助，請直接與園所聯繫。</p>
          <div class="parent-visit-actions">
            <template v-if="visitCampus">
              <a v-if="visitCampus.phone" class="text-link" :data-campus-key="visitCampus.key" :href="`tel:${visitCampus.phone}`">致電{{ visitCampus.name || '園所' }} {{ visitCampus.phone }}</a>
              <NuxtLink v-else class="text-link" to="/">返回官網查看園所聯絡方式</NuxtLink>
            </template>
            <template v-else>
              <a v-for="item in (data?.content.campuses || []).filter(c => c.phone)" :key="item.key" class="text-link" :href="`tel:${item.phone}`">致電{{ item.name }} {{ item.phone }}</a>
              <NuxtLink v-if="!data" class="text-link" to="/">返回官網查看園所聯絡方式</NuxtLink>
            </template>
          </div>
        </aside>
      </div>
    </main>
    <SiteFooter v-if="data" :content="data.content" />
  </div>
</template>

<style scoped>
.parent-visit { padding: 48px 0 80px; }
.parent-visit-shell { width: min(760px, calc(100% - 40px)); margin-inline: auto; }
.parent-visit h1, .parent-visit h2, .parent-visit h3 { font-family: var(--font); }
.parent-visit-heading { margin: 32px 0; }
.parent-visit-heading .eyebrow { margin-bottom: 8px; }
.parent-visit-heading h1 { font-size: clamp(1.7rem, 5vw, 2.5rem); margin-bottom: 12px; }
.parent-visit-heading > p:last-child, .parent-visit-muted { color: var(--muted); }
.parent-visit-card { padding: 32px; border: 1px solid var(--line); background: var(--white); border-radius: 12px; }
.parent-visit-summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.parent-visit-summary h2 { font-size: 1.375rem; }
.parent-visit-status { color: var(--green); background: var(--cream); padding: 4px 12px; border-radius: 4px; }
.parent-visit-details { margin: 24px 0; }
.parent-visit-details > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.parent-visit-details dt { color: var(--muted); }
.parent-visit-details dd { margin: 0; overflow-wrap: anywhere; }
.parent-visit-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.parent-visit-error { color: var(--error); }
.parent-visit-error:not(:empty), .parent-visit-notice { margin-bottom: 20px; }
.parent-visit-notice { padding: 16px; background: var(--cream); color: var(--green); border: 1px solid var(--line); border-radius: 4px; }
.parent-visit-notice a { text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.parent-visit-confirm { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--line); }
.parent-visit-confirm h3 { font-size: 1.2rem; margin-bottom: 12px; }
.parent-visit-confirm label { display: block; margin-top: 20px; }
/* 月曆（VisitDatePicker）讀預約頁的 --visit-* 色票；管理頁不在 .visit-page 裡，這裡補上。 */
.parent-visit-reschedule { --visit-ink: var(--green); --visit-muted: var(--muted); --visit-line: var(--line); --visit-surface: var(--white); --visit-soft: var(--cream); --visit-bg: var(--white); }
.parent-visit-pick { min-width: 0; margin: 20px 0 0; padding: 0; border: 0; }
.parent-visit-slots { min-width: 0; margin: 20px 0 0; padding: 0; border: 0; }
.parent-visit-slots legend { padding: 0; margin-bottom: 8px; font-weight: 600; }
.parent-visit-slots label { display: flex; align-items: center; gap: 12px; min-height: 56px; margin-top: 8px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
.parent-visit-slots label:has(input:checked) { border-color: var(--green); background: var(--cream); box-shadow: inset 0 0 0 1px var(--green); }
.parent-visit-slots input { flex-shrink: 0; width: 18px; height: 18px; margin: 0; accent-color: var(--green); }
.parent-visit-slots small { display: block; font-size: var(--fs-xs); color: var(--muted); }
.parent-visit-moving { margin-top: 16px; color: var(--muted); }
.parent-visit-moving strong { color: var(--green); }
.parent-visit-moving strong span { white-space: nowrap; }
.parent-visit-confirm select { display: block; width: 100%; min-width: 0; min-height: 48px; margin: 8px 0; padding: 10px; border: 1px solid var(--line); background: var(--paper); color: var(--text); border-radius: 4px; }
.parent-visit-confirm select[aria-invalid="true"] { border-color: var(--error); }
.parent-visit-contact { margin-top: 32px; }
.parent-visit-contact h2 { font-size: 1.125rem; margin-bottom: 8px; }
.parent-visit-contact .parent-visit-actions { margin-top: 12px; }
@media (max-width: 480px) {
  .parent-visit { padding-top: 24px; }
  .parent-visit-card { padding: 20px; }
  .parent-visit-details > div { grid-template-columns: 1fr; gap: 4px; }
  .parent-visit-actions .button { width: 100%; padding-inline: 16px; }
}
.parent-visit-fields{display:grid;gap:4px}
.parent-visit-fields label{display:grid;gap:6px}
.parent-visit-fields .parent-visit-error:empty{display:none}
</style>
