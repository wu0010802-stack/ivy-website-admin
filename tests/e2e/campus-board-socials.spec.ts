import { test, expect } from '@playwright/test'

// 首頁五校卡的社群列：有帳號的校才出現 IG／YouTube，不拿其他校的帳號代填（2026-09-25）。
test.describe('首頁五校卡社群連結', () => {
  test('義華顯示 IG／YouTube，明華沒有就不出現', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const skip = page.getByRole('button', { name: /略過/ })
    if (await skip.count()) await skip.first().click()

    const row = page.locator('#campus-stage .social-row')
    await page.locator('#campus-tab-yihua').click()
    await expect(row.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', /instagram\.com\//)
    await expect(row.getByRole('link', { name: /YouTube/ })).toHaveAttribute('href', /youtube\.com\//)

    await page.locator('#campus-tab-minghua').click()
    await expect(row.getByRole('link', { name: /Instagram|YouTube/ })).toHaveCount(0)
  })
})
