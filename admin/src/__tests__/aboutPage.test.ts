/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AboutPageView from '../views/AboutPageView.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, campusLabel, contentEditorPath, contentPreviewPath, contentPublicPath, mediaFieldPathLabel } from '../api/labels'
import { contentFieldLabelFor, contentPathFieldLabel, contentPathLabel } from '../api/contentFieldLabels'
import { revealContentPath } from '../composables/newsContent'
import { LENGTH_HINTS, lengthHintText } from '../composables/contentHints'
import { ABOUT_BUILTIN_PHOTOS, ABOUT_PHOTO_PREVIEWS, aboutPageDraft } from '../composables/aboutPageDraft'
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
  await router.push('/content/about-page')
  await router.isReady()
  const wrapper = mount(AboutPageView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const neverSaved = { id: 'item', kind: 'about_page', campus_key: null, latest_version: 0, current_published_revision_id: null, latest_revision: null }
const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })

describe('關於常春藤頁（about_page）', () => {
  it('側欄、標籤與網址', () => {
    const item = NAV_GROUPS.find((g) => g.key === 'site')!.items.find((i) => i.name === 'about-page')!
    expect(item.path).toBe('/content/about-page')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    expect(CONTENT_KIND_LABELS.about_page).toBe('關於常春藤頁')
    expect(contentPublicPath('about_page')).toBe('/about')
    expect(contentPreviewPath('about_page')).toBe('/preview?page=about')
    expect(contentEditorPath('about_page')).toBe('/content/about-page')
  })

  it('內建內容與官網 fixture 一字不差（文字）；照片版位全是 null／空字串，形狀同後端 model_dump', () => {
    const expected = Object.fromEntries(Object.entries(fixture.aboutPage).map(([k, v]) => [snake(k), v]))
    const draft = aboutPageDraft()
    expect(textOnly(draft)).toEqual(expected)
    expect([draft.hero_photo, draft.hero_photo_alt, draft.hero_back_photo, draft.hero_back_photo_alt, draft.hope_photo, draft.hope_photo_alt]).toEqual([null, '', null, '', null, ''])
  })

  it('內建照片在官網 assets 裡，也和官網元件寫的一樣', () => {
    const component = readFileSync(resolve(ROOT, 'web/app/components/AboutContent.vue'), 'utf8')
    for (const code of Object.values(ABOUT_BUILTIN_PHOTOS)) {
      expect(existsSync(resolve(ROOT, `web/public/assets/${code}.webp`))).toBe(true)
      if (code !== ABOUT_BUILTIN_PHOTOS.hero) expect(component).toContain(`'${code}'`)
    }
  })

  it('照片焦點預覽的比例和官網 about.css 一致；紙房子窗戶也裁成 4:3', () => {
    const css = readFileSync(resolve(ROOT, 'web/app/assets/css/about.css'), 'utf8')
    expect(css).toContain('.abk-card img,.abk-blank{display:block;width:100%;height:auto;aspect-ratio:4/3;')
    expect(css).toContain('.abk-pop.is-back img{aspect-ratio:4/5;')
    expect(css).toContain('.abk-window img{outline:none}')
    // 窗戶 img 在 .abk-house 的 .abk-card 裡，吃 .abk-card img 的 4:3 裁切（.abk-window img 只取消 outline）
    const component = readFileSync(resolve(ROOT, 'web/app/components/AboutContent.vue'), 'utf8')
    const house = component.slice(component.indexOf('abk-pop abk-house'))
    expect(house.indexOf('class="abk-card"')).toBeGreaterThan(-1)
    expect(house.indexOf('class="abk-card"')).toBeLessThan(house.indexOf('class="abk-window"'))
    expect(ABOUT_PHOTO_PREVIEWS.hope.map((p) => p.ratio)).toEqual(['4 / 3'])
    expect(ABOUT_PHOTO_PREVIEWS.hero.map((p) => p.ratio)).toEqual(['4 / 3'])
    expect(ABOUT_PHOTO_PREVIEWS.heroBack.map((p) => p.ratio)).toEqual(['4 / 5'])
    expect(Object.keys(ABOUT_PHOTO_PREVIEWS)).toEqual(['hero', 'heroBack', 'hope'])
  })

  it('錯誤訊息指到沿革第幾站', () => {
    expect(contentFieldLabelFor('about_page', 'hero_title')).toBe('首屏大標')
    expect(contentPathLabel('about_page', ['milestones', 0, 'year'])).toBe('沿革第 1 站・年份')
    expect(contentPathLabel('about_page', ['milestones', 3, 'text'])).toBe('沿革第 4 站・說明')
    expect(contentPathLabel('about_page', ['hope_quotes', 1])).toBe('期許第 2 段')
    expect(contentPathLabel('about_page', ['chapter_names', 2])).toBe('章名第 3 個')
  })

  it('從未存過：表單是內建內容、不算未儲存修改；沿革顯示校名與民國年', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('官網目前顯示的是內建內容')
    expect(wrapper.text()).toContain(campusLabel('yihua'))
    expect(wrapper.text()).toContain('民國 86 年')
    const values = wrapper.findAll('input, textarea').map((el) => (el.element as HTMLInputElement).value)
    expect(values).toContain('從一間幼兒園，\n長成五所校園。')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
  })

  it('沿革年份可改，民國年跟著算；送出的內容保留固定五站順序', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
      ...neverSaved, latest_version: 1,
      latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-04T00:00:00Z', payload: (body as { payload: unknown }).payload, review_status: 'draft' },
    }) as never)
    const wrapper = await mountAs(superAdmin())
    const year = wrapper.find('[data-list="milestones"] [data-list-item="1"] input')
    await year.setValue('2002')
    await flushPromises()
    expect(wrapper.find('[data-list="milestones"] [data-list-item="1"]').text()).toContain('民國 91 年')
    await wrapper.findAll('button').find((b) => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))!
    const payload = (call[1] as { payload: { milestones: { key: string; year: number }[] } }).payload
    expect(payload.milestones.map((m) => m.key)).toEqual(['yihua', 'minghua', 'chongde', 'international', 'renwu'])
    expect(payload.milestones[1]!.year).toBe(2002)
  })

  it('從未存過：換了照片再改回內建，不算未儲存的修改（三張照片）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const slots = wrapper.findAllComponents(MediaSlotField)
    expect(slots).toHaveLength(3)
    for (const slot of slots) {
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

  it('從未存過：內建內容沒有一欄超過建議字數（一打開就不會有金色提醒）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.findAll('.length-hint').length).toBeGreaterThan(15)
    expect(wrapper.findAll('.length-hint.is-over').map((el) => el.text())).toEqual([])
  })

  it('一路走來的標題逐行提醒（第一行 6、第二三行 7），和後端硬上限一樣', () => {
    const rule = LENGTH_HINTS.aboutStoryTitle
    expect(lengthHintText('近三十年，\n長出五所校園。', rule)).toEqual({ text: '每行 5／7 字・建議 6／7／7 字內', over: false })
    expect(lengthHintText('一二三四五六七\n長出五所校園。', rule)).toEqual({ text: '第 1 行 7 字，超過建議的 6 字：會壓到右上角的紀念章，存不了', over: true })
    expect(lengthHintText('近三十年，\n一二三四五六七八', rule).text).toContain('第 2 行 8 字，超過建議的 7 字')
    // 單行 10 字：總字數不多，但第一行超過，存檔會被擋，提醒也要亮
    expect(lengthHintText('一'.repeat(10), rule).over).toBe(true)
    expect(lengthHintText('', rule).text).toBe('每行建議 6／7／7 字內')
    const schemas = readFileSync(resolve(ROOT, 'backend/app/content/page_schemas.py'), 'utf8')
    expect(schemas).toContain(`STORY_TITLE_PER_LINE = (${rule.max.join(', ')})`)
  })

  it('我們的期許的標題用自己的建議值（內建 9／7 字加換行是 17）', () => {
    expect(lengthHintText(aboutPageDraft().hope_title, LENGTH_HINTS.aboutHopeTitle).over).toBe(false)
    expect(LENGTH_HINTS.aboutHopeTitle.max).toBe(18)
  })

  it('沿革年份比上一站早：那一站即時提醒（不擋存檔），改回來提醒就消失', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    // el-form-item 的錯誤訊息延遲 100ms 才顯示（Element Plus 的 refDebounced）
    const settle = async () => { await flushPromises(); await new Promise((done) => setTimeout(done, 150)); await flushPromises() }
    const station = () => wrapper.find('[data-list="milestones"] [data-list-item="2"]')
    expect(wrapper.find('[data-list="milestones"]').text()).not.toContain('年份要由早到晚，否則存不了')
    await station().find('input').setValue('2000')
    await settle()
    expect(station().text()).toContain('比上一站（明華 2001）早，年份要由早到晚，否則存不了')
    expect(wrapper.find('[data-list="milestones"] [data-list-item="1"]').text()).not.toContain('否則存不了')
    await station().find('input').setValue('2005')
    await settle()
    expect(station().text()).not.toContain('否則存不了')
  })

  it('年份只收整數；清空時不顯示民國年（不會出現「民國 -1911 年」）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const station = () => wrapper.find('[data-list="milestones"] [data-list-item="1"]')
    await station().find('input').setValue('2002.6')
    await flushPromises()
    expect(station().find('.page-copy__item-title').text()).toBe('明華民國 92 年')
    await station().find('input').setValue('')
    await flushPromises()
    expect(station().find('.page-copy__item-title').text()).toBe('明華')
    expect(wrapper.text()).not.toContain('-1911')
  })

  it('義華的年份旁說明哪些地方的 1997 不會跟著改', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const yihua = wrapper.find('[data-list="milestones"] [data-list-item="0"]').text()
    expect(yihua).toContain('30 週年頁上的 1997 不會跟著改，要改請通知工程師')
    expect(wrapper.find('[data-list="milestones"] [data-list-item="1"]').text()).not.toContain('通知工程師')
  })

  it('存檔被擋在整個沿革（年份沒有由早到晚，loc 只有清單名）：點錯誤會捲到沿革、聚焦第一站的年份', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    expect(contentPathFieldLabel('about_page', ['milestones'])).toBe('沿革')
    expect(await revealContentPath(root, ['milestones'], contentPathFieldLabel('about_page', ['milestones']))).toBe(true)
    const first = root.querySelector('[data-list="milestones"] [data-list-item="0"] input')
    expect(document.activeElement).toBe(first)
  })

  it('存檔被擋：期許第 2 段、沿革第 4 站說明與第 2 站年份、章名，點錯誤會聚焦到那一欄', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    const draft = aboutPageDraft()
    for (const [path, value] of [
      [['hope_quotes', 1], draft.hope_quotes[1]],
      [['milestones', 3, 'text'], draft.milestones[3]!.text],
      [['milestones', 1, 'year'], String(draft.milestones[1]!.year)],
      [['chapter_names', 2], draft.chapter_names[2]],
    ] as const) {
      expect(await revealContentPath(root, path, contentPathFieldLabel('about_page', path))).toBe(true)
      expect((document.activeElement as HTMLInputElement | null)?.value).toBe(value)
    }
  })
})

describe('關於常春藤頁：段落導覽、清單定位、素材用途標籤', () => {
  const source = readFileSync(resolve(__dirname, '../views/AboutPageView.vue'), 'utf8')
  it('每個段落標題有 id、data-section-anchor、tabindex，並傳 sections', () => {
    expect(source).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    for (const k of ['hero', 'chapters', 'story', 'whole', 'hope', 'outro']) {
      expect(source).toContain(`id="section-about-${k}" class="sub-title" data-section-anchor tabindex="-1"`)
    }
  })
  it('三個清單有 data-list，每項有 data-list-item', () => {
    for (const k of ['chapter_names', 'milestones', 'hope_quotes']) expect(source).toContain(`data-list="${k}"`)
    expect(source.match(/:data-list-item="i"/g)).toHaveLength(3)
  })
  it('素材庫「用在哪裡」認得三張照片，既有路徑不受影響', () => {
    expect(mediaFieldPathLabel('hero_photo.media_id')).toBe('首屏照片')
    expect(mediaFieldPathLabel('hero_back_photo.media_id')).toBe('首屏後排照片')
    expect(mediaFieldPathLabel('hope_photo.media_id')).toBe('紙房子窗戶的照片')
    expect(mediaFieldPathLabel('years_photo.media_id')).toBe('四個年段的照片')
    expect(mediaFieldPathLabel('photo.media_id')).toBe('關於常春藤照片')
    expect(mediaFieldPathLabel('directions[2].photo.media_id')).toBe('課程方向第 3 項的照片')
  })
  it('欄位名與表單標籤一致', () => {
    const labels = ['首屏大標', '首屏介紹', '首屏照片上的一句話', '一路走來的標題', '一路走來的說明', '全人教育的標題', '全人教育的說明', '全人教育的補充', '全人教育的出處', '我們的期許的標題', '五所校園的標題', '五所校園的說明', '首屏照片', '首屏後排照片', '紙房子窗戶的照片']
    for (const label of labels) expect(source).toContain(`label="${label}"`)
    const kindLabels = new Set(['hero_title', 'hero_lede', 'hero_caption', 'hero_photo', 'hero_back_photo', 'story_title', 'story_text', 'whole_title', 'whole_text', 'whole_fine', 'whole_fine_source', 'hope_title', 'hope_photo', 'outro_title', 'outro_text'].map((k) => contentFieldLabelFor('about_page', k)))
    for (const label of labels) expect(kindLabels.has(label)).toBe(true)
  })
})
