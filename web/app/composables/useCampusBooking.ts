import type { BookingConfig } from '~/utils/booking-action'
import { privacyNotice } from '../utils/privacy-notice'

interface PublicBookingConfigResponse {
  campus_key: string
  mode: BookingConfig['mode']
  version: number
  line_url: string | null
  phone: string | null
  external_url: string | null
  message: string | null
  consent_revision_id?: string | null
  consent_text?: string | null
  privacy_notice?: { title: string; sections: { heading: string; body: string }[] } | null
  turnstile_site_key?: string | null
  parent_email_enabled?: boolean
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
      // 交給 useAsyncData 的 error 保存失敗狀態；不能把連線失敗偽裝成
      // 園方設定的 paused。呼叫端可提供 refresh，也不沿用失效設定送單。
      const response = await $fetch<PublicBookingConfigResponse>(
        `/api/website/v1/public/booking-config/${key.value}`
      )
      return {
        mode: response.mode,
        version: response.version,
        message: response.message,
        line_url: response.line_url,
        phone: response.phone,
        external_url: response.external_url,
        // 表單勾選框顯示的就是這一版的同意文字，送單帶同一個版本 id。
        consent_revision_id: response.consent_revision_id ?? null,
        consent_text: response.consent_text ?? null,
        privacy_notice: privacyNotice(response.privacy_notice?.title, response.privacy_notice?.sections),
        // 有值時表單要先通過 Turnstile 才能送出（沒設定的部署維持原樣）。
        turnstile_site_key: response.turnstile_site_key || null,
        // 結果頁依此決定能不能說「確認信已寄出」；舊版 API 沒有這個欄位就當沒開。
        parent_email_enabled: response.parent_email_enabled ?? false
      }
    },
    { watch: [key] }
  )
}
