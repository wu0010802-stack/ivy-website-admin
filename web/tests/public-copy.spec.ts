import { expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { publicCopy } from '../app/utils/public-copy'

it('修正已知原型說明，保留示意新聞與 CMS 自訂內容，不杜撰招生條件', () => {
  const site = fixture as unknown as SiteContent
  const result = publicCopy(site)
  expect(result.siteMeta.description).not.toContain('提案')
  expect(result.campuses[0]!.faq.items[0]!.a).not.toContain('prototype')
  expect(result.campuses[4]!.faq.items.some((item) => item.a.includes(site.campuses[4]!.address))).toBe(true)
  expect(result.news.sampleNote).toBe(site.news.sampleNote)
  expect(result.booking.consentText).not.toContain('不會傳送')
  expect(result.footer.bottomNote).toBe('')
  expect(publicCopy({ ...site, footer: { ...site.footer, bottomNote: 'CMS 自訂備註' } }).footer.bottomNote).toBe('CMS 自訂備註')
  expect(publicCopy({ ...site, siteMeta: { ...site.siteMeta, description: 'CMS 正式自訂內容' } }).siteMeta.description).toBe('CMS 正式自訂內容')
  expect(site.siteMeta.description).toContain('提案')
})
