// 2026-10-06 方向 D：內容編輯右側官網預覽的分頁對照表、同源判斷、縮放與外觀。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ElementPlus from 'element-plus'
import LivePreviewPane from '../components/LivePreviewPane.vue'
import {
  fitPreviewFrame,
  livePreviewOrigin,
  PREVIEW_FRAME_WIDTH,
  PREVIEW_TARGETS,
  PREVIEW_VIEWPORT_KEY,
  previewFrameUrl,
  previewTargetsFor,
  readPreviewViewport,
  rememberPreviewViewport,
} from '../composables/previewTargets'

// 有些環境（例如 Node 25）的 jsdom localStorage 只是沒有方法的空物件，沒有 Storage 的實作就補一個最小的。
if (typeof (globalThis.localStorage as Storage | undefined)?.getItem !== 'function') {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  })
}

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  localStorage.clear()
})

// 15 個用 ContentEditor 的編輯頁（router/nav.ts 的官網內容三組）。
const EDITOR_KINDS = [
  'home_hero', 'home_about', 'day_experience', 'home_campus_board', 'home_news',
  'campus_profile', 'campus_news', 'campus_tour',
  'booking_content', 'admission_content', 'privacy_policy', 'curriculum_page', 'about_page', 'site_footer', 'site_meta',
]

describe('預覽分頁對照表', () => {
  it('15 個編輯頁都有列；只有校園探索沒有預覽欄；同一頁的分頁代號不重複', () => {
    expect(Object.keys(PREVIEW_TARGETS).sort()).toEqual([...EDITOR_KINDS].sort())
    for (const kind of EDITOR_KINDS) {
      const targets = previewTargetsFor(kind)
      if (kind === 'campus_tour') expect(targets).toEqual([])
      else expect(targets.length).toBeGreaterThan(0)
      expect(new Set(targets.map((t) => t.id)).size).toBe(targets.length)
    }
    expect(previewTargetsFor(undefined)).toEqual([])
    expect(previewTargetsFor('shared_faq')).toEqual([])
  })

  it('五校介紹：首頁五校與頁尾；預約文案與網站標題只對看得到的欄位', () => {
    expect(previewTargetsFor('campus_profile').map((t) => [t.label, t.page, t.block])).toEqual([['首頁五校', 'home', 'home-campuses'], ['頁尾', 'home', 'site-footer']])
    expect(previewTargetsFor('booking_content').map((t) => t.fields)).toEqual([['privacy_title', 'privacy_sections'], ['cta_label', 'cta_label_en']])
    expect(previewTargetsFor('site_meta')[0]!.fields).toEqual(['header_phone_number', 'header_phone_note', 'primary_nav'])
  })

  it('原型鍵不當成編輯頁：toString、constructor 一律沒有預覽欄', () => {
    expect(previewTargetsFor('toString')).toEqual([])
    expect(previewTargetsFor('constructor')).toEqual([])
    expect(previewTargetsFor('__proto__')).toEqual([])
  })
})

describe('同源才嵌、iframe 網址、縮放', () => {
  const here = { href: 'https://ivy.example/admin/content/site-footer', origin: 'https://ivy.example' }

  it('正式站（空字串）與同網域：回同一個 origin；本機 5173 對 3000：不嵌', () => {
    expect(livePreviewOrigin('', here)).toBe('https://ivy.example')
    expect(livePreviewOrigin('https://ivy.example', here)).toBe('https://ivy.example')
    expect(livePreviewOrigin('http://127.0.0.1:3000', { href: 'http://localhost:5173/admin/', origin: 'http://localhost:5173' })).toBeNull()
    expect(livePreviewOrigin('not a url ::', { href: 'nope', origin: 'null' })).toBeNull()
  })

  it('網址只帶 embed、live、page，不帶任何內容', () => {
    expect(previewFrameUrl('https://ivy.example', 'home', { live: false })).toBe('https://ivy.example/preview?embed=1&page=home')
    expect(previewFrameUrl('https://ivy.example', 'visit', { live: true })).toBe('https://ivy.example/preview?embed=1&live=1&page=visit')
  })

  it('桌機 1280 寬、手機 390 寬，縮到放得進欄內，不放大', () => {
    expect(PREVIEW_FRAME_WIDTH).toEqual({ desktop: 1280, mobile: 390 })
    expect(fitPreviewFrame({ width: 400, height: 700 }, 'desktop')).toEqual({ width: 1280, height: 2299, scale: 0.294 })
    expect(fitPreviewFrame({ width: 400, height: 700 }, 'mobile')).toEqual({ width: 390, height: 701, scale: 0.964 })
    expect(fitPreviewFrame({ width: 900, height: 700 }, 'mobile').scale).toBe(1)
  })

  it('寬度偏好預設手機、記在這台瀏覽器；讀寫失敗當沒記', () => {
    expect(readPreviewViewport()).toBe('mobile')
    rememberPreviewViewport('desktop')
    expect(localStorage.getItem(PREVIEW_VIEWPORT_KEY)).toBe('desktop')
    expect(readPreviewViewport()).toBe('desktop')

    // 私密模式等讀寫都會丟錯：換成一個會丟錯的 localStorage，驗完立刻換回來（restoreAllMocks 不還原 stubGlobal）。
    const original = globalThis.localStorage
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    try {
      expect(readPreviewViewport()).toBe('mobile')
      expect(() => rememberPreviewViewport('desktop')).not.toThrow()
    } finally {
      vi.stubGlobal('localStorage', original)
    }
  })
})

describe('LivePreviewPane', () => {
  function mountPane(props: Record<string, unknown> = {}) {
    const wrapper = mount(LivePreviewPane, {
      props: {
        targets: previewTargetsFor('campus_profile'),
        src: 'https://ivy.example/preview?embed=1&live=1&page=home',
        state: 'live',
        frameKey: 'yihua|0',
        target: 'campuses',
        viewport: 'mobile',
        ...props,
      },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    return wrapper
  }

  it('分頁、寬度切換、狀態字；iframe 有 sandbox、不進 Tab 順序', async () => {
    const wrapper = mountPane()
    // frame 是 iframe 的 template ref 掛上之後（post flush）才通知，晚 mount 一個 microtask。
    await nextTick()
    expect(wrapper.get('aside').attributes('aria-label')).toBe('官網預覽')
    expect(wrapper.findAll('.el-radio-button').map((b) => b.text())).toEqual(['首頁五校', '頁尾', '桌機', '手機'])
    expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是還沒存的修改')
    const frame = wrapper.get('iframe')
    expect(frame.attributes('title')).toBe('官網預覽')
    expect(frame.attributes('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(frame.attributes('tabindex')).toBe('-1')
    expect(frame.attributes('referrerpolicy')).toBe('same-origin')
    expect(frame.attributes('src')).toBe('https://ivy.example/preview?embed=1&live=1&page=home')
    // jsdom 量不到尺寸：用 400×700 估。
    expect(frame.attributes('style')).toContain('scale(0.964)')
    expect(wrapper.emitted('frame')![0]![0]).toBe(frame.element)

    await wrapper.findAll('.el-radio-button input')[1]!.setValue(true)
    expect(wrapper.emitted('update:target')![0]).toEqual(['footer'])
    await wrapper.findAll('.el-radio-button input')[2]!.setValue(true)
    expect(wrapper.emitted('update:viewport')![0]).toEqual(['desktop'])
  })

  it('sandbox 不放行換頁、彈窗、表單與對話框', () => {
    const tokens = (mountPane().get('iframe').attributes('sandbox') ?? '').split(/\s+/)
    for (const forbidden of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-forms', 'allow-modals']) {
      expect(tokens).not.toContain(forbidden)
    }
  })

  it('只有一個分頁時寫名稱，不放單選', () => {
    const wrapper = mountPane({ targets: previewTargetsFor('site_footer'), target: 'footer' })
    expect(wrapper.get('.live-preview__where').text()).toBe('頁尾')
    expect(wrapper.findAll('.el-radio-button').map((b) => b.text())).toEqual(['桌機', '手機'])
  })

  it('各狀態的說明；失敗時蓋一層說明與重新載入，iframe 留著', async () => {
    expect(mountPane({ state: 'connecting' }).get('.live-preview__meta').text()).toBe('正在載入預覽…')
    expect(mountPane({ state: 'saved' }).get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
    const failed = mountPane({ state: 'failed' })
    expect(failed.find('.live-preview__meta').exists()).toBe(false)
    expect(failed.get('.live-preview__failed').text()).toContain('預覽沒有載入，可能是登入逾時。')
    expect(failed.find('iframe').exists()).toBe(true)
    await failed.get('.live-preview__failed button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('frameKey 換了就重建 iframe', async () => {
    const wrapper = mountPane()
    const first = wrapper.get('iframe').element
    await wrapper.setProps({ frameKey: 'yihua|1' })
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
    expect(wrapper.emitted('frame')!.at(-1)![0]).toBe(wrapper.get('iframe').element)
  })
})
