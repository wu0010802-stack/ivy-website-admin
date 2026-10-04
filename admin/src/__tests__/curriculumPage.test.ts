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
import { contentFieldLabelFor, contentPathFieldLabel, contentPathLabel } from '../api/contentFieldLabels'
import { LENGTH_HINTS } from '../composables/contentHints'
import { revealContentPath } from '../composables/newsContent'
import MediaSlotField from '../components/MediaSlotField.vue'
import { CURRICULUM_BUILTIN_PHOTOS, CURRICULUM_PHOTO_PREVIEWS, curriculumPageDraft, highlightMissing } from '../composables/curriculumPageDraft'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const PHOTO_KEY = /(^|_)photo(_alt)?$/
/** 只留文字鍵（去掉 photo／photo_alt／*_photo／*_photo_alt），清單項目也一樣。 */
function textOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(textOnly)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !PHOTO_KEY.test(k)).map(([k, v]) => [k, textOnly(v)]))
  return value
}

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

  it('內建內容與官網 fixture 一字不差（文字）；照片版位全是 null／空字串，形狀同後端 model_dump', () => {
    const expected = Object.fromEntries(Object.entries(fixture.curriculumPage).map(([k, v]) => [snake(k), v]))
    const draft = curriculumPageDraft()
    expect(textOnly(draft)).toEqual(expected)
    expect([draft.hero_photo, draft.hero_photo_alt, draft.years_photo, draft.years_photo_alt]).toEqual([null, '', null, ''])
    for (const item of [...draft.directions, ...draft.gallery, ...draft.daily]) {
      expect([item.photo, item.photo_alt]).toEqual([null, ''])
    }
    // 每項是各自的物件：改一項的照片不會連動別項
    draft.gallery[0]!.photo = { media_id: 'a', focus_x: null, focus_y: null }
    expect(draft.gallery[1]!.photo).toBeNull()
  })

  it('照片焦點預覽的比例和官網 curriculum.css 一致', () => {
    const css = readFileSync(resolve(ROOT, 'web/app/assets/css/curriculum.css'), 'utf8')
    expect(css).toContain('.cur-years-photo .cur-frame { aspect-ratio: 3 / 2; }')
    expect(css).toContain('.cur-thing .cur-frame { aspect-ratio: 8 / 5; }')
    expect(css).toContain('.cur-dir .cur-frame { aspect-ratio: 4 / 3; }')
    expect(css).toContain('.cur-dir--integrated .cur-frame, .cur-dir--multicultural .cur-frame, .cur-dir--activities .cur-frame { aspect-ratio: 4 / 5; }')
    expect(css).toContain('.cur-dir--art .cur-frame { aspect-ratio: 16 / 9; }')
    expect(css).toContain('.cur-dir .cur-frame { aspect-ratio: 4 / 3 !important; }')
    expect(css).toContain('.cur-hero-photo img { height: auto; min-height: 0; aspect-ratio: 4 / 3; }')
    const ratios = (list: readonly { ratio: string }[]) => list.map((p) => p.ratio)
    expect(ratios(CURRICULUM_PHOTO_PREVIEWS.years)).toEqual(['3 / 2'])
    expect(ratios(CURRICULUM_PHOTO_PREVIEWS.daily)).toEqual(['8 / 5'])
    expect(CURRICULUM_PHOTO_PREVIEWS.directions.map(ratios)).toEqual([
      ['4 / 3'], ['4 / 5', '4 / 3'], ['4 / 5', '4 / 3'], [], ['4 / 3'], ['4 / 5', '4 / 3'], ['16 / 9', '4 / 3'],
    ])
    expect(ratios(CURRICULUM_PHOTO_PREVIEWS.hero).at(-1)).toBe('4 / 3')
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

  it('品德培養的 sub 叫「引言（大字）」，錯誤位置與定位標籤都對得上；其他方向仍叫副標', () => {
    expect(contentPathLabel('curriculum_page', ['directions', 3, 'sub'])).toBe('課程方向第 4 個・引言（大字）')
    expect(contentPathFieldLabel('curriculum_page', ['directions', 3, 'sub'])).toBe('引言（大字）')
    expect(contentPathFieldLabel('curriculum_page', ['directions', 2, 'sub'])).toBe('副標')
    expect(contentPathFieldLabel('curriculum_page', ['directions', 3, 'text'])).toBe('說明')
    // 別的內容種類不受影響
    expect(contentPathFieldLabel('home_news', ['directions', 3, 'sub'])).not.toBe('引言（大字）')
    // 建議值不高於後端硬上限（page_schemas.py 的 QUOTE_SUB_LIMIT 10、QUOTE_TEXT_LIMIT 20）
    expect(LENGTH_HINTS.curQuote.max).toBeLessThanOrEqual(10)
    expect(LENGTH_HINTS.curQuoteText.max).toBeLessThanOrEqual(20)
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

  it('從未存過：換了照片再改回內建，不算未儲存的修改（首屏與清單項目）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const slots = wrapper.findAllComponents(MediaSlotField)
    // 順序：首屏、四個年段、課程方向 6 張（品德培養沒有）、作品 8 張、五件事 5 張
    expect(slots).toHaveLength(1 + 1 + 6 + 8 + 5)
    for (const slot of [slots[0]!, slots[8]!]) {
      slot.vm.$emit('update:modelValue', { media_id: '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c', focus_x: null, focus_y: null })
      slot.vm.$emit('picked', { id: '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c', alt_text: '孩子在畫畫' }, null)
      await flushPromises()
      expect(wrapper.text()).toContain('有未儲存的修改')
      slot.vm.$emit('update:modelValue', null)
      slot.vm.$emit('cleared')
      await flushPromises()
      expect(wrapper.text()).not.toContain('有未儲存的修改')
    }
  })

  it('存檔被擋：教學理念第 5 項、品德培養的引言，點錯誤會聚焦到那一欄', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    for (const [path, value] of [[['beliefs', 4], '尊重個別差異，鼓勵自信探索'], [['directions', 3, 'sub'], '六歲定八十'], [['directions', 2, 'sub'], '沉浸式美語活動']] as const) {
      expect(await revealContentPath(root, path, contentPathFieldLabel('curriculum_page', path))).toBe(true)
      expect((document.activeElement as HTMLInputElement | null)?.value).toBe(value)
    }
  })

  it('品德培養沒有照片欄；顏料標示找不到時即時提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('印在顏料上的引言，沒有照片')
    const quote = wrapper.findAll('[data-list="directions"] [data-list-item="3"] .el-form-item__label').map((el) => el.text())
    expect(quote).toEqual(['標題', '引言（大字）', '說明'])
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
    // 抽屜與替換對話框的標題已經寫了頁名，位置不再帶頁名（關於常春藤頁也有 hero_photo）
    expect(mediaFieldPathLabel('hero_photo.media_id')).toBe('首屏照片')
    expect(mediaFieldPathLabel('years_photo.media_id')).toBe('四個年段的照片')
    expect(mediaFieldPathLabel('directions[2].photo.media_id')).toBe('課程方向第 3 項的照片')
    expect(mediaFieldPathLabel('gallery[0].photo.media_id')).toBe('兒童美術館第 1 件作品的照片')
    expect(mediaFieldPathLabel('daily[4].photo.media_id')).toBe('五件事第 5 件的照片')
    expect(mediaFieldPathLabel('photo.media_id')).toBe('關於常春藤照片')
    expect(mediaFieldPathLabel('moments[1].photo.media_id')).toBe('孩子的一天第 2 張卡片的照片')
  })
})
