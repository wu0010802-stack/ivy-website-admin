import { computed, ref, watch, type Ref } from 'vue'

// 常用篩選（2026-11-27）：把列表目前套用的條件取個名字存起來，下次一鍵套回。
// 存在這台裝置的瀏覽器裡（同側欄開合、動效偏好），依帳號分開；換裝置要重存。
// 搜尋字與頁數不存：搜尋字常是家長電話或姓名，不該留在瀏覽器儲存空間（2026-10-22 資安稽核同一個理由）。

export type ViewSnapshot = Record<string, string>
export interface SavedView { id: string; name: string; snapshot: ViewSnapshot }

export const SAVED_VIEW_LIMIT = 12
export const SAVED_VIEW_NAME_MAX = 20

const storageKey = (scope: string, userId: string) => `ivy-admin-saved-views:${scope}:${userId}`

/** 條件比對用：鍵排序後串起來，兩份條件一樣就得到同一個字串。 */
export function snapshotKey(snapshot: ViewSnapshot): string {
  return JSON.stringify(Object.entries(snapshot).filter(([, value]) => value !== '').sort(([a], [b]) => a.localeCompare(b)))
}

function isView(value: unknown): value is SavedView {
  if (!value || typeof value !== 'object') return false
  const view = value as Record<string, unknown>
  return typeof view.id === 'string' && typeof view.name === 'string' && Boolean(view.snapshot) && typeof view.snapshot === 'object'
    && Object.values(view.snapshot as object).every(item => typeof item === 'string')
}

export function readSavedViews(scope: string, userId: string): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(scope, userId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isView).slice(0, SAVED_VIEW_LIMIT) : []
  } catch {
    // 私密視窗、封鎖 site data 或內容壞掉：當作沒存過。
    return []
  }
}

export function useSavedViews(scope: string, userId: Ref<string | null | undefined>) {
  const views = ref<SavedView[]>([])
  watch(userId, (id) => { views.value = id ? readSavedViews(scope, id) : [] }, { immediate: true })

  function persist(): boolean {
    if (!userId.value) return false
    try {
      localStorage.setItem(storageKey(scope, userId.value), JSON.stringify(views.value))
      return true
    } catch {
      return false
    }
  }

  const full = computed(() => views.value.length >= SAVED_VIEW_LIMIT)

  /** 同名的直接換成新的條件；回傳 false 代表這台裝置存不了（私密視窗等）。 */
  function save(name: string, snapshot: ViewSnapshot): boolean {
    const clean = name.trim().slice(0, SAVED_VIEW_NAME_MAX)
    if (!clean) return false
    const previous = views.value
    const existing = previous.find(view => view.name === clean)
    views.value = existing
      ? previous.map(view => (view === existing ? { ...view, snapshot: { ...snapshot } } : view))
      : [...previous, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: clean, snapshot: { ...snapshot } }].slice(0, SAVED_VIEW_LIMIT)
    if (persist()) return true
    views.value = previous
    return false
  }

  function remove(id: string) {
    views.value = views.value.filter(view => view.id !== id)
    persist()
  }

  return { views, full, save, remove }
}
