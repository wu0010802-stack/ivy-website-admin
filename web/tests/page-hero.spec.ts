import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../app/generated/image-manifest.json'
import { ADMISSION_HERO_IMAGE, CURRICULUM_HERO_IMAGE, ENVIRONMENT_HERO_IMAGE, PAGE_HERO_MOBILE_HEIGHT, pageHeroImage } from '../app/utils/responsive-image'

// 2026-09-26：內頁 hero 手機版是固定高度的帶、object-fit: cover，sizes 要寫實際顯示寬度。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const images = manifest as Record<string, { width: number; height: number }>

describe('內頁 hero 的 sizes', () => {
  it.each([ADMISSION_HERO_IMAGE, ENVIRONMENT_HERO_IMAGE, CURRICULUM_HERO_IMAGE])('%s：760px 以下寫 500 × 寬高比，其餘 100vw', (name) => {
    const { width, height } = images[name]!
    const attrs = pageHeroImage(name)
    expect(attrs.sizes).toBe(`(max-width: 760px) ${Math.round(PAGE_HERO_MOBILE_HEIGHT * width / height)}px, 100vw`)
    expect(attrs.srcset).toBeTruthy()
  })

  it('常數與 admission.css 760px 以下的照片高度一致', () => {
    const css = read('../app/assets/css/admission.css')
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(mobile).toMatch(new RegExp(`\\.adm-hero-photo \\{[^}]*height: ${PAGE_HERO_MOBILE_HEIGHT}px`))
  })

  it('頁面 <img> 與預載都用 pageHeroImage（sizes 不一致會多下載一張）', () => {
    const seo = read('../app/composables/usePageSeo.ts')
    for (const name of ['ADMISSION', 'ENVIRONMENT', 'CURRICULUM']) {
      expect(seo).toContain(`pageHeroImage(${name}_HERO_IMAGE)`)
    }
    for (const [file, name] of [['AdmissionContent', 'ADMISSION'], ['EnvironmentContent', 'ENVIRONMENT'], ['CurriculumContent', 'CURRICULUM']]) {
      expect(read(`../app/components/${file}.vue`)).toContain(`v-bind="pageHeroImage(${name}_HERO_IMAGE)"`)
    }
  })

  it('找不到素材時退回 100vw、不丟例外', () => {
    expect(pageHeroImage('__proto__').sizes).toBeUndefined()
    expect(pageHeroImage('not-a-real-image').src).toBe('/assets/not-a-real-image.webp')
  })
})
