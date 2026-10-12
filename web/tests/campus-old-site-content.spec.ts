import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import manifest from '../app/generated/image-manifest.json'
import type { SiteContent } from '../app/types/site-content'

// 2026-09-26 從舊官網搬來的分校內容：四校校園探索換成真實場景、義華家長分享影片。
const site = fixture as unknown as SiteContent
const images = manifest as Record<string, { width: number; height: number }>

describe('五校校園探索都是真實場景', () => {
  it.each(site.campuses.map((c) => [c.key, c.tourScenes] as const))('%s 是逐校撰寫的場景陣列', (_key, scenes) => {
    expect(Array.isArray(scenes)).toBe(true)
    expect(scenes.length).toBeGreaterThan(0)
  })

  const scenes = site.campuses.flatMap((c) => c.tourScenes.map((s) => [c.key, s] as const))
  it.each(scenes.map(([key, s]) => [`${key}/${s.key}`, s] as const))('%s：照片 8:5（畫面用 object-fit: fill）、熱點在照片內', (_id, scene) => {
    const image = images[scene.image]
    expect(image, scene.image).toBeTruthy()
    expect(image.width / image.height).toBeCloseTo(1.6, 2)
    expect(scene.spots.length).toBeGreaterThanOrEqual(2)
    for (const spot of scene.spots) {
      expect(spot.x).toBeGreaterThanOrEqual(0); expect(spot.x).toBeLessThanOrEqual(100)
      expect(spot.y).toBeGreaterThanOrEqual(0); expect(spot.y).toBeLessThanOrEqual(100)
      expect(spot.text.length).toBeGreaterThan(0)
    }
  })
  it('同一校的場景 key 不重複', () => {
    for (const campus of site.campuses) {
      const keys = campus.tourScenes.map((s) => s.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('家長分享影片', () => {
  it('只有義華有，不拿義華的影片代填其他校', () => {
    expect(site.campuses.filter((c) => c.testimonials?.length).map((c) => c.key)).toEqual(['yihua'])
  })
  it('海報檔都在、YouTube id 格式正確', () => {
    const yihua = site.campuses.find((c) => c.key === 'yihua')!
    for (const item of yihua.testimonials!) {
      expect(item.youtubeId).toMatch(/^[\w-]{11}$/)
      expect(item.poster).toMatch(/^\/assets\//)
      expect(existsSync(fileURLToPath(new URL(`../public${item.poster}`, import.meta.url))), item.poster).toBe(true)
      expect(item.quote.length).toBeGreaterThan(0)
      expect(item.speaker.length).toBeGreaterThan(0)
    }
  })
})
