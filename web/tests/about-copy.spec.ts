import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutCopy } from '../app/utils/about-copy'
import { publicCopy } from '../app/utils/public-copy'

// 2026-11-04 TA 檢視：首頁關於段可以換行分段；摘要（手機收合時只露這句）＝第一段的第一句。
describe('首頁關於段的摘要與分段（utils/about-copy.ts）', () => {
  it('沒有換行的舊內容照舊：摘要是第一句，其餘接在同一段，沒有其他段落', () => {
    const site = fixture as unknown as SiteContent
    const copy = aboutCopy(site.home.about.bodyText)
    expect(copy.lead).toBe('自 1997 年在高雄創立，常春藤以專業保育與溫暖陪伴，為孩子打造安全、安心的成長環境。')
    expect(copy.lead + copy.rest).toBe(site.home.about.bodyText)
    expect(copy.more).toEqual([])
  })

  it('正式站的三段內容：摘要是第一段第一句（交代五所學校），第一段其餘與後兩段收進「閱讀完整介紹」', () => {
    const copy = aboutCopy(publicCopy(fixture as unknown as SiteContent).home.about.bodyText)
    expect(copy.lead).toBe('民國\u00a086\u00a0年，第一間常春藤在高雄三民區義華路成立；之後有了明華、崇德、國際和仁武，現在是五所幼兒園。')
    expect(copy.rest).toMatch(/^近三十年來/)
    expect(copy.more).toHaveLength(2)
  })

  it('只有一句、空字串、Windows 換行、空白行', () => {
    expect(aboutCopy('只有一句。')).toEqual({ lead: '只有一句。', rest: '', more: [] })
    expect(aboutCopy('沒有句號的一段')).toEqual({ lead: '沒有句號的一段', rest: '', more: [] })
    expect(aboutCopy('')).toEqual({ lead: '', rest: '', more: [] })
    expect(aboutCopy('第一句。第二句。\r\n\r\n  第二段。\n')).toEqual({ lead: '第一句。', rest: '第二句。', more: ['第二段。'] })
  })
})
