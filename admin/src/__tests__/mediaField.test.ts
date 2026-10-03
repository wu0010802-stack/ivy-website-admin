// 2026-10-03 第八輪：選照片／影片統一成 MediaFieldCard＋MediaSlotField／MediaRefField
// （稽核 09-28「選照片／影片有四種元件」）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h, ref } from 'vue'
import ElementPlus from 'element-plus'
import MediaRefField from '../components/MediaRefField.vue'
import { api } from '../api/client'
import type { MediaAssetOut } from '../api/types'
import { resetUploadLimits } from '../composables/mediaUpload'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetUploadLimits()
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mediaAsset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: ID, campus_key: null, kind: 'image', status: 'ready', original_filename: 'garden.jpg',
    content_type: 'image/jpeg', size_bytes: 2048, width: 2000, height: 1500, duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z', created_by_email: null, archived_at: null, deleted_at: null,
    purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null,
    usage_count: 0, used_in: [], version: 1,
    variants: [{ id: 'v1', kind: 'thumbnail', content_type: 'image/webp', width: 480, height: 360 }],
    ...overrides,
  }
}

function mountRef(props: Record<string, unknown>) {
  const value = ref(String(props.modelValue ?? ''))
  const events: { picked: [string, string | null][]; cleared: number } = { picked: [], cleared: 0 }
  const wrapper = mount(() => h(MediaRefField, {
    ...props,
    modelValue: value.value,
    'onUpdate:modelValue': (v: string) => (value.value = v),
    onPicked: (asset: MediaAssetOut, previous: string | null) => events.picked.push([asset.id, previous]),
    onCleared: () => (events.cleared += 1),
  }), { global: { plugins: [ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, value, events }
}

const buttonTexts = (wrapper: VueWrapper) => wrapper.findAll('.media-field__actions button').map((b) => b.text())

describe('MediaRefField', () => {
  it('沒選、有內建：寫「目前用…」，按鈕是「從素材庫選…」，沒有清除鈕', () => {
    const { wrapper } = mountRef({ modelValue: '', noun: '圖片', builtin: '首頁大圖', clearLabel: '改回首頁大圖' })
    expect(wrapper.text()).toContain('目前用首頁大圖')
    expect(buttonTexts(wrapper)).toEqual(['從素材庫選圖片'])
    expect(wrapper.get('.media-field__thumb').classes()).toContain('is-builtin')
  })

  it('沒選、沒有內建、必填：寫「請從素材庫選一張照片」並標成錯誤', () => {
    const { wrapper } = mountRef({ modelValue: '', required: true, clearable: false })
    const help = wrapper.get('.media-field__info .field-help')
    expect(help.text()).toBe('請從素材庫選一張照片')
    expect(help.classes()).toContain('is-error')
  })

  it('素材庫照片：載縮圖，讀不到退回原檔，原檔也讀不到請重選；按鈕「更換照片」「移除照片」', async () => {
    const { wrapper, value, events } = mountRef({ modelValue: ID })
    const img = () => wrapper.find('.media-field__thumb img')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/variants/thumbnail`)
    expect(buttonTexts(wrapper)).toEqual(['更換照片', '移除照片'])
    await img().trigger('error')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/file`)
    await img().trigger('error')
    expect(img().exists()).toBe(false)
    expect(wrapper.text()).toContain('讀不到這張照片，請重新選擇')

    await wrapper.findAll('.media-field__actions button')[1]!.trigger('click')
    expect(value.value).toBe('')
    expect(events.cleared).toBe(1)
  })

  it('舊示意內容的官網內建代號：寫「目前用官網內建的照片」', () => {
    const { wrapper } = mountRef({ modelValue: 'campus' })
    expect(wrapper.text()).toContain('目前用官網內建的照片')
    expect(wrapper.get('.media-field__thumb img').attributes('src')).toMatch(/\/assets\/campus\.webp$/)
  })

  it('素材還在處理或處理失敗：標出狀態（給背景轉檔用）', () => {
    expect(mountRef({ modelValue: ID, status: 'processing' }).wrapper.get('.media-field__status').text()).toBe('處理中')
    expect(mountRef({ modelValue: ID, status: 'failed' }).wrapper.get('.media-field__status').text()).toBe('失敗')
    expect(mountRef({ modelValue: ID, status: 'ready' }).wrapper.find('.media-field__status').exists()).toBe(false)
  })

  it('從選圖器選一張：先更新值、再回報 picked（附上選之前的值）', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      return [mediaAsset({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original_filename: 'new.jpg' })] as never
    })
    const { wrapper, value, events } = mountRef({ modelValue: ID })
    await wrapper.findAll('.media-field__actions button')[0]!.trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('new.jpg'))!.click()
    await flushPromises()
    expect(value.value).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(events.picked).toEqual([['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ID]])
  })

  it('唯讀：不顯示按鈕；不要縮圖時只留文字與按鈕', () => {
    expect(mountRef({ modelValue: ID, disabled: true }).wrapper.find('.media-field__actions').exists()).toBe(false)
    expect(mountRef({ modelValue: ID, thumb: false }).wrapper.find('.media-field__thumb').exists()).toBe(false)
  })
})
