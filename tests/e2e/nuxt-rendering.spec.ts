import { test, expect } from '@playwright/test'

test.describe('Nuxt SSR 基本內容（無 JS）', () => {
  test('首頁停用 JS 仍可讀 hero 與關於文案', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
    const page = await context.newPage()
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page.locator('main')).not.toBeEmpty()
    await context.close()
  })
})

test.describe('未知路徑', () => {
  test('已移除的分校頁轉回首頁', async ({ page }) => {
    await page.goto('/campuses/yihua')
    await expect(page).toHaveURL(/\/$/)
  })
})
