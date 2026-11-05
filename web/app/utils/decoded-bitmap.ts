/**
 * 給 canvas／WebGL 用的圖片：fetch → blob → createImageBitmap，webp 在 worker 解碼。
 *
 * 頁面上的 <img> 由合成器在 raster worker 解碼，但 canvas 的 drawImage(img) 與 texImage2D(img)
 * 用的是自己的解碼結果，會在主執行緒同步解整張圖（2026-11-05 量到手機 4× 單張 100–300ms）。
 * `img.decoding='async'`、`img.decode()`、`createImageBitmap(img)` 在 Chromium 對這條路都沒用，
 * 只有從 blob 建 ImageBitmap 會把解碼放到 worker；像素與 drawImage(img) 逐位元相同
 * （預設的 colorSpaceConversion／imageOrientation 與 <img> 一致）。
 *
 * 同源資源會命中 HTTP 快取（<img> 已經下載過）。不支援、跨來源被擋或失敗時回 null，
 * 呼叫端退回原本用 <img> 的路徑。WebGL 上傳要帶 `{ premultiplyAlpha: 'none' }`：ImageBitmap
 * 不吃 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 等 pixelStorei 設定。用完記得 `close()`，
 * 解碼後的點陣圖不跟著 GC 及時釋放（手機一張 1200×900 約 4.3 MB）。
 */
export async function decodedBitmap(src: string, options?: ImageBitmapOptions): Promise<ImageBitmap | null> {
  if (!src || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null
  try {
    const response = await fetch(src, { credentials: 'same-origin' })
    if (!response.ok) return null
    return await createImageBitmap(await response.blob(), options)
  } catch {
    return null
  }
}
