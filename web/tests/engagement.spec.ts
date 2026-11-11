// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ENGAGEMENT_KEY, ENGAGEMENT_SOURCES, newsItemOf, validateEngagement } from '../shared/engagement'
import { BOOKED_ACTION, READ_ACTION, actionKeyOf, classifySource, engagementSession, sectionKeyAt, setCurrentVisit, startVisit, trackEngagementAction } from '../app/utils/engagement'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const ORIGIN = 'https://ivy.example'
const SESSION = { id: '0b0e3c0e-6a57-4c58-9a51-0d0f5c1f7a11', source: 'facebook' as const }
const VISIT_ID = '9f1f6f3e-3a0c-4f0e-8f0a-6a3f0a1b2c3d'

afterEach(() => { document.body.innerHTML = ''; setCurrentVisit(null) })

describe('內容興趣統計（2026-11-11）', () => {
  it('來源代碼、內部標記和後端一致', () => {
    const models = read('../../backend/app/operations/models.py')
    const line = models.split('\n').find((text) => text.startsWith('ENGAGEMENT_SOURCES = ('))!
    expect([...line.matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([...ENGAGEMENT_SOURCES])
    expect(models).toContain(`ENGAGEMENT_BOOKED_ACTION = "${BOOKED_ACTION}"`)
    expect(models).toContain(`ENGAGEMENT_READ_ACTION = "${READ_ACTION}"`)
  })

  it('元件上標的區塊與互動代碼都合格式', () => {
    const names = ['HeroVideo', 'AboutSection', 'DayExperience', 'CampusBoard', 'HomeNewsTransition', 'HomeStories', 'AboutContent', 'AdmissionContent', 'CurriculumContent', 'EnvironmentContent', 'AnniversaryContent', 'NewsArticleContent', 'NewsIndexContent']
    const keys = names.flatMap((name) => [...read(`../app/components/${name}.vue`).matchAll(/ data-track-(?:section|action)="([^"]+)"/g)].map((m) => m[1]!))
    expect(keys.length).toBeGreaterThanOrEqual(30)
    expect(keys.filter((key) => !ENGAGEMENT_KEY.test(key))).toEqual([])
  })

  it('來源只分成代碼：廣告參數優先，再看 utm、來源網站、App 內建瀏覽器', () => {
    expect(classifySource('', '', ORIGIN)).toBe('direct')
    expect(classifySource(`${ORIGIN}/about`, '', ORIGIN)).toBe('direct')
    expect(classifySource('https://www.google.com.tw/', '', ORIGIN)).toBe('search')
    expect(classifySource('https://www.google.com/', '?gclid=abc', ORIGIN)).toBe('ads')
    expect(classifySource('', '?utm_source=facebook&utm_medium=cpc', ORIGIN)).toBe('ads')
    expect(classifySource('https://l.facebook.com/', '', ORIGIN)).toBe('facebook')
    expect(classifySource('', '?fbclid=xyz', ORIGIN)).toBe('facebook')
    expect(classifySource('', '?utm_source=line_oa', ORIGIN)).toBe('line')
    expect(classifySource('https://l.instagram.com/', '', ORIGIN)).toBe('instagram')
    expect(classifySource('https://www.youtube.com/watch', '', ORIGIN)).toBe('youtube')
    expect(classifySource('https://blog.example.org/post', '', ORIGIN)).toBe('other')
    expect(classifySource('', '', ORIGIN, 'Mozilla/5.0 (iPhone) Safari Line/14.1.0')).toBe('line')
    expect(classifySource('', '', ORIGIN, 'Mozilla/5.0 [FBAN/FBIOS;FBAV/450.0]')).toBe('facebook')
    expect(classifySource('not a url', '', ORIGIN)).toBe('direct')
  })

  it('分頁內的代碼與來源存 sessionStorage，換頁沿用、壞掉重來', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const first = engagementSession(storage, () => 'search')
    expect(first.source).toBe('search')
    expect(engagementSession(storage, () => 'direct')).toEqual(first)
    store.set('ivy-engagement', '{"id":1,"source":"https://evil"}')
    expect(engagementSession(storage, () => 'line').source).toBe('line')
    expect(engagementSession(null, () => 'direct').id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('累計停留、捲動、區塊與互動；沒有變動不重送', () => {
    const visit = startVisit('/news/garden', SESSION, 'mobile', VISIT_ID)!
    visit.tick(1000, 'article', 31.4)
    visit.tick(60_000, 'article', 80) // 計時器被延後：一次最多算 2 秒
    visit.tick(1000, null, 55)
    visit.tick(500, 'Bad Key', Number.NaN)
    visit.action('story_open'); visit.action('story_open'); visit.action('BAD')
    visit.mark(READ_ACTION); visit.mark(READ_ACTION)
    const payload = visit.takePayload()
    expect(payload).toEqual({
      event: 'engagement', id: VISIT_ID, session: SESSION.id, page: 'news', campus: null, device: 'mobile', item: 'garden',
      source: 'facebook', active_ms: 4500, scroll: 80, sections: { article: 3000 }, actions: { story_open: 2, read_end: 1 }
    })
    expect(validateEngagement(payload)).toEqual(payload)
    expect(visit.takePayload()).toBeNull()
    visit.tick(1000, 'related', 80)
    expect(visit.takePayload()?.sections).toEqual({ article: 3000, related: 1000 })
    expect(startVisit('/admin/login', SESSION, 'desktop')).toBeNull()
    expect(startVisit('/visit/yihua', SESSION, 'desktop', VISIT_ID)!.takePayload()).toMatchObject({ page: 'visit', campus: 'yihua' })
  })

  it('元件回報的互動記在目前這一頁；統計關閉時不做事', () => {
    trackEngagementAction(BOOKED_ACTION)
    const visit = startVisit('/visit', SESSION, 'desktop', VISIT_ID)!
    setCurrentVisit(visit)
    trackEngagementAction(BOOKED_ACTION)
    expect(visit.takePayload()?.actions).toEqual({ booking_done: 1 })
  })

  it('互動只記打開：已展開的再點一次不算', () => {
    document.body.innerHTML = `
      <button id="a" data-track-action="polaroid_lunch" aria-expanded="false"><span id="inner"></span></button>
      <button id="b" data-track-action="polaroid_rest" aria-expanded="true"></button>
      <details><summary id="c" data-track-action="faq_fees"><span id="q"></span></summary></details>
      <details open><summary id="d" data-track-action="faq_age"></summary></details>
      <a id="e" data-track-action="Bad Key"></a><p id="f"></p>`
    const key = (id: string) => actionKeyOf(document.getElementById(id))
    expect([key('inner'), key('b'), key('q'), key('d'), key('e'), key('f')]).toEqual(['polaroid_lunch', null, 'faq_fees', null, null, null])
  })

  it('畫面中央落在哪個區塊', () => {
    document.body.innerHTML = '<section data-track-section="day"><p id="p"></p></section><div id="dialog"></div>'
    const at = (id: string) => sectionKeyAt({ elementFromPoint: () => document.getElementById(id) }, 390, 844)
    expect([at('p'), at('dialog')]).toEqual(['day', null])
  })

  it('消息代號只收單純英數；驗證擋掉多餘欄位與不合理的值', () => {
    expect([newsItemOf('/news/garden-2?x=1'), newsItemOf('/news'), newsItemOf('/news/%E6%B6%88')]).toEqual(['garden-2', undefined, undefined])
    const base = startVisit('/', SESSION, 'desktop', VISIT_ID)!.takePayload()!
    expect(validateEngagement(base)).toEqual(base)
    for (const bad of [
      { ...base, referrer: 'https://www.facebook.com/' },
      { ...base, source: 'https://example.com' },
      { ...base, campus: 'yihua' },
      { ...base, item: 'garden' },
      { ...base, active_ms: 1_800_001 },
      { ...base, scroll: 101 },
      { ...base, session: 'abc' },
      { ...base, sections: { Hero: 1 } },
      { ...base, actions: { faq: 0 } },
      { ...base, sections: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`s${i}`, 1])) }
    ]) expect(validateEngagement(bad)).toBeNull()
  })
})
