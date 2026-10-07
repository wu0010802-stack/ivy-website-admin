import { computed, h, ref, unref, watch, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { notifyError } from './notify'
import { api } from '../api/client'
import type { ContentItemOut } from '../api/types'
import { contentFieldLabel, contentItemLabel, contentPreviewPath, contentPublicPath, HQ_MANAGED_KINDS } from '../api/labels'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import { WEBSITE_ASSET_BASE } from '../config'
import { useRequestSequence } from './useRequestSequence'
import { contentFieldErrors, contentSaveErrorMessage, isVersionConflict, type ContentFieldError } from '../api/errors'
import { hasCapability } from './usePermissions'
import { useAuthStore } from '../stores/auth'

export interface PublishJob {
  id: string
  revision_id: string
  revision_version: number
  publish_at: string
  /** skipped＝到期時官網已經是較新的版本，沒有蓋回去 */
  status: 'scheduled' | 'done' | 'failed' | 'skipped' | 'cancelled'
  error: string | null
  created_by_email: string | null
  /** 排程的人設定的顯示名稱（沒設定為 null）；編輯頁的排程列刻意不寫是誰排的 */
  created_by_display_name?: string | null
  finished_at: string | null
  /** 沒有發布（failed／skipped）的排程已經處理過：有人按了「知道了」，或官網之後換過這項內容的版本 */
  resolved?: boolean
}

/** 發布確認框列出的一筆差異：欄位中文名、上次儲存的值、現在的值 */
export interface FieldChange {
  key: string
  label: string
  before: string
  after: string
  /** 清單或巢狀欄位：新增、刪除、修改了哪幾項（例如「新增「親子日」；修改「開學典禮」」） */
  detail?: string
}

// 把欄位值壓成一行給確認框看；物件清單只講「N 項」，逐項差異另外放在 detail。
export function summarizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空白）'
  if (Array.isArray(value)) {
    const strings = value.filter((v) => typeof v === 'string') as string[]
    if (strings.length === value.length) return strings.map((v) => v || '（空白）').join('／')
    return `${value.length} 項`
  }
  if (typeof value === 'object') return '（已修改）'
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

// 清單裡的一項用哪個欄位當名字（消息標題、常見問題、場景名…），都沒有就用第幾項。
const ITEM_NAME_KEYS = ['title', 'name', 'q', 'heading', 'label', 'time', 'date', 'key', 'id'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemName(item: unknown, index: number): string {
  if (isPlainObject(item)) {
    for (const key of ITEM_NAME_KEYS) {
      const value = item[key]
      if (typeof value === 'string' && value.trim()) {
        const text = value.trim()
        return `「${text.length > 20 ? `${text.slice(0, 20)}…` : text}」`
      }
    }
  } else if (typeof item === 'string' && item.trim()) {
    const text = item.trim()
    return `「${text.length > 20 ? `${text.slice(0, 20)}…` : text}」`
  }
  return `第 ${index + 1} 項`
}

// 有 id／key 的清單（消息、時刻、場景）用它對應同一項，才分得出「改了」和
// 「刪了再加」；沒有的依位置對應。
function itemIdentity(item: unknown, index: number): string {
  if (isPlainObject(item)) {
    for (const key of ['id', 'key'] as const) {
      const value = item[key]
      if (typeof value === 'string' && value) return `${key}:${value}`
    }
  }
  return `#${index}`
}

// 「新增「親子日」、第 3 項」：名字有引號就緊接動詞，「第 N 項」前留空白。
function listNames(verb: string, names: string[]): string {
  const list = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 項` : names.join('、')
  return list.startsWith('「') ? `${verb}${list}` : `${verb} ${list}`
}

/** 清單或物件欄位的逐項差異摘要；純文字欄位回 undefined。 */
export function nestedChangeDetail(before: unknown, after: unknown): string | undefined {
  const beforeList = Array.isArray(before) ? before : before == null ? [] : null
  const afterList = Array.isArray(after) ? after : after == null ? [] : null
  if (beforeList && afterList && (Array.isArray(before) || Array.isArray(after))) {
    const oldById = new Map(beforeList.map((item, index) => [itemIdentity(item, index), { item, index }]))
    const newIds = new Set(afterList.map((item, index) => itemIdentity(item, index)))
    const added: string[] = []
    const changed: string[] = []
    afterList.forEach((item, index) => {
      const previous = oldById.get(itemIdentity(item, index))
      if (!previous) added.push(itemName(item, index))
      else if (JSON.stringify(previous.item) !== JSON.stringify(item)) changed.push(itemName(item, index))
    })
    const removed = beforeList
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => !newIds.has(itemIdentity(item, index)))
      .map(({ item, index }) => itemName(item, index))
    const moved = !added.length && !removed.length && !changed.length && JSON.stringify(before) !== JSON.stringify(after)
    const parts = [
      added.length ? listNames('新增', added) : '',
      removed.length ? listNames('刪除', removed) : '',
      changed.length ? listNames('修改', changed) : '',
      moved ? '調整了順序' : '',
    ].filter(Boolean)
    return parts.length ? parts.join('；') : undefined
  }
  if (isPlainObject(before) || isPlainObject(after)) {
    const a = isPlainObject(before) ? before : {}
    const b = isPlainObject(after) ? after : {}
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
      .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    return keys.length ? `修改 ${keys.map(contentFieldLabel).join('、')}` : undefined
  }
  return undefined
}

export function diffPayload(before: Record<string, unknown>, after: Record<string, unknown>, kind?: string): FieldChange[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => {
      const change: FieldChange = { key, label: contentFieldLabelFor(kind, key), before: summarizeValue(before[key]), after: summarizeValue(after[key]) }
      // 字串清單（標語）前後值已經逐字列出，不必再摘要。
      const plainStrings = [before[key], after[key]].every((v) => v == null || (Array.isArray(v) && v.every((x) => typeof x === 'string')))
      const detail = plainStrings ? undefined : nestedChangeDetail(before[key], after[key])
      if (detail) change.detail = detail
      return change
    })
}

/**
 * 發布或核准前和官網目前的版本比較的結果。firstPublish＝這項內容從來沒發布過，
 * 官網顯示的是預設文字，不拿空物件比（否則每個欄位都會被列成差異）。
 */
export interface LiveComparison {
  firstPublish: boolean
  /** 官網目前的內容 → 要上線的內容（表單）；firstPublish 時為空 */
  changes: FieldChange[]
}

/**
 * 動作列「草稿有 N 處修改」與段落目錄打點的比對基準（2026-10-06 方向 D）：
 * live＝官網目前那一版（補過預設值，同發布確認框 compareWithLive 的基準）；
 * first＝從沒發布過，不拿空白比；saved＝官網版還沒讀到或讀不到，退回和上次儲存比。
 */
export interface DraftBaseline {
  source: 'live' | 'first' | 'saved'
  payload: Record<string, unknown> | null
}

/** silent：由「儲存並發布／送審／排程」呼叫，只顯示最後結果那一則 toast */
export interface SaveOptions {
  silent?: boolean
}

/** 版本紀錄列表的一列（後端 ContentRevisionSummaryOut） */
export interface RevisionSummary {
  id: string
  version: number
  created_at: string
  created_by_email: string | null
  /** 儲存這一版的人設定的顯示名稱；畫面一律經 staffLabel 顯示 */
  created_by_display_name?: string | null
  is_published: boolean
  /** 曾經是官網上的版本（包含現在） */
  ever_published?: boolean
  /** 最近一次成為官網版本的時間 */
  last_published_at?: string | null
  /** draft | pending_review | approved | rejected | superseded */
  review_status?: string
  /** 退回原因或核准備註 */
  review_note?: string | null
  reviewed_at?: string | null
}

/** 版本紀錄抽屜需要的動作；ContentEditor 有拿到才顯示「版本紀錄」按鈕 */
export interface RevisionHistoryHandle {
  /** 內容種類：差異清單依它給和表單一致的欄位名 */
  kind?: string
  list: () => Promise<RevisionSummary[]>
  payloadOf: (revisionId: string) => Promise<Record<string, unknown>>
  /** 目前已儲存的內容，用來列出「還原後哪些欄位會變」 */
  savedPayload: () => Record<string, unknown>
  restore: (revisionId: string, publish: boolean) => Promise<boolean>
}

// ContentEditor 外殼需要的狀態與動作；useContentItem 的回傳值結構上符合，
// 頁面把整個 handle 傳給 <ContentEditor :editor> 即可。
export interface ContentEditorState {
  /** 內容種類：存檔錯誤定位欄位時，欄位名依它和表單標籤對上 */
  kind?: string
  loading: Ref<boolean>
  loadError: Ref<string | null>
  saving: Ref<boolean>
  publishing: Ref<boolean>
  isPublished: Ref<boolean>
  isDirty: ComputedRef<boolean>
  neverPublished: ComputedRef<boolean>
  latestRevisionAt: ComputedRef<string | null>
  /** 未儲存的修改與上次儲存相比動了哪些欄位；讀不到官網版時發布確認框改列這個 */
  changes?: ComputedRef<FieldChange[]>
  /** 動作列與段落目錄的比對基準（見 DraftBaseline） */
  draftBaseline?: ComputedRef<DraftBaseline>
  /** 表單和 draftBaseline 相比不同的欄位（diffPayload，同發布確認框）；first 時是空陣列 */
  draftChanges?: ComputedRef<FieldChange[]>
  /**
   * 正在讀官網那一版（要讀才有基準時）：此時 draftBaseline 還是 saved，動作列不能寫「N 處修改」
   * 或「和官網一樣」，等讀完（成功或失敗）再寫，避免字樣閃一下。讀不到官網版時是 false。
   */
  liveReading?: Ref<boolean>
  /** 分校內容的校區（共用內容是 null）；校區選單的值，換校確認框開著時就已經是下一校 */
  campusKey?: ComputedRef<string | null>
  /**
   * 目前表單內容是哪一校載入的：最後一次載入成功時的校區（載入前、共用內容是 null）。
   * 換校前問「放棄修改？」的這段時間，campusKey 已是下一校、表單仍是上一校，這個值還是上一校；
   * 右側即時預覽用它決定重建 iframe 與草稿標成哪一校，才不會把上一校的內容畫在下一校上。
   */
  loadedCampusKey?: Ref<string | null>
  /** 要上線的內容（表單）和官網目前的版本相比；讀不到官網版回 null。開確認框前才呼叫 */
  compareWithLive?: () => Promise<LiveComparison | null>
  /** 確認框標題用的內容名稱，分校內容帶校名，例如「各校常見問題（明華）」 */
  contextLabel?: ComputedRef<string>
  /** 最新一版的 id；排程列用來判斷排的是不是目前的草稿 */
  latestRevisionId?: ComputedRef<string | null>
  /**
   * 官網目前那一版的版本號（只在程式裡比較，不顯示）；排程列用來判斷排定的版本
   * 到時會不會略過。從沒發布過，或官網不是最新一版又還沒讀到時是 null。
   */
  liveVersion?: ComputedRef<number | null>
  /** 送審之後由誰核准：分校內容是校區管理者，共用內容是總管理者 */
  approver?: string
  /** 發布後「查看官網」要開的完整網址 */
  publicUrl?: ComputedRef<string>
  /** 目前表單內容；版本紀錄拿來和舊版比較 */
  form?: Ref<unknown>
  /** 這個帳號只能查看：ContentEditor 停用欄位、不顯示儲存／送審／發布 */
  readOnly?: ComputedRef<boolean>
  /** 私有草稿預覽網址；沒有對應預覽頁的內容為空字串 */
  previewUrl?: ComputedRef<string>
  /** 版本紀錄要打的 API 路徑（含 campus_key），例如 /admin/content-items/home_about */
  apiPath?: ComputedRef<string>
  /** 最新一版的審核狀態：draft | pending_review | approved | rejected */
  reviewStatus?: ComputedRef<string>
  reviewNote?: ComputedRef<string | null>
  /** 內容編輯送審（有未儲存修改會先存） */
  submitForReview?: () => Promise<boolean>
  /** 核准（並發布）或退回送審的版本 */
  review?: (decision: 'approve' | 'reject', note?: string) => Promise<boolean>
  schedules?: Ref<PublishJob[]>
  loadSchedules?: () => Promise<void>
  /** 排程發布最新一版（有未儲存修改會先存）；publishAt 帶時區的 ISO 字串 */
  schedule?: (publishAt: string) => Promise<boolean>
  cancelSchedule?: (jobId: string) => Promise<boolean>
  /** 沒有發布的排程按「知道了」：編輯頁與總覽不再提示 */
  acknowledgeSchedule?: (jobId: string) => Promise<boolean>
  history?: RevisionHistoryHandle
  /** 上次存檔被後端擋下的欄位（422）；ContentEditor 列成可以點的清單 */
  fieldErrors?: Ref<ContentFieldError[]>
  /** 存檔或發布時發現別人先存了（版本衝突）：表單還在，儲存與發布先停用 */
  conflict?: Ref<boolean>
  /** 衝突時讀最新一版，列出對方改了哪些欄位（和自己開始編輯時的內容比）；讀不到回 null */
  inspectConflict?: () => Promise<FieldChange[] | null>
  /** 衝突時載入最新內容；自己的修改先記在畫面裡，之後可以套回 */
  reloadLatest?: () => Promise<boolean>
  /** 載入最新內容後還記著的自己的修改（和開始編輯時相比）；沒有時是空陣列 */
  stashedChanges?: ComputedRef<FieldChange[]>
  /** 記著的修改裡，對方也改過的欄位名：套回會蓋掉對方在這些欄位的修改 */
  stashOverlap?: ComputedRef<string[]>
  restoreStash?: () => void
  discardStash?: () => void
  load: () => Promise<void>
  save: (options?: SaveOptions) => Promise<boolean>
  saveAndPublish: () => Promise<boolean>
  reset: () => void
}

export interface ContentItemOptions<TPayload> {
  /** 舊版內容的巢狀欄位補預設值或換算（例如消息的舊校區文字），在拍快照之前做 */
  normalize?: (payload: TPayload) => TPayload
  /**
   * 從沒存過任何版本時帶入的初稿（例如隱私權政策）。載入、重新載入、放棄修改都一樣帶入；
   * 快照仍是空白表單，所以畫面是「有未儲存的修改」，按儲存才變成第一個版本。
   */
  seed?: () => TPayload
}

export function useContentItem<TPayload extends object>(
  kind: string,
  emptyPayload: TPayload,
  campusKey?: Ref<string> | string,
  options: ContentItemOptions<TPayload> = {},
) {
  const item = ref<ContentItemOut | null>(null)
  const form = ref<TPayload>(clone(emptyPayload))
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const saving = ref(false)
  const publishing = ref(false)
  const isPublished = ref(false)
  // 最近一次從伺服器載入或儲存成功後的表單快照，用來判斷有沒有未儲存的修改。
  const snapshot = ref('')
  const requests = useRequestSequence()
  const loadedCampusKey = ref<string | null>(null)
  const fieldErrors = ref<ContentFieldError[]>([])
  const conflict = ref(false)
  // 版本衝突後載入最新內容前的表單：base＝開始編輯時（上次載入或儲存）的內容，
  // mine＝當時畫面上的內容。只記在這個畫面，離開或切校就沒了。
  const stash = ref<{ base: Record<string, unknown>; mine: Record<string, unknown> } | null>(null)

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  // campusKey 可以是固定字串（共用 kind 不需要），也可以是隨畫面上校
  // 區選單變動的 ref（分校內容）；每次呼叫都重新讀目前的值，不在建立
  // composable 當下就寫死。
  function query(): string {
    const key = unref(campusKey)
    return key ? `?campus_key=${encodeURIComponent(key)}` : ''
  }

  // 寫入動作（存檔、發布、送審、審核、排程、還原）送出當下的校區：回應回來時已經換了校，
  // 那是舊校的結果，不能寫進新校的畫面（下一次存檔會帶錯版本、表單會變成舊校的內容）。
  // 校區選單在處理中會停用（useCampusContent），這裡是最後一道防線。
  const scopeNow = () => unref(campusKey) ?? ''
  const sameScope = (scope: string) => scopeNow() === scope

  // 舊版內容缺少後來新增的欄位時補上預設值（在拍快照之前補，才不會一
  // 打開就顯示「有未儲存的修改」）。
  function withDefaults(payload: unknown): TPayload {
    if (!payload) return clone(emptyPayload)
    const merged = { ...clone(emptyPayload), ...clone(payload as TPayload) }
    return options.normalize ? options.normalize(merged) : merged
  }

  function takeSnapshot() {
    snapshot.value = JSON.stringify(form.value)
  }

  // 從沒存過任何版本時換上初稿（options.seed）；在拍快照之後換，畫面才是「有未儲存的修改」。
  function applySeed() {
    if (options.seed && item.value && !item.value.latest_revision) form.value = options.seed()
  }

  const isDirty = computed(() => JSON.stringify(form.value) !== snapshot.value)

  const changes = computed<FieldChange[]>(() => {
    if (!snapshot.value) return []
    return diffPayload(JSON.parse(snapshot.value) as Record<string, unknown>, form.value as Record<string, unknown>, kind)
  })

  const publicUrl = computed(() => `${WEBSITE_ASSET_BASE}${contentPublicPath(kind, unref(campusKey))}`)
  const previewUrl = computed(() => {
    const path = contentPreviewPath(kind, unref(campusKey))
    return path ? `${WEBSITE_ASSET_BASE}${path}` : ''
  })
  const apiPath = computed(() => `/admin/content-items/${kind}${query()}`)
  const contextLabel = computed(() => contentItemLabel(kind, unref(campusKey)))
  // 共用內容（沒有 campusKey）與總部管理的各校內容（校園探索）權限比照共用內容。
  const sharedRules = campusKey === undefined || HQ_MANAGED_KINDS.has(kind)
  // 共用內容要總管理者或被授權的人核准，分校內容是校區管理者。
  const approver = sharedRules ? '總管理者' : '校區管理者'
  // 唯讀：分校內容看 content.manage；共用內容要有「全站共用內容」權限
  // （總管理者或被授權的人，後端 can_edit_shared_content）。
  // store 在 computed 裡才取，單獨測這個 composable 時不需要 Pinia。
  const readOnly = computed(() => {
    const user = useAuthStore().user
    return !hasCapability(user, sharedRules ? 'content.shared' : 'content.manage')
  })
  const reviewStatus = computed(() => item.value?.latest_revision?.review_status ?? 'draft')
  const reviewNote = computed(() => item.value?.latest_revision?.review_note ?? null)
  const schedules = ref<PublishJob[]>([])

  /** 最新草稿的建立時間（ISO），沒有任何版本時為 null */
  const latestRevisionAt = computed(() => item.value?.latest_revision?.created_at ?? null)
  const latestRevisionId = computed(() => item.value?.latest_revision?.id ?? null)

  /** 有版本但從未發布過 */
  const neverPublished = computed(
    () => Boolean(item.value) && !item.value?.current_published_revision_id,
  )

  // 看過的版本號（版本 id → 第幾版）：最新一版每次載入、儲存都會帶回來，官網版
  // 不是最新一版時另外讀。版本內容不會再變，記住就不用重抓。
  const knownVersions = ref<Record<string, number>>({})
  function rememberVersion(id: string | undefined, version: unknown) {
    if (id && typeof version === 'number' && knownVersions.value[id] !== version) {
      knownVersions.value = { ...knownVersions.value, [id]: version }
    }
  }
  watch(
    () => item.value?.latest_revision,
    (latest) => rememberVersion(latest?.id, latest?.version),
    { flush: 'sync' },
  )

  // 官網目前是第幾版：官網就是最新一版時直接用最新版號，否則看排程清單或讀過的
  // 官網版；還不知道時是 null（排程列就不斷言排程會不會略過）。
  const liveVersion = computed<number | null>(() => {
    const liveId = item.value?.current_published_revision_id
    if (!liveId) return null
    const fromJob = schedules.value.find((job) => job.revision_id === liveId)
    return knownVersions.value[liveId] ?? fromJob?.revision_version ?? null
  })

  async function load() {
    const request = requests.begin()
    // 校區在送出請求當下記下：載入途中校區選單被換掉，回來的仍是這一校的內容。
    const requestedCampus = unref(campusKey) || null
    loading.value = true
    loadError.value = null
    conflict.value = false
    fieldErrors.value = []
    stash.value = null
    try {
      const result = await api.get<ContentItemOut>(`/admin/content-items/${kind}${query()}`)
      if (!requests.isCurrent(request)) return
      item.value = result
      form.value = withDefaults(item.value.latest_revision?.payload)
      isPublished.value = Boolean(
        item.value.latest_revision &&
          item.value.current_published_revision_id === item.value.latest_revision.id,
      )
      loadedCampusKey.value = requestedCampus
      takeSnapshot()
      applySeed()
    } catch (err) {
      if (requests.isCurrent(request)) loadError.value = errorMessage(err, '讀取內容失敗')
    } finally {
      if (requests.isCurrent(request)) loading.value = false
    }
  }

  function errorMessage(err: unknown, fallback: string): string {
    // 只有「別人先存了」才請使用者重新載入；其他 409（素材未就緒、分校停用、
    // 內容規則不符…）要顯示後端說的原因，不能一律說成被別人更新。
    if (isVersionConflict(err)) return '內容已被其他人更新，請重新載入後再試'
    // 422 寫出「最新消息第 4 則・標題：不能空白」，不是只丟英文的 pydantic 訊息。
    return contentSaveErrorMessage(err, kind, fallback)
  }

  // 存檔、發布失敗的訊息要看得完、找得到欄位：不自動消失，自己按關閉。
  function showError(message: string) {
    notifyError(message, { duration: 0 })
  }

  // 別人先存或先發布（版本衝突）：不跳一下就消失的 toast，改由 ContentEditor 顯示
  // 持續的提示，表單內容留著。回傳 true 表示已經處理。
  function markConflict(err: unknown): boolean {
    if (!isVersionConflict(err)) return false
    conflict.value = true
    return true
  }

  // 「儲存並發布」這類兩段動作：先儲存成功、後一段失敗時，要講清楚草稿已經
  // 存了，不然使用者會以為什麼都沒留下而重做一次。
  function afterSaveError(savedFirst: boolean, err: unknown, action: string): string {
    return savedFirst ? `已存成草稿，但${action}失敗：${errorMessage(err, '請稍後再試')}` : errorMessage(err, `${action}失敗`)
  }

  async function save(options: SaveOptions = {}): Promise<boolean> {
    if (!item.value) return false
    const scope = scopeNow()
    saving.value = true
    try {
      const saved = await api.post<ContentItemOut>(`/admin/content-items/${kind}/revisions${query()}`, {
        expected_version: item.value.latest_version,
        payload: form.value,
      })
      if (!sameScope(scope)) return false
      item.value = saved
      isPublished.value = false
      takeSnapshot()
      fieldErrors.value = []
      // 存成新的一版後，衝突前記著的修改就不再對得上這一版，不再提供套回。
      stash.value = null
      if (!options.silent) ElMessage.success('已儲存草稿，官網尚未更新')
      return true
    } catch (err) {
      if (!sameScope(scope)) return false
      fieldErrors.value = contentFieldErrors(err, kind)
      if (!markConflict(err)) showError(errorMessage(err, '儲存失敗'))
      return false
    } finally {
      saving.value = false
    }
  }

  async function publish(): Promise<boolean> {
    if (!item.value?.latest_revision) return false
    return publishRevision(item.value.latest_revision.id)
  }

  async function publishRevision(revisionId: string, savedFirst = false): Promise<boolean> {
    const scope = scopeNow()
    publishing.value = true
    try {
      const published = await api.post<ContentItemOut>(`/admin/content-items/${kind}/publish${query()}`, {
        revision_id: revisionId,
        // 樂觀鎖：畫面載入時官網的版本。別人之後發布過就回 409，請使用者重新載入，
        // 擱置的分頁不會把較新的官網內容靜默換回舊版。
        expected_published_revision_id: item.value?.current_published_revision_id ?? null,
      })
      if (!sameScope(scope)) return false
      item.value = published
      isPublished.value = item.value.current_published_revision_id === item.value.latest_revision?.id
      // 官網換了版本，之前沒有發布的排程就算處理過了，提示跟著更新。
      void loadSchedules()
      // 發布是唯一會被家長看到的動作，成功後直接給連結，不用自己去找官網。
      ElMessage({
        type: 'success',
        duration: 8000,
        showClose: true,
        message: h('span', null, [
          '已發布到官網。',
          h('a', { href: publicUrl.value, target: '_blank', rel: 'noopener', style: 'margin-left:8px;text-decoration:underline;color:inherit' }, '查看官網 ↗'),
        ]),
      })
      return true
    } catch (err) {
      if (!sameScope(scope)) return false
      if (!markConflict(err) || savedFirst) showError(afterSaveError(savedFirst, err, '發布'))
      return false
    } finally {
      publishing.value = false
    }
  }

  /** 先儲存目前修改再發布；表單沒改就直接發布最新草稿。只跳最後結果那一則 toast。 */
  async function saveAndPublish(): Promise<boolean> {
    const savedFirst = isDirty.value
    if (savedFirst && !(await save({ silent: true }))) return false
    if (!item.value?.latest_revision) return false
    return publishRevision(item.value.latest_revision.id, savedFirst)
  }

  async function submitForReview(): Promise<boolean> {
    const savedFirst = isDirty.value
    if (savedFirst && !(await save({ silent: true }))) return false
    if (!item.value?.latest_revision) return false
    const scope = scopeNow()
    publishing.value = true
    try {
      const submitted = await api.post<ContentItemOut>(`/admin/content-items/${kind}/submit${query()}`, {
        revision_id: item.value.latest_revision.id,
      })
      if (!sameScope(scope)) return false
      item.value = submitted
      ElMessage.success(`已送審，${approver}核准後才會出現在官網`)
      return true
    } catch (err) {
      if (!sameScope(scope)) return false
      if (!markConflict(err) || savedFirst) showError(afterSaveError(savedFirst, err, '送審'))
      return false
    } finally {
      publishing.value = false
    }
  }

  async function review(decision: 'approve' | 'reject', note?: string): Promise<boolean> {
    if (!item.value?.latest_revision) return false
    const scope = scopeNow()
    publishing.value = true
    try {
      const reviewed = await api.post<ContentItemOut>(`/admin/content-items/${kind}/review${query()}`, {
        revision_id: item.value.latest_revision.id,
        decision,
        note: note ?? null,
      })
      if (!sameScope(scope)) return false
      item.value = reviewed
      isPublished.value = item.value.current_published_revision_id === item.value.latest_revision?.id
      if (decision === 'approve') void loadSchedules()
      ElMessage.success(decision === 'approve' ? '已核准並發布到官網' : '已退回，內容編輯會看到你寫的原因')
      return true
    } catch (err) {
      if (!sameScope(scope)) return false
      if (!markConflict(err)) showError(errorMessage(err, decision === 'approve' ? '核准失敗' : '退回失敗'))
      return false
    } finally {
      publishing.value = false
    }
  }

  // 排程清單只採用最後一次讀取：換校、存檔、發布後都會重讀，先送出、較晚回來的舊校清單不能蓋掉。
  const scheduleRequests = useRequestSequence()

  async function loadSchedules(): Promise<void> {
    const request = scheduleRequests.begin()
    try {
      const list = await api.get<PublishJob[]>(`/admin/content-items/${kind}/schedules${query()}`)
      if (!scheduleRequests.isCurrent(request)) return
      schedules.value = Array.isArray(list) ? list : []
    } catch {
      if (!scheduleRequests.isCurrent(request)) return
      schedules.value = []
    }
    // 不擋住排程、取消排程後的提示；讀到版號後排程列自己會更新。
    void learnLiveVersion()
  }

  // 排程列要知道官網現在是第幾版，才講得出排定的版本到時會不會略過（後端
  // skip_reason：官網已是同一版或更新就略過）。只有「排的不是最新一版、官網
  // 也不是最新一版」而且還不知道官網版號時，才另外讀一次官網版。
  async function learnLiveVersion(): Promise<void> {
    const current = item.value
    const liveId = current?.current_published_revision_id
    if (!current || !liveId || liveVersion.value !== null) return
    const latestId = current.latest_revision?.id
    if (!schedules.value.some((job) => job.status === 'scheduled' && job.revision_id !== latestId)) return
    try {
      await readLiveRevision(liveId)
    } catch {
      /* 讀不到：排程列改講「官網若已是更新的內容就會略過」 */
    }
  }

  async function schedule(publishAt: string): Promise<boolean> {
    const savedFirst = isDirty.value
    if (savedFirst && !(await save({ silent: true }))) return false
    if (!item.value?.latest_revision) return false
    const scope = scopeNow()
    publishing.value = true
    try {
      await api.post<PublishJob>(`/admin/content-items/${kind}/schedules${query()}`, {
        revision_id: item.value.latest_revision.id,
        publish_at: publishAt,
      })
      if (!sameScope(scope)) return false
      await loadSchedules()
      ElMessage.success('已排程，時間到會自動發布')
      return true
    } catch (err) {
      if (!sameScope(scope)) return false
      showError(afterSaveError(savedFirst, err, '排程'))
      return false
    } finally {
      publishing.value = false
    }
  }

  async function cancelSchedule(jobId: string): Promise<boolean> {
    try {
      await api.delete(`/admin/content-items/${kind}/schedules/${jobId}${query()}`)
      await loadSchedules()
      ElMessage.success('已取消排程')
      return true
    } catch (err) {
      notifyError(errorMessage(err, '取消失敗'))
      return false
    }
  }

  async function acknowledgeSchedule(jobId: string): Promise<boolean> {
    try {
      await api.post<PublishJob>(`/admin/content-items/${kind}/schedules/${jobId}/acknowledge${query()}`)
      await loadSchedules()
      return true
    } catch (err) {
      notifyError(errorMessage(err, '操作失敗'))
      return false
    }
  }

  // 讀一個版本的內容；順便記下它是第幾版（排程列比較用）。
  async function readRevision(revisionId: string): Promise<{ payload: Record<string, unknown>; version?: number }> {
    const revision = await api.get<{ payload: Record<string, unknown>; version?: number }>(
      `/admin/content-items/${kind}/revisions/${revisionId}${query()}`,
    )
    rememberVersion(revisionId, revision?.version)
    return revision
  }

  const history: RevisionHistoryHandle = {
    kind,
    list: () => api.get<RevisionSummary[]>(`/admin/content-items/${kind}/revisions${query()}`),
    async payloadOf(revisionId) {
      return (await readRevision(revisionId)).payload
    },
    savedPayload: () => (item.value?.latest_revision?.payload as Record<string, unknown> | undefined) ?? {},
    async restore(revisionId, publishNow) {
      if (!item.value) return false
      const scope = scopeNow()
      const busyFlag = publishNow ? publishing : saving
      busyFlag.value = true
      try {
        const restored = await api.post<ContentItemOut>(
          `/admin/content-items/${kind}/revisions/${revisionId}/restore${query()}`,
          { expected_version: item.value.latest_version, publish: publishNow },
        )
        if (!sameScope(scope)) return false
        item.value = restored
        form.value = withDefaults(item.value.latest_revision!.payload)
        isPublished.value = publishNow
        takeSnapshot()
        // 還原成一個新的最新版：之前存檔或發布遇到的衝突、欄位錯誤、記著的修改都對不上這一版了。
        conflict.value = false
        fieldErrors.value = []
        stash.value = null
        if (publishNow) void loadSchedules()
        ElMessage.success(publishNow ? '已還原並發布到官網' : '已還原成草稿，官網尚未更新')
        return true
      } catch (err) {
        if (!sameScope(scope)) return false
        notifyError(errorMessage(err, '還原失敗'))
        return false
      } finally {
        busyFlag.value = false
      }
    },
  }

  // 官網上的版本不會再變（改內容是另存新版），讀過一次就記住，不用每次開確認框都重抓。
  const livePayloads = new Map<string, unknown>()

  // 讀官網那一版（不是最新一版時）：內容給確認框比對，版本號給排程列。
  async function readLiveRevision(liveId: string): Promise<unknown> {
    const payload = (await readRevision(liveId))?.payload
    if (isPlainObject(payload)) livePayloads.set(liveId, payload)
    return payload
  }

  // 官網那一版的內容：官網就是最新一版時直接用，否則讀一次，讀到的記在 livePayloads。
  // 讀不到或不是物件時回 null；網路錯誤照丟，由呼叫端決定退路。
  async function livePayloadOf(current: ContentItemOut): Promise<Record<string, unknown> | null> {
    const liveId = current.current_published_revision_id
    if (!liveId) return null
    let payload: unknown = livePayloads.get(liveId)
    if (payload === undefined) {
      if (liveId === current.latest_revision?.id) {
        payload = current.latest_revision.payload
        if (isPlainObject(payload)) livePayloads.set(liveId, payload)
      } else {
        // readLiveRevision 讀到就已經記進 livePayloads
        payload = await readLiveRevision(liveId)
      }
    }
    return isPlainObject(payload) ? payload : null
  }

  // 發布、核准前和官網那一版比（載入時已經讀過，通常直接用快取）。舊版內容缺少後來新增的
  // 欄位，要先經過 withDefaults／normalize 才跟表單比，否則會多出「（空白）→
  // （空白）」這類假差異。
  async function compareWithLive(): Promise<LiveComparison | null> {
    const current = item.value
    if (!current) return null
    if (!current.current_published_revision_id) return { firstPublish: true, changes: [] }
    try {
      const payload = await livePayloadOf(current)
      if (!payload) return null
      const live = withDefaults(payload) as Record<string, unknown>
      return { firstPublish: false, changes: diffPayload(live, form.value as Record<string, unknown>, kind) }
    } catch {
      return null
    }
  }

  // 動作列與段落目錄要一直知道「和官網差在哪」（2026-10-06 方向 D，取代 09-28「開確認框前才讀官網版」）：
  // 載入、存檔後官網那一版換了才讀（同一版記在 livePayloads 不重讀）。liveBase 記著是哪一版的內容，
  // 換校或重新載入後只採用最後一次的結果，且 draftBaseline 只認和目前官網版 id 對得上的那份。
  const liveBase = ref<{ id: string; payload: Record<string, unknown> } | null>(null)
  const liveRequests = useRequestSequence()
  // 還沒有這一版官網內容、正在讀的那一段（見 ContentEditorState.liveReading）。已經有這一版的基準
  // （例如存檔後官網版沒換）不算讀取中，動作列不會為了重新確認而閃一下。
  const liveReading = ref(false)

  async function refreshLiveBase(): Promise<void> {
    const request = liveRequests.begin()
    const current = item.value
    const liveId = current?.current_published_revision_id
    if (!current || !liveId) {
      liveBase.value = null
      liveReading.value = false
      return
    }
    liveReading.value = liveBase.value?.id !== liveId
    try {
      const payload = await livePayloadOf(current)
      if (!liveRequests.isCurrent(request)) return
      liveBase.value = payload ? { id: liveId, payload: withDefaults(payload) as Record<string, unknown> } : null
    } catch {
      /* 讀不到官網版：draftBaseline 退回和上次儲存比 */
      if (liveRequests.isCurrent(request)) liveBase.value = null
    } finally {
      // 被更新的一次取代時由那一次負責收尾，不在這裡關掉
      if (liveRequests.isCurrent(request)) liveReading.value = false
    }
  }

  // 只看官網版 id 與最新版 id：換校後重新載入一定換 item，不必等校區 ref 變動就拿舊校的 id 去讀新校。
  watch(
    () => `${item.value?.current_published_revision_id ?? ''}|${item.value?.latest_revision?.id ?? ''}`,
    () => void refreshLiveBase(),
  )

  const draftBaseline = computed<DraftBaseline>(() => {
    const liveId = item.value?.current_published_revision_id
    if (item.value && !liveId) return { source: 'first', payload: null }
    if (liveId && liveBase.value?.id === liveId) return { source: 'live', payload: liveBase.value.payload }
    return { source: 'saved', payload: snapshot.value ? (JSON.parse(snapshot.value) as Record<string, unknown>) : null }
  })
  const draftChanges = computed<FieldChange[]>(() => {
    const base = draftBaseline.value.payload
    return base ? diffPayload(base, form.value as Record<string, unknown>, kind) : []
  })
  const campusKeyRef = computed(() => unref(campusKey) || null)

  function reset() {
    if (!snapshot.value) return
    form.value = JSON.parse(snapshot.value) as TPayload
    // 還沒有任何版本時，放棄修改回到初稿（跟載入時一樣），不是空白表單。
    applySeed()
  }

  async function inspectConflict(): Promise<FieldChange[] | null> {
    if (!snapshot.value) return null
    try {
      const latest = await api.get<ContentItemOut>(`/admin/content-items/${kind}${query()}`)
      const base = JSON.parse(snapshot.value) as Record<string, unknown>
      return diffPayload(base, withDefaults(latest?.latest_revision?.payload) as Record<string, unknown>, kind)
    } catch {
      return null
    }
  }

  // 載入最新內容；畫面上的修改先記著，載完由使用者決定要不要套回。讀取失敗也記著
  // （畫面只剩讀取錯誤，離頁保護看 stashedChanges 照樣攔），之後按「重新載入」（也走這裡）
  // 讀到了再提供套回。表單在讀取失敗時沒有被換掉，再算一次還是同一份修改。
  async function reloadLatest(): Promise<boolean> {
    const saved = snapshot.value
      ? { base: JSON.parse(snapshot.value) as Record<string, unknown>, mine: clone(form.value) as Record<string, unknown> }
      : null
    await load()
    const changed = saved && JSON.stringify(saved.base) !== JSON.stringify(saved.mine) ? saved : null
    if (changed) stash.value = changed
    return !loadError.value
  }

  const stashedChanges = computed<FieldChange[]>(() => (stash.value ? diffPayload(stash.value.base, stash.value.mine, kind) : []))

  const stashOverlap = computed<string[]>(() => {
    if (!stash.value || !snapshot.value) return []
    const latest = JSON.parse(snapshot.value) as Record<string, unknown>
    const base = stash.value.base
    return stashedChanges.value
      .filter((change) => JSON.stringify(base[change.key]) !== JSON.stringify(latest[change.key]))
      .map((change) => change.label)
  })

  // 只套回自己改過的欄位（以最外層欄位為單位）；對方改的其他欄位保留。套回後是
  // 未儲存的修改，要自己再按儲存，發布前的確認框照樣列出和官網的差異。
  function restoreStash() {
    const saved = stash.value
    if (!saved) return
    const next = clone(form.value) as Record<string, unknown>
    for (const change of stashedChanges.value) next[change.key] = clone(saved.mine[change.key])
    form.value = next as TPayload
    stash.value = null
  }

  function discardStash() {
    stash.value = null
  }

  return {
    kind,
    item,
    form,
    readOnly,
    loading,
    loadError,
    saving,
    publishing,
    isPublished,
    isDirty,
    changes,
    draftBaseline,
    draftChanges,
    liveReading,
    campusKey: campusKeyRef,
    loadedCampusKey,
    compareWithLive,
    contextLabel,
    approver,
    publicUrl,
    previewUrl,
    apiPath,
    latestRevisionAt,
    latestRevisionId,
    liveVersion,
    neverPublished,
    history,
    load,
    save,
    publish,
    saveAndPublish,
    reviewStatus,
    reviewNote,
    submitForReview,
    review,
    schedules,
    loadSchedules,
    schedule,
    cancelSchedule,
    acknowledgeSchedule,
    reset,
    fieldErrors,
    conflict,
    inspectConflict,
    reloadLatest,
    stashedChanges,
    stashOverlap,
    restoreStash,
    discardStash,
  }
}
