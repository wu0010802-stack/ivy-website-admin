import { test, expect } from '@playwright/test'

// 2026-09-26 從舊官網搬來的內容：特色教學頁、四校校園探索真實場景、義華家長分享。
test.describe('特色教學頁', () => {
  test('三章都在、選單標目前頁、無橫向捲動', async ({ page }) => {
    await page.goto('/curriculum', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('動手做')
    await expect(page.locator('#years .cur-year')).toHaveCount(4)
    await expect(page.locator('#directions .cur-direction')).toHaveCount(7)
    await expect(page.locator('#daily .cur-print')).toHaveCount(5)
    await expect(page.locator('header a[href="/curriculum"][aria-current="page"]').first()).toBeAttached()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})

test.describe('分校頁', () => {
  for (const key of ['minghua', 'chongde', 'international', 'renwu']) {
    test(`${key} 校園探索是真實場景，不顯示模板提示`, async ({ page }) => {
      await page.goto(`/campuses/${key}`, { waitUntil: 'networkidle' })
      await expect(page.locator('.tour-todo-notice')).toHaveCount(0)
      expect(await page.locator('.tour-scene').count()).toBeGreaterThanOrEqual(2)
      await expect(page.locator('#stories')).toHaveCount(0)
    })
  }

  test('義華有家長分享，點海報原地播放', async ({ page }) => {
    await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }))
    await page.goto('/campuses/yihua', { waitUntil: 'networkidle' })
    const stories = page.locator('#stories .story')
    await expect(stories).toHaveCount(4)
    await stories.first().locator('.story-play').click()
    await expect(stories.first().locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//)
  })
})
