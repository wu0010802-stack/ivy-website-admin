import { responsiveImage } from './responsive-image'
import { mediaImageAttrs, type MediaImage } from './media-image'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `campus_tour` 的場景 `image` 欄位同時相容兩種值（見 backend
 * CampusTourPayload／admin CampusTourView.vue 的對應說明）：
 *   - 素材庫媒體 UUID：走同源 `/api/website/v1/public/media/{id}/file`
 *     （由 web/server/routes/api/website/v1/[...].ts 這支既有的
 *     catch-all proxy 轉發，不需要另外寫路由）。
 *   - 舊的 fixture 素材代號字串（例如 "campus"）：維持原本
 *     `/assets/<代號>.webp` 的靜態資產路徑，不受影響。
 */
export function resolveTourImageSrc(image: string): string {
  if (UUID_PATTERN.test(image)) {
    return `/api/website/v1/public/media/${image}/file`
  }
  return `/assets/${image}.webp`
}

/**
 * 素材庫的圖有公開 API 給的衍生檔資訊（media）時用縮圖／大圖組 srcset，沒有就
 * 只給原檔；靜態場景使用尺寸候選。放大檢視（fullSize）一律回到原圖。
 */
export function responsiveTourImage(image: string, sizes: string, fullSize = false, media?: MediaImage): ReturnType<typeof responsiveImage> {
  if (UUID_PATTERN.test(image)) {
    if (media && !fullSize) return mediaImageAttrs(media, sizes)
    return { src: resolveTourImageSrc(image), width: media?.width, height: media?.height, srcset: undefined, sizes: undefined }
  }
  const attrs = responsiveImage(image, sizes)
  return fullSize ? { ...attrs, srcset: undefined, sizes: undefined } : attrs
}
