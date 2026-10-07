// 2026-10-03 第八輪：長編輯頁的段落目錄（稽核 09-28「超長編輯頁沒有段落導覽」）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import HomeNewsView from '../views/HomeNewsView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { jumpToSection } from '../composables/editorSections'

const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const wrappers: VueWrapper[] = []
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
  document.body.innerHTML = ''
})

describe('段落目錄', () => {
  it('列出每一段；點一下捲到那一段的標題、焦點移過去、標成目前這段', async () => {
    document.body.innerHTML = '<h2 id="sec-a" data-section-anchor tabindex="-1">最新消息</h2><h2 id="sec-b" data-section-anchor>近期活動</h2>'
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as never
    const wrapper = mount(EditorSectionNav, {
      props: { sections: [{ id: 'sec-a', label: '最新消息', note: '3 則' }, { id: 'sec-b', label: '近期活動' }] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    expect(wrapper.get('nav').attributes('aria-label')).toBe('這一頁的段落')
    const links = wrapper.findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['#sec-a', '#sec-b'])
    expect(links[0]!.get('.section-nav__label').text()).toBe('最新消息')
    expect(links[0]!.get('.section-nav__note').text()).toBe('3 則')
    expect(links[1]!.find('.section-nav__note').exists()).toBe(false)

    await links[1]!.trigger('click')
    expect(scrolled).toEqual(['sec-b'])
    expect(document.activeElement?.id).toBe('sec-b')
    // 原本沒有 tabindex 的標題補上 -1，焦點才移得過去。
    expect(document.getElementById('sec-b')!.getAttribute('tabindex')).toBe('-1')
    expect(links[1]!.attributes('aria-current')).toBe('location')
    expect(links[0]!.attributes('aria-current')).toBeUndefined()
  })

  it('找不到標題時不動、回 false', () => {
    expect(jumpToSection('no-such-section')).toBe(false)
  })

  it('ContentEditor：至少兩段才放目錄；桌機 1280 以上在左側一欄（2026-10-06 方向 D），窄螢幕在表單上方', () => {
    const editor = readSource('../components/ContentEditor.vue')
    expect(editor).toContain("import EditorSectionNav from './EditorSectionNav.vue'")
    expect(editor).toMatch(/hasNav = computed\(\(\) => navSections\.value\.length >= MIN_NAV_SECTIONS\)/)
    expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" :dirty-ids="dirtySections" class="editor__nav" \/>/)
    // 從 1280 的 @media 切到下一個行首 `}`，不會一路吃到後面的 @media。
    const start = editor.indexOf('@media (min-width: 1280px) {')
    const desktop = editor.slice(start, editor.indexOf('\n}', start) + 2)
    expect(desktop).toContain("grid-template-areas: 'nav top' 'nav body'")
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }')
    const nav = readSource('../components/EditorSectionNav.vue')
    // 窄螢幕膠囊列自己橫捲，不撐寬頁面；觸控 44px。
    expect(nav).toMatch(/\.section-nav ol \{[^}]*overflow-x: auto;/)
    expect(nav).toMatch(/\.section-nav a \{[^}]*min-height: 44px;/)
    const css = readSource('../style.css')
    expect(css).toMatch(/\[data-section-anchor\] \{ scroll-margin-top: 80px; \}/)
  })
})

function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
  return {
    id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
  }
}

async function mountView(component: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid' })
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

describe('長編輯頁接上目錄', () => {
  it('首頁消息：最新消息（則數）、近期活動（場數）、手機版活動影片；點了焦點到那一段標題', async () => {
    Element.prototype.scrollIntoView = () => {}
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', {
      sample_note: '', home_display_count: null, films: null,
      articles: [{ id: 'a1', date: '2026-10-01', category: '', title: '菜園', description: '', image: '', alt: '', scope: 'global', campus_keys: [], featured: false, body: [] }],
      events: [],
    }) as never)
    const wrapper = await mountView(HomeNewsView)
    const nav = wrapper.get('nav[aria-label="這一頁的段落"]')
    expect(nav.findAll('.section-nav__label').map((s) => s.text())).toEqual(['最新消息', '近期活動', '手機版活動影片'])
    expect(nav.findAll('.section-nav__note').map((s) => s.text())).toEqual(['1 則', '0 場'])
    for (const id of ['section-news-articles', 'section-news-events', 'section-news-films']) {
      expect(document.getElementById(id)?.hasAttribute('data-section-anchor')).toBe(true)
    }
    await nav.findAll('a')[1]!.trigger('click')
    expect(document.activeElement?.id).toBe('section-news-events')
  })

  it('隱私權政策：每一段一個目錄項目，小標改了目錄跟著改；空白小標寫「第 N 段」', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (
      path.startsWith('/admin/content-items/') ? contentItem('privacy_policy', {
        title: '隱私權政策', updated_on: '2026-10-03',
        sections: [{ heading: '蒐集的資料', body: '內文' }, { heading: '', body: '內文' }],
      }) : []
    ) as never)
    const wrapper = await mountView(PrivacyPolicyView)
    const labels = () => wrapper.get('nav[aria-label="這一頁的段落"]').findAll('.section-nav__label').map((s) => s.text())
    expect(labels()).toEqual(['蒐集的資料', '第 2 段'])
    await wrapper.findAll('input').find((i) => (i.element as HTMLInputElement).value === '蒐集的資料')!.setValue('使用目的')
    expect(labels()).toEqual(['使用目的', '第 2 段'])
    expect(document.getElementById('policy-section-1')?.hasAttribute('data-section-anchor')).toBe(true)
  })

  it('入學資訊、孩子的一天、各校消息都傳了 sections', () => {
    expect(readSource('../views/AdmissionContentView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    expect(readSource('../views/DayExperienceView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    expect(readSource('../views/CampusNewsView.vue')).toMatch(/:sections="navSections"/)
    for (const id of ['section-admission-steps', 'section-admission-phases', 'section-admission-fees']) {
      expect(readSource('../views/AdmissionContentView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
    }
    for (const id of ['section-day-film', 'section-day-moments']) {
      expect(readSource('../views/DayExperienceView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
    }
  })
})
