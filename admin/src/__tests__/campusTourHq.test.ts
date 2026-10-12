import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import CampusTourView from '../views/CampusTourView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import MediaRefField from '../components/MediaRefField.vue'
import { api } from '../api/client'
import { CAMPUS_KEYS, type UserOut } from '../api/types'
import { contentPreviewPath, contentPublicPath } from '../api/labels'
import { canSeeNavItem, navItem } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 2026-10-05 校園探索（官網環境頁「五所校園」）改由總部帳號直接控制：
// 總管理者與有「全站共用內容」授權的人五校都能改，分校帳號連自己校的也不能改。

// 正式站的建置：VITE_WEBSITE_ASSET_BASE 是空字串（後台與官網同源），預覽欄才會出現。
vi.mock('../config', () => ({ WEBSITE_ASSET_BASE: '', websiteAssetUrl: (key: string) => `/assets/${key}.webp` }))

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const campusAdmin = (shared = false) => testUser('campus_admin', {
  id: 'ca', email: 'ca@ivy.example', campus_keys: ['yihua'],
  capabilities: shared ? ['content.shared'] : [],
  effective_capabilities: [...testUser('campus_admin').effective_capabilities, ...(shared ? ['content.shared'] : [])],
})

async function mountTour(user: UserOut, path = '/content/campus-tour') {
  vi.spyOn(api, 'get').mockResolvedValue({
    id: 'c1', kind: 'campus_tour', campus_key: 'yihua', latest_version: 1, current_published_revision_id: 'r1',
    latest_revision: { id: 'r1', version: 1, review_status: 'draft', payload: { scenes: [{ key: 'hall', name: '大廳', image: 'campus', intro: '介紹' }] } },
  } as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(CampusTourView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('校園探索由總部管理', () => {
  it('側欄與路由：只有總管理者與有全站共用內容授權的人看得到', () => {
    const item = navItem('campus-tour')!
    expect(canSeeNavItem(item, testUser('super_admin'))).toBe(true)
    expect(canSeeNavItem(item, campusAdmin(true))).toBe(true)
    expect(canSeeNavItem(item, campusAdmin())).toBe(false)
    expect(canSeeNavItem(item, testUser('editor', { campus_keys: ['yihua'] }))).toBe(false)
    expect(canSeeNavItem(item, testUser('readonly', { campus_keys: ['yihua'] }))).toBe(false)
  })

  it('查看官網與草稿預覽都開常春藤環境頁', () => {
    expect(contentPublicPath('campus_tour', 'yihua')).toBe('/environment#campuses')
    expect(contentPreviewPath('campus_tour', 'yihua')).toBe('/preview?page=environment')
  })

  it('有授權的分校管理者五校都能切換、能編輯；別校的素材只挑跨校共用的', async () => {
    const { wrapper, router } = await mountTour(campusAdmin(true))
    expect(wrapper.findComponent(CampusSelect).props('keys')).toEqual([...CAMPUS_KEYS])
    expect(wrapper.text()).toContain('新增場景')
    expect(wrapper.findComponent(MediaRefField).props('campusKey')).toBe('yihua')
    await router.push('/content/campus-tour?campus=minghua')
    await flushPromises()
    expect(wrapper.findComponent(MediaRefField).props('campusKey')).toBeUndefined()
  })

  it('進三欄版面：右側預覽常春藤環境頁「五所校園」一章；表單區在預覽欄下改成上下排，不擠在 640 寬的欄裡', async () => {
    const { wrapper } = await mountTour(testUser('super_admin'))
    expect(wrapper.get('.editor').classes()).toContain('editor--preview')
    expect(wrapper.get('.editor__layout').classes()).toContain('has-preview')
    const pane = wrapper.get('aside.editor__preview')
    expect(pane.attributes('aria-label')).toBe('官網預覽')
    expect(pane.text()).toContain('常春藤環境頁的五所校園')
    expect(pane.get('iframe').attributes('src')).toBe(`${window.location.origin}/preview?embed=1&live=1&page=environment`)
    // 路徑要走變數：Vite 會把字面的 new URL('…', import.meta.url) 當成素材網址改寫，讀不到檔案。
    const viewPath = '../views/CampusTourView.vue'
    const source = readFileSync(fileURLToPath(new URL(viewPath, import.meta.url)), 'utf8')
    expect(source).not.toContain('不放預覽欄')
    expect(source).toMatch(/\.editor--preview \.tour__grid \{\s*grid-template-columns: minmax\(0, 1fr\);/)
  })

  it('沒有授權的分校帳號（直接開網址）只能看', async () => {
    const { wrapper } = await mountTour(campusAdmin())
    expect(wrapper.text()).not.toContain('新增場景')
    expect(wrapper.find('.editor__actions').exists()).toBe(false)
  })
})
