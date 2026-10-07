// 2026-10-06 方向 D：段落目錄打點靠每段的 fields。每個有目錄的編輯頁，表單的每個欄位都要分到某一段，
// 改了那一欄，目錄上那一段就打點。新增欄位忘了分段，這支測試會擋。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, type Component } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import type { EditorSection } from '../composables/editorSections'
import type { ContentEditorState } from '../composables/useContentItem'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import CampusProfileView from '../views/CampusProfileView.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import CampusNewsView from '../views/CampusNewsView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import AboutPageView from '../views/AboutPageView.vue'
import CurriculumPageView from '../views/CurriculumPageView.vue'
import AdmissionContentView from '../views/AdmissionContentView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'

const wrappers: VueWrapper[] = []
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
  document.body.innerHTML = ''
})

interface Case {
  name: string
  component: Component
  kind: string
  campusKey: string | null
  /** 已存（也是官網）的內容；{} 表示全用編輯頁的預設值 */
  payload: Record<string, unknown>
  /** 改一欄（整個最外層欄位換成 value），目錄上應該打點的那一段 */
  edit?: { key: string; value: unknown; section: string }
}

const CASES: Case[] = [
  { name: '五校介紹', component: CampusProfileView, kind: 'campus_profile', campusKey: 'yihua', payload: {}, edit: { key: 'phone', value: '07-000-0000', section: '基本資料' } },
  { name: '最新消息與活動', component: HomeNewsView, kind: 'home_news', campusKey: null, payload: {}, edit: { key: 'home_display_count', value: 3, section: '最新消息' } },
  { name: '各校消息與活動', component: CampusNewsView, kind: 'campus_news', campusKey: 'yihua', payload: {} },
  { name: '孩子的一天', component: DayExperienceView, kind: 'day_experience', campusKey: null, payload: {}, edit: { key: 'note', value: '新的說明', section: '背景影片' } },
  { name: '關於常春藤頁', component: AboutPageView, kind: 'about_page', campusKey: null, payload: {}, edit: { key: 'story_title', value: '新的章名', section: '第一章：一路走來' } },
  { name: '特色教學頁', component: CurriculumPageView, kind: 'curriculum_page', campusKey: null, payload: {}, edit: { key: 'gallery_title', value: '新的美術館', section: '03 兒童美術館' } },
  { name: '入學資訊頁', component: AdmissionContentView, kind: 'admission_content', campusKey: null, payload: {}, edit: { key: 'fee_intro', value: '新的說明', section: '收退費辦法' } },
  {
    name: '隱私權政策',
    component: PrivacyPolicyView,
    kind: 'privacy_policy',
    campusKey: null,
    payload: { title: '隱私權政策', updated_on: null, sections: [{ heading: '一、蒐集目的', body: '內文' }, { heading: '二、利用期間', body: '內文' }] },
    // 只改第二段：只點第二段，第一段（也管 title／updated_on）不點。
    edit: { key: 'sections', value: [{ heading: '一、蒐集目的', body: '內文' }, { heading: '二、利用期間', body: '改過的內文' }], section: '二、利用期間' },
  },
]

async function mountCase(c: Case) {
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
  vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith(`/admin/content-items/${c.kind}`) && !path.includes('/schedules') && !path.includes('/revisions')) {
      return {
        id: `${c.kind}-item`, kind: c.kind, campus_key: c.campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
        latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-06T00:00:00Z', payload: c.payload, review_status: 'draft', review_note: null },
      }
    }
    return []
  }) as typeof api.get)
  const pinia = createPinia()
  const user: UserOut = c.campusKey
    ? testUser('campus_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [c.campusKey] })
    : testUser('super_admin', { id: 'me', email: 'me@example.invalid' })
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(c.campusKey ? `/?campus=${c.campusKey}` : '/')
  await router.isReady()
  const wrapper = mount(c.component, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const shell = wrapper.findComponent(ContentEditor)
  return { wrapper, sections: shell.props('sections') as EditorSection[], editor: shell.props('editor') as ContentEditorState }
}

describe.each(CASES)('$name：段落目錄的欄位', (c) => {
  it('表單每個欄位都分到某一段，最外層欄位不重複', async () => {
    const { sections, editor } = await mountCase(c)
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const keys = Object.keys(editor.form!.value as Record<string, unknown>)
    const covered = new Set(sections.flatMap((s) => (s.fields ?? []).map((f) => f.split('.')[0]!)))
    expect(keys.filter((key) => !covered.has(key))).toEqual([])
    const plain = sections.flatMap((s) => (s.fields ?? []).filter((f) => !f.includes('.')))
    expect(new Set(plain).size).toBe(plain.length)
  })

  it.runIf(Boolean(c.edit))('改了一欄，目錄上那一段打點', async () => {
    const { wrapper, editor } = await mountCase(c)
    ;(editor.form!.value as Record<string, unknown>)[c.edit!.key] = c.edit!.value
    await flushPromises()
    const links = wrapper.get('nav[aria-label="這一頁的段落"]').findAll('a')
    const dotted = links.filter((a) => a.find('.section-nav__dot').exists()).map((a) => a.get('.section-nav__label').text())
    expect(dotted).toEqual([c.edit!.section])
  })
})
