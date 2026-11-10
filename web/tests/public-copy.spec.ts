import { expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import initialOverlay from './fixtures/overlay-initial-content.json'
import type { SiteContent } from '../app/types/site-content'
import type { ContentOverlay } from '../app/utils/content-overlay'
import { publicCopy, withoutRetiredFields } from '../app/utils/public-copy'
import { publishedContent } from '../app/utils/published-content'

// 找出整棵資料樹裡所有名為 _todo 的鍵（含陣列內的物件），回傳路徑。
function todoPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => todoPaths(item, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => (key === '_todo' ? [`${path}._todo`] : []).concat(todoPaths(child, `${path}.${key}`)))
  }
  return []
}

it('修正已知原型說明，保留示意新聞與 CMS 自訂內容，不杜撰招生條件', () => {
  const site = fixture as unknown as SiteContent
  const result = publicCopy(site)
  expect(result.siteMeta.description).not.toContain('提案')
  expect(result.news.sampleNote).toBe(site.news.sampleNote)
  expect(result.footer.bottomNote).toBe('')
  expect(publicCopy({ ...site, footer: { ...site.footer, bottomNote: 'CMS 自訂備註' } }).footer.bottomNote).toBe('CMS 自訂備註')
  expect(publicCopy({ ...site, siteMeta: { ...site.siteMeta, description: 'CMS 正式自訂內容' } }).siteMeta.description).toBe('CMS 正式自訂內容')
  expect(site.siteMeta.description).toContain('提案')
})

it('官網已不顯示的舊欄位不進頁面資料（原型的預約示範說明、熱點等）', () => {
  const site = fixture as unknown as SiteContent
  const raw = fixture as unknown as {
    home: { hero: Record<string, unknown>; campusBoard: Record<string, unknown> }
    dayExperience: Record<string, unknown>
    booking: Record<string, unknown>
    campuses: (Record<string, unknown> & { tourScenes: unknown })[]
  }
  // 2026-10-08 預約同意文字與橫幅、分校簡介與臉書備註、常見問題連同後端欄位一起刪除，
  // fixture 也不再有這些 key。
  for (const key of ['consentText', 'bannerTitleTemplate', 'bannerBody', 'bannerButtonLabel']) expect(raw.booking).not.toHaveProperty(key)
  for (const campus of raw.campuses) for (const key of ['intro', 'description', 'fbNote', 'faq']) expect(campus).not.toHaveProperty(key)
  // 還留著、官網不讀的欄位：預約示範說明與步驟（isDemo／demoNote／steps／fields）。
  expect(raw.booking).toHaveProperty('demoNote')
  const result = publicCopy(site)
  const json = JSON.stringify(result)
  expect(json).not.toContain('這份 prototype 僅示範流程')
  // 原型預約表單的示範說明、步驟與欄位清單（2026-10-05）。
  expect(json).not.toContain('這是官網互動提案')
  expect(json).not.toContain('示範完成，尚未送出預約')
  expect(json).not.toContain('demo-consent')
  expect(json).not.toContain('我了解這是操作示範')
  expect(result.home.hero).not.toHaveProperty('eyebrow')
  expect(result.home.campusBoard).not.toHaveProperty('note')
  expect(result.dayExperience).not.toHaveProperty('sourceNote')
  for (const key of ['isDemo', 'demoNote', 'steps', 'fields']) expect(result.booking).not.toHaveProperty(key)
  expect(Object.keys(result.booking).sort()).toEqual(['ctaLabel', 'ctaLabelEn'])
  for (const campus of result.campuses) {
    expect(campus).not.toHaveProperty('heroPhotoPos')
    if (Array.isArray(campus.tourScenes)) for (const scene of campus.tourScenes) expect(scene).not.toHaveProperty('spots')
  }
  // 頁面用得到的欄位照舊。
  expect(result.campuses.map((c) => c.key)).toEqual(site.campuses.map((c) => c.key))
  expect(result.campuses[0]!.address).toBe(site.campuses[0]!.address)
  expect(result.booking.ctaLabel).toBe(site.booking.ctaLabel)
  expect(withoutRetiredFields(site)).toEqual(withoutRetiredFields(withoutRetiredFields(site)))
  // withoutRetiredFields 不修改傳入的 fixture。
  expect(raw.booking).toHaveProperty('demoNote')
})

it('fixture 的 _todo 維護備註不進公開資料：任何層級都沒有，內部路徑與待辦字句也不外洩', () => {
  const site = fixture as unknown as SiteContent
  // fixture 留著 _todo：後端初始化內容與維護者要看。
  expect(todoPaths(site).length).toBeGreaterThan(0)
  // 正式站的路徑：後台內容疊在 fixture 上，再經 publicCopy。
  const live = publishedContent(site, { schema_version: '1', release_id: 'r1', content: initialOverlay as unknown as ContentOverlay }).content
  for (const result of [publicCopy(site), withoutRetiredFields(site), live]) {
    expect(todoPaths(result)).toEqual([])
    const json = JSON.stringify(result)
    expect(json).not.toContain('design/hero-video-restoration')
    expect(json).not.toContain('非明華校自有粉專')
  }
  // 頁面用得到的欄位照舊（headerPhone 與 hero 只少了 _todo）。
  expect(live.siteMeta.headerPhone.number).toBe(site.siteMeta.headerPhone.number)
  expect(live.home.hero.heroImage).toBeTruthy()
  expect(withoutRetiredFields(site)).toEqual(withoutRetiredFields(withoutRetiredFields(site)))
})

// 2026-11-04 TA 檢視：首頁關於段第一句交代身分並分段、孩子的一天背面改成站上已有的事實、頁尾校區標題直接說是什麼。
it('關於段、孩子的一天背面、頁尾標題：原文一字不差才換，園方改過的照園方的', () => {
  const site = fixture as unknown as SiteContent
  const result = publicCopy(site)
  // 11-05 改成使用者要的新介紹（三段），第一段先交代身分
  const [first, ...rest] = result.home.about.bodyText.split('\n')
  expect(first).toMatch(/^民國\u00a086\u00a0年，第一間常春藤在高雄三民區義華路成立；.*現在是五所幼兒園。/)
  expect(rest).toHaveLength(2)
  expect(result.home.about.bodyText).not.toContain('專業保育與溫暖陪伴')
  const answers = Object.fromEntries(result.dayExperience.moments.map((moment) => [moment.key, moment.answer]))
  expect(answers.hello).toContain('前三天以半天為主')
  expect(answers.home).toContain('30 分鐘')
  // 下雨天怎麼調整站上沒有資料，照舊
  expect(answers.outside).toBe(site.dayExperience.moments.find((moment) => moment.key === 'outside')!.answer)
  for (const answer of Object.values(answers).filter((a) => a !== answers.outside)) expect(answer).not.toMatch(/^(參觀時|可以詢問|可以向園所)/)
  // 頁尾標題 11-05 退回原版，不換
  expect(result.footer.campusListLabel).toBe(site.footer.campusListLabel)
  const custom = publicCopy({
    ...site,
    home: { ...site.home, about: { ...site.home.about, bodyText: 'CMS 自訂介紹。' } },
    dayExperience: { ...site.dayExperience, moments: site.dayExperience.moments.map((moment) => ({ ...moment, answer: 'CMS 自訂答案' })) }
  })
  expect(custom.home.about.bodyText).toBe('CMS 自訂介紹。')
  expect(custom.dayExperience.moments.every((moment) => moment.answer === 'CMS 自訂答案')).toBe(true)
  // 內建內容本身不改（後端初始化讀 fixture）
  expect(site.home.about.bodyText.startsWith('自 1997 年在高雄創立')).toBe(true)
})

// 2026-11-05 使用者要孩子的一天大標下的小字改成英文：原文兩欄都沒改過才換成只留英文。
it('孩子的一天小標：原文只留英文，園方改過的照園方的', () => {
  const site = fixture as unknown as SiteContent
  const day = (eyebrow: string, eyebrowEn: string) => publicCopy({ ...site, dayExperience: { ...site.dayExperience, eyebrow, eyebrowEn } }).dayExperience
  expect(site.dayExperience.eyebrow).toBe('孩子的一天')
  expect(publicCopy(site).dayExperience).toMatchObject({ eyebrow: '', eyebrowEn: 'A DAY AT IVY' })
  // 只改了中文：照園方的中文，英文原文照 10-30 拿掉
  expect(day('園方自訂', 'A DAY AT IVY')).toMatchObject({ eyebrow: '園方自訂', eyebrowEn: '' })
  // 只改了英文：兩欄都照園方的
  expect(day('孩子的一天', 'OUR DAY')).toMatchObject({ eyebrow: '孩子的一天', eyebrowEn: 'OUR DAY' })
  expect(day('孩子的一天', '')).toMatchObject({ eyebrow: '孩子的一天', eyebrowEn: '' })
})

// 2026-11-10 背景影片換成園方校園日常片：後台還存著舊內建影片的說明「義華校 · 遊藝表演」，
// 只在仍用官網內建影片而且說明是舊內建原文時換成新內建文字；園方上傳過影片或改過說明都照園方的。
it('孩子的一天：舊內建影片的說明只在仍用內建影片時換成新內建文字', () => {
  const site = fixture as unknown as SiteContent
  const day = (zh: string, filmSrc = 'assets/day-film.mp4') =>
    publicCopy({ ...site, dayExperience: { ...site.dayExperience, filmSrc, filmCaption: { zh, en: '' } } }).dayExperience.filmCaption.zh
  expect(site.dayExperience.filmCaption.zh).toBe('校園日常紀錄')
  expect(day('義華校 · 遊藝表演')).toBe('校園日常紀錄')
  expect(day('校園日常紀錄')).toBe('校園日常紀錄')
  expect(day('園方自訂的說明')).toBe('園方自訂的說明')
  expect(day('義華校 · 遊藝表演', '/api/website/v1/public/media/abc/video')).toBe('義華校 · 遊藝表演')
})
