// 2026-09-28 內容編輯頁 UX 修正（E 組）：校園探索畫布比例、欄位提示排版、用語、
// 清單排序與新增、常見問題、社群網址、官網沒顯示的欄位、自訂開關、縮圖與圖片說明。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref, withDirectives } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import { CONTENT_FIELD_LABELS, mediaFieldPathLabel } from '../api/labels'
import type { HomeFilmPayload, MediaAssetOut, UserOut } from '../api/types'
import { LENGTH_HINTS, momentTimeError, normalizeMomentTime } from '../composables/contentHints'
import { newHomeFilm } from '../composables/homeFilms'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import { EMPTY_VALUE_TEXT, vReadonlyValues } from '../composables/readonlyValues'
import { sitePageName } from '../composables/siteLinks'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import AdmissionContentView from '../views/AdmissionContentView.vue'
import BookingContentView from '../views/BookingContentView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import CampusTourView from '../views/CampusTourView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import HomeAboutView from '../views/HomeAboutView.vue'
import HomeCampusBoardView from '../views/HomeCampusBoardView.vue'
import HomeHeroView from '../views/HomeHeroView.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import SiteFooterView from '../views/SiteFooterView.vue'
import SiteMetaView from '../views/SiteMetaView.vue'
import HomeFilmsEditor from '../components/HomeFilmsEditor.vue'
import NewsBodyEditor from '../components/NewsBodyEditor.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const adminSources = import.meta.glob(['../views/*.vue', '../components/*.vue'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
// CSS 經過 vitest 的樣式處理後 ?raw 會是空字串，直接讀檔。
const readCss = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

function adminSource(name: string): string {
  if (name === 'style.css') return readCss('../style.css')
  const key = Object.keys(adminSources).find((k) => k.endsWith(`/${name}`))
  if (!key) throw new Error(`找不到 ${name}`)
  return adminSources[key]!
}

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
})
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountView(component: unknown, user: UserOut = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] }), path = '/') {
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

describe('校園探索畫布與官網同比例', () => {
  it('後台舞台是 8:5、照片整張拉滿，跟官網 .tour-canvas／.tour-image 一樣', () => {
    const web = readCss('../../../web/app/assets/css/styles.css')
    expect(web).toMatch(/\.tour-canvas\{[^}]*aspect-ratio:8\/5/)
    expect(web).toMatch(/\.tour-image\{[^}]*object-fit:fill/)
    const tour = adminSource('CampusTourView.vue')
    const stage = /\.tour__stage \{[^}]*\}/.exec(tour)![0]
    expect(stage).toContain('aspect-ratio: 8 / 5')
    const img = /\.tour__stage img \{[^}]*\}/.exec(tour)![0]
    expect(img).toContain('object-fit: fill')
    expect(tour).not.toContain('官網內建素材 <code')
  })
})

describe('欄位提示排版與手機輸入', () => {
  it('字數、缺字與說明各佔一行；觸控裝置的輸入框也是 16px', () => {
    const css = adminSource('style.css')
    expect(css).toMatch(/\.el-form-item__content > \.field-help,\s*\.el-form-item__content > \.glyph-hint \{\s*flex-basis: 100%;/)
    const coarse = /@media \(pointer: coarse\) \{[^@]*\}/.exec(css)![0]
    expect(coarse).toMatch(/\.el-input__inner, \.el-textarea__inner, \.el-select__wrapper \{ font-size: 16px; \}/)
  })

  it('電話與網址欄位叫出對應的手機鍵盤', () => {
    expect(adminSource('CampusProfileView.vue')).toMatch(/v-model="editor\.form\.value\.phone" inputmode="tel"/)
    expect(adminSource('CampusProfileView.vue')).toMatch(/v-model="editor\.form\.value\.map_url" inputmode="url"/)
    expect(adminSource('SiteMetaView.vue')).toMatch(/header_phone_number" inputmode="tel"/)
    expect(adminSource('NewsBodyEditor.vue')).toMatch(/v-model="block\.url" inputmode="url"/)
  })
})

describe('用語：圖片說明、影片封面，不出現工程語', () => {
  const OWNED = [
    'HomeHeroView.vue', 'HomeAboutView.vue', 'HomeCampusBoardView.vue', 'HomeNewsView.vue', 'DayExperienceView.vue',
    'CampusProfileView.vue', 'CampusNewsView.vue', 'AdmissionContentView.vue',
    'SiteFooterView.vue', 'SiteMetaView.vue', 'BookingContentView.vue', 'CampusTourView.vue', 'NewsEntriesEditor.vue',
    'NewsBodyEditor.vue', 'HomeFilmsEditor.vue', 'SiteLinksEditor.vue', 'FocusPicker.vue', 'MediaSlotField.vue',
  ]

  it('內容編輯頁的畫面文字沒有替代文字、Poster、robots.txt 與「留空＝」', () => {
    for (const name of OWNED) {
      const template = /<template>[\s\S]*<\/template>/.exec(adminSource(name))![0]
      for (const word of ['替代文字', 'robots.txt', 'sitemap.xml', '留空＝']) {
        expect(template, `${name} 還有「${word}」`).not.toContain(word)
      }
      expect(template, `${name} 還有「Poster」`).not.toMatch(/(?<![A-Za-z])Poster/)
      // 小寫 poster 只能出現在欄位名與檔名，不能夾在中文說明裡。
      expect(template, `${name} 的說明還有 poster`).not.toMatch(/[\u4e00-\u9fff（；]\s*poster|poster\s*[\u4e00-\u9fff]/i)
    }
  })

  it('發布確認框與素材引用的欄位名稱也改成影片封面、圖片說明', () => {
    for (const label of Object.values(CONTENT_FIELD_LABELS)) {
      expect(label).not.toMatch(/poster|替代文字/i)
    }
    expect(CONTENT_FIELD_LABELS.poster).toBe('影片封面')
    expect(CONTENT_FIELD_LABELS.poster_alt).toBe('影片封面的圖片說明')
    expect(CONTENT_FIELD_LABELS.caption).toBe('照片下方文字')
    expect(mediaFieldPathLabel('poster.media_id')).toBe('首屏影片封面')
    expect(mediaFieldPathLabel('film_poster.media_id')).toBe('孩子的一天影片封面')
  })

  it('首頁關於：圖片說明與照片下方文字是兩個分得開的欄位', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_about', {
      title: '標題', since_label: '', body_text: '', caption: '一句話', photo: { media_id: 'm1', focus_x: null, focus_y: null }, photo_alt: '',
    }) as never)
    const wrapper = await mountView(HomeAboutView)
    const labels = wrapper.findAll('.el-form-item__label').map((label) => label.text())
    expect(labels).toContain('圖片說明（給看不到照片的人）')
    expect(labels).toContain('照片下方文字')
    expect(labels).not.toContain('照片說明')
  })
})

// ------------------------------------------------------------------ 共用小工具
function mountPlain(render: () => ReturnType<typeof h>) {
  const wrapper = mount(defineComponent({ render }), { attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

function button(scope: { findAll: (selector: 'button') => DOMWrapper<HTMLButtonElement>[] }, text: string) {
  const found = scope.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`找不到「${text}」按鈕`)
  return found
}

// el-form-item 的錯誤訊息延遲約 100ms 才出現。
const formErrorsShown = () => new Promise((resolve) => setTimeout(resolve, 150))

// jsdom 沒有 scrollIntoView：換成記錄呼叫的假函式，測完拿掉。
function stubScrollIntoView() {
  const calls: Element[] = []
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(this: Element) {
      calls.push(this)
    },
  })
  return calls
}
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

function mediaAsset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: 'm1', campus_key: null, kind: 'image', status: 'ready', original_filename: 'garden.jpg',
    content_type: 'image/jpeg', size_bytes: 2048, width: 2000, height: 1500, duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z', created_by_email: null, archived_at: null, deleted_at: null,
    purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null,
    usage_count: 0, used_in: [], version: 1,
    variants: [{ id: 'v1', kind: 'thumbnail', content_type: 'image/webp', width: 480, height: 360 }],
    ...overrides,
  }
}

const MOMENT = { caption: '', story: '', question: '', answer: '' }

describe('孩子的一天：時刻卡排序、時間與新增', () => {
  function mockDay(extra: Record<string, unknown> = {}) {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('day_experience', {
      eyebrow: '', eyebrow_en: '', note: '', source_note: '',
      moments: [
        { ...MOMENT, key: 'hello', time: '08:05', label: '早安', title: '早安' },
        { ...MOMENT, key: 'lunch', time: '12:00', label: '午餐', title: '午餐' },
      ],
      ...extra,
    }) as never)
  }
  const times = (wrapper: VueWrapper) => wrapper.findAll('.repeat-item').map((item) => (item.get('input').element as HTMLInputElement).value)

  it('不在選單格上的舊時間（08:05）照原樣顯示；上移／下移後焦點跟著那一張', async () => {
    mockDay()
    const wrapper = await mountView(DayExperienceView)
    expect(times(wrapper)).toEqual(['08:05', '12:00'])
    await button(wrapper.findAll('.repeat-item')[0]!, '下移').trigger('click')
    await flushPromises()
    expect(times(wrapper)).toEqual(['12:00', '08:05'])
    expect(document.activeElement?.getAttribute('data-move-row')).toBe('1')
    expect(wrapper.findAll('.repeat-item')[1]!.findAll('button').find((b) => b.text() === '上移')!.attributes('aria-label')).toBe('上移「08:05・早安」')
  })

  it('時間要是 24 小時制的時:分，失焦時補零、全形轉半形', async () => {
    mockDay()
    const wrapper = await mountView(DayExperienceView)
    const input = () => wrapper.findAll('.repeat-item')[0]!.get('input')
    await input().setValue('早上')
    await formErrorsShown()
    expect(wrapper.findAll('.repeat-item')[0]!.text()).toContain('請用「時:分」')
    await input().setValue('８：３０')
    await input().trigger('blur')
    await formErrorsShown()
    expect((input().element as HTMLInputElement).value).toBe('08:30')
    expect(wrapper.findAll('.repeat-item')[0]!.text()).not.toContain('請用「時:分」')

    expect(normalizeMomentTime('8:05')).toBe('08:05')
    expect(normalizeMomentTime('0805')).toBe('08:05')
    expect(normalizeMomentTime('早上')).toBe('早上')
    expect(momentTimeError('')).toBe('')
    expect(momentTimeError('16:30')).toBe('')
    expect(momentTimeError('24:00')).not.toBe('')
  })

  it('新增的卡片捲到畫面裡並聚焦時間欄', async () => {
    const scrolled = stubScrollIntoView()
    mockDay()
    const wrapper = await mountView(DayExperienceView)
    await button(wrapper, '新增一張時刻卡').trigger('click')
    await flushPromises()
    const items = wrapper.findAll('.repeat-item')
    expect(items).toHaveLength(3)
    expect(scrolled).toContain(items[2]!.element)
    expect(document.activeElement).toBe(items[2]!.get('input').element)
  })

  it('關掉「自訂影片說明」再打開，還原剛才自訂的文字', async () => {
    mockDay({ film_caption_zh: '明華校 · 運動會', film_caption_en: 'SPORTS DAY' })
    const wrapper = await mountView(DayExperienceView)
    const toggle = () => wrapper.findAll('.el-switch').find((s) => s.text().includes('自訂（關閉時'))!
    const zh = () => wrapper.findAll('.el-form-item').find((item) => item.text().startsWith('中文說明'))
    expect((zh()!.get('input').element as HTMLInputElement).value).toBe('明華校 · 運動會')
    await toggle().trigger('click')
    expect(zh()).toBeUndefined()
    await toggle().trigger('click')
    expect((zh()!.get('input').element as HTMLInputElement).value).toBe('明華校 · 運動會')
  })

  // 2026-09-29 業主裁定：照片補充字官網刻意不顯示，後台不再列。影片來源標註查證後同樣從未在官網
  // 顯示（區塊來源說明是「說明文字」），比照不列。
  it('照片補充字、影片來源標註不列出來，也不給補充字字數建議', async () => {
    mockDay()
    const wrapper = await mountView(DayExperienceView)
    const labels = wrapper.findAll('.el-form-item__label').map((label) => label.text())
    expect(labels).not.toContain('影片來源標註')
    expect(labels).toContain('說明文字')
    expect(labels).not.toContain('照片補充字')
    expect(wrapper.find('.unused-note').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('官網目前沒有顯示這一欄')
    expect(LENGTH_HINTS).not.toHaveProperty('momentCaption')
    expect(LENGTH_HINTS).not.toHaveProperty('boardNote')
  })
})

describe('入學資訊：階段與補助可排序，新增鈕在清單下方', () => {
  it('階段、補助有上移／下移；新增後捲到新的一項', async () => {
    const scrolled = stubScrollIntoView()
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('admission_content', {
      notice: '', intro: '', steps: [{ when: '', title: '參觀', text: '' }],
      phases: [{ tag: '', title: '入園前', items: [], tips: [] }, { tag: '', title: '第一天', items: [], tips: [] }],
      uniform_week: [], uniform_note: '', pickup_notes: [], registration_notes: [], fee_intro: '',
      subsidies: [{ amount: '1', unit: '元', who: '大班', by: '' }, { amount: '2', unit: '元', who: '中班', by: '' }],
      allowance_title: '', allowance: [], allowance_note: '', refunds: [],
    }) as never)
    const wrapper = await mountView(AdmissionContentView)
    const titles = () => wrapper.findAll('.repeat-item__index').map((i) => i.text().replace(/^\d+/, ''))
    expect(titles()).toEqual(['參觀', '入園前', '第一天', '大班', '中班'])
    await wrapper.findAll('button').find((b) => b.attributes('aria-label') === '下移「入園前」')!.trigger('click')
    await wrapper.findAll('button').find((b) => b.attributes('aria-label') === '上移「中班」')!.trigger('click')
    await flushPromises()
    expect(titles()).toEqual(['參觀', '第一天', '入園前', '中班', '大班'])

    const add = button(wrapper, '新增一個步驟')
    const firstStep = wrapper.get('.repeat-item')
    expect(firstStep.element.compareDocumentPosition(add.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await add.trigger('click')
    await flushPromises()
    const newStep = wrapper.findAll('.repeat-item')[1]!
    expect(newStep.text()).toContain('未命名步驟')
    expect(scrolled).toContain(newStep.element)
    expect(document.activeElement).toBe(newStep.get('input').element)
  })
})

describe('五校介紹：社群網址', () => {
  it('邊打邊檢查網址；說明與官網一致，不再寫「待補」', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_profile', {
      name: '明華校', district: '左營區', address: '地址', phone: '07', intro: '', description: '', facebook: '', fb_note: '', line: '', map_url: '',
    }, 'yihua') as never)
    const wrapper = await mountView(CampusProfileView, testUser('campus_admin', { campus_keys: ['yihua'] }))
    await wrapper.get('input[placeholder="https://www.facebook.com/…"]').setValue('www.facebook.com/ivy')
    await wrapper.get('input[placeholder="https://www.instagram.com/…"]').setValue('@ivy.kids')
    await formErrorsShown()
    const item = (label: string) => wrapper.findAll('.el-form-item').find((i) => i.find('.el-form-item__label').text() === label)!
    expect(item('Facebook 粉絲專頁網址').text()).toContain('網址要以 https:// 或 http:// 開頭')
    expect(item('Instagram 網址').text()).toContain('網址要以 https:// 或 http:// 開頭')
    expect(item('LINE 官方帳號網址').text()).not.toContain('網址要以')
    expect(wrapper.text()).not.toContain('待補')
    expect(item('LINE 官方帳號網址').text()).toContain('待園方提供')
    // Facebook 備註官網不顯示，2026-09-29 起後台不列（值照原樣存回，見 ownerMisc20260929）。
    expect(wrapper.findAll('.el-form-item__label').map((label) => label.text())).not.toContain('Facebook 備註')
    expect(wrapper.get('input[placeholder="https://www.facebook.com/…"]').attributes('inputmode')).toBe('url')
  })
})

describe('官網沒顯示的欄位與預約橫幅', () => {
  // 2026-09-29 業主裁定：五校區塊的說明文字官網不顯示，後台不列（值照原樣存回，見 ownerMisc20260929）。
  it('首頁五校區塊不再列出官網不顯示的說明文字', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_campus_board', { section_title: '分校資訊', eyebrow: '', note: '很長的說明'.repeat(10) }) as never)
    const wrapper = await mountView(HomeCampusBoardView)
    expect(wrapper.findAll('.el-form-item__label').map((label) => label.text())).not.toContain('說明文字')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('官網目前沒有顯示這一欄')
  })

  it('預約文案頁不再有分校頁預約橫幅（官網已沒有分校頁）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('booking_content', {
      cta_label: '', cta_label_en: '', consent_text: '', banner_title_template: '親自走一趟，感受{campusNameOrIvy}的日常。', banner_body: '', banner_button_label: '',
      privacy_title: '', privacy_sections: [],
    }) as never)
    const wrapper = await mountView(BookingContentView)
    expect(wrapper.text()).not.toContain('預約橫幅')
    expect(wrapper.text()).not.toContain('分校頁')
    expect(wrapper.text()).not.toContain('{campusNameOrIvy}')
  })
})

describe('自訂開關與刪除場景', () => {
  it('關掉「自訂影片清單」再打開，還原剛才的影片', async () => {
    const films = ref<HomeFilmPayload[] | null>([{ ...newHomeFilm(), title: '一起跑' }, { ...newHomeFilm(), id: 'film-b', title: '運動會' }])
    const wrapper = mountPlain(() => h(HomeFilmsEditor, { films: films.value, 'onUpdate:films': (v: HomeFilmPayload[] | null) => (films.value = v) }))
    await wrapper.get('.el-switch').trigger('click')
    expect(films.value).toBeNull()
    await flushPromises()
    expect(wrapper.text()).toContain('剛才的 2 支影片還留著')
    await wrapper.get('.el-switch').trigger('click')
    expect(films.value?.map((f) => f.title)).toEqual(['一起跑', '運動會'])
  })

  // 刪除場景要先在 popconfirm 按「刪除」（2026-10-02：場景有照片和熱點，不再一按就刪）。
  // popconfirm 由計時器延後打開，負載高時一輪 flushPromises 還沒渲染出來（10-03 main CI 因此紅），要輪詢等它出現。
  async function confirmPop(text: string) {
    const confirm = await vi.waitFor(() => {
      const found = [...document.body.querySelectorAll<HTMLButtonElement>('.el-popconfirm button')].find((b) => b.textContent?.trim() === text)
      if (!found) throw new Error(`找不到確認鈕：${text}`)
      return found
    })
    confirm.click()
    await flushPromises()
  }

  it('刪除場景後選旁邊那一個，不跳回第一個', async () => {
    const scene = (key: string, name: string) => ({ key, name, image: '', intro: '', spots: [{ name: '點', x: 50, y: 50, text: '', question: '' }] })
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_tour', { scenes: [scene('a', '廣場'), scene('b', '教室'), scene('c', '菜園')] }, 'yihua') as never)
    const wrapper = await mountView(CampusTourView)
    await wrapper.findAll('.tour__scene-tab')[1]!.trigger('click')
    await button(wrapper, '刪除「教室」').trigger('click')
    // 還沒確認就不刪
    expect(wrapper.get('.tour__scene-tab.is-active').text()).toContain('教室')
    await confirmPop('刪除')
    const active = wrapper.get('.tour__scene-tab.is-active')
    expect(active.text()).toContain('菜園')
    expect(wrapper.get('.tour__side-title').text()).toContain('場景 2 / 2')
    await button(wrapper, '刪除「菜園」').trigger('click')
    await confirmPop('刪除')
    expect(wrapper.get('.tour__scene-tab.is-active').text()).toContain('廣場')
  })
})

describe('縮圖與圖片說明', () => {
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('消息封面載縮圖，讀不到退回原檔，原檔也讀不到時寫出來', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', {
      sample_note: '', events: [], home_display_count: null,
      articles: [{ id: 'a1', date: '2026-10-01', category: '', title: '菜園', description: '', image: ID, alt: '', scope: 'global', campus_keys: [], featured: false, body: [] }],
    }) as never)
    const wrapper = await mountView(HomeNewsView)
    const img = () => wrapper.find('.news-item__thumb img')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/variants/thumbnail`)
    expect(img().attributes('loading')).toBe('lazy')
    await img().trigger('error')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/file`)
    await img().trigger('error')
    expect(img().exists()).toBe(false)
    expect(wrapper.get('.news-item__thumb').text()).toContain('讀不到這張照片，請重新選擇')
  })

  it('換成另一張照片時換掉舊照片的說明；原本沒有照片時不蓋掉已打的字', () => {
    expect(altAfterPick('舊照片的說明', 'old', { id: 'new', alt_text: '新照片' })).toBe('新照片')
    expect(altAfterPick('舊照片的說明', 'old', { id: 'new', alt_text: null })).toBe('')
    expect(altAfterPick('先打好的說明', null, { id: 'new', alt_text: '素材說明' })).toBe('先打好的說明')
    expect(altAfterPick('', null, { id: 'new', alt_text: '素材說明' })).toBe('素材說明')
    expect(altAfterPick('自己改過', 'same', { id: 'same', alt_text: '素材說明' })).toBe('自己改過')
    // 選之前官網顯示內建照片：說明描述的是內建照片，換成新照片的說明。
    expect(altAfterPick('內建照片的說明', BUILTIN_PHOTO, { id: 'new', alt_text: '素材說明' })).toBe('素材說明')
    expect(altAfterPick('內建照片的說明', BUILTIN_PHOTO, { id: 'new', alt_text: null })).toBe('')
  })

  // 選圖器關掉後還留在畫面上（隱藏）；只點目前打開的那一個。
  function pickInOpenDialog(filename: string) {
    const items = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).filter(
      (b) => b.textContent?.includes(filename) && (b.closest<HTMLElement>('.el-overlay')?.style.display ?? '') !== 'none',
    )
    expect(items).toHaveLength(1)
    items[0]!.click()
  }

  function mockMedia(item: ReturnType<typeof contentItem>, library: MediaAssetOut[], known: MediaAssetOut[] = []) {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/content-items/')) return item as never
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      const one = known.find((a) => path === `/admin/media/${a.id}`)
      if (one) return one as never
      if (path.startsWith('/admin/media')) return library as never
      return [] as never
    })
  }

  const formItem = (wrapper: VueWrapper, label: string) =>
    wrapper.findAll('.el-form-item').find((item) => item.find('.el-form-item__label').exists() && item.get('.el-form-item__label').text() === label)

  it('首頁關於：改回官網內建再選別張，不會帶回原本那張照片的說明', async () => {
    mockMedia(
      contentItem('home_about', { title: '', since_label: '', body_text: '', caption: '', photo: { media_id: 'old', focus_x: null, focus_y: null }, photo_alt: 'A 照片的說明' }),
      [mediaAsset({ alt_text: '' })],
      [mediaAsset({ id: 'old', original_filename: 'old.jpg', alt_text: 'A 照片的說明' })],
    )
    const wrapper = await mountView(HomeAboutView)
    await button(formItem(wrapper, '照片')!, '改回官網內建').trigger('click')
    expect(formItem(wrapper, '圖片說明（給看不到照片的人）')).toBeUndefined()
    await button(formItem(wrapper, '照片')!, '從素材庫選照片').trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect((formItem(wrapper, '圖片說明（給看不到照片的人）')!.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('首頁關於：舊版本改回內建後留下的說明，選照片時換成新照片的說明', async () => {
    mockMedia(
      contentItem('home_about', { title: '', since_label: '', body_text: '', caption: '', photo: null, photo_alt: '舊版本留下的說明' }),
      [mediaAsset()],
    )
    const wrapper = await mountView(HomeAboutView)
    await button(formItem(wrapper, '照片')!, '從素材庫選照片').trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect((formItem(wrapper, '圖片說明（給看不到照片的人）')!.get('textarea').element as HTMLTextAreaElement).value).toBe('菜園')
  })

  it('孩子的一天：原有卡片的說明描述內建照片，選了照片就換掉；新卡片先打好的說明留著；改回內建清掉說明', async () => {
    const moment = (key: string, alt: string) => ({
      key, time: '08:00', label: key, caption: '', title: '', story: '', question: '', answer: '', photo: null, alt, tint: null,
    })
    mockMedia(
      contentItem('day_experience', { eyebrow: '', eyebrow_en: '', note: '', source_note: '', moments: [moment('hello', '內建照片的說明'), moment('moment-1', '先打好的說明')] }),
      [mediaAsset()],
    )
    const wrapper = await mountView(DayExperienceView)
    const cards = () => wrapper.findAll('.repeat-item')
    const altOf = (index: number) => (cards()[index]!.findAll('textarea').find((t) => t.element.closest('.el-form-item')?.textContent?.startsWith('圖片說明'))!.element as HTMLTextAreaElement).value

    await button(cards()[0]!, '從素材庫選照片').trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect(altOf(0)).toBe('菜園')

    await button(cards()[1]!, '從素材庫選照片').trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect(altOf(1)).toBe('先打好的說明')

    await button(cards()[0]!, '改回官網內建').trigger('click')
    expect(altOf(0)).toBe('')
  })

  it('分享圖：改回首頁大圖時清掉說明，再選別張用新照片的說明', async () => {
    mockMedia(
      contentItem('site_meta', { title: '', description: '', header_phone_number: '', header_phone_note: '', share_image: 'old', share_image_alt: 'A 照片的說明', admission_title: '', admission_description: '', allow_indexing: true, primary_nav: [] }),
      [mediaAsset({ alt_text: null })],
    )
    const wrapper = await mountView(SiteMetaView)
    await button(wrapper, '改回首頁大圖').trigger('click')
    await button(wrapper, '從素材庫選擇').trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect((formItem(wrapper, '分享圖說明')!.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('首屏影片封面換照片，圖片說明跟著換成新照片的說明', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/content-items/home_hero')) {
        return contentItem('home_hero', { eyebrow: '', copy_lines: ['', ''], poster: { media_id: 'old', focus_x: null, focus_y: null }, poster_alt: '舊照片的說明' }) as never
      }
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      if (path === '/admin/media/old') return mediaAsset({ id: 'old', original_filename: 'old.jpg', alt_text: '舊照片的說明' }) as never
      if (path.startsWith('/admin/media')) return [mediaAsset()] as never
      return [] as never
    })
    const wrapper = await mountView(HomeHeroView)
    const poster = wrapper.findAll('.el-form-item').find((item) => item.text().startsWith('影片封面（'))!
    await button(poster, '更換照片').trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('garden.jpg'))!.click()
    await flushPromises()
    const alt = wrapper.findAll('.el-form-item').find((item) => item.text().startsWith('影片封面的圖片說明'))!
    expect((alt.get('textarea').element as HTMLTextAreaElement).value).toBe('菜園')
  })
})

describe('消息內文的連結網址', () => {
  it('格式錯誤的訊息不夾在欄位名稱裡，用 aria-describedby 連回輸入框', () => {
    const wrapper = mountPlain(() => h(NewsBodyEditor, { blocks: [{ type: 'link', label: '相簿', url: 'ftp://x' }] }))
    const input = wrapper.get('input[inputmode="url"]')
    const label = input.element.closest('label')!
    expect(label.textContent).not.toContain('網址要以')
    const described = input.attributes('aria-describedby')!
    expect(document.getElementById(described)?.textContent).toBe('網址要以 https:// 或 http:// 開頭')
    expect(input.attributes('aria-invalid')).toBe('true')
  })
})

describe('主選單與頁尾連結', () => {
  it('連結格式說明只寫一次；每一筆寫出連到官網哪一頁', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('site_footer', { tagline: '', copyright: '', bottom_note: '', campus_list_label: '' }) as never)
    const wrapper = await mountView(SiteFooterView)
    expect(wrapper.text().split('站內頁面用 / 開頭的路徑').length - 1).toBe(1)
    expect(wrapper.text()).toContain('連到：首頁・孩子的一天')
    expect(wrapper.text()).toContain('連到：入學資訊頁')
    expect(sitePageName('/campuses/minghua')).toBeNull()
    expect(sitePageName('/visit/renwu')).toBe('預約參觀仁武校')
    expect(sitePageName('/somewhere')).toBeNull()
  })
})

describe('唯讀帳號看內容', () => {
  const profile = {
    name: '明華校', district: '左營區', address: '地址', phone: '07', intro: '', description: '',
    facebook: 'https://www.facebook.com/ivykid', fb_note: '', line: '', map_url: '', instagram: '', youtube: '',
  }

  it('值用正文色的樣式（表單加上唯讀樣式），空白欄位顯示（未填）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_profile', profile, 'yihua') as never)
    const wrapper = await mountView(CampusProfileView, testUser('readonly', { campus_keys: ['yihua'] }))
    await flushPromises()
    const form = wrapper.get('form')
    expect(form.classes()).toContain('form--readonly-values')
    const line = wrapper.findAll('.el-form-item').find((i) => i.find('.el-form-item__label').text() === 'LINE 官方帳號網址')!
    expect(line.get('input').attributes('placeholder')).toBe(EMPTY_VALUE_TEXT)
    const facebook = wrapper.findAll('.el-form-item').find((i) => i.find('.el-form-item__label').text() === 'Facebook 粉絲專頁網址')!
    expect((facebook.get('input').element as HTMLInputElement).value).toBe('https://www.facebook.com/ivykid')
  })

  it('可以編輯的帳號不套用；提示字本身有意思的欄位（留空用預設）保留原提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_profile', profile, 'yihua') as never)
    const editor = await mountView(CampusProfileView, testUser('editor', { campus_keys: ['yihua'] }))
    expect(editor.get('form').classes()).not.toContain('form--readonly-values')
    expect(editor.find('input[placeholder="https://lin.ee/…"]').exists()).toBe(true)

    vi.spyOn(api, 'get').mockResolvedValue(contentItem('site_meta', { title: '', description: '', header_phone_number: '', header_phone_note: '', share_image: '', share_image_alt: '', admission_title: '', admission_description: '', allow_indexing: true }) as never)
    const reader = await mountView(SiteMetaView, testUser('readonly', { campus_keys: ['yihua'] }))
    const admissionTitle = reader.findAll('.el-form-item').find((i) => i.find('.el-form-item__label').text() === '標題')!
    expect(admissionTitle.get('textarea').attributes('placeholder')).toContain('留空使用預設')
    const phone = reader.findAll('.el-form-item').find((i) => i.find('.el-form-item__label').text() === '頁首電話')!
    expect(phone.get('input').attributes('placeholder')).toBe(EMPTY_VALUE_TEXT)
  })

  it('切回可編輯時換回原本的提示字；一直可編輯時每次重畫不用掃欄位', async () => {
    const on = ref(true)
    const text = ref('')
    const wrapper = mountPlain(() => withDirectives(h('div', [h('input', { class: 'el-input__inner', placeholder: 'https://', value: text.value })]), [[vReadonlyValues, on.value]]))
    const input = () => wrapper.get('input').element as HTMLInputElement
    expect(input().placeholder).toBe(EMPTY_VALUE_TEXT)
    on.value = false
    await nextTick()
    expect(input().placeholder).toBe('https://')
    const scan = vi.spyOn(wrapper.element as HTMLElement, 'querySelectorAll')
    text.value = '打字'
    await nextTick()
    expect(scan).not.toHaveBeenCalled()
  })
})
