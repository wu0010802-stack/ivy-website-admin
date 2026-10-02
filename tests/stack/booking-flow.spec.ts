import { expect, test, type Locator, type Page } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest, type AdminApi } from './api'
import { readMail } from './mail'
import { openAs, pickVisitDate } from './pages'
import { SECOND_CAMPUS, SLOTS_CAMPUS } from './stack-env'

// 預約主流程（2026-09-30 家長自選場次）：家長在官網選場次送出即預約成功 → 從結果頁的修改連結
// 改場次、改資料、取消；確認信寫進本機 sink。每一步都在畫面上操作，只用 API 與 sink 核對結果。

interface ParentForm {
  childName: string
  parentName: string
  phone: string
  email: string
}

async function fillParentForm(page: Page, form: ParentForm): Promise<void> {
  await page.getByLabel('孩子姓名').fill(form.childName)
  await page.getByLabel('孩子出生年月日').fill('2022-03-15')
  await page.getByLabel('家長稱呼').fill(form.parentName)
  await page.getByLabel('聯絡電話').fill(form.phone)
  await page.getByLabel('聯絡 Email').fill(form.email)
  // 2026-10-02 起不用勾選同意。
  await expect(page.getByRole('checkbox', { name: /我同意/ })).toHaveCount(0)
}

const mailSubjects = (to: string) => async () => (await readMail(mail => mail.to === to)).map(mail => mail.subject)

test.describe('自選場次（義華）', () => {
  test('家長選場次送出即預約成功 → 從結果頁改場次、改資料 → 取消；確認信寫進 sink', async ({ browser }) => {
    const form = { childName: '自選寶貝', parentName: '自選媽媽', phone: '0955000111', email: 'self-book@example.com' }
    const parent = await openAs(browser, null)
    const api = await adminApi('super_admin')
    const { page } = parent

    await test.step('家長選日期與場次、填資料送出，結果頁寫預約成功與修改連結', async () => {
      await page.goto(`/visit/${SLOTS_CAMPUS}`)
      await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
      await pickVisitDate(page)
      await page.locator('.visit-slot-options input[type="radio"]').first().check()
      await fillParentForm(page, form)
      // 送出前的摘要寫出所選校區與場次。
      await expect(page.locator('.visit-summary-what')).toContainText(/(上|下)午場/)
      await page.getByRole('button', { name: '確認預約' }).click()
      await expect(page.locator('#booking-result')).toContainText('預約成功')
      await expect(page.getByRole('link', { name: '修改或取消預約' })).toHaveAttribute('href', /\/visit\/manage#token=/)
    })
    expect((await findVisit(api, form.parentName)).status).toBe('confirmed')
    await expect.poll(mailSubjects(form.email), { timeout: 90_000 }).toContainEqual(expect.stringContaining('參觀預約成功'))

    await test.step('用修改連結進管理頁，改場次', async () => {
      await page.getByRole('link', { name: '修改或取消預約' }).click()
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成功')
      // 連結裡的 token 換成 session 後，網址的 fragment 會被清掉。
      await expect(page).toHaveURL(/\/visit\/manage$/)
      // router 自己記的位置也不能留著 token：導覽到別頁後，history.state 的 back／current 都不含 token。
      await page.getByRole('link', { name: '回官網首頁' }).click()
      await expect(page).toHaveURL(/\/$/)
      expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('token')
      await page.goBack()
      await expect(page).toHaveURL(/\/visit\/manage$/)
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成功')
      await page.getByRole('button', { name: '改場次' }).click()
      await pickVisitDate(page)
      await page.getByRole('group', { name: '新的場次' }).getByRole('radio').first().check()
      await page.getByRole('button', { name: '確認改到這個場次' }).click()
      await expect(page.locator('.parent-visit-notice')).toContainText('已改到')
    })

    await test.step('修改資料', async () => {
      await page.getByRole('button', { name: '修改資料' }).click()
      await page.getByLabel('孩子姓名').fill('小安安')
      await page.getByRole('button', { name: '儲存修改' }).click()
      await expect(page.locator('.parent-visit-notice')).toContainText('資料已更新')
      // 變更信在案件取消前要先寄出：已排隊還沒寄的變更信，案件取消後會略過。
      await expect.poll(mailSubjects(form.email), { timeout: 90_000 }).toContainEqual(expect.stringContaining('參觀預約已變更'))
    })

    await test.step('取消預約', async () => {
      await page.getByRole('button', { name: '取消預約' }).click()
      await page.getByRole('button', { name: '確認取消預約' }).click()
      await expect(page.locator('.parent-visit-status')).toHaveText('預約已取消')
      await expect.poll(mailSubjects(form.email), { timeout: 90_000 }).toContainEqual(expect.stringContaining('參觀預約已取消'))
    })
    expect((await findVisit(api, form.parentName)).status).toBe('cancelled')
    await Promise.all([parent.context.close(), api.dispose()])
  })

  test('園方在後台看到預約正常，取消後列表寫出家長取消', async ({ browser }) => {
    const api = await adminApi('super_admin')
    const created = await submitPublicRequest(SLOTS_CAMPUS, '後台對照家長', '0955000222')
    const visit = await findVisit(api, '後台對照家長')
    const staff = await openAs(browser, 'reception')
    const { page } = staff
    await page.goto('/admin/visit-requests')
    await page.getByRole('textbox', { name: /搜尋家長/ }).fill('後台對照家長')
    await expect(page.locator('.visit-state').first()).toHaveText('預約正常')
    await page.getByRole('link', { name: '後台對照家長' }).first().click()
    await expect(page.getByRole('heading', { level: 2, name: '後台對照家長' })).toBeVisible()
    await page.getByRole('button', { name: '取消預約' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消預約' }).click()
    await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible()
    expect((await findVisit(api, '後台對照家長')).status).toBe('cancelled')
    expect(visit.id).toBeTruthy()
    expect(created.receipt_id).toBeTruthy()
    await Promise.all([staff.context.close(), api.dispose()])
  })
})

test.describe('填寫中的即時驗證', () => {
  // 2026-09-30 E2E：輸入框 blur 時插入的錯誤訊息把下方版面推下約 31px，按下時還在目標上、
  // 放開時已不在，第一次點擊落空（電話填錯直接點下方的勾選框要點兩次）。錯誤訊息要等點擊完成才出現。
  // 原本點的是同意框；2026-10-02 拿掉同意勾選後，改點同樣在電話下方的「如何知道」勾選框。
  // 重現條件是剛填的欄位還在畫面上：目標在畫面外時 Playwright 會先捲動，Chrome 的 scroll
  // anchoring 剛好把位移補掉，測不出來。
  async function openForm(page: Page): Promise<void> {
    await page.goto(`/visit/${SECOND_CAMPUS}`)
    await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
    await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__))
    await pickVisitDate(page)
    await page.locator('.visit-slot-options input[type="radio"]').first().check()
    await page.getByLabel('孩子姓名').fill('王小葉')
    await page.getByLabel('孩子出生年月日').fill('2022-03-15')
    await page.getByLabel('家長稱呼').fill('王驗證家長')
  }

  /** 剛填的欄位捲到畫面上方、焦點留著：家長填完就直接往下點。 */
  async function keepOnScreen(field: Locator): Promise<void> {
    await field.evaluate(el => window.scrollBy({ top: el.getBoundingClientRect().top - 120, behavior: 'instant' }))
  }

  const devices = [
    { name: '桌機滑鼠', device: {}, touch: false },
    { name: '手機觸控', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, touch: true },
  ]
  for (const { name, device, touch } of devices) {
    test(`電話填錯直接點下方的勾選框，一次就勾到（${name}）`, async ({ browser }) => {
      const { context, page } = await openAs(browser, null, device)
      await openForm(page)
      const phone = page.getByLabel('聯絡電話')
      await phone.fill('12345')
      await keepOnScreen(phone)

      const referral = page.getByRole('checkbox', { name: '親友介紹' })
      if (touch) await referral.tap()
      else await referral.click()
      // 錯誤訊息出現代表 Vue 已接手處理 blur，不是 hydration 前的原生勾選。
      await expect(page.locator('#visit-phone-error')).not.toBeEmpty()
      await expect(referral).toBeChecked()
      await context.close()
    })
  }

  test('Email 填錯直接按送出，一次就跑送出前檢查', async ({ browser }) => {
    const { context, page } = await openAs(browser, null)
    await openForm(page)
    await page.getByLabel('聯絡電話').fill('0912000333')
    const email = page.getByLabel('聯絡 Email')
    await email.fill('not-an-email')
    await keepOnScreen(email)

    await page.getByRole('button', { name: '確認預約' }).click()
    // 送出前檢查擋下後把焦點帶回第一個錯誤欄位；點擊落空的話焦點會停在送出鈕上。
    await expect(page.locator('#visit-email-error')).not.toBeEmpty()
    await expect(email).toBeFocused()
    await context.close()
  })
})

test.describe('家長管理頁的邊界情況', () => {
  async function manageLink(api: AdminApi, visitId: string): Promise<string> {
    const link = await api.send<{ manage_url_fragment: string }>('POST', `/admin/visit-requests/${visitId}/access-link`)
    return link.manage_url_fragment
  }

  test('兩個分頁各開一筆預約，舊分頁按取消不會取消到另一筆', async ({ browser }) => {
    // 2026-09-30 E2E：分頁共用 session cookie，後開的連結蓋掉前一筆；回舊分頁按取消，
    // 畫面上的 A 沒變、另一筆 B 被取消了。
    const api = await adminApi('super_admin')
    await submitPublicRequest(SECOND_CAMPUS, '分頁甲家長', '0912000661')
    await submitPublicRequest(SECOND_CAMPUS, '分頁乙家長', '0912000662')
    const [first, second] = [await findVisit(api, '分頁甲家長'), await findVisit(api, '分頁乙家長')]
    const { context, page: firstTab } = await openAs(browser, null)
    await firstTab.goto(await manageLink(api, first.id))
    await expect(firstTab.locator('.parent-visit-details').getByText('0912000661', { exact: true })).toBeVisible()
    const secondTab = await context.newPage()
    await secondTab.goto(await manageLink(api, second.id))
    await expect(secondTab.locator('.parent-visit-details').getByText('0912000662', { exact: true })).toBeVisible()

    await firstTab.bringToFront()
    await firstTab.getByRole('button', { name: '取消預約' }).click()
    await firstTab.getByRole('button', { name: '確認取消預約' }).click()
    await expect(firstTab.locator('.parent-visit-error')).toContainText('其他分頁開啟了另一筆預約的管理連結')
    await expect(firstTab.locator('.parent-visit-status')).toHaveCount(0)
    expect((await findVisit(api, '分頁甲家長')).status).toBe('confirmed')
    expect((await findVisit(api, '分頁乙家長')).status).toBe('confirmed')

    // 後開的那一頁照常可以操作。
    await secondTab.bringToFront()
    await secondTab.getByRole('button', { name: '取消預約' }).click()
    await secondTab.getByRole('button', { name: '確認取消預約' }).click()
    await expect(secondTab.locator('.parent-visit-status')).toHaveText('預約已取消')
    expect((await findVisit(api, '分頁乙家長')).status).toBe('cancelled')
    expect((await findVisit(api, '分頁甲家長')).status).toBe('confirmed')
    await Promise.all([context.close(), api.dispose()])
  })

  test('改期送出時剛好過了異動截止，操作列回來、可以重新載入', async ({ browser }) => {
    // 2026-09-30 E2E：API 正確回 CHANGE_DEADLINE_PASSED，但改期表單收起後操作列也不見，
    // 重新載入與返回都沒有，只能自己重新整理瀏覽器。
    const api = await adminApi('super_admin')
    await submitPublicRequest(SLOTS_CAMPUS, '截止改期家長', '0912000663')
    const visit = await findVisit(api, '截止改期家長')
    const { context, page } = await openAs(browser, null)
    const config = await api.get<{ version: number; mode: string; parent_change_deadline_hours: number }>(
      `/admin/booking-config/${SLOTS_CAMPUS}`,
    )
    const setDeadline = async (hours: number) => {
      const current = await api.get<{ version: number }>(`/admin/booking-config/${SLOTS_CAMPUS}`)
      await api.send('PATCH', `/admin/booking-config/${SLOTS_CAMPUS}`, {
        expected_version: current.version, mode: config.mode, parent_change_deadline_hours: hours,
      })
    }
    try {
      await page.goto(await manageLink(api, visit.id))
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成功')
      await page.getByRole('button', { name: '改場次' }).click()
      await pickVisitDate(page)
      await page.getByRole('group', { name: '新的場次' }).getByRole('radio').first().check()
      // 頁面開著的期間跨過截止：把這校的異動截止拉到參觀前 14 天（場次在 7–9 天後）。
      await setDeadline(24 * 14)
      await page.getByRole('button', { name: '確認改到這個場次' }).click()

      await expect(page.locator('.parent-visit-error')).toContainText('目前已無法線上異動這筆預約')
      await expect(page.getByRole('button', { name: '重新載入預約' })).toBeVisible()
      await expect(page.getByRole('button', { name: '改場次' })).toHaveCount(0)
      await expect(page.getByText('已超過線上修改時間')).toBeVisible()
      // 改場次沒有成功：案件仍在原本的場次。
      expect((await findVisit(api, '截止改期家長')).slot?.id).toBe(visit.slot?.id)
    } finally {
      await setDeadline(config.parent_change_deadline_hours)
      await Promise.all([context.close(), api.dispose()])
    }
  })
})
