// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, NewsBlock, NewsEvent, SiteContent } from '../app/types/site-content'
import NewsBody from '../app/components/NewsBody.vue'
import NewsIndexContent from '../app/components/NewsIndexContent.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'
import { isTallImage, relatedArticles, summaryRepeatsBody, tidyNewsText, titleClauses } from '../app/utils/news-content'

// 2026-11-10 最新消息頁 UI/UX：粉專轉來的消息（沒有分類、摘要＝內文開頭、直式封面、標題用「｜」）在列表與單篇頁的呈現，
// 以及列表版面（最新一則放大＋照片格、校區篩選只列有內容的校區、看更早的消息、結尾各校粉專）。
const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const article = (over: Partial<NewsArticle>): NewsArticle => ({
  id: 'a', date: '2026-09-01', campus: '義華校', campusKeys: ['yihua'], category: '', title: '標題', description: '摘要', image: 'garden', alt: '', sample: false, ...over
})
const para = (text: string): NewsBlock => ({ type: 'paragraph', text })

describe('標題在「｜」「：」後換行', () => {
  it('粉專慣用的「活動名｜副題」切成兩段，不再從詞中間斷', () => {
    expect(titleClauses('萬聖節變裝派對｜小小變裝家出動啦！')).toEqual(['萬聖節變裝派對｜', '小小變裝家出動啦！'])
    expect(titleClauses('美語 Sensory 課：用手認識顏色')).toEqual(['美語 Sensory 課：', '用手認識顏色'])
  })
  it('半形的 | 與 : 不切（兩邊的空白在 inline-block 邊緣會被吃掉）', () => {
    expect(titleClauses('Blue Day | 藍色主題日')).toEqual(['Blue Day | 藍色主題日'])
    expect(titleClauses('09:30 開始報到')).toEqual(['09:30 開始報到'])
  })
})

describe('全形標點旁的空白', () => {
  it('段內換行轉成的空白拿掉：全形標點後面、收尾標點前面', () => {
    expect(tidyNewsText('今天好不一樣唷！ 一早走進校園， 大家穿上特色服裝， 一起來參加。 透過活動')).toBe('今天好不一樣唷！一早走進校園，大家穿上特色服裝，一起來參加。透過活動')
    expect(tidyNewsText('不只是「 變裝 」， 更是節慶')).toBe('不只是「變裝」，更是節慶')
  })
  it('英文字之間、emoji 後面、半形標點後面的空白照留', () => {
    expect(tidyNewsText('「Trick or Treat～」🍬😆 今天學校')).toBe('「Trick or Treat～」🍬😆 今天學校')
    expect(tidyNewsText('Blue Day, 藍色主題日')).toBe('Blue Day, 藍色主題日')
  })
})

describe('摘要是不是內文開頭的重複', () => {
  const body = [para('今天學校的氛圍變得好不一樣唷！ 一早走進校園，'), para('孩子們穿著自己喜歡的服裝， 在校園裡開心玩著。'), { type: 'link', label: '在 Facebook 看原文', url: 'https://www.facebook.com/x' } as NewsBlock]
  it('粉專轉來的摘要（內文前段加「…」）算重複，不看空白', () => {
    expect(summaryRepeatsBody('今天學校的氛圍變得好不一樣唷！ 一早走進校園， 孩子們穿著自己喜…', body)).toBe(true)
    expect(summaryRepeatsBody('今天學校的氛圍變得好不一樣唷！一早走進校園，', body)).toBe(true)
  })
  it('園方自己寫的摘要、空摘要、沒有段落的內文都不算', () => {
    expect(summaryRepeatsBody('五校同步受理新生登記，歡迎先預約參觀。', body)).toBe(false)
    expect(summaryRepeatsBody('', body)).toBe(false)
    expect(summaryRepeatsBody('摘要', [{ type: 'heading', text: '摘要' }])).toBe(false)
  })
})

describe('單篇頁結尾的其他消息', () => {
  const list = [
    article({ id: 'now', date: '2026-10-30' }),
    article({ id: 'renwu-new', date: '2026-10-27', campus: '仁武校', campusKeys: ['renwu'] }),
    article({ id: 'yihua-old', date: '2026-10-01' }),
    article({ id: 'global', date: '2026-09-20', campus: '全校', campusKeys: [] }),
    article({ id: 'both', date: '2026-09-10', campus: '義華校、明華校', campusKeys: ['yihua', 'minghua'] }),
  ]
  it('不含自己；同一校與全校的排前面（新到舊），不夠才補其他校區', () => {
    expect(relatedArticles(list, list[0]!).map((a) => a.id)).toEqual(['yihua-old', 'global', 'both'])
    expect(relatedArticles(list, list[0]!, 4).map((a) => a.id)).toEqual(['yihua-old', 'global', 'both', 'renwu-new'])
  })
  it('全校消息沒有「自己的校區」，照日期新到舊', () => {
    expect(relatedArticles(list, list[3]!).map((a) => a.id)).toEqual(['now', 'renwu-new', 'yihua-old'])
  })
  it('只有一則時沒有其他消息', () => {
    expect(relatedArticles([list[0]!], list[0]!)).toEqual([])
  })
})

describe('直式照片', () => {
  it('寬／高小於 .85 才算直式；沒有尺寸不算', () => {
    expect(isTallImage({ width: 720, height: 1280 })).toBe(true)
    expect(isTallImage({ width: 1200, height: 1600 })).toBe(true)
    expect(isTallImage({ width: 1600, height: 1600 })).toBe(false)
    expect(isTallImage({ width: 1600, height: 1200 })).toBe(false)
    expect(isTallImage({})).toBe(false)
  })
})

// Nuxt 的自動匯入（computed、useRoute、NuxtLink）在單元測試裡沒有，這裡補上（同 news-index-filter.spec.ts）。
const routeQuery: Record<string, string> = {}
vi.stubGlobal('computed', computed)
vi.stubGlobal('useRoute', () => ({ query: routeQuery }))
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => {
    const to = props.to as string | { query?: Record<string, string> }
    const href = typeof to === 'string' ? to : `?${new URLSearchParams(to.query ?? {}).toString()}`
    return h('a', { href }, slots.default?.())
  }
})
const NewsFollowCampuses = defineComponent({
  props: { campuses: { type: Array, required: true } },
  setup: (props) => () => h('div', { class: 'nf', 'data-count': props.campuses.length })
})

let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  for (const key of Object.keys(routeQuery)) delete routeQuery[key]
})

function mount(component: Component, props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(component, props) })
  app.component('NuxtLink', NuxtLink)
  app.component('ResponsivePicture', ResponsivePicture)
  app.component('NewsFollowCampuses', NewsFollowCampuses)
  app.config.warnHandler = () => {}
  app.mount(host)
}
const mountIndex = (articles: NewsArticle[], events: NewsEvent[] = []) =>
  mount(NewsIndexContent as Component, { news: { ...site.news, sampleNote: '', articles, events }, campuses: site.campuses, today: '2026-11-10' })
const texts = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent?.trim())
const many = (count: number) => Array.from({ length: count }, (_, i) => article({ id: `n${i}`, date: `2026-10-${String(28 - i).padStart(2, '0')}`, title: `第 ${i} 則` }))

describe('列表頁：校區篩選只列有自己消息或近期活動的校區', () => {
  it('只有一校有消息時不出篩選（等於沒得選）', () => {
    mountIndex([article({})])
    expect(document.querySelector('.np-filter')).toBeNull()
  })
  it('兩校以上才出，沒有內容的校區不列；全校消息不算某一校自己的', () => {
    mountIndex([article({}), article({ id: 'r', campus: '仁武校', campusKeys: ['renwu'] }), article({ id: 'g', campus: '全校', campusKeys: [] })])
    expect(texts('.np-filter a')).toEqual(['全部', '義華校', '仁武校'])
  })
  it('只有近期活動的校區也列', () => {
    const event: NewsEvent = { id: 'e', date: '2026-11-22', month: 'NOV', campus: '明華校', campusKeys: ['minghua'], title: '運動會', description: '', sample: false }
    mountIndex([article({}), article({ id: 'r', campus: '仁武校', campusKeys: ['renwu'] })], [event])
    expect(texts('.np-filter a')).toEqual(['全部', '義華校', '明華校', '仁武校'])
  })
  it('網址指定的校區沒有內容時照樣出篩選（含那一校），才回得去全部', () => {
    routeQuery.campus = 'minghua'
    mountIndex([article({})])
    expect(texts('.np-filter a')).toEqual(['全部', '義華校', '明華校'])
    expect(document.querySelector('.np-filter [aria-current="page"]')?.textContent).toBe('明華校')
  })
})

describe('列表頁：版面', () => {
  it('最新一則放大、其餘進照片格；沒有分類不留空元素，有分類才寫', () => {
    mountIndex([article({ id: 'new', date: '2026-10-30', title: '最新的' }), article({ id: 'old', date: '2026-10-01', title: '較舊的', category: '公告' })])
    expect(texts('.np-lead h3')).toEqual(['最新的'])
    expect(texts('.np-card h3')).toEqual(['較舊的'])
    expect(document.querySelector('.np-lead .np-meta')?.children).toHaveLength(2)
    expect(texts('.np-card .np-meta > *')).toEqual(['義華校', '2026.10.01', '公告'])
    expect(document.querySelector('.np-category')).toBeNull()
  })
  it('「所有消息」緊接大標時只留給讀屏；有近期活動或只看一校時才顯示', () => {
    mountIndex([article({})])
    expect(document.querySelector('#np-articles-title')?.className).toContain('sr-only')
    app?.unmount()
    document.body.innerHTML = ''
    routeQuery.campus = 'yihua'
    mountIndex([article({})])
    expect(document.querySelector('#np-articles-title')?.className ?? '').not.toContain('sr-only')
    expect(document.querySelector('#np-articles-title')?.textContent).toBe('義華校的消息')
  })
  it('直式封面的最新一則換直式照片框', () => {
    const media = { src: '/x', width: 720, height: 1280, candidates: [], position: null, alt: '' }
    mountIndex([article({ image: 'dc525e10-0b06-488f-8a7b-b5b5f21c289e', imageMedia: media })])
    expect(document.querySelector('.np-lead')?.className).toContain('is-tall')
  })
  it('先列 1＋12 則，「看更早的消息」每次多 12 則，換校區時歸零', () => {
    mountIndex(many(30))
    expect(document.querySelectorAll('.np-card')).toHaveLength(12)
    expect(document.querySelector('.np-more a')?.getAttribute('href')).toBe('?show=2')
    app?.unmount()
    document.body.innerHTML = ''
    Object.assign(routeQuery, { show: '2', campus: 'yihua' })
    mountIndex(many(30))
    expect(document.querySelectorAll('.np-card')).toHaveLength(24)
    expect(document.querySelector('.np-more a')?.getAttribute('href')).toBe('?show=3&campus=yihua')
    expect(document.querySelector('.np-filter')).not.toBeNull()
    expect(document.querySelector('.np-filter a')?.getAttribute('href')).toBe('?')
    app?.unmount()
    document.body.innerHTML = ''
    routeQuery.show = '3'
    mountIndex(many(30))
    expect(document.querySelectorAll('.np-card')).toHaveLength(29)
    expect(document.querySelector('.np-more')).toBeNull()
  })
  it('結尾接各校粉專；只看一校而沒有消息時粉專在上面、下面補其他校區最近三則', () => {
    mountIndex(many(5))
    expect(document.querySelector('.np-follow')?.getAttribute('data-count')).toBe(String(site.campuses.length))
    expect(document.querySelector('.np-others')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    routeQuery.campus = 'minghua'
    mountIndex(many(5))
    expect(document.querySelector('.np-empty')?.getAttribute('data-count')).toBe('1')
    expect(document.querySelector('.np-follow')).toBeNull()
    expect(texts('.np-others .np-card h3')).toEqual(['第 0 則', '第 1 則', '第 2 則'])
  })
  it('活動的 meta 寫星期幾，不重複日期牌的日期', () => {
    const event: NewsEvent = { id: 'e', date: '2026-11-22', month: 'NOV', campus: '義華校', campusKeys: ['yihua'], title: '運動會', description: '', allDay: false, startTime: '09:00', endTime: '11:30', location: '操場', sample: false }
    mountIndex([article({})], [event])
    expect(texts('.np-event .np-meta > span:last-child')).toEqual(['星期日 · 09:00–11:30 · 操場'])
  })
})

describe('單篇頁', () => {
  const page = read('../app/components/NewsArticleContent.vue')
  const css = read('../app/assets/css/news-page.css')
  it('摘要是內文開頭的重複時不放導言；園方自己寫的摘要照舊', () => {
    mount(NewsBody as Component, { summary: '今天好不一樣唷！ 一早走進…', blocks: [para('今天好不一樣唷！ 一早走進校園， 大家都來了。')] })
    expect(document.querySelector('.hn-body-lead')).toBeNull()
    expect(texts('.hn-body p')).toEqual(['今天好不一樣唷！一早走進校園，大家都來了。'])
    app?.unmount()
    document.body.innerHTML = ''
    mount(NewsBody as Component, { summary: '五校同步受理。', blocks: [para('登記方式如下。')] })
    expect(texts('.hn-body-lead')).toEqual(['五校同步受理。'])
  })
  it('沒有分類時不留「校名 ·」的尾巴', () => {
    expect(page).toContain('{{ article.campus }}<template v-if="article.category"> · {{ article.category }}</template>')
  })
  it('封面不再一律壓到 480px；直式封面 720px 以上放內文右邊', () => {
    expect(css).not.toContain('max-height:480px')
    expect(css).toMatch(/@media \(width>=720px\)\{\n\s*\.np-article\.is-tall\{display:grid;[^}]*grid-template-areas:"head cover" "main cover"/)
    expect(page).toContain(`:class="{ 'is-tall': tall }"`)
  })
})
