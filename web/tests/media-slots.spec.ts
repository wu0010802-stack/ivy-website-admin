import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, homeFilms, type ContentOverlay } from '../app/utils/content-overlay'
import { publishedContent } from '../app/utils/published-content'
import { previewMedia } from '../app/utils/draft-preview'
import { focusPosition, heroImageAttrs, mediaImage, mediaImageAttrs, pickImage, slotImage, videoPosterUrl, type MediaInfoMap, type PublicMediaInfo } from '../app/utils/media-image'
import { responsiveTourImage } from '../app/utils/tour-image'
import { campusShareImagePath, siteShareImage } from '../app/utils/seo'

const site = fixture as unknown as SiteContent
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
// initialize-content 匯入後的內容（後端 initial_payloads＋public_view 產生，素材版位都是 null）。
const initialOverlay = read('overlay-initial-content.json') as ContentOverlay
// 同一份內容用 2026-09-25 這批改動之前的 content-overlay.ts／published-content.ts 疊出來的結果
// （2026-09-26 起消息與活動逐則多一個 sample 示意旗標，其餘不變）。
const baseline = read('overlay-baseline-20260925.json') as SiteContent

const IMAGE = '11111111-1111-4111-8111-111111111111'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const VIDEO_M = '33333333-3333-4333-8333-333333333333'
const COVER = '44444444-4444-4444-8444-444444444444'

function info(id: string, overrides: Partial<PublicMediaInfo> = {}): PublicMediaInfo {
  return {
    id, kind: 'image', content_type: 'image/jpeg', width: 2400, height: 1600, alt_text: '素材說明',
    focus_x: null, focus_y: null,
    variants: [{ kind: 'thumbnail', width: 480, height: 320 }, { kind: 'large', width: 1600, height: 1067 }],
    ...overrides
  }
}

const media: MediaInfoMap = {
  [IMAGE]: info(IMAGE, { focus_x: 30, focus_y: 60 }),
  [COVER]: info(COVER),
  [VIDEO]: info(VIDEO, { kind: 'video', content_type: 'video/mp4', variants: [{ kind: 'poster', width: 480, height: 270 }] }),
  [VIDEO_M]: info(VIDEO_M, { kind: 'video', content_type: 'video/mp4', variants: [] })
}

describe('素材版位沒設定時，官網輸出跟這批改動之前完全相同', () => {
  it('initialize-content 的內容（版位都是 null）疊出來的結果與改動前逐欄相同', () => {
    const now = publishedContent(site, { schema_version: '1', release_id: 'r1', content: initialOverlay, media: {} })
    expect(JSON.parse(JSON.stringify(now.content))).toEqual(baseline)
  })

  it('舊版 API 沒有 media 也一樣', () => {
    const now = publishedContent(site, { schema_version: '1', release_id: 'r1', content: initialOverlay })
    expect(JSON.parse(JSON.stringify(now.content))).toEqual(baseline)
  })

  it('沒有任何內容時維持 fixture 的內建素材', () => {
    const out = applyContentOverlay(site, {}, media)
    expect(out.home.hero).toEqual(site.home.hero)
    expect(out.dayExperience).toEqual(site.dayExperience)
    expect(out.campuses).toEqual(site.campuses.map((c) => ({ ...c, faq: { ...c.faq } })))
    expect(out.news.films).toBeUndefined()
  })
})

describe('media-image', () => {
  it('srcset 由縮圖、大圖與原檔組成，焦點轉成 object-position', () => {
    const image = mediaImage(IMAGE, media[IMAGE], focusPosition({ x: 30, y: 60 }))
    expect(mediaImageAttrs(image, '100vw')).toEqual({
      src: `/api/website/v1/public/media/${IMAGE}/file`,
      width: 2400,
      height: 1600,
      srcset: `/api/website/v1/public/media/${IMAGE}/variants/thumbnail 480w, /api/website/v1/public/media/${IMAGE}/variants/large 1600w, /api/website/v1/public/media/${IMAGE}/file 2400w`,
      sizes: '100vw'
    })
    expect(image.position).toBe('30% 60%')
  })

  it('衍生檔網址帶版本（重新產生後避開快取）；寬度不明的衍生檔不放進 srcset', () => {
    const versioned = info(IMAGE, {
      variants: [
        { kind: 'thumbnail', width: 480, height: 320, version: 'a1b2c3' },
        { kind: 'large', width: null, height: null, version: 'd4e5f6' }
      ]
    })
    expect(mediaImageAttrs(mediaImage(IMAGE, versioned), '100vw').srcset).toBe(
      `/api/website/v1/public/media/${IMAGE}/variants/thumbnail?v=a1b2c3 480w, /api/website/v1/public/media/${IMAGE}/file 2400w`
    )
    const video = info(VIDEO, { kind: 'video', content_type: 'video/mp4', variants: [{ kind: 'poster', width: 480, height: 270, version: 'p9' }] })
    expect(videoPosterUrl(VIDEO, video)).toBe(`/api/website/v1/public/media/${VIDEO}/variants/poster?v=p9`)
  })

  it('沒有素材資訊（或只有原檔）時不輸出 srcset', () => {
    expect(mediaImageAttrs(mediaImage(IMAGE), '100vw')).toEqual({ src: `/api/website/v1/public/media/${IMAGE}/file`, width: undefined, height: undefined, srcset: undefined, sizes: undefined })
    const small = info(IMAGE, { width: 480, variants: [{ kind: 'thumbnail', width: 480, height: 320 }] })
    expect(mediaImageAttrs(mediaImage(IMAGE, small), '50vw').srcset).toBeUndefined()
  })

  it('版位焦點優先，其次素材預設焦點，都沒有就是 null', () => {
    expect(slotImage({ media_id: IMAGE, focus_x: 10, focus_y: 20 }, media)!.position).toBe('10% 20%')
    expect(slotImage({ media_id: IMAGE }, media)!.position).toBe('30% 60%')
    expect(slotImage({ media_id: COVER }, media)!.position).toBeNull()
    expect(slotImage({ media_id: 'day-hello' }, media)).toBeUndefined()
    expect(slotImage(null, media)).toBeUndefined()
  })

  it('pickImage：有素材用素材，沒有用內建 manifest', () => {
    expect(pickImage('day-hello', undefined, '540px')).toEqual(pickImage('day-hello', undefined, '540px'))
    expect(pickImage('day-hello', undefined, '540px').src).toBe('/assets/day-hello.webp')
    expect(pickImage('day-hello', slotImage({ media_id: IMAGE }, media), '540px').src).toContain(IMAGE)
  })

  it('舊的素材 id 圖片欄位（消息、探索場景）有素材資訊時也有 srcset，放大檢視用原檔', () => {
    const image = mediaImage(IMAGE, media[IMAGE])
    expect(responsiveTourImage(IMAGE, '50vw', false, image).srcset).toContain('480w')
    expect(responsiveTourImage(IMAGE, '50vw', true, image)).toMatchObject({ src: `/api/website/v1/public/media/${IMAGE}/file`, srcset: undefined })
    expect(responsiveTourImage(IMAGE, '50vw')).toEqual({ src: `/api/website/v1/public/media/${IMAGE}/file`, width: undefined, height: undefined, srcset: undefined, sizes: undefined })
  })
})

describe('素材版位疊到官網內容', () => {
  it('首屏：poster、替代圖、桌機與手機影片', () => {
    const out = applyContentOverlay(site, {
      home_hero: {
        eyebrow: '小標', copy_lines: ['一'],
        video_desktop: { media_id: VIDEO, focus_x: 40, focus_y: 50 },
        poster: { media_id: IMAGE }, poster_alt: '', fallback_image: { media_id: COVER }
      }
    }, media)
    const hero = out.home.hero
    expect(hero.heroVideoSrc).toBe(`/api/website/v1/public/media/${VIDEO}/file`)
    // 手機沒設就用桌機那支。
    expect(hero.heroVideoSrcMobile).toBe(hero.heroVideoSrc)
    expect(hero.heroVideoPosition).toBe('40% 50%')
    expect(hero.heroImageMedia!.src).toContain(IMAGE)
    // 沒寫替代文字用素材庫的說明。
    expect(hero.heroImageAlt).toBe('素材說明')
    expect(hero.heroFallbackMedia!.src).toContain(COVER)
    expect(heroImageAttrs(hero).src).toContain(IMAGE)
    expect(siteShareImage(out).path).toContain(IMAGE)

    const both = applyContentOverlay(site, {
      home_hero: { eyebrow: '', copy_lines: ['一'], video_mobile: { media_id: VIDEO_M }, poster_alt: '孩子奔跑' }
    }, media).home.hero
    expect(both.heroVideoSrc).toBe(site.home.hero.heroVideoSrc)
    expect(both.heroVideoSrcMobile).toContain(VIDEO_M)
    // 沒換 poster：照片與替代文字都維持內建。
    expect(both.heroImageMedia).toBeUndefined()
    expect(both.heroImageAlt).toBe(site.home.hero.heroImageAlt)
  })

  it('關於照片與替代文字', () => {
    const about = applyContentOverlay(site, {
      home_about: { title: 't', since_label: 's', body_text: 'b', caption: 'c', photo: { media_id: IMAGE }, photo_alt: '孩子與長輩' }
    }, media).home.about
    expect(about.photos[0]).toMatchObject({ image: '', alt: '孩子與長輩', role: 'portrait' })
    expect(about.photos[0]!.media!.position).toBe('30% 60%')
  })

  it('孩子的一天：影片、poster、說明文字與卡片照片／alt／色調', () => {
    const day = site.dayExperience
    const out = applyContentOverlay(site, {
      day_experience: {
        eyebrow: '', eyebrow_en: '', note: '', source_note: '',
        film_desktop: { media_id: VIDEO }, film_mobile: { media_id: VIDEO_M }, film_poster: { media_id: COVER },
        film_caption_zh: '明華校 · 運動會', film_caption_en: null,
        moments: [
          { key: 'hello', time: '8', label: 'l', caption: '', title: '', story: '', question: '', answer: '', photo: { media_id: IMAGE, focus_x: 50, focus_y: 10 }, alt: '', tint: 'peach' },
          { key: 'discover', time: '9', label: 'l', caption: '', title: '', story: '', question: '', answer: '', alt: '操作教具' },
          { key: 'new-card', time: '10', label: 'l', caption: '', title: '', story: '', question: '', answer: '' }
        ]
      }
    }, media).dayExperience
    expect(out.filmSrc).toContain(VIDEO)
    expect(out.filmSrcMobile).toContain(VIDEO_M)
    expect(out.filmPosterMedia!.src).toContain(COVER)
    expect(out.filmCaption).toEqual({ zh: '明華校 · 運動會', en: day.filmCaption.en })
    const [hello, discover, fresh] = out.moments
    expect(hello).toMatchObject({ photo: '', tint: 'peach', alt: '素材說明' })
    expect(hello!.photoMedia!.position).toBe('50% 10%')
    // 沒換照片：內建照片，alt 用後台寫的。
    const builtin = day.moments.find((m) => m.key === 'discover')!
    expect(discover).toMatchObject({ photo: builtin.photo, tint: builtin.tint, alt: '操作教具' })
    expect(discover!.photoMedia).toBeUndefined()
    expect(fresh).toMatchObject({ photo: '', alt: '' })
  })

  it('分校：封面、兩個版位各自的焦點與線稿', () => {
    const base = { name: '義華校', district: '', address: '', phone: '', intro: '', description: '', facebook: '', fb_note: '', line: '' }
    const yihua = site.campuses.find((c) => c.key === 'yihua')!
    const onlyFocus = applyContentOverlay(site, { campus_profile: { yihua: { ...base, card_focus: { x: 20, y: 70 } } } }, media)
      .campuses.find((c) => c.key === 'yihua')!
    // 只調焦點、沒換封面：照片仍是內建，分校頁首屏維持內建位置。
    expect(onlyFocus.image).toBe(yihua.image)
    expect(onlyFocus.panoramaPos).toBe('20% 70%')
    expect(onlyFocus.heroPhotoPos).toBe(yihua.heroPhotoPos)
    expect(onlyFocus.imageMedia).toBeUndefined()

    const replaced = applyContentOverlay(site, {
      campus_profile: { yihua: { ...base, cover: { media_id: COVER }, hero_focus: { x: 85, y: 8 }, line_art: { media_id: IMAGE } } }
    }, media).campuses.find((c) => c.key === 'yihua')!
    expect(replaced.imageMedia!.src).toContain(COVER)
    // 換了封面：內建的 CSS 位置不再套用（是別張照片），沒設的版位交給元件預設。
    expect(replaced.panoramaPos).toBeNull()
    expect(replaced.heroPhotoPos).toBe('85% 8%')
    expect(replaced.lineArtMedia!.src).toContain(IMAGE)
    // 沒換上色版：用新線稿，不疊舊建築的顏色。
    expect(replaced.lineArtColourMedia).toEqual(replaced.lineArtMedia)
    expect(campusShareImagePath(replaced)).toContain(COVER)
  })

  it('活動影片清單', () => {
    const films = homeFilms([
      { id: 'run', title: '一起跑', source: 'file', video: { media_id: VIDEO }, start: 1, end: null },
      { id: 'stage', title: '上台', source: 'file', video: { media_id: VIDEO_M }, poster: { media_id: IMAGE } },
      { id: 'yt', title: '表演', source: 'youtube', youtube_url: 'https://youtu.be/dQw4w9WgXcQ' },
      { id: 'bad', title: '壞掉', source: 'youtube', youtube_url: 'nope' }
    ], media)
    expect(films).toEqual([
      { id: 'run', title: '一起跑', type: 'file', src: `/api/website/v1/public/media/${VIDEO}/file`, start: 1, end: null, poster: `/api/website/v1/public/media/${VIDEO}/variants/poster` },
      { id: 'stage', title: '上台', type: 'file', src: `/api/website/v1/public/media/${VIDEO_M}/file`, start: 0, end: null, poster: `/api/website/v1/public/media/${IMAGE}/file` },
      { id: 'yt', title: '表演', type: 'youtube', youtubeId: 'dQw4w9WgXcQ', poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }
    ])
    const news = applyContentOverlay(site, { home_news: { sample_note: '', articles: [], events: [], films: [{ id: 'yt', title: '表演', source: 'youtube', youtube_url: 'dQw4w9WgXcQ' }] } }, media).news
    expect(news.films).toHaveLength(1)
    // 清單全部無效時沿用內建（不讓輪播空白）。
    expect(applyContentOverlay(site, { home_news: { sample_note: '', articles: [], events: [], films: [] } }, media).news.films).toBeUndefined()
  })

  it('消息封面與探索場景的素材 id 補上 srcset 資訊', () => {
    const article = { id: 'a', date: '2026-10-01', category: '', title: 't', description: '', image: IMAGE, alt: '', scope: 'global' as const }
    const out = applyContentOverlay(site, {
      home_news: { sample_note: '', articles: [article, { ...article, id: 'b', image: 'garden' }], events: [] },
      campus_tour: { yihua: { scenes: [{ key: 'hall', name: '大廳', image: IMAGE, intro: '', spots: [] }] } }
    }, media)
    expect(out.news.articles[0]!.imageMedia!.candidates).toHaveLength(3)
    expect(out.news.articles[1]!.imageMedia).toBeUndefined()
    const scenes = out.campuses.find((c) => c.key === 'yihua')!.tourScenes as { imageMedia?: unknown }[]
    expect(scenes[0]!.imageMedia).toBeDefined()
  })
})

describe('草稿預覽的素材資訊', () => {
  it('後台素材清單換成公開 API 的形狀，焦點 0–1 換成 0–100，未完成的略過', () => {
    const map = previewMedia([
      { id: IMAGE, kind: 'image', status: 'ready', content_type: 'image/jpeg', width: 10, height: 8, alt_text: 'a', crop_focus_x: 0.305, crop_focus_y: 1, variants: [{ id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', kind: 'thumbnail', width: 10, height: 8 }] },
      { id: VIDEO, kind: 'video', status: 'processing', content_type: 'video/mp4', width: null, height: null, alt_text: null, crop_focus_x: null, crop_focus_y: null, variants: [] }
    ])
    expect(Object.keys(map)).toEqual([IMAGE])
    expect(map[IMAGE]).toMatchObject({ focus_x: 30.5, focus_y: 100, alt_text: 'a' })
    // 衍生檔版本跟公開 API 一樣是記錄 id 的前 12 碼。
    expect(map[IMAGE]!.variants).toEqual([{ kind: 'thumbnail', width: 10, height: 8, version: '0f1e2d3c4b5a' }])
  })
})
