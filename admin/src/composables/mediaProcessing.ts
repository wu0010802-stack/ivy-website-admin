import { onBeforeUnmount, watch } from 'vue'
import { api } from '../api/client'
import type { MediaAssetOut } from '../api/types'

// 影片上傳後在背景轉檔（後端 app/media/jobs.py）：處理中的素材每 POLL_MS 重讀一次，
// 轉好或失敗就停；一次最多讀 MAX_POLLED 個，分頁在背景時跳過這一輪。

export const POLL_MS = 5000
export const MAX_POLLED = 10

type StatusLike = Pick<MediaAssetOut, 'status'>

export function isProcessing(asset: StatusLike | null | undefined): boolean {
  return asset?.status === 'processing'
}

/** 素材庫卡片上的一句話；可用的回空字串。 */
export function processingNote(asset: Pick<MediaAssetOut, 'kind' | 'status' | 'processing_error'>): string {
  if (asset.status === 'processing') return asset.kind === 'video' ? '轉檔中，轉好才能預覽與發布；可以先選進草稿' : '處理中'
  if (asset.status === 'failed') return `處理失敗：${asset.processing_error ?? '原因不明'}`
  return ''
}

export function canRetryProcessing(asset: Pick<MediaAssetOut, 'kind' | 'status' | 'deleted_at'>): boolean {
  return asset.kind === 'video' && asset.status === 'failed' && !asset.deleted_at
}

export function useProcessingPoll(assets: () => MediaAssetOut[], onUpdate: (fresh: MediaAssetOut) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    timer = null
    if (stopped) return
    const pending = assets().filter(isProcessing).slice(0, MAX_POLLED)
    if (pending.length && !(typeof document !== 'undefined' && document.hidden)) {
      for (const asset of pending) {
        try {
          const fresh = await api.get<MediaAssetOut>(`/admin/media/${asset.id}`)
          if (!stopped) onUpdate(fresh)
        } catch {
          // 讀不到就下一輪再試。
        }
      }
    }
    schedule()
  }

  function schedule() {
    if (stopped || timer || !assets().some(isProcessing)) return
    timer = setTimeout(() => void tick(), POLL_MS)
  }

  watch(() => assets().filter(isProcessing).map((a) => a.id).join(','), schedule, { immediate: true })
  onBeforeUnmount(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })
  return { schedule }
}
