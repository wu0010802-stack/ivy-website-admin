import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { DEFAULT_PRIVACY_TITLE, privacyNotice, privacyParagraphs } from '../app/utils/privacy-notice'
import { isValidPartySize, PARTY_SIZE_OPTIONS, validateVisitContact } from '../app/utils/visit-form'
import { useCampusBooking } from '../app/composables/useCampusBooking'

afterEach(() => vi.unstubAllGlobals())

const booking = {
  cta_label: '預約參觀',
  cta_label_en: 'Book a Visit',
  consent_text: '我同意園方使用本次填寫的資料聯絡與安排參觀。',
  banner_title_template: '歡迎{campusNameOrIvy}',
  banner_body: '期待相遇',
  banner_button_label: '預約'
}

describe('隱私／個資使用說明', () => {
  it('沒有段落就不顯示入口；標題留空用預設標題', () => {
    expect(privacyNotice('', [])).toBeNull()
    expect(privacyNotice('個資使用說明', undefined)).toBeNull()
    // 只有空白內文的段落等於沒有。
    expect(privacyNotice('標題', [{ heading: '小標', body: '  ' }])).toBeNull()
    expect(privacyNotice('', [{ heading: ' 蒐集目的 ', body: '安排參觀。' }])).toEqual({
      title: DEFAULT_PRIVACY_TITLE,
      sections: [{ heading: '蒐集目的', body: '安排參觀。' }]
    })
  })

  it('內文照換行分段，空行不留', () => {
    expect(privacyParagraphs('第一段\n\n第二段\n  \n第三段')).toEqual(['第一段', '第二段', '第三段'])
  })

  it('已發布的預約文案帶隱私說明；舊版本沒有欄位時不顯示入口', () => {
    const site = fixture as unknown as SiteContent
    const legacy = applyContentOverlay(site, { booking_content: booking })
    expect(legacy.booking.consentText).toBe(booking.consent_text)
    expect(legacy.booking.privacyNotice).toBeNull()

    const withNotice = applyContentOverlay(site, {
      booking_content: { ...booking, privacy_title: '隱私權說明', privacy_sections: [{ heading: '', body: '資料只用於安排參觀。' }] }
    })
    expect(withNotice.booking.privacyNotice).toEqual({ title: '隱私權說明', sections: [{ heading: '', body: '資料只用於安排參觀。' }] })
  })
})

describe('參觀人數', () => {
  it('下拉選項 1–10，未選或超出範圍都要提示', () => {
    expect(PARTY_SIZE_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const contact = { parentName: '陳媽媽', phone: '0912345678', consent: true }
    expect(validateVisitContact({ ...contact, partySize: '' }).partySize).toBe('請選擇參觀人數。')
    expect(validateVisitContact({ ...contact, partySize: '3' })).toEqual({})
    // 舊呼叫端不帶人數時不檢查。
    expect(validateVisitContact(contact)).toEqual({})
    for (const bad of ['0', '11', '2.5', 'abc']) expect(isValidPartySize(bad)).toBe(false)
    expect(isValidPartySize(10)).toBe(true)
  })
})

describe('公開預約設定的同意版本', () => {
  it('勾選框文字與送單版本來自同一份公開預約設定', async () => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      campus_key: 'yihua', mode: 'inquiry', version: 3, line_url: null, phone: null, external_url: null, message: null,
      consent_revision_id: 'rev-7', consent_text: '同意文字第 7 版',
      privacy_notice: { title: '', sections: [{ heading: '蒐集目的', body: '安排參觀。' }] }
    }))
    let fetchConfig!: () => Promise<Record<string, unknown>>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<Record<string, unknown>>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    const config = await fetchConfig()
    expect(config.consent_revision_id).toBe('rev-7')
    expect(config.consent_text).toBe('同意文字第 7 版')
    expect(config.privacy_notice).toEqual({ title: DEFAULT_PRIVACY_TITLE, sections: [{ heading: '蒐集目的', body: '安排參觀。' }] })
  })

  it('舊版 API 沒有同意欄位時為 null', async () => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ campus_key: 'yihua', mode: 'inquiry', version: 1, line_url: null, phone: null, external_url: null, message: null }))
    let fetchConfig!: () => Promise<Record<string, unknown>>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<Record<string, unknown>>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    const config = await fetchConfig()
    expect(config.consent_revision_id).toBeNull()
    expect(config.privacy_notice).toBeNull()
  })
})
