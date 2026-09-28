import { computed, h, ref, unref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { ContentItemOut } from '../api/types'
import { contentFieldLabel, contentItemLabel, contentPreviewPath, contentPublicPath } from '../api/labels'
import { WEBSITE_ASSET_BASE } from '../config'
import { useRequestSequence } from './useRequestSequence'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
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

export function diffPayload(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => {
      const change: FieldChange = { key, label: contentFieldLabel(key), before: summarizeValue(before[key]), after: summarizeValue(after[key]) }
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
  list: () => Promise<RevisionSummary[]>
  payloadOf: (revisionId: string) => Promise<Record<string, unknown>>
  /** 目前已儲存的內容，用來列出「還原後哪些欄位會變」 */
  savedPayload: () => Record<string, unknown>
  restore: (revisionId: string, publish: boolean) => Promise<boolean>
}

// ContentEditor 外殼需要的狀態與動作；useContentItem 的回傳值結構上符合，
// 頁面把整個 handle 傳給 <ContentEditor :editor> 即可。
export interface ContentEditorState {
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
  /** 要上線的內容（表單）和官網目前的版本相比；讀不到官網版回 null。開確認框前才呼叫 */
  compareWithLive?: () => Promise<LiveComparison | null>
  /** 確認框標題用的內容名稱，分校內容帶校名，例如「各校常見問題（明華）」 */
  contextLabel?: ComputedRef<string>
  /** 最新一版的 id；排程列用來判斷排的是不是目前的草稿 */
  latestRevisionId?: ComputedRef<string | null>
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
  load: () => Promise<void>
  save: (options?: SaveOptions) => Promise<boolean>
  saveAndPublish: () => Promise<boolean>
  reset: () => void
}

export interface ContentItemOptions<TPayload> {
  /** 舊版內容的巢狀欄位補預設值或換算（例如消息的舊校區文字），在拍快照之前做 */
  normalize?: (payload: TPayload) => TPayload
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

  const isDirty = computed(() => JSON.stringify(form.value) !== snapshot.value)

  const changes = computed<FieldChange[]>(() => {
    if (!snapshot.value) return []
    return diffPayload(JSON.parse(snapshot.value) as Record<string, unknown>, form.value as Record<string, unknown>)
  })

  const publicUrl = computed(() => `${WEBSITE_ASSET_BASE}${contentPublicPath(kind, unref(campusKey))}`)
  const previewUrl = computed(() => {
    const path = contentPreviewPath(kind, unref(campusKey))
    return path ? `${WEBSITE_ASSET_BASE}${path}` : ''
  })
  const apiPath = computed(() => `/admin/content-items/${kind}${query()}`)
  const contextLabel = computed(() => contentItemLabel(kind, unref(campusKey)))
  // 共用內容（沒有 campusKey）要總管理者或被授權的人核准，分校內容是校區管理者。
  const approver = campusKey === undefined ? '總管理者' : '校區管理者'
  // 唯讀：分校內容看 content.manage；共用內容（沒有 campusKey）要有「全站
  // 共用內容」權限（總管理者或被授權的人，後端 can_edit_shared_content）。
  // store 在 computed 裡才取，單獨測這個 composable 時不需要 Pinia。
  const readOnly = computed(() => {
    const user = useAuthStore().user
    return !hasCapability(user, campusKey === undefined ? 'content.shared' : 'content.manage')
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

  async function load() {
    const request = requests.begin()
    loading.value = true
    loadError.value = null
    try {
      const result = await api.get<ContentItemOut>(`/admin/content-items/${kind}${query()}`)
      if (!requests.isCurrent(request)) return
      item.value = result
      form.value = withDefaults(item.value.latest_revision?.payload)
      isPublished.value = Boolean(
        item.value.latest_revision &&
          item.value.current_published_revision_id === item.value.latest_revision.id,
      )
      takeSnapshot()
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
    return apiErrorMessage(err, fallback)
  }

  // 「儲存並發布」這類兩段動作：先儲存成功、後一段失敗時，要講清楚草稿已經
  // 存了，不然使用者會以為什麼都沒留下而重做一次。
  function afterSaveError(savedFirst: boolean, err: unknown, action: string): string {
    return savedFirst ? `已存成草稿，但${action}失敗：${errorMessage(err, '請稍後再試')}` : errorMessage(err, `${action}失敗`)
  }

  async function save(options: SaveOptions = {}): Promise<boolean> {
    if (!item.value) return false
    saving.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/revisions${query()}`, {
        expected_version: item.value.latest_version,
        payload: form.value,
      })
      isPublished.value = false
      takeSnapshot()
      if (!options.silent) ElMessage.success('已儲存草稿，官網尚未更新')
      return true
    } catch (err) {
      ElMessage.error(errorMessage(err, '儲存失敗'))
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
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/publish${query()}`, {
        revision_id: revisionId,
      })
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
      ElMessage.error(afterSaveError(savedFirst, err, '發布'))
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
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/submit${query()}`, {
        revision_id: item.value.latest_revision.id,
      })
      ElMessage.success(`已送審，${approver}核准後才會出現在官網`)
      return true
    } catch (err) {
      ElMessage.error(afterSaveError(savedFirst, err, '送審'))
      return false
    } finally {
      publishing.value = false
    }
  }

  async function review(decision: 'approve' | 'reject', note?: string): Promise<boolean> {
    if (!item.value?.latest_revision) return false
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/review${query()}`, {
        revision_id: item.value.latest_revision.id,
        decision,
        note: note ?? null,
      })
      isPublished.value = item.value.current_published_revision_id === item.value.latest_revision?.id
      if (decision === 'approve') void loadSchedules()
      ElMessage.success(decision === 'approve' ? '已核准並發布到官網' : '已退回，編輯會看到你寫的原因')
      return true
    } catch (err) {
      ElMessage.error(errorMessage(err, decision === 'approve' ? '核准失敗' : '退回失敗'))
      return false
    } finally {
      publishing.value = false
    }
  }

  async function loadSchedules(): Promise<void> {
    try {
      const list = await api.get<PublishJob[]>(`/admin/content-items/${kind}/schedules${query()}`)
      schedules.value = Array.isArray(list) ? list : []
    } catch {
      schedules.value = []
    }
  }

  async function schedule(publishAt: string): Promise<boolean> {
    const savedFirst = isDirty.value
    if (savedFirst && !(await save({ silent: true }))) return false
    if (!item.value?.latest_revision) return false
    publishing.value = true
    try {
      await api.post<PublishJob>(`/admin/content-items/${kind}/schedules${query()}`, {
        revision_id: item.value.latest_revision.id,
        publish_at: publishAt,
      })
      await loadSchedules()
      ElMessage.success('已排程，時間到會自動發布')
      return true
    } catch (err) {
      ElMessage.error(afterSaveError(savedFirst, err, '排程'))
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
      ElMessage.error(errorMessage(err, '取消失敗'))
      return false
    }
  }

  async function acknowledgeSchedule(jobId: string): Promise<boolean> {
    try {
      await api.post<PublishJob>(`/admin/content-items/${kind}/schedules/${jobId}/acknowledge${query()}`)
      await loadSchedules()
      return true
    } catch (err) {
      ElMessage.error(errorMessage(err, '操作失敗'))
      return false
    }
  }

  const history: RevisionHistoryHandle = {
    list: () => api.get<RevisionSummary[]>(`/admin/content-items/${kind}/revisions${query()}`),
    async payloadOf(revisionId) {
      const revision = await api.get<{ payload: Record<string, unknown> }>(
        `/admin/content-items/${kind}/revisions/${revisionId}${query()}`,
      )
      return revision.payload
    },
    savedPayload: () => (item.value?.latest_revision?.payload as Record<string, unknown> | undefined) ?? {},
    async restore(revisionId, publishNow) {
      if (!item.value) return false
      const busyFlag = publishNow ? publishing : saving
      busyFlag.value = true
      try {
        item.value = await api.post<ContentItemOut>(
          `/admin/content-items/${kind}/revisions/${revisionId}/restore${query()}`,
          { expected_version: item.value.latest_version, publish: publishNow },
        )
        form.value = withDefaults(item.value.latest_revision!.payload)
        isPublished.value = publishNow
        takeSnapshot()
        if (publishNow) void loadSchedules()
        ElMessage.success(publishNow ? '已還原並發布到官網' : '已還原成草稿，官網尚未更新')
        return true
      } catch (err) {
        ElMessage.error(errorMessage(err, '還原失敗'))
        return false
      } finally {
        busyFlag.value = false
      }
    },
  }

  // 官網上的版本不會再變（改內容是另存新版），讀過一次就記住，不用每次開確認框都重抓。
  const livePayloads = new Map<string, unknown>()

  // 發布、核准前才讀官網版（不在載入時多打一次 API）。舊版內容缺少後來新增的
  // 欄位，要先經過 withDefaults／normalize 才跟表單比，否則會多出「（空白）→
  // （空白）」這類假差異。
  async function compareWithLive(): Promise<LiveComparison | null> {
    const current = item.value
    if (!current) return null
    const liveId = current.current_published_revision_id
    if (!liveId) return { firstPublish: true, changes: [] }
    try {
      let payload: unknown = livePayloads.get(liveId)
      if (payload === undefined) {
        payload = liveId === current.latest_revision?.id ? current.latest_revision.payload : await history.payloadOf(liveId)
        if (!isPlainObject(payload)) return null
        livePayloads.set(liveId, payload)
      }
      const live = withDefaults(payload) as Record<string, unknown>
      return { firstPublish: false, changes: diffPayload(live, form.value as Record<string, unknown>) }
    } catch {
      return null
    }
  }

  function reset() {
    if (!snapshot.value) return
    form.value = JSON.parse(snapshot.value) as TPayload
  }

  return {
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
    compareWithLive,
    contextLabel,
    approver,
    publicUrl,
    previewUrl,
    apiPath,
    latestRevisionAt,
    latestRevisionId,
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
  }
}
