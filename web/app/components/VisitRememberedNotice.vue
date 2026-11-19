<script setup lang="ts">
import { VISIT_REMEMBERED_HINT } from '~/utils/visit-remembered'
import { shortDateLabel } from '~/utils/visit-month'
import { slotRange } from '~/utils/visit-session'

// 這台裝置記住的預約（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §3）：送單成立時後端把修改連結的
// token 放進 HttpOnly cookie（backend/app/booking/remember.py）。沒留 Email 的家長關掉結果頁後，回到預約頁還能
// 從這裡修改或取消。只顯示日期、場次與校區；共用裝置的人要看姓名電話得按進去（換的是 2 小時的家長 session）。
// cookie 前端讀不到：plugins/visit-remembered.server.ts 在伺服器渲染時記下請求有沒有帶它，沒帶就完全不打 API；
// 這次造訪剛預約成功（VisitForm 送單成功）也會設成有。
const API = '/api/website/v1/public/visit-remembered'

interface RememberedVisit { campus_key: string; campus_name: string; slot_date: string; start_time: string; end_time: string }

const props = defineProps<{ campusName?: (key: string) => string | undefined }>()
const hinted = useState(VISIT_REMEMBERED_HINT, () => false)
const visit = ref<RememberedVisit | null>(null)
const busy = ref(false)
const failed = ref(false)

// 和結果頁同一種寫法：「11 月 24 日（週二） 上午場 10:00–11:00」。
const when = computed(() => visit.value ? `${shortDateLabel(visit.value.slot_date)} ${slotRange(visit.value)}` : '')
const name = computed(() => visit.value ? props.campusName?.(visit.value.campus_key) ?? visit.value.campus_name : '')

function isVisit(value: unknown): value is RememberedVisit {
  return Boolean(value && typeof value === 'object' && typeof (value as RememberedVisit).slot_date === 'string')
}

onMounted(async () => {
  if (!hinted.value) return
  try {
    const result = await $fetch<unknown>(API, { headers: { 'X-Ivy-Parent': '1' } })
    visit.value = isVisit(result) ? result : null
    // 已失效（後端回 204 並清掉 cookie）：這次造訪之後不再查。
    if (!visit.value) hinted.value = false
  } catch {
    visit.value = null
  }
})

async function open() {
  busy.value = true
  failed.value = false
  try {
    await $fetch(`${API}/open`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' } })
    // 整頁導覽（同結果頁的修改連結）：管理頁沒有 hash 時用剛換到的 session 載入。
    window.location.assign('/visit/manage')
  } catch {
    busy.value = false
    failed.value = true
    visit.value = null
  }
}

async function forget() {
  busy.value = true
  try { await $fetch(API, { method: 'DELETE', headers: { 'X-Ivy-Parent': '1' } }) } catch { /* 清不掉也先收起來，下次進來再試 */ }
  visit.value = null
  hinted.value = false
  busy.value = false
}
</script>

<template>
  <div v-if="visit" class="visit-remembered" role="status">
    <p class="visit-remembered-text"><span>您已預約{{ name }}參觀</span><strong>{{ when }}</strong></p>
    <div class="visit-remembered-actions">
      <button class="visit-remembered-open" type="button" :disabled="busy" @click="open">修改或取消預約</button>
      <button class="visit-remembered-forget" type="button" :disabled="busy" @click="forget">不是我的預約</button>
    </div>
  </div>
  <p v-else-if="failed" class="visit-remembered-failed" role="status">這筆預約的連結已失效，請直接來電洽詢園所</p>
</template>

<style scoped>
/* 預約頁的樣式檔是 VisitForm 的 scoped CSS，套不到這個子元件裡面，所以樣式寫在這裡；顏色沿用 .visit-page 定義的
   --visit-* 變數（自訂屬性照 DOM 繼承）。主按鈕的尺寸、圓角對齊預約頁的 .visit-page .button。 */
.visit-remembered {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px 24px;margin:0 0 28px;padding:18px 22px;border:1px solid var(--visit-line);border-radius:16px;background:var(--visit-soft);color:var(--visit-ink)}
.visit-remembered-text {display:grid;gap:2px;max-width:none}
.visit-remembered-text>span {font-size:var(--fs-sm);color:var(--visit-muted)}
.visit-remembered-text strong {font-size:var(--fs-md);font-weight:600;line-height:1.6}
.visit-remembered-actions {display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}
.visit-remembered-open {display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 26px;border:1px solid var(--visit-cta-bg);border-radius:999px;background:var(--visit-cta-bg);color:var(--visit-cta-fg);font:inherit;font-size:var(--fs-md);font-weight:500;letter-spacing:.04em;line-height:1.5;transition:background-color .2s,border-color .2s,color .2s}
.visit-remembered-forget {min-height:44px;padding:0 2px;border:0;background:none;color:var(--visit-muted);font:inherit;font-size:var(--fs-sm);text-decoration:underline;text-underline-offset:3px}
.visit-remembered-open:disabled,.visit-remembered-forget:disabled {cursor:wait;opacity:.6}
.visit-remembered-failed {margin:0 0 24px;font-size:var(--fs-sm);color:var(--visit-muted)}
@media(hover:hover) {
  .visit-remembered-open:hover:not(:disabled) {background:var(--visit-cta-hover-bg);border-color:var(--visit-cta-hover-bg);color:var(--visit-cta-hover-fg)}
  .visit-remembered-forget:hover:not(:disabled) {color:var(--visit-ink)}
}
@media(max-width:760px) {
  .visit-remembered {padding:16px 18px}
  .visit-remembered-actions {width:100%}
  .visit-remembered-open {flex:1 1 auto}
}
</style>
