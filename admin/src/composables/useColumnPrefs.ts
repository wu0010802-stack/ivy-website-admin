import { computed, ref, watch, type Ref } from 'vue'

// 表格顯示哪些欄（2026-11-27）：使用者勾掉用不到的欄，記在這台裝置的瀏覽器裡、依帳號分開。
// 只記「藏起來的欄」：之後表格多了新欄，預設會顯示，不必搬資料。

export interface ColumnOption { key: string; label: string }

const storageKey = (scope: string, userId: string) => `ivy-admin-columns:${scope}:${userId}`

export function readHiddenColumns(scope: string, userId: string, known: readonly string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(scope, userId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string' && known.includes(key)) : []
  } catch {
    return []
  }
}

export function useColumnPrefs(scope: string, userId: Ref<string | null | undefined>, columns: readonly ColumnOption[]) {
  const known = columns.map(column => column.key)
  const hidden = ref<string[]>([])
  watch(userId, (id) => { hidden.value = id ? readHiddenColumns(scope, id, known) : [] }, { immediate: true })

  function persist() {
    if (!userId.value) return
    try {
      if (hidden.value.length) localStorage.setItem(storageKey(scope, userId.value), JSON.stringify(hidden.value))
      else localStorage.removeItem(storageKey(scope, userId.value))
    } catch {
      /* 存不了就只在這次開著的期間有效 */
    }
  }

  /** 勾選框用：目前顯示的欄。 */
  const visible = computed<string[]>({
    get: () => known.filter(key => !hidden.value.includes(key)),
    set: (keys) => {
      hidden.value = known.filter(key => !keys.includes(key))
      persist()
    },
  })
  const shows = (key: string): boolean => !hidden.value.includes(key)
  const customized = computed(() => hidden.value.length > 0)
  function reset() {
    hidden.value = []
    persist()
  }
  return { visible, shows, customized, reset }
}
