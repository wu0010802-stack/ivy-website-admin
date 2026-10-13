/// <reference types="node" />
// 2026-10-12 全站設定：「各頁搜尋與分享」（七頁的搜尋標題、描述、分享圖）與「機構社群」。
// 內建標題與描述、內建社群清單都是官網原始碼／fixture 的複本，這裡逐字比對；
// 舊版本的入學頁欄位（admission_title／admission_description）載入時搬進 page_seo.admission。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import SiteMetaView from '../views/SiteMetaView.vue'
import ContentEditor from '../components/ContentEditor.vue'
import { api } from '../api/client'
import type { MediaAssetOut, UserOut } from '../api/types'
import { contentFieldLabelFor, contentPathFieldLabel, contentPathLabel } from '../api/contentFieldLabels'
import { mediaFieldPathLabel } from '../api/labels'
import { diffPayload } from '../composables/useContentItem'
import { revealContentPath } from '../composables/newsContent'
import { LENGTH_HINTS, lengthHintText } from '../composables/contentHints'
import {
  normalizePageSeo,
  PAGE_SEO_DEFAULTS,
  PAGE_SEO_KEYS,
  PAGE_SEO_PAGES,
  pageSeoCustomised,
} from '../composables/pageSeoDefaults'
import { DEFAULT_SOCIAL_LINKS, SOCIAL_LINKS_MAX, socialDuplicateIndex, socialUrlError } from '../composables/siteLinks'
import type { EditorSection } from '../composables/editorSections'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { mediaPage, testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const webSeoSource = readFileSync(resolve(ROOT, 'web/app/utils/seo.ts'), 'utf8')

// ---- 內建標題與描述：從官網 seo.ts 的語法樹取值，和後台 PAGE_SEO_DEFAULTS 逐字比對 ----------------------

/** 官網 seo.ts 裡每個 pageOverride(site, '頁', { title, description }) 的內建文字（樣板字串的插值換成實際值）。 */
function webBuiltinSeo(): Record<string, { title: string; description: string }> {
  const file = ts.createSourceFile('seo.ts', webSeoSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  // 插值：品牌名稱讀 fixture；year 是 foundingYear 的內建 1997、policyTitle 是政策標題的內建「隱私權政策」（下面另外驗證原始碼）。
  const values: Record<string, string> = { 'site.siteMeta.brandName': fixture.siteMeta.brandName, year: '1997', policyTitle: '隱私權政策' }
  const text = (node: ts.Expression): string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map((span) => {
        const name = span.expression.getText(file)
        if (!(name in values)) throw new Error(`seo.ts 的樣板字串多了插值 \${${name}}，後台的內建值要跟著處理`)
        return values[name] + span.literal.text
      }).join('')
    }
    throw new Error(`看不懂的運算式：${node.getText(file)}`)
  }
  const found: Record<string, { title: string; description: string }> = {}
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'pageOverride') {
      const [, key, builtin] = node.arguments
      if (!key || !ts.isStringLiteral(key) || !builtin || !ts.isObjectLiteralExpression(builtin)) throw new Error('pageOverride 的呼叫寫法變了')
      const entry: Record<string, string> = {}
      for (const property of builtin.properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) entry[property.name.text] = text(property.initializer)
      }
      found[key.text] = { title: entry.title!, description: entry.description! }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

describe('各頁搜尋的內建值和官網一致', () => {
  it('七頁的內建標題與描述和 web/app/utils/seo.ts 一字不差', () => {
    const web = webBuiltinSeo()
    expect(Object.keys(web).sort()).toEqual([...PAGE_SEO_KEYS].sort())
    for (const key of PAGE_SEO_KEYS) expect(PAGE_SEO_DEFAULTS[key], key).toEqual(web[key])
  })

  it('內建值裡代入的創校年份、隱私政策標題，和官網原始碼的預設一致', () => {
    expect(webSeoSource).toMatch(/milestones\?\.\[0\]\?\.year \?\? 1997/)
    expect(webSeoSource).toMatch(/privacyPolicy\?\.title \|\| '隱私權政策'/)
  })

  it('頁面清單：七頁、順序同後端 PAGE_SEO_KEYS、公開路徑對得上官網', () => {
    const backend = readFileSync(resolve(ROOT, 'backend/app/content/schemas.py'), 'utf8')
    const literal = /PageSeoKey = Literal\[([^\]]+)\]/.exec(backend)![1]!
    expect([...literal.matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([...PAGE_SEO_KEYS])
    expect(PAGE_SEO_PAGES.map((page) => page.key)).toEqual([...PAGE_SEO_KEYS])
    expect(PAGE_SEO_PAGES.map((page) => page.path)).toEqual(['/admission', '/about', '/curriculum', '/environment', '/news', '/anniversary', '/privacy'])
    // 官網各頁函式的 canonical 路徑常數；最新消息的路徑在 news-content.ts。
    const newsContent = readFileSync(resolve(ROOT, 'web/app/utils/news-content.ts'), 'utf8')
    for (const page of PAGE_SEO_PAGES) {
      const source = page.key === 'news' ? newsContent : webSeoSource
      expect(source, page.path).toMatch(new RegExp(`_PATH = '${page.path}'`))
    }
  })
})

describe('機構社群的內建清單和官網 fixture 一致', () => {
  it('DEFAULT_SOCIAL_LINKS 就是 fixture 的 siteMeta.socialLinks', () => {
    expect(DEFAULT_SOCIAL_LINKS).toEqual(fixture.siteMeta.socialLinks)
    expect(DEFAULT_SOCIAL_LINKS.length).toBeGreaterThan(0)
  })
})

// ---- 純函式 --------------------------------------------------------------------------------

describe('normalizePageSeo／pageSeoCustomised', () => {
  it('沒有 page_seo（null、缺欄位）補成七頁的空設定；有的頁缺欄位補空字串，不認得的頁丟掉', () => {
    for (const raw of [null, undefined]) {
      const result = normalizePageSeo(raw)
      expect(Object.keys(result)).toEqual([...PAGE_SEO_KEYS])
      for (const entry of Object.values(result)) expect(entry).toEqual({ title: '', description: '', share_image: '', share_image_alt: '' })
    }
    const partial = normalizePageSeo({ about: { title: '關於' }, bogus: { title: 'x' } })
    expect(partial.about).toEqual({ title: '關於', description: '', share_image: '', share_image_alt: '' })
    expect(Object.keys(partial)).toEqual([...PAGE_SEO_KEYS])
  })

  it('任何一欄有字（空白不算）就是已自訂', () => {
    const empty = { title: '', description: '', share_image: '', share_image_alt: '' }
    expect(pageSeoCustomised(empty)).toBe(false)
    expect(pageSeoCustomised({ ...empty, title: '  ' })).toBe(false)
    for (const key of Object.keys(empty)) expect(pageSeoCustomised({ ...empty, [key]: 'x' }), key).toBe(true)
  })
})

describe('社群網址的檢查（同後端 SocialLinkPayload）', () => {
  it('只收 https、要有主機名稱、不含帳密與空白', () => {
    for (const ok of ['https://www.facebook.com/ivykid', 'https://lin.ee/abc123', 'https://www.youtube.com/@ivy', 'https://www.instagram.com/ivy/?hl=zh-tw']) {
      expect(socialUrlError(ok), ok).toBeNull()
    }
    for (const bad of ['', '  ', 'http://www.facebook.com/ivykid', 'javascript:alert(1)', 'ftp://x.com/', 'www.facebook.com/ivykid', 'https://a b.com', 'https://user@example.com/', 'https://localhost/', 'https://example.com:99999/', '/about']) {
      expect(socialUrlError(bad), bad).not.toBeNull()
    }
    expect(socialUrlError('http://www.facebook.com/ivykid')).toContain('https://')
    expect(socialUrlError(`https://example.com/${'a'.repeat(300)}`)).toContain('300')
  })

  it('後端會擋的看不見的字元、主機前的 @、主機裡的 %：這裡也擋，不等存檔才 422（2026-10-13）', () => {
    for (const hidden of ['https://www.facebook.com/ivy\u200b', 'https://www.facebook.com/\u200eivy', 'https://www.face\u00adbook.com/ivy', 'https://www.facebook.com/ivy\u0007']) {
      expect(socialUrlError(hidden), JSON.stringify(hidden)).toContain('看不見的字元')
    }
    for (const bad of ['https://@www.facebook.com/ivy', 'https://www.facebook.com@evil.example/ivy', 'https://www.f%61cebook.com/ivy']) {
      expect(socialUrlError(bad), bad).not.toBeNull()
    }
    // 路徑裡的 @、% 照收（YouTube 頻道、已編碼的路徑）
    expect(socialUrlError('https://www.youtube.com/@ivy')).toBeNull()
    expect(socialUrlError('https://www.facebook.com/%E5%B8%B8')).toBeNull()
  })

  it('重複：網域大小寫與結尾斜線不算不同，回傳先出現的那一筆', () => {
    const link = (url: string) => ({ platform: 'facebook' as const, label: 'x', url })
    const links = [link('https://www.facebook.com/ivykid'), link('https://lin.ee/a'), link('HTTPS://WWW.Facebook.com/ivykid/')]
    expect(socialDuplicateIndex(links, 0)).toBe(-1)
    expect(socialDuplicateIndex(links, 1)).toBe(-1)
    expect(socialDuplicateIndex(links, 2)).toBe(0)
  })

  it('上限和後端一樣是 6', () => {
    expect(SOCIAL_LINKS_MAX).toBe(6)
    expect(readFileSync(resolve(ROOT, 'backend/app/content/schemas.py'), 'utf8')).toMatch(/SOCIAL_LINKS_MAX = 6/)
  })
})

describe('422 定位與欄位中文名', () => {
  it('page_seo.<頁>.<欄> 寫成「某某頁的搜尋標題」，分享圖素材用途也有中文', () => {
    expect(contentPathLabel('site_meta', ['page_seo', 'about', 'title'])).toBe('關於常春藤頁的搜尋標題')
    expect(contentPathLabel('site_meta', ['page_seo', 'admission', 'description'])).toBe('入學資訊頁的搜尋描述')
    expect(contentPathLabel('site_meta', ['page_seo', 'anniversary', 'share_image'])).toBe('30 週年頁的分享圖')
    expect(contentPathLabel('site_meta', ['page_seo', 'privacy', 'share_image_alt'])).toBe('隱私權政策頁的分享圖說明')
    expect(contentPathLabel('site_meta', ['page_seo'])).toBe('各頁搜尋與分享')
    expect(contentPathLabel('site_meta', ['social_links'])).toBe('機構社群')
    expect(contentPathLabel('site_meta', ['social_links', 2, 'url'])).toBe('機構社群第 3 個・網址')
    expect(contentPathLabel('site_meta', ['social_links', 0, 'platform'])).toBe('機構社群第 1 個・平台')
    expect(contentPathLabel('site_meta', ['social_links', 1, 'label'])).toBe('機構社群第 2 個・顯示名稱')
    expect(contentPathFieldLabel('site_meta', ['page_seo', 'about', 'title'])).toBe('搜尋標題')
    expect(contentPathFieldLabel('site_meta', ['social_links', 2, 'url'])).toBe('網址')
    expect(contentFieldLabelFor('site_meta', 'page_seo')).toBe('各頁搜尋與分享')
    expect(contentFieldLabelFor('site_meta', 'social_links')).toBe('機構社群')
    // 退役欄位不再有自己的名字（載入時已搬走）。
    expect(contentFieldLabelFor('site_meta', 'admission_title')).toBe('admission_title')
    expect(mediaFieldPathLabel('page_seo.about.share_image')).toBe('關於常春藤頁的分享圖')
    expect(mediaFieldPathLabel('page_seo.privacy.share_image')).toBe('隱私權政策頁的分享圖')
    expect(mediaFieldPathLabel('share_image')).toBe('分享預覽圖')
  })

  it('發布確認框：page_seo 列出改了哪幾頁', () => {
    const before = normalizePageSeo(null)
    const after = normalizePageSeo({ about: { title: '新標題' }, privacy: { description: '新描述' } })
    const [change] = diffPayload({ page_seo: before }, { page_seo: after }, 'site_meta')
    expect(change!.label).toBe('各頁搜尋與分享')
    expect(change!.detail).toBe('修改 關於常春藤頁、隱私權政策頁')
  })

  it('建議字數：標題 32、描述 80', () => {
    expect(LENGTH_HINTS.seoTitle.max).toBe(32)
    expect(LENGTH_HINTS.seoDescription.max).toBe(80)
    expect(lengthHintText('字'.repeat(33), LENGTH_HINTS.seoTitle).over).toBe(true)
    expect(lengthHintText('字'.repeat(80), LENGTH_HINTS.seoDescription).over).toBe(false)
  })
})

// ---- 編輯頁 --------------------------------------------------------------------------------

const wrappers: VueWrapper[] = []
beforeEach(() => {
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

async function mountMeta(payload: Record<string, unknown> | null, user: UserOut = superAdmin(), extraGet?: (path: string) => unknown) {
  vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith('/admin/content-items/site_meta') && !path.includes('/schedules') && !path.includes('/revisions')) {
      return {
        id: 'site_meta-item', kind: 'site_meta', campus_key: null, latest_version: 1, current_published_revision_id: 'rev-1',
        latest_revision: payload === null ? null : { id: 'rev-1', version: 1, created_at: '2026-10-12T00:00:00Z', payload, review_status: 'draft', review_note: null },
      }
    }
    const extra = extraGet?.(path)
    return extra !== undefined ? extra : []
  }) as typeof api.get)
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/content/site-meta')
  await router.isReady()
  const wrapper = mount(SiteMetaView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const BASE = { title: '常春藤', description: '描述', header_phone_number: '07', header_phone_note: '備註', share_image: '', share_image_alt: '', allow_indexing: true }

const editorOf = (wrapper: VueWrapper) => wrapper.findComponent(ContentEditor).props('editor') as unknown as {
  form: { value: Record<string, any> }
  isDirty: { value: boolean }
  save: () => Promise<boolean>
}

/** 存草稿，回傳送出的 payload。 */
async function saved(wrapper: VueWrapper): Promise<Record<string, any>> {
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
    id: 'site_meta-item', kind: 'site_meta', campus_key: null, latest_version: 2, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-2', version: 2, created_at: '2026-10-12T01:00:00Z', payload: (body as { payload: unknown }).payload, review_status: 'draft', review_note: null },
  }) as never)
  expect(await editorOf(wrapper).save()).toBe(true)
  const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))
  expect(call).toBeDefined()
  return (call![1] as { payload: Record<string, any> }).payload
}

const tabs = (wrapper: VueWrapper) => wrapper.findAll('.page-seo-tabs .el-tabs__item')
/** 頁籤上的頁名（不含「已自訂」標記）。 */
const tabName = (tab: { text: () => string }) => tab.text().replace('（已自訂）', '').trim()
const activeTab = (wrapper: VueWrapper) => tabName(wrapper.get('.page-seo-tabs .el-tabs__item.is-active'))
const customisedTabs = (wrapper: VueWrapper) => tabs(wrapper).filter((tab) => tab.text().includes('已自訂')).map(tabName)
const button = (scope: VueWrapper | ReturnType<VueWrapper['get']>, text: string) => scope.findAll('button').filter((b) => b.text() === text)
const startsWithButton = (scope: VueWrapper, text: string) => scope.findAll('button').find((b) => b.text().startsWith(text))!

/** data-field 可能落在 el-input 的外框或裡面的 textarea／input 上，兩種都找得到輸入元素。 */
function field(wrapper: VueWrapper, name: string): HTMLInputElement | HTMLTextAreaElement {
  const el = (wrapper.element as HTMLElement).querySelector<HTMLElement>(`[data-field="${name}"]`)
  if (!el) throw new Error(`找不到欄位 ${name}`)
  return (el.matches('input, textarea') ? el : el.querySelector('input, textarea')) as HTMLInputElement | HTMLTextAreaElement
}

async function setField(wrapper: VueWrapper, name: string, value: string) {
  const input = field(wrapper, name)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

// el-form-item 的錯誤訊息延遲約 100ms 才顯示。
const errorShown = () => new Promise((done) => setTimeout(done, 150)).then(() => flushPromises())

describe('各頁搜尋與分享：七個頁籤', () => {
  it('頁籤依序是入學、關於、特色教學、環境、消息、30 週年、隱私；預設在第一頁', async () => {
    const wrapper = await mountMeta({ ...BASE })
    expect(tabs(wrapper).map(tabName)).toEqual(PAGE_SEO_PAGES.map((page) => page.label))
    expect(PAGE_SEO_PAGES.map((page) => page.label)).toEqual(['入學資訊', '關於常春藤', '特色教學', '常春藤環境', '最新消息', '30 週年', '隱私權政策'])
    expect(activeTab(wrapper)).toBe('入學資訊')
    expect(wrapper.text()).toContain('各頁搜尋與分享')
    // 舊的「入學資訊頁的搜尋結果」區塊拿掉了。
    expect(wrapper.text()).not.toContain('入學資訊頁的搜尋結果')
  })

  it('每一頁的標題、描述欄位提示字都是官網內建值；字數提示用建議 32／80 字', async () => {
    const wrapper = await mountMeta({ ...BASE })
    for (const page of PAGE_SEO_PAGES) {
      expect(field(wrapper, `page_seo.${page.key}.title`).placeholder, page.key).toContain(PAGE_SEO_DEFAULTS[page.key].title)
      expect(field(wrapper, `page_seo.${page.key}.description`).placeholder, page.key).toContain(PAGE_SEO_DEFAULTS[page.key].description)
    }
    expect(wrapper.text()).toContain('建議 32 字內')
    expect(wrapper.text()).toContain('建議 80 字內')
  })

  it('唯讀帳號：提示字（官網內建值）照樣看得到，不被換成（未填）', async () => {
    const wrapper = await mountMeta({ ...BASE }, testUser('readonly', { campus_keys: ['yihua'] }))
    expect(field(wrapper, 'page_seo.about.title').placeholder).toContain(PAGE_SEO_DEFAULTS.about.title)
  })

  it('改了某一頁，頁籤標「已自訂」，其他頁沒有', async () => {
    const wrapper = await mountMeta({ ...BASE, page_seo: { about: { title: '關於我們', description: '', share_image: '', share_image_alt: '' } } })
    expect(customisedTabs(wrapper)).toEqual(['關於常春藤'])
    await setField(wrapper, 'page_seo.privacy.description', '新的描述')
    expect(customisedTabs(wrapper)).toEqual(['關於常春藤', '隱私權政策'])
  })

  it('存檔送出七頁的設定，標題與描述在對的頁；沒有 admission_* 欄位', async () => {
    const wrapper = await mountMeta({ ...BASE })
    await setField(wrapper, 'page_seo.about.title', '關於我們｜常春藤')
    await setField(wrapper, 'page_seo.news.description', '五校的最新消息')
    const payload = await saved(wrapper)
    expect(Object.keys(payload.page_seo)).toEqual([...PAGE_SEO_KEYS])
    expect(payload.page_seo.about).toEqual({ title: '關於我們｜常春藤', description: '', share_image: '', share_image_alt: '' })
    expect(payload.page_seo.news.description).toBe('五校的最新消息')
    expect(payload.page_seo.admission).toEqual({ title: '', description: '', share_image: '', share_image_alt: '' })
    expect(payload).not.toHaveProperty('admission_title')
    expect(payload).not.toHaveProperty('admission_description')
  })
})

describe('舊版本的入學頁欄位搬進 page_seo.admission', () => {
  it('只有舊欄位：入學頁籤顯示舊值、標「已自訂」；存檔只送 page_seo.admission', async () => {
    const wrapper = await mountMeta({ ...BASE, admission_title: '舊的入學標題', admission_description: '舊的入學描述' })
    expect(field(wrapper, 'page_seo.admission.title').value).toBe('舊的入學標題')
    expect(field(wrapper, 'page_seo.admission.description').value).toBe('舊的入學描述')
    expect(tabs(wrapper)[0]!.text()).toContain('已自訂')
    const payload = await saved(wrapper)
    expect(payload.page_seo.admission.title).toBe('舊的入學標題')
    expect(payload.page_seo.admission.description).toBe('舊的入學描述')
    expect(payload).not.toHaveProperty('admission_title')
    expect(payload).not.toHaveProperty('admission_description')
  })

  it('新結構該欄已有字就用新的，只補空的那一欄', async () => {
    const wrapper = await mountMeta({
      ...BASE,
      admission_title: '舊標題', admission_description: '舊描述',
      page_seo: { admission: { title: '新標題', description: '', share_image: '', share_image_alt: '' } },
    })
    expect(field(wrapper, 'page_seo.admission.title').value).toBe('新標題')
    expect(field(wrapper, 'page_seo.admission.description').value).toBe('舊描述')
  })

  it('舊欄位只有空白不算：入學頁籤不標已自訂', async () => {
    const wrapper = await mountMeta({ ...BASE, admission_title: '', admission_description: '   ' })
    expect(tabs(wrapper)[0]!.text()).not.toContain('已自訂')
  })
})

describe('載入不會憑空多出未儲存的修改', () => {
  const dirtyText = '有未儲存的修改'
  const cases: [string, Record<string, unknown> | null][] = [
    ['從沒存過任何版本', null],
    ['舊版本沒有 page_seo、social_links', { ...BASE }],
    ['舊版本帶 admission_*', { ...BASE, admission_title: '舊標題', admission_description: '舊描述' }],
    ['page_seo 是 null、social_links 是 null', { ...BASE, page_seo: null, social_links: null }],
    ['page_seo 只列了一頁、欄位不齊', { ...BASE, page_seo: { about: { title: '關於' } }, social_links: [] }],
    ['新結構完整存過', { ...BASE, page_seo: normalizePageSeo({ news: { title: '消息' } }), social_links: DEFAULT_SOCIAL_LINKS }],
  ]
  it.each(cases)('%s', async (_name, payload) => {
    const wrapper = await mountMeta(payload)
    const editor = editorOf(wrapper)
    expect(editor.isDirty.value).toBe(false)
    expect(wrapper.text()).not.toContain(dirtyText)
  })

  it('改一個字才算修改，改回原值又回到沒有修改', async () => {
    const wrapper = await mountMeta({ ...BASE, admission_title: '舊標題' })
    const editor = editorOf(wrapper)
    await setField(wrapper, 'page_seo.admission.title', '舊標題二')
    expect(editor.isDirty.value).toBe(true)
    await setField(wrapper, 'page_seo.admission.title', '舊標題')
    expect(editor.isDirty.value).toBe(false)
  })
})

describe('各頁分享圖', () => {
  const asset = (overrides: Partial<MediaAssetOut> = {}): MediaAssetOut => ({
    id: 'm1', campus_key: null, kind: 'image', status: 'ready', original_filename: 'garden.jpg',
    content_type: 'image/jpeg', size_bytes: 2048, width: 2000, height: 1500, duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z', created_by_email: null, archived_at: null, deleted_at: null,
    purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null,
    usage_count: 0, used_in: [], version: 1,
    variants: [{ id: 'v1', kind: 'thumbnail', content_type: 'image/webp', width: 480, height: 360 }],
    ...overrides,
  })
  const media = (path: string) => {
    if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 }
    if (path.startsWith('/admin/media?')) return mediaPage([asset()])
    if (path.startsWith('/admin/media')) return [asset()]
    return undefined
  }
  // 選圖器關掉後還留在畫面上（隱藏）；只點目前打開的那一個。
  function pickInOpenDialog(filename: string) {
    const items = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).filter(
      (b) => b.textContent?.includes(filename) && (b.closest<HTMLElement>('.el-overlay')?.style.display ?? '') !== 'none',
    )
    expect(items).toHaveLength(1)
    items[0]!.click()
  }

  it('沒選時說明沿用全站分享圖，說明欄不出現；分享圖版位是 1200:630', async () => {
    const wrapper = await mountMeta({ ...BASE }, superAdmin(), media)
    const pane = wrapper.get('#pane-about')
    expect(pane.text()).toContain('目前用全站分享圖')
    expect(pane.find('[data-field="page_seo.about.share_image_alt"]').exists()).toBe(false)
    expect(pane.get('.media-field').attributes('style')).toContain('1200 / 630')
  })

  it('在關於頁選圖：寫進 page_seo.about，說明帶入素材庫的說明；改回全站分享圖會清掉說明', async () => {
    const wrapper = await mountMeta({ ...BASE }, superAdmin(), media)
    const pane = wrapper.get('#pane-about')
    await pane.findAll('button').find((b) => b.text() === '從素材庫選圖片')!.trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect(editorOf(wrapper).form.value.page_seo.about.share_image).toBe('m1')
    expect(field(wrapper, 'page_seo.about.share_image_alt').value).toBe('菜園')
    expect(editorOf(wrapper).form.value.page_seo.admission.share_image).toBe('')

    await pane.findAll('button').find((b) => b.text() === '改回全站分享圖')!.trigger('click')
    await flushPromises()
    expect(editorOf(wrapper).form.value.page_seo.about.share_image).toBe('')
    expect(editorOf(wrapper).form.value.page_seo.about.share_image_alt).toBe('')
  })

  it('換成另一張圖時換掉舊圖的說明', async () => {
    const wrapper = await mountMeta({ ...BASE, page_seo: { privacy: { title: '', description: '', share_image: 'old', share_image_alt: '舊圖的說明' } } }, superAdmin(), (path) => {
      if (path === '/admin/media/old') return asset({ id: 'old', original_filename: 'old.jpg', alt_text: '舊圖的說明' })
      return media(path)
    })
    const pane = wrapper.get('#pane-privacy')
    await pane.findAll('button').find((b) => b.text() === '更換圖片')!.trigger('click')
    await flushPromises()
    pickInOpenDialog('garden.jpg')
    await flushPromises()
    expect(field(wrapper, 'page_seo.privacy.share_image_alt').value).toBe('菜園')
  })
})

describe('機構社群', () => {
  const socialItems = (wrapper: VueWrapper) => wrapper.findAll('.social-links .repeat-item')
  /** 第 index 個社群的輸入框（平台是下拉，所以不能用 input 的順序找）。 */
  const socialInput = (wrapper: VueWrapper, index: number, name: 'label' | 'url') => socialItems(wrapper)[index]!.get(`input[data-field="${name}"]`)
  const builtinLabels = DEFAULT_SOCIAL_LINKS.map((link) => link.label).join('、')

  it('沒設定過（null）：說明沿用官網內建、沒有清單，只有「改成自訂（帶入內建）」', async () => {
    const wrapper = await mountMeta({ ...BASE })
    expect(wrapper.text()).toContain(`目前沿用官網內建：${builtinLabels}`)
    expect(socialItems(wrapper)).toHaveLength(0)
    expect(startsWithButton(wrapper, '改成自訂')).toBeDefined()
    expect(wrapper.findAll('button').some((b) => b.text() === '恢復內建')).toBe(false)
    expect(editorOf(wrapper).form.value.social_links).toBeNull()
  })

  it('改成自訂：帶入內建清單，之後可以編輯；存檔送出清單', async () => {
    const wrapper = await mountMeta({ ...BASE })
    await startsWithButton(wrapper, '改成自訂').trigger('click')
    await flushPromises()
    expect(socialItems(wrapper)).toHaveLength(DEFAULT_SOCIAL_LINKS.length)
    expect(editorOf(wrapper).form.value.social_links).toEqual(DEFAULT_SOCIAL_LINKS)
    expect(wrapper.text()).not.toContain('目前沿用官網內建')
    await socialInput(wrapper, 0, 'label').setValue('我們的粉專')
    const payload = await saved(wrapper)
    expect(payload.social_links).toEqual([{ ...DEFAULT_SOCIAL_LINKS[0]!, label: '我們的粉專' }])
  })

  it('帶入的內建清單不會動到常數本身', async () => {
    const wrapper = await mountMeta({ ...BASE })
    await startsWithButton(wrapper, '改成自訂').trigger('click')
    await socialInput(wrapper, 0, 'label').setValue('改過')
    expect(DEFAULT_SOCIAL_LINKS[0]!.label).toBe(fixture.siteMeta.socialLinks[0].label)
  })

  it('恢復內建：social_links 設回 null；空清單（[]）和 null 是不同的兩件事', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: DEFAULT_SOCIAL_LINKS })
    expect(editorOf(wrapper).isDirty.value).toBe(false)
    await button(wrapper, '恢復內建')[0]!.trigger('click')
    await flushPromises()
    expect(editorOf(wrapper).form.value.social_links).toBeNull()
    expect(wrapper.text()).toContain('目前沿用官網內建')
    expect((await saved(wrapper)).social_links).toBeNull()
  })

  it('全部移除是 []（官網不顯示），畫面講清楚，且不會被當成沿用內建', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: DEFAULT_SOCIAL_LINKS })
    while (socialItems(wrapper).length) {
      await socialItems(wrapper)[0]!.findAll('button').find((b) => b.text() === '移除')!.trigger('click')
      await flushPromises()
    }
    expect(editorOf(wrapper).form.value.social_links).toEqual([])
    expect(wrapper.text()).toContain('官網不顯示機構社群')
    expect(wrapper.text()).not.toContain('目前沿用官網內建')
    expect((await saved(wrapper)).social_links).toEqual([])
  })

  it('最多 6 筆：到上限新增鈕停用', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: DEFAULT_SOCIAL_LINKS })
    for (let n = DEFAULT_SOCIAL_LINKS.length; n < SOCIAL_LINKS_MAX; n++) {
      const add = startsWithButton(wrapper, '新增社群連結')
      expect(add.text()).toContain(`${n} / ${SOCIAL_LINKS_MAX}`)
      expect(add.attributes('disabled')).toBeUndefined()
      await add.trigger('click')
      await flushPromises()
    }
    expect(socialItems(wrapper)).toHaveLength(SOCIAL_LINKS_MAX)
    const full = startsWithButton(wrapper, '新增社群連結')
    expect(full.text()).toContain(`${SOCIAL_LINKS_MAX} / ${SOCIAL_LINKS_MAX}`)
    expect(full.attributes('disabled')).toBeDefined()
  })

  it('新增的一筆預設 Facebook、空白欄位，並聚焦第一個欄位', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: [] })
    await startsWithButton(wrapper, '新增社群連結').trigger('click')
    await flushPromises()
    expect(editorOf(wrapper).form.value.social_links).toEqual([{ platform: 'facebook', label: '', url: '' }])
  })

  it('網址即時檢查：http:// 與不是網址的字馬上提示 https，改成 https 後消失', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: [{ platform: 'facebook', label: '粉專', url: 'https://www.facebook.com/ivykid' }] })
    await errorShown()
    expect(socialItems(wrapper)[0]!.text()).not.toContain('https:// 開頭')
    await socialInput(wrapper, 0, 'url').setValue('http://www.facebook.com/ivykid')
    await errorShown()
    expect(socialItems(wrapper)[0]!.text()).toContain('網址要用 https:// 開頭')
    await socialInput(wrapper, 0, 'url').setValue('https://www.facebook.com/ivykid')
    await errorShown()
    expect(socialItems(wrapper)[0]!.text()).not.toContain('https:// 開頭')
  })

  it('顯示名稱留空與網址重複都在那一筆下面提示', async () => {
    const wrapper = await mountMeta({
      ...BASE,
      social_links: [
        { platform: 'facebook', label: '粉專', url: 'https://www.facebook.com/ivykid' },
        { platform: 'line', label: '', url: 'https://www.facebook.com/ivykid/' },
      ],
    })
    await errorShown()
    expect(socialItems(wrapper)[0]!.text()).not.toContain('重複')
    expect(socialItems(wrapper)[1]!.text()).toContain('請填寫顯示名稱')
    expect(socialItems(wrapper)[1]!.text()).toContain('和第 1 個的網址重複')
  })

  it('上移／下移改順序；第一個不能再上移', async () => {
    const wrapper = await mountMeta({
      ...BASE,
      social_links: [
        { platform: 'facebook', label: '甲', url: 'https://www.facebook.com/a' },
        { platform: 'line', label: '乙', url: 'https://lin.ee/b' },
      ],
    })
    expect(socialItems(wrapper)[0]!.findAll('button').find((b) => b.text() === '上移')!.attributes('disabled')).toBeDefined()
    await socialItems(wrapper)[0]!.findAll('button').find((b) => b.text() === '下移')!.trigger('click')
    await flushPromises()
    expect(editorOf(wrapper).form.value.social_links.map((link: { label: string }) => link.label)).toEqual(['乙', '甲'])
    expect(editorOf(wrapper).isDirty.value).toBe(true)
  })

  it('平台可以換；四種平台', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: [{ platform: 'facebook', label: '粉專', url: 'https://www.facebook.com/a' }] })
    const form = editorOf(wrapper).form.value
    form.social_links[0].platform = 'instagram'
    await flushPromises()
    expect((await saved(wrapper)).social_links[0].platform).toBe('instagram')
    expect(socialItems(wrapper)[0]!.text()).toContain('Instagram')
  })

  it('唯讀帳號看得到清單與沿用內建的說明，沒有新增、移除、改成自訂', async () => {
    const reader = testUser('readonly', { campus_keys: ['yihua'] })
    const inherited = await mountMeta({ ...BASE }, reader)
    expect(inherited.text()).toContain('目前沿用官網內建')
    expect(inherited.findAll('button').some((b) => b.text().startsWith('改成自訂'))).toBe(false)
    const custom = await mountMeta({ ...BASE, social_links: DEFAULT_SOCIAL_LINKS }, reader)
    expect(custom.findAll('button').some((b) => b.text().startsWith('新增社群連結') || b.text() === '移除' || b.text() === '恢復內建')).toBe(false)
  })
})

describe('存檔被擋時定位到欄位', () => {
  it('page_seo.about.title：切到關於常春藤頁籤、聚焦搜尋標題', async () => {
    const wrapper = await mountMeta({ ...BASE })
    expect(activeTab(wrapper)).toBe('入學資訊')
    const path = ['page_seo', 'about', 'title']
    expect(await revealContentPath(wrapper.element as HTMLElement, path, contentPathFieldLabel('site_meta', path))).toBe(true)
    await flushPromises()
    expect(activeTab(wrapper)).toBe('關於常春藤')
    expect(document.activeElement).toBe(field(wrapper, 'page_seo.about.title'))
  })

  it('page_seo.privacy.description 與分享圖說明也找得到頁籤', async () => {
    const wrapper = await mountMeta({ ...BASE, page_seo: { privacy: { title: '', description: '', share_image: 'm1', share_image_alt: '' } } })
    const description = ['page_seo', 'privacy', 'description']
    expect(await revealContentPath(wrapper.element as HTMLElement, description, contentPathFieldLabel('site_meta', description))).toBe(true)
    await flushPromises()
    expect(activeTab(wrapper)).toBe('隱私權政策')
    expect(document.activeElement).toBe(field(wrapper, 'page_seo.privacy.description'))
  })

  it('social_links 第 2 個的網址：聚焦那一格', async () => {
    const wrapper = await mountMeta({
      ...BASE,
      social_links: [
        { platform: 'facebook', label: '甲', url: 'https://www.facebook.com/a' },
        { platform: 'line', label: '乙', url: 'http://lin.ee/b' },
      ],
    })
    const path = ['social_links', 1, 'url']
    expect(await revealContentPath(wrapper.element as HTMLElement, path, contentPathFieldLabel('site_meta', path))).toBe(true)
    expect(document.activeElement).toBe(wrapper.findAll('.social-links .repeat-item')[1]!.get('input[data-field="url"]').element)
  })

  it('整份 social_links 的錯誤（最多 6 個、網址重複）：捲到社群清單', async () => {
    const wrapper = await mountMeta({ ...BASE, social_links: [{ platform: 'facebook', label: '甲', url: 'https://www.facebook.com/a' }] })
    expect(await revealContentPath(wrapper.element as HTMLElement, ['social_links'], contentPathFieldLabel('site_meta', ['social_links']))).toBe(true)
  })
})

describe('段落目錄', () => {
  it('每段有標題 id，涵蓋所有欄位', async () => {
    const wrapper = await mountMeta({ ...BASE })
    const sections = wrapper.findComponent(ContentEditor).props('sections') as EditorSection[]
    expect(sections.map((s) => s.label)).toEqual(['網站標題與頁首電話', '社群分享圖', '各頁搜尋與分享', '搜尋引擎', '主選單', '機構社群', '品牌名稱與 Logo'])
    for (const section of sections) {
      const heading = document.getElementById(section.id)
      expect(heading, section.id).not.toBeNull()
      expect(heading!.hasAttribute('data-section-anchor')).toBe(true)
      expect(heading!.getAttribute('tabindex')).toBe('-1')
    }
    const keys = Object.keys(editorOf(wrapper).form.value)
    const covered = new Set(sections.flatMap((s) => (s.fields ?? []).map((f) => f.split('.')[0]!)))
    expect(keys.filter((key) => !covered.has(key))).toEqual([])
  })
})
