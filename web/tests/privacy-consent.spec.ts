import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { DEFAULT_PRIVACY_TITLE, privacyNotice, privacyParagraphs } from '../app/utils/privacy-notice'
import { validateVisitContact } from '../app/utils/visit-form'
import { useCampusBooking } from '../app/composables/useCampusBooking'

afterEach(() => vi.unstubAllGlobals())

const booking = {
  cta_label: '預約參觀',
  cta_label_en: 'Book a Visit'
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
    expect(legacy.booking.privacyNotice).toBeNull()

    const withNotice = applyContentOverlay(site, {
      booking_content: { ...booking, privacy_title: '隱私權說明', privacy_sections: [{ heading: '', body: '資料只用於安排參觀。' }] }
    })
    expect(withNotice.booking.privacyNotice).toEqual({ title: '隱私權說明', sections: [{ heading: '', body: '資料只用於安排參觀。' }] })
  })
})

describe('參觀人數', () => {
  it('2026-10-03 起官網表單不問參觀人數，也不擋送出', () => {
    const contact = { parentName: '陳媽媽', phone: '0912345678' }
    expect(validateVisitContact(contact)).toEqual({})
    const form = readFileSync(fileURLToPath(new URL('../app/components/VisitForm.vue', import.meta.url)), 'utf8')
    expect(form).not.toContain('參觀人數')
  })
})

describe('公開預約設定（2026-10-02 起官網預約不用勾選同意）', () => {
  it('只帶個資使用說明，不再帶同意文字與版本', async () => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      campus_key: 'yihua', mode: 'slots', version: 3, line_url: null, phone: null, external_url: null, message: null,
      privacy_notice: { title: '', sections: [{ heading: '蒐集目的', body: '安排參觀。' }] }
    }))
    let fetchConfig!: () => Promise<Record<string, unknown>>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<Record<string, unknown>>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    const config = await fetchConfig()
    expect(config).not.toHaveProperty('consent_revision_id')
    expect(config).not.toHaveProperty('consent_text')
    expect(config.privacy_notice).toEqual({ title: DEFAULT_PRIVACY_TITLE, sections: [{ heading: '蒐集目的', body: '安排參觀。' }] })
  })

  it('沒有個資說明時為 null', async () => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ campus_key: 'yihua', mode: 'slots', version: 1, line_url: null, phone: null, external_url: null, message: null }))
    let fetchConfig!: () => Promise<Record<string, unknown>>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<Record<string, unknown>>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    const config = await fetchConfig()
    expect(config.privacy_notice).toBeNull()
  })

  it('預約表單沒有同意勾選，也不送同意欄位；有個資說明才給閱讀入口', () => {
    const form = readFileSync(fileURLToPath(new URL('../app/components/VisitForm.vue', import.meta.url)), 'utf8')
    expect(form).not.toMatch(/type="checkbox"[^>]*name="consent"/)
    expect(form).not.toContain('consent_given')
    expect(form).not.toContain('consent_revision_id')
    expect(form).toMatch(/<PrivacyNoticeDialog\s+v-if="privacyNotice &&/)
  })
})
