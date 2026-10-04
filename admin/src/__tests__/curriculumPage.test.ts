/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import CurriculumPageView from '../views/CurriculumPageView.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentPreviewPath, contentPublicPath, mediaFieldPathLabel } from '../api/labels'
import { contentFieldLabelFor, contentPathLabel } from '../api/contentFieldLabels'
import { CURRICULUM_BUILTIN_PHOTOS, curriculumPageDraft, highlightMissing } from '../composables/curriculumPageDraft'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
  document.body.innerHTML = ''
})

async function mountAs(user: UserOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/content/curriculum-page')
  await router.isReady()
  const wrapper = mount(CurriculumPageView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const neverSaved = { id: 'item', kind: 'curriculum_page', campus_key: null, latest_version: 0, current_published_revision_id: null, latest_revision: null }
const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })

describe('特色教學頁（curriculum_page）', () => {
  it('側欄在「全站與素材」、只給 super_admin，標籤與網址對得上', () => {
    const item = NAV_GROUPS.find((g) => g.key === 'site')!.items.find((i) => i.name === 'curriculum-page')!
    expect(item.path).toBe('/content/curriculum-page')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    expect(CONTENT_KIND_LABELS.curriculum_page).toBe('特色教學頁')
    expect(contentPublicPath('curriculum_page')).toBe('/curriculum')
    expect(contentPreviewPath('curriculum_page')).toBe('/preview?page=curriculum')
    expect(contentEditorPath('curriculum_page')).toBe('/content/curriculum-page')
  })

  it('內建內容與官網 fixture 一字不差', () => {
    const expected = Object.fromEntries(Object.entries(fixture.curriculumPage).map(([k, v]) => [snake(k), v]))
    expect(curriculumPageDraft()).toEqual(expected)
  })

  it('內建照片的代號在官網 assets 裡，也和官網元件寫的一樣', () => {
    const component = readFileSync(resolve(ROOT, 'web/app/components/CurriculumContent.vue'), 'utf8')
    const { hero, years, directions, gallery, daily } = CURRICULUM_BUILTIN_PHOTOS
    for (const code of [hero, years, ...directions.filter(Boolean), ...gallery, ...daily]) {
      expect(existsSync(resolve(ROOT, `web/public/assets/${code}.webp`))).toBe(true)
      if (code !== hero) expect(component).toContain(`'${code}'`)
    }
  })

  it('顏料標示：留空不算錯；找不到或跨行算錯（同後端）', () => {
    expect(highlightMissing('從動手做開始，\n愛上學習。', '')).toBe(false)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '動手做')).toBe(false)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '開始，\n愛上')).toBe(true)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '畫畫')).toBe(true)
  })

  it('發布確認與錯誤訊息的欄位有中文名', () => {
    expect(contentFieldLabelFor('curriculum_page', 'hero_title')).toBe('首屏大標')
    expect(contentPathLabel('curriculum_page', ['directions', 2, 'title'])).toBe('課程方向第 3 個・標題')
    expect(contentPathLabel('curriculum_page', ['beliefs', 4])).toBe('教學理念第 5 項')
    expect(contentPathLabel('curriculum_page', ['gallery', 0, 'photo_alt'])).toBe('兒童美術館的作品第 1 件・照片說明')
  })

  it('從未存過：表單就是官網內建內容、不算未儲存修改，並說明官網目前顯示的是內建內容', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('官網目前顯示的是內建內容')
    const values = wrapper.findAll('input, textarea').map((el) => (el.element as HTMLInputElement).value)
    expect(values).toContain('常春藤幼兒園 · 特色教學')
    expect(values).toContain('從動手做開始，\n愛上學習。')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
  })

  it('改了字再儲存：送出的內容保留固定項目與順序', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
      ...neverSaved, latest_version: 1,
      latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-04T00:00:00Z', payload: (body as { payload: unknown }).payload, review_status: 'draft' },
    }) as never)
    const wrapper = await mountAs(superAdmin())
    const eyebrow = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '常春藤幼兒園 · 特色教學')!
    await eyebrow.setValue('常春藤 · 特色教學')
    await wrapper.findAll('button').find((b) => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))!
    const payload = (call[1] as { payload: Record<string, unknown> }).payload
    expect(payload.hero_eyebrow).toBe('常春藤 · 特色教學')
    expect((payload.directions as { key: string }[]).map((d) => d.key)).toEqual(['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'])
    expect(payload.gallery).toHaveLength(8)
  })

  it('品德培養沒有照片欄；顏料標示找不到時即時提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('印在顏料上的引言，沒有照片')
    const highlight = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '動手做')!
    await highlight.setValue('畫畫')
    await flushPromises()
    expect(wrapper.text()).toContain('大標裡找不到「畫畫」')
  })
})

describe('特色教學頁：段落導覽、422 定位、素材用途標籤', () => {
  const source = readFileSync(resolve(__dirname, '../views/CurriculumPageView.vue'), 'utf8')
  it('每個段落標題有 id、data-section-anchor、tabindex，並傳 sections', () => {
    expect(source).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    for (const k of ['hero', 'chapters', 'years', 'directions', 'gallery', 'daily', 'beliefs']) {
      expect(source).toContain(`id="section-cur-${k}" class="sub-title" data-section-anchor tabindex="-1"`)
    }
  })
  it('每個清單有 data-list，項目有 data-list-item（revealContentPath 靠它定位）', () => {
    for (const k of ['chapters', 'years', 'directions', 'gallery', 'daily', 'beliefs']) {
      expect(source).toContain(`data-list="${k}"`)
    }
    expect(source.match(/:data-list-item="i"/g)).toHaveLength(6)
  })
  it('素材庫「用在哪裡」認得本頁的照片路徑，既有的寬鬆路徑不受影響', () => {
    expect(mediaFieldPathLabel('hero_photo.media_id')).toBe('特色教學頁的首屏照片')
    expect(mediaFieldPathLabel('years_photo.media_id')).toBe('特色教學頁四個年段的照片')
    expect(mediaFieldPathLabel('directions[2].photo.media_id')).toBe('課程方向第 3 個的照片')
    expect(mediaFieldPathLabel('gallery[0].photo.media_id')).toBe('兒童美術館的作品第 1 件的照片')
    expect(mediaFieldPathLabel('daily[4].photo.media_id')).toBe('五件事第 5 件的照片')
    expect(mediaFieldPathLabel('photo.media_id')).toBe('關於常春藤照片')
    expect(mediaFieldPathLabel('moments[1].photo.media_id')).toBe('孩子的一天第 2 張卡片的照片')
  })
})
