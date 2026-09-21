import { describe, it, expect } from 'vitest'
import { resolveTourImageSrc } from '../app/utils/tour-image'

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
