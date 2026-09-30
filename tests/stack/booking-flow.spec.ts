import { expect, test, type Locator, type Page } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest, type AdminApi } from './api'
import { answerMessageBox, gotoAdmin, openAs } from './pages'
import { INQUIRY_CAMPUS, SLOTS_CAMPUS } from './stack-env'

// 預約主流程（計畫 Task 11 A11、A13）：家長在官網送出 → 後台看到並處理 → 產生家長管理
// 連結 → 家長用連結改期或取消 → 後台核准。每一步都在畫面上操作，只用 API 核對結果。

interface ParentForm {
  childName: string
  parentName: string
  phone: string
}

async function fillParentForm(page: Page, form: ParentForm): Promise<void> {
  await page.getByLabel('孩子姓名').fill(form.childName)
  await page.getByLabel('孩子出生年月日').fill('2022-03-15')
  await page.getByLabel('家長稱呼').fill(form.parentName)
  await page.getByLabel('聯絡電話').fill(form.phone)
  await page.getByLabel('參觀人數').selectOption('2')
  await page.getByRole('checkbox', { name: /我同意園方使用本次填寫的資料/ }).check()
}

async function openCase(page: Page, parentName: string): Promise<void> {
  await gotoAdmin(page, '/visit-requests', '參觀案件')
  await page.getByRole('link', { name: parentName }).first().click()
  // 頁首的頁名是 h1，家長姓名是 h2（DESIGN 第六輪：一頁只有一個 h1）。
  await expect(page.getByRole('heading', { level: 2, name: parentName })).toBeVisible()
}

/** 已確認的案件：狀態標籤是「已確認」，處理區換成改期（場次開始前沒有完成／未到場）。 */
async function expectConfirmed(page: Page): Promise<void> {
  await expect(page.getByText('已確認', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '改期的新時段' })).toBeVisible()
}

async function createParentLink(page: Page): Promise<string> {
  const panel = page.locator('section.access')
  await panel.getByRole('button', { name: '產生連結' }).click()
  const input = panel.getByRole('textbox', { name: '家長管理連結' })
  await expect(input).toHaveValue(/\/visit\/manage#token=/)
  return input.inputValue()
}

test.describe('線上選場次（義華）', () => {
  test('家長選場次送出 → 園方確認 → 家長用管理連結申請改期 → 園方核准', async ({ browser }) => {
    const form = { childName: '林小芽', parentName: '林線上家長', phone: '0912000111' }
    const parent = await openAs(browser, null)
    const staff = await openAs(browser, 'reception')
    const api = await adminApi('super_admin')

    await test.step('家長在官網選日期與場次、填資料送出', async () => {
      const { page } = parent
      await page.goto(`/visit/${SLOTS_CAMPUS}`)
      await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
      const date = page.getByLabel('預約日期')
      await expect(date.locator('option')).not.toHaveCount(1)
      await date.selectOption({ index: 1 })
      await page.locator('.visit-slot-options input[type="radio"]').first().check()
      await fillParentForm(page, form)
      await page.getByRole('button', { name: '送出參觀需求' }).click()
      const result = page.locator('#booking-result')
      await expect(result.getByRole('heading', { name: '已經收到你的時段申請' })).toBeVisible()
      await expect(result).toContainText('待園方確認')
      await expect(result).toContainText(form.parentName)
    })
    const submitted = await findVisit(api, form.parentName)
    expect(submitted.status).toBe('pending_confirmation')
    expect(submitted.slot).not.toBeNull()

    await test.step('接待人員在案件列表找到、確認家長選的場次並記下聯絡紀錄', async () => {
      const { page } = staff
      await openCase(page, form.parentName)
      await expect(page.getByText('家長已選擇場次，名額暫時保留')).toBeVisible()
      await page.getByRole('button', { name: '確認已選場次' }).click()
      await answerMessageBox(page, '確認這筆預約？', '確認預約')
      await expectConfirmed(page)
      // 確認後聯絡紀錄框會預填「已致電家長…」，直接送出。
      await expect(page.getByRole('textbox', { name: '新增聯絡紀錄' })).toHaveValue(/已致電家長/)
      await page.getByRole('button', { name: '新增紀錄' }).click()
      await expect(page.locator('.detail__pre').filter({ hasText: '已致電家長' })).toBeVisible()
    })
    expect((await findVisit(api, form.parentName)).status).toBe('confirmed')

    let manageUrl = ''
    await test.step('產生家長管理連結（只顯示一次）', async () => {
      manageUrl = await createParentLink(staff.page)
    })

    let requestedDate = ''
    await test.step('家長打開連結，申請改到另一個場次', async () => {
      const { page } = parent
      await page.goto(manageUrl)
      await expect(page.getByRole('heading', { level: 1, name: '管理參觀預約' })).toBeVisible()
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成立')
      // 連結裡的 token 換成 session 後，網址的 fragment 會被清掉。
      await expect(page).toHaveURL(/\/visit\/manage$/)
      await page.getByRole('button', { name: '申請改期' }).click()
      const select = page.getByLabel('希望改期的場次')
      await expect(select).toBeFocused()
      await select.selectOption({ index: 1 })
      requestedDate = (await select.locator('option:checked').textContent()) ?? ''
      await page.getByRole('button', { name: '送出改期申請' }).click()
      await expect(page.locator('.parent-visit-notice')).toBeVisible()
    })

    await test.step('園方在案件明細核准改期', async () => {
      const { page } = staff
      await page.reload()
      const request = page.getByRole('group', { name: '家長的改期申請' })
      await expect(request).toBeVisible()
      await request.getByRole('button', { name: '核准改期' }).click()
      await answerMessageBox(page, '核准這筆改期？', '核准改期')
      await expect(request).toBeHidden()
    })
    const rescheduled = await findVisit(api, form.parentName)
    expect(rescheduled.status).toBe('confirmed')
    expect(rescheduled.slot?.id).not.toBe(submitted.slot?.id)

    await test.step('家長重新整理管理頁，看到新時段', async () => {
      const { page } = parent
      await page.reload()
      await expect(page.locator('.parent-visit-details')).toContainText(requestedDate.trim())
    })

    await Promise.all([parent.context.close(), staff.context.close(), api.dispose()])
  })
})

test.describe('只收需求（明華）', () => {
  test('家長送出需求 → 園方聯絡後排入時段 → 家長用管理連結取消', async ({ browser }) => {
    const form = { childName: '陳小樹', parentName: '陳需求家長', phone: '0912000222' }
    const parent = await openAs(browser, null)
    const staff = await openAs(browser, 'super_admin')
    const api = await adminApi('super_admin')

    await test.step('家長送出參觀需求（不選場次）', async () => {
      const { page } = parent
      await page.goto(`/visit/${INQUIRY_CAMPUS}`)
      await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
      await expect(page.getByLabel('預約日期')).toHaveCount(0)
      await fillParentForm(page, form)
      await page.getByRole('button', { name: '送出參觀需求' }).click()
      await expect(page.locator('#booking-result').getByRole('heading', { name: '參觀需求已送出' })).toBeVisible()
    })
    expect((await findVisit(api, form.parentName)).status).toBe('new')

    await test.step('園方標為聯絡中、記下聯絡紀錄、選時段確認', async () => {
      const { page } = staff
      await openCase(page, form.parentName)
      await page.getByRole('button', { name: '開始聯絡（標為聯絡中）' }).click()
      await expect(page.getByRole('button', { name: '開始聯絡（標為聯絡中）' })).toBeHidden()
      await page.getByRole('textbox', { name: '新增聯絡紀錄' }).fill('已致電，家長希望下週上午參觀')
      await page.getByRole('button', { name: '新增紀錄' }).click()
      await expect(page.locator('.detail__pre').filter({ hasText: '家長希望下週上午參觀' })).toBeVisible()
      await page.locator('.detail__actions .el-select').first().click()
      await page.getByRole('option').first().click()
      await page.getByRole('button', { name: '確認並排入時段' }).click()
      await answerMessageBox(page, '確認這筆預約？', '確認預約')
      await expectConfirmed(page)
    })
    const confirmed = await findVisit(api, form.parentName)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.slot).not.toBeNull()

    const manageUrl = await createParentLink(staff.page)

    await test.step('家長用連結取消預約', async () => {
      const { page } = parent
      await page.goto(manageUrl)
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成立')
      await page.getByRole('button', { name: '取消預約' }).click()
      await expect(page.getByRole('heading', { name: '確定要取消這次預約嗎？' })).toBeVisible()
      await page.getByRole('button', { name: '確認取消預約' }).click()
      await expect(page.locator('.parent-visit-status')).toHaveText('預約已取消')
      await expect(page.getByRole('link', { name: '重新預約' })).toBeVisible()
    })

    await test.step('園方看到家長已取消，歷程記錄是家長操作', async () => {
      const { page } = staff
      await page.reload()
      await expect(page.getByText('已取消', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '重新預約（另建新案）' })).toBeVisible()
      await expect(page.getByRole('list', { name: '案件歷程' }).getByRole('listitem').first()).toContainText('家長')
    })
    expect((await findVisit(api, form.parentName)).status).toBe('cancelled')

    await Promise.all([parent.context.close(), staff.context.close(), api.dispose()])
  })
})

test.describe('填寫中的即時驗證', () => {
  // 2026-09-30 E2E：輸入框 blur 時插入的錯誤訊息把下方版面推下約 31px，按下時還在目標上、
  // 放開時已不在，第一次點擊落空（電話填錯直接點同意框要點兩次）。錯誤訊息要等點擊完成才出現。
  // 重現條件是剛填的欄位還在畫面上：目標在畫面外時 Playwright 會先捲動，Chrome 的 scroll
  // anchoring 剛好把位移補掉，測不出來。
  async function openInquiryForm(page: Page): Promise<void> {
    await page.goto(`/visit/${INQUIRY_CAMPUS}`)
    await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
    await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__))
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
    test(`電話填錯直接點同意框，一次就勾到（${name}）`, async ({ browser }) => {
      const { context, page } = await openAs(browser, null, device)
      await openInquiryForm(page)
      const phone = page.getByLabel('聯絡電話')
      await phone.fill('12345')
      await keepOnScreen(phone)

      const consent = page.getByRole('checkbox', { name: /我同意園方使用本次填寫的資料/ })
      if (touch) await consent.tap()
      else await consent.click()
      // 錯誤訊息出現代表 Vue 已接手處理 blur，不是 hydration 前的原生勾選。
      await expect(page.locator('#visit-phone-error')).not.toBeEmpty()
      await expect(consent).toBeChecked()
      await context.close()
    })
  }

  test('Email 填錯直接按送出，一次就跑送出前檢查', async ({ browser }) => {
    const { context, page } = await openAs(browser, null)
    await openInquiryForm(page)
    await page.getByLabel('聯絡電話').fill('0912000333')
    await page.getByLabel('參觀人數').selectOption('2')
    await page.getByRole('checkbox', { name: /我同意園方使用本次填寫的資料/ }).check()
    const email = page.getByLabel('聯絡 Email')
    await email.fill('not-an-email')
    await keepOnScreen(email)

    await page.getByRole('button', { name: '送出參觀需求' }).click()
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
    await submitPublicRequest(INQUIRY_CAMPUS, '分頁甲家長', '0912000661')
    await submitPublicRequest(INQUIRY_CAMPUS, '分頁乙家長', '0912000662')
    const [first, second] = [await findVisit(api, '分頁甲家長'), await findVisit(api, '分頁乙家長')]
    const { context, page: firstTab } = await openAs(browser, null)
    await firstTab.goto(await manageLink(api, first.id))
    await expect(firstTab.getByText('0912***661')).toBeVisible()
    const secondTab = await context.newPage()
    await secondTab.goto(await manageLink(api, second.id))
    await expect(secondTab.getByText('0912***662')).toBeVisible()

    await firstTab.bringToFront()
    await firstTab.getByRole('button', { name: '取消預約' }).click()
    await firstTab.getByRole('button', { name: '確認取消預約' }).click()
    await expect(firstTab.locator('.parent-visit-error')).toContainText('其他分頁開啟了另一筆預約的管理連結')
    await expect(firstTab.locator('.parent-visit-status')).toHaveCount(0)
    expect((await findVisit(api, '分頁甲家長')).status).toBe('new')
    expect((await findVisit(api, '分頁乙家長')).status).toBe('new')

    // 後開的那一頁照常可以操作。
    await secondTab.bringToFront()
    await secondTab.getByRole('button', { name: '取消預約' }).click()
    await secondTab.getByRole('button', { name: '確認取消預約' }).click()
    await expect(secondTab.locator('.parent-visit-status')).toHaveText('預約已取消')
    expect((await findVisit(api, '分頁乙家長')).status).toBe('cancelled')
    expect((await findVisit(api, '分頁甲家長')).status).toBe('new')
    await Promise.all([context.close(), api.dispose()])
  })

  test('改期送出時剛好過了異動截止，操作列回來、可以重新載入', async ({ browser }) => {
    // 2026-09-30 E2E：API 正確回 CHANGE_DEADLINE_PASSED，但改期表單收起後操作列也不見，
    // 重新載入與返回都沒有，只能自己重新整理瀏覽器。
    const api = await adminApi('super_admin')
    await submitPublicRequest(SLOTS_CAMPUS, '截止改期家長', '0912000663')
    const visit = await findVisit(api, '截止改期家長')
    await api.send('POST', `/admin/visit-requests/${visit.id}/confirm`, { slot_id: visit.slot!.id })
    const { context, page } = await openAs(browser, null)
    const config = await api.get<{ version: number; mode: string; slots_auto_confirm: boolean; parent_change_deadline_hours: number }>(
      `/admin/booking-config/${SLOTS_CAMPUS}`,
    )
    const setDeadline = async (hours: number) => {
      const current = await api.get<{ version: number }>(`/admin/booking-config/${SLOTS_CAMPUS}`)
      await api.send('PATCH', `/admin/booking-config/${SLOTS_CAMPUS}`, {
        expected_version: current.version, mode: config.mode, slots_auto_confirm: config.slots_auto_confirm, parent_change_deadline_hours: hours,
      })
    }
    try {
      await page.goto(await manageLink(api, visit.id))
      await expect(page.locator('.parent-visit-status')).toHaveText('預約成立')
      await page.getByRole('button', { name: '申請改期' }).click()
      await page.getByLabel('希望改期的場次').selectOption({ index: 1 })
      // 頁面開著的期間跨過截止：把這校的異動截止拉到參觀前 14 天（場次在 7–9 天後）。
      await setDeadline(24 * 14)
      await page.getByRole('button', { name: '送出改期申請' }).click()

      await expect(page.locator('.parent-visit-error')).toContainText('目前已無法線上異動這筆預約')
      await expect(page.getByRole('button', { name: '重新載入預約' })).toBeVisible()
      await expect(page.getByRole('button', { name: '申請改期' })).toHaveCount(0)
      await expect(page.getByText('已超過線上異動時間')).toBeVisible()
      const requests = await api.get<{ visit_request_id: string }[]>(`/admin/reschedule-requests?campus_key=${SLOTS_CAMPUS}`)
      expect(requests.filter(request => request.visit_request_id === visit.id)).toEqual([])
    } finally {
      await setDeadline(config.parent_change_deadline_hours)
      await Promise.all([context.close(), api.dispose()])
    }
  })
})
