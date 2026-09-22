import { computed, ref, watch, type Ref } from 'vue'
import { CAMPUS_KEYS } from '../api/types'
import { useAuthStore } from '../stores/auth'

// 目前登入者看得到的校區：總管理者五校全開，校區管理者只有自己的範圍。
// 九個頁面原本各自複製這段，集中在這裡；`selected` 會自動帶入第一個
// 可見校區，頁面只要 watch 它就好。
export function useCampusScope(options: { autoSelect?: boolean } = {}) {
  const { autoSelect = true } = options
  const authStore = useAuthStore()

  const isSuperAdmin = computed(() => authStore.user?.role === 'super_admin')

  const visibleCampusKeys = computed<string[]>(() => {
    if (isSuperAdmin.value) return [...CAMPUS_KEYS]
    return authStore.user?.campus_keys ?? []
  })

  const selected: Ref<string> = ref('')

  function ensureSelection() {
    if (!autoSelect) return
    const keys = visibleCampusKeys.value
    if (keys.length === 0) {
      selected.value = ''
      return
    }
    if (!keys.includes(selected.value)) selected.value = keys[0]!
  }

  watch(visibleCampusKeys, ensureSelection, { immediate: true })

  return { isSuperAdmin, visibleCampusKeys, selected }
}
