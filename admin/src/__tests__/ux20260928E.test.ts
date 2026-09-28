// 2026-09-28 內容編輯頁 UX 修正（E 組）：校園探索畫布比例、欄位提示排版、用語、
// 清單排序與新增、常見問題、社群網址、官網沒顯示的欄位、自訂開關、縮圖與圖片說明。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import { CONTENT_FIELD_LABELS, mediaFieldPathLabel } from '../api/labels'
import type { UserOut } from '../api/types'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
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
    'CampusProfileView.vue', 'CampusFaqView.vue', 'SharedFaqView.vue', 'CampusNewsView.vue', 'AdmissionContentView.vue',
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
    const { default: HomeAboutView } = await import('../views/HomeAboutView.vue')
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
