// 官網結構類內容的後台編輯（2026-09-25 缺口 B08）：主選單與頁尾連結、首頁五校
// 順序、分校地圖網址、標題缺字提示、校園探索排序與座標、孩子的一天、首屏按鈕。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import HomeHeroView from '../views/HomeHeroView.vue'
import HomeCampusBoardView from '../views/HomeCampusBoardView.vue'
import SiteMetaView from '../views/SiteMetaView.vue'
import SiteFooterView from '../views/SiteFooterView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import CampusTourView from '../views/CampusTourView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import GlyphHint from '../components/GlyphHint.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { contentFieldLabel } from '../api/labels'
import {
  DEFAULT_FOOTER_LINKS,
  DEFAULT_PRIMARY_NAV,
  labelEnError,
  mapUrlError,
  siteLinkError,
} from '../composables/siteLinks'
import { resetTitleFontCoverage, TITLE_FONT_FILES } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  // 字表讀不到就不提示；這裡的頁面測試不管缺字，一律回 404。
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
})
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
  document.body.innerHTML = ''
})

async function mountAs(component: unknown, user: UserOut, path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
  return {
    id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
  }
}

/** 按「儲存草稿」，回傳送出的 payload。 */
async function savedPayload(wrapper: VueWrapper, kind: string): Promise<Record<string, unknown>> {
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => {
    return contentItem(kind, (body as { payload: unknown }).payload) as never
  })
  await wrapper.findAll('button').find((button) => button.text() === '儲存草稿')!.trigger('click')
  await flushPromises()
  const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))
  expect(call).toBeDefined()
  return (call![1] as { payload: Record<string, unknown> }).payload
}

// el-form-item 的錯誤訊息延遲 100ms 才顯示（refDebounced）。
async function errorShown() {
  await new Promise((done) => setTimeout(done, 150))
  await flushPromises()
}

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').filter((b) => b.text() === text)

describe('主選單與頁尾連結', () => {
  it('後台帶入的內建連結和官網 fixture 一致', () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../web/server/data/site-fixture.json'), 'utf8'))
    expect(DEFAULT_PRIMARY_NAV).toEqual(fixture.siteMeta.primaryNav.map((n: { label: string; labelEn: string; href: string }) => ({ label: n.label, label_en: n.labelEn, href: n.href })))
    expect(DEFAULT_FOOTER_LINKS).toEqual(fixture.footer.links)
  })

  it('連結只收站內路徑或 https 外部網址（同後端）', () => {
    for (const ok of ['/', '/#about', '/admission', '/campuses/yihua#faq', 'https://www.ivykidschool.com/']) expect(siteLinkError(ok)).toBeNull()
    for (const bad of ['', 'http://example.com', '//example.com', 'javascript:alert(1)', '#/visit', 'https://user@example.com/', 'https://a b.com', '/\\evil.com', 'https://example.com:99999/', 'https://example.com:abc/']) {
      expect(siteLinkError(bad)).not.toBeNull()
    }
    expect(labelEnError('Admission')).toBeNull()
    expect(labelEnError('入學')).not.toBeNull()
    expect(contentFieldLabel('primary_nav')).toBe('主選單')
    expect(contentFieldLabel('links')).toBe('頁尾連結')
  })

  it('舊版全站設定沒有主選單：帶入內建選單、不算修改；調整順序後存檔送出整份選單', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('site_meta', {
      title: '常春藤', description: 'd', header_phone_number: '07', header_phone_note: 'n',
    }) as never)
    const wrapper = await mountAs(SiteMetaView, superAdmin(), '/content/site-meta')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('主選單')
    expect(wrapper.findAll('.site-links .repeat-item')).toHaveLength(DEFAULT_PRIMARY_NAV.length)

    const down = wrapper.findAll('.site-links button').filter((b) => b.text() === '下移')[0]!
    await down.trigger('click')
    await flushPromises()
    // 焦點跟著移動的那一項，連按可以一路往下。
    expect(document.activeElement?.getAttribute('data-move-row')).toBe('1')
    expect(wrapper.text()).toContain('有未儲存的修改')

    const payload = await savedPayload(wrapper, 'site_meta')
    const nav = payload.primary_nav as { label: string }[]
    expect(nav.map((n) => n.label).slice(0, 2)).toEqual([DEFAULT_PRIMARY_NAV[1]!.label, DEFAULT_PRIMARY_NAV[0]!.label])
  })

  it('頁尾連結可以新增外部連結，錯誤的網址在欄位下方提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('site_footer', {
      tagline: 't', copyright: 'c', bottom_note: '', campus_list_label: 'l', links: null,
    }) as never)
    const wrapper = await mountAs(SiteFooterView, superAdmin(), '/content/site-footer')
    expect(wrapper.findAll('.site-links .repeat-item')).toHaveLength(DEFAULT_FOOTER_LINKS.length)
    await wrapper.findAll('button').find((b) => b.text().startsWith('新增頁尾連結'))!.trigger('click')
    const items = wrapper.findAll('.site-links .repeat-item')
    const last = items[items.length - 1]!
    const inputs = last.findAll('input')
    await inputs[0]!.setValue('機構官網')
    await inputs[1]!.setValue('http://example.com')
    await errorShown()
    expect(last.text()).toContain('https:// 開頭的外部網址')
    await inputs[1]!.setValue('https://www.ivykidschool.com/')
    await errorShown()
    expect(last.text()).not.toContain('https:// 開頭的外部網址')
    expect(last.text()).toContain('外部連結 ↗')
  })
})

describe('首頁五校順序與預設校區', () => {
  it('舊版本沒有順序：帶入內建順序；上移下移與預設校區會存進去', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_campus_board', { section_title: '分校資訊', eyebrow: 'Campuses', note: '' }) as never)
    const wrapper = await mountAs(HomeCampusBoardView, superAdmin(), '/content/home-campus-board')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    const names = () => wrapper.findAll('.board-order__name').map((n) => n.text())
    expect(names()).toEqual(['1義華校', '2明華校', '3崇德校', '4國際校', '5仁武校'])

    await wrapper.findAll('.board-order button').filter((b) => b.text() === '上移')[4]!.trigger('click')
    await flushPromises()
    expect(names()).toEqual(['1義華校', '2明華校', '3崇德校', '4仁武校', '5國際校'])
    expect(document.activeElement?.getAttribute('data-move-row')).toBe('3')

    await wrapper.findAll('input[type="radio"]').find((input) => (input.element as HTMLInputElement).value === 'renwu')!.setValue(true)
    const payload = await savedPayload(wrapper, 'home_campus_board')
    expect(payload.campus_order).toEqual(['yihua', 'minghua', 'chongde', 'renwu', 'international'])
    expect(payload.default_campus).toBe('renwu')
  })
})

describe('首屏按鈕文字已拿掉', () => {
  it('沒有按鈕文字欄位；舊版本的 cta_label 不算修改、也不再送出', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_hero', { eyebrow: '小標', copy_lines: ['一', '二'], cta_label: '看看孩子的一天' }) as never)
    const wrapper = await mountAs(HomeHeroView, superAdmin(), '/content/home-hero')
    expect(wrapper.text()).not.toContain('按鈕文字')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    await wrapper.findAll('input')[0]!.setValue('新小標')
    const payload = await savedPayload(wrapper, 'home_hero')
    // 素材版位沒選：送 null（＝官網沿用內建影片與照片）。
    expect(payload).toEqual({
      eyebrow: '新小標', copy_lines: ['一', '二'],
      video_desktop: null, video_mobile: null, poster: null, poster_alt: '', fallback_image: null,
    })
  })
})

describe('分校地圖網址', () => {
  it('只接受 Google 地圖網址，空白用地址搜尋', () => {
    expect(mapUrlError('')).toBeNull()
    for (const ok of ['https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123', 'https://www.google.com/maps/place/x', 'https://www.google.com.tw/maps/search/?api=1&query=x']) {
      expect(mapUrlError(ok)).toBeNull()
    }
    for (const bad of ['http://maps.app.goo.gl/AbC123', 'https://evil.example/maps/', 'https://maps.google.com.evil.example/', 'https://www.google.com/search?q=1', '<iframe src="https://www.google.com/maps/embed"></iframe>']) {
      expect(mapUrlError(bad)).not.toBeNull()
    }
  })

  it('分校介紹有地圖連結欄位，錯的網址即時提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_profile', {
      name: '義華校', district: '三民區', address: '高雄市三民區義華路68號', phone: '07', intro: '', description: '', facebook: '', fb_note: '', line: '',
    }, 'yihua') as never)
    const wrapper = await mountAs(CampusProfileView, superAdmin(), '/content/campus-profile')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    const field = wrapper.findAll('.el-form-item').find((item) => item.text().includes('地圖連結'))!
    expect(field.find('a').attributes('href')).toContain('https://www.google.com/maps/search/')
    await field.get('input').setValue('https://evil.example/maps/')
    await errorShown()
    expect(field.text()).toContain('只接受 Google 地圖')
    await field.get('input').setValue('https://maps.app.goo.gl/AbC123')
    await errorShown()
    expect(field.text()).not.toContain('只接受 Google 地圖')
    expect(field.find('a').attributes('href')).toBe('https://maps.app.goo.gl/AbC123')
  })
})

describe('標題缺字提示', () => {
  function mockCharsets(tables: Partial<Record<keyof typeof TITLE_FONT_FILES, string>>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      const entry = Object.entries(TITLE_FONT_FILES).find(([, file]) => url.endsWith(`/assets/fonts/${file}`))
      const text = entry ? tables[entry[0] as keyof typeof TITLE_FONT_FILES] : undefined
      return (text === undefined ? new Response('', { status: 404 }) : new Response(text)) as never
    })
  }

  it('依欄位用的字型逐一檢查（校名：明體與標題字型）', async () => {
    mockCharsets({ bd: '仁武校來認識', serif: '仁武校義華' })
    const wrapper = mount(GlyphHint, { props: { value: '仁武新校', fonts: ['serif', 'bd'] } })
    wrappers.push(wrapper)
    await flushPromises()
    const hints = wrapper.findAll('.glyph-hint').map((hint) => hint.text())
    expect(hints).toHaveLength(2)
    expect(hints[0]).toContain('校名明體字型沒有「新」')
    expect(hints[1]).toContain('官網標題字型沒有「新」')
    await wrapper.setProps({ value: '仁武校' })
    expect(wrapper.findAll('.glyph-hint')).toHaveLength(0)
  })

  it('ExtraBold 子集也讀得到；字表讀不到時不提示', async () => {
    mockCharsets({ eb: '常春藤' })
    const eb = mount(GlyphHint, { props: { value: '常春藤園', fonts: ['eb'] } })
    const missing = mount(GlyphHint, { props: { value: '常春藤園', fonts: ['bd'] } })
    wrappers.push(eb, missing)
    await flushPromises()
    expect(eb.text()).toContain('首頁大標字型沒有「園」')
    expect(missing.text()).toBe('')
  })

  it('讀官網實際字表：LINE Seed 兩個字重是完整字型，只提示字型裡沒有的字；明體仍是子集', async () => {
    const fontsDir = resolve(__dirname, '../../../web/public/assets/fonts')
    mockCharsets(Object.fromEntries(Object.entries(TITLE_FONT_FILES).map(([font, file]) => [font, readFileSync(resolve(fontsDir, file), 'utf8')])))
    // 「訊」「菜」是舊子集沒有的字；𠮷 是 Ext-B 字，完整字型也沒有
    const wrapper = mount(GlyphHint, { props: { value: '菜訊𠮷', fonts: ['serif', 'bd', 'eb'] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.findAll('.glyph-hint').map((hint) => hint.text().split('，')[0])).toEqual([
      '校名明體字型沒有「菜𠮷」',
      '官網標題字型沒有「𠮷」',
      '首頁大標字型沒有「𠮷」',
    ])
  })

  it('首屏小標在官網用系統字，不提示缺字（避免誤報）', async () => {
    mockCharsets({ bd: '高雄', eb: '高雄', serif: '高雄' })
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_hero', { eyebrow: '高雄五校・1997 創校', copy_lines: ['一', '二'] }) as never)
    const wrapper = await mountAs(HomeHeroView, superAdmin(), '/content/home-hero')
    await wrapper.findAll('input')[0]!.setValue('鳳山新校區')
    await flushPromises()
    expect(wrapper.find('.glyph-hint').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('會以系統字顯示')
  })
})

describe('孩子的一天', () => {
  it('說明新卡會顯示（沒有照片的空白相紙），不再說多出來的卡片不顯示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('day_experience', {
      eyebrow: '', eyebrow_en: '', note: '', source_note: '',
      moments: [{ key: 'hello', time: '08:00', label: '早安', caption: '', title: '早安', story: '', question: '', answer: '' }],
    }) as never)
    const wrapper = await mountAs(DayExperienceView, superAdmin(), '/content/day-experience')
    expect(wrapper.text()).toContain('新增的卡片沒選照片時以空白相紙顯示')
    expect(wrapper.text()).not.toContain('多出來的卡片官網不會顯示')
  })
})

describe('校園探索排序與座標', () => {
  const scene = (key: string, name: string, spots: { name: string; x: number; y: number }[]) => ({
    key, name, image: 'campus', intro: '', spots_reviewed: true,
    spots: spots.map((spot) => ({ ...spot, text: '', question: '' })),
  })

  it('場景與熱點可以上移下移，熱點座標可以直接輸入 0–100', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_tour', {
      scenes: [
        scene('gate', '大門', [{ name: '警衛室', x: 10, y: 10 }, { name: '花圃', x: 20, y: 20 }]),
        scene('hall', '大廳', [{ name: '櫃台', x: 50, y: 50 }]),
      ],
    }, 'yihua') as never)
    const wrapper = await mountAs(CampusTourView, superAdmin(), '/content/campus-tour')
    const sceneNames = () => wrapper.findAll('.tour__scene-name').map((n) => n.text())
    expect(sceneNames()).toEqual(['大門', '大廳'])

    // 場景：選中的「大門」往後移，選取跟著走。
    await button(wrapper, '下移')[0]!.trigger('click')
    expect(sceneNames()).toEqual(['大廳', '大門'])
    expect(wrapper.get('.tour__scene-tab.is-active').text()).toContain('大門')

    // 熱點：點第 2 個圖釘（花圃），上移成第 1 個。
    await wrapper.findAll('.tour__pin')[1]!.trigger('click')
    expect(wrapper.text()).toContain('熱點 2 / 2')
    const spotUp = wrapper.findAll('.tour__side-title--spot button').find((b) => b.text() === '上移')!
    await spotUp.trigger('click')
    expect(wrapper.text()).toContain('熱點 1 / 2')
    expect(wrapper.findAll('.tour__pin')[0]!.attributes('aria-label')).toContain('花圃')

    // 座標數字輸入，超過範圍夾回 0–100。
    const coords = wrapper.findAll('.tour__coords input')
    await coords[0]!.setValue('37.26')
    await coords[0]!.trigger('change')
    await coords[1]!.setValue('140')
    await coords[1]!.trigger('change')
    await flushPromises()
    const pin = wrapper.findAll('.tour__pin')[0]!
    expect(pin.attributes('style')).toContain('left: 37.3%')
    expect(pin.attributes('style')).toContain('top: 100%')

    const payload = await savedPayload(wrapper, 'campus_tour')
    const scenes = payload.scenes as { key: string; spots: { name: string; x: number; y: number }[] }[]
    expect(scenes.map((s) => s.key)).toEqual(['hall', 'gate'])
    expect(scenes[1]!.spots.map((s) => [s.name, s.x, s.y])).toEqual([['花圃', 37.3, 100], ['警衛室', 10, 10]])
  })
})
