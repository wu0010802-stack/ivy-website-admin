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
  privacy_notice?: { title: string; sections: { heading: string; body: string }[] } | null
  turnstile_site_key?: string | null
  parent_email_enabled?: boolean
}

// 選校頁（VisitForm 的選校卡）一次讀五校、選定後 useCampusBooking 再讀所選那校：兩邊共用
// nuxtApp.payload.data 的同一個 key，選校時不再重抓（2026-10-20）。快取只在讀到後 5 分鐘內有效，
// 手動 refresh（重試、送出時 BOOKING_CONFIG_CHANGED）一律重抓；版本仍由送出時的 config_version 把關。
const FRESH_MS = 5 * 60_000
const fetchedAt = new WeakMap<object, number>()
const inflight = new Map<string, Promise<BookingConfig>>()

export const bookingConfigKey = (campusKey: string | null) => `booking-config-${campusKey ?? 'none'}`

type NuxtAppLike = { isHydrating?: boolean; payload: { data: Record<string, unknown> } }

/** 已讀過而且還新鮮的設定；沒有就回 undefined（hydration 時沿用 SSR payload，比照 Nuxt 預設）。 */
export function cachedCampusBooking(nuxtApp: NuxtAppLike, key: string): BookingConfig | undefined {
  const cached = nuxtApp.payload.data[key] as BookingConfig | null | undefined
  if (nuxtApp.isHydrating) return cached ?? undefined
  const at = cached ? fetchedAt.get(cached) : undefined
  return cached && at !== undefined && Date.now() - at < FRESH_MS ? cached : undefined
}

/** 打 API 讀一校設定；同一校同時只發一個請求。失敗照樣丟出（呼叫端決定要顯示錯誤或略過）。 */
export function fetchCampusBooking(campusKey: string): Promise<BookingConfig> {
  const running = inflight.get(campusKey)
  if (running) return running
  const request = (async () => {
    // 交給 useAsyncData 的 error 保存失敗狀態；不能把連線失敗偽裝成
    // 園方設定的 paused。呼叫端可提供 refresh，也不沿用失效設定送單。
    const response = await $fetch<PublicBookingConfigResponse>(
      `/api/website/v1/public/booking-config/${campusKey}`
    )
    const config: BookingConfig = {
      mode: response.mode,
      version: response.version,
      message: response.message,
      line_url: response.line_url,
      phone: response.phone,
      external_url: response.external_url,
      privacy_notice: privacyNotice(response.privacy_notice?.title, response.privacy_notice?.sections),
      // 有值時表單要先通過 Turnstile 才能送出（沒設定的部署維持原樣）。
      turnstile_site_key: response.turnstile_site_key || null,
      // 結果頁依此決定能不能說「確認信已寄出」；舊版 API 沒有這個欄位就當沒開。
      parent_email_enabled: response.parent_email_enabled ?? false
    }
    fetchedAt.set(config, Date.now())
    return config
  })()
  // 只在瀏覽器合併同時發出的請求：伺服器端模組狀態是所有請求共用的，不能跨請求沿用。
  if (import.meta.client) {
    inflight.set(campusKey, request)
    void request.finally(() => inflight.delete(campusKey)).catch(() => {})
  }
  return request
}

/** 選校卡用：先看快取，沒有才讀，讀到的放進同一個 key，之後選這校就不再重抓。 */
export async function loadCampusBooking(nuxtApp: NuxtAppLike, campusKey: string): Promise<BookingConfig> {
  const key = bookingConfigKey(campusKey)
  const cached = cachedCampusBooking(nuxtApp, key)
  if (cached) return cached
  const config = await fetchCampusBooking(campusKey)
  // 所選校區的 useAsyncData 可能同時讀到更新的一份，已有新鮮值就不蓋掉。
  if (!cachedCampusBooking(nuxtApp, key)) nuxtApp.payload.data[key] = config
  return config
}

/**
 * 即時讀某校目前的預約設定。校區切換時 useAsyncData 的 key 會跟著
 * 變，Nuxt 會自動取消上一個還在飛行中的請求，不會有「切校後舊校的
 * 回應晚到蓋掉新校資料」的問題。
 */
export function useCampusBooking(campusKey: Ref<string | null> | string | null) {
  const key = computed(() => (typeof campusKey === 'string' ? campusKey : campusKey?.value ?? null))

  return useAsyncData<BookingConfig | null>(
    () => bookingConfigKey(key.value),
    async () => (key.value ? fetchCampusBooking(key.value) : null),
    {
      watch: [key],
      // 選校卡讀過的設定（loadCampusBooking）直接沿用；手動 refresh 一律重抓。
      getCachedData: (cacheKey, nuxtApp, ctx) =>
        ctx.cause === 'refresh:manual' || ctx.cause === 'refresh:hook' ? undefined : cachedCampusBooking(nuxtApp, cacheKey)
    }
  )
}
