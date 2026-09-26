import manifest from '../generated/image-manifest.json'

interface ImageInfo { width: number; height: number; candidates: { src: string; width: number }[] }

/**
 * 首頁 hero 圖：首屏明亮版（DESIGN.md 2026-09-16）在所有斷點都是滿版
 * 照片（`.studio-hero-image{position:absolute;inset:0}`），Playwright 實測
 * 390 與 1440 的 img 都等於視窗寬，所以 sizes 就是 100vw。
 * `<img sizes>` 與 usePageSeo 的 `<link rel=preload imagesizes>` 必須用
 * 同一份，否則預載與實際選到的候選檔會不同、多下載一張。
 */
export const HOME_HERO_SIZES = '100vw'

/** 入學資訊頁 hero（滿版，sizes 同為 100vw）；頁面 <img> 與 usePageSeo 預載共用。 */
export const ADMISSION_HERO_IMAGE = 'day-hello'

/** 常春藤環境頁 hero（滿版，sizes 同為 100vw）；頁面 <img> 與 usePageSeo 預載共用。 */
export const ENVIRONMENT_HERO_IMAGE = 'env-hero-hug'

/** 特色教學頁 hero（滿版，sizes 同為 100vw）；頁面 <img> 與 usePageSeo 預載共用。 */
export const CURRICULUM_HERO_IMAGE = 'cur-hero'

/**
 * 內頁 hero（入學資訊、常春藤環境、特色教學；admission.css 的 `.adm-hero-photo`）。
 * 760px 以下照片是固定高度的帶（PAGE_HERO_MOBILE_HEIGHT）、object-fit: cover，橫幅照片
 * 實際顯示寬度 = 高度 × 寬高比（2000×803 是 1245px），遠大於 100vw。sizes 照實寫，手機
 * 才會挑到夠大的候選；2026-09-26 以前一律 100vw，390 寬手機只拿 800w，有效解析度只有
 * 0.3–0.7（實測）。761px 以上照片鋪滿 hero，維持 100vw（實測已選到最大候選）。
 * 頁面 <img> 與 usePageSeo 的預載都用這個，兩邊 sizes 才會一致。
 */
export const PAGE_HERO_MOBILE_HEIGHT = 500
export function pageHeroImage(name: string) {
  const info = Object.hasOwn(manifest, name) ? (manifest as Record<string, ImageInfo>)[name] : undefined
  const mobileWidth = info ? Math.round(PAGE_HERO_MOBILE_HEIGHT * info.width / info.height) : 0
  return responsiveImage(name, mobileWidth ? `(max-width: 760px) ${mobileWidth}px, 100vw` : '100vw')
}

export function responsiveImage(name: string, sizes = '100vw') {
  // 只查 manifest 自己的鍵：CMS 代號若是 `__proto__`、`constructor`，
  // 一般物件會查到原型，接著 candidates.map 丟例外讓整頁渲染失敗。
  const found = Object.hasOwn(manifest, name) ? (manifest as Record<string, ImageInfo>)[name] : undefined
  const info = found && Array.isArray(found.candidates) ? found : undefined
  return {
    src: `/assets/${name}.webp`,
    width: info?.width,
    height: info?.height,
    srcset: info?.candidates.map((candidate) => `${candidate.src} ${candidate.width}w`).join(', '),
    sizes: info ? sizes : undefined
  }
}
