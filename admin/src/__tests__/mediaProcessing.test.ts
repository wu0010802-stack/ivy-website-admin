// 影片背景轉檔（後端 app/media/jobs.py）：狀態文案、能否重新處理、處理中輪詢。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { MediaAssetOut } from '../api/types'
import { canRetryProcessing, POLL_MS, processingNote, useProcessingPoll } from '../composables/mediaProcessing'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const base = { kind: 'video', status: 'ready', processing_error: null, deleted_at: null } as const

describe('狀態文案與重新處理', () => {
  it('處理中、失敗、可用各一句話', () => {
    expect(processingNote({ ...base, status: 'processing' })).toBe('轉檔中，轉好才能預覽與發布；可以先選進草稿')
    expect(processingNote({ ...base, status: 'failed', processing_error: '影片轉檔逾時（120 秒）' })).toBe('處理失敗：影片轉檔逾時（120 秒）')
    expect(processingNote({ ...base, status: 'failed' })).toBe('處理失敗：原因不明')
    expect(processingNote(base)).toBe('')
  })

  it('只有處理失敗、沒刪除的影片能重新處理', () => {
    expect(canRetryProcessing({ ...base, status: 'failed' })).toBe(true)
    expect(canRetryProcessing({ ...base, status: 'failed', kind: 'image' })).toBe(false)
    expect(canRetryProcessing({ ...base, status: 'failed', deleted_at: '2026-10-03T00:00:00Z' })).toBe(false)
    expect(canRetryProcessing({ ...base, status: 'processing' })).toBe(false)
  })
})

describe('上傳錯誤', () => {
  it('影片超過 10 分鐘：後端沒給訊息時也有直白的中文', () => {
    expect(apiErrorMessage(new ApiError(422, { code: 'MEDIA_VIDEO_TOO_LONG' }), '上傳失敗')).toBe('影片最長 10 分鐘，請剪短後再上傳')
  })
})

describe('處理中輪詢', () => {
  it('處理中的素材每 5 秒重讀一次，轉好就停', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const list = ref([{ id: 'v1', status: 'processing' } as MediaAssetOut])
    const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'v1', status: 'ready' } as never)
    const wrapper = mount(defineComponent({
      setup() {
        useProcessingPoll(() => list.value, (fresh) => { list.value = [fresh] })
        return () => h('div')
      },
    }))
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media/v1')
    expect(list.value[0]!.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(get).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('離開頁面就不再讀', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'v1', status: 'processing' } as never)
    const wrapper = mount(defineComponent({
      setup() {
        useProcessingPoll(() => [{ id: 'v1', status: 'processing' } as MediaAssetOut], () => {})
        return () => h('div')
      },
    }))
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(get).not.toHaveBeenCalled()
  })
})
