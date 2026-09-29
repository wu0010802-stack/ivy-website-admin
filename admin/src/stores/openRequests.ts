import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'

// 側欄「參觀案件」旁的數字：新需求＋待園方確認。側欄只有這一項掛數字（DESIGN 第五輪，
// 2026-09-29 業主再確認），待核准改期與內容通知看總覽和各自的頁面。與總覽同一個來源
// （/admin/dashboard），不另開計數 API。換頁時才重抓，而且 30 秒內不重複打；案件狀態變了強制重抓。
// 總覽要的是完整彙總，透過 loadSummary 和側欄共用同一個進行中的請求：
// 進總覽時外殼的換頁刷新與總覽自己的讀取只打一次。
export const STALE_MS = 30_000

export interface OpenRequestCounts {
  new_requests?: number
  awaiting_confirmation?: number
}

export const useOpenRequestsStore = defineStore('openRequests', () => {
  const newRequests = ref(0)
  const awaiting = ref(0)
  let fetchedAt = 0
  let inflight: Promise<OpenRequestCounts> | null = null
  // 登出（reset）後才回來的舊請求不能算數：數字與總覽彙總（含家長姓名）屬於上一位使用者。
  let session = 0

  const total = computed(() => newRequests.value + awaiting.value)

  function apply(counts: OpenRequestCounts): void {
    newRequests.value = counts.new_requests ?? 0
    awaiting.value = counts.awaiting_confirmation ?? 0
    fetchedAt = Date.now()
  }

  // 讀一次完整的總覽彙總並更新側欄數字；已經有請求在路上就等同一個。
  // 讀取失敗會往上拋，總覽要把錯誤顯示出來（側欄的 refresh 自己吞掉）。
  function loadSummary<T extends OpenRequestCounts>(): Promise<T> {
    if (!inflight) {
      const started = session
      const request = api.get<T>('/admin/dashboard')
        .then((summary) => { if (started === session) apply(summary); return summary })
        .finally(() => { if (inflight === request) inflight = null })
      inflight = request
    }
    return inflight as Promise<T>
  }

  async function refresh(force = false): Promise<void> {
    if (!inflight && !force && Date.now() - fetchedAt < STALE_MS) return
    try {
      await loadSummary()
    } catch {
      // 數字只是提醒，讀不到就維持上一次的值，不打斷操作。
    }
  }

  function reset(): void {
    newRequests.value = 0
    awaiting.value = 0
    fetchedAt = 0
    // 下一位登入的人要重新讀，不接上一個人還在路上的請求。
    session += 1
    inflight = null
  }

  return { newRequests, awaiting, total, apply, loadSummary, refresh, reset }
})
