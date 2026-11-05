import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodedBitmap } from '../app/utils/decoded-bitmap'

describe('decodedBitmap：canvas 用的圖改在 worker 解碼', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetch 回 blob 後交給 createImageBitmap，帶著呼叫端的選項', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' })
    const bitmap = { width: 10, height: 8, close: vi.fn() }
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }))
    const create = vi.fn(async () => bitmap)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('createImageBitmap', create)
    await expect(decodedBitmap('/assets/a.webp', { premultiplyAlpha: 'none' })).resolves.toBe(bitmap)
    expect(fetchMock).toHaveBeenCalledWith('/assets/a.webp', { credentials: 'same-origin' })
    expect(create).toHaveBeenCalledWith(blob, { premultiplyAlpha: 'none' })
  })

  it('不支援、HTTP 錯誤、網路或解碼失敗時回 null，讓呼叫端退回 <img>', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('fetch', vi.fn())
    await expect(decodedBitmap('/a.webp')).resolves.toBeNull()

    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode') }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob() })))
    await expect(decodedBitmap('/a.webp')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(decodedBitmap('/a.webp')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
    await expect(decodedBitmap('/a.webp')).resolves.toBeNull()

    await expect(decodedBitmap('')).resolves.toBeNull()
  })
})
