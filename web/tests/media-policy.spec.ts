import { describe, expect, it } from 'vitest'
import { HERO_MIN_DOWNLINK_MBPS, heroMayAutoplay, mayAutoplay, backgroundVideoSrc } from '../app/utils/media-policy'
import { responsiveImage } from '../app/utils/responsive-image'

describe('影音流量與響應式圖片', () => {
  it('減少動態、省流量與慢速連線不自動播放', () => {
    expect(mayAutoplay(true)).toBe(false)
    expect(mayAutoplay(false, { saveData: true })).toBe(false)
    for (const effectiveType of ['slow-2g', '2g', '3g']) expect(mayAutoplay(false, { effectiveType })).toBe(false)
    expect(mayAutoplay(false)).toBe(true)
  })
  it('首屏影片在 downlink 低於門檻的慢速 4G 也留靜態封面；其他影片不受這個門檻影響', () => {
    const slow = { effectiveType: '4g', downlink: 1.65 }
    expect(heroMayAutoplay(false, slow)).toBe(false)
    expect(heroMayAutoplay(false, { effectiveType: '4g', downlink: HERO_MIN_DOWNLINK_MBPS - 0.05 })).toBe(false)
    expect(heroMayAutoplay(false, { effectiveType: '4g', downlink: HERO_MIN_DOWNLINK_MBPS })).toBe(true)
    expect(heroMayAutoplay(false, { effectiveType: '4g', downlink: 10 })).toBe(true)
    expect(mayAutoplay(false, slow)).toBe(true)
  })
  it('首屏影片：沒有 downlink（Safari、Firefox）或回報 0 時照舊自動播放；減少動態、省流量、3G 照舊不播', () => {
    expect(heroMayAutoplay(false)).toBe(true)
    expect(heroMayAutoplay(false, { effectiveType: '4g' })).toBe(true)
    expect(heroMayAutoplay(false, { effectiveType: '4g', downlink: 0 })).toBe(true)
    expect(heroMayAutoplay(true, { downlink: 10 })).toBe(false)
    expect(heroMayAutoplay(false, { saveData: true, downlink: 10 })).toBe(false)
    expect(heroMayAutoplay(false, { effectiveType: '3g', downlink: 10 })).toBe(false)
  })
  it('影片衍生檔只覆蓋已知來源，保留未來 CMS 自訂來源', () => {
    expect(backgroundVideoSrc('assets/hero-campus.mp4', true)).toContain('hero-mobile')
    expect(backgroundVideoSrc('assets/custom.mp4', true)).toBe('/assets/custom.mp4')
  })
  it('桌機素材在橫拿手機（mobile=true）也換成手機編碼，不下載桌機母帶', () => {
    expect(backgroundVideoSrc('assets/day-film.mp4', true)).toContain('day-mobile')
    expect(backgroundVideoSrc('assets/day-film.mp4', false)).toContain('day-desktop')
    expect(backgroundVideoSrc('assets/hero-campus.mp4', false)).toContain('hero-desktop')
    expect(backgroundVideoSrc('assets/day-film-mobile.mp4', true)).toContain('day-mobile')
  })
  it('每個圖片候選寬度真實、不放大，未知素材保留原網址', () => {
    const result = responsiveImage('hero-campus-still', '100vw')
    expect(result.width).toBeGreaterThan(0)
    expect(result.srcset).toContain('480w')
    expect(result.sizes).toBe('100vw')
    expect(responsiveImage('future-cms-photo').srcset).toBeUndefined()
  })
})
