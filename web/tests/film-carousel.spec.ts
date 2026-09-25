import { describe, expect, it } from 'vitest'
import { clipRestartTime, nearestTurn, ringOffset, settleTarget, youtubeEmbed, youtubeId } from '../app/utils/filmCarousel'
import { campusFilms, youtube } from '../app/utils/campusFilms'

describe('手機活動影片輪播', () => {
  it('環形偏移收在 [-n/2, n/2)，左右各露一張、其他在畫面外', () => {
    expect([0, 1, 2, 3].map(k => ringOffset(k, 0, 4))).toEqual([0, 1, -2, -1])
    expect(ringOffset(0, 3, 4)).toBe(1)
    expect(ringOffset(1, 0.5, 4)).toBeCloseTo(0.5)
  })
  it('點圓點走最近的方向，可以跨過頭尾', () => {
    expect(nearestTurn(0, 3, 4)).toBe(-1)
    expect(nearestTurn(3, 0, 4)).toBe(4)
    expect(nearestTurn(5, 2, 4)).toBe(6)
  })
  it('放手：快速甩一定翻一張、慢慢拖要過半，一次最多一張', () => {
    expect(settleTarget(0.2, 0, -0.5)).toBe(1)
    expect(settleTarget(-0.2, 0, 0.5)).toBe(-1)
    expect(settleTarget(0.4, 0, 0)).toBe(0)
    expect(settleTarget(0.6, 0, 0)).toBe(1)
    expect(settleTarget(1.8, 0, -2)).toBe(1)
  })
  it('看得懂常見 YouTube 網址，看不懂回空字串', () => {
    for (const url of ['https://youtu.be/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&t=3', 'https://m.youtube.com/watch?feature=share&v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk?si=x', 'https://www.youtube.com/embed/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk', 'abcdefghijk']) {
      expect(youtubeId(url)).toBe('abcdefghijk')
    }
    expect(youtubeId('https://example.com/watch?v=abcdefghijk')).toBe('')
    expect(youtubeId('not a link')).toBe('')
    expect(youtubeEmbed('abcdefghijk')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk\?/)
    expect(() => youtube('https://example.com', '壞連結')).toThrow()
    expect(youtube('https://youtu.be/abcdefghijk', '範例')).toMatchObject({ type: 'youtube', youtubeId: 'abcdefghijk' })
  })
  it('剪段循環：播到結束秒數跳回開始；結束秒數超過片長時，loop 回到 0 秒也跳回開始', () => {
    expect(clipRestartTime(4.9, 20, 2, 5)).toBeNull()
    expect(clipRestartTime(5, 20, 2, 5)).toBe(2)
    // 結束秒數 30 超過 20 秒的影片：永遠播不到，loop 回到 0 秒時要跳回 2 秒，不是整支重播。
    expect(clipRestartTime(19.9, 20, 2, 30)).toBeNull()
    expect(clipRestartTime(0.1, 20, 2, 30)).toBe(2)
    // 沒設結束：同樣靠回到開頭前跳回。
    expect(clipRestartTime(0, 20, 2, null)).toBe(2)
    expect(clipRestartTime(1.9, 20, 2, null)).toBeNull()
    // 片長還不知道（metadata 沒載完）照結束秒數判斷。
    expect(clipRestartTime(5, Number.NaN, 2, 5)).toBe(2)
    // 開始秒數超過片長：整支從頭播，不在結尾與開頭之間來回跳。
    expect(clipRestartTime(0, 20, 25, null)).toBeNull()
    expect(clipRestartTime(0, 20, 25, 30)).toBeNull()
  })
  it('檔案影片的剪段在片長內、都有海報與標題', () => {
    for (const film of campusFilms) {
      expect(film.title.length).toBeGreaterThan(0)
      expect(film.poster).toMatch(/^\/assets\/|^https:\/\/i\.ytimg\.com\//)
      if (film.type === 'file') expect(film.end).toBeGreaterThan(film.start)
    }
  })
})
