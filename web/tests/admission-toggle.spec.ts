// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, getRequestHeader, sendRedirect, setResponseHeader, toNodeListener, type H3Event } from 'h3'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { admissionEnabled, isAdmissionHref, llmsTxt, sitemapXml } from '../app/utils/seo'
import { admissionHiddenLocation, isLegacyAdmissionPath, LEGACY_REDIRECTS } from '../server/utils/site-redirects'
import siteFixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'

// 後台「網站標題與電話」的入學資訊分頁開關（2026-11-11，site_meta.admission_enabled）：
// 關掉並發布後，/admission 回 404，主選單、頁尾、關於頁與環境頁結尾、sitemap、llms.txt 都不再連過去；
// 舊站的入學網址在隱藏期間改去首頁。草稿預覽照常看得到入學資訊頁。
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const site = siteFixture as unknown as SiteContent
const meta = { title: 't', description: 'd', header_phone_number: '07', header_phone_note: 'n' }
const ORIGIN = 'https://ivy.example'
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

describe('入學資訊分頁開關：內容疊加', () => {
  it('舊版本沒有這個欄位＝顯示，輸出不多出欄位', () => {
    const on = applyContentOverlay(site, { site_meta: meta })
    expect(admissionEnabled(on.siteMeta)).toBe(true)
    expect('admissionEnabled' in on.siteMeta).toBe(false)
    expect(on.siteMeta.primaryNav.some((l) => l.href === '/admission')).toBe(true)
    expect(on.footer.links.some((l) => l.href === '/admission')).toBe(true)
    expect(admissionEnabled(undefined)).toBe(true)
    expect(applyContentOverlay(site, { site_meta: { ...meta, admission_enabled: true } }).siteMeta.primaryNav).toEqual(on.siteMeta.primaryNav)
  })

  it('隱藏：主選單與頁尾拿掉入學資訊，其他項目與順序不變', () => {
    const off = applyContentOverlay(site, {
      site_meta: { ...meta, admission_enabled: false },
      site_footer: { tagline: 't', copyright: 'c', bottom_note: 'b', campus_list_label: 'l', links: [{ label: '收退費', href: '/admission#fees' }, { label: '關於', href: '/about' }] }
    })
    expect(admissionEnabled(off.siteMeta)).toBe(false)
    expect(off.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav.filter((l) => l.href !== '/admission'))
    expect(off.siteMeta.primaryNav.length).toBe(site.siteMeta.primaryNav.length - 1)
    expect(off.footer.links).toEqual([{ label: '關於', href: '/about' }])
    // 內建頁尾也拿掉
    const builtinFooter = applyContentOverlay(site, { site_meta: { ...meta, admission_enabled: false } })
    expect(builtinFooter.footer.links.some((l) => isAdmissionHref(l.href))).toBe(false)
    expect(builtinFooter.footer.links.length).toBe(site.footer.links.length - 1)
  })

  it('後台選單只有入學資訊：隱藏後退回內建選單（同樣沒有入學資訊）', () => {
    const only = applyContentOverlay(site, {
      site_meta: { ...meta, admission_enabled: false, primary_nav: [{ label: '入學資訊', label_en: '', href: '/admission' }] }
    })
    expect(only.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav.filter((l) => l.href !== '/admission'))
  })

  it('和 30 週年開關各管各的，兩個都關時兩頁都拿掉', () => {
    const both = applyContentOverlay(site, { site_meta: { ...meta, admission_enabled: false, anniversary_enabled: false } })
    expect(both.siteMeta.primaryNav.map((l) => l.href)).toEqual(
      site.siteMeta.primaryNav.map((l) => l.href).filter((href) => href !== '/admission' && href !== '/anniversary')
    )
    const anniOnly = applyContentOverlay(site, { site_meta: { ...meta, anniversary_enabled: false } })
    expect(anniOnly.siteMeta.primaryNav.some((l) => l.href === '/admission')).toBe(true)
    const admissionOnly = applyContentOverlay(site, { site_meta: { ...meta, admission_enabled: false } })
    expect(admissionOnly.siteMeta.primaryNav.some((l) => l.href === '/anniversary')).toBe(true)
  })

  it('和最新消息開關一起關：兩邊的連結都拿掉；選單只剩被隱藏的頁時退回內建選單，同樣三個開關都套用', () => {
    const off = { ...meta, admission_enabled: false, news_enabled: false, anniversary_enabled: false }
    const hiddenPaths = ['/admission', '/news', '/anniversary']
    const builtin = site.siteMeta.primaryNav.filter((l) => !hiddenPaths.includes(l.href))
    expect(applyContentOverlay(site, { site_meta: off }).siteMeta.primaryNav).toEqual(builtin)
    const onlyHidden = applyContentOverlay(site, {
      site_meta: { ...off, primary_nav: [{ label: '入學資訊', label_en: '', href: '/admission' }, { label: '最新消息', label_en: '', href: '/news' }] }
    })
    expect(onlyHidden.siteMeta.primaryNav).toEqual(builtin)
    expect(onlyHidden.footer.links.some((l) => hiddenPaths.some((path) => l.href.startsWith(path)))).toBe(false)
  })

  it('連結判斷只認 /admission 這一頁', () => {
    expect(isAdmissionHref('/admission')).toBe(true)
    expect(isAdmissionHref('/admission/')).toBe(true)
    expect(isAdmissionHref(' /admission#fees ')).toBe(true)
    expect(isAdmissionHref('/admission?x=1')).toBe(true)
    expect(isAdmissionHref('/admissions')).toBe(false)
    expect(isAdmissionHref('/about')).toBe(false)
  })
})

describe('入學資訊分頁開關：sitemap 與 llms.txt', () => {
  it('預設照列；隱藏時 sitemap 不列 /admission', () => {
    expect(sitemapXml(ORIGIN)).toContain(`<loc>${ORIGIN}/admission</loc>`)
    const hidden = sitemapXml(ORIGIN, undefined, { admission: false })
    expect(hidden).not.toContain('/admission')
    expect(hidden).toContain(`<loc>${ORIGIN}/about</loc>`)
    expect(read('server/routes/sitemap.xml.get.ts')).toContain('admission: admissionEnabled(published.content.siteMeta)')
  })

  it('隱藏時 llms.txt 不列入學資訊，也不列連到入學頁錨點的常見問題；其他段落照舊', () => {
    const shown = llmsTxt(ORIGIN, site)
    expect(shown).toContain(`[入學資訊](${ORIGIN}/admission)`)
    expect(shown).toContain('## 常見問題')
    const off = applyContentOverlay(site, { site_meta: { ...meta, admission_enabled: false } })
    const hidden = llmsTxt(ORIGIN, off)
    expect(hidden).not.toContain('/admission')
    expect(hidden).not.toContain('## 入學資訊')
    expect(hidden).not.toContain('## 常見問題')
    for (const heading of ['## 各校地址與電話', '## 關於常春藤', '## 特色教學', '## 常春藤環境', '## 預約參觀']) expect(hidden).toContain(heading)
  })
})

describe('入學資訊分頁開關：頁面', () => {
  it('隱藏時 /admission 回 404；草稿預覽不看開關', () => {
    expect(read('app/pages/admission.vue')).toMatch(/if \(!admissionEnabled\(data\.value\?\.content\.siteMeta\)\) \{\n\s+throw createError\(\{ statusCode: 404/)
    expect(read('app/pages/preview.vue')).toContain('<AdmissionContent v-if="page === \'admission\'" :admission="draft.admission" :campuses="draft.campuses" />')
  })

  it('關於頁與環境頁結尾「還可以看看這幾頁」跟著開關（正式頁與後台預覽都傳）', () => {
    for (const name of ['AboutContent', 'EnvironmentContent']) {
      const source = read(`app/components/${name}.vue`)
      expect(source, name).toContain("const nextPages = computed(() => NEXT.filter((item) => props.admission || item.href !== '/admission'))")
      expect(source, name).toMatch(/v-for="\(?item(?:, i\))? in nextPages"/)
      expect(source, name).not.toMatch(/ in NEXT"/)
      // 沒傳＝顯示（Vue 的布林 prop 沒給預設會變成 false）
      expect(source, name).toMatch(/admission\?: boolean[^\n]*\{[^\n]*admission: true \}\)/)
    }
    expect(read('app/pages/about.vue')).toContain(':admission="admissionEnabled(data.content.siteMeta)"')
    expect(read('app/pages/environment.vue')).toContain(':admission="admissionEnabled(data.content.siteMeta)"')
    expect(read('app/pages/preview.vue').match(/:admission="admissionEnabled\(draft\.siteMeta\)"/g)).toHaveLength(2)
  })
})

describe('入學資訊分頁開關：舊站入學網址', () => {
  it('對照表裡去 /admission 的五條都認得，其他不算', () => {
    const admission = Object.entries(LEGACY_REDIRECTS).filter(([, target]) => target.startsWith('/admission')).map(([key]) => key)
    expect(admission).toHaveLength(5)
    for (const key of admission) expect(isLegacyAdmissionPath(`${enc(key)}?lang=en`), key).toBe(true)
    for (const path of ['/admission', '/about', enc('/幼兒餐點'), enc('/一日流程'), '/%E0%A4%A']) expect(isLegacyAdmissionPath(path), path).toBe(false)
  })

  it('隱藏時改去首頁：錨點拿掉，主機與查詢字串照留', () => {
    expect(admissionHiddenLocation('/admission')).toBe('/')
    expect(admissionHiddenLocation('/admission#classes')).toBe('/')
    expect(admissionHiddenLocation('/admission?lang=en&utm_source=fb#fees')).toBe('/?lang=en&utm_source=fb')
    expect(admissionHiddenLocation('https://www.ivykidschool.com/admission?a=1#classes')).toBe('https://www.ivykidschool.com/?a=1')
  })

  const servers: Server[] = []
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.doUnmock('../server/utils/published-site')
    vi.resetModules()
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => {
      server.closeAllConnections()
      server.close(() => done())
    })))
  })

  async function serve(load: () => Promise<unknown>): Promise<string> {
    vi.stubGlobal('defineEventHandler', eventHandler)
    vi.stubGlobal('getRequestHeader', getRequestHeader)
    vi.stubGlobal('setResponseHeader', setResponseHeader)
    vi.stubGlobal('sendRedirect', sendRedirect)
    vi.stubGlobal('useRuntimeConfig', () => ({ redirectHosts: '', websiteEnv: 'test', websiteApiInternalBase: 'http://127.0.0.1:0', public: { siteOrigin: ORIGIN, contentMode: 'live' } }))
    vi.doMock('../server/utils/published-site', () => ({ loadPublishedSite: load }))
    const { default: middleware } = await import('../server/middleware/00.site-redirects')
    const app = createApp()
    app.use(middleware as (event: H3Event) => void)
    app.use(eventHandler(() => 'page'))
    const server = createServer(toNodeListener(app))
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  }
  const published = (admissionEnabledValue?: boolean) => async () => ({ content: { siteMeta: { admissionEnabled: admissionEnabledValue } } })

  it('顯示中：照舊 301 到入學頁的章節', async () => {
    const base = await serve(published())
    const moved = await fetch(`${base}${enc('/分班表')}?q=1`, { redirect: 'manual' })
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/admission?q=1#classes')
    expect(moved.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('隱藏中：302 到首頁、不給快取；不是入學的舊網址不讀內容、照舊 301', async () => {
    let loads = 0
    const base = await serve(async () => {
      loads++
      return { content: { siteMeta: { admissionEnabled: false } } }
    })
    const moved = await fetch(`${base}${enc('/收退費辦法')}?utm_source=fb`, { redirect: 'manual' })
    expect(moved.status).toBe(302)
    expect(moved.headers.get('location')).toBe('/?utm_source=fb')
    expect(moved.headers.get('cache-control')).toBe('no-cache, max-age=0')
    expect(loads).toBe(1)
    const other = await fetch(`${base}${enc('/幼兒餐點')}`, { redirect: 'manual' })
    expect(other.status).toBe(301)
    expect(other.headers.get('location')).toBe('/environment#meals')
    expect((await fetch(`${base}/about`, { redirect: 'manual' })).status).toBe(200)
    expect(loads).toBe(1)
  })

  it('讀不到已發布內容：照原本的 301', async () => {
    const base = await serve(async () => { throw new Error('503') })
    const moved = await fetch(`${base}${enc('/寶貝入學流程')}`, { redirect: 'manual' })
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/admission#process')
  })
})
