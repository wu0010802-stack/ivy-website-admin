import { describe, it, expect } from 'vitest'
import { resolveTourImageSrc, responsiveTourImage } from '../app/utils/tour-image'

describe('resolveTourImageSrc：campus_tour 場景圖片相容兩種來源', () => {
  it('媒體庫 UUID 走同源公開媒體路由', () => {
    expect(resolveTourImageSrc('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(
      '/api/website/v1/public/media/3fa85f64-5717-4562-b3fc-2c963f66afa6/file'
    )
  })

  it('UUID 不分大小寫都視為媒體庫來源', () => {
    expect(resolveTourImageSrc('3FA85F64-5717-4562-B3FC-2C963F66AFA6')).toBe(
      '/api/website/v1/public/media/3FA85F64-5717-4562-B3FC-2C963F66AFA6/file'
    )
  })

  it('舊的 fixture 素材代號字串走靜態資產路徑', () => {
    expect(resolveTourImageSrc('campus')).toBe('/assets/campus.webp')
    expect(resolveTourImageSrc('garden')).toBe('/assets/garden.webp')
  })

  it('空字串（尚未設定圖片）也走靜態資產路徑，不會誤判成 UUID', () => {
    expect(resolveTourImageSrc('')).toBe('/assets/.webp')
  })
})

describe('巡覽圖片依展示尺寸選圖，保留媒體庫及放大檢視', () => {
  it('靜態場景提供尺寸候選與原始比例', () => {
    const image = responsiveTourImage('campus', '96px')
    expect(image).toMatchObject({ src: '/assets/campus.webp', width: 960, height: 600, sizes: '96px' })
    expect(image.srcset).toContain('480w')
    expect(image.srcset).toContain('/assets/campus.webp 960w')
  })

  it('媒體庫圖片保持 API 路徑，不產生不存在的靜態衍生檔', () => {
    const image = responsiveTourImage('3fa85f64-5717-4562-b3fc-2c963f66afa6', '96px')
    expect(image.src).toBe('/api/website/v1/public/media/3fa85f64-5717-4562-b3fc-2c963f66afa6/file')
    expect(image.srcset).toBeUndefined()
  })

  it('放大時使用原圖，避免沿用縮圖候選', () => {
    const image = responsiveTourImage('campus', '100vw', true)
    expect(image.src).toBe('/assets/campus.webp')
    expect(image.srcset).toBeUndefined()
    expect(image.width).toBe(960)
  })
})
