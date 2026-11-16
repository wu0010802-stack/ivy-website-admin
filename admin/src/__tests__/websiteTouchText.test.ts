import { describe, expect, it } from 'vitest'
import { AD_PLATFORM_LABELS, websiteTouchText } from '../api/labels'

describe('網站來源顯示廣告平台（2026-11-16）', () => {
  it('付費廣告有平台時寫在名稱後面', () => {
    // 兩次一樣只寫一次；只有第一次時前面有「第一次」（既有行為）。
    expect(websiteTouchText({
      first_touch_source: 'ads', first_touch_ad_platform: 'google', first_touch_on: '2026-11-16',
      last_touch_source: 'ads', last_touch_ad_platform: 'google', last_touch_on: '2026-11-16',
    })).toBe('付費廣告・Google，11/16')
    expect(websiteTouchText({ first_touch_source: 'ads', first_touch_ad_platform: 'google', first_touch_on: '2026-11-16' }))
      .toBe('第一次付費廣告・Google，11/16')
  })

  it('沒有平台維持原本寫法；非廣告來源不帶平台', () => {
    expect(websiteTouchText({ first_touch_source: 'ads', first_touch_on: '2026-11-16' })).toBe('第一次付費廣告，11/16')
    expect(websiteTouchText({ first_touch_source: 'search', first_touch_ad_platform: 'google', first_touch_on: '2026-11-16' }))
      .toBe('第一次搜尋引擎，11/16')
  })

  it('第一次與最後一次平台不同時分開寫', () => {
    expect(websiteTouchText({
      first_touch_source: 'ads', first_touch_ad_platform: 'meta', first_touch_on: '2026-11-10',
      last_touch_source: 'ads', last_touch_ad_platform: 'openai', last_touch_on: '2026-11-16',
    })).toBe('第一次付費廣告・Meta，11/10；預約前付費廣告・ChatGPT，11/16')
  })

  it('平台標籤', () => {
    expect(AD_PLATFORM_LABELS).toEqual({ google: 'Google', openai: 'ChatGPT', meta: 'Meta', line: 'LINE', other: '其他網路廣告' })
  })
})
