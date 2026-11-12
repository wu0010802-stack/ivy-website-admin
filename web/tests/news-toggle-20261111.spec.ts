// 後台「網站標題與電話」的最新消息開關（2026-11-11）：關掉並發布後，首頁不放最新消息那一章、
// /news 與單篇消息導回首頁，主選單、頁尾、sitemap、llms.txt 都拿掉最新消息。預設開，舊版本沒有這個欄位＝開。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { isNewsHref, llmsTxt, newsEnabled, sitemapXml } from '../app/utils/seo'
import siteFixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const site = siteFixture as unknown as SiteContent
const meta = { title: 't', description: 'd', header_phone_number: '07', header_phone_note: 'n' }
const footer = { tagline: 't', copyright: 'c', bottom_note: 'b', campus_list_label: 'l' }

describe('最新消息開關', () => {
  it('預設開：沒有這個欄位（舊版本、內建內容）照常有最新消息', () => {
    expect(newsEnabled(undefined)).toBe(true)
    expect(newsEnabled(site.siteMeta)).toBe(true)
    const on = applyContentOverlay(site, { site_meta: meta })
    expect(newsEnabled(on.siteMeta)).toBe(true)
    // 只在關閉時寫：開著的輸出跟加開關之前逐欄相同
    expect('newsEnabled' in on.siteMeta).toBe(false)
    expect(on.footer.links.some((l) => l.href === '/news')).toBe(true)
    expect(sitemapXml('https://ivy.example', site.news)).toContain('<loc>https://ivy.example/news</loc>')
    expect(llmsTxt('https://ivy.example', on)).toContain('[最新消息](https://ivy.example/news)')
  })

  it('關閉：主選單與頁尾拿掉連到最新消息的連結，其他連結照舊', () => {
    const off = applyContentOverlay(site, {
      site_meta: { ...meta, news_enabled: false, primary_nav: [
        { label: '關於', label_en: 'About', href: '/about' },
        { label: '消息', label_en: 'News', href: '/news' },
        { label: '首頁消息', label_en: '', href: '/#latest-news' }
      ] },
      site_footer: { ...footer, links: [
        { label: '消息', href: '/news' }, { label: '義華消息', href: '/news?campus=yihua' }, { label: '某一則', href: '/news/abc' },
        { label: '首頁消息', href: '/#latest-news' }, { label: '五所校園', href: '/#campuses' }, { label: '關於', href: '/about' }
      ] }
    })
    expect(newsEnabled(off.siteMeta)).toBe(false)
    expect(off.siteMeta.primaryNav).toEqual([{ label: '關於', labelEn: 'About', href: '/about' }])
    expect(off.footer.links).toEqual([{ label: '五所校園', href: '/#campuses' }, { label: '關於', href: '/about' }])
    // 內建頁尾也有「最新消息」：沒在後台設定過頁尾時一樣拿掉
    const builtin = applyContentOverlay(site, { site_meta: { ...meta, news_enabled: false } })
    expect(builtin.footer.links.some((l) => isNewsHref(l.href))).toBe(false)
    expect(builtin.footer.links.length).toBe(site.footer.links.length - 1)
    expect(builtin.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav)
    // 消息內容本身不動：再打開就照舊顯示
    expect(builtin.news.articles).toEqual(applyContentOverlay(site, { site_meta: meta }).news.articles)
  })

  it('關閉：後台選單只有最新消息時退回內建選單；30 週年也關著就一併拿掉', () => {
    const onlyNews = applyContentOverlay(site, {
      site_meta: { ...meta, news_enabled: false, primary_nav: [{ label: '最新消息', label_en: '', href: '/news' }] }
    })
    expect(onlyNews.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav)
    const bothOff = applyContentOverlay(site, {
      site_meta: { ...meta, news_enabled: false, anniversary_enabled: false, primary_nav: [{ label: '最新消息', label_en: '', href: '/news' }] }
    })
    expect(bothOff.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav.filter((l) => l.href !== '/anniversary'))
  })

  it('關閉：sitemap 不列 /news 與任何一則消息，llms.txt 不列最新消息', () => {
    const news = { sampleNote: '', articles: [{ ...site.news.articles[0]!, id: 'real-1' }] }
    expect(sitemapXml('https://ivy.example', news)).toContain('<loc>https://ivy.example/news/real-1</loc>')
    const xml = sitemapXml('https://ivy.example', news, { newsPages: false })
    expect(xml).not.toContain('/news')
    expect(xml).toContain('<loc>https://ivy.example/about</loc>')
    const off = applyContentOverlay(site, { site_meta: { ...meta, news_enabled: false } })
    const llms = llmsTxt('https://ivy.example', off)
    expect(llms).not.toContain('/news')
    expect(llms).not.toContain('## 最新消息')
    expect(llms).toContain('## 預約參觀')
    expect(read('server/routes/sitemap.xml.get.ts')).toContain('newsPages: newsEnabled(published.content.siteMeta)')
  })

  it('哪些連結算連到最新消息', () => {
    for (const href of ['/news', '/news/', '/news?campus=yihua', '/news#top', '/news/abc', '/news/abc?x=1', '/#latest-news', '#latest-news', ' /news '])
      expect(isNewsHref(href), href).toBe(true)
    for (const href of ['/', '/news-old', '/newsletter', '/about', '/#campuses', '/#life', '/visit', 'https://example.com/news'])
      expect(isNewsHref(href), href).toBe(false)
    // 章節錨點跟著內容的 sectionId
    expect(isNewsHref('/#updates', 'updates')).toBe(true)
    expect(isNewsHref('/#latest-news', 'updates')).toBe(false)
  })

  it('首頁：關閉時不放消息換頁層，五校區塊直接接頁尾、不再釘住', () => {
    const home = read('app/pages/index.vue')
    expect(home).toContain('const showNews = computed(() => newsEnabled(data.value?.content.siteMeta))')
    expect(home).toContain('<HomeNewsTransition v-if="showNews" :news="data.content.news" :campuses="data.content.campuses">')
    expect(home).toContain('<CampusBoard v-else :board="data.content.home.campusBoard" :campuses="data.content.campuses" />')
    expect(home).toContain("{ id: 'campuses', after: '.day-reveal-track', pinned: showNews.value }")
    expect(home).toContain('...(showNews.value ? [{ id: content.news.sectionId }] : [])')
    // 量測前先把五校區塊疊到簾幕後面的位置（沒有換頁層時），量完不位移
    const perf = read('app/assets/css/performance.css')
    expect(perf).toMatch(/\[data-ivy-motion\] \.day-reveal:not\(\[data-motion\]\) > \.campus-panorama \{\s+position: relative;\s+z-index: 1;\s+margin-top: calc\(-1 \* var\(--reveal-height, 100svh\)\);/)
  })

  it('列表頁與單篇頁：關閉時導回首頁（暫時性轉址），不回 404、也不渲染內容', () => {
    const list = read('app/pages/news/index.vue')
    expect(list).toMatch(/const hidden = !newsEnabled\(data\.value\?\.content\.siteMeta\)\nif \(hidden\) \{\n\s+await navigateTo\('\/', \{ redirectCode: 302, replace: true \}\)/)
    expect(list).toContain('<div v-if="data && !hidden">')
    const article = read('app/pages/news/[id].vue')
    expect(article).toMatch(/if \(hidden\) \{\n\s+await navigateTo\('\/', \{ redirectCode: 302, replace: true \}\)\n\} else if \(!article\.value\) \{\n\s+throw pageNotFound\('找不到這則消息'\)/)
  })
})
