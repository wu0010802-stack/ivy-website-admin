import { describe, expect, it, vi } from 'vitest'
import { HERO_AV1_TYPE, HERO_MIN_DOWNLINK_MBPS, heroAv1Src, heroAv1Verdict, heroMayAutoplay, mayAutoplay, preferAv1, backgroundVideoSrc } from '../app/utils/media-policy'
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
  it('消息「一起跑向前」用自己的舊首屏片，不跟著首屏換成混剪', () => {
    expect(backgroundVideoSrc('assets/campus-film-run.mp4', true)).toMatch(/campus-run-[0-9a-f]{12}\.mp4$/)
    expect(backgroundVideoSrc('assets/campus-film-run.mp4', true)).not.toBe(backgroundVideoSrc('assets/hero-campus.mp4', true))
  })
  it('首屏影片的 AV1 版只給首屏素材，桌機／手機各一支；其他影片沒有 AV1', () => {
    expect(heroAv1Src('assets/hero-campus.mp4', false)).toMatch(/hero-desktop-av1-[0-9a-f]{12}\.mp4$/)
    expect(heroAv1Src('assets/hero-campus.mp4', true)).toMatch(/hero-mobile-av1-[0-9a-f]{12}\.mp4$/)
    expect(heroAv1Src('assets/day-film.mp4', false)).toBeNull()
    expect(heroAv1Src('assets/custom.mp4', true)).toBeNull()
  })
  it('AV1 要支援又能順播；觸控裝置還要硬體解碼，桌機軟體解碼可以', () => {
    const hw = { supported: true, smooth: true, powerEfficient: true }
    const sw = { supported: true, smooth: true, powerEfficient: false }
    expect(preferAv1(hw, true)).toBe(true)
    expect(preferAv1(sw, false)).toBe(true)
    expect(preferAv1(sw, true)).toBe(false)
    expect(preferAv1({ ...hw, smooth: false }, false)).toBe(false)
    expect(preferAv1({ ...hw, supported: false }, false)).toBe(false)
    expect(preferAv1(null, false)).toBe(false)
  })
  it('查詢 AV1 解碼能力：沒有 API、拋錯或逾時都回 null（改用 H.264），有結果照實回傳', async () => {
    expect(await heroAv1Verdict(undefined, false)).toBeNull()
    expect(await heroAv1Verdict(() => Promise.reject(new TypeError('unsupported')), false)).toBeNull()
    vi.useFakeTimers()
    const pending = heroAv1Verdict(() => new Promise(() => {}), true)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toBeNull()
    vi.useRealTimers()
    const asked: unknown[] = []
    const verdict = await heroAv1Verdict(async (config) => {
      asked.push(config)
      return { supported: true, smooth: true, powerEfficient: false }
    }, true)
    expect(verdict).toEqual({ supported: true, smooth: true, powerEfficient: false })
    expect(asked).toEqual([{ type: 'file', video: expect.objectContaining({ contentType: HERO_AV1_TYPE, width: 1080, height: 800, framerate: 30 }) }])
  })
  it('每個圖片候選寬度真實、不放大，未知素材保留原網址', () => {
    const result = responsiveImage('hero-campus-still', '100vw')
    expect(result.width).toBeGreaterThan(0)
    expect(result.srcset).toContain('480w')
    expect(result.sizes).toBe('100vw')
    expect(responsiveImage('future-cms-photo').srcset).toBeUndefined()
  })
})
