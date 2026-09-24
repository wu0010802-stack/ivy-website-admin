import { computed, h, ref, unref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { ContentItemOut } from '../api/types'
import { contentFieldLabel, contentPreviewPath, contentPublicPath } from '../api/labels'
import { WEBSITE_ASSET_BASE } from '../config'
import { useRequestSequence } from './useRequestSequence'

/** 發布確認框列出的一筆差異：欄位中文名、上次儲存的值、現在的值 */
export interface FieldChange {
  key: string
  label: string
  before: string
  after: string
}

// 把欄位值壓成一行給確認框看；陣列與物件不逐項比，只講「N 項」。
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

export function diffPayload(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, label: contentFieldLabel(key), before: summarizeValue(before[key]), after: summarizeValue(after[key]) }))
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
  /** 私有草稿預覽網址；沒有對應預覽頁的內容為空字串 */
  previewUrl?: ComputedRef<string>
  /** 版本紀錄要打的 API 路徑（含 campus_key），例如 /admin/content-items/home_about */
  apiPath?: ComputedRef<string>
  /** 把舊版複製成新草稿 */
  restore?: (revisionId: string) => Promise<boolean>
  /** 直接把指定版本發布到官網（回到舊版） */
  publishRevision?: (revisionId: string) => Promise<boolean>
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

  /** 舊版複製成新草稿，載入到表單。有未儲存修改時由呼叫端先確認。 */
  async function restore(revisionId: string): Promise<boolean> {
    if (!item.value) return false
    saving.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/restore${query()}`, {
        revision_id: revisionId,
        expected_version: item.value.latest_version,
      })
      form.value = withDefaults(item.value.latest_revision?.payload)
      isPublished.value = false
      takeSnapshot()
      ElMessage.success('已把舊版放回草稿，確認沒問題再發布')
      return true
    } catch (err) {
      ElMessage.error(errorMessage(err, '還原失敗'))
      return false
    } finally {
      saving.value = false
    }
  }

  function reset() {
    if (!snapshot.value) return
    form.value = JSON.parse(snapshot.value) as TPayload
  }

  return {
    item,
    form,
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
    load,
    save,
    publish,
    saveAndPublish,
    publishRevision,
    restore,
    reset,
  }
}
