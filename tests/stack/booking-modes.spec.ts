import { expect, test, type Page } from '@playwright/test'
import { adminApi, type AdminApi } from './api'

// 另外三種預約方式（2026-10-08）：LINE／電話／外部網站。校區改成這三種之一後，
// 官網預約頁不出現表單，只出現「歡迎與{校名}聯絡」和對應的聯絡鈕；選校清單的卡片也標出同一種方式。
// 單元測試（web/tests/booking-action.spec.ts）只驗純函式，這裡在真瀏覽器、真後端、真 Nuxt build 上驗畫面。
//
// 用國際校：stack 其他測試沒動它（義華、明華是自選場次，崇德給參觀場次與截圖用），
// 初始化後它是暫停。設定只靠 API 改，開頭記下原本的設定、結尾無論成敗都還原。
// 家長看到的畫面不登入：用預設的 page（沒有 storageState），園方身分只拿來呼叫 API。
const CAMPUS = 'international'
const CAMPUS_NAME = '國際校'
const CONFIG_PATH = `/admin/booking-config/${CAMPUS}`
// resolveBookingAction 的暫停預設說明；初始化後的暫停設定沒有填 message，還原時用它補上。
const DEFAULT_PAUSED_MESSAGE = '目前暫停參觀預約，請關注最新消息。'
const DEFAULT_CONTACT_COPY = '透過以下方式聯絡園所，一起安排合適的參觀時間。'

interface BookingConfigOut {
  mode: string
  version: number
  line_url: string | null
  phone: string | null
  external_url: string | null
  message: string | null
  parent_change_deadline_hours: number
}

let api: AdminApi
let original: BookingConfigOut | undefined

/** 把國際校切成指定方式；沒帶的欄位寫成空值，不留上一個測試的網址。 */
async function setMode(mode: string, fields: Partial<Pick<BookingConfigOut, 'line_url' | 'phone' | 'external_url' | 'message'>>): Promise<void> {
  const current = await api.get<BookingConfigOut>(CONFIG_PATH)
  await api.send('PATCH', CONFIG_PATH, {
    expected_version: current.version,
    mode,
    line_url: null,
    phone: null,
    external_url: null,
    message: null,
    ...fields,
  })
}

test.beforeAll(async () => {
  api = await adminApi('super_admin')
  original = await api.get<BookingConfigOut>(CONFIG_PATH)
})

test.afterAll(async () => {
  try {
    if (!original) return
    // 暫停方式一定要有說明才存得進去（BOOKING_MODE_NOT_READY）；初始化後的設定是暫停但沒有說明，
    // 改用官網沒填說明時顯示的預設句，家長看到的內容不變。
    const message = original.mode === 'paused' && !original.message?.trim() ? DEFAULT_PAUSED_MESSAGE : original.message
    const current = await api.get<BookingConfigOut>(CONFIG_PATH)
    await api.send('PATCH', CONFIG_PATH, {
      expected_version: current.version,
      mode: original.mode,
      line_url: original.line_url,
      phone: original.phone,
      external_url: original.external_url,
      message,
      parent_change_deadline_hours: original.parent_change_deadline_hours,
    })
  } finally {
    await api?.dispose()
  }
})

/** 開國際校預約頁，回傳聯絡區（section 有 aria-labelledby，是具名的 region）。 */
async function openContactStep(page: Page) {
  await page.goto(`/visit/${CAMPUS}`)
  const contact = page.getByRole('region', { name: `歡迎與${CAMPUS_NAME}聯絡` })
  await expect(contact.getByRole('heading', { level: 2, name: `歡迎與${CAMPUS_NAME}聯絡` })).toBeVisible()
  return contact
}

/** 不是自選場次，所以沒有表單：要在聯絡區出現之後才查，避免載入中就誤判成沒有。 */
async function expectNoBookingForm(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '確認預約' })).toHaveCount(0)
}

/** 選校清單（/visit）上國際校那張卡標出的預約方式；標籤是載入後才補上的，expect 會等。 */
async function expectCampusModeLabel(page: Page, label: string): Promise<void> {
  await page.goto('/visit')
  const choices = page.getByRole('group', { name: '想參觀的校區' })
  await expect(choices).toBeVisible()
  await expect(choices.locator('label').filter({ hasText: CAMPUS_NAME }).getByText(label, { exact: true })).toBeVisible()
}

test.describe(`${CAMPUS_NAME}：不走線上表單的預約方式`, () => {
  test('LINE：聯絡區只有外開的 LINE 鈕，沒有表單；選校清單標「LINE 洽詢」', async ({ page }) => {
    const lineUrl = 'https://line.me/R/ti/p/@ivy-e2e-test'
    await setMode('line', { line_url: lineUrl })

    const contact = await openContactStep(page)
    // 沒填說明就用預設的聯絡句。
    await expect(contact.getByRole('status')).toHaveText(DEFAULT_CONTACT_COPY)
    const line = contact.getByRole('link', { name: '透過 LINE 聯絡', exact: true })
    await expect(line).toBeVisible()
    await expect(line).toHaveAttribute('href', lineUrl)
    await expect(line).toHaveAttribute('target', '_blank')
    await expect(line).toHaveAttribute('rel', /noopener/)
    // 校區有電話、主鈕不是電話時，另補一顆致電鈕。
    await expect(contact.getByRole('link', { name: new RegExp(`致電${CAMPUS_NAME}`) })).toHaveAttribute('href', /^tel:/)
    await expectNoBookingForm(page)

    await expectCampusModeLabel(page, 'LINE 洽詢')
  })

  test('電話：聯絡區的主鈕是 tel: 連結（同頁撥號、不外開），沒有表單；選校清單標「來電洽詢」', async ({ page }) => {
    const phone = '07-0000000'
    await setMode('phone', { phone, message: '歡迎來電，我們會幫你安排參觀時間（e2e 測試說明）。' })

    const contact = await openContactStep(page)
    // 園方填的說明取代預設句。
    await expect(contact.getByRole('status')).toHaveText('歡迎來電，我們會幫你安排參觀時間（e2e 測試說明）。')
    const call = contact.getByRole('link', { name: '致電洽詢', exact: true })
    await expect(call).toBeVisible()
    await expect(call).toHaveAttribute('href', `tel:${phone}`)
    await expect(call).not.toHaveAttribute('target', '_blank')
    // 主鈕已經是電話，不再補校區電話鈕。
    await expect(contact.getByRole('link', { name: new RegExp(`致電${CAMPUS_NAME}`) })).toHaveCount(0)
    await expect(contact.getByRole('link')).toHaveCount(1)
    await expectNoBookingForm(page)

    await expectCampusModeLabel(page, '來電洽詢')
  })

  test('外部網站：聯絡區只有外開的「前往預約網站」鈕，沒有表單；選校清單標「外部網站預約」', async ({ page }) => {
    const externalUrl = 'https://example.com/ivy-booking'
    await setMode('external', { external_url: externalUrl, message: '請到外部網站選擇參觀時段（e2e 測試說明）。' })

    const contact = await openContactStep(page)
    await expect(contact.getByRole('status')).toHaveText('請到外部網站選擇參觀時段（e2e 測試說明）。')
    const external = contact.getByRole('link', { name: '前往預約網站', exact: true })
    await expect(external).toBeVisible()
    await expect(external).toHaveAttribute('href', externalUrl)
    await expect(external).toHaveAttribute('target', '_blank')
    await expect(external).toHaveAttribute('rel', /noopener/)
    await expect(contact.getByRole('link', { name: new RegExp(`致電${CAMPUS_NAME}`) })).toHaveAttribute('href', /^tel:/)
    await expectNoBookingForm(page)

    await expectCampusModeLabel(page, '外部網站預約')
  })
})
