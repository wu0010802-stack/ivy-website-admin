import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'

// 側欄「參觀案件」旁的數字：新需求＋待園方確認，與總覽同一個來源
// （/admin/dashboard），不另開計數 API。換頁時才重抓，而且 30 秒內
// 不重複打；總覽載入時直接把讀到的數字塞進來，案件狀態變了強制重抓。
const STALE_MS = 30_000

export interface OpenRequestCounts {
  new_requests?: number
  awaiting_confirmation?: number
}

export const useOpenRequestsStore = defineStore('openRequests', () => {
  const newRequests = ref(0)
  const awaiting = ref(0)
  let fetchedAt = 0
  let inflight: Promise<void> | null = null

  const total = computed(() => newRequests.value + awaiting.value)

  function apply(counts: OpenRequestCounts): void {
    newRequests.value = counts.new_requests ?? 0
    awaiting.value = counts.awaiting_confirmation ?? 0
    fetchedAt = Date.now()
  }

  async function refresh(force = false): Promise<void> {
    if (inflight) return inflight
    if (!force && Date.now() - fetchedAt < STALE_MS) return
    inflight = (async () => {
      try {
        apply(await api.get<OpenRequestCounts>('/admin/dashboard'))
      } catch {
        // 數字只是提醒，讀不到就維持上一次的值，不打斷操作。
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function reset(): void {
    newRequests.value = 0
    awaiting.value = 0
    fetchedAt = 0
  }

  return { newRequests, awaiting, total, apply, refresh, reset }
})
