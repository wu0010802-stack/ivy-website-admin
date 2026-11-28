<script setup lang="ts">
// 用 LINE 接收參觀通知（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §4）。
// 家長按下去拿到一組一次性代碼，傳給官方帳號就完成綁定；之後的確認、提醒、改期、取消與停課通知會傳到他的 LINE。
// - 預約完成頁：帶 token（回應裡修改連結的那段），按下去才用它換家長 session（同點開修改連結）。
// - 修改頁：已經有 session，帶 check，一進來先查這筆預約能不能開、開了沒。
// 手機直接開 LINE 預填文字（LINE URL scheme 只支援手機）；桌機改列步驟與可複製的一句話。
// 預約當下用 LIFF 綁了 LINE（2026-11-28）：預約完成頁帶 initial（送單回應的 line_notify），一開始就是「已用 LINE 接收通知」。
// 已綁而還沒加官方帳號好友（friend === false）時，LINE 送不到通知：多一段提示與「加入好友」連結，每 4 秒查一次，加了就收掉。
// 預約頁的樣式是 VisitForm 的 scoped CSS，套不到這裡，樣式寫在本元件；顏色用全站 token。
const BASE = '/api/website/v1/public/visit-manage'
const POLL_MS = 4000
const POLL_LIMIT_MS = 30 * 60_000

interface NotifyState { available: boolean; linked: boolean; friend?: boolean | null; account_name?: string | null; basic_id?: string | null; add_friend_url?: string | null }
interface IssuedCode { code: string; expires_at: string; message_url: string; text: string; basic_id: string; account_name?: string | null; add_friend_url: string }

// visitId：畫面上的案件。同一個瀏覽器的分頁共用 session cookie，另一個分頁開了別筆預約後，這裡帶的 id 對不上
// 就會被後端拒絕（同其他家長端點，2026-11-16 審查），不會綁到或解除到另一筆。
const props = defineProps<{ token?: string | null; check?: boolean; visitId?: string | null; initial?: { linked: boolean; friend?: boolean | null; account_name?: string | null; add_friend_url?: string | null } | null }>()
const query = computed(() => props.visitId ? `?visit_request_id=${encodeURIComponent(props.visitId)}` : '')

const state = ref<NotifyState | null>(props.check
  ? null
  : { available: true, linked: Boolean(props.initial?.linked), ...(props.initial?.linked ? { friend: props.initial.friend ?? null, account_name: props.initial.account_name ?? null, add_friend_url: props.initial.add_friend_url ?? null } : {}) })
const issued = ref<IssuedCode | null>(null)
const busy = ref(false)
const failed = ref('')
const copied = ref(false)
const mobile = ref(false)
let exchanged = !props.token
let timer: ReturnType<typeof setInterval> | null = null
let pollUntil = 0

// 加好友連結只收 https，免得後端回了非預期的值就直接塞進 href。
const safeFriendUrl = computed(() => /^https:\/\//i.test(state.value?.add_friend_url ?? '') ? state.value?.add_friend_url : null)
const accountLabel = computed(() => state.value?.account_name || issued.value?.account_name || '')

async function readState(): Promise<NotifyState | null> {
  try {
    return await $fetch<NotifyState>(`${BASE}/line-notify${query.value}`)
  } catch {
    return null
  }
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = null
}

// done：這次輪詢要等的結果；成立就把畫面換成新狀態並停止。
function startPolling(done: (next: NotifyState) => boolean) {
  stopPolling()
  pollUntil = Date.now() + POLL_LIMIT_MS
  timer = setInterval(async () => {
    if (Date.now() > pollUntil) return stopPolling()
    if (document.visibilityState === 'hidden') return
    const next = await readState()
    if (next && done(next)) {
      state.value = next
      issued.value = null
      stopPolling()
      watchFriendship()
    }
  }, POLL_MS)
}

// 綁好了、或這筆預約已經不能開（例如被取消）。
const waitForLinked = (next: NotifyState) => next.linked || !next.available
// 加入好友了（friend 不再是 false），或已經不是綁定狀態、不能開。
const waitForFriend = (next: NotifyState) => next.friend !== false || !next.linked || !next.available

// 結果頁還沒換 session：查狀態、解除、取代碼都要先用修改連結的 token 換一次（同一頁只換一次）。
async function ensureSession() {
  if (exchanged || !props.token) return
  await $fetch(`${BASE}/exchange`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: props.token } })
  exchanged = true
}

// 已綁而 friend === false：先換 session，再每 4 秒查一次（30 分鐘上限），變成好友就把提示收掉。
async function watchFriendship() {
  if (!(state.value?.linked && state.value.friend === false)) return
  try {
    await ensureSession()
  } catch {
    return
  }
  startPolling(waitForFriend)
}

async function start() {
  if (busy.value) return
  busy.value = true
  failed.value = ''
  try {
    await ensureSession()
    issued.value = await $fetch<IssuedCode>(`${BASE}/line-notify/code${query.value}`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' } })
    copied.value = false
    startPolling(waitForLinked)
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode
    failed.value = status === 429 ? '操作太頻繁，請稍後再試。' : '目前無法開啟 LINE 通知，請稍後再試。'
  } finally {
    busy.value = false
  }
}

async function unlink() {
  if (busy.value) return
  busy.value = true
  failed.value = ''
  try {
    await ensureSession()
    await $fetch(`${BASE}/line-notify${query.value}`, { method: 'DELETE', headers: { 'X-Ivy-Parent': '1' } })
    stopPolling()
    state.value = { ...(state.value ?? { available: true }), linked: false, friend: null }
  } catch {
    failed.value = '沒有成功取消，請稍後再試。'
  } finally {
    busy.value = false
  }
}

async function copyText() {
  if (!issued.value) return
  try {
    await navigator.clipboard.writeText(issued.value.text)
    copied.value = true
  } catch {
    copied.value = false
  }
}

onMounted(async () => {
  mobile.value = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (props.check) state.value = await readState()
  void watchFriendship()
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <section v-if="state && (state.available || state.linked)" class="line-notify" aria-labelledby="line-notify-title">
    <template v-if="state.linked">
      <h3 id="line-notify-title" class="line-notify-title">已用 LINE 接收通知</h3>
      <p class="line-notify-text">參觀提醒、改期與取消通知會傳到{{ accountLabel ? `「${accountLabel}」` : '官方帳號' }}的聊天室。也可以在聊天室輸入「我的預約」查看預約。</p>
      <div v-if="state.friend === false" class="line-notify-friend" role="status">
        <p class="line-notify-text">還沒加入{{ accountLabel ? `「${accountLabel}」` : '官方帳號' }}好友，LINE 送不到通知。</p>
        <a v-if="safeFriendUrl" class="line-notify-button" :href="safeFriendUrl" target="_blank" rel="noopener">加入好友</a>
      </div>
      <button class="line-notify-quiet" type="button" :disabled="busy" @click="unlink">不再用 LINE 接收</button>
    </template>

    <template v-else-if="issued">
      <h3 id="line-notify-title" class="line-notify-title">傳送這句話，完成設定</h3>
      <template v-if="mobile">
        <a class="line-notify-button" :href="issued.message_url">開啟 LINE 傳送</a>
        <p class="line-notify-text">LINE 會帶出一句話，按下傳送就完成。還沒加{{ issued.account_name || issued.basic_id }}好友的話，請一併加入，才收得到通知。</p>
      </template>
      <ol v-else class="line-notify-steps">
        <li>用手機加入 <a :href="issued.add_friend_url" target="_blank" rel="noopener">{{ issued.account_name || issued.basic_id }}（{{ issued.basic_id }}）↗</a> 好友</li>
        <li>
          在聊天室傳送這句話：
          <span class="line-notify-code"><code>{{ issued.text }}</code><button class="line-notify-quiet" type="button" @click="copyText">{{ copied ? '已複製' : '複製' }}</button></span>
        </li>
      </ol>
      <p class="line-notify-muted" role="status">代碼 30 分鐘內有效，完成後這裡會自動更新。</p>
      <button class="line-notify-quiet" type="button" :disabled="busy" @click="start">代碼過期或傳錯了？重新取得</button>
    </template>

    <template v-else>
      <h3 id="line-notify-title" class="line-notify-title">用 LINE 接收參觀通知</h3>
      <p class="line-notify-text">參觀前的提醒、改期與取消通知，可以直接傳到您的 LINE。</p>
      <button class="line-notify-button" type="button" :disabled="busy" @click="start">用 LINE 接收通知</button>
    </template>
    <p v-if="failed" class="line-notify-error" role="alert">{{ failed }}</p>
  </section>
</template>

<style scoped>
.line-notify {display:grid;justify-items:start;gap:10px;margin:24px 0;padding:20px 22px;border:1px solid var(--line);border-radius:16px;background:var(--cream)}
.line-notify-title {margin:0;font-family:var(--font);font-size:var(--fs-md, 1.0625rem);font-weight:700;color:var(--green)}
.line-notify-friend {display:grid;justify-items:start;gap:10px}
.line-notify-text,.line-notify-muted,.line-notify-error {margin:0;max-width:40em;line-height:1.7}
.line-notify-muted {font-size:var(--fs-sm, .875rem);color:var(--muted)}
.line-notify-error {font-size:var(--fs-sm, .875rem);color:var(--error)}
.line-notify-button {display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 26px;border:1px solid var(--green);border-radius:999px;background:var(--green);color:var(--white);font:inherit;font-weight:500;letter-spacing:.04em;text-decoration:none;cursor:pointer;transition:opacity .2s}
.line-notify-button:disabled {cursor:wait;opacity:.6}
.line-notify-quiet {min-height:44px;padding:0 2px;border:0;background:none;color:var(--muted);font:inherit;font-size:var(--fs-sm, .875rem);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.line-notify-quiet:disabled {cursor:wait;opacity:.6}
.line-notify-steps {margin:0;padding-left:1.4em;display:grid;gap:8px;line-height:1.7}
.line-notify-steps a {color:var(--green)}
.line-notify-code {display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.line-notify-code code {padding:2px 8px;border-radius:6px;background:var(--white);overflow-wrap:anywhere}
@media(hover:hover) {
  .line-notify-button:hover:not(:disabled) {opacity:.88}
  .line-notify-quiet:hover:not(:disabled) {color:var(--green)}
}
@media(max-width:760px) {
  .line-notify {padding:16px 18px}
  .line-notify-button {width:100%}
}
</style>
