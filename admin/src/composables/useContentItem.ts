import { ref, unref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { ContentItemOut } from '../api/types'

export function useContentItem<TPayload extends object>(
  kind: string,
  emptyPayload: TPayload,
  campusKey?: Ref<string> | string,
) {
  const item = ref<ContentItemOut | null>(null)
  const form = ref<TPayload>({ ...emptyPayload })
  const saving = ref(false)
  const publishing = ref(false)
  const isPublished = ref(false)

  // campusKey 可以是固定字串（共用 kind 不需要），也可以是隨畫面上校
  // 區選單變動的 ref（分校內容）；每次呼叫都重新讀目前的值，不在建立
  // composable 當下就寫死。
  function query(): string {
    const key = unref(campusKey)
    return key ? `?campus_key=${encodeURIComponent(key)}` : ''
  }

  async function load() {
    item.value = await api.get<ContentItemOut>(`/admin/content-items/${kind}${query()}`)
    form.value = item.value.latest_revision
      ? { ...(item.value.latest_revision.payload as TPayload) }
      : { ...emptyPayload }
    isPublished.value = Boolean(
      item.value.latest_revision &&
        item.value.current_published_revision_id === item.value.latest_revision.id,
    )
  }

  function reportError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.error('內容已被其他人更新，請重新載入後再試')
    } else if (err instanceof ApiError) {
      ElMessage.error(typeof err.detail === 'object' ? JSON.stringify(err.detail) : String(err.detail))
    } else {
      ElMessage.error(fallback)
    }
  }

  async function save() {
    if (!item.value) return
    saving.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/revisions${query()}`, {
        expected_version: item.value.latest_version,
        payload: form.value,
      })
      isPublished.value = false
      ElMessage.success('已儲存草稿')
    } catch (err) {
      reportError(err, '儲存失敗')
    } finally {
      saving.value = false
    }
  }

  async function publish() {
    if (!item.value?.latest_revision) return
    publishing.value = true
    try {
      item.value = await api.post<ContentItemOut>(`/admin/content-items/${kind}/publish${query()}`, {
        revision_id: item.value.latest_revision.id,
      })
      isPublished.value = true
      ElMessage.success('已發布到官網')
    } catch (err) {
      reportError(err, '發布失敗')
    } finally {
      publishing.value = false
    }
  }

  return { item, form, saving, publishing, isPublished, load, save, publish }
}
