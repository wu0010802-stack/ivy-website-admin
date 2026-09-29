// 2026-09-29 業主裁定（後台雜項）：側欄只有參觀案件掛數字；官網刻意不顯示的三個欄位
// 不再列出、但存檔照原樣送回；預約橫幅接上官網後的標題預覽與「插入校名」；
// 「全站設定」改名「個資與搜尋設定」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { bannerTitlePreview, BANNER_CAMPUS_TOKEN, BANNER_DEFAULTS, LENGTH_HINTS } from '../composables/contentHints'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { NAV_GROUPS, navItem } from '../router/nav'
import AdminSidebar from '../components/AdminSidebar.vue'
import BookingContentView from '../views/BookingContentView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import HomeCampusBoardView from '../views/HomeCampusBoardView.vue'
import { useAuthStore } from '../stores/auth'
import { ROLE_CAPABILITIES, testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  // 字表讀不到就不提示；這裡不管缺字，一律回 404。
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

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid' })

async function mountView(component: unknown, user: UserOut = superAdmin()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
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

/** 內容讀取回 payload，其他 GET（素材、排程…）回空的。 */
function mockContent(kind: string, payload: unknown, campusKey: string | null = null) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => (String(path).includes(`/content-items/${kind}`) ? contentItem(kind, payload, campusKey) : []) as never)
}

/** 按「儲存草稿」，回傳送出的 payload。 */
async function savedPayload(wrapper: VueWrapper, kind: string): Promise<Record<string, unknown>> {
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => contentItem(kind, (body as { payload: unknown }).payload) as never)
  await wrapper.findAll('button').find((button) => button.text() === '儲存草稿')!.trigger('click')
  await flushPromises()
  const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))
  expect(call).toBeDefined()
  return (call![1] as { payload: Record<string, unknown> }).payload
}

const labels = (wrapper: VueWrapper) => wrapper.findAll('.el-form-item__label').map((label) => label.text())

describe('側欄只有參觀案件掛數字', () => {
  it('導覽結構裡只有參觀案件帶待辦數字，站內通知與發布紀錄不帶', () => {
    const withBadge = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.badge)
    expect(withBadge.map((item) => item.name)).toEqual(['visit-requests'])
    expect(navItem('notifications')!.badge).toBeUndefined()
    expect(navItem('releases')!.badge).toBeUndefined()
  })
})

describe('「全站設定」改名「個資與搜尋設定」', () => {
  it('頁名（頁首、分頁標題、麵包屑都從這裡取）改了，搜舊名還找得到', async () => {
    const policies = navItem('policies')!
    expect(policies.title).toBe('個資與搜尋設定')
    expect(policies.keywords).toContain('全站設定')

    const pinia = createPinia()
    useAuthStore(pinia).user = superAdmin()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/')
    await router.isReady()
    const sidebar = mount(AdminSidebar, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(sidebar)
    expect(sidebar.text()).toContain('個資與搜尋設定')
    expect(sidebar.text()).not.toContain('全站設定')
    await sidebar.get('input').setValue('全站設定')
    expect(sidebar.findAll('.sidebar__nav a').map((link) => link.text())).toEqual(['個資與搜尋設定'])
  })
})

describe('官網不顯示的欄位：不列出來，存檔照原樣送回', () => {
  it('孩子的一天：照片補充字不列，舊卡片的補充字存檔時保留；新卡片存空字串', async () => {
    const moment = (key: string, caption: string) => ({ key, time: '08:05', label: '早安', caption, title: '早安', story: '', question: '', answer: '' })
    mockContent('day_experience', {
      eyebrow: '', eyebrow_en: '', note: '', source_note: '影片攝於義華校',
      moments: [moment('hello', '舊的補充字'), moment('lunch', '午餐補充字')],
    })
    const wrapper = await mountView(DayExperienceView)
    expect(labels(wrapper)).not.toContain('照片補充字')
    expect(wrapper.html()).not.toContain('舊的補充字')

    await wrapper.findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '說明文字')!.get('textarea').setValue('新的說明')
    await wrapper.findAll('button').find((button) => button.text() === '新增一張時刻卡')!.trigger('click')
    const payload = await savedPayload(wrapper, 'day_experience')
    expect(payload.note).toBe('新的說明')
    expect(payload.source_note).toBe('影片攝於義華校')
    expect((payload.moments as { caption: string }[]).map((m) => m.caption)).toEqual(['舊的補充字', '午餐補充字', ''])
  })

  it('首頁五校區塊：說明文字不列，存檔時保留', async () => {
    mockContent('home_campus_board', { section_title: '分校資訊', eyebrow: 'CAMPUSES', note: '舊的五校說明' })
    const wrapper = await mountView(HomeCampusBoardView)
    expect(labels(wrapper)).not.toContain('說明文字')

    await wrapper.findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '區塊標題')!.get('input').setValue('五校資訊')
    const payload = await savedPayload(wrapper, 'home_campus_board')
    expect(payload.section_title).toBe('五校資訊')
    expect(payload.note).toBe('舊的五校說明')
  })

  it('五校介紹：Facebook 備註不列，存檔時保留', async () => {
    mockContent('campus_profile', {
      name: '義華校', district: '三民區', address: '地址', phone: '07', intro: '', description: '',
      facebook: 'https://www.facebook.com/ivy.kids.fb/', fb_note: '義華校粉絲專頁', line: '', map_url: '',
    }, 'yihua')
    const wrapper = await mountView(CampusProfileView, testUser('campus_admin', { campus_keys: ['yihua'] }))
    expect(labels(wrapper)).not.toContain('Facebook 備註')
    expect(wrapper.find('input[placeholder="例如：活動照片與公告"]').exists()).toBe(false)

    await wrapper.get('input[inputmode="tel"]').setValue('07-392-8366')
    const payload = await savedPayload(wrapper, 'campus_profile')
    expect(payload.phone).toBe('07-392-8366')
    expect(payload.fb_note).toBe('義華校粉絲專頁')
  })
})

describe('分校頁底部的預約橫幅', () => {
  const booking = (overrides: Record<string, unknown> = {}) => ({
    cta_label: '', cta_label_en: '', consent_text: '', banner_title_template: '', banner_body: '', banner_button_label: '',
    privacy_title: '', privacy_sections: [], ...overrides,
  })
  const titleField = (wrapper: VueWrapper) => wrapper.findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === '橫幅標題')!
  const preview = (wrapper: VueWrapper) => wrapper.get('[data-banner-preview]').text()

  it('預覽用看得到的第一校換掉校名記號，留空時預覽原本的標題', async () => {
    mockContent('booking_content', booking({ banner_title_template: '親自走一趟，感受{campusNameOrIvy}的日常。' }))
    const wrapper = await mountView(BookingContentView)
    expect(preview(wrapper)).toBe('義華校分校頁會顯示：親自走一趟，感受義華校的日常。')
    // 字數以換成校名之後的長度算（15 字），不是含大括號的原文。
    expect(titleField(wrapper).find('.length-hint').text()).toBe('15 字・建議 24 字內')

    await titleField(wrapper).get('textarea').setValue('')
    expect(preview(wrapper)).toBe('留空時沿用原本的標題，義華校分校頁會顯示：親自走一趟，感受義華校的日常。')
    expect(titleField(wrapper).find('.length-hint').text()).toBe('建議 24 字內')
    expect(wrapper.text()).not.toContain('官網目前沒有顯示這一欄')
  })

  it('分校帳號（有全站共用內容授權）預覽自己那一校', async () => {
    mockContent('booking_content', booking({ banner_title_template: '歡迎來{campusNameOrIvy}走走' }))
    const user = testUser('campus_admin', { campus_keys: ['renwu'], effective_capabilities: [...ROLE_CAPABILITIES.campus_admin, 'content.shared'] })
    const wrapper = await mountView(BookingContentView, user)
    expect(preview(wrapper)).toBe('仁武校分校頁會顯示：歡迎來仁武校走走')
  })

  it('「插入校名」在游標位置放入記號，游標停在記號後面；存檔送出的是記號', async () => {
    mockContent('booking_content', booking({ banner_title_template: '親自走一趟，感受的日常。' }))
    const wrapper = await mountView(BookingContentView)
    const textarea = titleField(wrapper).get('textarea').element as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(8, 8)
    await wrapper.findAll('button').find((button) => button.text() === '插入校名')!.trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('親自走一趟，感受{campusNameOrIvy}的日常。')
    expect(textarea.selectionStart).toBe(8 + BANNER_CAMPUS_TOKEN.length)
    expect(document.activeElement).toBe(textarea)
    expect(preview(wrapper)).toBe('義華校分校頁會顯示：親自走一趟，感受義華校的日常。')

    const payload = await savedPayload(wrapper, 'booking_content')
    expect(payload.banner_title_template).toBe('親自走一趟，感受{campusNameOrIvy}的日常。')
  })

  it('內文與按鈕寫出留空時官網的文字；唯讀帳號看得到預覽、沒有插入鈕', async () => {
    mockContent('booking_content', booking({ banner_title_template: '親自走一趟，感受{campusNameOrIvy}的日常。' }))
    const wrapper = await mountView(BookingContentView, testUser('readonly', { campus_keys: ['yihua'] }))
    expect(wrapper.findAll('button').some((button) => button.text() === '插入校名')).toBe(false)
    expect(preview(wrapper)).toBe('義華校分校頁會顯示：親自走一趟，感受義華校的日常。')
    expect(wrapper.text()).toContain(`留空時官網用原本的內文：${BANNER_DEFAULTS.body}`)
    expect(wrapper.text()).toContain(`留空時官網用原本的按鈕文字：${BANNER_DEFAULTS.button}`)
  })

  it('預覽規則：兩種校名記號都換、校名裡的特殊字元照原樣；字數建議有上限', () => {
    expect(bannerTitlePreview('歡迎預約參觀{campus}', '明華校')).toBe('歡迎預約參觀明華校')
    expect(bannerTitlePreview('{campusNameOrIvy}・{campusNameOrIvy}', '$&校')).toBe('$&校・$&校')
    expect(bannerTitlePreview('   ', '國際校')).toBe('親自走一趟，感受國際校的日常。')
    expect(LENGTH_HINTS.bannerTitle.max).toBeGreaterThanOrEqual(Array.from('親自走一趟，感受義華校的日常。').length)
    expect(LENGTH_HINTS.bannerBody.max).toBeGreaterThanOrEqual(Array.from(BANNER_DEFAULTS.body).length)
    expect(LENGTH_HINTS.bannerButton.max).toBeGreaterThanOrEqual(Array.from(BANNER_DEFAULTS.button).length)
  })
})
