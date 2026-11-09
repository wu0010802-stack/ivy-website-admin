/**
 * 給 canvas／WebGL 用的圖片：fetch → blob → createImageBitmap，webp 在 worker 解碼。
 *
 * 頁面上的 <img> 由合成器在 raster worker 解碼，但 canvas 的 drawImage(img) 與 texImage2D(img)
 * 用的是自己的解碼結果，會在主執行緒同步解整張圖（2026-11-05 量到手機 4× 單張 100–300ms）。
 * `img.decoding='async'`、`img.decode()`、`createImageBitmap(img)` 在 Chromium 對這條路都沒用，
 * 只有從 blob 建 ImageBitmap 會把解碼放到 worker。像素要逐一驗證，不能假設相同：
 * - WebGL texImage2D（等尺寸上傳）與 2D drawImage 在預設平滑品質（low）下，和 <img> 逐位元相同
 *   （預設的 colorSpaceConversion／imageOrientation 與 <img> 一致）。
 * - 2D context 設了 imageSmoothingQuality 'medium'／'high' 又要縮放時，Chrome 對 ImageBitmap 與 <img>
 *   的縮圖結果不同（2026-11-05 拍立得正面貼圖實測最多差 12/255），這種地方不要換。
 * - 手機上 <img>.naturalWidth 是 srcset 密度換算後的值，ImageBitmap 的寬高是檔案原尺寸，
 *   用寬高算裁切比例時要用同一個來源。
 *
 * 同源資源會命中 HTTP 快取（<img> 已經下載過）。不支援、跨來源被擋或失敗時回 null，
 * 呼叫端退回原本用 <img> 的路徑。WebGL 上傳要帶 `{ premultiplyAlpha: 'none' }`：ImageBitmap
 * 不吃 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 等 pixelStorei 設定。用完記得 `close()`，
 * 解碼後的點陣圖不跟著 GC 及時釋放（手機一張 1200×900 約 4.3 MB）。
 *
 * 請求優先權要明講 `priority: 'low'`：原本 canvas 用的是不在 DOM 裡的 `new Image()`，Chrome 給 Low；
 * fetch() 預設是 High，跟 `fetchpriority=high` 的首屏海報、開場影片同級，慢速網路下會搶頻寬
 * （30 週年時間軸貼圖在頁面載入當下就預取、五校線稿在區塊離視窗 800px 時預載，都是背景素材）。
 * 不支援的瀏覽器會忽略這個欄位，行為同預設。
 */
export async function decodedBitmap(src: string, options?: ImageBitmapOptions): Promise<ImageBitmap | null> {
  if (!src || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null
  try {
    const response = await fetch(src, { credentials: 'same-origin', priority: 'low' })
    if (!response.ok) return null
    return await createImageBitmap(await response.blob(), options)
  } catch {
    return null
  }
}
