import manifest from '../generated/image-manifest.json'

/** manifest 的一個寬度候選；照片多一個同寬的 `avif`（scripts/optimize-site-images.py，比同寬 WebP 小一成以上才有）。 */
interface ImageCandidate { src: string; width: number; avif?: string }
interface ImageInfo { width: number; height: number; candidates: ImageCandidate[] }

/**
 * `responsiveImage()` 的輸出：綁到 `<img>` 的 src／srcset／sizes，再加照片才有的 `avifSrcset`。
 * `avifSrcset` 不是 `<img>` 的屬性，只能綁到 `<ResponsivePicture>`（它會拆成 `<source type="image/avif">`）；
 * 直接 `v-bind` 到原生 `<img>` 會變成 `avifsrcset="…"`。
 */
export interface ResponsiveImageAttrs {
  src: string
  width: number | undefined
  height: number | undefined
  srcset: string | undefined
  sizes: string | undefined
  avifSrcset?: string
}

/**
 * 首頁 hero 圖：首屏明亮版（DESIGN.md 2026-09-16）在所有斷點都是滿版
 * 照片（`.studio-hero-image{position:absolute;inset:0}`），Playwright 實測
 * 390 與 1440 的 img 都等於視窗寬，所以 sizes 就是 100vw。
 * `<img sizes>` 與 usePageSeo 的 `<link rel=preload imagesizes>` 必須用
 * 同一份，否則預載與實際選到的候選檔會不同、多下載一張。
 */
export const HOME_HERO_SIZES = '100vw'

/**
 * 入學資訊頁首屏照片；2026-09-28 入學護照版起不是滿版，見 admissionHeroImage()。
 * 2026-11-12 早上曾換成逆光女孩 admission-hero，同日使用者要改回「早安」兩個男孩手牽手；
 * 逆光女孩移到「新生準備」02 快樂曲的縮圖（AdmissionContent.vue PHASE_PHOTOS）。
 */
export const ADMISSION_HERO_IMAGE = 'day-hello'

/** 常春藤環境頁首屏照片；2026-09-28 手繪版起不是滿版，見 environmentHeroImage()。 */
export const ENVIRONMENT_HERO_IMAGE = 'env-hero-hug'

/**
 * 常春藤環境頁的首屏照片在赤陶拱積木的拱窗裡（2026-11-04 起，environment.css 的 `.renv-arch-photo`；之前是彩虹疊疊樂最內圈的拱），
 * object-fit: cover，框是直的（約 4:5）；橫幅原圖（1960×934）左右被裁掉，實際要畫的寬度＝框寬 × (原圖寬高比 ÷ 4/5)。
 * 桌機照片最寬 (540 − 26) − 2×20 = 474px → 480px；900px 以下拱在版心裡、往右錯開 13px、邊 14px，
 * 照片寬＝視窗 − 74px（390 寬 316px）。頁面 <img> 與 usePageSeo 的預載都用這個，兩邊 sizes 才會一致。
 */
export const ENVIRONMENT_HERO_ASPECT = 4 / 5
/** factor＝原圖寬高比 ÷ 4/5（至少 1）：橫幅被裁成拱框時，要畫的寬度是框寬乘上它。 */
export function environmentHeroSizes(factor: number) {
  return `(max-width: 900px) calc((100vw - 74px) * ${factor}), ${Math.round(480 * factor)}px`
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
 * 照片比框寬，需要的寬度是「框高 × 寬高比」，不是框寬。2026-11-03 換成 2048×1152 的彩虹傘（16:9，原本 2000×803 是 2.49）：
 * - 901px 以上：框高 min(64vh, 600px)、欄寬最多約 530px，一定是高度撐滿 → 最多 600 × 1.78 ≈ 1067px → 1070px。
 * - 900px 以下：框改成 4:3、寬 = 視窗減左右留白（20px × 2），需要寬度 = 框寬 × (16/9 ÷ 4/3) ≈ 1.34 × 框寬
 *   （390 寬約 469px）。761–900 寬的留白較寬、橫拿手機的照片改在右欄，這個寫法只會高估、不會變糊。
 *   2026-09-29 以前寫成以視窗寬算的 vw，340–370 寬的 DPR2 手機會多抓一級。
 * 2026-11-12：DPR 2.5 以上的手機把寬度估成七成（做法同預約頁校區卡，VisitForm.vue），390 寬 DPR3 從 1600w（181 KB）
 *   改挑 1200w（122 KB）；照片在框裡仍有約 2.5 倍密度。這張是手機的 LCP，六頁裡原本最大。DPR 2 與桌機照舊。
 */
export const CURRICULUM_HERO_SIZES = '(max-width: 760px) and (min-resolution: 2.5dppx) calc((100vw - 40px) * .94), (max-width: 900px) calc((100vw - 40px) * 1.34), 1070px'

/** 關於常春藤頁 hero；頁面 <img> 與 usePageSeo 預載共用（sizes 見 ABOUT_HERO_SIZES）。 */
export const ABOUT_HERO_IMAGE = 'about-hero'

/**
 * 關於常春藤頁 hero 的 sizes。母檔 3:2（2000×1333，修圖版）。
 * - 901px 以上（2026-11-12）：右欄一個 6:5 的框，照片照框高畫滿、只露出右邊八成（左邊裁到木柱為止），
 *   所以要畫的寬度是框寬 × 1.25。框最寬約 695px（版心 1280、欄距 88、右欄 7/12）→ 869px，寫 880px。
 * - 900px 以下：標題底下一張和版心同寬的照片（701–900 裁成 2:1、700 以下 3:2，都是照框寬畫滿），寫「視窗 − 40px」。
 * 2026-11-11 是各寬度都和版心同寬（(max-width: 1408px) calc(100vw − 40px), 1280px）；
 * 2026-11-10 是右欄一張 4:3（母檔裁成 1600×1200），(max-width: 900px) calc(100vw − 40px), 700px；
 * 2026-11-03～11-10 是 3:2 卡紙（有卡紙框），calc(100vw − 68px), 560px；
 * 2026-10-30～11-02 是 2000×803 創辦人橫幅裁 4:3，calc((100vw − 60px) × 1.53), 940px。
 */
export const ABOUT_HERO_SIZES = '(max-width: 900px) calc(100vw - 40px), 880px'

export function responsiveImage(name: string, sizes = '100vw'): ResponsiveImageAttrs {
  // 只查 manifest 自己的鍵：CMS 代號若是 `__proto__`、`constructor`，
  // 一般物件會查到原型，接著 candidates.map 丟例外讓整頁渲染失敗。
  const found = Object.hasOwn(manifest, name) ? (manifest as Record<string, ImageInfo>)[name] : undefined
  const info = found && Array.isArray(found.candidates) ? found : undefined
  const attrs: ResponsiveImageAttrs = {
    src: `/assets/${name}.webp`,
    width: info?.width,
    height: info?.height,
    srcset: info?.candidates.map((candidate) => `${candidate.src} ${candidate.width}w`).join(', '),
    sizes: info ? sizes : undefined
  }
  // AVIF 的 srcset 要和 WebP 的寬度級距完全相同：有的寬度 AVIF 沒省到一成（沒有 avif 欄位），
  // 就沿用那個寬度的 WebP 網址——看得懂 AVIF 的瀏覽器一定看得懂 WebP。整張圖都沒有 AVIF（線稿、去背、插畫）就不放這個鍵。
  if (info?.candidates.some((candidate) => candidate.avif)) {
    attrs.avifSrcset = info.candidates.map((candidate) => `${candidate.avif ?? candidate.src} ${candidate.width}w`).join(', ')
  }
  return attrs
}

/**
 * 首屏照片的 `<link rel="preload" as="image">`（usePageSeo）。`<img sizes>` 與這裡的 imagesizes 用同一份。
 * 照片有 AVIF 時預載 AVIF 那組 srcset 並標 `type="image/avif"`：不支援 AVIF 的瀏覽器會略過這個預載、
 * 照舊由 `<img>` 載 WebP；支援的瀏覽器預載到的才會是 `<picture>` 實際選中的那一檔。
 */
export function heroPreloadLink(hero: { src: string; srcset?: string; sizes?: string; avifSrcset?: string }) {
  return {
    rel: 'preload' as const,
    as: 'image' as const,
    href: hero.src,
    imagesrcset: hero.avifSrcset ?? hero.srcset,
    imagesizes: hero.sizes,
    ...(hero.avifSrcset ? { type: 'image/avif' } : {}),
    fetchpriority: 'high' as const
  }
}
