import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveCampusProfile, type LiveDayMoment } from '../app/utils/content-overlay'
import { publishedContent } from '../app/utils/published-content'
import { sitemapXml } from '../app/utils/seo'
import { campusMapUrl, isMapUrl, siteLink } from '../app/utils/site-links'

const site = fixture as unknown as SiteContent

function profile(name: string, extra: Partial<LiveCampusProfile> = {}): LiveCampusProfile {
  return { name, district: '區', address: '高雄市某路1號', phone: '07', intro: '', description: '', facebook: '', fb_note: '', line: '', ...extra }
}

describe('停用的分校（後端不輸出那一校的內容）', () => {
  it('首頁五校、頁尾、選單與 sitemap 都只列公開內容裡有的校區；重新啟用後恢復', () => {
    const live = (keys: string[]) => ({
      schema_version: '1',
      release_id: 'r1',
      content: { campus_profile: Object.fromEntries(keys.map((key) => [key, profile(`${key}校`)])) }
    })
    const active = ['yihua', 'minghua', 'chongde', 'international']
    const off = publishedContent(site, live(active)).content
    expect(off.campuses.map((c) => c.key)).toEqual(active)
    expect(sitemapXml('https://ivy.example', off.campuses)).not.toContain('/campuses/renwu')

    const on = publishedContent(site, live([...active, 'renwu'])).content
    expect(on.campuses.map((c) => c.key)).toContain('renwu')
    expect(sitemapXml('https://ivy.example', on.campuses)).toContain('/campuses/renwu')
  })
})

describe('首頁五校順序與預設校區', () => {
  const board = { section_title: '分校資訊', eyebrow: 'Campuses', note: '' }

  it('照後台設定的順序與預設校區', () => {
    const order = ['renwu', 'chongde', 'yihua', 'minghua', 'international']
    const result = applyContentOverlay(site, { home_campus_board: { ...board, campus_order: order, default_campus: 'chongde' } })
    expect(result.home.campusBoard.campusOrder).toEqual(order)
    expect(result.home.campusBoard.defaultCampus).toBe('chongde')
  })

  it('舊版本沒有這兩個欄位，或排列不完整時沿用內建順序', () => {
    const builtin = site.home.campusBoard.campusOrder
    expect(applyContentOverlay(site, { home_campus_board: board }).home.campusBoard.campusOrder).toEqual(builtin)
    const broken = applyContentOverlay(site, { home_campus_board: { ...board, campus_order: ['yihua', 'yihua'], default_campus: 'tainan' } })
    expect(broken.home.campusBoard.campusOrder).toEqual(builtin)
    expect(broken.home.campusBoard.defaultCampus).toBe(site.home.campusBoard.defaultCampus)
  })
})

describe('主選單與頁尾連結', () => {
  const meta = { title: 't', description: 'd', header_phone_number: '07', header_phone_note: 'n' }
  const footer = { tagline: 't', copyright: 'c', bottom_note: '', campus_list_label: 'l' }

  it('站內路徑與 https 外部連結可用，外部連結標記另開', () => {
    expect(siteLink('/admission')).toEqual({ href: '/admission', external: false })
    expect(siteLink('/#about')).toEqual({ href: '/#about', external: false })
    expect(siteLink('https://www.ivykidschool.com/')).toEqual({ href: 'https://www.ivykidschool.com/', external: true })
    for (const bad of ['http://example.com', '//example.com', 'javascript:alert(1)', '#/visit', 'https://a b.com', 'https://user@example.com/', '/\\evil.com', '', 'https://example.com:99999/', 'https://example.com:abc/', 'https://exa%mple.com/']) {
      expect(siteLink(bad)).toBeNull()
    }
  })

  it('後台發布的選單與頁尾連結取代內建的，無效的項目略過', () => {
    const result = applyContentOverlay(site, {
      site_meta: {
        ...meta,
        primary_nav: [
          { label: '入學資訊', label_en: 'Admission', href: '/admission' },
          { label: '壞連結', label_en: '', href: 'javascript:alert(1)' },
          { label: '機構官網', href: 'https://www.ivykidschool.com/' }
        ]
      },
      site_footer: { ...footer, links: [{ label: '預約參觀', href: '/visit' }] }
    })
    expect(result.siteMeta.primaryNav).toEqual([
      { label: '入學資訊', labelEn: 'Admission', href: '/admission' },
      { label: '機構官網', labelEn: '', href: 'https://www.ivykidschool.com/' }
    ])
    expect(result.footer.links).toEqual([{ label: '預約參觀', href: '/visit' }])
  })

  it('沒有設定過（舊版本或 null）時沿用內建選單與頁尾連結', () => {
    const result = applyContentOverlay(site, { site_meta: { ...meta, primary_nav: null }, site_footer: footer })
    expect(result.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav)
    expect(result.footer.links).toEqual(site.footer.links)
    // 選單不能被清成空的。
    expect(applyContentOverlay(site, { site_meta: { ...meta, primary_nav: [] } }).siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav)
    // 頁尾連結可以全部拿掉。
    expect(applyContentOverlay(site, { site_footer: { ...footer, links: [] } }).footer.links).toEqual([])
  })

  it('內建選單與頁尾連結都是有效的站內路徑', () => {
    for (const item of [...site.siteMeta.primaryNav, ...site.footer.links]) expect(siteLink(item.href)).not.toBeNull()
  })
})

describe('分校地圖網址', () => {
  it('只接受 Google 地圖網址', () => {
    for (const ok of ['https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123', 'https://www.google.com/maps/place/x', 'https://www.google.com.tw/maps', 'https://maps.google.com/?cid=1']) {
      expect(isMapUrl(ok)).toBe(true)
    }
    for (const bad of ['http://maps.app.goo.gl/AbC123', 'https://maps.app.goo.gl/', 'https://goo.gl/AbC123', 'https://www.google.com/search?q=maps', 'https://evil.example/maps/x', 'https://maps.google.com.evil.example/', 'https://www.google.com/mapsfoo', 'javascript:alert(1)']) {
      expect(isMapUrl(bad)).toBe(false)
    }
  })

  it('有地圖網址就用它，沒有或無效時用地址搜尋', () => {
    const result = applyContentOverlay(site, { campus_profile: { yihua: profile('義華校', { map_url: 'https://maps.app.goo.gl/AbC123' }), minghua: profile('明華校') } })
    const yihua = result.campuses.find((c) => c.key === 'yihua')!
    const minghua = result.campuses.find((c) => c.key === 'minghua')!
    expect(campusMapUrl(yihua)).toBe('https://maps.app.goo.gl/AbC123')
    expect(campusMapUrl(minghua)).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('高雄市某路1號')}`)
    expect(campusMapUrl({ address: '地址', mapUrl: 'https://evil.example/' })).toContain('/maps/search/')
  })
})

describe('孩子的一天：卡片以後台為準', () => {
  const builtin = site.dayExperience.moments
  const day = (moments: LiveDayMoment[]) => ({ eyebrow: 'e', eyebrow_en: 'E', note: 'n', source_note: 's', moments })
  const card = (key: string, title = key): LiveDayMoment => ({ key, time: '08:00', label: 'l', caption: 'c', title, story: 's', question: 'q', answer: 'a' })

  it('現有六張照原樣帶回照片與色調（桌機、手機外觀不變）', () => {
    const result = applyContentOverlay(site, { day_experience: day(builtin.map((m) => card(m.key, `${m.key}-新標題`))) })
    expect(result.dayExperience.moments.map((m) => [m.key, m.photo, m.tint, m.alt])).toEqual(builtin.map((m) => [m.key, m.photo, m.tint, m.alt]))
    expect(result.dayExperience.moments[0]!.title).toBe(`${builtin[0]!.key}-新標題`)
  })

  it('第 7 張以後的新卡會顯示，沒有照片、色調沿用同位置內建卡的節奏', () => {
    const moments = [...builtin.map((m) => card(m.key)), card('moment-new-1'), card('moment-new-2')]
    const result = applyContentOverlay(site, { day_experience: day(moments) }).dayExperience.moments
    expect(result).toHaveLength(builtin.length + 2)
    expect(result[builtin.length]).toMatchObject({ key: 'moment-new-1', photo: '', alt: '', tint: builtin[0]!.tint })
    expect(result[builtin.length + 1]).toMatchObject({ key: 'moment-new-2', photo: '', tint: builtin[1]!.tint })
  })

  it('刪卡後官網也少一張，不會由內建卡補回；調整順序時照片跟著卡片走', () => {
    const kept = [builtin[2]!, builtin[0]!]
    const result = applyContentOverlay(site, { day_experience: day(kept.map((m) => card(m.key))) }).dayExperience.moments
    expect(result.map((m) => m.key)).toEqual(kept.map((m) => m.key))
    expect(result.map((m) => m.photo)).toEqual(kept.map((m) => m.photo))
  })
})

describe('首屏按鈕文字（2026-09-23 拿掉首屏按鈕）', () => {
  it('舊版本的 cta_label 不再疊到官網內容', () => {
    const result = applyContentOverlay(site, { home_hero: { eyebrow: '小標', copy_lines: ['一'], cta_label: '舊按鈕' } })
    expect(result.home.hero.eyebrow).toBe('小標')
    expect(result.home.hero.ctaLabel).toBe(site.home.hero.ctaLabel)
  })
})

describe('明體子集字表', () => {
  it('chars-serif.txt 等於三個明體子集的字元聯集（後台缺字提示讀這份）', () => {
    const dir = resolve(__dirname, '../public/assets/fonts')
    const union = new Set<string>()
    for (const name of ['campus', 'visit', 'admission']) {
      const record = JSON.parse(readFileSync(resolve(dir, `noto-serif-tc-500-${name}.json`), 'utf8')) as { characters: string }
      for (const char of record.characters) union.add(char)
    }
    const listed = new Set(readFileSync(resolve(dir, 'chars-serif.txt'), 'utf8').trim())
    expect([...listed].sort()).toEqual([...union].sort())
  })
})
