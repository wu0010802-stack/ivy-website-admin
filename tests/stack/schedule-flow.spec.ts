import { expect, test, type Page } from '@playwright/test'
import { answerMessageBox, gotoAdmin } from './pages'
import { storageStatePath } from './stack-env'

// 參觀時段排程（計畫 Task 8、A11）：園方設每週開放規則 → 依規則產生時段 → 切成
// 「時段預約」→ 官網預約頁列出新場次。用崇德（初始化後是暫停、沒有場次），
// 不和其他測試共用校區。
test.use({ storageState: storageStatePath('super_admin') })

/** Element Plus 的 el-select：input 上蓋著顯示值的 div，要點外框才會展開。 */
async function chooseCampus(page: Page, name: string): Promise<void> {
  await page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '校區' }) }).first().click()
  await page.getByRole('option', { name, exact: true }).click()
}

test('每週規則產生時段、切成時段預約後官網看得到場次', async ({ page }) => {
  await test.step('時段與容量：新增每週規則、儲存、依規則產生時段', async () => {
    await gotoAdmin(page, '/slots', '時段與容量')
    await chooseCampus(page, '崇德')
    const schedule = page.locator('section').filter({ has: page.getByRole('heading', { name: '每週開放規則' }) })
    await schedule.getByRole('button', { name: '新增規則' }).click()
    await schedule.getByRole('button', { name: '儲存規則' }).click()
    await expect(page.getByText(/已儲存開放規則/)).toBeVisible()
    await schedule.getByRole('button', { name: '依規則產生時段' }).click()
    await expect(page.getByText(/新增 [1-9]\d* 場時段/)).toBeVisible()
  })

  await test.step('各校預約方式：崇德切成時段預約', async () => {
    await gotoAdmin(page, '/booking', '各校預約方式')
    await chooseCampus(page, '崇德')
    await page.getByText('時段預約（家長自選場次）').click()
    await page.getByRole('button', { name: '儲存並套用到官網' }).click()
    await answerMessageBox(page, '切換預約方式？', '確認切換')
    await expect(page.locator('.modes__current')).toHaveCount(1)
    await expect(page.locator('.modes__item.is-checked')).toContainText('目前使用中')
  })

  await test.step('官網崇德預約頁列出依規則產生的場次', async () => {
    await page.goto('/visit/chongde')
    await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
    const date = page.getByLabel('預約日期')
    await expect(date.locator('option')).not.toHaveCount(1)
    await date.selectOption({ index: 1 })
    // 預設規則是 09:30–11:00、每場 30 分鐘：一天三場。
    await expect(page.locator('.visit-slot-options input[type="radio"]')).toHaveCount(3)
    await expect(page.locator('.visit-slot-options')).toContainText('09:30')
  })
})
