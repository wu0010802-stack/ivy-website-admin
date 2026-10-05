// 2026-09-29 業主裁定（後台雜項）：側欄只有參觀案件掛數字；官網刻意不顯示的三個欄位
// 不再列出、但存檔照原樣送回；「全站設定」改名「個資與搜尋設定」。（預約橫幅的標題
// 預覽隨官網分校頁拿掉，2026-10-04 連規則函式一起刪除。）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { NAV_GROUPS, navItem } from '../router/nav'
import AdminSidebar from '../components/AdminSidebar.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import HomeCampusBoardView from '../views/HomeCampusBoardView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
    expect(labels(wrapper)).not.toContain('影片來源標註')
    expect(wrapper.html()).not.toContain('舊的補充字')
    expect(wrapper.html()).not.toContain('影片攝於義華校')

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
