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

/** 入學資訊頁首屏照片；2026-09-28 入學護照版起不是滿版，見 admissionHeroImage()。 */
export const ADMISSION_HERO_IMAGE = 'day-hello'

/** 常春藤環境頁首屏照片；2026-09-28 手繪版起不是滿版，見 environmentHeroImage()。 */
export const ENVIRONMENT_HERO_IMAGE = 'env-hero-hug'

/**
 * 常春藤環境頁（2026-09-28 手繪版）的首屏照片是 3:2 的相框（environment.css 的
 * `.renv-hero-photo>img`），object-fit: cover；橫幅原圖（1960×934）左右被裁掉，實際要畫的寬度
 * ＝框寬 × (原圖寬高比 ÷ 1.5)。桌機框寬約 530px（1200 內容寬、兩欄 1.12:1），900px 以下是
 * 單欄、最寬 560px。頁面 <img> 與 usePageSeo 的預載都用這個，兩邊 sizes 才會一致。
 */
export const ENVIRONMENT_HERO_ASPECT = 3 / 2
export function environmentHeroImage() {
  const info = Object.hasOwn(manifest, ENVIRONMENT_HERO_IMAGE) ? (manifest as Record<string, ImageInfo>)[ENVIRONMENT_HERO_IMAGE] : undefined
  const scale = info ? Math.max(1, info.width / info.height / ENVIRONMENT_HERO_ASPECT) : 1
  const factor = Number(scale.toFixed(2))
  return responsiveImage(ENVIRONMENT_HERO_IMAGE, `(max-width: 900px) calc((100vw - 40px) * ${factor}), ${Math.round(540 * factor)}px`)
}

/**
 * 入學資訊頁（2026-09-28 入學護照版）的首屏照片是護照左頁的 4:3 照片欄（admission-passport.css 的
 * `.ap-photo img`），object-fit: cover；原圖比 4:3 寬時左右被裁，要畫的寬度＝欄寬 × (原圖寬高比 ÷ 4/3)。
 * 桌機欄寬約 480px（護照最寬 1240、左右頁 1:1.08、頁內留白 40、相框 8＋1）；760px 以下護照只剩一頁，
 * 欄寬＝視窗 − 86px（外框 8×2、頁內 18×2、相框 9×2、護照左右留白 8×2）。頁面 <img> 與 usePageSeo 的預載共用。
 */
export const ADMISSION_HERO_ASPECT = 4 / 3
export function admissionHeroImage() {
  const info = Object.hasOwn(manifest, ADMISSION_HERO_IMAGE) ? (manifest as Record<string, ImageInfo>)[ADMISSION_HERO_IMAGE] : undefined
  const factor = Number((info ? Math.max(1, info.width / info.height / ADMISSION_HERO_ASPECT) : 1).toFixed(2))
  return responsiveImage(ADMISSION_HERO_IMAGE, `(max-width: 760px) calc((100vw - 86px) * ${factor}), ${Math.round(490 * factor)}px`)
}

/** 特色教學頁 hero；頁面 <img> 與 usePageSeo 預載共用（sizes 見 CURRICULUM_HERO_SIZES）。 */
export const CURRICULUM_HERO_IMAGE = 'cur-hero'

/**
 * 特色教學頁 hero 的 sizes（2026-09-28 水彩版）：照片不再滿版，是右欄的撕紙框、object-fit: cover。
 * 2000×803 的橫幅被裁成直一點的框，需要的寬度是「框高 × 寬高比 2.49」，不是框寬：
 * - 901px 以上：框高 min(64vh, 600px)，最多約 1494px 寬 → 1500px。
 * - 900px 以下：框改成 4:3、寬 = 視窗減左右留白，需要寬度約 1.87 × 框寬 → 187vw（390 寬實際約 695px）。
 */
export const CURRICULUM_HERO_SIZES = '(max-width: 900px) 187vw, 1500px'

/** 關於常春藤頁 hero（滿版，sizes 同為 100vw）；頁面 <img> 與 usePageSeo 預載共用。 */
export const ABOUT_HERO_IMAGE = 'about-hero'

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
