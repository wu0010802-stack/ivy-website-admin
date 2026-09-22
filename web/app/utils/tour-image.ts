import { responsiveImage } from './responsive-image'

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
 * 給 `<img v-bind>` 用：fixture 代號有響應式衍生檔就帶 srcset／sizes／
 * width／height（導覽主圖與縮圖原本一律載 960px 母檔，Lighthouse 估
 * 分校頁可省約 250 KB）；媒體庫 UUID 只有單一原檔，維持 src。
 */
export function resolveTourImage(image: string, sizes: string): Record<string, string | number | undefined> {
  if (UUID_PATTERN.test(image)) return { src: resolveTourImageSrc(image) }
  return responsiveImage(image, sizes)
}
