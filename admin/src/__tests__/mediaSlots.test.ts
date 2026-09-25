// 素材縮圖路由、版位焦點與素材版位（2026-09-25 缺口 B10）：素材庫與選圖器改用
// 縮圖／poster、焦點點選（含鍵盤）、各內容頁的影片與照片版位、活動影片清單。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import HomeHeroView from '../views/HomeHeroView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import FocusPicker from '../components/FocusPicker.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'
import HomeFilmsEditor from '../components/HomeFilmsEditor.vue'
import { api, mediaPreviewUrl, mediaVariantUrl } from '../api/client'
import { auditActionLabel, contentFieldLabel, mediaFieldPathLabel } from '../api/labels'
import type { FocusPointPayload, HomeFilmPayload, MediaAssetOut, MediaSlotPayload, UserOut } from '../api/types'
import { filmClipError, filmYoutubeError, newHomeFilm, youtubeIdOf } from '../composables/homeFilms'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { resetUploadLimits } from '../composables/mediaUpload'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
  resetUploadLimits()
})
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function asset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: 'm1', campus_key: null, kind: 'image', status: 'ready', original_filename: 'garden.jpg',
    content_type: 'image/jpeg', size_bytes: 2048, width: 2000, height: 1500, duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z', created_by_email: null, archived_at: null, deleted_at: null,
    purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null,
    usage_count: 0, used_in: [],
    variants: [
      { id: 'v1', kind: 'thumbnail', content_type: 'image/webp', width: 480, height: 360 },
      { id: 'v2', kind: 'large', content_type: 'image/webp', width: 1600, height: 1200 },
    ],
    ...overrides,
  }
}

const VIDEO = asset({
  id: 'vid', kind: 'video', content_type: 'video/mp4', original_filename: 'hero.mp4', duration_seconds: 12,
  variants: [{ id: 'p1', kind: 'poster', content_type: 'image/webp', width: 480, height: 270 }],
})

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] }) as UserOut

async function mountView(component: unknown, path = '/') {
  const pinia = createPinia()
  useAuthStore(pinia).user = superAdmin()
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

function mountPlain(render: () => ReturnType<typeof h>) {
  const wrapper = mount(defineComponent({ render }), { attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
  return {
    id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
  }
}

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

describe('縮圖與 poster', () => {
  it('圖片用縮圖、影片用自動擷取的畫面，沒有衍生檔時退回原檔或佔位', () => {
    expect(mediaPreviewUrl(asset())).toBe('/api/website/v1/admin/media/m1/variants/thumbnail')
    expect(mediaPreviewUrl(asset({ variants: [] }))).toBe('/api/website/v1/admin/media/m1/file')
    expect(mediaPreviewUrl(VIDEO)).toBe('/api/website/v1/admin/media/vid/variants/poster')
    expect(mediaPreviewUrl({ ...VIDEO, variants: [] })).toBe('')
    expect(mediaVariantUrl('m1', 'large')).toBe('/api/website/v1/admin/media/m1/variants/large')
  })

  it('素材庫卡片不載原檔：圖片用縮圖、影片顯示 poster 與長度', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      if (path.startsWith('/admin/media')) return [asset(), VIDEO] as never
      return [] as never
    })
    const wrapper = await mountView(MediaLibraryView, '/media')
    const srcs = wrapper.findAll('.media__thumb img').map((img) => img.attributes('src'))
    expect(srcs).toEqual([
      '/api/website/v1/admin/media/m1/variants/thumbnail',
      '/api/website/v1/admin/media/vid/variants/poster',
    ])
    expect(srcs.some((src) => src?.endsWith('/file'))).toBe(false)
    expect(wrapper.find('.media__duration').text()).toBe('影片・0:12')
  })

  it('素材預設焦點用 0–100 點選、存 0–1，說明文字跟官網實際行為一致', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      if (path.startsWith('/admin/media')) return [asset({ crop_focus_x: 0.25, crop_focus_y: 0.4 })] as never
      return [] as never
    })
    const wrapper = await mountView(MediaLibraryView, '/media')
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('沒有另外設定焦點的版位以這一點為中心')
    expect(document.body.textContent).not.toContain('會盡量保留這一點')
    const stage = document.body.querySelector<HTMLElement>('.focus-picker__stage')!
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    await flushPromises()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(asset() as never)
    const save = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === '儲存')!
    save.click()
    await flushPromises()
    const body = patch.mock.calls[0]![1] as Record<string, unknown>
    expect(body.crop_focus_x).toBeCloseTo(0.35)
    expect(body.crop_focus_y).toBeCloseTo(0.4)
  })

  it('選圖器可以只列影片，並用 poster 當預覽', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      return [asset(), VIDEO] as never
    })
    const open = ref(false)
    mountPlain(() => h(MediaPickerDialog, { modelValue: open.value, kind: 'video', 'onUpdate:modelValue': (v: boolean) => (open.value = v) }))
    open.value = true
    await flushPromises()
    const items = Array.from(document.body.querySelectorAll('.picker__item'))
    expect(items).toHaveLength(1)
    expect(items[0]!.querySelector('img')!.getAttribute('src')).toBe('/api/website/v1/admin/media/vid/variants/poster')
    expect(document.body.textContent).toContain('選擇影片')
    expect(document.body.querySelector('input[type=file]')!.getAttribute('accept')).toBe('video/mp4')
  })
})

describe('FocusPicker', () => {
  function mountPicker(initial: FocusPointPayload | null, fallback: FocusPointPayload | null = null) {
    const value = ref<FocusPointPayload | null>(initial)
    const wrapper = mountPlain(() => h(FocusPicker, { src: '/x.webp', modelValue: value.value, fallback, 'onUpdate:modelValue': (v: FocusPointPayload | null) => (value.value = v) }))
    return { wrapper, value }
  }

  it('點照片設定焦點（0–100）', async () => {
    const { wrapper, value } = mountPicker(null)
    const stage = wrapper.get('.focus-picker__stage')
    vi.spyOn(stage.element, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 200, height: 100 } as DOMRect)
    await stage.trigger('click', { clientX: 150, clientY: 125 })
    expect(value.value).toEqual({ x: 25, y: 75 })
  })

  it('方向鍵移動（Shift 一次 10），不超出 0–100；可以清除', async () => {
    const { wrapper, value } = mountPicker({ x: 95, y: 3 })
    const stage = wrapper.get('.focus-picker__stage')
    await stage.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await stage.trigger('keydown', { key: 'ArrowUp', shiftKey: true })
    expect(value.value).toEqual({ x: 100, y: 0 })
    await wrapper.findAll('button').find((b) => b.text() === '改用素材預設焦點')!.trigger('click')
    expect(value.value).toBeNull()
  })

  it('沒設焦點時顯示預設焦點的位置', () => {
    const { wrapper } = mountPicker(null, { x: 30, y: 60 })
    expect(wrapper.get('.focus-picker__pin').attributes('style')).toContain('left: 30%')
    expect(wrapper.text()).toContain('素材預設的焦點')
  })
})

describe('MediaSlotField', () => {
  it('沒選時說明沿用內建；選了之後顯示縮圖、焦點，換素材會清掉舊焦點', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/m1') return asset({ crop_focus_x: 0.3, crop_focus_y: 0.6 }) as never
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      return [asset(), asset({ id: 'm2', original_filename: 'other.jpg' })] as never
    })
    const slot = ref<MediaSlotPayload | null>(null)
    const picked: MediaAssetOut[] = []
    const wrapper = mountPlain(() => h(MediaSlotField, {
      modelValue: slot.value, builtin: '官網內建的照片',
      'onUpdate:modelValue': (v: MediaSlotPayload | null) => (slot.value = v),
      onPicked: (a: MediaAssetOut) => picked.push(a),
    }))
    expect(wrapper.text()).toContain('目前用官網內建的照片')

    slot.value = { media_id: 'm1', focus_x: 10, focus_y: 20 }
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media/m1')
    expect(wrapper.find('.slot__thumb img').attributes('src')).toBe('/api/website/v1/admin/media/m1/variants/thumbnail')
    expect(wrapper.text()).toContain('garden.jpg')
    expect(wrapper.get('.focus-picker__pin').attributes('style')).toContain('left: 10%')

    // 清除版位焦點：回到素材預設焦點。
    await wrapper.findAll('button').find((b) => b.text() === '改用素材預設焦點')!.trigger('click')
    expect(slot.value).toEqual({ media_id: 'm1', focus_x: null, focus_y: null })
    await flushPromises()
    expect(wrapper.get('.focus-picker__pin').attributes('style')).toContain('left: 30%')

    await wrapper.findAll('button').find((b) => b.text() === '更換照片')!.trigger('click')
    await flushPromises()
    const other = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('other.jpg'))!
    other.click()
    await flushPromises()
    expect(slot.value).toEqual({ media_id: 'm2', focus_x: null, focus_y: null })
    expect(picked.map((a) => a.id)).toEqual(['m2'])

    await wrapper.findAll('button').find((b) => b.text() === '改回官網內建')!.trigger('click')
    expect(slot.value).toBeNull()
  })

  it('影片版位不顯示焦點，顯示長度', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(VIDEO as never)
    const wrapper = mountPlain(() => h(MediaSlotField, { modelValue: { media_id: 'vid', focus_x: null, focus_y: null }, kind: 'video', builtin: '內建影片' }))
    await flushPromises()
    expect(wrapper.find('.focus-picker').exists()).toBe(false)
    expect(wrapper.text()).toContain('0:12')
    expect(wrapper.find('.slot__thumb img').attributes('src')).toBe('/api/website/v1/admin/media/vid/variants/poster')
  })

  it('讀不到素材時請使用者重選', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('404'))
    const wrapper = mountPlain(() => h(MediaSlotField, { modelValue: { media_id: 'gone', focus_x: null, focus_y: null }, builtin: 'x' }))
    await flushPromises()
    expect(wrapper.text()).toContain('讀不到這個素材')
  })
})

describe('內容頁的素材版位', () => {
  it('首屏：舊版本沒有影片與照片欄位不算修改；選 poster 會帶入素材說明當替代文字', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/content-items/home_hero')) return contentItem('home_hero', { eyebrow: '小標', copy_lines: ['一'] }) as never
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      if (path === '/admin/media/m1') return asset() as never
      if (path.startsWith('/admin/media')) return [asset(), VIDEO] as never
      return [] as never
    })
    const wrapper = await mountView(HomeHeroView, '/content/home-hero')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('目前用官網內建的首屏照片')
    const poster = wrapper.findAll('.el-form-item').find((item) => item.text().startsWith('Poster（'))!
    await poster.findAll('button').find((b) => b.text() === '從素材庫選照片')!.trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('garden.jpg'))!.click()
    await flushPromises()
    const payload = await savedPayload(wrapper, 'home_hero')
    expect(payload.poster).toEqual({ media_id: 'm1', focus_x: null, focus_y: null })
    expect(payload.poster_alt).toBe('菜園')
    expect(payload.video_desktop).toBeNull()
  })

  it('孩子的一天：舊卡片補上照片、替代文字與色調欄位（不算修改）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('day_experience', {
      eyebrow: '孩子的一天', eyebrow_en: 'A DAY', note: '', source_note: '',
      moments: [{ key: 'hello', time: '08:00', label: '早安', caption: '', title: '早安', story: '', question: '', answer: '' }],
    }) as never)
    const wrapper = await mountView(DayExperienceView, '/content/day-experience')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('目前用原本的照片')
    const alt = wrapper.findAll('.el-form-item').find((item) => item.text().startsWith('照片替代文字'))!
    await alt.get('input').setValue('孩子打招呼')
    const payload = await savedPayload(wrapper, 'day_experience')
    expect((payload.moments as Record<string, unknown>[])[0]).toMatchObject({ photo: null, alt: '孩子打招呼', tint: null })
    expect(payload.film_caption_zh).toBeNull()
  })

  it('分校：沒換封面也能調兩個版位的焦點，送出 0–100 的座標', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_profile', {
      name: '義華校', district: '三民區', address: '地址', phone: '07', intro: '', description: '', facebook: '', fb_note: '', line: '', map_url: '',
    }, 'yihua') as never)
    const wrapper = await mountView(CampusProfileView, '/content/campus-profile')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    // 沒換封面：焦點示意為官網原本的位置（義華卡片是上方 12%）。
    const pins = wrapper.findAll('.focus-picker__pin')
    expect(pins).toHaveLength(2)
    expect(pins[0]!.attributes('style')).toContain('top: 12%')
    expect(wrapper.text()).toContain('官網原本的位置')
    const card = wrapper.findAll('.focus-picker__stage')[0]!
    await card.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    const payload = await savedPayload(wrapper, 'campus_profile')
    expect(payload.card_focus).toEqual({ x: 50, y: 22 })
    expect(payload.hero_focus).toBeNull()
    expect(payload.cover).toBeNull()
  })

  it('首頁消息：活動影片清單預設沿用內建，打開自訂才送出清單', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', { sample_note: '', articles: [], events: [], home_display_count: null }) as never)
    const wrapper = await mountView(HomeNewsView, '/content/home-news')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('手機版活動影片')
    expect(wrapper.text()).not.toContain('新增一支影片')
    const toggle = () => wrapper.findAll('.el-switch').find((s) => s.text().includes('自訂影片清單'))!
    await toggle().trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('新增一支影片')
    let payload = await savedPayload(wrapper, 'home_news')
    expect(payload.films).toHaveLength(1)
    expect((payload.films as HomeFilmPayload[])[0]).toMatchObject({ source: 'file', video: null, start: 0, end: null })
    await toggle().trigger('click')
    await flushPromises()
    payload = await savedPayload(wrapper, 'home_news')
    expect(payload.films).toBeNull()
  })
})

describe('活動影片規則與標籤', () => {
  it('YouTube 網址、片段秒數', () => {
    expect(youtubeIdOf('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdOf('https://example.com')).toBe('')
    const film = { ...newHomeFilm(), start: 5, end: 5 }
    expect(filmClipError(film)).toContain('結束秒數')
    expect(filmClipError({ ...film, end: null })).toBe('')
    expect(filmYoutubeError({ ...film, source: 'youtube', youtube_url: 'nope' })).toContain('YouTube')
  })

  it('HomeFilmsEditor 關閉自訂時送 null', async () => {
    const films = ref<HomeFilmPayload[] | null>([newHomeFilm()])
    const wrapper = mountPlain(() => h(HomeFilmsEditor, { films: films.value, 'onUpdate:films': (v: HomeFilmPayload[] | null) => (films.value = v) }))
    await wrapper.get('.el-switch').trigger('click')
    expect(films.value).toBeNull()
  })

  it('新欄位路徑、欄位與稽核動作都有中文', () => {
    expect(mediaFieldPathLabel('video_desktop.media_id')).toBe('首屏影片（桌機）')
    expect(mediaFieldPathLabel('moments[2].photo.media_id')).toBe('孩子的一天第 3 張卡片的照片')
    expect(mediaFieldPathLabel('films[0].poster.media_id')).toBe('第 1 支活動影片的封面')
    expect(mediaFieldPathLabel('cover.media_id')).toBe('封面照片')
    expect(contentFieldLabel('card_focus')).toBe('首頁卡片焦點')
    expect(contentFieldLabel('films')).toBe('手機版活動影片')
    expect(auditActionLabel('media.import_site_assets')).toBe('匯入官網內建素材')
  })
})
