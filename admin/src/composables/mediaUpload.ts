import { computed, ref } from 'vue'
import { api, ApiError } from '../api/client'
import type { MediaAssetOut, MediaUploadLimitsOut } from '../api/types'
import { formatFileSize } from '../api/labels'

// 素材庫與選圖器共用的多檔上傳：一次選很多張（活動照片常常幾十張），逐檔
// 呼叫既有的單檔 API，同時最多傳 UPLOAD_CONCURRENCY 個，每個檔案各自顯示
// 狀態與失敗原因；一個失敗不影響其他檔案。

export const UPLOAD_CONCURRENCY = 2

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed'

export interface UploadItem {
  id: number
  file: File
  kind: 'image' | 'video'
  status: UploadStatus
  error: string | null
  asset: MediaAssetOut | null
}

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  queued: '等待上傳',
  uploading: '上傳中',
  done: '完成',
  failed: '失敗',
}

// 規格 L137：JPEG、PNG、WebP 與 MP4（後端另外用實際內容再驗一次）。
const DEFAULT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEFAULT_VIDEO_TYPES = ['video/mp4']

let limitsCache: Promise<MediaUploadLimitsOut | null> | null = null

/** 單檔上限與可接受的格式（部署設定）。讀不到就回 null，交給後端擋。 */
export function loadUploadLimits(): Promise<MediaUploadLimitsOut | null> {
  limitsCache ??= api.get<MediaUploadLimitsOut>('/admin/media/upload-limits').catch(() => {
    limitsCache = null
    return null
  })
  return limitsCache
}

/** 測試用：清掉快取的上限。 */
export function resetUploadLimits(): void {
  limitsCache = null
}

export function uploadFormatHint(limits: MediaUploadLimitsOut | null): string {
  if (!limits) return 'JPG、PNG、WebP 或 MP4'
  return `JPG、PNG、WebP（${formatFileSize(limits.max_image_bytes)} 內）或 MP4（${formatFileSize(limits.max_video_bytes)} 內）`
}

export function mediaKindOf(file: File): 'image' | 'video' {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

/** 送出前就看得出來的問題（格式、大小）；沒問題回 null。 */
export function precheckFile(
  file: File,
  limits: MediaUploadLimitsOut | null,
  allowed: 'image' | 'video' | 'any' = 'any',
): string | null {
  const kind = mediaKindOf(file)
  if (allowed === 'image' && kind !== 'image') return '這裡只能上傳照片'
  if (allowed === 'video' && kind !== 'video') return '這裡只能上傳影片（MP4）'
  const types = kind === 'video' ? (limits?.video_types ?? DEFAULT_VIDEO_TYPES) : (limits?.image_types ?? DEFAULT_IMAGE_TYPES)
  // 有些瀏覽器拿不到 type（空字串），交給後端判斷實際內容。
  if (file.type && !types.includes(file.type)) return '格式不支援，只接受 JPG、PNG、WebP 或 MP4'
  const max = kind === 'video' ? limits?.max_video_bytes : limits?.max_image_bytes
  if (max && file.size > max) return `檔案超過 ${formatFileSize(max)}`
  return null
}

export function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { message?: string } | string | null
    if (detail && typeof detail === 'object' && detail.message) return detail.message
    if (typeof detail === 'string' && detail && !/^HTTP \d+$/.test(detail)) return detail
    if (err.status === 413) return '檔案太大'
    if (err.status === 409) return '素材空間已滿'
  }
  return '上傳失敗，請稍後再試'
}

export function useMediaUploadQueue(options: {
  /** 上傳到哪一校；null／空字串＝跨校共用 */
  campusKey: () => string | null | undefined
  /** 只有一張照片時才帶的圖片說明（多張時到「編輯」各自補） */
  altText?: () => string
  allowed?: 'image' | 'video' | 'any'
}) {
  const items = ref<UploadItem[]>([])
  const running = ref(false)
  let nextId = 1

  async function add(files: FileList | File[] | null | undefined) {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const limits = await loadUploadLimits()
    for (const file of list) {
      const error = precheckFile(file, limits, options.allowed)
      items.value.push({
        id: nextId++,
        file,
        kind: mediaKindOf(file),
        status: error ? 'failed' : 'queued',
        error,
        asset: null,
      })
    }
  }

  function remove(id: number) {
    if (running.value) return
    items.value = items.value.filter((item) => item.id !== id)
  }

  function reset() {
    if (running.value) return
    items.value = []
  }

  async function uploadOne(item: UploadItem, alt: string) {
    item.status = 'uploading'
    item.error = null
    const formData = new FormData()
    formData.append('file', item.file)
    formData.append('kind', item.kind)
    const campusKey = options.campusKey()
    if (campusKey) formData.append('campus_key', campusKey)
    if (alt && item.kind === 'image') formData.append('alt_text', alt)
    try {
      item.asset = await api.upload<MediaAssetOut>('/admin/media', formData)
      item.status = item.asset.status === 'failed' ? 'failed' : 'done'
      if (item.status === 'failed') item.error = item.asset.processing_error ?? '處理失敗'
    } catch (err) {
      item.status = 'failed'
      item.error = uploadErrorMessage(err)
    }
  }

  /** 上傳所有等待中的檔案，回傳這一輪成功的素材。 */
  async function start(): Promise<MediaAssetOut[]> {
    if (running.value) return []
    const pending = items.value.filter((item) => item.status === 'queued')
    if (!pending.length) return []
    const alt = pending.length === 1 ? (options.altText?.() ?? '').trim() : ''
    running.value = true
    try {
      let cursor = 0
      const worker = async () => {
        while (cursor < pending.length) {
          const item = pending[cursor++]!
          // 透過 items.value 取回 reactive proxy，狀態變化才會即時顯示。
          const live = items.value.find((candidate) => candidate.id === item.id) ?? item
          await uploadOne(live, alt)
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker))
    } finally {
      running.value = false
    }
    return pending
      .map((item) => items.value.find((candidate) => candidate.id === item.id)?.asset)
      .filter((asset): asset is MediaAssetOut => Boolean(asset && asset.status !== 'failed'))
  }

  const counts = computed(() => {
    const out = { queued: 0, uploading: 0, done: 0, failed: 0 }
    for (const item of items.value) out[item.status] += 1
    return out
  })

  return { items, running, counts, add, remove, reset, start }
}
