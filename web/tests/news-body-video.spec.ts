// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onMounted, ref, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, NewsBlock, SiteContent } from '../app/types/site-content'
import NewsArticleContent from '../app/components/NewsArticleContent.vue'
import NewsBody from '../app/components/NewsBody.vue'
import NewsBodyVideo from '../app/components/NewsBodyVideo.vue'
import { applyContentOverlay, type LiveHomeNews } from '../app/utils/content-overlay'
import type { MediaInfoMap } from '../app/utils/media-image'
import { newsDescription } from '../app/utils/seo'

// 消息內文的影片區塊（2026-11-10）：粉專影片貼文轉成消息時帶進素材庫的影片，官網在內文裡點了才播。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；元件只用伺服器渲染（同官網 SSR）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('onMounted', onMounted)

const site = fixture as unknown as SiteContent
const VIDEO = '7c1d9f3a-2b6e-4c58-8a17-5e0f4d2b9c33'
const BASE = `/api/website/v1/public/media/${VIDEO}`

function videoInfo(variants: MediaInfoMap[string]['variants']): MediaInfoMap {
  return {
    [VIDEO]: {
      id: VIDEO, kind: 'video', content_type: 'video/mp4', width: 720, height: 1280,
      alt_text: null, focus_x: null, focus_y: null, variants
    }
  }
}

const reel = videoInfo([
  { kind: 'poster', width: 405, height: 720, version: 'p1' },
  { kind: 'video_desktop', width: 720, height: 1280, version: 'd1' },
  { kind: 'video_mobile', width: 720, height: 1280, version: 'm1' }
])

function overlaidBody(media: MediaInfoMap): NewsBlock[] {
  const homeNews: LiveHomeNews = {
    sample_note: '',
    articles: [{
      id: 'fb-1', date: '2026-10-30', scope: 'global', campus_keys: [], category: '', title: '運動會', description: '', image: 'garden', alt: '',
      body: [{ type: 'video', video: VIDEO, caption: '大隊接力' }, { type: 'paragraph', text: '孩子們跑得好快。' }]
    }],
    events: []
  }
  return applyContentOverlay(site, { home_news: homeNews }, media).news.articles.find((a) => a.id === 'fb-1')!.body!
}

async function renderApp(root: Component, props: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(root, props) })
  app.component('NewsBody', NewsBody as Component)
  app.component('NewsBodyVideo', NewsBodyVideo as Component)
  app.component('ResponsivePicture', defineComponent({ render: () => h('img') }))
  app.component('NuxtLink', defineComponent({ setup: (_, { slots }) => () => h('a', slots.default?.()) }))
  return (await renderToString(app)).replace(/&amp;/g, '&')
}

const render = (blocks: NewsBlock[]) => renderApp(NewsBody as Component, { summary: '', blocks })

/** 單篇消息頁（/news/<id>）整頁的 HTML。 */
function renderPage(body: NewsBlock[]): Promise<string> {
  const article: NewsArticle = { id: 'yihua:fb-1', date: '2026-10-30', campus: '義華校', campusKeys: ['yihua'], category: '', title: '運動會', description: '', image: 'garden', alt: '', body }
  return renderApp(NewsArticleContent as Component, { article, news: { ...site.news, articles: [article] }, campuses: site.campuses })
}

describe('消息內文的影片區塊', () => {
  it('疊後台內容時補上桌機／手機版本、封面與尺寸', () => {
    expect(overlaidBody(reel)[0]).toEqual({
      type: 'video', video: VIDEO, caption: '大隊接力',
      videoSrc: `${BASE}/variants/video_desktop?v=d1`,
      videoSrcMobile: `${BASE}/variants/video_mobile?v=m1`,
      poster: `${BASE}/variants/poster?v=p1`,
      width: 720, height: 1280
    })
  })

  it('沒有轉檔版本（原檔就能播）時只給原檔，不重複給手機版', () => {
    const block = overlaidBody(videoInfo([{ kind: 'poster', width: 405, height: 720, version: 'p1' }]))[0]
    expect(block).toMatchObject({ videoSrc: `${BASE}/file` })
    expect(block).not.toHaveProperty('videoSrcMobile')
  })

  it('素材不在素材資訊裡（草稿預覽裡還在轉檔、已刪除）：不給網址，官網不畫這一塊', async () => {
    const body = overlaidBody({})
    expect(body[0]).toEqual({ type: 'video', video: VIDEO, caption: '大隊接力' })
    const html = await render(body)
    expect(html).not.toContain('<video')
    expect(html).toContain('孩子們跑得好快。')
  })

  it('官網用封面先佔位、點了才載入影片，圖說放在影片下面', async () => {
    const html = await render(overlaidBody(reel))
    const video = html.match(/<video[^>]*>/)?.[0] ?? ''
    expect(video).toContain(`src="${BASE}/variants/video_desktop?v=d1"`)
    expect(video).toContain(`poster="${BASE}/variants/poster?v=p1"`)
    expect(video).toContain('width="720"')
    expect(video).toContain('height="1280"')
    // 寬高比先講好（720÷1280）：封面比影片小，沒有這個的話按下播放時影片框會跳一次大小。
    expect(video).toContain('--hn-video-ratio:0.5625')
    for (const attribute of ['controls', 'playsinline', 'preload="none"', 'aria-label="大隊接力"']) expect(video).toContain(attribute)
    // 自動播放、靜音循環是背景影片的做法；消息影片要人自己按。
    for (const attribute of ['autoplay', 'muted', 'loop']) expect(video).not.toContain(attribute)
    expect(html).toMatch(/<figcaption[^>]*>大隊接力<\/figcaption>/)
  })

  it('沒填摘要時的頁面描述只取文字，不把影片區塊算進去', () => {
    expect(newsDescription({ description: '', body: overlaidBody(reel) })).toBe('孩子們跑得好快。')
  })

  it('影片在內文第一塊：消息頁把影片放在封面的位置，不再放一張幾乎一樣的封面照', async () => {
    const html = await renderPage(overlaidBody(reel))
    expect(html.match(/<video/g)).toHaveLength(1)
    expect(html).toMatch(/<figure class="hn-video np-cover-video"/)
    expect(html).not.toContain('class="np-cover"')
    // 直式影片跟直式封面一樣走右欄版面；內文從第二塊開始，影片不重複出現在內文裡。
    expect(html).toMatch(/<article class="[^"]*\bis-tall\b/)
    const main = html.slice(html.indexOf('np-article-main'))
    expect(main).toContain('孩子們跑得好快。')
    expect(main).not.toContain('<video')
  })

  it('影片不在第一塊，或素材還沒好：封面照舊，影片留在內文原本的位置', async () => {
    const [video, paragraph] = overlaidBody(reel)
    const later = await renderPage([paragraph!, video!])
    expect(later).toContain('class="np-cover"')
    expect(later).not.toContain('np-cover-video')
    expect(later.slice(later.indexOf('np-article-main'))).toContain('<video')

    const pending = await renderPage(overlaidBody({}))
    expect(pending).toContain('class="np-cover"')
    expect(pending).not.toContain('<video')
  })

  it('只有一支影片、沒有其他內文：影片放封面位置，下面照舊顯示摘要', async () => {
    const html = await renderPage([overlaidBody(reel)[0]!])
    expect(html).toMatch(/<figure class="hn-video np-cover-video"/)
    expect(html).toContain('np-article-copy')
  })
})
