import { test, expect } from '@playwright/test'

// 2026-09-26 從舊官網搬來的內容：特色教學頁、四校校園探索真實場景、義華家長分享。
test.describe('特色教學頁', () => {
  // 2026-09-28 水彩版：四章＋結尾教學理念，拿掉預約參觀
  test('四章與教學理念都在、選單標目前頁、無橫向捲動', async ({ page }) => {
    await page.goto('/curriculum', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('動手做')
    await expect(page.locator('.cur-index a')).toHaveCount(4)
    await expect(page.locator('#years .cur-year')).toHaveCount(4)
    await expect(page.locator('#directions .cur-dir')).toHaveCount(7)
    await expect(page.locator('#gallery .cur-art img')).toHaveCount(8)
    await expect(page.locator('#daily .cur-thing')).toHaveCount(5)
    await expect(page.locator('#belief .cur-belief-list li')).toHaveCount(5)
    await expect(page.locator('main a[href^="/visit"]')).toHaveCount(0)
    await expect(page.locator('header a[href="/curriculum"][aria-current="page"]').first()).toBeAttached()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
