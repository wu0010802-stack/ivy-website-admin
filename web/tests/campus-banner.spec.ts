import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import webFixture from '../server/data/site-fixture.json'
import contentFixture from '../../content/site-fixture.json'
import initialOverlay from './fixtures/overlay-initial-content.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveBookingContent } from '../app/utils/content-overlay'
import { CAMPUS_BANNER_FALLBACK, campusBannerCopy } from '../app/utils/campus-banner'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// 2026-09-29 以前分校頁橫幅寫死的三句；預設內容接上後必須逐字相同，畫面才不變。
const HARD_CODED = {
  title: (name: string) => `親自走一趟，感受${name}的日常。`,
  body: '帶著孩子，也帶著你想了解的事。我們期待與你相遇。',
  button: '預約校園參觀'
}

describe('分校頁預約橫幅讀預約文案', () => {
  it('內建預設內容（兩份 fixture、初始發布內容）與原本寫死的字相同', () => {
    for (const site of [webFixture, contentFixture] as unknown as SiteContent[]) {
      for (const campus of site.campuses) {
        expect(campusBannerCopy(site.booking, campus.name)).toEqual({
          title: HARD_CODED.title(campus.name),
          body: HARD_CODED.body,
          buttonLabel: HARD_CODED.button
        })
      }
    }
    const initial = initialOverlay.booking_content
    expect(initial.banner_title_template).toBe(CAMPUS_BANNER_FALLBACK.titleTemplate)
    expect(initial.banner_body).toBe(CAMPUS_BANNER_FALLBACK.body)
    expect(initial.banner_button_label).toBe(CAMPUS_BANNER_FALLBACK.buttonLabel)
  })

  it('{campusNameOrIvy} 與 {campus} 都換成校名，出現幾次換幾次', () => {
    expect(campusBannerCopy({ bannerTitleTemplate: '來{campusNameOrIvy}走走', bannerBody: 'b', bannerButtonLabel: 'c' }, '仁武校').title)
      .toBe('來仁武校走走')
    expect(campusBannerCopy({ bannerTitleTemplate: '{campus}歡迎你，{campusNameOrIvy}等你', bannerBody: 'b', bannerButtonLabel: 'c' }, '明華校').title)
      .toBe('明華校歡迎你，明華校等你')
    // 沒有代稱就照原文；拼錯的代稱不猜。
    expect(campusBannerCopy({ bannerTitleTemplate: '親自走一趟', bannerBody: 'b', bannerButtonLabel: 'c' }, '義華校').title).toBe('親自走一趟')
    expect(campusBannerCopy({ bannerTitleTemplate: '感受{campusName}', bannerBody: 'b', bannerButtonLabel: 'c' }, '義華校').title).toBe('感受{campusName}')
    // 校名當作一般文字，不被當成 replace 的 `$&` 樣式。
    expect(campusBannerCopy({ bannerTitleTemplate: '感受{campus}', bannerBody: 'b', bannerButtonLabel: 'c' }, 'A$&B').title).toBe('感受A$&B')
  })

  it('欄位空白（含只有空白）或沒有這些欄位時，退回原本的字', () => {
    const blank = campusBannerCopy({ bannerTitleTemplate: '', bannerBody: '  ', bannerButtonLabel: '\n' }, '崇德校')
    expect(blank).toEqual({ title: HARD_CODED.title('崇德校'), body: HARD_CODED.body, buttonLabel: HARD_CODED.button })
    expect(campusBannerCopy(null, '國際校').title).toBe(HARD_CODED.title('國際校'))
    expect(campusBannerCopy({}, '國際校').buttonLabel).toBe(HARD_CODED.button)
    // 只清空其中一欄，其他欄照後台。
    expect(campusBannerCopy({ bannerTitleTemplate: '新標題', bannerBody: '', bannerButtonLabel: '找時間來看看' }, '義華校'))
      .toEqual({ title: '新標題', body: HARD_CODED.body, buttonLabel: '找時間來看看' })
    // 前後空白不帶進畫面。
    expect(campusBannerCopy({ bannerTitleTemplate: '  來{campus}  ', bannerBody: ' 內文 ', bannerButtonLabel: ' 按鈕 ' }, '義華校'))
      .toEqual({ title: '來義華校', body: '內文', buttonLabel: '按鈕' })
  })

  it('發布的預約文案經 content-overlay 疊上後，橫幅用後台的字', () => {
    const site = webFixture as unknown as SiteContent
    const published: LiveBookingContent = {
      ...(initialOverlay.booking_content as LiveBookingContent),
      banner_title_template: '週末也歡迎來{campusNameOrIvy}',
      banner_body: '先看看教室，再決定。',
      banner_button_label: '找時間來看看'
    }
    const next = applyContentOverlay(site, { booking_content: published })
    expect(campusBannerCopy(next.booking, '仁武校')).toEqual({
      title: '週末也歡迎來仁武校',
      body: '先看看教室，再決定。',
      buttonLabel: '找時間來看看'
    })
  })

  it('分校頁與草稿預覽都用同一個橫幅元件，文字不再寫死', () => {
    const banner = read('../app/components/CampusVisitBanner.vue')
    expect(banner).toContain('campusBannerCopy(props.booking, props.campus.name)')
    expect(banner).toContain('data-cta-entry="campus_banner"')
    expect(banner).toContain(':label="banner.buttonLabel"')
    expect(banner).not.toContain(HARD_CODED.body)
    expect(banner).not.toContain('label="預約校園參觀"')

    const main = read('../app/components/CampusPageMain.vue')
    expect(main).toContain('<CampusVisitBanner :campus="campus" :booking="booking" />')
    expect(main).not.toContain('class="visit-banner"')
    expect(read('../app/pages/campuses/[key].vue')).toContain(':booking="data.content.booking"')

    // 草稿預覽：分校頁用草稿的預約文案；預約文案頁（後台「預覽」開的那頁）也附一個橫幅例子。
    const preview = read('../app/pages/preview.vue')
    expect(preview).toContain(':campus="previewCampus" :booking="draft.booking"')
    expect(preview).toContain(':banner-campus="previewCampus"')
    expect(read('../app/components/BookingDraftPreview.vue')).toContain('<CampusVisitBanner v-if="bannerCampus" :campus="bannerCampus" :booking="booking" />')
  })
})
