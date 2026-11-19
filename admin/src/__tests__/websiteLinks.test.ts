// 2026-11-13 後台搬到獨立子網域（admin.ivykidschool.com）之後，後台主機的「/」會被 web 轉回
// /admin/（web/server/utils/admin-host.ts），頁首「查看官網」與首頁內容的「查看官網此頁」用相對路徑
// 就開回後台自己。官網的 origin 由 /auth/login、/auth/me 的 features.public_site_origin 帶來。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminLayout from '../layouts/AdminLayout.vue'
import { useContentItem } from '../composables/useContentItem'
import { websitePageUrl } from '../composables/websiteLinks'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import { testUser } from './fixtures'

// 正式站用 VITE_WEBSITE_ASSET_BASE= 空字串建置：素材與草稿預覽仍走後台自己的主機。
vi.mock('../config', () => ({
  WEBSITE_ASSET_BASE: '',
  websiteAssetUrl: (key: string) => `/assets/${key}.webp`,
}))

const PUBLIC = 'https://www.ivy.example'
const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

function signedIn(publicSiteOrigin: string | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore(pinia)
  auth.user = testUser('super_admin')
  auth.features = { admissions: false, password_reset_email: false, public_site_origin: publicSiteOrigin }
  return { pinia, auth }
}

describe('websitePageUrl', () => {
  it('沒有官網 origin（後台與官網同網域）時照舊用相對路徑', () => {
    expect(websitePageUrl('/', null)).toBe('/')
    expect(websitePageUrl('/', undefined)).toBe('/')
    expect(websitePageUrl('/about', null)).toBe('/about')
  })

  it('有官網 origin 時組成絕對網址，結尾斜線不會變成兩條', () => {
    expect(websitePageUrl('/', PUBLIC)).toBe(`${PUBLIC}/`)
    expect(websitePageUrl('/#campuses', `${PUBLIC}/`)).toBe(`${PUBLIC}/#campuses`)
    expect(websitePageUrl('/visit/yihua', PUBLIC)).toBe(`${PUBLIC}/visit/yihua`)
  })
})

describe('頁首「查看官網」', () => {
  async function mountLayout(publicSiteOrigin: string | null) {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const { pinia } = signedIn(publicSiteOrigin)
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: AdminLayout, children: [{ path: ':rest(.*)*', component: { render: () => h('div') } }] },
      { path: '/login', name: 'login', component: { render: () => h('div') } },
    ] })
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('後台在獨立子網域時開官網首頁的絕對網址，不是會被轉回後台的「/」', async () => {
    const wrapper = await mountLayout(PUBLIC)
    expect(wrapper.get('a.top__site').attributes('href')).toBe(`${PUBLIC}/`)
  })

  it('登入後才拿到官網 origin 也會跟著更新', async () => {
    const wrapper = await mountLayout(null)
    expect(wrapper.get('a.top__site').attributes('href')).toBe('/')
    useAuthStore().features = { admissions: false, password_reset_email: false, public_site_origin: PUBLIC }
    await flushPromises()
    expect(wrapper.get('a.top__site').attributes('href')).toBe(`${PUBLIC}/`)
  })
})

describe('內容編輯頁的官網連結', () => {
  function editorFor(kind: string, publicSiteOrigin: string | null, campusKey?: string) {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const { pinia } = signedIn(publicSiteOrigin)
    let editor!: ReturnType<typeof useContentItem<{ title: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem(kind, { title: '' }, campusKey); return () => null } })
    wrappers.push(mount(Harness, { global: { plugins: [pinia] } }))
    return editor
  }

  it('首頁內容與五校介紹（/、/#campuses）在獨立子網域時連到官網', () => {
    expect(editorFor('home_hero', PUBLIC).publicUrl.value).toBe(`${PUBLIC}/`)
    expect(editorFor('campus_profile', PUBLIC, 'yihua').publicUrl.value).toBe(`${PUBLIC}/#campuses`)
  })

  it('草稿預覽留在後台主機：/preview 要帶後台的登入狀態', () => {
    const editor = editorFor('about_page', PUBLIC)
    expect(editor.publicUrl.value).toBe(`${PUBLIC}/about`)
    expect(editor.previewUrl.value).toBe('/preview?page=about')
  })

  it('沒有官網 origin 時照舊用相對路徑', () => {
    expect(editorFor('home_hero', null).publicUrl.value).toBe('/')
  })
})
