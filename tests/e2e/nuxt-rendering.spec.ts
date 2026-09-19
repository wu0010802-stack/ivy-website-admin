import { test, expect } from '@playwright/test'

const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const CAMPUS_NAMES: Record<string, string> = {
  yihua: '義華',
  minghua: '明華',
  chongde: '崇德',
  international: '國際',
  renwu: '仁武',
}

test.describe('Nuxt SSR 基本內容（無 JS）', () => {
  for (const key of CAMPUS_KEYS) {
    test(`直接進入 /campuses/${key} 停用 JS 仍有可讀內容`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
      const page = await context.newPage()
      const response = await page.goto(`/campuses/${key}`)
      expect(response?.status()).toBe(200)
      const heading = page.locator('main').getByRole('heading', { level: 1 })
      await expect(heading).toContainText(CAMPUS_NAMES[key])
      await expect(heading).toBeVisible()
      await context.close()
    })
  }

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
  test('未知校區回 404', async ({ page }) => {
    const response = await page.goto('/campuses/not-a-real-campus')
    expect(response?.status()).toBe(404)
  })
})
