import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'

// 頁首與總覽待辦的數字：給自己的內容通知未讀數（DESIGN 第六輪）。側欄「參觀案件」
// 原本掛新需求＋待園方確認，2026-10-05 拿掉「待處理」後不再有數字；家長改期申請待核准數
// 隨 2026-10-08 刪除申請流程一併拿掉。與總覽同一個來源
// （/admin/dashboard），不另開計數 API。換頁時才重抓，而且 30 秒內不重複打；案件狀態變了強制重抓。
// 總覽要的是完整彙總，透過 loadSummary 和外殼共用同一個進行中的請求：
// 進總覽時外殼的換頁刷新與總覽自己的讀取只打一次。
export const STALE_MS = 30_000

export interface OpenRequestCounts {
  my_unread_notifications?: number
}

export const useOpenRequestsStore = defineStore('openRequests', () => {
  const myNotices = ref(0)
  let fetchedAt = 0
  let inflight: Promise<OpenRequestCounts> | null = null
  // 登出（reset）後才回來的舊請求不能算數：數字與總覽彙總（含家長姓名）屬於上一位使用者。
  let session = 0

  function apply(counts: OpenRequestCounts): void {
    myNotices.value = counts.my_unread_notifications ?? 0
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
    myNotices.value = 0
    fetchedAt = 0
    // 下一位登入的人要重新讀，不接上一個人還在路上的請求。
    session += 1
    inflight = null
  }

  return { myNotices, apply, loadSummary, refresh, reset }
})
