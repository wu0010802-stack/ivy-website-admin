import { expect, test, type Page } from '@playwright/test'
import { adminApi, findVisit } from './api'
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
  await expect(page.getByRole('heading', { level: 1, name: parentName })).toBeVisible()
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
