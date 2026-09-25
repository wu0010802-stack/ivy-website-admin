<script setup lang="ts">
import { useParentVisit } from '~/composables/useParentVisit'
import { changeDeadlineRule, visitDateLabel } from '~/utils/visit-form'

const { data } = await usePublishedSite()
const route = useRoute()
const {
  visit, pending, busy, unavailable, error, notice, slots, slotsPending, slotsError, reschedulePending,
  initialize, reload, loadSlots, cancelVisit, requestReschedule, dispose
} = useParentVisit()
const showCancel = ref(false)
const showReschedule = ref(false)
const selectedSlotId = ref('')
const slotError = ref('')
const feedback = ref<HTMLElement | null>(null)
const cancelPanel = ref<HTMLElement | null>(null)
const slotSelect = ref<HTMLSelectElement | null>(null)
const campus = computed(() => data.value?.content.campuses.find(item => item.key === visit.value?.campus_key))
const statusLabels: Record<string, string> = {
  new: '已收到需求', contacting: '園所聯繫中', pending_confirmation: '待園方確認',
  confirmed: '預約成立', cancelled: '預約已取消', completed: '已完成參觀', no_show: '未完成參觀'
}
const statusLabel = computed(() => statusLabels[visit.value?.status || ''] || '請聯絡園所確認')
const deadlineLabel = computed(() => visit.value?.change_deadline
  ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(visit.value.change_deadline))
  : '')
// 期限依各校設定，文案不寫死小時數。
const deadlineRule = computed(() => changeDeadlineRule(visit.value?.change_deadline_hours))
const changeClosed = computed(() => visit.value && !visit.value.can_cancel && ['new', 'contacting', 'pending_confirmation', 'confirmed'].includes(visit.value.status))
const slotLabel = (slot: { slot_date: string; start_time: string; end_time: string }) => `${visitDateLabel(slot.slot_date)} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`

useHead({
  title: '管理參觀預約｜常春藤幼兒園',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }]
})

let mounted = false
function consumeLink(initial = false) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (!initial && !token) return
  // 保留 Router 的 history state；fragment 只用來交換 HttpOnly session。
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  showCancel.value = false
  showReschedule.value = false
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
watch(slots, () => { if (!slots.value.some(slot => slot.id === selectedSlotId.value)) selectedSlotId.value = '' })

async function focusFeedback() {
  await nextTick()
  feedback.value?.focus()
}
async function openCancel() {
  showCancel.value = true
  showReschedule.value = false
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
  await loadSlots()
  await nextTick()
  slotSelect.value?.focus()
}
async function submitReschedule() {
  if (!slots.value.some(slot => slot.id === selectedSlotId.value)) {
    slotError.value = '請選擇希望改期的場次。'
    slotSelect.value?.focus()
    return
  }
  slotError.value = ''
  await requestReschedule(selectedSlotId.value)
  if (reschedulePending.value) showReschedule.value = false
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
              <h2>{{ campus?.name || '參觀預約' }}</h2>
              <strong class="parent-visit-status">{{ statusLabel }}</strong>
            </div>
            <dl class="parent-visit-details">
              <div><dt>聯絡手機</dt><dd>{{ visit.phone_masked }}</dd></div>
              <div><dt>{{ visit.status === 'cancelled' ? '原參觀時段' : '參觀時段' }}</dt><dd>{{ visit.slot ? slotLabel(visit.slot) : '待園所與你聯繫確認' }}</dd></div>
            </dl>
            <p v-if="visit.status === 'pending_confirmation'" class="parent-visit-muted">這個時段尚待園方確認，預約還未成立。</p>
            <p v-else-if="visit.status === 'new' || visit.status === 'contacting'" class="parent-visit-muted">園所會與你聯繫，確認合適的參觀時間。</p>
            <p v-if="changeClosed" class="parent-visit-muted">已超過線上異動時間。如需取消或改期，請直接聯絡園所。</p>
            <p v-else-if="deadlineLabel && visit.can_cancel" class="parent-visit-muted">線上異動截止：{{ deadlineLabel }}（台灣時間{{ deadlineRule ? `，${deadlineRule}` : '' }}）。</p>

            <div v-if="!showCancel && !showReschedule" class="parent-visit-actions">
              <button v-if="visit.can_reschedule && !reschedulePending" type="button" class="button primary" :disabled="busy" @click="openReschedule">申請改期</button>
              <button v-if="visit.can_cancel" type="button" class="button outline" :disabled="busy" @click="openCancel">取消預約</button>
              <button v-if="visit.status !== 'cancelled'" type="button" class="button outline" :disabled="busy" @click="reload">重新載入預約</button>
              <NuxtLink v-if="visit.status === 'cancelled'" class="button primary" :to="`/visit/${visit.campus_key}`">重新預約</NuxtLink>
            </div>

            <section v-if="showCancel && visit.can_cancel" ref="cancelPanel" class="parent-visit-confirm" tabindex="-1" aria-labelledby="parent-cancel-title">
              <h3 id="parent-cancel-title">確定要取消這次預約嗎？</h3>
              <p>取消後會釋出原時段；如需再次參觀，請重新預約。</p>
              <div class="parent-visit-actions">
                <button class="button outline" type="button" :disabled="busy" @click="showCancel = false">保留預約</button>
                <button class="button primary" type="button" :disabled="busy" @click="confirmCancel">{{ busy ? '正在取消…' : '確認取消預約' }}</button>
              </div>
            </section>

            <form v-if="showReschedule && visit.can_reschedule && !reschedulePending" class="parent-visit-confirm" @submit.prevent="submitReschedule">
              <h3>申請其他參觀時段</h3>
              <p>改期需由園所確認，核准前原時段仍保留。</p>
              <p v-if="slotsPending" role="status">正在讀取其他場次…</p>
              <div v-else-if="slotsError">
                <p class="parent-visit-error" role="alert">{{ slotsError }}</p>
                <button type="button" class="button outline" :disabled="busy" @click="loadSlots">重新載入場次</button>
              </div>
              <template v-else-if="slots.length">
                <label for="parent-new-slot">希望改期的場次</label>
                <select id="parent-new-slot" ref="slotSelect" v-model="selectedSlotId" :disabled="busy" :aria-invalid="Boolean(slotError)" aria-describedby="parent-slot-error" @change="slotError = ''">
                  <option value="">請選擇場次</option>
                  <option v-for="slot in slots" :key="slot.id" :value="slot.id">{{ slotLabel(slot) }}</option>
                </select>
                <p id="parent-slot-error" class="parent-visit-error" role="alert">{{ slotError }}</p>
              </template>
              <p v-else role="status">目前沒有其他可申請的場次，請直接聯絡園所。</p>
              <div class="parent-visit-actions">
                <button class="button primary" type="submit" :disabled="busy || slotsPending || Boolean(slotsError) || !slots.length">{{ busy ? '正在送出…' : '送出改期申請' }}</button>
                <button class="button outline" type="button" :disabled="busy" @click="showReschedule = false">返回預約</button>
              </div>
            </form>
          </template>
          <div v-else-if="!unavailable" class="parent-visit-actions">
            <button class="button primary" type="button" @click="reload">重新載入預約</button>
          </div>
        </div>

        <aside class="parent-visit-contact" aria-labelledby="parent-contact-title">
          <h2 id="parent-contact-title">需要園所協助？</h2>
          <p>若連結失效，或需要更改聯絡資料，請直接與園所聯繫。</p>
          <div class="parent-visit-actions">
            <NuxtLink v-if="campus" class="text-link" :to="`/campuses/${campus.key}`">聯絡{{ campus.name }}</NuxtLink>
            <template v-else>
              <NuxtLink v-for="item in data?.content.campuses || []" :key="item.key" class="text-link" :to="`/campuses/${item.key}`">{{ item.name }}</NuxtLink>
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
.parent-visit-notice { padding: 16px; background: var(--cream); color: var(--green); border-left: 3px solid var(--leaf); }
.parent-visit-confirm { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--line); }
.parent-visit-confirm h3 { font-size: 1.2rem; margin-bottom: 12px; }
.parent-visit-confirm label { display: block; margin-top: 20px; }
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
</style>
