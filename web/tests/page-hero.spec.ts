import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../app/generated/image-manifest.json'
import { ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES, ADMISSION_HERO_ASPECT, ADMISSION_HERO_IMAGE, admissionHeroImage, CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, PAGE_HERO_MOBILE_HEIGHT, pageHeroImage } from '../app/utils/responsive-image'

// 2026-09-26：內頁 hero 手機版是固定高度的帶、object-fit: cover，sizes 要寫實際顯示寬度。
// 常春藤環境頁 2026-09-28 改成手繪版，首屏照片不是滿版帶，改用 environmentHeroImage()（見 environment.spec.ts）；
// 入學資訊頁同日改成入學護照版，首屏照片是護照左頁的 4:3 照片欄，改用 admissionHeroImage()。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const images = manifest as Record<string, { width: number; height: number }>

describe('內頁 hero 的 sizes', () => {
  it.each([ABOUT_HERO_IMAGE])('%s：760px 以下寫 500 × 寬高比，其餘 100vw', (name) => {
    const { width, height } = images[name]!
    const attrs = pageHeroImage(name)
    expect(attrs.sizes).toBe(`(max-width: 760px) ${Math.round(PAGE_HERO_MOBILE_HEIGHT * width / height)}px, 100vw`)
    expect(attrs.srcset).toBeTruthy()
  })

  // 2026-09-29：手機照片帶改成 clamp(300px, 56svh, 500px)，矮螢幕首屏才看得到標題；常數是上限，sizes 照最高的帶算
  it('常數與 admission.css 760px 以下的照片高度上限一致', () => {
    const css = read('../app/assets/css/admission.css')
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(mobile).toMatch(new RegExp(`\\.adm-hero-photo \\{[^}]*height: clamp\\([^)]*${PAGE_HERO_MOBILE_HEIGHT}px\\)`))
  })

  // 2026-09-29 立體書版：關於常春藤 hero 不再是滿版照片帶，改成首屏右頁的 4:3 卡紙（object-fit: cover）。
  it('關於常春藤 hero 的 <img> 與預載共用 ABOUT_HERO_SIZES（sizes 不一致會多下載一張）', () => {
    expect(read('../app/composables/usePageSeo.ts')).toContain('responsiveImage(ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES)')
    expect(read('../app/components/AboutContent.vue')).toContain('v-bind="responsiveImage(ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES)"')
    // 2000×803 的橫幅裁成 4:3 卡紙，需要的寬度是框寬 × 1.87 左右，不是框寬
    expect(ABOUT_HERO_SIZES).toMatch(/^\(max-width: 900px\) calc\(\(100vw - \d+px\) \* [\d.]+\), \d+px$/)
  })

  // 2026-09-28 入學護照版：照片欄 4:3、object-fit: cover，原圖比 4:3 寬時要畫的寬度再乘上比例。
  it('入學資訊 hero 的 <img> 與預載共用 admissionHeroImage()，sizes 照護照照片欄的實際寬度寫', () => {
    const { width, height } = images[ADMISSION_HERO_IMAGE]!
    const factor = Number(Math.max(1, width / height / ADMISSION_HERO_ASPECT).toFixed(2))
    expect(admissionHeroImage().sizes).toBe(`(max-width: 760px) calc((100vw - 86px) * ${factor}), ${Math.round(490 * factor)}px`)
    expect(read('../app/composables/usePageSeo.ts')).toContain("if (page === 'admission') return admissionHeroImage()")
    const component = read('../app/components/AdmissionContent.vue')
    expect(component).toContain('const hero = admissionHeroImage()')
    expect(component).toContain('<img v-bind="hero"')
    expect(read('../app/assets/css/admission-passport.css')).toMatch(/\.ap-photo img \{[^}]*aspect-ratio: 4 \/ 3/)
  })

  // 2026-09-28 水彩版：特色教學 hero 不再是滿版照片帶，改成右欄的撕紙框（object-fit: cover）。
  it('特色教學 hero 的 <img> 與預載共用 CURRICULUM_HERO_SIZES，照框的實際顯示寬度寫', () => {
    expect(read('../app/composables/usePageSeo.ts')).toContain('curriculumHeroAttrs(site.value.curriculumPage)')
    expect(read('../app/components/CurriculumContent.vue')).toContain('curriculumHeroAttrs(page)')
    // 橫幅照片（2000×803）被裁成直一點的框，需要的寬度是「框高 × 寬高比」，不是框寬
    expect(CURRICULUM_HERO_SIZES).toMatch(/^\(max-width: 900px\) (\d+vw|calc\(\(100vw - \d+px\) \* [\d.]+\)), \d+px$/)
  })

  it('找不到素材時退回 100vw、不丟例外', () => {
    expect(pageHeroImage('__proto__').sizes).toBeUndefined()
    expect(pageHeroImage('not-a-real-image').src).toBe('/assets/not-a-real-image.webp')
  })
})
