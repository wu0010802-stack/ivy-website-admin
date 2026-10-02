import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import {
  footerPrivacyEntry,
  formPrivacyEntry,
  parseInlines,
  parsePolicyBody,
  policyAnchor,
  policyDateLabel
} from '../app/utils/privacy-policy'
import { privacySeo, sitemapXml } from '../app/utils/seo'
import { previewPage } from '../app/utils/draft-preview'

const site = fixture as unknown as SiteContent
const text = (value: string) => ({ type: 'text', text: value })

describe('政策內文解析', () => {
  it('空行分段；同一段內的換行保留', () => {
    expect(parsePolicyBody('第一段\n\n第二段第一行\n第二段第二行')).toEqual([
      { type: 'paragraph', inlines: [text('第一段')] },
      { type: 'paragraph', inlines: [text('第二段第一行\n第二段第二行')] }
    ])
  })

  it('「- 」開頭的連續行合成一個清單，清單前後的文字各是一段', () => {
    expect(parsePolicyBody('我們蒐集：\n- 稱呼\n- 電話\n\n結尾')).toEqual([
      { type: 'paragraph', inlines: [text('我們蒐集：')] },
      { type: 'list', items: [[text('稱呼')], [text('電話')]] },
      { type: 'paragraph', inlines: [text('結尾')] }
    ])
  })

  it('Windows 換行與前後空白不影響結果', () => {
    expect(parsePolicyBody('\r\n甲\r\n\r\n- 乙\r\n')).toEqual([
      { type: 'paragraph', inlines: [text('甲')] },
      { type: 'list', items: [[text('乙')]] }
    ])
  })

  it('空內文沒有任何區塊', () => {
    expect(parsePolicyBody('')).toEqual([])
    expect(parsePolicyBody('  \n\n ')).toEqual([])
  })

  it('清單項目裡的網址也會變成連結', () => {
    expect(parsePolicyBody('- 詳見 https://a.example/x')).toEqual([
      { type: 'list', items: [[text('詳見 '), { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' }]] }
    ])
  })
})

describe('連結不吃標點', () => {
  it('只有 https:// 網址變成連結，全形標點留在文字', () => {
    expect(parseInlines('詳見 https://policies.google.com/privacy。')).toEqual([
      text('詳見 '),
      { type: 'link', text: 'https://policies.google.com/privacy', href: 'https://policies.google.com/privacy' },
      text('。')
    ])
  })

  it('括號與句點不算網址的一部分', () => {
    expect(parseInlines('(見 https://a.example/x).')).toEqual([
      text('(見 '),
      { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' },
      text(').')
    ])
    expect(parseInlines('https://a.example/x.')).toEqual([
      { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' },
      text('.')
    ])
  })

  it('http://、javascript:、mailto: 一律照原文顯示、不變連結', () => {
    expect(parseInlines('http://a.example 與 javascript:alert(1) 與 mailto:a@b.c')).toEqual([
      text('http://a.example 與 javascript:alert(1) 與 mailto:a@b.c')
    ])
  })

  it('HTML 字元照原文顯示（渲染時由 Vue 跳脫）', () => {
    const raw = '<script>alert("x")</script> & <b>粗</b>'
    expect(parseInlines(raw)).toEqual([text(raw)])
  })
})

describe('日期標籤與錨點', () => {
  it('YYYY-MM-DD 轉成「2026 年 10 月 3 日」；空值或壞格式回空字串', () => {
    expect(policyDateLabel('2026-10-03')).toBe('2026 年 10 月 3 日')
    expect(policyDateLabel('2026-01-09')).toBe('2026 年 1 月 9 日')
    for (const bad of ['', null, undefined, '2026/10/03', '2026-13-40', '2026-02-30', 'Invalid Date']) {
      expect(policyDateLabel(bad as string | null | undefined)).toBe('')
    }
  })

  it('錨點從 1 起算', () => {
    expect(policyAnchor(0)).toBe('privacy-section-1')
    expect(policyAnchor(11)).toBe('privacy-section-12')
  })
})

describe('入口判斷', () => {
  it('頁尾：有政策顯示連結（取代對話框），只有個資說明顯示對話框，都沒有不顯示', () => {
    expect(footerPrivacyEntry(true, true)).toBe('policy-link')
    expect(footerPrivacyEntry(true, false)).toBe('policy-link')
    expect(footerPrivacyEntry(false, true)).toBe('notice-dialog')
    expect(footerPrivacyEntry(false, false)).toBe('none')
  })

  it('預約表單：兩者都有→對話框加完整政策連結，只有政策→連結，只有說明→對話框', () => {
    expect(formPrivacyEntry(true, true)).toBe('dialog-with-policy')
    expect(formPrivacyEntry(true, false)).toBe('policy-link')
    expect(formPrivacyEntry(false, true)).toBe('dialog')
    expect(formPrivacyEntry(false, false)).toBe('none')
  })
})

describe('已發布內容疊進 SiteContent', () => {
  it('發布後有 privacyPolicy，沒填更新日期變空字串；沒發布就沒有', () => {
    const live = { title: '隱私權政策', updated_on: '2026-10-03', sections: [{ heading: '甲', body: '乙' }] }
    expect(applyContentOverlay(site, { privacy_policy: live }, {}).privacyPolicy).toEqual({
      title: '隱私權政策',
      updatedOn: '2026-10-03',
      sections: [{ heading: '甲', body: '乙' }]
    })
    expect(applyContentOverlay(site, { privacy_policy: { ...live, updated_on: null } }, {}).privacyPolicy?.updatedOn).toBe('')
    expect(applyContentOverlay(site, {}, {}).privacyPolicy).toBeUndefined()
  })
})

describe('SEO 與 sitemap', () => {
  it('標題、描述固定，canonical 指向 /privacy', () => {
    const withPolicy = { ...site, privacyPolicy: { title: '隱私權政策', updatedOn: '2026-10-03', sections: [] } } as SiteContent
    const seo = privacySeo(withPolicy, 'https://ivy.example')
    expect(seo.title).toBe(`隱私權政策｜${site.siteMeta.brandName}`)
    expect(seo.description).toBe('常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。')
    expect(seo.canonical).toBe('https://ivy.example/privacy')
  })

  it('只有已發布才列進 sitemap', () => {
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!])).not.toContain('/privacy')
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!], undefined, { privacy: false })).not.toContain('/privacy')
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!], undefined, { privacy: true })).toContain('<loc>https://ivy.example/privacy</loc>')
  })
})

describe('元件不用 v-html，連結另開並防 opener', () => {
  const source = readFileSync(fileURLToPath(new URL('../app/components/PrivacyPolicyContent.vue', import.meta.url)), 'utf8')
  it('原始碼檢查', () => {
    expect(source).not.toContain('v-html')
    expect(source).toContain('rel="noopener noreferrer"')
    expect(source).toContain('（另開新視窗）')
  })
})

describe('草稿預覽', () => {
  it('?page=privacy 是獨立頁；其餘照舊', () => {
    expect(previewPage({ page: 'privacy' })).toBe('privacy')
    expect(previewPage({ page: 'admission' })).toBe('admission')
    expect(previewPage({ page: 'unknown' })).toBe('home')
  })

  it('預覽會讀 privacy_policy 草稿，預覽頁有對應分支', () => {
    const composable = readFileSync(fileURLToPath(new URL('../app/composables/useDraftPreview.ts', import.meta.url)), 'utf8')
    expect(composable).toContain("'privacy_policy'")
    const page = readFileSync(fileURLToPath(new URL('../app/pages/preview.vue', import.meta.url)), 'utf8')
    expect(page).toContain("page === 'privacy'")
    expect(page).toContain('PrivacyPolicyContent')
  })
})

describe('入口元件接線', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  it('頁尾用 footerPrivacyEntry，表單用 formPrivacyEntry，政策連結都開新分頁', () => {
    const footer = read('../app/components/SiteFooter.vue')
    expect(footer).toContain('footerPrivacyEntry')
    expect(footer).toContain('to="/privacy"')
    const form = read('../app/components/VisitForm.vue')
    expect(form).toContain('formPrivacyEntry')
    expect(form).toContain('href="/privacy"')
    expect(form).toContain('rel="noopener noreferrer"')
    const dialog = read('../app/components/PrivacyNoticeDialog.vue')
    expect(dialog).toContain('完整隱私權政策')
    expect(dialog).toContain('rel="noopener noreferrer"')
  })
})
