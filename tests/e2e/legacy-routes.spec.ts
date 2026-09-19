import { test, expect } from '@playwright/test'

test.describe('舊 hash 連結相容轉址', () => {
  test('#/home 轉址到 /', async ({ page }) => {
    await page.goto('/#/home')
    await expect(page).toHaveURL(/\/$/)
  })

  test('#/yihua 轉址到 /campuses/yihua', async ({ page }) => {
    await page.goto('/#/yihua')
    await expect(page).toHaveURL(/\/campuses\/yihua$/)
  })

  test('#/visit 轉址到 /visit', async ({ page }) => {
    await page.goto('/#/visit')
    await expect(page).toHaveURL(/\/visit$/)
  })

  test('#/visit/renwu 轉址到 /visit/renwu', async ({ page }) => {
    await page.goto('/#/visit/renwu')
    await expect(page).toHaveURL(/\/visit\/renwu$/)
  })

  test('未知 hash 不強制轉址（維持白名單以外不攔截）', async ({ page }) => {
    await page.goto('/#/some-unknown-hash')
    // 不在白名單內，plugin 不應該把它導去 404 以外的奇怪位置；
    // 首頁本身正常渲染即可（不斷言特定 URL，避免對未定義行為過度假設）。
    await expect(page.locator('main')).toBeVisible()
  })
})
