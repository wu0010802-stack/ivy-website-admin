import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveAdmissionContent } from '../app/utils/content-overlay'
import { academicYear, classPlan, classTable, cohortOf, parseBirthday, taipeiYmd } from '../app/utils/admission-classes'
import { admissionSeo, llmsTxt, sitemapXml } from '../app/utils/seo'

const site = fixture as unknown as SiteContent

describe('分班對照（舊官網分班表規則）', () => {
  it('9/2 起算新的一屆，9/1 仍屬前一屆', () => {
    expect(cohortOf({ year: 2021, month: 9, day: 2 })).toBe(110)
    expect(cohortOf({ year: 2022, month: 9, day: 1 })).toBe(110)
    expect(cohortOf({ year: 2022, month: 9, day: 2 })).toBe(111)
  })

  it('與舊海報逐格一致：110/9/2–111/9/1 出生，113 幼幼班、117 小一', () => {
    const plan = classPlan({ year: 2022, month: 5, day: 10 }, 115)
    expect(plan.rows.map((r) => [r.year, r.name])).toEqual([[113, '幼幼班'], [114, '小班'], [115, '中班'], [116, '大班'], [117, '小一']])
    expect(plan.summary).toBe('115 學年度，寶貝就讀中班。')
    expect(plan.rows.filter((r) => r.past).map((r) => r.year)).toEqual([113, 114])
  })

  it('還沒到幼幼班、或已上小學，摘要講清楚', () => {
    expect(classPlan({ year: 2024, month: 10, day: 3 }, 115).summary).toBe('寶貝 116 學年度（2027 年 8 月起）可以開始讀幼幼班。')
    expect(classPlan({ year: 2015, month: 1, day: 1 }, 115).summary).toBe('寶貝已到國小年齡囉。')
  })

  it('學年度 8/1 換年，並用台北日期（UTC 7/31 16:00 已是台北 8/1）', () => {
    expect(academicYear({ year: 2026, month: 7, day: 31 })).toBe(114)
    expect(academicYear({ year: 2026, month: 8, day: 1 })).toBe(115)
    expect(taipeiYmd(new Date('2026-07-31T16:00:00Z'))).toEqual({ year: 2026, month: 8, day: 1 })
  })

  it('出生區間表：115 學年度大班是 109/9/2–110/9/1', () => {
    const table = classTable([115, 116])
    expect(table.map((r) => r.name)).toEqual(['幼幼班', '小班', '中班', '大班'])
    expect(table[3]!.ranges[0]).toEqual({ roc: '109/9/2 – 110/9/1', ad: '2020.9.2 – 2021.9.1' })
  })

  it('生日輸入要是存在的日期', () => {
    expect(parseBirthday('2022-05-10')).toEqual({ year: 2022, month: 5, day: 10 })
    for (const bad of ['', '2022-02-30', '2022/05/10', '22-05-10']) expect(parseBirthday(bad)).toBeNull()
  })
})

describe('入學資訊內容（後台 admission_content）', () => {
  const live: LiveAdmissionContent = {
    notice: '', intro: '新的介紹',
    steps: [{ when: '隨時', title: '來電', text: '' }],
    phases: [], uniform_week: [], uniform_note: '', pickup_notes: ['帶接送證'], registration_notes: [],
    fee_intro: '依規定辦理', subsidies: [{ amount: '1,000', unit: '元', who: '全部', by: '市府' }],
    allowance_title: '津貼', allowance: [], allowance_note: '',
    refunds: [{ title: '請假', groups: [{ label: '退費', lines: ['按日數退'] }], note: '' }]
  }

  it('後台發布的內容整組取代 fixture，頂層欄位轉成 camelCase，fixture 不被改動', () => {
    const result = applyContentOverlay(site, { admission_content: live })
    expect(result.admission.intro).toBe('新的介紹')
    expect(result.admission.notice).toBe('')
    expect(result.admission.pickupNotes).toEqual(['帶接送證'])
    expect(result.admission.feeIntro).toBe('依規定辦理')
    expect(result.admission.refunds[0]!.groups[0]!.lines).toEqual(['按日數退'])
    expect(site.admission.steps).toHaveLength(6)
  })

  it('沒有發布過就保留 fixture 原文', () => {
    expect(applyContentOverlay(site, {}).admission).toEqual(site.admission)
  })

  it('選單與頁尾都有入學資訊入口', () => {
    expect(site.siteMeta.primaryNav.some((item) => item.href === '/admission')).toBe(true)
    expect(site.footer.links.some((item) => item.href === '/admission')).toBe(true)
  })
})

describe('入學資訊的搜尋資料', () => {
  it('canonical、麵包屑與 sitemap／llms.txt 都指向 /admission', () => {
    const seo = admissionSeo(site, 'https://ivy.example')
    expect(seo.canonical).toBe('https://ivy.example/admission')
    expect(seo.title).toContain('入學資訊')
    expect(JSON.stringify(seo.graph)).toContain('"name":"入學資訊"')
    expect(sitemapXml('https://ivy.example', [])).toContain('<loc>https://ivy.example/admission</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/admission)')
  })

  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = admissionSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
})
