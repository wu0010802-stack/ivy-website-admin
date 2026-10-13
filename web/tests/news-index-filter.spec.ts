// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { NewsEvent, SiteContent } from '../app/types/site-content'
import NewsIndexContent from '../app/components/NewsIndexContent.vue'

// 2026-10-13：最新消息列表的校區篩選原本寫死 `{ query: { campus } }`，在後台預覽（/preview?page=news&date=…）
// 裡一點就丟掉 page、date、viewport、embed，跳回首頁預覽、日期回到今天；近期活動也不看預覽的日期。
// Nuxt 的自動匯入（computed、useRoute、NuxtLink）在單元測試裡沒有，這裡補上（同 about-voices-preview.spec.ts）。
const routeQuery: Record<string, string> = {}
vi.stubGlobal('computed', computed)
vi.stubGlobal('useRoute', () => ({ query: routeQuery }))

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => {
    const to = props.to as string | { query?: Record<string, string> }
    const href = typeof to === 'string' ? to : `?${new URLSearchParams(to.query ?? {}).toString()}`
    return h('a', { href }, slots.default?.())
  }
})

let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  for (const key of Object.keys(routeQuery)) delete routeQuery[key]
})

function mountNews(props: { today?: string } = {}, events: NewsEvent[] = site.news.events) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(NewsIndexContent as Component, { news: { ...site.news, events }, campuses: site.campuses, ...props }) })
  app.component('NuxtLink', NuxtLink)
  app.config.warnHandler = () => {}
  app.mount(host)
}

const filterHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>('.np-filter a')].map((a) => a.getAttribute('href'))

describe('最新消息列表的校區篩選', () => {
  it('在預覽裡：只換 campus，page、date、viewport、embed 照留', () => {
    Object.assign(routeQuery, { page: 'news', date: '2026-11-01', viewport: 'mobile', embed: '1', campus: 'yihua' })
    mountNews()
    const [all, first] = filterHrefs()
    expect(all).toBe('?page=news&date=2026-11-01&viewport=mobile&embed=1')
    expect(first).toBe(`?page=news&date=2026-11-01&viewport=mobile&embed=1&campus=${site.campuses[0]!.key}`)
  })

  it('正式頁 /news：和原本一樣只有 campus', () => {
    mountNews()
    const [all, first] = filterHrefs()
    expect(all).toBe('?')
    expect(first).toBe(`?campus=${site.campuses[0]!.key}`)
  })
})

describe('近期活動的日期', () => {
  const event = (date: string, title: string): NewsEvent => ({ ...site.news.events[0]!, id: title, date, title, sample: false })

  it('有傳 today（預覽的日期）就用它判斷近期活動，不是今天', () => {
    mountNews({ today: '2099-01-02' }, [event('2099-01-01', '前一天的活動'), event('2099-01-02', '當天的活動')])
    const text = document.body.textContent ?? ''
    expect(text).toContain('當天的活動')
    expect(text).not.toContain('前一天的活動')
  })
})
