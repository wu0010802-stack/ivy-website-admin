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
/** factor＝原圖寬高比 ÷ 3:2（至少 1）：橫幅被裁成相框時，要畫的寬度是框寬乘上它。 */
export function environmentHeroSizes(factor: number) {
  return `(max-width: 900px) calc((100vw - 40px) * ${factor}), ${Math.round(540 * factor)}px`
}
export function environmentHeroImage() {
  const info = Object.hasOwn(manifest, ENVIRONMENT_HERO_IMAGE) ? (manifest as Record<string, ImageInfo>)[ENVIRONMENT_HERO_IMAGE] : undefined
  const scale = info ? Math.max(1, info.width / info.height / ENVIRONMENT_HERO_ASPECT) : 1
  const factor = Number(scale.toFixed(2))
  return responsiveImage(ENVIRONMENT_HERO_IMAGE, environmentHeroSizes(factor))
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
 * - 900px 以下：框改成 4:3、寬 = 視窗減左右留白（20px × 2），需要寬度約 1.87 × 框寬 → calc((100vw - 40px) * 1.87)
 *   （390 寬約 655px）。2026-09-29 以前寫 187vw（以視窗寬算），340–370 寬的 DPR2 手機會多抓一級 2000w；
 *   761–900 寬的留白較寬、橫拿手機的照片改在右欄，這個寫法只會高估、不會變糊。
 */
export const CURRICULUM_HERO_SIZES = '(max-width: 900px) calc((100vw - 40px) * 1.87), 1500px'

/** 關於常春藤頁 hero；頁面 <img> 與 usePageSeo 預載共用（sizes 見 ABOUT_HERO_SIZES）。 */
export const ABOUT_HERO_IMAGE = 'about-hero'

/**
 * 關於常春藤頁 hero 的 sizes（2026-10-30 換版）：首屏右欄的一張 4:3 卡紙（object-fit: cover，內距 8px）。
 * 2000×803 的橫幅被裁成 4:3，需要的寬度是「框高 × 2.49」≈ 框寬 × 1.87：
 * - 901px 以上：版心最寬 1200px、右欄 6/11（約 607px）、左內距 14%＋右 2%，照片約 494px → 需要約 923px → 940px。
 * - 900px 以下：單欄，照片寬 ≈ (視窗 − 左右留白 20px × 2) × 82% − 16px，
 *   需要寬度約 1.53 × (100vw − 60px)（390 寬約 505px）。
 */
export const ABOUT_HERO_SIZES = '(max-width: 900px) calc((100vw - 60px) * 1.53), 940px'

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
