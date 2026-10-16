import { ref, watch, type Ref } from 'vue'
import { getOptions } from '../api/admissions'
import { ApiError } from '../api/client'
import { useRequestSequence } from '../composables/useRequestSequence'

/**
 * 招生開關（WEBSITE_ADMISSIONS_ENABLED）：關閉時後端整組 /admin/admissions/* 回 404。
 * 選定校區後先讀 options 判定：404 是 'off'（頁面顯示「尚未啟用」空狀態），其他錯誤照常當 'on'
 * （各分頁自己處理錯誤）。換校區重新判定，舊回應用 useRequestSequence 擋掉。
 * 招生入學與招生統計兩頁共用（2026-10-16 從 AdmissionsView 抽出）。
 */
export function useAdmissionsAvailability(campus: Ref<string>) {
  const availability = ref<'checking' | 'on' | 'off'>('checking')
  const requests = useRequestSequence()

  async function check() {
    if (!campus.value) return
    const request = requests.begin()
    try {
      await getOptions(campus.value)
      if (requests.isCurrent(request)) availability.value = 'on'
    } catch (err) {
      if (requests.isCurrent(request)) availability.value = err instanceof ApiError && err.status === 404 ? 'off' : 'on'
    }
  }

  watch(campus, () => void check(), { immediate: true })
  return availability
}
