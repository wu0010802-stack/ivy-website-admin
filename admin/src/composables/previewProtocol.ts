import type { PreviewBlock, PreviewPage } from './previewTargets'

// 內容編輯頁右側即時預覽的訊息格式（2026-10-06 方向 D）。和官網 web/app/utils/preview-live.ts
// 是同一份：改一邊要改另一邊，previewProtocol.test.ts 會用語法樹讀官網那支比對（只認程式碼，
// 註解裡的值不算）。
//
// 安全：送出一律指定 targetOrigin（預覽來源），不用 '*'，來源不明就不送（sendDraftMessage）；
// 收回覆時要來源和視窗都對（readPreviewReply），格式用 parsePreviewReply 嚴格解析。

export const PREVIEW_PROTOCOL_VERSION = 1
export const PREVIEW_MESSAGE = {
  draft: 'ivy-preview:draft',
  ready: 'ivy-preview:ready',
  applied: 'ivy-preview:applied',
  denied: 'ivy-preview:denied',
} as const

/** 一則草稿最多多大（payload 轉成 JSON 的字元數）；和官網 MAX_DRAFT_CHARS 同值，超過官網也不會套用。 */
export const PREVIEW_MAX_DRAFT_CHARS = 1_000_000

export interface PreviewFocus {
  block: PreviewBlock
  /** 首頁五校用來切到那一校 */
  campusKey: string | null
  /** 改到的那段文字（previewProbe.probeText），預覽頁用它找位置 */
  probe: string | null
  /** false＝改到的欄位不在這一塊，預覽不框不捲 */
  mark: boolean
}

export interface PreviewDraftMessage {
  type: typeof PREVIEW_MESSAGE.draft
  v: typeof PREVIEW_PROTOCOL_VERSION
  seq: number
  kind: string
  campusKey: string | null
  payload: Record<string, unknown>
  page: PreviewPage
  focus: PreviewFocus
}

export const PREVIEW_HITS = ['text', 'block', 'none', 'failed'] as const // failed＝這一則即時草稿畫不出來（和 none 分開）
export type PreviewHit = (typeof PREVIEW_HITS)[number]
export type PreviewReply =
  | { type: typeof PREVIEW_MESSAGE.ready }
  | { type: typeof PREVIEW_MESSAGE.denied }
  | { type: typeof PREVIEW_MESSAGE.applied; seq: number; hit: PreviewHit }

/**
 * 建一則草稿訊息。payload 只轉一次 JSON：表單是 Vue 的 reactive proxy，postMessage 的 structured clone
 * 傳不過去（DataCloneError），而且官網只收純 JSON。轉出來超過 PREVIEW_MAX_DRAFT_CHARS、或轉不成 JSON
 * （循環參照、BigInt）就回 null：呼叫端不要送，官網那邊收了也會丟掉。
 */
export function buildDraftMessage(input: Omit<PreviewDraftMessage, 'type' | 'v'>): PreviewDraftMessage | null {
  let payload: unknown
  try {
    const json: string | undefined = JSON.stringify(input.payload)
    if (typeof json !== 'string' || json.length > PREVIEW_MAX_DRAFT_CHARS) return null
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (!isPlainObject(payload)) return null
  const { focus } = input
  return {
    type: PREVIEW_MESSAGE.draft,
    v: PREVIEW_PROTOCOL_VERSION,
    seq: input.seq,
    kind: input.kind,
    campusKey: input.campusKey,
    payload,
    page: input.page,
    focus: { block: focus.block, campusKey: focus.campusKey, probe: focus.probe, mark: focus.mark },
  }
}

/** 預覽來源要是真的 origin（scheme://host[:port]，不帶路徑）：擋掉空字串、'*'、'null'。 */
function isConcreteOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false
  try {
    return new URL(origin).origin === origin
  } catch {
    return false
  }
}

/** 一般物件：原型是 null 或 Object.prototype（postMessage 收到的資料就是這種）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

/**
 * 把草稿送進預覽 iframe。targetOrigin 一定是呼叫端給的預覽來源；來源不明（空字串、'*'、'null'、
 * 帶路徑）或沒有視窗就不送，回 false，絕不退成 '*'。
 */
export function sendDraftMessage(
  frameWindow: { postMessage(message: unknown, targetOrigin: string): void } | null | undefined,
  origin: string,
  message: PreviewDraftMessage,
): boolean {
  if (!frameWindow || !isConcreteOrigin(origin)) return false
  frameWindow.postMessage(message, origin)
  return true
}

/**
 * 收預覽頁的回覆：來源要等於預覽來源、訊息要來自目前這個 iframe 的視窗（上一個 iframe 或別的視窗不算），
 * 都對才解析內容。沒有目前的 iframe 時一律不收（避免 source 與 frameWindow 同為 null 湊巧相等）。
 */
export function readPreviewReply(
  event: { origin: string; source: unknown; data: unknown },
  expected: { origin: string; frameWindow: unknown },
): PreviewReply | null {
  if (!isConcreteOrigin(expected.origin) || event.origin !== expected.origin) return null
  if (expected.frameWindow == null || event.source !== expected.frameWindow) return null
  return parsePreviewReply(event.data)
}

function own(message: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(message, key) ? message[key] : undefined
}

/** 嚴格解析預覽頁的回覆：欄位要是物件自己的、type 與 hit 要是認得的、seq 要是安全的正整數；多的欄位不帶出去。 */
export function parsePreviewReply(data: unknown): PreviewReply | null {
  if (!isPlainObject(data)) return null
  const type = own(data, 'type')
  if (own(data, 'v') !== PREVIEW_PROTOCOL_VERSION) return null
  if (type === PREVIEW_MESSAGE.ready || type === PREVIEW_MESSAGE.denied) return { type }
  if (type !== PREVIEW_MESSAGE.applied) return null
  const seq = own(data, 'seq')
  const hit = own(data, 'hit')
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null
  if (typeof hit !== 'string' || !(PREVIEW_HITS as readonly string[]).includes(hit)) return null
  return { type, seq, hit: hit as PreviewHit }
}
