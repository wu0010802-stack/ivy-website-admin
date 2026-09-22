import { computed, ref, unref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { ContentItemOut } from '../api/types'
import { useRequestSequence } from './useRequestSequence'

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

  function takeSnapshot() {
    snapshot.value = JSON.stringify(form.value)
  }

  const isDirty = computed(() => JSON.stringify(form.value) !== snapshot.value)

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
      form.value = item.value.latest_revision
        ? clone(item.value.latest_revision.payload as TPayload)
        : clone(emptyPayload)
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
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/publish${query()}`, {
        revision_id: item.value.latest_revision.id,
      })
      isPublished.value = true
      ElMessage.success('已發布到官網')
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
    latestRevisionAt,
    neverPublished,
    load,
    save,
    publish,
    saveAndPublish,
    reset,
  }
}
