/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import EnvironmentPageView from '../views/EnvironmentPageView.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { api } from '../api/client'
import type { EnvironmentPagePayload, UserOut } from '../api/types'
import { contentFieldLabelFor, contentPathFieldLabel } from '../api/contentFieldLabels'
import { revealContentPath } from '../composables/newsContent'
import { environmentPageDraft } from '../composables/environmentPageDraft'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
  await router.push('/content/environment-page')
  await router.isReady()
  const wrapper = mount(EnvironmentPageView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const neverSaved = { id: 'item', kind: 'environment_page', campus_key: null, latest_version: 0, current_published_revision_id: null, latest_revision: null }
const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })
// el-form-item 的錯誤訊息延遲 100ms 才顯示（Element Plus 的 refDebounced）
const settle = async () => { await flushPromises(); await new Promise((done) => setTimeout(done, 150)); await flushPromises() }

/** 依表單標籤找欄位（可限定在某個範圍內）。 */
function field(scope: VueWrapper | ReturnType<VueWrapper['find']>, label: string) {
  const item = scope.findAll('.el-form-item').find((el) => el.find('.el-form-item__label').text() === label)
  if (!item) throw new Error(`找不到欄位「${label}」`)
  return item
}
const meal = (wrapper: VueWrapper, i: number) => wrapper.find(`[data-list="meals"] [data-list-item="${i}"]`)

function mockSave() {
  vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
  return vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
    ...neverSaved, latest_version: 1,
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-12T00:00:00Z', payload: (body as { payload: unknown }).payload, review_status: 'draft' },
  }) as never)
}

describe('常春藤環境頁編輯器：載入與顯示', () => {
  it('從未存過：顯示內建內容、不算未儲存修改；各段與固定數量的清單都在', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('官網目前顯示的是內建內容')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    const values = wrapper.findAll('input, textarea').map((el) => (el.element as HTMLInputElement).value)
    const draft = environmentPageDraft()
    for (const text of [draft.hero_title, draft.care_title, draft.feature.title, draft.meals_title, draft.tour_title, draft.spaces[2]!.campus_label, draft.hearts[4]!, draft.meals[4]!.time]) {
      expect(values, text).toContain(text)
    }
    const counts = Object.fromEntries(['chapter_names', 'hearts', 'care_items', 'spaces', 'meals'].map((k) => [k, wrapper.findAll(`[data-list="${k}"] > [data-list-item]`).length]))
    expect(counts).toEqual({ chapter_names: 4, hearts: 5, care_items: 5, spaces: 6, meals: 5 })
  })

  it('固定數量的清單不能新增、刪除、移動', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    for (const list of wrapper.findAll('[data-list]')) {
      expect(list.findAll('button').filter((b) => /新增|刪除|上移|下移|移除/.test(b.text()) && !/照片|素材/.test(b.text())), list.attributes('data-list')).toEqual([])
    }
  })

  it('十四個照片版位：首屏、保育、主打區、五件小事、六個空間', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.findAllComponents(MediaSlotField)).toHaveLength(14)
  })

  it('從未存過：內建內容沒有一欄超過字數上限（一打開不會有金色提醒）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.findAll('.length-hint').length).toBeGreaterThan(40)
    expect(wrapper.findAll('.length-hint.is-over').map((el) => el.text())).toEqual([])
  })

  it('從未存過：十四張照片各換一次再改回內建，都不算未儲存的修改', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const slots = wrapper.findAllComponents(MediaSlotField)
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

  it('空間照片的校名只在明華校那格有，其餘留空', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const labels = [0, 1, 2, 3, 4, 5].map((i) => (field(wrapper.find(`[data-list="spaces"] [data-list-item="${i}"]`), '照片上的校名').find('input').element as HTMLInputElement).value)
    expect(labels).toEqual(['', '', '明華校', '', '', ''])
  })
})

describe('常春藤環境頁編輯器：改內容與儲存', () => {
  it('改首屏大標、一件小事、一個餐點：送出的內容只這幾處不同，其餘（含五顆心、照片版位）原樣', async () => {
    const post = mockSave()
    const wrapper = await mountAs(superAdmin())
    await field(wrapper, '首屏大標').find('textarea').setValue('孩子的每一天，\n都在這裡開心長大。')
    await field(wrapper, '大標裡畫螢光的字').find('input').setValue('開心')
    await field(wrapper.find('[data-list="care_items"] [data-list-item="1"]'), '名稱').find('input').setValue('營養午餐')
    await field(meal(wrapper, 4), '名稱').find('input').setValue('下午點心')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))!
    const payload = (call[1] as { payload: EnvironmentPagePayload }).payload
    const expected = environmentPageDraft()
    expected.hero_title = '孩子的每一天，\n都在這裡開心長大。'
    expected.hero_highlight = '開心'
    expected.care_items[1]!.title = '營養午餐'
    expected.meals[4]!.name = '下午點心'
    expect(payload).toEqual(expected)
    expect(payload.hearts).toHaveLength(5)
    expect(payload.meals.map((m) => m.time)).toEqual(['08:30', '10:00', '11:40', '12:00', '15:30'])
  })

  it('五顆心逐顆改，章名逐個改', async () => {
    const post = mockSave()
    const wrapper = await mountAs(superAdmin())
    await wrapper.find('[data-list="hearts"] [data-list-item="4"] input').setValue('真心')
    await wrapper.find('[data-list="chapter_names"] [data-list-item="3"] input').setValue('五校')
    await wrapper.findAll('button').find((b) => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    const payload = (post.mock.calls.find(([path]) => String(path).includes('/revisions'))![1] as { payload: EnvironmentPagePayload }).payload
    expect(payload.hearts).toEqual(['愛心', '細心', '耐心', '貼心', '真心'])
    expect(payload.chapter_names).toEqual(['幼兒保育', '校園環境', '幼兒餐點', '五校'])
  })

  it('字數超過上限時欄位下方亮金色提醒（逐行算）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    await field(wrapper, '首屏大標').find('textarea').setValue('孩子的每一天，\n一二三四五六七八九十')
    await flushPromises()
    expect(field(wrapper, '首屏大標').find('.length-hint').classes()).toContain('is-over')
    expect(field(wrapper, '首屏大標').find('.length-hint').text()).toContain('第 2 行 10 字')
  })
})

describe('常春藤環境頁編輯器：即時檢查', () => {
  it('畫螢光的字不在大標裡：提示會被擋下；放回大標提示就消失；留空不提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).not.toContain('大標裡找不到')
    const highlight = field(wrapper, '大標裡畫螢光的字').find('input')
    await highlight.setValue('開心')
    await flushPromises()
    expect(wrapper.text()).toContain('大標裡找不到「開心」')
    expect(wrapper.text()).toContain('存檔會被擋下')
    // 跨了行也算找不到（官網的螢光只畫在同一行）
    await highlight.setValue('，都')
    await flushPromises()
    expect(wrapper.text()).toContain('大標裡找不到「，都」')
    await highlight.setValue('安心')
    await flushPromises()
    expect(wrapper.text()).not.toContain('大標裡找不到')
    await highlight.setValue('')
    await flushPromises()
    expect(wrapper.text()).not.toContain('大標裡找不到')
  })

  it('餐點時間比上一個早：那一個餐點提醒（不擋存檔）；改回來就消失', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.find('[data-list="meals"]').text()).not.toContain('由早到晚')
    await meal(wrapper, 2).find('input').setValue('09:00')
    await settle()
    expect(meal(wrapper, 2).text()).toContain('早到晚')
    expect(meal(wrapper, 2).text()).toContain('香蕉 10:00')
    // 下一個（12:00）比 09:00 晚，不提醒；前一個也不提醒
    expect(meal(wrapper, 3).text()).not.toContain('由早到晚')
    expect(meal(wrapper, 1).text()).not.toContain('由早到晚')
    await meal(wrapper, 2).find('input').setValue('11:40')
    await settle()
    expect(meal(wrapper, 2).text()).not.toContain('由早到晚')
  })

  it('餐點時間和上一個同一時間也提醒', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    await meal(wrapper, 1).find('input').setValue('08:30')
    await settle()
    expect(meal(wrapper, 1).text()).toContain('早餐 08:30')
  })

  it('餐點時間格式錯誤：提醒用 24 小時制；離開欄位時全形、少補零的寫法自動改成 HH:MM', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const input = meal(wrapper, 0).find('input')
    await input.setValue('早上')
    await settle()
    expect(meal(wrapper, 0).text()).toContain('24 小時制')
    await input.setValue('８：０５')
    await input.trigger('blur')
    await settle()
    expect((input.element as HTMLInputElement).value).toBe('08:05')
    expect(meal(wrapper, 0).text()).not.toContain('24 小時制')
    await input.setValue('9:45')
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('09:45')
  })
})

describe('常春藤環境頁編輯器：存檔被擋（422）時定位到欄位', () => {
  it('巢狀清單：spaces[2].note、meals[1].time、care_items[3].text、spaces[2].campus_label', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    const draft = environmentPageDraft()
    for (const [path, value] of [
      [['spaces', 2, 'note'], draft.spaces[2]!.note],
      [['spaces', 2, 'campus_label'], draft.spaces[2]!.campus_label],
      [['spaces', 5, 'title'], draft.spaces[5]!.title],
      [['meals', 1, 'time'], draft.meals[1]!.time],
      [['care_items', 3, 'text'], draft.care_items[3]!.text],
      [['hearts', 2], draft.hearts[2]],
      [['chapter_names', 1], draft.chapter_names[1]],
    ] as const) {
      expect(await revealContentPath(root, path, contentPathFieldLabel('environment_page', path)), path.join('.')).toBe(true)
      expect((document.activeElement as HTMLInputElement | null)?.value, path.join('.')).toBe(value)
    }
  })

  it('巢狀物件：feature.title、feature.tag、feature.note', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    const draft = environmentPageDraft()
    for (const [path, value] of [
      [['feature', 'title'], draft.feature.title],
      [['feature', 'tag'], draft.feature.tag],
      [['feature', 'note'], draft.feature.note],
    ] as const) {
      expect(await revealContentPath(root, path, contentPathFieldLabel('environment_page', path)), path.join('.')).toBe(true)
      expect((document.activeElement as HTMLInputElement | null)?.value, path.join('.')).toBe(value)
    }
  })

  it('整個清單的錯誤（餐點時間沒有由早到晚，loc 只有清單名）：捲到餐點、聚焦第一個時間', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    expect(contentPathFieldLabel('environment_page', ['meals'])).toBe('一天的餐點')
    expect(await revealContentPath(root, ['meals'], '一天的餐點')).toBe(true)
    expect(document.activeElement).toBe(root.querySelector('[data-list="meals"] [data-list-item="0"] input'))
  })

  it('頂層欄位：大標裡畫螢光的字、首屏照片下的一句話', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    const root = wrapper.element as HTMLElement
    const draft = environmentPageDraft()
    for (const [key, value] of [['hero_highlight', draft.hero_highlight], ['hero_caption', draft.hero_caption], ['tour_hint', draft.tour_hint]] as const) {
      expect(await revealContentPath(root, [key], contentPathFieldLabel('environment_page', [key]))).toBe(true)
      expect((document.activeElement as HTMLInputElement | null)?.value, key).toBe(value)
    }
  })
})

describe('常春藤環境頁編輯器：原始碼的約定', () => {
  const source = readFileSync(resolve(__dirname, '../views/EnvironmentPageView.vue'), 'utf8')
  it('每個段落標題有 id、data-section-anchor、tabindex，並傳 sections', () => {
    expect(source).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    for (const k of ['hero', 'chapters', 'care', 'spaces', 'meals', 'tour']) {
      expect(source).toContain(`id="section-env-${k}" class="sub-title" data-section-anchor tabindex="-1"`)
    }
  })

  it('五個清單有 data-list，每項有 data-list-item', () => {
    for (const k of ['chapter_names', 'hearts', 'care_items', 'spaces', 'meals']) expect(source).toContain(`data-list="${k}"`)
    expect(source.match(/:data-list-item="i"/g)).toHaveLength(5)
  })

  it('便條欄位說明換照片後箭頭可能沒指準', () => {
    expect(source).toContain('換照片後')
    expect(source).toContain('箭頭')
  })

  it('欄位名與表單標籤一致', () => {
    const pairs: [string, string][] = [
      ['hero_title', '首屏大標'], ['hero_highlight', '大標裡畫螢光的字'], ['hero_lede', '首屏介紹'], ['hero_notice', '首屏提醒'], ['hero_photo', '首屏照片'],
      ['hero_caption', '首屏照片下的一句話'], ['care_title', '幼兒保育的標題'], ['care_lead', '幼兒保育的引言'], ['care_text', '幼兒保育的說明'],
      ['care_photo', '幼兒保育照片'], ['care_caption', '保育照片下的一句話'], ['care_photo_note', '保育照片上的便條'],
      ['spaces_title', '校園環境的標題'], ['spaces_text', '校園環境的說明'], ['trail_hint', '小腳印提示'], ['meals_title', '幼兒餐點的標題'],
      ['meals_text', '幼兒餐點的說明'], ['meals_day_title', '一天吃什麼的標題'], ['tour_title', '五所校園的標題'], ['tour_text', '五所校園的說明'], ['tour_hint', '五所校園的提示'],
    ]
    for (const [key, label] of pairs) {
      expect(source, label).toContain(`label="${label}"`)
      expect(contentFieldLabelFor('environment_page', key), key).toBe(label)
    }
  })
})
