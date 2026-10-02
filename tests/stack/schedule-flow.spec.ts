import { expect, test } from '@playwright/test'
import { answerMessageBox, gotoAdmin, pickVisitDate, pickVisitDay } from './pages'
import { storageStatePath } from './stack-env'

// 參觀場次（2026-09-30）：園方在「參觀場次」套用常用場次並開放 → 官網看得到場次 →
// 月曆上停止一場 → 官網少一場 → 整天休假。用崇德（初始化後是暫停、沒有場次），
// 不和其他測試共用校區。
test.use({ storageState: storageStatePath('super_admin') })

test('參觀場次：套用常用場次並開放 → 官網看得到 → 停止一場 → 官網少一場 → 整天休假', async ({ page }) => {
  await gotoAdmin(page, '/visit-calendar?campus=chongde', '參觀場次')
  await page.getByRole('button', { name: '套用常用場次' }).click()
  await page.getByRole('button', { name: '儲存並開放線上預約' }).click()
  await answerMessageBox(page, '儲存並開放線上預約？', '儲存並開放')
  await expect(page.getByText('上午場 10:00・每場 1 組・週一–週五')).toBeVisible()

  const site = await page.context().newPage()
  await site.goto('/visit/chongde')
  await expect(site.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
  // 第一個日期可能是明天：離現在不到最短提前時間的場次會被藏起來，場次數跟著跑的時間變。
  // 改選第二個日期，兩場一定都在預約窗內。
  const day = await pickVisitDate(site, 1)
  await expect(site.locator('.visit-slot-options input[type="radio"]')).toHaveCount(2)

  await page.locator(`.calendar__day[aria-label^="${day.replaceAll('-', '/')}"]`).click()
  const morning = page.locator('.calendar__slot').filter({ hasText: '上午場 10:00' })
  await morning.getByRole('button', { name: '停止申請' }).click()
  await expect(morning).toContainText('已停止申請')

  await site.reload()
  await pickVisitDay(site, day)
  await expect(site.locator('.visit-slot-options input[type="radio"]')).toHaveCount(1)

  await page.getByRole('button', { name: '整天休假' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('教師研習')
  await page.getByRole('dialog').getByRole('button', { name: '設為休假' }).click()
  await expect(page.locator('#day-panel-title')).toContainText('休假：教師研習')
  await site.close()
})
