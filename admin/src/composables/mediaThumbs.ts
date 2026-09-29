import { reactive } from 'vue'
import { mediaFileUrl, mediaVariantUrl } from '../api/client'
import type { MediaAssetOut } from '../api/types'
import { websiteAssetUrl } from '../config'

// 內容裡的圖片欄位同時相容兩種值：素材庫的媒體 UUID，以及舊示意內容的官網
// 內建素材代號（例如 "campus"，走官網靜態素材）。
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isMediaId(image: string): boolean {
  return UUID_PATTERN.test(image)
}

/**
 * 編輯頁的小縮圖（消息封面、內文圖片、分享圖、場景分頁）。素材庫的照片先載
 * 縮圖（原檔是 no-store、每次進頁都要重抓好幾 MB；縮圖可快取），讀不到縮圖
 * （舊素材沒有衍生檔，後端回 404）才退回原檔；原檔也讀不到就算壞掉，由畫面
 * 請使用者重新選擇。每個頁面各用一份（記的是這一頁讀失敗過的圖）。
 */
export function useMediaThumbs() {
  const fallback = reactive(new Set<string>())
  const broken = reactive(new Set<string>())

  function src(image: string): string {
    if (!isMediaId(image)) return websiteAssetUrl(image)
    return fallback.has(image) ? mediaFileUrl(image) : mediaVariantUrl(image, 'thumbnail')
  }

  function onError(image: string) {
    if (isMediaId(image) && !fallback.has(image)) fallback.add(image)
    else broken.add(image)
  }

  function isBroken(image: string): boolean {
    return broken.has(image)
  }

  /** 重新選了同一張：清掉失敗紀錄，再試一次。 */
  function forget(image: string) {
    fallback.delete(image)
    broken.delete(image)
  }

  return { src, onError, isBroken, forget }
}

/**
 * 選了照片之後圖片說明該是什麼。換成另一張照片時一律換成新照片在素材庫的說明
 * （素材庫沒填就清空），舊照片的說明不能留著描述錯的圖；原本沒有照片、或重選
 * 同一張時，只在說明還空著時帶入。previousId 是選之前的照片（沒有為空）。
 */
export function altAfterPick(currentAlt: string | null | undefined, previousId: string | null | undefined, asset: Pick<MediaAssetOut, 'id' | 'alt_text'>): string {
  const assetAlt = asset.alt_text ?? ''
  if (previousId && previousId !== asset.id) return assetAlt
  return currentAlt?.trim() ? currentAlt : assetAlt
}
