// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { Campus, CampusTestimonial, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveCampusProfile, type LiveTestimonial } from '../app/utils/content-overlay'
import { youtubeThumb } from '../app/utils/filmCarousel'
import type { MediaInfoMap } from '../app/utils/media-image'
import { pickVoices } from '../app/utils/testimonials'
import AboutContent from '../app/components/AboutContent.vue'

// 家長怎麼說（關於頁第四章）：選片是純函式，後台自訂的影片經 overlay 疊上來；最後用伺服器渲染
// 看第四章真的畫出誰、什麼順序（Nuxt 的自動匯入在單元測試裡沒有，這裡補上，同 about-render.spec.ts）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const site = fixture as unknown as SiteContent
const yihua = site.campuses.find((c) => c.key === 'yihua')!
const POSTER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const media: MediaInfoMap = {
  [POSTER]: {
    id: POSTER, kind: 'image', content_type: 'image/jpeg', width: 2400, height: 1350, alt_text: '素材庫說明',
    focus_x: null, focus_y: null,
    variants: [{ kind: 'thumbnail', width: 480, height: 270 }, { kind: 'large', width: 1600, height: 900 }]
  }
}

const voice = (campus: string, n: number): CampusTestimonial => ({
  youtubeId: `${campus}vid${String(n).padStart(4, '0')}`.slice(0, 11).padEnd(11, 'x'),
  quote: `${campus}${n}`,
  speaker: `${campus}家長${n}`,
  poster: `/assets/${campus}-${n}.webp`
})
const campusWith = (key: string, count: number): Campus => ({
  ...yihua, key, name: `${key}校`, testimonials: Array.from({ length: count }, (_, i) => voice(key, i + 1))
})
const picked = (campuses: Campus[], limit?: number) => pickVoices(campuses, limit).map((v) => v.quote)

describe('pickVoices：五校輪流取，最多四支', () => {
  it('義華 3、明華 2、崇德 1 → 義1、明1、崇1、義2', () => {
    expect(picked([campusWith('yihua', 3), campusWith('minghua', 2), campusWith('chongde', 1)])).toEqual(['yihua1', 'minghua1', 'chongde1', 'yihua2'])
  })

  it('輪到的那一校沒有了就跳過，不留空位', () => {
    expect(picked([campusWith('yihua', 1), campusWith('minghua', 3)])).toEqual(['yihua1', 'minghua1', 'minghua2', 'minghua3'])
    expect(picked([campusWith('yihua', 0), campusWith('minghua', 2)])).toEqual(['minghua1', 'minghua2'])
  })

  it('順序照傳入的校區順序，每支都帶著自己的校區', () => {
    const campuses = [campusWith('minghua', 2), campusWith('yihua', 2)]
    const out = pickVoices(campuses)
    expect(out.map((v) => v.campus.key)).toEqual(['minghua', 'yihua', 'minghua', 'yihua'])
    expect(out[1]).toMatchObject({ quote: 'yihua1', speaker: 'yihua家長1', campus: campuses[1] })
  })

  it('一校不會占滿：五校各 4 支只取前四校的第 1 支', () => {
    const campuses = ['yihua', 'minghua', 'chongde', 'international', 'renwu'].map((key) => campusWith(key, 4))
    expect(picked(campuses)).toEqual(['yihua1', 'minghua1', 'chongde1', 'international1'])
  })

  it('limit 可調；沒有任何影片（含 undefined、[]）回空陣列', () => {
    expect(picked([campusWith('yihua', 4)], 2)).toEqual(['yihua1', 'yihua2'])
    expect(pickVoices([{ ...yihua, testimonials: undefined }, campusWith('minghua', 0)])).toEqual([])
    expect(pickVoices([])).toEqual([])
  })

  it('只有義華有影片時，結果與內建前 4 支相同（順序與內容）', () => {
    const builtin = yihua.testimonials!
    expect(site.campuses.filter((c) => c.testimonials?.length).map((c) => c.key)).toEqual(['yihua'])
    const out = pickVoices(site.campuses)
    expect(out.map(({ campus, ...item }) => ({ ...item }))).toEqual(builtin.slice(0, 4))
    expect(out.every((v) => v.campus.key === 'yihua')).toBe(true)
  })
})

describe('後台自訂家長影片疊到官網內容', () => {
  const live = (testimonials: LiveCampusProfile['testimonials'], key = 'yihua'): { campus_profile: Record<string, LiveCampusProfile> } => {
    const c = site.campuses.find((x) => x.key === key)!
    return { campus_profile: { [key]: { name: c.name, district: c.district, address: c.address, phone: c.phone, facebook: c.facebook, line: c.line ?? '', testimonials } } }
  }
  const item = (over: Partial<LiveTestimonial> = {}): LiveTestimonial => ({
    youtube_url: 'https://youtu.be/AAAAAAAAAAA', quote: '自訂的一句話', speaker: '自訂媽咪', poster: null, poster_alt: '', ...over
  })
  const yihuaOf = (out: SiteContent) => out.campuses.find((c) => c.key === 'yihua')!

  it('[]：該校清空，不再出現在第四章', () => {
    const out = applyContentOverlay(site, live([]))
    expect(yihuaOf(out).testimonials).toEqual([])
    expect(pickVoices(out.campuses)).toEqual([])
  })

  it('null、沒有這個欄位（舊版本）：保留內建', () => {
    expect(yihuaOf(applyContentOverlay(site, live(null))).testimonials).toEqual(yihua.testimonials)
    expect(yihuaOf(applyContentOverlay(site, live(undefined))).testimonials).toEqual(yihua.testimonials)
    expect(yihuaOf(applyContentOverlay(site, {})).testimonials).toEqual(yihua.testimonials)
  })

  it('陣列整組取代，youtube_url 轉成影片 id，順序照後台', () => {
    const out = applyContentOverlay(site, live([
      item({ youtube_url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', quote: '第一', speaker: '甲' }),
      item({ youtube_url: 'CCCCCCCCCCC', quote: '第二', speaker: '乙' })
    ]))
    expect(yihuaOf(out).testimonials!.map((t) => [t.youtubeId, t.quote, t.speaker])).toEqual([
      ['BBBBBBBBBBB', '第一', '甲'], ['CCCCCCCCCCC', '第二', '乙']
    ])
  })

  it('沒有封面：同一支影片用內建封面（id 不分大小寫），別支用 YouTube 縮圖', () => {
    const builtin = yihua.testimonials![0]!
    const out = applyContentOverlay(site, live([
      item({ youtube_url: `https://youtu.be/${builtin.youtubeId}` }),
      item({ youtube_url: `https://youtu.be/${builtin.youtubeId.toLowerCase()}` }),
      item({ youtube_url: 'https://youtu.be/ZZZZZZZZZZZ' })
    ]))
    const posters = yihuaOf(out).testimonials!.map((t) => t.poster)
    expect(posters).toEqual([builtin.poster, builtin.poster, youtubeThumb('ZZZZZZZZZZZ')])
    expect(yihuaOf(out).testimonials!.every((t) => t.posterMedia === undefined)).toBe(true)
  })

  it('別校沿用義華內建影片的 id，也用內建封面', () => {
    const builtin = yihua.testimonials![1]!
    const out = applyContentOverlay(site, live([item({ youtube_url: builtin.youtubeId })], 'minghua'))
    expect(out.campuses.find((c) => c.key === 'minghua')!.testimonials![0]!.poster).toBe(builtin.poster)
  })

  it('自訂封面素材：用素材網址與 srcset，說明用後台填的，沒填用素材庫的', () => {
    const out = applyContentOverlay(site, live([
      item({ poster: { media_id: POSTER, focus_x: 30, focus_y: 70 }, poster_alt: '媽媽在鏡頭前說話' }),
      item({ youtube_url: 'https://youtu.be/BBBBBBBBBBB', poster: { media_id: POSTER } })
    ]), media)
    const [first, second] = yihuaOf(out).testimonials!
    expect(first!.poster).toBe(`/api/website/v1/public/media/${POSTER}/file`)
    expect(first!.posterMedia).toMatchObject({ position: '30% 70%' })
    expect(first!.posterMedia!.candidates.length).toBeGreaterThan(1)
    expect(first!.posterAlt).toBe('媽媽在鏡頭前說話')
    expect(second!.posterAlt).toBe('素材庫說明')
  })

  it('看不懂的影片網址（壞資料）整支丟掉，其餘照常', () => {
    const out = applyContentOverlay(site, live([
      item({ youtube_url: 'https://example.com/not-youtube', quote: '壞的' }),
      item({ youtube_url: '', quote: '空的' }),
      item({ quote: '好的' })
    ]))
    expect(yihuaOf(out).testimonials!.map((t) => t.quote)).toEqual(['好的'])
  })

  it('只換有發布的那一校，其他校與其他欄位不動', () => {
    const out = applyContentOverlay(site, live([item()], 'minghua'))
    expect(yihuaOf(out).testimonials).toEqual(yihua.testimonials)
    expect(out.campuses.find((c) => c.key === 'minghua')!.testimonials!.map((t) => t.quote)).toEqual(['自訂的一句話'])
    expect(out.campuses.find((c) => c.key === 'minghua')!.name).toBe(site.campuses.find((c) => c.key === 'minghua')!.name)
  })

  it('不修改傳入的內容', () => {
    const before = JSON.stringify(site.campuses)
    applyContentOverlay(site, live([item()]), media)
    expect(JSON.stringify(site.campuses)).toBe(before)
  })
})

describe('第四章渲染', () => {
  const NuxtLink = defineComponent({
    props: { to: { type: String, required: true } },
    setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
  })
  async function render(campuses: Campus[]): Promise<string> {
    const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses, page: site.aboutPage }) })
    app.component('NuxtLink', NuxtLink)
    app.component('AboutWholePerson', defineComponent({ render: () => null }))
    return renderToString(app)
  }
  // 第四章的 HTML：拿掉 scoped style 的 data-v 標記與 SSR 註解，方便比對文字
  const voices = (html: string) => html.slice(html.indexOf('id="voices"')).replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--.*?-->/g, '')

  it('內建內容：四支都是義華家長，標出校名', async () => {
    const html = voices(await render(site.campuses))
    for (const item of yihua.testimonials!) expect(html).toContain(`<q>${item.quote}</q><small>${item.speaker}</small>`)
    expect(html).toContain('樂樂媽咪 · 義華校家長')
  })

  it('五校輪流取：清單順序是 義1、明1、義2、義3，第 4 支被擠出，並標出各自校名', async () => {
    const minghua = site.campuses.find((c) => c.key === 'minghua')!
    const campuses = site.campuses.map((c) => c.key === 'minghua'
      ? { ...minghua, testimonials: [{ ...voice('minghua', 1) }] }
      : c)
    const html = voices(await render(campuses))
    const list = html.slice(html.indexOf('<ol class="abh-picks">'), html.indexOf('</ol>'))
    const [first, second, third] = yihua.testimonials!
    expect([...list.matchAll(/<q>(.*?)<\/q><small>(.*?)<\/small>/g)].map((m) => [m[1], m[2]])).toEqual([
      [first!.quote, `${first!.speaker} · ${yihua.name}`],
      ['minghua1', `minghua家長1 · ${minghua.name}`],
      [second!.quote, `${second!.speaker} · ${yihua.name}`],
      [third!.quote, `${third!.speaker} · ${yihua.name}`]
    ])
    expect(html).not.toContain(yihua.testimonials![3]!.quote)
    expect(html).toContain(`${yihua.name}、${minghua.name}家長在學校 YouTube 頻道上的分享`)
  })

  it('全部清空：整章不出現', async () => {
    const campuses = site.campuses.map((c) => ({ ...c, testimonials: [] }))
    const html = await render(campuses)
    expect(html).not.toContain('id="voices"')
  })

  it('自訂封面用素材的 srcset 與焦點，說明帶到圖片', async () => {
    const out = applyContentOverlay(site, {
      campus_profile: {
        yihua: {
          name: yihua.name, district: yihua.district, address: yihua.address, phone: yihua.phone, facebook: yihua.facebook, line: '',
          testimonials: [{ youtube_url: 'https://youtu.be/AAAAAAAAAAA', quote: '自訂的一句話', speaker: '自訂媽咪', poster: { media_id: POSTER, focus_x: 30, focus_y: 70 }, poster_alt: '媽媽在說話' }]
        }
      }
    }, media)
    const html = voices(await render(out.campuses))
    expect(html).toContain(`/api/website/v1/public/media/${POSTER}/variants/thumbnail`)
    expect(html).toContain('object-position:30% 70%')
    expect(html).toContain('alt="媽媽在說話"')
    expect(html).toContain('<q>自訂的一句話</q>')
  })
})
