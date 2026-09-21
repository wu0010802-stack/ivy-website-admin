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
    footer: {
      tagline: 'fixture tagline',
      copyright: 'fixture copyright',
      bottomNote: 'fixture bottom note',
      campusListLabel: 'fixture campus list label'
    } as SiteContent['footer'],
    siteMeta: {
      title: 'fixture site title',
      description: 'fixture site description',
      headerPhone: { number: 'fixture-phone', note: 'fixture-note' }
    } as SiteContent['siteMeta'],
    booking: {
      ctaLabel: 'fixture cta label',
      ctaLabelEn: 'fixture cta label en',
      consentText: 'fixture consent',
      bannerTitleTemplate: 'fixture banner title',
      bannerBody: 'fixture banner body',
      bannerButtonLabel: 'fixture banner button'
    } as SiteContent['booking'],
    dayExperience: {
      eyebrow: 'fixture day eyebrow',
      eyebrowEn: 'fixture day eyebrow en',
      note: 'fixture day note',
      sourceNote: 'fixture day source note',
      moments: [
        { key: 'm1', time: '', label: '', tint: '', photo: 'fixture-photo-1', alt: '', caption: '', title: '', story: '', question: '', answer: '' },
        { key: 'm2', time: '', label: '', tint: '', photo: 'fixture-photo-2', alt: '', caption: '', title: '', story: '', question: '', answer: '' }
      ]
    } as SiteContent['dayExperience'],
    campuses: [
      {
        key: 'yihua',
        name: 'fixture 義華',
        faq: { items: [{ q: 'fixture q', a: 'fixture a' }] },
        tourScenes: { _generated: true, note: 'fixture generated placeholder' }
      } as SiteContent['campuses'][number],
      { key: 'minghua', name: 'fixture 明華', faq: { items: [] } } as SiteContent['campuses'][number]
    ]
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
      site_footer: { tagline: 'I', copyright: 'J', bottom_note: 'K', campus_list_label: 'L' }
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

  it('site_meta／home_campus_board／booking_content 都能個別套用', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      site_meta: {
        title: '新標題',
        description: '新描述',
        header_phone_number: '07-123-4567',
        header_phone_note: '新備註'
      },
      home_campus_board: { section_title: '新區塊標題', eyebrow: '新 eyebrow', note: '新說明' },
      booking_content: {
        cta_label: '新按鈕',
        cta_label_en: 'New CTA',
        consent_text: '新同意文字',
        banner_title_template: '新橫幅標題',
        banner_body: '新橫幅內文',
        banner_button_label: '新橫幅按鈕'
      }
    })
    expect(result.siteMeta.title).toBe('新標題')
    expect(result.siteMeta.headerPhone.number).toBe('07-123-4567')
    expect(result.home.campusBoard.sectionTitle).toBe('新區塊標題')
    expect(result.booking.ctaLabel).toBe('新按鈕')
  })

  it('day_experience 只覆蓋既有照片卡筆數內的文字，多出來的筆數不套用', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      day_experience: {
        eyebrow: '新 eyebrow',
        eyebrow_en: 'new eyebrow',
        note: '新說明',
        source_note: '新來源',
        moments: [
          { key: 'm1-new', time: '07:00', label: '新早晨', caption: 'c1', title: 't1', story: 's1', question: 'q1', answer: 'a1' },
          { key: 'm2-new', time: '12:00', label: '新中午', caption: 'c2', title: 't2', story: 's2', question: 'q2', answer: 'a2' },
          { key: 'm3-new', time: '18:00', label: '新傍晚', caption: 'c3', title: 't3', story: 's3', question: 'q3', answer: 'a3' }
        ]
      }
    })
    expect(result.dayExperience.eyebrow).toBe('新 eyebrow')
    expect(result.dayExperience.moments).toHaveLength(2)
    expect(result.dayExperience.moments[0]?.title).toBe('t1')
    // 照片欄位（fixture 專屬、還沒接媒體庫）維持原樣，不會被覆蓋成 undefined
    expect(result.dayExperience.moments[0]?.photo).toBe('fixture-photo-1')
    expect(result.dayExperience.moments[1]?.title).toBe('t2')
  })

  it('campus_profile／campus_faq 依 campus_key 分別套用到對應校區，不影響其他校', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      campus_profile: {
        yihua: {
          name: '義華新名稱',
          district: 'd',
          address: 'a',
          phone: 'p',
          intro: 'i',
          description: 'desc',
          facebook: 'fb',
          fb_note: 'fbn',
          line: 'https://line.me/test'
        }
      },
      campus_faq: {
        yihua: { items: [{ q: '新問題', a: '新回答' }] }
      }
    })
    const yihua = result.campuses.find((c) => c.key === 'yihua')!
    const minghua = result.campuses.find((c) => c.key === 'minghua')!
    expect(yihua.name).toBe('義華新名稱')
    expect(yihua.line).toBe('https://line.me/test')
    expect(yihua.faq.items).toEqual([{ q: '新問題', a: '新回答' }])
    // 沒給 minghua 的 overlay，維持 fixture 原文
    expect(minghua.name).toBe('fixture 明華')
  })

  it('campus_profile 的 line 為空字串時轉成 null（跟 fixture 的「尚未提供」語意一致）', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      campus_profile: {
        yihua: {
          name: 'n',
          district: 'd',
          address: 'a',
          phone: 'p',
          intro: 'i',
          description: 'desc',
          facebook: 'fb',
          fb_note: 'fbn',
          line: ''
        }
      }
    })
    const yihua = result.campuses.find((c) => c.key === 'yihua')!
    expect(yihua.line).toBeNull()
  })

  it('campus_tour 整組取代 tourScenes，含把 GeneratedTourScenes 佔位樣板換成真正場景', () => {
    const fixture = makeFixture()
    const result = applyContentOverlay(fixture, {
      campus_tour: {
        yihua: {
          scenes: [
            {
              key: 's1',
              name: '新場景',
              image: 'campus',
              intro: 'intro',
              spots: [{ name: '熱點', x: 30, y: 40, text: 't', question: 'q' }]
            }
          ]
        }
      }
    })
    const yihua = result.campuses.find((c) => c.key === 'yihua')!
    const minghua = result.campuses.find((c) => c.key === 'minghua')!
    expect(yihua.tourScenes).toEqual([
      {
        key: 's1',
        name: '新場景',
        image: 'campus',
        intro: 'intro',
        spots: [{ name: '熱點', x: 30, y: 40, text: 't', question: 'q' }]
      }
    ])
    // 沒給 minghua 的 overlay，維持 fixture 原文（undefined，因為測試 fixture 本來就沒設）
    expect(minghua.tourScenes).toBeUndefined()
  })
})
