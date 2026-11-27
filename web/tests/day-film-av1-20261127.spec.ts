import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import videos from '../app/generated/video-manifest.json'
import { DAY_AV1, av1Verdict, backgroundVideoSrc, dayAv1 } from '../app/utils/media-policy'

// 2026-11-27：孩子的一天另有一份 AV1（scripts/optimize-site-videos.py），選用條件同首屏，失敗退回 H.264。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const publicFile = (src: string) => fileURLToPath(new URL(`../public${src}`, import.meta.url))

describe('孩子的一天 AV1', () => {
  it('兩支內建影片都有 AV1，檔案存在而且比 H.264 小三成以上', () => {
    for (const [source, h264Key] of [['assets/day-film.mp4', 'day-desktop'], ['assets/day-film-mobile.mp4', 'day-mobile']] as const) {
      const av1 = dayAv1(source)
      expect(av1).not.toBeNull()
      expect(av1!.src).toMatch(new RegExp(`^/assets/optimized/${h264Key}-av1-[0-9a-f]{12}\\.mp4$`))
      expect(existsSync(publicFile(av1!.src))).toBe(true)
      const h264 = (videos as Record<string, string>)[h264Key]!
      expect(backgroundVideoSrc(source, false)).toBe(h264)
      expect(statSync(publicFile(av1!.src)).size).toBeLessThan(statSync(publicFile(h264)).size * 0.7)
    }
  })

  it('後台上傳、首屏、未知來源沒有 day AV1', () => {
    expect(dayAv1('https://example.com/media/x.mp4')).toBeNull()
    expect(dayAv1('assets/hero-campus.mp4')).toBeNull()
    expect(dayAv1('__proto__')).toBeNull()
  })

  it('問解碼能力用各自的尺寸與 codecs（桌機 level 4.0、手機 3.1），逾時回 null', async () => {
    const asked: unknown[] = []
    const verdict = await av1Verdict(async (config) => { asked.push(config); return { supported: true, smooth: true, powerEfficient: true } }, DAY_AV1['assets/day-film.mp4'].video)
    expect(verdict).toEqual({ supported: true, smooth: true, powerEfficient: true })
    expect(asked).toEqual([{ type: 'file', video: { contentType: 'video/mp4; codecs="av01.0.08M.10"', width: 1440, height: 810, bitrate: 2_000_000, framerate: 30 } }])
    expect(DAY_AV1['assets/day-film-mobile.mp4'].video).toMatchObject({ contentType: 'video/mp4; codecs="av01.0.05M.10"', width: 720, height: 1280 })
    expect(await av1Verdict(undefined, DAY_AV1['assets/day-film-mobile.mp4'].video)).toBeNull()
  })

  it('DayExperience：掛載時問、要給 src 時才用；AV1 失敗換回 H.264 再播，H.264 也失敗才收起影片', () => {
    const source = read('../app/components/DayExperience.vue')
    expect(source).toContain('if (wantsPlayback) void chooseAv1()')
    expect(source).toContain("preferAv1(verdict, window.matchMedia('(pointer: coarse)').matches)")
    expect(source).toContain('fallbackSrc = av1 ? h264 : \'\'')
    expect(source).toMatch(/if \(video && fallbackSrc\) \{\s*video\.src = fallbackSrc\s*fallbackSrc = ''\s*av1Choice = null\s*applyFilm\(\)\s*return\s*\}\s*hasFailed\.value = true/)
  })
})
