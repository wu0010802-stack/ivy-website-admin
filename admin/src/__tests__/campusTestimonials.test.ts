/// <reference types="node" />
// 2026-10-12 分校資料加「家長分享影片」（關於頁第四章「家長怎麼說」）：
// testimonials 為 null＝沿用官網內建、[]＝這校不放、最多 4 支。內建清單在後台寫一份
// （campusTestimonialsDraft），這裡逐字比對 web fixture，改了一邊沒改另一邊就會失敗。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import CampusProfileView from '../views/CampusProfileView.vue'
import ContentEditor from '../components/ContentEditor.vue'
import { api } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { TestimonialPayload } from '../api/types'
import { mediaFieldPathLabel } from '../api/labels'
import { contentPathFieldLabel, contentPathLabel } from '../api/contentFieldLabels'
import { revealContentPath } from '../composables/newsContent'
import { TESTIMONIALS_MAX, builtinTestimonialPoster, campusTestimonialsDraft, testimonialUrlError } from '../composables/campusTestimonialsDraft'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8')) as {
  campuses: { key: string; testimonials?: { youtubeId: string; quote: string; speaker: string; poster: string }[] }[]
}

describe('內建清單 campusTestimonialsDraft：和 web fixture 一字不差', () => {
  it('義華的 4 支：影片網址、說的話、稱呼逐支相同，封面留空、封面說明空字串', () => {
    const builtin = fixture.campuses.find((c) => c.key === 'yihua')!.testimonials!
    expect(builtin).toHaveLength(4)
    expect(campusTestimonialsDraft('yihua')).toEqual(
      builtin.map((t) => ({
        youtube_url: `https://www.youtube.com/watch?v=${t.youtubeId}`,
        quote: t.quote,
        speaker: t.speaker,
        poster: null,
        poster_alt: '',
      })),
    )
  })

  it('其他四校 fixture 沒有內建影片，清單是空的', () => {
    for (const key of CAMPUS_KEYS.filter((k) => k !== 'yihua')) {
      expect(fixture.campuses.find((c) => c.key === key)!.testimonials ?? [], key).toEqual([])
      expect(campusTestimonialsDraft(key), key).toEqual([])
    }
    expect(campusTestimonialsDraft('no_such_campus')).toEqual([])
  })

  it('每次回傳新的一份，改動它不會動到下一次的內建清單', () => {
    const first = campusTestimonialsDraft('yihua')
    first[0]!.quote = '被改過'
    first.pop()
    expect(campusTestimonialsDraft('yihua')).toHaveLength(4)
    expect(campusTestimonialsDraft('yihua')[0]!.quote).not.toBe('被改過')
  })

  it('內建封面：影片 id 對得上 fixture 的封面網址，而且檔案在 web/public', () => {
    for (const t of fixture.campuses.find((c) => c.key === 'yihua')!.testimonials!) {
      expect(builtinTestimonialPoster(t.youtubeId)).toBe(t.poster)
      // 官網比對影片 id 不分大小寫（content-overlay.ts 的 builtinPosters）
      expect(builtinTestimonialPoster(t.youtubeId.toLowerCase())).toBe(t.poster)
      expect(existsSync(resolve(ROOT, 'web/public', t.poster.replace(/^\//, ''))), t.poster).toBe(true)
    }
    // 不是內建那幾支：沒有內建封面
    expect(builtinTestimonialPoster('AAAAAAAAAAA')).toBe('')
  })
})

describe('影片網址檢查 testimonialUrlError', () => {
  it('網址或 11 碼影片編號看得出來就沒事；看不出來講「看不出 YouTube 影片編號」', () => {
    expect(testimonialUrlError('https://www.youtube.com/watch?v=oaVMxHvquU0')).toBe('')
    expect(testimonialUrlError('https://youtu.be/oaVMxHvquU0')).toBe('')
    expect(testimonialUrlError('oaVMxHvquU0')).toBe('')
    expect(testimonialUrlError('不是網址')).toBe('看不出 YouTube 影片編號')
    expect(testimonialUrlError('https://example.com/watch?v=oaVMxHvquU0')).toBe('看不出 YouTube 影片編號')
  })

  it('還沒填不提示錯誤（存檔時由後端擋）；超過 300 字另外說', () => {
    expect(testimonialUrlError('')).toBe('')
    expect(testimonialUrlError('   ')).toBe('')
    expect(testimonialUrlError(`https://www.youtube.com/watch?v=oaVMxHvquU0&t=${'1'.repeat(300)}`)).toBe('網址太長，最多 300 字')
  })
})

// ------------------------------------------------------------------ 編輯頁

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const item = (payload: object, campus = 'yihua', version = 1) => ({
  id: `item-${campus}`, kind: 'campus_profile', campus_key: campus, latest_version: version, current_published_revision_id: 'rev-1',
  latest_revision: { id: `rev-${version}`, version, created_at: '2026-10-12T01:00:00Z', payload, review_status: 'draft', review_note: null },
})
const baseProfile = { name: '義華校', district: '三民區', address: '高雄市三民區義華路68號', phone: '07-392-8366' }

async function mountProfile(campus: string, payload: object) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  vi.spyOn(api, 'get').mockImplementation((async (path: string) => (String(path).includes('/content-items/campus_profile') && !String(path).includes('/schedules') && !String(path).includes('/revisions') ? item(payload, campus) : [])) as typeof api.get)
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('campus_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [campus] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(`/?campus=${campus}`)
  await router.isReady()
  const wrapper = mount(CampusProfileView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

// el-form-item 的錯誤訊息延遲 100ms 才顯示（refDebounced）。
async function errorShown() {
  await new Promise((done) => setTimeout(done, 150))
  await flushPromises()
}
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
const listItems = (wrapper: VueWrapper) => wrapper.findAll('[data-list="testimonials"] > [data-list-item]')
function fieldInput(wrapper: VueWrapper, index: number, label: string) {
  const formItem = listItems(wrapper)[index]!.findAll('.el-form-item').find((f) => f.find('.el-form-item__label').text().startsWith(label))
  return formItem!.find<HTMLInputElement>('input, textarea')
}
const editorState = (wrapper: VueWrapper) => wrapper.findComponent(ContentEditor).props('editor') as { form: { value: { testimonials: TestimonialPayload[] | null } } }

describe('分校資料：家長分享影片段落', () => {
  it('段落目錄多一段「家長分享影片」，欄位是 testimonials', async () => {
    const wrapper = await mountProfile('yihua', baseProfile)
    const sections = wrapper.findComponent(ContentEditor).props('sections') as { id: string; label: string; fields?: string[] }[]
    expect(sections.find((s) => s.label === '家長分享影片')?.fields).toEqual(['testimonials'])
    expect(wrapper.find('#section-profile-voices').exists()).toBe(true)
  })

  it('testimonials 是 null（沿用內建）：寫「目前沿用官網內建 4 支」，不列清單；按鈕帶入目前的 4 支', async () => {
    const wrapper = await mountProfile('yihua', baseProfile)
    expect(editorState(wrapper).form.value.testimonials).toBeNull()
    expect(wrapper.text()).toContain('目前沿用官網內建 4 支')
    expect(listItems(wrapper)).toHaveLength(0)
    expect(button(wrapper, '改成自訂（帶入目前的 4 支）')).toBeTruthy()
    expect(button(wrapper, '恢復內建')).toBeUndefined()
  })

  it('舊版本沒有 testimonials 欄也一樣是沿用內建，不算修改', async () => {
    const wrapper = await mountProfile('yihua', baseProfile)
    expect(wrapper.text()).not.toContain('草稿有')
  })

  it('其他校沒有內建影片：寫「目前沿用官網內建：沒有影片」，按鈕不帶數字', async () => {
    const wrapper = await mountProfile('minghua', { ...baseProfile, name: '明華校', testimonials: null })
    expect(wrapper.text()).toContain('目前沿用官網內建：沒有影片')
    expect(wrapper.text()).not.toContain('目前沿用官網內建 0 支')
    expect(button(wrapper, '改成自訂')).toBeTruthy()
  })

  it('按「改成自訂」：帶入內建的 4 支（深拷貝），每支欄位都有值；改動不影響內建清單', async () => {
    const wrapper = await mountProfile('yihua', baseProfile)
    await button(wrapper, '改成自訂（帶入目前的 4 支）')!.trigger('click')
    await flushPromises()

    expect(editorState(wrapper).form.value.testimonials).toEqual(campusTestimonialsDraft('yihua'))
    expect(listItems(wrapper)).toHaveLength(4)
    expect(fieldInput(wrapper, 0, 'YouTube 影片網址').element.value).toBe('https://www.youtube.com/watch?v=oaVMxHvquU0')
    expect(fieldInput(wrapper, 0, '家長說的話').element.value).toBe('老師把孩子放第一，不是把父母放第一。')
    expect(fieldInput(wrapper, 0, '稱呼').element.value).toBe('樂樂媽咪')
    expect(wrapper.text()).toContain('草稿有 1 處修改：家長分享影片')

    await fieldInput(wrapper, 0, '稱呼').setValue('新的稱呼')
    expect(campusTestimonialsDraft('yihua')[0]!.speaker).toBe('樂樂媽咪')
  })

  it('封面沒選時說明「沒選就用內建封面或 YouTube 縮圖」；內建那幾支顯示內建封面的預覽', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: campusTestimonialsDraft('yihua') })
    expect(wrapper.text()).toContain('沒選就用內建封面或 YouTube 縮圖')
    const first = listItems(wrapper)[0]!
    expect(first.find('img').attributes('src')).toBe('/assets/story-yihua-oavmxhvquu0.webp')
  })

  it('已經自訂過的版本載入後直接列出清單，並顯示「恢復內建」', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: campusTestimonialsDraft('yihua').slice(0, 2) })
    expect(listItems(wrapper)).toHaveLength(2)
    expect(wrapper.text()).not.toContain('目前沿用官網內建')
    expect(button(wrapper, '恢復內建')).toBeTruthy()
    expect(wrapper.text()).toContain('2 / 4 支')
  })

  it('YouTube 網址邊打邊檢查：看不出影片編號時欄位下方說明，貼對網址就消失', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: [{ ...campusTestimonialsDraft('yihua')[0]!, youtube_url: '' }] })
    expect(wrapper.text()).not.toContain('看不出 YouTube 影片編號')
    await fieldInput(wrapper, 0, 'YouTube 影片網址').setValue('不是網址')
    await errorShown()
    expect(listItems(wrapper)[0]!.text()).toContain('看不出 YouTube 影片編號')
    await fieldInput(wrapper, 0, 'YouTube 影片網址').setValue('https://youtu.be/oaVMxHvquU0')
    await errorShown()
    expect(listItems(wrapper)[0]!.text()).not.toContain('看不出 YouTube 影片編號')
  })

  it('字數提示：說的話 40 字內、稱呼 20 字內，超過會標紅色提示', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: [campusTestimonialsDraft('yihua')[0]!] })
    expect(listItems(wrapper)[0]!.text()).toContain('建議 40 字內')
    await fieldInput(wrapper, 0, '家長說的話').setValue('字'.repeat(41))
    await fieldInput(wrapper, 0, '稱呼').setValue('名'.repeat(21))
    await flushPromises()
    const hints = listItems(wrapper)[0]!.findAll('.length-hint.is-over')
    expect(hints).toHaveLength(2)
    expect(hints[0]!.text()).toContain('超過建議的 40 字')
    expect(hints[1]!.text()).toContain('超過建議的 20 字')
  })

  it('新增一支加在最後；到 4 支新增鈕停用並寫原因；刪掉一支又能新增', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: campusTestimonialsDraft('yihua').slice(0, 3) })
    expect(button(wrapper, '新增一支影片')!.attributes('disabled')).toBeUndefined()
    await button(wrapper, '新增一支影片')!.trigger('click')
    await flushPromises()
    expect(listItems(wrapper)).toHaveLength(TESTIMONIALS_MAX)
    expect(fieldInput(wrapper, 3, 'YouTube 影片網址').element.value).toBe('')
    expect(fieldInput(wrapper, 3, '家長說的話').element.value).toBe('')
    expect(button(wrapper, '新增一支影片')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('最多 4 支')

    await listItems(wrapper)[0]!.findAll('button').find((b) => b.text() === '移除')!.trigger('click')
    await flushPromises()
    expect(listItems(wrapper)).toHaveLength(3)
    expect(button(wrapper, '新增一支影片')!.attributes('disabled')).toBeUndefined()
  })

  it('上移、下移：第一支不能上移、最後一支不能下移；移動後順序跟著改', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: campusTestimonialsDraft('yihua').slice(0, 3) })
    const first = listItems(wrapper)[0]!.findAll('button')
    expect(first.find((b) => b.text() === '上移')!.attributes('disabled')).toBeDefined()
    expect(listItems(wrapper)[2]!.findAll('button').find((b) => b.text() === '下移')!.attributes('disabled')).toBeDefined()
    await first.find((b) => b.text() === '下移')!.trigger('click')
    await flushPromises()
    expect(editorState(wrapper).form.value.testimonials!.map((t) => t.speaker)).toEqual(['榕榕媽咪', '樂樂媽咪', '祈祈爸比'])
  })

  it('清空成 []：寫「官網關於頁不會出現這校的影片」，仍可新增', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: [campusTestimonialsDraft('yihua')[0]!] })
    expect(wrapper.text()).not.toContain('官網關於頁不會出現這校的影片')
    await listItems(wrapper)[0]!.findAll('button').find((b) => b.text() === '移除')!.trigger('click')
    await flushPromises()
    expect(editorState(wrapper).form.value.testimonials).toEqual([])
    expect(wrapper.text()).toContain('官網關於頁不會出現這校的影片')
    expect(button(wrapper, '新增一支影片')!.attributes('disabled')).toBeUndefined()
  })

  it('從沒有內建影片的校改成自訂：得到 []，同樣說明不會出現影片', async () => {
    const wrapper = await mountProfile('minghua', { ...baseProfile, name: '明華校' })
    await button(wrapper, '改成自訂')!.trigger('click')
    await flushPromises()
    expect(editorState(wrapper).form.value.testimonials).toEqual([])
    expect(wrapper.text()).toContain('官網關於頁不會出現這校的影片')
  })

  it('「恢復內建」要先確認；確認後 testimonials 設回 null、自訂內容不見；取消則維持原樣', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: [{ ...campusTestimonialsDraft('yihua')[0]!, quote: '我自己寫的話' }] })
    const confirm = vi.spyOn(ElMessageBox, 'confirm')

    confirm.mockRejectedValueOnce('cancel')
    await button(wrapper, '恢復內建')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0]![0])).toContain('自訂')
    expect(editorState(wrapper).form.value.testimonials).toHaveLength(1)
    expect(listItems(wrapper)).toHaveLength(1)

    confirm.mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '恢復內建')!.trigger('click')
    await flushPromises()
    expect(editorState(wrapper).form.value.testimonials).toBeNull()
    expect(wrapper.text()).toContain('目前沿用官網內建 4 支')
    expect(listItems(wrapper)).toHaveLength(0)
  })

  it('存草稿：自訂的清單原樣送出；恢復內建後送 null', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: [{ ...campusTestimonialsDraft('yihua')[0]!, quote: '我自己寫的話' }] })
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => item((body as { payload: object }).payload, 'yihua', 2) as never)
    await fieldInput(wrapper, 0, '稱呼').setValue('小明媽咪')
    await button(wrapper, '儲存草稿')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    const sent = (post.mock.calls[0]![1] as { payload: { testimonials: TestimonialPayload[] | null } }).payload.testimonials
    expect(sent).toEqual([
      { youtube_url: 'https://www.youtube.com/watch?v=oaVMxHvquU0', quote: '我自己寫的話', speaker: '小明媽咪', poster: null, poster_alt: '' },
    ])

    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await button(wrapper, '恢復內建')!.trigger('click')
    await flushPromises()
    await button(wrapper, '儲存草稿')!.trigger('click')
    await flushPromises()
    expect((post.mock.calls[1]![1] as { payload: { testimonials: unknown } }).payload.testimonials).toBeNull()
  })

  it('唯讀的人：按鈕都停用、輸入框唯讀', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => (String(path).includes('/content-items/campus_profile') && !String(path).includes('/schedules') && !String(path).includes('/revisions') ? item({ ...baseProfile, testimonials: campusTestimonialsDraft('yihua').slice(0, 2) }) : [])) as typeof api.get)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('readonly', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/?campus=yihua')
    await router.isReady()
    const wrapper = mount(CampusProfileView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(listItems(wrapper)).toHaveLength(2)
    for (const label of ['新增一支影片', '恢復內建']) expect(button(wrapper, label)!.attributes('disabled'), label).toBeDefined()
    expect(listItems(wrapper)[0]!.findAll('button').filter((b) => ['上移', '下移', '移除'].includes(b.text())).every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })
})

describe('存檔被擋下時定位到第 N 支', () => {
  it('422 的位置寫成「家長分享影片第 2 支・家長說的話」，欄位標籤對得上表單', () => {
    expect(contentPathLabel('campus_profile', ['testimonials', 1, 'quote'])).toBe('家長分享影片第 2 支・家長說的話')
    expect(contentPathLabel('campus_profile', ['testimonials', 0, 'youtube_url'])).toBe('家長分享影片第 1 支・YouTube 影片網址')
    expect(contentPathLabel('campus_profile', ['testimonials', 3, 'speaker'])).toBe('家長分享影片第 4 支・稱呼')
    expect(contentPathLabel('campus_profile', ['testimonials', 2, 'poster_alt'])).toBe('家長分享影片第 3 支・封面說明')
    expect(contentPathLabel('campus_profile', ['testimonials'])).toBe('家長分享影片')
    expect(contentPathFieldLabel('campus_profile', ['testimonials', 1, 'quote'])).toBe('家長說的話')
    expect(contentPathFieldLabel('campus_profile', ['testimonials', 1, 'youtube_url'])).toBe('YouTube 影片網址')
  })

  it('封面素材的引用位置（素材被誰用、影片欄位選到影片）寫成「第 N 支家長分享影片的封面」', () => {
    expect(mediaFieldPathLabel('testimonials[1].poster.media_id')).toBe('第 2 支家長分享影片的封面')
    expect(mediaFieldPathLabel('testimonials[0].poster.media_id')).toBe('第 1 支家長分享影片的封面')
  })

  it('點錯誤清單會捲到第 N 支的那一欄並聚焦', async () => {
    const wrapper = await mountProfile('yihua', { ...baseProfile, testimonials: campusTestimonialsDraft('yihua').slice(0, 3) })
    Element.prototype.scrollIntoView = () => {}
    const root = wrapper.element as HTMLElement
    const path = ['testimonials', 1, 'quote']
    expect(await revealContentPath(root, path, contentPathFieldLabel('campus_profile', path))).toBe(true)
    expect(document.activeElement).toBe(fieldInput(wrapper, 1, '家長說的話').element)

    // 只指到清單（例如整份超過 4 支）：停在清單上，不報錯
    expect(await revealContentPath(root, ['testimonials'], '家長分享影片')).toBe(true)
  })
})

describe('發布前的差異摘要', () => {
  it('沿用內建 → 自訂 → 清空：欄位值寫得出是哪一種，不是兩邊都空白', async () => {
    const { diffPayload } = await import('../composables/useContentItem')
    const builtin = campusTestimonialsDraft('yihua')
    const [change] = diffPayload({ testimonials: null }, { testimonials: builtin }, 'campus_profile')
    expect(change).toMatchObject({ label: '家長分享影片', before: '沿用官網內建', after: '4 支' })
    expect(change!.detail).toContain('樂樂媽咪')
    const [cleared] = diffPayload({ testimonials: builtin }, { testimonials: [] }, 'campus_profile')
    expect(cleared).toMatchObject({ before: '4 支', after: '這校不放影片' })
    const [restored] = diffPayload({ testimonials: [] }, { testimonials: null }, 'campus_profile')
    expect(restored).toMatchObject({ before: '這校不放影片', after: '沿用官網內建' })
  })
})
