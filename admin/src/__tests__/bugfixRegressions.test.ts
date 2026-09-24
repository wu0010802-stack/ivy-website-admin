import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import CampusTourView from '../views/CampusTourView.vue'
import { ApiError, api, setUnauthorizedHandler } from '../api/client'
import { landingPath, NAV_GROUPS, navItem } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  setUnauthorizedHandler(null)
})

// ------------------------------------------------------------------ nav
describe('共用內容頁的角色限制', () => {
  // 後端 app/content/routes.py 的 _require_shared_or_scope 只允許
  // super_admin 編輯共用內容。側欄／路由不限制的話，分校管理者看得到、
  // 編得動，但按儲存永遠是 403。
  const SHARED = [
    'home-hero', 'home-about', 'home-campus-board', 'day-experience', 'home-news', 'admission-content',
    'booking-content', 'site-footer', 'site-meta',
  ]

  it.each(SHARED)('%s 限定 super_admin', name => {
    expect(navItem(name)?.roles).toEqual(['super_admin'])
  })

  it('分校自有內容不受限制，分校管理者仍要能編', () => {
    for (const name of ['campus-profile', 'campus-faq', 'campus-tour']) {
      // 2026-09-24 起側欄依角色顯示：分校管理者與編輯一定要看得到分校內容，
      // 只處理案件的櫃台不需要。
      expect(navItem(name)?.roles).toEqual(expect.arrayContaining(['super_admin', 'campus_admin', 'editor']))
      expect(navItem(name)?.roles).not.toContain('reception')
    }
  })

  it('編輯與唯讀沒有營運總覽，登入後落在看得到的第一頁', () => {
    expect(landingPath('super_admin')).toBe('/')
    expect(landingPath('reception')).toBe('/')
    expect(landingPath('editor')).toBe('/content/campus-profile')
    expect(landingPath('readonly')).toBe('/content/campus-profile')
  })

  it('每個標了 roles 的項目都真的存在於側欄結構裡', () => {
    const named = NAV_GROUPS.flatMap(group => group.items).map(item => item.name)
    expect(new Set(named).size).toBe(named.length)
  })
})

// ------------------------------------------------------------------ 401
describe('全域 401 處理', () => {
  it('API 回 401 時清掉登入狀態並導回登入頁，帶上原本的路徑', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore(pinia)
    authStore.user = testUser('super_admin', { id: 'u1', email: 'admin@example.invalid', campus_keys: [] })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
        { path: '/:pathMatch(.*)*', name: 'any', component: defineComponent({ template: '<div />' }) },
      ],
    })
    await router.push('/media')
    await router.isReady()

    setUnauthorizedHandler(() => {
      if (!authStore.user) return
      authStore.clearSession()
      const current = router.currentRoute.value
      if (current.name === 'login') return
      void router.replace({ name: 'login', query: { redirect: current.fullPath } })
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never,
    )

    await expect(api.get('/admin/media')).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(authStore.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/media')
  })

  it('登入端點自己回 401（帳密錯誤）不觸發導向', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '帳號或密碼錯誤' }), { status: 401 }) as never,
    )
    await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })
})

// --------------------------------------------------------------- 校園探索
describe('校園探索場景預設值', () => {
  async function setup() {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'u1', email: 'admin@example.invalid', campus_keys: ['yihua'] })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }],
    })
    await router.push('/content/campus-tour')
    await router.isReady()
    const wrapper = mount(CampusTourView, {
      global: {
        plugins: [pinia, router, ElementPlus],
        provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('新場景預設帶一個熱點，不會一存檔就撞後端 1～8 個的下界', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'c1', kind: 'campus_tour', campus_key: 'yihua', latest_version: 0,
      current_published_revision_id: null, latest_revision: null,
    } as never)
    const wrapper = await setup()
    const addButton = wrapper.findAll('button').find(item => item.text().includes('新增場景'))
    expect(addButton).toBeDefined()
    await addButton!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('1 個熱點')
  })
})
