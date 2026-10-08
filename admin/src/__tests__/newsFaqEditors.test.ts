// 消息與活動（全站、各校）的後台編輯（2026-09-25 缺口 B07）。常見問題已於 2026-10-08 刪除，
// 檔名保留，只留下「舊紀錄仍認得中文名稱、舊連結仍會轉址」的檢查。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import HomeNewsView from '../views/HomeNewsView.vue'
import CampusNewsView from '../views/CampusNewsView.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { CONTENT_KIND_LABELS, contentEditorPath, contentPreviewPath, contentPublicPath } from '../api/labels'
import { NAV_GROUPS } from '../router/nav'
import {
  eventTimeError,
  legacyScope,
  newCampusEvent,
  normalizeArticle,
  normalizeCampusArticle,
  normalizeEvent,
  scopeLabel,
  webUrlError,
  webUrlInvalid,
} from '../composables/newsContent'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountAs(component: unknown, user: UserOut, path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
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

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid' })

describe('消息欄位的預設值與檢查', () => {
  it('舊版手打的校區文字換成適用範圍（同後端）', () => {
    expect(legacyScope('義華校')).toEqual({ scope: 'campus', campus_keys: ['yihua'] })
    expect(legacyScope('全校')).toEqual({ scope: 'global', campus_keys: [] })
    expect(legacyScope('親子館')).toEqual({ scope: 'global', campus_keys: [] })
    const article = normalizeArticle({ id: 'a', date: '2026-10-01', campus: '仁武校', title: 't', description: 'd', image: 'x', alt: '', category: '' })
    expect(article).toMatchObject({ scope: 'campus', campus_keys: ['renwu'], featured: false, body: [] })
    expect(article).not.toHaveProperty('campus')
    expect(normalizeEvent({ id: 'e', date: '2026-10-01', campus: '全校', title: 't', description: '' })).toMatchObject({
      scope: 'global', all_day: true, start_time: null, location: '', link_url: '', link_label: '',
    })
  })

  it('各校消息不帶適用範圍與推薦', () => {
    const own = normalizeCampusArticle({ id: 'a', scope: 'global', campus_keys: [], featured: true } as never)
    expect(own).not.toHaveProperty('scope')
    expect(own).not.toHaveProperty('featured')
  })

  it('校區文字、活動時間與連結檢查', () => {
    expect(scopeLabel({ scope: 'campus', campus_keys: ['yihua', 'renwu'] })).toBe('義華校、仁武校')
    expect(scopeLabel({ scope: 'global', campus_keys: [] })).toBe('全校')
    const event = newCampusEvent()
    expect(eventTimeError(event)).toBe('')
    event.all_day = false
    expect(eventTimeError(event)).toBe('不是全天的活動要填開始時間')
    event.start_time = '10:00'
    event.end_time = '09:00'
    expect(eventTimeError(event)).toBe('結束時間要晚於開始時間')
    expect(webUrlInvalid('')).toBe(false)
    expect(webUrlInvalid('https://example.com/a')).toBe(false)
    for (const bad of ['example.com', 'mailto:a@b.c', 'javascript:alert(1)']) expect(webUrlInvalid(bad)).toBe(true)
  })

  it('網址中間有空白（含全形空白）要提示，跟後端與官網同一個規則', () => {
    expect(webUrlError(' https://example.com/a ')).toBe('')
    for (const spaced of ['https://a b', 'https://example.com/a\u3000b', 'http://a\u00a0b']) {
      expect(webUrlInvalid(spaced)).toBe(true)
      expect(webUrlError(spaced)).toBe('網址中間不能有空白')
    }
    expect(webUrlError('example.com')).toBe('網址要以 https:// 或 http:// 開頭')
    expect(webUrlError('https://')).toBe('網址要以 https:// 或 http:// 開頭')
  })

  it('側欄、編輯頁路由與官網位置', () => {
    const campus = NAV_GROUPS.find((group) => group.key === 'campus')!
    const news = campus.items.find((item) => item.name === 'campus-news')!
    // 官網已沒有顯示常見問題的頁面，側欄不再列各校／共用常見問題。
    expect(campus.items.map((item) => item.name)).not.toEqual(expect.arrayContaining(['campus-faq']))
    expect(campus.items.some((item) => item.name === 'shared-faq')).toBe(false)
    expect(news.path).toBe('/content/campus-news')
    expect(news.roles).toContain('campus_admin')
    expect(news.roles).toContain('editor')
    // 常見問題功能已刪除，舊操作紀錄與舊發布紀錄裡的 kind 仍顯示中文名稱。
    expect(CONTENT_KIND_LABELS.shared_faq).toBe('共用常見問題')
    expect(CONTENT_KIND_LABELS.campus_faq).toBe('各校常見問題')
    expect(CONTENT_KIND_LABELS.campus_news).toBe('各校消息與活動')
    expect(contentEditorPath('campus_news', 'minghua')).toBe('/content/campus-news?campus=minghua')
    expect(contentPublicPath('campus_news', 'minghua')).toBe('/')
    expect(contentPreviewPath('campus_news', 'minghua')).toBe('/preview')
  })
})

describe('全站消息編輯頁', () => {
  it('舊版內容打開不算修改；看得到適用校區、首頁推薦與顯示筆數', async () => {
    const legacy = {
      sample_note: '',
      articles: [{ id: 'a1', date: '2026-10-01', campus: '義華校', category: '日常', title: '菜園', description: '摘要', image: 'garden', alt: '' }],
      events: [{ id: 'e1', date: '2099-10-03', campus: '全校', title: '開放日', description: '' }],
    }
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', legacy) as never)
    const wrapper = await mountAs(HomeNewsView, superAdmin(), '/content/home-news')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('首頁最多輪播幾則消息')
    expect(wrapper.text()).toContain('首頁推薦（首頁只輪播推薦的消息）')
    const campusRadio = wrapper.findAll('input[type="radio"][value="campus"]')[0]!
    expect((campusRadio.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('地點（選填）')
    expect(wrapper.text()).toContain('相關連結（選填，例如報名表或活動詳情）')

    // 勾首頁推薦後變成有修改。
    await wrapper.findAll('input[type="checkbox"]').find((input) => input.element.closest('label')?.textContent?.includes('首頁推薦'))!.setValue(true)
    expect(wrapper.text()).toContain('有未儲存的修改')
    expect(wrapper.text()).toContain('目前推薦 1 則')
  })

  it('內文可以加段落、小標、清單、圖片與連結', async () => {
    const payload = { sample_note: '', articles: [normalizeArticle({ id: 'a1', date: '2026-10-01', title: 't', description: 'd', image: 'garden', alt: '', category: '' })], events: [], home_display_count: null }
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', payload) as never)
    const wrapper = await mountAs(HomeNewsView, superAdmin(), '/content/home-news')
    for (const label of ['段落', '小標', '清單', '圖片', '連結']) {
      await wrapper.findAll('.news-body__add button').find((button) => button.text() === label)!.trigger('click')
    }
    expect(wrapper.findAll('.news-body__block').map((block) => block.get('.news-body__type').text())).toEqual(['段落', '小標', '清單', '圖片', '連結'])
    expect(wrapper.text()).toContain('請從素材庫選一張圖片')
  })
})

describe('各校消息編輯頁', () => {
  it('分校管理者只看到自己校，沒有適用校區與首頁推薦', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(contentItem('campus_news', { articles: [], events: [] }, 'minghua') as never)
    const admin = testUser('campus_admin', { campus_keys: ['minghua'] })
    const wrapper = await mountAs(CampusNewsView, admin, '/content/campus-news')
    expect(get.mock.calls.some(([path]) => path === '/admin/content-items/campus_news?campus_key=minghua')).toBe(true)
    await wrapper.findAll('button').find((button) => button.text() === '新增一則消息')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '新增一筆活動')!.trigger('click')
    expect(wrapper.text()).not.toContain('適用校區')
    expect(wrapper.text()).not.toContain('首頁推薦')
    expect(wrapper.text()).toContain('內文（選填')
  })
})
