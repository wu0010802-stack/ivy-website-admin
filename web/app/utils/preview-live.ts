import type { ContentOverlay } from './content-overlay'
import type { PreviewPage } from './draft-preview'

// 後台內容編輯頁右側的即時預覽（2026-10-06 方向 D）：後台把「還沒存的表單內容」用 postMessage
// 傳進 /preview?embed=1&live=1 的 iframe。這支只放訊息格式、驗證與套用（純函式）。
// admin/src/composables/previewProtocol.ts 是同一份格式：改一邊要改另一邊（admin 的
// previewProtocol.test.ts 會讀這個檔比對訊息名稱、版本、內容種類與區塊）。
//
// 安全：只收同源、而且是外層後台頁（window.parent）送來的訊息；草稿只放在記憶體，
// 不寫進網址、storage 或任何快取；不認得的種類、校區、區塊一律丟掉。

export const PREVIEW_PROTOCOL_VERSION = 1
export const PREVIEW_MESSAGE = {
  draft: 'ivy-preview:draft',
  ready: 'ivy-preview:ready',
  applied: 'ivy-preview:applied',
  denied: 'ivy-preview:denied'
} as const

/** 一則草稿最多多大（JSON 字元數）；超過就不套用。 */
export const MAX_DRAFT_CHARS = 1_000_000
/** 用來找位置的那段文字最多幾個字。 */
export const MAX_PROBE_CHARS = 80

export const SHARED_LIVE_KINDS = [
  'home_about',
  'home_hero',
  'site_footer',
  'site_meta',
  'home_campus_board',
  'booking_content',
  'day_experience',
  'home_news',
  'admission_content',
  'privacy_policy',
  'curriculum_page',
  'about_page'
] as const
export const CAMPUS_LIVE_KINDS = ['campus_profile', 'campus_tour', 'campus_news'] as const
export type LiveKind = (typeof SHARED_LIVE_KINDS)[number] | (typeof CAMPUS_LIVE_KINDS)[number]

export type PreviewBlock =
  | 'home-hero'
  | 'home-about'
  | 'home-day'
  | 'home-campuses'
  | 'home-news'
  | 'site-header'
  | 'site-footer'
  | 'visit-booking'
  | 'page-top'

export interface PreviewBlockSpec {
  selector: string
  /** 找不到改到的文字時，要不要框整塊（整頁內容就不框） */
  outline: boolean
  /** 首頁五校：先切到改的那一校 */
  campusTab?: boolean
}

export const PREVIEW_BLOCKS: Readonly<Record<PreviewBlock, PreviewBlockSpec>> = {
  'home-hero': { selector: '.studio-hero', outline: true },
  'home-about': { selector: '.home-belief', outline: true },
  'home-day': { selector: '.day-experience', outline: true },
  'home-campuses': { selector: '#campuses', outline: true, campusTab: true },
  'home-news': { selector: '.home-news', outline: true },
  'site-header': { selector: 'header.header', outline: true },
  'site-footer': { selector: 'footer.footer', outline: true },
  'visit-booking': { selector: '.booking-draft', outline: true },
  'page-top': { selector: '#main', outline: false }
}

const PAGES: readonly PreviewPage[] = ['home', 'admission', 'visit', 'privacy', 'curriculum', 'about', 'environment']

export interface LiveFocus {
  block: PreviewBlock
  campusKey: string | null
  probe: string | null
  mark: boolean
}

export interface LiveDraft {
  seq: number
  kind: LiveKind
  campusKey: string | null
  payload: Record<string, unknown>
  page: PreviewPage
  focus: LiveFocus
}

export type LiveOverride = Pick<LiveDraft, 'kind' | 'campusKey' | 'payload'>
export type PreviewHit = 'text' | 'block' | 'none'

export interface PreviewWindow {
  location: { origin: string }
  parent: unknown
}

/** 一般物件：原型是 null 或最上層的 Object.prototype（Map、Date、類別實例都不算）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

function isCampusKind(kind: unknown): boolean {
  return (CAMPUS_LIVE_KINDS as readonly unknown[]).includes(kind)
}

export function parseDraftMessage(data: unknown, campusKeys: readonly string[]): LiveDraft | null {
  if (!isPlainObject(data) || data.type !== PREVIEW_MESSAGE.draft || data.v !== PREVIEW_PROTOCOL_VERSION) return null
  const { seq, kind, campusKey, payload, page, focus } = data
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null
  const shared = (SHARED_LIVE_KINDS as readonly unknown[]).includes(kind)
  const perCampus = isCampusKind(kind)
  if (!shared && !perCampus) return null
  if (shared && campusKey !== null) return null
  if (perCampus && (typeof campusKey !== 'string' || !campusKeys.includes(campusKey))) return null
  if (!isPlainObject(payload)) return null
  let size: number
  try {
    size = JSON.stringify(payload).length
  } catch {
    return null
  }
  if (size > MAX_DRAFT_CHARS) return null
  if (typeof page !== 'string' || !(PAGES as readonly string[]).includes(page)) return null
  if (!isPlainObject(focus) || typeof focus.block !== 'string') return null
  // hasOwnProperty：擋掉 toString、constructor 這類原型上的鍵。
  if (!Object.prototype.hasOwnProperty.call(PREVIEW_BLOCKS, focus.block)) return null
  const focusCampus = focus.campusKey
  if (focusCampus !== null && focusCampus !== undefined && (typeof focusCampus !== 'string' || !campusKeys.includes(focusCampus))) return null
  const probe = typeof focus.probe === 'string' && focus.probe.trim() ? focus.probe.slice(0, MAX_PROBE_CHARS) : null
  return {
    seq,
    kind: kind as LiveKind,
    campusKey: perCampus ? (campusKey as string) : null,
    payload,
    page: page as PreviewPage,
    focus: { block: focus.block as PreviewBlock, campusKey: (focusCampus as string | null | undefined) ?? null, probe, mark: focus.mark !== false }
  }
}

/** 只收同源、而且是外層後台頁送來的；頂層直接打開（parent 就是自己）的一律不收。 */
export function isTrustedPreviewEvent(event: { origin: string; source: unknown }, self: PreviewWindow): boolean {
  return self.parent != null && self.parent !== self && event.source === self.parent && event.origin === self.location.origin
}

/** 只蓋掉這一項內容；分校內容只換那一校。不改傳進來的 overlay。 */
export function applyLiveDraft(overlay: ContentOverlay, draft: LiveOverride): ContentOverlay {
  const next = { ...overlay } as Record<string, unknown>
  if (isCampusKind(draft.kind) && draft.campusKey) {
    const current = (overlay as Record<string, Record<string, unknown> | null | undefined>)[draft.kind] ?? {}
    next[draft.kind] = { ...current, [draft.campusKey]: draft.payload }
  } else {
    next[draft.kind] = draft.payload
  }
  return next as ContentOverlay
}

export function createLiveReceiver(options: { self: PreviewWindow; campusKeys: readonly string[]; onDraft: (draft: LiveDraft) => void }) {
  let lastSeq = 0
  function post(message: Record<string, unknown>) {
    const { self } = options
    const target = self.location.origin
    // 沒有外層頁（頂層直接開）或指定不出來源（opaque origin 的 "null"）就不送，絕不退成 '*'。
    if (self.parent == null || self.parent === self || !target || target === 'null') return
    ;(self.parent as { postMessage(message: unknown, targetOrigin: string): void }).postMessage(
      { v: PREVIEW_PROTOCOL_VERSION, ...message },
      target
    )
  }
  return {
    handle(event: { origin: string; source: unknown; data: unknown }) {
      if (!isTrustedPreviewEvent(event, options.self)) return
      const draft = parseDraftMessage(event.data, options.campusKeys)
      if (!draft || draft.seq <= lastSeq) return
      lastSeq = draft.seq
      options.onDraft(draft)
    },
    ready: () => post({ type: PREVIEW_MESSAGE.ready }),
    denied: () => post({ type: PREVIEW_MESSAGE.denied }),
    applied: (seq: number, hit: PreviewHit) => post({ type: PREVIEW_MESSAGE.applied, seq, hit })
  }
}

export type LiveReceiver = ReturnType<typeof createLiveReceiver>
