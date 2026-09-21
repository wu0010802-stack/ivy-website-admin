import { describe, it, expect } from 'vitest'
import { applyContentOverlay } from '../app/utils/content-overlay'
import type { SiteContent } from '../app/types/site-content'

function makeFixture(): SiteContent {
  return {
    schemaVersion: 'fixture-test',
    home: {
      hero: {
        eyebrow: 'fixture eyebrow',
        titleParts: {
          before: '',
          punctAfterBefore: '',
          middle: '',
          growingWord: '',
          punctAfterGrowingWord: ''
        },
        copyLines: ['fixture line 1'],
        ctaLabel: 'fixture cta',
        ctaHref: '#/home/life',
        heroImage: 'fixture-image',
        heroImageAlt: 'fixture alt',
        heroVideoSrc: 'fixture.mp4',
        heroVideoPoster: 'fixture.webp'
      },
      about: {
        anchorId: 'about',
        sinceLabel: 'fixture since',
        title: 'fixture title',
        watermark: { top: '', bottom: '' },
        bodyText: 'fixture body',
        photos: [],
        caption: 'fixture caption'
      },
      campusBoard: {
        sectionTitle: '',
        eyebrow: '',
        note: '',
        defaultCampus: 'yihua',
        campusOrder: ['yihua']
      }
    },
    footer: { tagline: 'fixture tagline' } as SiteContent['footer']
  } as unknown as SiteContent
}

describe('applyContentOverlay：CMS 疊資料到 fixture', () => {
  it('沒有 overlay 時完全不動 fixture 原文', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {})
    expect(result.home.about.title).toBe('fixture title')
    expect(result.home.hero.eyebrow).toBe('fixture eyebrow')
    expect(result.footer.tagline).toBe('fixture tagline')
  })

  it('只疊有給的 kind，其餘保留 fixture 原文', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      home_about: {
        title: '已發布標題',
        since_label: '已發布 since',
        body_text: '已發布內文',
        caption: '已發布 caption'
      }
    })
    expect(result.home.about.title).toBe('已發布標題')
    expect(result.home.about.sinceLabel).toBe('已發布 since')
    // 沒給 home_hero／site_footer，維持 fixture 原文
    expect(result.home.hero.eyebrow).toBe('fixture eyebrow')
    expect(result.footer.tagline).toBe('fixture tagline')
  })

  it('三個 kind 都給時全部套用', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      home_about: {
        title: 'A',
        since_label: 'B',
        body_text: 'C',
        caption: 'D'
      },
      home_hero: { eyebrow: 'E', copy_lines: ['F', 'G'], cta_label: 'H' },
      site_footer: { tagline: 'I' }
    })
    expect(result.home.about.title).toBe('A')
    expect(result.home.hero.eyebrow).toBe('E')
    expect(result.home.hero.copyLines).toEqual(['F', 'G'])
    expect(result.footer.tagline).toBe('I')
  })

  it('null 值視同沒有 overlay（不會用 null 蓋掉 fixture 欄位）', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, { home_about: null, home_hero: null, site_footer: null })
    expect(result.home.about.title).toBe('fixture title')
    expect(result.home.hero.eyebrow).toBe('fixture eyebrow')
    expect(result.footer.tagline).toBe('fixture tagline')
  })

  it('不修改傳入的 fixture 物件本身（回傳新物件）', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      home_about: { title: '改過的標題', since_label: 'x', body_text: 'x', caption: 'x' }
    })
    expect(fixture.home.about.title).toBe('fixture title')
    expect(result).not.toBe(fixture)
    expect(result.home).not.toBe(fixture.home)
  })

  it('未動到的欄位（例如 about.photos）維持原陣列參照內容一致', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      home_hero: { eyebrow: 'X', copy_lines: ['Y'], cta_label: 'Z' }
    })
    expect(result.home.about).toEqual(fixture.home.about)
  })
})
