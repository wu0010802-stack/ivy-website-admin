import { computed, effectScope, onBeforeUnmount, ref, watch, type EffectScope, type Ref } from 'vue'
import { buildDraftMessage, PREVIEW_MESSAGE, readPreviewReply, sendDraftMessage } from './previewProtocol'
import { lastEdit, probeText } from './previewProbe'
import type { PreviewNotice, PreviewPaneState, PreviewTarget } from './previewTargets'

// 內容編輯頁右側的即時預覽（2026-10-06 方向 D）：等預覽頁說 ready，之後把「還沒存的表單」
// debounce 300ms 送進 iframe；換預覽分頁立刻送。只理同源、而且是目前這個 iframe 的回覆。
// 20 秒沒有 ready（官網還是舊版、太慢、請求失敗）就當成只看得到已存草稿；預覽頁拒絕（沒登入）是 denied。
//
// 訊息怎麼建、怎麼送、怎麼收都在 previewProtocol：這裡不手寫 postMessage、也不自己解析回覆。
// 預覽欄沒顯示（enabled＝false：1280 以下、不同源、沒有預覽頁）時什麼都不掛，表單再大也不會被 watch。

export const LIVE_PREVIEW_DEBOUNCE_MS = 300
export const LIVE_PREVIEW_READY_TIMEOUT_MS = 20_000

interface FrameLike {
  contentWindow: Pick<Window, 'postMessage'> | null
}

export interface LivePreviewOptions {
  frame: Readonly<Ref<FrameLike | null>>
  /** 預覽來源（previewTargets.livePreviewOrigin）；空字串或不是真的 origin＝不送、不收 */
  origin: string
  kind: string
  campusKey: Readonly<Ref<string | null>>
  form: Readonly<Ref<unknown>>
  target: Readonly<Ref<PreviewTarget | null>>
  /** 預覽欄真的有顯示。沒有的話不掛 message listener、不 watch 表單、不開計時器。 */
  enabled: Readonly<Ref<boolean>>
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  debounceMs?: number
  readyTimeoutMs?: number
}

export function useLivePreview(options: LivePreviewOptions) {
  const win = options.win ?? window
  const state = ref<PreviewPaneState>('connecting')
  const appliedSeq = ref(0)
  // 狀態列要多說的兩件事。「畫不出這個修改」是預覽頁的回覆（applied.hit＝failed）；
  // 「太大」是這邊送不出去。兩者都不是連線狀態，所以不放在 state（denied 專指預覽頁拒絕）。
  const renderFailed = ref(false)
  const tooLarge = ref(false)
  const notice = computed<PreviewNotice | null>(() => (tooLarge.value ? 'too-large' : renderFailed.value ? 'render-failed' : null))

  let ready = false
  let seq = 0
  // 收到過的最大回覆 seq（含 failed）：比它舊的回覆不能改說明
  let repliedSeq = 0
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  // 上一次送出的表單：用來算這次改到哪裡。iframe 重建時清掉。
  let lastPayload: Record<string, unknown> | null = null
  let lastKey: string | null = null
  let lastProbe: string | null = null

  function clearSend() {
    if (sendTimer) clearTimeout(sendTimer)
    sendTimer = null
  }
  function clearReady() {
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
  }

  function send() {
    clearSend()
    const target = options.target.value
    const frameWindow = options.frame.value?.contentWindow
    const form = options.form.value
    // 表單還沒載入（不是物件）就沒有東西可送，不當成太大。
    if (!ready || !target || !frameWindow || !options.origin || form === null || typeof form !== 'object') return
    const campusKey = options.campusKey.value
    const nextSeq = seq + 1
    // payload 在這裡才 JSON 複製（一次）。focus 先放預設，下面用複製出來的純物件算好再換。
    const message = buildDraftMessage({
      seq: nextSeq,
      kind: options.kind,
      campusKey,
      payload: form as Record<string, unknown>,
      page: target.page,
      focus: { block: target.block, campusKey, probe: null, mark: true },
    })
    if (!message) {
      // 超過上限或轉不成 JSON：不送，預覽停在上一個畫面；說明寫在狀態列，狀態當成 saved。
      tooLarge.value = true
      state.value = 'saved'
      return
    }
    const edit = lastEdit(lastPayload, message.payload)
    const key = edit ? edit.key : lastKey
    const probe = edit ? (edit.text === null ? null : probeText(edit.text)) : lastProbe
    // 分頁有 fields 時，改到不在這一塊的欄位就不框不捲（例如網站描述只用在搜尋結果）。
    const inTarget = !target.fields || key === null || target.fields.includes(key)
    message.focus = { block: target.block, campusKey, probe: inTarget ? probe : null, mark: inTarget }
    if (!sendDraftMessage(frameWindow, options.origin, message)) return
    seq = nextSeq
    lastPayload = message.payload
    lastKey = key
    lastProbe = probe
    if (tooLarge.value) {
      tooLarge.value = false
      state.value = 'live'
    }
  }

  function schedule() {
    clearSend()
    if (!ready) return
    sendTimer = setTimeout(send, options.debounceMs ?? LIVE_PREVIEW_DEBOUNCE_MS)
  }

  function reset() {
    ready = false
    state.value = 'connecting'
    appliedSeq.value = 0
    repliedSeq = 0
    renderFailed.value = false
    tooLarge.value = false
    lastPayload = null
    lastKey = null
    lastProbe = null
    clearSend()
    clearReady()
  }

  // iframe（重新）建立：等預覽頁說 ready；太久沒回就當成只看得到已存草稿。
  function connect() {
    reset()
    readyTimer = setTimeout(() => {
      readyTimer = null
      if (!ready && state.value === 'connecting') state.value = 'saved'
    }, options.readyTimeoutMs ?? LIVE_PREVIEW_READY_TIMEOUT_MS)
  }

  function onMessage(event: Event) {
    const { origin, source, data } = event as MessageEvent
    const reply = readPreviewReply({ origin, source, data }, { origin: options.origin, frameWindow: options.frame.value?.contentWindow })
    if (!reply) return
    if (reply.type === PREVIEW_MESSAGE.ready) {
      clearReady()
      ready = true
      state.value = 'live'
      send()
    } else if (reply.type === PREVIEW_MESSAGE.applied) {
      // 畫不出來的不算已套用：appliedSeq 只記畫得出來的最大 seq。
      if (reply.hit !== 'failed') appliedSeq.value = Math.max(appliedSeq.value, reply.seq)
      if (reply.seq >= repliedSeq) {
        repliedSeq = reply.seq
        renderFailed.value = reply.hit === 'failed'
      }
    } else {
      clearReady()
      ready = false
      state.value = 'denied'
    }
  }

  let scope: EffectScope | null = null
  function start() {
    if (scope) return
    scope = effectScope(true)
    win.addEventListener('message', onMessage)
    scope.run(() => {
      watch(
        options.frame,
        (frame) => {
          if (frame) connect()
          else reset()
        },
        { immediate: true },
      )
      watch(options.form, schedule, { deep: true })
      watch(() => options.target.value?.id ?? null, send)
    })
  }
  function stop() {
    if (!scope) return
    scope.stop()
    scope = null
    win.removeEventListener('message', onMessage)
    reset()
  }

  watch(options.enabled, (on) => (on ? start() : stop()), { immediate: true })
  onBeforeUnmount(stop)

  return { state, appliedSeq, notice }
}
