import type { BookingConfig } from '~/utils/booking-action'

interface PublicBookingConfigResponse {
  campus_key: string
  mode: BookingConfig['mode']
  version: number
  line_url: string | null
  phone: string | null
  external_url: string | null
  message: string | null
}

/**
 * 即時讀某校目前的預約設定。校區切換時 useAsyncData 的 key 會跟著
 * 變，Nuxt 會自動取消上一個還在飛行中的請求，不會有「切校後舊校的
 * 回應晚到蓋掉新校資料」的問題。
 */
export function useCampusBooking(campusKey: Ref<string | null> | string | null) {
  const key = computed(() => (typeof campusKey === 'string' ? campusKey : campusKey?.value ?? null))

  return useAsyncData<BookingConfig | null>(
    () => `booking-config-${key.value ?? 'none'}`,
    async () => {
      if (!key.value) return null
      try {
        const response = await $fetch<PublicBookingConfigResponse>(
          `/api/website/v1/public/booking-config/${key.value}`
        )
        return {
          mode: response.mode,
          version: response.version,
          message: response.message,
          line_url: response.line_url,
          phone: response.phone,
          external_url: response.external_url
        }
      } catch {
        // 校區不存在或後端暫時不可用：安全地當成「暫停」，不假造成
        // 可預約的樣子，也不讓整頁因此壞掉。
        return { mode: 'paused', version: 0, message: null }
      }
    },
    { watch: [key] }
  )
}
