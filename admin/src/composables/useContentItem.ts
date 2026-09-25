import { computed, h, ref, unref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { ContentItemOut } from '../api/types'
import { contentFieldLabel, contentPreviewPath, contentPublicPath } from '../api/labels'
import { WEBSITE_ASSET_BASE } from '../config'
import { useRequestSequence } from './useRequestSequence'
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
  /** 未儲存的修改與上次儲存相比動了哪些欄位；ContentEditor 用來在發布前列給人看 */
  changes?: ComputedRef<FieldChange[]>
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
  history?: RevisionHistoryHandle
  load: () => Promise<void>
  save: () => Promise<boolean>
  saveAndPublish: () => Promise<boolean>
  reset: () => void
}

export function useContentItem<TPayload extends object>(
  kind: string,
  emptyPayload: TPayload,
  campusKey?: Ref<string> | string,
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
    return { ...clone(emptyPayload), ...clone(payload as TPayload) }
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
    if (err instanceof ApiError && err.status === 409) {
      return '內容已被其他人更新，請重新載入後再試'
    }
    if (err instanceof ApiError) {
      const d = err.detail
      if (typeof d === 'string') return d
      // FastAPI 的 422 驗證錯誤是一個陣列（每筆有 loc/msg/type），原本只
      // 處理字串與 {message}，所有欄位驗證失敗都會退回「儲存失敗」，
      // 使用者完全看不到是哪個欄位、為什麼不行。
      if (Array.isArray(d)) {
        const messages = d
          .map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : ''))
          .filter(Boolean)
          // pydantic 會在訊息前面加 "Value error, "，對使用者沒有意義。
          .map((msg) => msg.replace(/^Value error,\s*/, ''))
        if (messages.length) return messages.join('；')
      }
      if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message)
      return fallback
    }
    return err instanceof Error ? err.message : fallback
  }

  async function save(): Promise<boolean> {
    if (!item.value) return false
    saving.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/revisions${query()}`, {
        expected_version: item.value.latest_version,
        payload: form.value,
      })
      isPublished.value = false
      takeSnapshot()
      ElMessage.success('已儲存草稿，官網尚未更新')
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

  async function publishRevision(revisionId: string): Promise<boolean> {
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/publish${query()}`, {
        revision_id: revisionId,
      })
      isPublished.value = item.value.current_published_revision_id === item.value.latest_revision?.id
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
      ElMessage.error(errorMessage(err, '發布失敗'))
      return false
    } finally {
      publishing.value = false
    }
  }

  /** 先儲存目前修改再發布；表單沒改就直接發布最新草稿 */
  async function saveAndPublish(): Promise<boolean> {
    if (isDirty.value) {
      const ok = await save()
      if (!ok) return false
    }
    return publish()
  }

  async function submitForReview(): Promise<boolean> {
    if (isDirty.value && !(await save())) return false
    if (!item.value?.latest_revision) return false
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/submit${query()}`, {
        revision_id: item.value.latest_revision.id,
      })
      ElMessage.success('已送審，校區管理者核准後才會出現在官網')
      return true
    } catch (err) {
      ElMessage.error(errorMessage(err, '送審失敗'))
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
    if (isDirty.value && !(await save())) return false
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
      ElMessage.error(errorMessage(err, '排程失敗'))
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
    publicUrl,
    previewUrl,
    apiPath,
    latestRevisionAt,
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
    reset,
  }
}
